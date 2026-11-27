/* 현게임 '학생 의견' 버튼 — 오락실(arcade_site/public/hyun_feedback.js, 주소 /arcade/hyun_feedback.js)
 *
 * 게임 파일은 고치지 않아요. 오락실 배포 때와 10분마다 서버가 게임 index.html 맨 끝에 한 줄을 넣어요
 * (deploy/inject_copyright.py 의 FEEDBACK 목록):
 *   <script src="/arcade/hyun_feedback.js" data-game="내 옷장을 부탁해" defer></script><!-- hyun-feedback -->
 *   위치를 바꾸려면 data-side="right" data-top="40%"  (기본: 왼쪽 가장자리, 화면 높이 45%)
 *
 * 학생이 보낸 글은 현게임 카드의 '후기·Q&A' 창에 쌓여요 (🧒 학생 표시, '학생' 버튼으로 모아 보기).
 *   ⭐ 별점 주기   → 후기 탭      ❓ 궁금해요 → Q&A 탭      🛠️ 바꿔 주세요 → 바꿔 주세요 탭
 * 이름 칸은 없어요. 모두 '학생'으로 올라가요 (아이 이름이 공개 게시판에 남지 않게).
 *
 * 버튼 모양: 화면 왼쪽 가장자리에 붙은 작은 노란 탭(말풍선 + '학생 의견').
 *   - 평소엔 접혀 있고, 마우스를 올리면 '학생 의견 보내기'로 펼쳐져요.
 *   - 게임을 켤 때 3초 동안 펼쳐졌다 접혀요. 게임에서 HyunFeedback.peek() 을 부르면 또 3초 펼쳐져요.
 *   - 의견 창에서 글을 쓰는 동안 키보드가 게임으로 넘어가지 않아요 (E·F·방향키 등).
 */
(function () {
  if (window.HyunFeedback) return;
  var SRV = /duckdns\.org$|hyungame\.com$/.test(location.hostname) ? location.origin : "https://hyungame.com";
  var API = SRV + "/arcade/api/board/post";
  var ME = document.currentScript;
  var opt = { game: "", dry: false };
  var KIND = {
    r: { icon: "⭐", t: "별점 주기", s: "이 게임 몇 점이야?", ph: "어떤 점이 좋았어? (안 써도 돼요)", send: "별점 보내기" },
    q: { icon: "❓", t: "궁금해요", s: "모르는 게 있으면 물어봐요", ph: "예) 별조각은 어디에 써요?", send: "질문 보내기" },
    i: { icon: "🛠️", t: "바꿔 주세요", s: "이렇게 되면 더 재밌겠어요", ph: "예) 캐릭터 색깔을 고를 수 있으면 좋겠어요", send: "의견 보내기" }
  };
  var FACE = ["", "😣 별로예요", "😕 아쉬워요", "🙂 괜찮아요", "😄 재밌어요", "🤩 최고예요"];
  var S = { k: null, star: 0 };

  var CSS =
    ".hf-btn{position:fixed;top:var(--hf-top,45%);left:0;z-index:2147482500;display:flex;align-items:center;gap:0;min-height:58px;padding:6px 9px 6px 7px;border:0;border-radius:0 14px 14px 0;background:#ffd23f;color:#14171f;font:800 14px 'Noto Sans KR','Malgun Gothic',sans-serif;box-shadow:2px 4px 14px -4px rgba(0,0,0,.45),inset -2px 0 0 rgba(0,0,0,.08);cursor:pointer;opacity:.92;transform:translateY(-50%);transition:opacity .2s,padding .25s}" +
    ".hf-btn.r{left:auto;right:0;border-radius:14px 0 0 14px;padding:0 8px 0 10px;flex-direction:row-reverse}" +
    ".hf-btn i{font-style:normal;font-size:20px;line-height:1;display:block;width:22px;text-align:center}" +
    ".hf-btn small{display:block;font-size:10.5px;font-weight:900;line-height:1.1;letter-spacing:-.3px}.hf-btn i+small{margin-top:3px}" +
    ".hf-btn .hf-ic{display:flex;flex-direction:column;align-items:center}" +
    ".hf-btn .hf-lb{max-width:0;overflow:hidden;white-space:nowrap;transition:max-width .3s ease,margin .3s;margin:0}" +
    ".hf-btn:hover,.hf-btn:focus-visible,.hf-btn.peek{opacity:1;outline:none}" +
    ".hf-btn:hover .hf-lb,.hf-btn:focus-visible .hf-lb,.hf-btn.peek .hf-lb{max-width:140px;margin:0 4px 0 8px}" +
    ".hf-btn.r:hover .hf-lb,.hf-btn.r.peek .hf-lb{margin:0 8px 0 4px}" +
    "@media(prefers-reduced-motion:reduce){.hf-btn,.hf-btn .hf-lb{transition:none}}" +
    ".hf-bg{position:fixed;inset:0;z-index:2147483100;background:rgba(17,20,28,.55);display:grid;place-items:center;padding:14px;font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif}" +
    ".hf{width:min(440px,100%);max-height:calc(100vh - 28px);overflow:auto;background:#fff;color:#14171f;border-radius:22px;padding:20px;box-shadow:0 20px 50px -16px rgba(0,0,0,.5)}" +
    ".hf-top{display:flex;align-items:center;gap:8px;margin-bottom:14px}.hf-h{font-weight:900;font-size:20px;line-height:1.25}.hf-g{font-size:13px;color:#6b7180}" +
    ".hf-x,.hf-back{flex:none;width:40px;height:40px;border:0;border-radius:12px;background:#eef1f6;color:#6b7180;font-size:18px;cursor:pointer}.hf-x{margin-left:auto}" +
    ".hf-pick{display:grid;gap:10px}" +
    ".hf-k{display:flex;align-items:center;gap:14px;width:100%;min-height:72px;padding:12px 16px;border:2px solid #d9dce3;border-radius:16px;background:#fff;text-align:left;cursor:pointer;font:inherit;color:inherit}" +
    ".hf-k:hover,.hf-k:focus-visible{border-color:#2f5bff;outline:none;background:#f5f7ff}" +
    ".hf-k i{font-style:normal;font-size:30px;flex:none}.hf-k b{display:block;font-size:17px}.hf-k span{font-size:13.5px;color:#6b7180}" +
    ".hf-stars{display:flex;justify-content:center;gap:4px;margin:4px 0 2px}" +
    ".hf-stars button{width:52px;height:52px;border:0;background:none;font-size:42px;line-height:1;color:#d9dce3;cursor:pointer;transition:transform .12s}" +
    ".hf-stars button.on{color:#ffb800}.hf-stars button:active{transform:scale(1.2)}" +
    ".hf-face{text-align:center;font-weight:800;font-size:16px;min-height:24px;margin-bottom:10px}" +
    ".hf textarea{width:100%;min-height:96px;resize:vertical;border:2px solid #d9dce3;border-radius:14px;padding:12px;font:16px/1.5 inherit;font-family:inherit;box-sizing:border-box}" +
    ".hf textarea:focus{outline:none;border-color:#2f5bff}" +
    ".hf-cnt{text-align:right;font-size:12px;color:#6b7180;margin:4px 2px 10px}" +
    ".hf-send{width:100%;min-height:52px;border:0;border-radius:14px;background:#14171f;color:#fff;font:800 17px inherit;font-family:inherit;cursor:pointer}" +
    ".hf-send:disabled{background:#d9dce3;color:#fff;cursor:default}" +
    ".hf-note{font-size:12.5px;color:#6b7180;text-align:center;margin-top:10px;line-height:1.5}" +
    ".hf-msg{color:#e2483d;font-weight:700;font-size:14px;text-align:center;min-height:20px;margin-top:8px}" +
    ".hf-done{text-align:center;padding:18px 4px 6px}.hf-done i{font-style:normal;font-size:56px;display:block}.hf-done b{display:block;font-size:20px;margin:8px 0 4px}.hf-done p{margin:0 0 16px;color:#6b7180}";

  function css() { if (document.getElementById("hf-css")) return; var s = document.createElement("style"); s.id = "hf-css"; s.textContent = CSS; document.head.appendChild(s); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var peekT;
  function peek() {
    var b = document.getElementById("hf-btn"); if (!b) return;
    b.classList.add("peek"); clearTimeout(peekT);
    peekT = setTimeout(function () { b.classList.remove("peek"); }, 3000);
  }
  function close() { var r = document.getElementById("hf-root"); if (r) r.remove(); }

  function shell(inner, back) {
    close(); css();
    var bg = document.createElement("div"); bg.className = "hf-bg"; bg.id = "hf-root";
    bg.innerHTML = '<div class="hf" role="dialog" aria-label="학생 의견">' +
      '<div class="hf-top">' + (back ? '<button class="hf-back" aria-label="뒤로">←</button>' : '') +
      '<div><div class="hf-h">' + inner.h + '</div><div class="hf-g">' + esc(opt.game) + '</div></div>' +
      '<button class="hf-x" aria-label="닫기">✕</button></div>' + inner.body + '</div>';
    (document.body || document.documentElement).appendChild(bg);
    /* 의견 창 안에서 누른 키는 게임으로 보내지 않아요 (글 쓰다가 탱크가 움직이지 않게) */
    ["keydown", "keyup", "keypress"].forEach(function (ev) { bg.addEventListener(ev, function (e) { e.stopPropagation(); if (e.key === "Escape") close(); }); });
    bg.querySelector(".hf-x").onclick = close;
    bg.addEventListener("click", function (e) { if (e.target === bg) close(); });
    if (back) bg.querySelector(".hf-back").onclick = pick;
    return bg;
  }

  function pick() {
    var bg = shell({
      h: "🧒 학생 의견 보내기",
      body: '<div class="hf-pick">' + ["r", "q", "i"].map(function (k) {
        return '<button class="hf-k" data-k="' + k + '"><i>' + KIND[k].icon + '</i><div><b>' + KIND[k].t + '</b><span>' + KIND[k].s + '</span></div></button>';
      }).join("") + '</div><p class="hf-note">이 게임을 해 본 <b>여러분의 생각</b>을 들려주세요!<br>이름은 안 남아요. 게임을 만든 선생님이 읽고 고쳐요.</p>'
    });
    [].forEach.call(bg.querySelectorAll(".hf-k"), function (b) { b.onclick = function () { write(b.dataset.k); }; });
  }

  function write(k) {
    S.k = k; S.star = 0; var K = KIND[k];
    var bg = shell({
      h: K.icon + " " + K.t,
      body: (k === "r" ? '<div class="hf-stars">' + [1, 2, 3, 4, 5].map(function (n) { return '<button data-s="' + n + '" aria-label="별 ' + n + '개">★</button>'; }).join("") + '</div><div class="hf-face">별을 눌러 줘요</div>' : '') +
        '<textarea maxlength="200" placeholder="' + esc(K.ph) + '"></textarea><div class="hf-cnt">0 / 200</div>' +
        '<button class="hf-send"' + (k === "r" ? " disabled" : "") + '>' + K.send + '</button><div class="hf-msg"></div>' +
        '<p class="hf-note">친구 이름, 전화번호, 나쁜 말은 쓰지 않아요.</p>'
    }, true);
    var ta = bg.querySelector("textarea"), send = bg.querySelector(".hf-send");
    ta.oninput = function () { bg.querySelector(".hf-cnt").textContent = ta.value.length + " / 200"; if (k !== "r") send.disabled = !ta.value.trim(); };
    if (k !== "r") send.disabled = true;
    [].forEach.call(bg.querySelectorAll(".hf-stars button"), function (b) {
      b.onclick = function () {
        S.star = +b.dataset.s;
        [].forEach.call(bg.querySelectorAll(".hf-stars button"), function (x) { x.classList.toggle("on", +x.dataset.s <= S.star); });
        bg.querySelector(".hf-face").textContent = FACE[S.star]; send.disabled = false;
      };
    });
    send.onclick = function () { submit(ta.value.trim(), bg, send); };
    setTimeout(function () { if (k !== "r") ta.focus(); }, 50);
  }

  function submit(text, bg, send) {
    var k = S.k, msg = bg.querySelector(".hf-msg");
    if (k === "r" && !text) text = FACE[S.star].replace(/^\S+\s/, "");        /* 별점만 눌러도 '재밌어요' 같은 한마디로 올라가요 */
    var body = { g: opt.game, k: k, who: "s", name: "학생", text: text, stars: k === "r" ? S.star : 0 };
    var last = 0; try { last = +localStorage.getItem("hf-posted") || 0; } catch (e) {}
    var wait = Math.ceil(20 - (Date.now() - last) / 1000);           /* 한 기기에서 연달아 보내지 않게 */
    if (wait > 0 && !opt.dry) { msg.textContent = wait + "초 뒤에 다시 보낼 수 있어요"; return; }
    send.disabled = true; msg.textContent = "";
    var go = opt.dry ? Promise.resolve({ ok: true }) :
      fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" }).then(function (r) { return r.json(); });
    go.then(function (j) {
      if (!j.ok) { msg.textContent = j.error || "보내지 못했어요. 조금 있다 다시 해 줘요"; send.disabled = false; return; }
      try { localStorage.setItem("hf-posted", Date.now()); } catch (e) {}
      shell({
        h: "보냈어요!",
        body: '<div class="hf-done"><i>' + (k === "r" ? "💛" : k === "q" ? "📮" : "🔧") + '</i><b>고마워요!</b><p>' +
          (k === "r" ? "별점이 현게임 후기에 올라갔어요." : k === "q" ? "선생님이 현게임에 답을 달아 줄 거예요." : "게임을 고칠 때 꼭 볼게요.") +
          '</p><button class="hf-send">게임으로 돌아가기</button></div>'
      });
      document.querySelector("#hf-root .hf-send").onclick = close;
    }).catch(function () { msg.textContent = "인터넷이 잠깐 끊겼어요. 다시 눌러 줘요"; send.disabled = false; });
  }

  window.HyunFeedback = {
    button: function (o) {
      opt = Object.assign(opt, o || {}); css();
      if (document.getElementById("hf-btn")) return;
      var b = document.createElement("button"); b.id = "hf-btn"; b.className = "hf-btn" + (opt.side === "right" ? " r" : "");
      b.type = "button"; b.setAttribute("aria-label", "학생 의견 보내기");
      if (opt.top) b.style.setProperty("--hf-top", opt.top);
      b.innerHTML = '<span class="hf-ic"><i>💬</i><small>학생</small><small>의견</small></span><span class="hf-lb">학생 의견 보내기</span>';
      b.onclick = function () { b.blur(); pick(); };           /* 스페이스·엔터가 버튼을 다시 누르지 않게 */
      b.addEventListener("keydown", function (e) { e.stopPropagation(); });
      document.body.appendChild(b);
      peek();
    },
    peek: peek,
    open: function (o) { opt = Object.assign(opt, o || {}); pick(); },
    write: function (k, o) { opt = Object.assign(opt, o || {}); write(k); },
    close: close
  };
  /* 서버가 넣은 <script data-game="…"> 이면 저절로 버튼을 달아요 */
  if (ME && ME.dataset && ME.dataset.game) {
    var go = function () { window.HyunFeedback.button({ game: ME.dataset.game, side: ME.dataset.side, top: ME.dataset.top }); };
    if (document.body) go(); else document.addEventListener("DOMContentLoaded", go);
  }
})();
