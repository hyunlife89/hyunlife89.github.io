/* =====================================================================
   현게임 기록 잇기 (hg_sync.js) — 초등섬 기록을 주소 사이에서 옮겨요
   현게임 주소가 여러 개라(hyungame.com · hyungame.duckdns.org · hyunstock.duckdns.org)
   브라우저는 주소마다 기록을 따로 보관해요. 이 주소에 초등섬 기록이 없으면
   기록이 있는 다른 주소에 잠깐 다녀와서 기록을 복사해 와요 (한 번만).
   © 현게임
   ===================================================================== */
(function () {
  'use strict';
  var DOMAINS = ['hyungame.com', 'hyungame.duckdns.org', 'hyunstock.duckdns.org'];
  var KEY = 'scienceIsland' + '.v1';            // 초등섬 기록
  var CARRY = /^scienceIsland/;                 // 함께 옮길 기록 이름
  var FLAG = 'hgsync.tried';
  var host = location.hostname.replace(/^www\./, '');
  if (DOMAINS.indexOf(host) < 0) return;        // 내 컴퓨터 시험 주소 등은 건너뜀
  function ls() { try { return window.localStorage; } catch (e) { return null; } }
  var L = ls(); if (!L) return;
  function has() { try { var v = L.getItem(KEY); return !!(v && v.length > 2); } catch (e) { return false; } }
  function others() { return DOMAINS.filter(function (d) { return d !== host; }); }
  function syncURL(d, back, tried) {
    return 'https://' + d + '/arcade/sync.html?back=' + encodeURIComponent(back) + '&tried=' + encodeURIComponent(tried);
  }

  // ① 다른 주소에서 기록을 들고 돌아왔을 때
  var m = /[#&]hgsync=([^&]*)/.exec(location.hash);
  if (m) {
    var got = 0;
    if (m[1] !== 'none') {
      try {
        var data = JSON.parse(decodeURIComponent(m[1]));
        if (!has()) for (var k in data) if (CARRY.test(k) && typeof data[k] === 'string') { L.setItem(k, data[k]); got++; }
      } catch (e) { }
    }
    try { L.setItem(FLAG, String(Date.now())); } catch (e) { }
    var clean = location.hash.replace(/[#&]?hgsync=[^&]*/, '');
    try { history.replaceState(null, '', location.pathname + location.search + (clean && clean !== '#' ? clean : '')); } catch (e) { }
    if (got) { location.reload(); return; }
  }

  function go(manual) {
    var list = others(); if (!list.length) return false;
    try { L.setItem(FLAG, String(Date.now())); } catch (e) { }
    var back = location.href.split('#')[0];
    // 그 주소가 열리는 학교인지 먼저 살짝 확인 (막힌 학교에서 오류 화면이 뜨지 않게)
    var tryAt = function (i) {
      if (i >= list.length) { if (manual) alert('다른 현게임 주소에 연결할 수 없어요. (학교에서 막혀 있을 수 있어요)'); return; }
      var done = false, d = list[i];
      var t = setTimeout(function () { if (!done) { done = true; tryAt(i + 1); } }, 3500);
      fetch('https://' + d + '/arcade/hg_sync.js?ping=' + Date.now(), { mode: 'no-cors', cache: 'no-store' })
        .then(function () { if (done) return; done = true; clearTimeout(t); location.href = syncURL(d, back, host); })
        .catch(function () { if (done) return; done = true; clearTimeout(t); tryAt(i + 1); });
    };
    tryAt(0);
    return true;
  }

  // 게임에서 버튼으로 부를 수 있게
  window.HGSYNC = { has: has, pull: function () { return go(true); } };

  // ② 이 주소에 기록이 없으면 한 번만 자동으로 가져오기 (실패했으면 3일 동안 다시 안 함)
  if (has() || m) return;
  var last = 0; try { last = +L.getItem(FLAG) || 0; } catch (e) { }
  if (Date.now() - last < 3 * 864e5) return;
  if (window.top !== window.self) return;
  go(false);
})();
