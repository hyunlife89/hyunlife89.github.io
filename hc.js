/* =====================================================================
   현쌤 과학 오락실 — 우리 반 문제 연결 (hc.js)
   - 선생님 구글 시트의 문제를 게임에 넣어 줍니다.
   - A 방식: 시트를 '링크가 있는 모든 사용자 · 뷰어'로 공유 (문제만 읽음)
   - B 방식: 시트에 Apps Script 웹 앱 배포 (문제 읽기 + 학생 기록 저장)
   - 데이터는 선생님 드라이브에만 있고, 이 파일은 읽어 와서 기기에 잠깐 보관만 합니다.
   ===================================================================== */
(function () {
  'use strict';
  if (window.HC && window.HC.version) return;

  var K = { code: 'hc.code', name: 'hc.name', stu: 'hc.student', cache: 'hc.cache', queue: 'hc.queue' };
  var DEFAULT_UNIT = '우리 반 문제';
  var listeners = [];

  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
    return null;
  }
  function readJSON(k, d) { try { var v = ls(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function str(v) { return v == null ? '' : String(v).trim(); }

  /* ---------- 연결 코드 ----------
     s.<시트ID>  → A 방식(공유 시트 읽기)
     w.<배포ID>  → B 방식(Apps Script 웹 앱) */
  function parse(input) {
    var s = str(input);
    if (!s) return { error: 'empty' };
    var m = s.match(/script\.google\.com\/(?:a\/[^/]+\/)?macros\/s\/([A-Za-z0-9_-]{20,})/);
    if (m) return { code: 'w.' + m[1], mode: 'B' };
    if (/script\.google\.com\/(?:u\/\d+\/)?home\/projects\//.test(s) || /script\.google\.com\/.*\/edit/.test(s)) return { error: 'editor' };
    if (/\/spreadsheets\/d\/e\//.test(s)) return { error: 'published' };
    m = s.match(/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/);
    if (m) return { code: 's.' + m[1], mode: 'A' };
    m = s.match(/^([sw])\.([A-Za-z0-9_-]{20,})$/);
    if (m) return { code: s, mode: m[1] === 'w' ? 'B' : 'A' };
    return { error: 'unknown' };
  }

  /* ---------- JSONP (구글 쪽 주소는 다른 사이트라 script 태그로 읽어요) ---------- */
  var seq = 0;
  function jsonp(url, ms) {
    return new Promise(function (resolve, reject) {
      var cb = '__hc' + (++seq) + Date.now().toString(36);
      var el = document.createElement('script');
      var done = false, timer;
      function finish() { done = true; clearTimeout(timer); window[cb] = function () {}; if (el.parentNode) el.parentNode.removeChild(el); }
      window[cb] = function (d) { if (done) return; finish(); resolve(d); };
      timer = setTimeout(function () { if (!done) { finish(); reject(new Error('timeout')); } }, ms || 15000);
      el.onerror = function () { if (!done) { finish(); reject(new Error('blocked')); } };
      el.onload = function () { setTimeout(function () { if (!done) { finish(); reject(new Error('noaccess')); } }, 400); };
      el.src = url.replace('{cb}', cb);
      (document.head || document.documentElement).appendChild(el);
    });
  }

  function sheetUrl(id, sheet, cb) {
    return 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:json;responseHandler:' + cb +
      '&headers=1' + (sheet ? '&sheet=' + encodeURIComponent(sheet) : '') + '&_=' + Date.now();
  }
  function gvizRows(d) {
    if (!d || d.status === 'error' || !d.table) {
      var msg = d && d.errors && d.errors[0] && (d.errors[0].detailed_message || d.errors[0].message) || '';
      var e = new Error('sheet'); e.detail = msg; throw e;
    }
    var cols = d.table.cols || [];
    var rows = [cols.map(function (c) { return str(c.label); })];
    (d.table.rows || []).forEach(function (r) {
      rows.push((r.c || []).map(function (c) { return c ? str(c.f != null && typeof c.v !== 'string' ? c.f : c.v) : ''; }));
    });
    // 첫 줄이 머리글로 안 잡힌 경우(라벨이 모두 빔): 첫 데이터 줄을 머리글로
    if (!rows[0].some(Boolean) && rows.length > 1) rows.shift();
    return rows;
  }
  function fetchA(id) {
    return jsonp(sheetUrl(id, '문제', '{cb}')).then(function (d) {
      if (d && d.status === 'error') return jsonp(sheetUrl(id, '', '{cb}')); // '문제' 탭이 없으면 첫 탭
      return d;
    }).then(function (d) { return { rows: gvizRows(d), title: '' }; });
  }
  function webUrl(id) { return 'https://script.google.com/macros/s/' + id + '/exec'; }
  function fetchB(id) {
    return jsonp(webUrl(id) + '?action=questions&callback={cb}&_=' + Date.now()).then(function (d) {
      if (!d || !d.ok) { var e = new Error('script'); e.detail = d && d.error || ''; throw e; }
      return { rows: d.rows || [], title: d.title || '', log: !!d.log };
    });
  }

  /* ---------- 시트 줄 → 문제 ----------
     머리글 이름으로 칸을 찾아요: 단원 | 문제 | 정답 | 오답1 | 오답2 | 오답3 | 해설 | 사용 */
  function colIndex(head) {
    var H = head.map(function (h) { return str(h).replace(/\s/g, ''); });
    function find(re, skip) { for (var i = 0; i < H.length; i++) if (re.test(H[i]) && (skip || []).indexOf(i) < 0) return i; return -1; }
    var q = find(/^(문제|질문|문항)$/); if (q < 0) q = find(/문제|질문|문항/);
    var a = find(/^(정답|답)$/); if (a < 0) a = find(/정답/);
    var wrong = [];
    H.forEach(function (h, i) { if (/^(오답|틀린답|보기)\d*$/.test(h) && i !== a) wrong.push(i); });
    return {
      unit: find(/단원|주제|차시/), q: q, a: a, wrong: wrong,
      e: find(/해설|설명|풀이/), use: find(/^(사용|쓰기|켜기|출제)$/)
    };
  }
  function toQuestions(rows) {
    var out = { units: [], count: 0, skipped: [], problem: '' };
    if (!rows || rows.length < 1) { out.problem = 'empty'; return out; }
    var c = colIndex(rows[0]);
    if (c.q < 0 || c.a < 0) { out.problem = 'header'; return out; }
    var byUnit = {}, order = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var q = str(row[c.q]);
      if (!q) continue;
      if (c.use >= 0 && /^(x|n|no|아니|안|끔|×|✕|✗)/i.test(str(row[c.use]))) continue;
      var ans = str(row[c.a]);
      var opts = [ans];
      c.wrong.forEach(function (i) { var w = str(row[i]); if (w && opts.indexOf(w) < 0 && opts.length < 4) opts.push(w); });
      if (!ans) { out.skipped.push({ row: r + 1, why: '정답 칸이 비었어요', q: q }); continue; }
      if (opts.length < 2) { out.skipped.push({ row: r + 1, why: '오답이 하나도 없어요', q: q }); continue; }
      var u = (c.unit >= 0 && str(row[c.unit])) || DEFAULT_UNIT;
      if (!byUnit[u]) { byUnit[u] = []; order.push(u); }
      byUnit[u].push({ u: u, q: q.slice(0, 400), o: opts.map(function (x) { return x.slice(0, 120); }), e: c.e >= 0 ? str(row[c.e]).slice(0, 400) : '' });
      out.count++;
    }
    out.units = order.map(function (u) { return { name: u, q: byUnit[u] }; });
    return out;
  }

  function fetchCode(code) {
    var p = parse(code);
    if (!p.code) return Promise.reject(new Error('code'));
    var id = p.code.slice(2);
    return (p.mode === 'B' ? fetchB(id) : fetchA(id)).then(function (raw) {
      var res = toQuestions(raw.rows);
      res.mode = p.mode; res.code = p.code; res.title = raw.title; res.log = !!raw.log;
      return res;
    });
  }

  function explain(err, mode) {
    var m = err && err.message;
    if (m === 'noaccess') return mode === 'B'
      ? '웹 앱에 들어갈 수 없어요. 배포할 때 "액세스 권한: 모든 사용자"로 했는지 확인해 주세요.'
      : '시트를 읽을 수 없어요. 공유에서 "링크가 있는 모든 사용자 · 뷰어"로 바꿔 주세요.';
    if (m === 'blocked') return '구글에 연결하지 못했어요. 학교 인터넷에서 구글 문서가 막혀 있는지 확인해 주세요.';
    if (m === 'timeout') return '구글 응답이 너무 늦어요. 잠시 후 다시 해 주세요.';
    if (m === 'sheet') return '시트를 열었지만 문제를 읽지 못했어요. ' + (err.detail || '');
    if (m === 'script') return '웹 앱이 오류를 보냈어요. ' + (err.detail || '스크립트를 다시 배포해 주세요.');
    if (m === 'code') return '연결 코드가 올바르지 않아요.';
    return '알 수 없는 오류가 났어요. (' + (m || err) + ')';
  }

  /* ---------- 저장된 연결 ---------- */
  function code() { return ls(K.code) || ''; }
  function className() { return ls(K.name) || ''; }
  function mode() { var c = code(); return c.charAt(0) === 'w' ? 'B' : c.charAt(0) === 's' ? 'A' : ''; }
  function cache() { var c = readJSON(K.cache, null); return c && c.code === code() ? c : null; }
  function units() { var c = cache(); return c ? c.units : []; }
  function questions() { return units().reduce(function (a, u) { return a.concat(u.q); }, []); }

  function setCode(newCode, name) {
    var p = parse(newCode);
    if (!p.code) return false;
    if (p.code !== code()) ls(K.cache, null);
    ls(K.code, p.code);
    if (name != null) ls(K.name, str(name).slice(0, 30) || null);
    return true;
  }
  function clear() { ls(K.code, null); ls(K.name, null); ls(K.cache, null); ls(K.queue, null); applyAll(); emit(); }

  function save(res) {
    var prev = ls(K.cache);
    var next = JSON.stringify({ code: res.code, at: Date.now(), units: res.units, count: res.count, log: res.log, title: res.title });
    ls(K.cache, next);
    var changed = !prev || JSON.parse(prev).code !== res.code || JSON.stringify(JSON.parse(prev).units) !== JSON.stringify(res.units);
    if (changed) { applyAll(); emit(); }
    return changed;
  }
  function refresh() {
    var c = code();
    if (!c) return Promise.resolve(null);
    return fetchCode(c).then(function (res) { if (code() === c) save(res); return res; });
  }

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); try { window.dispatchEvent(new Event('hc-update')); } catch (e) {} }

  /* ---------- 학생 기록 (B 방식만) ---------- */
  var flushTimer = null;
  function student(v) { if (v !== undefined) ls(K.stu, str(v).slice(0, 20) || null); return ls(K.stu) || ''; }
  function answer(game, name, unit, q, ok) {
    if (mode() !== 'B') return;
    var c = cache(); if (c && c.log === false) return;
    var list = readJSON(K.queue, []);
    if (list.length > 400) list = list.slice(-300);
    list.push([Date.now(), str(game).slice(0, 20), (str(name) || student() || '이름 없음').slice(0, 20), str(unit).slice(0, 40), str(q).slice(0, 120), ok ? 1 : 0]);
    ls(K.queue, JSON.stringify(list));
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, list.length >= 10 ? 200 : 8000);
  }
  var flushing = false;
  function flush(beacon) {
    if (mode() !== 'B' || (flushing && !beacon)) return Promise.resolve(false);
    var list = readJSON(K.queue, []);
    if (!list.length) return Promise.resolve(true);
    var n = Math.min(list.length, 200);
    var body = JSON.stringify({ action: 'log', items: list.slice(0, n) });
    var url = webUrl(code().slice(2));
    function drop() { var now = readJSON(K.queue, []).slice(n); ls(K.queue, now.length ? JSON.stringify(now) : null); }
    if (beacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) { drop(); return Promise.resolve(true); } } catch (e) {}
    }
    flushing = true;
    return fetch(url, { method: 'POST', mode: 'no-cors', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: body.length < 60000 })
      .then(function () { flushing = false; drop(); if (readJSON(K.queue, []).length) flushTimer = setTimeout(flush, 1000); return true; })
      .catch(function () { flushing = false; return false; });
  }
  window.addEventListener('pagehide', function () { flush(true); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });

  /* ---------- 링크에 연결 코드 붙이기 ---------- */
  function link(url) {
    var c = code();
    if (!c) return url;
    try {
      var u = new URL(url, location.href);
      if (/^https?:$/.test(u.protocol)) { u.searchParams.set('c', c); if (className()) u.searchParams.set('n', className()); }
      return u.href;
    } catch (e) { return url; }
  }
  function classLink(base) {
    var u = new URL(base || location.href);
    u.hash = ''; u.search = '';
    u.searchParams.set('c', code());
    if (className()) u.searchParams.set('n', className());
    return u.href;
  }

  /* ---------- 게임에 넣기 ----------
     엑스탱크: XT_UNITS 단원 목록에 '우리 반' 묶음으로 추가
     포트리스·탈출: 게임 안에서 HC.questions() 를 '우리 반 문제'에 더해 씀 */
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function applyXT() {
    var X = window.XT_UNITS;
    if (!Array.isArray(X)) return;
    for (var i = X.length - 1; i >= 0; i--) if (X[i] && X[i].hc) X.splice(i, 1);
    units().forEach(function (u) {
      X.push({
        id: 'hc' + hash(u.name), hc: true, grade: '우리 반', name: (className() ? className() + ' · ' : '') + u.name,
        q: u.q.map(function (x) {
          var n = x.o.length, at = parseInt(hash(x.q), 36) % n, a = x.o.slice(1);
          a.splice(at, 0, x.o[0]);
          return { q: x.q, a: a, c: at, e: x.e || '' };
        })
      });
    });
  }
  function applyAll() { try { applyXT(); } catch (e) {} }

  /* ---------- 주소에 ?c= 가 있으면 저장 ---------- */
  try {
    var sp = new URLSearchParams(location.search);
    if (sp.get('c')) setCode(sp.get('c'), sp.get('n'));
  } catch (e) {}

  window.HC = {
    version: 1, DEFAULT_UNIT: DEFAULT_UNIT,
    parse: parse, fetch: fetchCode, toQuestions: toQuestions, explain: explain,
    code: code, className: className, mode: mode, set: setCode, clear: clear,
    cache: cache, units: units, questions: questions, refresh: refresh, save: save, onChange: onChange,
    student: student, answer: answer, flush: flush, link: link, classLink: classLink,
    apply: applyAll
  };

  applyAll();
  if (code()) {
    var age = (cache() || {}).at || 0;
    // 페이지를 열 때마다 새로 읽어 오되, 막 읽었으면(30초 안) 건너뜀
    if (Date.now() - age > 30000) setTimeout(function () { refresh().catch(function () {}); }, 50);
    setTimeout(function () { flush(); }, 3000);
  }
})();
