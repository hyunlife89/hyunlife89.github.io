/* =====================================================================
   현게임 — 우리 반 문제 연결 (hc.js)
   - 선생님 구글 시트의 문제를 게임에 넣어 줍니다.
   - A 방식: 시트를 '링크가 있는 모든 사용자 · 뷰어'로 공유 (문제만 읽음)
   - B 방식: 시트에 Apps Script 웹 앱 배포 (문제 읽기 + 학생 기록 저장)
   - 데이터는 선생님 드라이브에만 있고, 이 파일은 읽어 와서 기기에 잠깐 보관만 합니다.
   ===================================================================== */
(function () {
  'use strict';
  if (window.HC && window.HC.version) return;

  var K = { code: 'hc.code', name: 'hc.name', stu: 'hc.student', cache: 'hc.cache', queue: 'hc.queue', local: 'hc.local' };
  var BASE = (function () { try { return new URL('.', document.currentScript.src).href; } catch (e) { return '/arcade/'; } })();
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
  /* 시트 문제 + 이 기기에 엑셀로 넣은 문제 */
  function sheetUnits() { var c = cache(); return c ? c.units : []; }
  function local() { var l = readJSON(K.local, null); return l && Array.isArray(l.units) ? l : { units: [], count: 0 }; }
  function units() {
    return sheetUnits().map(function (u) { return { name: u.name, q: u.q, src: 'sheet' }; })
      .concat(local().units.map(function (u) { return { name: u.name, q: u.q, src: 'local' }; }));
  }
  function setLocal(res) {
    if (!res || !res.count) ls(K.local, null);
    else ls(K.local, JSON.stringify({ at: Date.now(), units: res.units, count: res.count }));
    applyAll(); emit();
  }
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
  var roomUnits = [];
  function xtUnit(u) {
    return {
      id: (u.src === 'local' ? 'hl' : 'hc') + hash(u.name), hc: true, grade: '우리 반',
      name: (u.src === 'sheet' && className() ? className() + ' · ' : '') + u.name,
      q: u.q.map(function (x) {
        var n = x.o.length, at = parseInt(hash(x.q), 36) % n, a = x.o.slice(1);
        a.splice(at, 0, x.o[0]);
        return { q: x.q, a: a, c: at, e: x.e || '' };
      })
    };
  }
  function applyXT() {
    var X = window.XT_UNITS;
    if (!Array.isArray(X)) return;
    for (var i = X.length - 1; i >= 0; i--) if (X[i] && X[i].hc) X.splice(i, 1);
    var have = {};
    units().forEach(function (u) { var x = xtUnit(u); have[x.id] = 1; X.push(x); });
    roomUnits.forEach(function (x) { if (!have[x.id]) { have[x.id] = 1; X.push(Object.assign({ hc: 'room' }, x)); } });
  }
  /* 엑스탱크 선생님 방: 고른 '우리 반' 단원 문제를 학생 기기로 함께 보냄 */
  function pack(ids) {
    var X = window.XT_UNITS;
    if (!Array.isArray(X) || !ids) return null;
    // 중계 서버가 한 번에 64KB까지만 받아서, 문제는 약 40KB까지만 함께 보냄
    var out = [], size = 0, enc = new TextEncoder(), LIMIT = 40000;
    X.forEach(function (u) {
      if (!u.hc || ids.indexOf(u.id) < 0 || size > LIMIT) return;
      var qs = [];
      for (var i = 0; i < u.q.length; i++) { var len = enc.encode(JSON.stringify(u.q[i])).length + 1; if (size + len > LIMIT) { size = LIMIT + 1; break; } size += len; qs.push(u.q[i]); }
      if (qs.length) out.push({ id: u.id, grade: '우리 반', name: u.name, q: qs });
    });
    return out.length ? out : null;
  }
  function room(list) {
    if (!Array.isArray(list)) return;
    roomUnits = list.filter(function (u) { return u && u.id && Array.isArray(u.q); }).map(function (u) {
      return { id: String(u.id).slice(0, 20), grade: '우리 반', name: str(u.name).slice(0, 60), q: u.q.slice(0, 400).filter(function (q) { return q && q.q && Array.isArray(q.a); }) };
    });
    applyXT();
  }
  function applyAll() { try { applyXT(); } catch (e) {} }


  /* =================================================================
     엑셀(.xlsx)·CSV 읽기/쓰기 — 다른 라이브러리 없이 브라우저 기능만 씀
     ================================================================= */
  var HEAD = ['단원', '문제', '정답', '오답1', '오답2', '오답3', '해설'];
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function inflate(data) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('oldbrowser'));
    var ds = new DecompressionStream('deflate-raw');
    var out = new Blob([data]).stream().pipeThrough(ds);
    return new Response(out).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  function unzip(buf) {
    var b = new Uint8Array(buf), i, e = -1;
    for (i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
    if (e < 0) return Promise.reject(new Error('notzip'));
    var n = u16(b, e + 10), p = u32(b, e + 16), files = {};
    for (i = 0; i < n; i++) {
      if (u32(b, p) !== 0x02014b50) break;
      var method = u16(b, p + 10), csize = u32(b, p + 20), nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32), off = u32(b, p + 42);
      var name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
      var start = off + 30 + u16(b, off + 26) + u16(b, off + 28);
      files[name] = { method: method, data: b.subarray(start, start + csize) };
      p += 46 + nl + xl + cl;
    }
    return Promise.resolve(files);
  }
  function entryText(files, name) {
    var f = files[name];
    if (!f) return Promise.resolve(null);
    var p = f.method === 0 ? Promise.resolve(f.data) : f.method === 8 ? inflate(f.data) : Promise.reject(new Error('zipmethod'));
    return p.then(function (d) { return new TextDecoder('utf-8').decode(d); });
  }
  function xml(t) { return new DOMParser().parseFromString(t, 'application/xml'); }
  function tags(node, name) { return node.getElementsByTagNameNS('*', name); }
  function colNum(ref) { var m = /^([A-Z]+)/.exec(ref || ''), n = 0; if (!m) return -1; for (var i = 0; i < m[1].length; i++) n = n * 26 + m[1].charCodeAt(i) - 64; return n - 1; }
  function readXlsx(buf) {
    return unzip(buf).then(function (files) {
      return Promise.all([entryText(files, 'xl/workbook.xml'), entryText(files, 'xl/_rels/workbook.xml.rels'), entryText(files, 'xl/sharedStrings.xml')]).then(function (r) {
        if (!r[0]) throw new Error('notxlsx');
        var wb = xml(r[0]), rels = r[1] ? xml(r[1]) : null, sheets = tags(wb, 'sheet'), pick = sheets[0];
        for (var i = 0; i < sheets.length; i++) if (/문제/.test(sheets[i].getAttribute('name') || '')) { pick = sheets[i]; break; }
        var target = 'xl/worksheets/sheet1.xml';
        if (pick && rels) {
          var rid = pick.getAttribute('r:id') || pick.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
          var rl = tags(rels, 'Relationship');
          for (var j = 0; j < rl.length; j++) if (rl[j].getAttribute('Id') === rid) {
            var t = rl[j].getAttribute('Target').replace(/^\//, '');
            target = t.indexOf('xl/') === 0 ? t : 'xl/' + t; break;
          }
        }
        var shared = [];
        if (r[2]) { var si = tags(xml(r[2]), 'si'); for (var k = 0; k < si.length; k++) { var ts = tags(si[k], 't'), s = ''; for (var m = 0; m < ts.length; m++) s += ts[m].textContent; shared.push(s); } }
        return entryText(files, target).then(function (sx) {
          if (!sx) throw new Error('notxlsx');
          var rows = [], rs = tags(xml(sx), 'row');
          for (var a = 0; a < rs.length; a++) {
            var row = [], cs = tags(rs[a], 'c');
            for (var c = 0; c < cs.length; c++) {
              var cell = cs[c], ty = cell.getAttribute('t'), v = tags(cell, 'v')[0], val = '';
              if (ty === 's') val = v ? shared[+v.textContent] || '' : '';
              else if (ty === 'inlineStr') { var it = tags(cell, 't'); for (var z = 0; z < it.length; z++) val += it[z].textContent; }
              else if (ty === 'b') val = v && v.textContent === '1' ? 'O' : 'X';
              else val = v ? v.textContent : '';
              if (ty !== 's' && ty !== 'inlineStr' && ty !== 'str' && /^-?\d+\.\d{6,}$/.test(val)) val = String(+(+val).toFixed(6));
              var ci = colNum(cell.getAttribute('r')); if (ci < 0) ci = row.length;
              row[ci] = str(val);
            }
            var rn = +rs[a].getAttribute('r') || (rows.length + 1);
            rows[rn - 1] = Array.from(row, function (x) { return x || ''; });
          }
          return Array.from(rows, function (x) { return x || []; });
        });
      });
    });
  }
  function decodeText(buf) {
    var b = new Uint8Array(buf);
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
    if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return new TextDecoder('euc-kr').decode(b); } // 한글 엑셀이 저장한 CSV
  }
  function parseDelimited(text, sep) {
    if (!sep) { var first = text.split(/\r?\n/)[0] || ''; sep = first.indexOf('\t') >= 0 ? '\t' : ','; }
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
      if (ch === '"' && cur === '') { q = true; continue; }
      if (ch === sep) { row.push(cur); cur = ''; continue; }
      if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; continue; }
      cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.map(function (r) { return r.map(str); }).filter(function (r) { return r.some(Boolean); });
  }
  function readFile(file) {
    var name = (file && file.name || '').toLowerCase();
    if (/\.xls$/.test(name)) return Promise.reject(new Error('xls'));
    if (/\.(hwp|hwpx|docx?|pdf)$/.test(name)) return Promise.reject(new Error('notsheet'));
    return file.arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      if (b[0] === 0x50 && b[1] === 0x4B) return readXlsx(buf);
      if (b[0] === 0xD0 && b[1] === 0xCF) throw new Error('xls');
      return parseDelimited(decodeText(buf));
    });
  }
  /* 머리글이 없으면 '문제 | 정답 | 오답…' 순서로 봄 */
  function withHead(rows) {
    rows = (rows || []).filter(function (r) { return r && r.some(function (x) { return str(x); }); });
    if (!rows.length) return rows;
    var h = rows[0].map(function (x) { return str(x).replace(/\s/g, ''); });
    var known = h.some(function (x) { return /^(문제|질문|문항)$/.test(x); }) && h.some(function (x) { return /정답|^답$/.test(x); });
    if (known) return rows;
    return [['문제', '정답', '오답1', '오답2', '오답3', '해설']].concat(rows);
  }
  function rowsToQuestions(rows) { return toQuestions(withHead(rows)); }
  function errText(e) {
    var m = e && e.message;
    if (m === 'xls') return '예전 엑셀 파일(.xls)이에요. 엑셀에서 [다른 이름으로 저장] → "Excel 통합 문서(.xlsx)"로 저장한 뒤 올려 주세요.';
    if (m === 'notsheet') return '엑셀(.xlsx)이나 CSV 파일만 올릴 수 있어요. 한글·워드 표는 엑셀에 붙여 넣어 저장하거나, 칸을 복사해서 붙여 넣어 주세요.';
    if (m === 'oldbrowser') return '이 브라우저는 엑셀 파일을 못 읽어요. 크롬을 최신으로 바꾸거나, 엑셀에서 칸을 복사해 붙여 넣어 주세요.';
    return '파일을 읽지 못했어요. 엑셀에서 칸을 복사해서 붙여 넣어 보세요.';
  }

  /* --- .xlsx 만들기 (압축 없이 저장) --- */
  var CRC = (function () { var t = [], c; for (var n = 0; n < 256; n++) { c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(entries) {
    var enc = new TextEncoder(), parts = [], cen = [], off = 0;
    function le(n, l) { var a = []; for (var i = 0; i < l; i++) { a.push(n & 255); n = n >>> 8; } return a; }
    entries.forEach(function (e) {
      var name = enc.encode(e.name), data = enc.encode(e.text), crc = crc32(data);
      var head = [].concat(le(0x04034b50, 4), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(name.length, 2), le(0, 2));
      parts.push(new Uint8Array(head), name, data);
      cen.push(new Uint8Array([].concat(le(0x02014b50, 4), le(20, 2), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(name.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(off, 4))), name);
      off += head.length + name.length + data.length;
    });
    var cs = cen.reduce(function (a, x) { return a + x.length; }, 0);
    var end = new Uint8Array([].concat(le(0x06054b50, 4), le(0, 2), le(0, 2), le(entries.length, 2), le(entries.length, 2), le(cs, 4), le(off, 4), le(0, 2)));
    return new Blob(parts.concat(cen, [end]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function xesc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function colName(i) { var s = ''; i++; while (i) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }
  function xlsxBlob(rows) {
    var widths = [16, 46, 16, 16, 16, 16, 40];
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' +
      widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols><sheetData>' +
      rows.map(function (r, ri) { return '<row r="' + (ri + 1) + '">' + r.map(function (v, ci) { return '<c r="' + colName(ci) + (ri + 1) + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + xesc(v) + '</t></is></c>'; }).join('') + '</row>'; }).join('') +
      '</sheetData></worksheet>';
    return zip([
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="문제" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F5BFF"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
      { name: 'xl/worksheets/sheet1.xml', text: sheet }
    ]);
  }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function questionsToRows(list) {
    return [HEAD].concat(list.map(function (x) { return [x.u || '', x.q, x.o[0] || '', x.o[1] || '', x.o[2] || '', x.o[3] || '', x.e || '']; }));
  }
  function saveXlsx(list, name) { download(xlsxBlob(questionsToRows(list && list.length ? list : SAMPLE_Q)), name || '우리반_문제.xlsx'); }
  var SAMPLE_Q = [
    { u: '우리 반 1단원', q: '물이 얼면 무엇이 될까요?', o: ['얼음', '수증기', '구름', '이슬'], e: '물이 얼면 고체인 얼음이 돼요.' },
    { u: '우리 반 1단원', q: '물은 100도에서 끓는다. (O/X)', o: ['O', 'X'], e: '' }
  ];

  /* --- 게임 안 '우리 반 문제' 글칸 형식 --- */
  var FMT = {
    escape: {
      to: function (x) { return [x.q].concat(x.o).join(' | '); },
      from: function (t) { return t.split('\n').map(function (l) { return l.split('|').map(str); }).filter(function (a) { return a.length >= 3 && a[0] && a[1] && a[2]; }).map(function (a) { return { u: '', q: a[0], o: a.slice(1, 5).filter(Boolean), e: '' }; }); }
    },
    fortress: {
      to: function (x) { return [x.q].concat(x.o, ['1']).concat(x.e ? [x.e] : []).join('|'); },
      from: function (t) {
        var out = [];
        t.split('\n').map(str).filter(Boolean).forEach(function (line) {
          var p = line.split('|').map(str), e = '';
          if (p.length >= 4 && !/^\d+$/.test(p[p.length - 1])) e = p.pop();
          var ans = parseInt(p.pop(), 10), q = p.shift(), o = p.filter(Boolean);
          if (!q || o.length < 2 || o.length > 4 || !(ans >= 1 && ans <= o.length)) return;
          out.push({ u: '', q: q, o: [o[ans - 1]].concat(o.filter(function (_, i) { return i !== ans - 1; })), e: e });
        });
        return out;
      }
    }
  };

  /* =================================================================
     화면 조각: 버튼 줄(게임 글칸 옆) · 우리 반 문제 창
     ================================================================= */
  var cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    var st = document.createElement('style');
    st.textContent =
      '.hcx-bar{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px;align-items:center}' +
      '.hcx-bar button,.hcx-dlg button{font:inherit;font-size:13px;font-weight:700;cursor:pointer;border:1.5px solid currentColor;background:transparent;color:inherit;border-radius:6px;padding:5px 10px;line-height:1.3}' +
      '.hcx-bar .hcx-note{font-size:12px;opacity:.8;flex-basis:100%}' +
      '.hcx-back{position:fixed;inset:0;z-index:2147483000;background:rgba(8,10,18,.66);display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.hcx-dlg{background:#fff;color:#14171f;width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto;border-radius:14px;padding:22px;font-family:"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:15px;line-height:1.55;box-shadow:0 20px 60px rgba(0,0,0,.4);text-align:left}' +
      '.hcx-dlg h3{margin:0 0 4px;font-size:21px;font-weight:900;letter-spacing:-.02em}' +
      '.hcx-dlg .s{color:#5b6170;font-size:13px;margin:0 0 14px}' +
      '.hcx-dlg .now{background:#eef7f1;border:1.5px solid #11a36a;border-radius:8px;padding:9px 12px;font-size:14px;margin:0 0 14px}' +
      '.hcx-dlg .now.off{background:#f3f4f7;border-color:#d4d7de}' +
      '.hcx-dlg .row{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}' +
      '.hcx-dlg .main{background:#14171f!important;color:#fff!important;border-color:#14171f!important}' +
      '.hcx-dlg textarea{width:100%;min-height:86px;box-sizing:border-box;border:1.5px dashed #9aa1b2;border-radius:8px;padding:9px;font:inherit;font-size:13px;resize:vertical;background:#fafbfc;color:#14171f}' +
      '.hcx-dlg .msg{font-weight:700;font-size:14px;margin:8px 0;min-height:1.2em}.hcx-dlg .msg.bad{color:#d13d31}.hcx-dlg .msg.ok{color:#11a36a}' +
      '.hcx-dlg .pv{border:1.5px solid #e1e3e8;border-radius:8px;font-size:13px;margin:6px 0 10px;max-height:180px;overflow:auto}' +
      '.hcx-dlg .pv div{padding:6px 9px;border-bottom:1px solid #eef0f3}.hcx-dlg .pv div:last-child{border:0}.hcx-dlg .pv em{font-style:normal;color:#11a36a;font-weight:700}' +
      '.hcx-dlg .chips{display:flex;gap:5px;flex-wrap:wrap;margin:4px 0}.hcx-dlg .chips span{border:1px solid #d4d7de;border-radius:999px;padding:1px 9px;font-size:12px;font-weight:700}' +
      '.hcx-dlg .foot{display:flex;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap}' +
      '.hcx-dlg small{color:#6b7180}';
    document.head.appendChild(st);
  }
  function el(tag, attrs, html) { var e = document.createElement(tag); if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (html != null) e.innerHTML = html; return e; }
  function escH(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pickFile(cb) {
    var inp = el('input', { type: 'file', accept: '.xlsx,.csv,.tsv,.txt,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv' });
    inp.style.display = 'none'; document.body.appendChild(inp);
    inp.onchange = function () { var f = inp.files && inp.files[0]; inp.remove(); if (f) cb(f); };
    inp.click();
  }
  function templateUrl() { return BASE + 'teacher/question-template.xlsx'; }

  /* 게임의 '우리 반 문제' 글칸에 엑셀 버튼 붙이기 */
  function bindTextarea(ta, fmtName) {
    if (!ta || ta.__hcx) return; ta.__hcx = 1; css();
    var F = FMT[fmtName]; if (!F) return;
    var bar = el('div', { 'class': 'hcx-bar' });
    var up = el('button', { type: 'button' }, '엑셀 파일 올리기');
    var down = el('button', { type: 'button' }, '엑셀로 받기');
    var note = el('span', { 'class': 'hcx-note' }, '엑셀에서 칸을 복사해 이 칸에 붙여 넣어도 돼요.');
    bar.append(up, down, note);
    ta.insertAdjacentElement('afterend', bar);
    function put(res, how) {
      if (!res.count) { note.textContent = res.problem === 'header' ? "첫 줄에 '문제'와 '정답' 칸이 있어야 해요." : '넣을 수 있는 문제가 없어요.'; return; }
      var lines = res.units.reduce(function (a, u) { return a.concat(u.q); }, []).map(F.to).join('\n');
      var cur = ta.value.replace(/\s+$/, '');
      if (how === 'paste') {
        var s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + lines + ta.value.slice(e);
      } else ta.value = cur ? cur + '\n' + lines : lines;
      ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true }));
      note.textContent = res.count + '문제를 넣었어요' + (res.skipped.length ? ' (정답·오답이 빈 ' + res.skipped.length + '줄은 뺐어요)' : '') + '. 저장을 눌러야 적용돼요.';
    }
    up.onclick = function () { pickFile(function (f) { note.textContent = '읽는 중…'; readFile(f).then(function (rows) { put(rowsToQuestions(rows), 'file'); }).catch(function (e) { note.textContent = errText(e); }); }); };
    down.onclick = function () {
      var list = F.from(ta.value);
      saveXlsx(list, list.length ? '우리반_문제.xlsx' : '우리반_문제양식.xlsx');
      note.textContent = list.length ? list.length + '문제를 엑셀로 받았어요.' : '아직 문제가 없어서 빈 양식을 받았어요.';
    };
    ta.addEventListener('paste', function (e) {
      var t = e.clipboardData && e.clipboardData.getData('text/plain');
      if (!t || t.indexOf('\t') < 0) return;
      e.preventDefault(); put(rowsToQuestions(parseDelimited(t, '\t')), 'paste');
    });
  }

  /* 우리 반 문제 창 (엑스탱크·과학섬·현게임에서 엶) — 이 기기에 저장 */
  function openEditor(opt) {
    opt = opt || {}; css();
    var back = el('div', { 'class': 'hcx-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': '우리 반 문제 넣기' });
    var d = el('div', { 'class': 'hcx-dlg' });
    back.appendChild(d); document.body.appendChild(back);
    var pending = null;
    function close() { back.remove(); document.removeEventListener('keydown', onKey, true); if (opt.onClose) try { opt.onClose(); } catch (e) {} }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } else e.stopPropagation(); }
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    function render(msg, cls) {
      var L = local(), sc = cache(), sn = sc ? sc.count : 0;
      d.innerHTML =
        '<h3>우리 반 문제 넣기</h3><p class="s">엑셀 파일을 올리거나, 엑셀에서 칸을 복사해 붙여 넣으세요. 이 기기에 저장돼서 이 기기의 게임에 나와요.</p>' +
        '<div class="now' + (L.count || sn ? '' : ' off') + '">' +
          (L.count ? '이 기기에 넣은 문제 <b>' + L.count + '개</b> (단원 ' + L.units.length + '개)' : '이 기기에 넣은 문제는 아직 없어요.') +
          (sn ? '<br>구글 시트에서 온 문제 <b>' + sn + '개</b>도 함께 나와요.' : '') + '</div>' +
        '<div class="row"><button type="button" class="main" data-a="up">엑셀 파일 올리기</button><button type="button" data-a="tpl">빈 양식 받기</button>' +
          (L.count ? '<button type="button" data-a="down">넣은 문제 엑셀로 받기</button><button type="button" data-a="clear">모두 지우기</button>' : '') + '</div>' +
        '<textarea placeholder="엑셀에서 칸을 복사해 여기에 Ctrl+V&#10;칸 순서: 단원 | 문제 | 정답 | 오답1 | 오답2 | 오답3 | 해설"></textarea>' +
        '<p class="msg ' + (cls || '') + '">' + (msg || '') + '</p><div class="pvbox"></div>' +
        '<div class="foot"><small>반 전체 기기에 나눠 주려면 현게임 [선생님]에서 구글 시트를 연결하세요.</small><button type="button" data-a="close">닫기</button></div>';
      d.querySelector('textarea').addEventListener('paste', function (e) {
        var t = e.clipboardData && e.clipboardData.getData('text/plain'); if (!t) return;
        e.preventDefault(); show(rowsToQuestions(parseDelimited(t, t.indexOf('\t') >= 0 ? '\t' : '|')));
      });
      d.querySelector('textarea').addEventListener('change', function () { var t = this.value; if (t.trim()) show(rowsToQuestions(parseDelimited(t, t.indexOf('\t') >= 0 ? '\t' : '|'))); });
    }
    function show(res) {
      var box = d.querySelector('.pvbox'), m = d.querySelector('.msg');
      if (!res.count) { pending = null; box.innerHTML = ''; m.className = 'msg bad'; m.textContent = res.problem === 'header' ? "첫 줄에 '문제'와 '정답' 칸이 있어야 해요." : '읽을 수 있는 문제가 없어요. 정답과 오답(1개 이상)이 있는지 봐 주세요.'; return; }
      pending = res; var L = local(), all = res.units.reduce(function (a, u) { return a.concat(u.q); }, []);
      m.className = 'msg ok'; m.textContent = res.count + '문제를 읽었어요' + (res.skipped.length ? ' · 정답·오답이 빈 ' + res.skipped.length + '줄은 빼요' : '');
      box.innerHTML = '<div class="chips">' + res.units.map(function (u) { return '<span>' + escH(u.name) + ' · ' + u.q.length + '</span>'; }).join('') + '</div>' +
        '<div class="pv">' + all.slice(0, 5).map(function (x) { return '<div>' + escH(x.q) + '<br><em>✓ ' + escH(x.o[0]) + '</em> <small>· ' + x.o.slice(1).map(escH).join(' · ') + '</small></div>'; }).join('') + (all.length > 5 ? '<div><small>…외 ' + (all.length - 5) + '문제</small></div>' : '') + '</div>' +
        '<div class="row">' + (L.count ? '<button type="button" class="main" data-a="replace">원래 문제 지우고 이걸로</button><button type="button" data-a="add">원래 문제에 더하기</button>' : '<button type="button" class="main" data-a="replace">이 문제로 저장</button>') + '</div>';
    }
    function merge(a, b) {
      var map = {}, order = [];
      a.units.concat(b.units).forEach(function (u) { if (!map[u.name]) { map[u.name] = []; order.push(u.name); } map[u.name] = map[u.name].concat(u.q); });
      var units = order.map(function (n) { return { name: n, q: map[n] }; });
      return { units: units, count: units.reduce(function (s, u) { return s + u.q.length; }, 0) };
    }
    d.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; var a = b.getAttribute('data-a');
      if (a === 'close') close();
      else if (a === 'tpl') saveXlsx(SAMPLE_Q, '우리반_문제양식.xlsx');
      else if (a === 'down') saveXlsx(local().units.reduce(function (x, u) { return x.concat(u.q.map(function (q) { return Object.assign({ u: u.name }, q); })); }, []), '우리반_문제.xlsx');
      else if (a === 'clear') { if (confirm('이 기기에 넣은 우리 반 문제를 모두 지울까요?')) { setLocal(null); render('지웠어요.', 'ok'); } }
      else if (a === 'up') pickFile(function (f) { var m = d.querySelector('.msg'); m.className = 'msg'; m.textContent = '읽는 중…'; readFile(f).then(function (rows) { show(rowsToQuestions(rows)); }).catch(function (er) { m.className = 'msg bad'; m.textContent = errText(er); }); });
      else if ((a === 'replace' || a === 'add') && pending) {
        var res = a === 'add' ? merge(local(), pending) : pending;
        setLocal(res); pending = null;
        render('저장했어요! 문제 ' + res.count + '개가 이 기기의 게임에 나와요.' + (opt.hint ? ' ' + opt.hint : ''), 'ok');
      }
    });
    render();
    setTimeout(function () { var f = d.querySelector('[data-a="up"]'); if (f) f.focus(); }, 30);
  }

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
    apply: applyAll, local: local, setLocal: setLocal, pack: pack, room: room,
    readFile: readFile, parseTable: parseDelimited, rowsToQuestions: rowsToQuestions, saveXlsx: saveXlsx, xlsxBlob: xlsxBlob,
    bindTextarea: bindTextarea, openEditor: openEditor, errText: errText
  };

  applyAll();
  if (code()) {
    var age = (cache() || {}).at || 0;
    // 페이지를 열 때마다 새로 읽어 오되, 막 읽었으면(30초 안) 건너뜀
    if (Date.now() - age > 30000) setTimeout(function () { refresh().catch(function () {}); }, 50);
    setTimeout(function () { flush(); }, 3000);
  }
})();
