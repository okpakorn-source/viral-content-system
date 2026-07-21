/* ============================================================
 * liveFeed.js — โมดูลกลาง "คลังกิจกรรมสด" ใช้ร่วมทั้ง 3 ออฟฟิศ (สนง.ใหญ่/โต๊ะข่าว/วิศวะ)
 * ดีไซน์เดียวกัน อ่านง่าย สบายตา + คลิกการ์ดดูรายละเอียดเต็ม (มติ/โหวต/สถิติรอบ)
 * ดึงสดจาก /api/company/feed?scope=<scope> ทุก ~8 วิ → ทุกเครื่องเห็นตรงกันเรียลไทม์
 * ES2018-safe (ไม่มี ?. ?? replaceAll) — Safari/มือถือ OK · ไม่มี dependency
 *
 * ใช้งาน:  initLiveFeed({ scope:'newsdesk', mounts:{comm:'commLive', worklog:'worklogLive', board:'boardLive'} })
 * ============================================================ */
(function () {
  'use strict';
  if (window.__liveFeedLoaded) { return; }
  window.__liveFeedLoaded = true;

  var NAMES = {
    owner: 'เจ้าของ', ton: 'ต้น', mod: 'มด', ken: 'เคน', nin: 'นิน', meen: 'มีน', fah: 'ฟ้า', jo: 'โจ', rin: 'ริน',
    phupha: 'ภูผา', oat: 'โอ๊ต', sun: 'ซัน', hai: 'ฮาย', sol: 'โซล', terra: 'เทอร่า', luna: 'ลูน่า',
    arch: 'อาร์ค', beck: 'เบค', fon: 'ฝน', qa: 'คิว', rev: 'เรฟ', zip: 'ซิป'
  };
  var KIND = {
    chat:     { icon: '💬', label: 'คุย',      color: '#f0b64a' },
    comm:     { icon: '📨', label: 'สื่อสาร',  color: '#6ea8ff' },
    decision: { icon: '🗳️', label: 'มติ',      color: '#c58cff' },
    worklog:  { icon: '📝', label: 'สมุดงาน',  color: '#4fd08a' },
    result:   { icon: '🎯', label: 'ผลงาน',    color: '#b98cff' },
    status:   { icon: '🟢', label: 'สถานะ',    color: '#4fd08a' }
  };
  var OWNER_COLOR = '#ff8fb0';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function timeAgo(ts) {
    var t = Number(ts) || 0;
    if (!t) { return ''; }
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) { return s + ' วิ'; }
    var m = Math.round(s / 60);
    if (m < 60) { return m + ' นาที'; }
    var h = Math.round(m / 60);
    if (h < 24) { return h + ' ชม.'; }
    return Math.round(h / 24) + ' วัน';
  }
  function nameOf(agent) {
    if (!agent) { return 'ระบบ'; }
    return NAMES[agent] || ('@' + agent);
  }
  function kindOf(kind) { return KIND[kind] || KIND.comm; }

  /* ---------- inject styles (ครั้งเดียว) ---------- */
  function injectCss() {
    if (document.getElementById('lf-css')) { return; }
    var css = ''
      + '.lf-list{display:flex;flex-direction:column;gap:8px;}'
      + '.lf-card{position:relative;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.035);'
      + 'border:1px solid rgba(255,255,255,.05);border-left:3px solid var(--lf-c,#6ea8ff);'
      + 'animation:lfIn .34s ease;transition:background .15s,transform .12s;}'
      + '.lf-card.lf-click{cursor:pointer;}'
      + '.lf-card.lf-click:hover{background:rgba(255,255,255,.075);transform:translateY(-1px);}'
      + '.lf-card.lf-click:active{transform:translateY(0);}'
      + '@keyframes lfIn{from{opacity:0;transform:translateY(-5px);}to{opacity:1;transform:none;}}'
      + '.lf-top{display:flex;align-items:center;gap:7px;margin-bottom:3px;}'
      + '.lf-ic{font-size:.92rem;line-height:1;}'
      + '.lf-name{font-weight:800;font-size:.82rem;color:#f0f4fa;}'
      + '.lf-tag{font-size:.63rem;font-weight:700;color:var(--lf-c,#6ea8ff);border:1px solid;border-color:var(--lf-c,#6ea8ff);'
      + 'opacity:.85;border-radius:20px;padding:0 7px;line-height:1.5;}'
      + '.lf-time{margin-left:auto;font-size:.67rem;color:#8b97a8;white-space:nowrap;}'
      + '.lf-text{font-size:.84rem;line-height:1.55;color:#d7dee9;word-break:break-word;'
      + 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}'
      + '.lf-more{margin-top:5px;font-size:.7rem;font-weight:700;color:var(--lf-c,#6ea8ff);opacity:.9;}'
      + '.lf-empty{font-size:.76rem;color:#8b97a8;padding:8px 2px;opacity:.8;}'
      /* modal */
      + '.lf-ov{position:fixed;inset:0;z-index:9999;background:rgba(4,7,12,.68);backdrop-filter:blur(3px);'
      + 'display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;pointer-events:none;transition:opacity .18s;}'
      + '.lf-ov.open{opacity:1;pointer-events:auto;}'
      + '.lf-sheet{width:100%;max-width:540px;max-height:82vh;overflow:auto;background:#161c28;'
      + 'border:1px solid rgba(255,255,255,.08);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.5);'
      + 'transform:translateY(12px) scale(.98);transition:transform .2s;}'
      + '.lf-ov.open .lf-sheet{transform:none;}'
      + '.lf-sh-head{display:flex;align-items:center;gap:9px;padding:16px 18px 12px;border-bottom:1px solid rgba(255,255,255,.07);position:sticky;top:0;background:#161c28;}'
      + '.lf-sh-ic{font-size:1.35rem;}'
      + '.lf-sh-name{font-weight:800;font-size:1rem;color:#f0f4fa;}'
      + '.lf-sh-sub{font-size:.7rem;color:#8b97a8;margin-top:1px;}'
      + '.lf-sh-x{margin-left:auto;width:34px;height:34px;border:0;border-radius:10px;cursor:pointer;'
      + 'background:rgba(255,255,255,.07);color:#cfd8e6;font-size:1.1rem;line-height:1;}'
      + '.lf-sh-x:hover{background:rgba(255,255,255,.14);}'
      + '.lf-sh-body{padding:16px 18px 20px;}'
      + '.lf-sh-text{font-size:.95rem;line-height:1.7;color:#e4eaf3;white-space:pre-wrap;word-break:break-word;}'
      + '.lf-sh-sec{margin-top:16px;}'
      + '.lf-sh-sec h4{font-size:.72rem;font-weight:800;color:#9fb0c6;margin:0 0 8px;text-transform:uppercase;letter-spacing:.4px;}'
      + '.lf-vote{padding:9px 12px;border-radius:11px;background:rgba(255,255,255,.04);border-left:3px solid #c58cff;margin-bottom:7px;}'
      + '.lf-vote b{color:#f0f4fa;font-size:.82rem;}'
      + '.lf-vote span{display:block;font-size:.84rem;color:#d7dee9;line-height:1.5;margin-top:2px;}'
      + '.lf-kv{display:flex;flex-wrap:wrap;gap:8px;}'
      + '.lf-kv .lf-chip{font-size:.78rem;color:#dbe2f0;background:rgba(255,255,255,.05);border-radius:9px;padding:6px 11px;}'
      + '.lf-kv .lf-chip b{color:#fff;}'
      + '@media(max-width:560px){.lf-ov{align-items:flex-end;padding:0;}.lf-sheet{max-width:none;max-height:88vh;'
      + 'border-radius:20px 20px 0 0;transform:translateY(100%);}.lf-ov.open .lf-sheet{transform:none;}}'
      /* ---- ธีมสว่าง (ออฟฟิศใหญ่) : override สีให้อ่านง่ายบนพื้นครีม ---- */
      + '.lf-theme-light .lf-card{background:rgba(0,0,0,.028);border-color:rgba(0,0,0,.07);}'
      + '.lf-theme-light .lf-card.lf-click:hover{background:rgba(0,0,0,.055);}'
      + '.lf-theme-light .lf-name{color:#2a2118;}'
      + '.lf-theme-light .lf-text{color:#4a4033;}'
      + '.lf-theme-light .lf-time,.lf-theme-light .lf-empty{color:#9a8f7e;}'
      + '.lf-ov.lf-theme-light{background:rgba(60,45,25,.4);}'
      + '.lf-theme-light .lf-sheet{background:#fbf3e7;border-color:rgba(0,0,0,.1);}'
      + '.lf-theme-light .lf-sh-head{background:#fbf3e7;border-bottom-color:rgba(0,0,0,.08);}'
      + '.lf-theme-light .lf-sh-name{color:#2a2118;}.lf-theme-light .lf-sh-sub{color:#9a8f7e;}'
      + '.lf-theme-light .lf-sh-text{color:#3a3126;}'
      + '.lf-theme-light .lf-sh-x{background:rgba(0,0,0,.06);color:#5a4f40;}'
      + '.lf-theme-light .lf-sh-x:hover{background:rgba(0,0,0,.12);}'
      + '.lf-theme-light .lf-sh-sec h4{color:#8a7f6e;}'
      + '.lf-theme-light .lf-vote{background:rgba(0,0,0,.035);}'
      + '.lf-theme-light .lf-vote b{color:#2a2118;}.lf-theme-light .lf-vote span{color:#4a4033;}'
      + '.lf-theme-light .lf-kv .lf-chip{background:rgba(0,0,0,.05);color:#3a3126;}'
      + '.lf-theme-light .lf-kv .lf-chip b{color:#000;}';
    var st = document.createElement('style');
    st.id = 'lf-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- modal (สร้างครั้งเดียว) ---------- */
  var overlay = null, sheetEl = null;
  var currentTheme = 'dark';
  function ensureModal() {
    if (overlay) { return; }
    overlay = document.createElement('div');
    overlay.className = 'lf-ov';
    overlay.innerHTML = '<div class="lf-sheet" role="dialog" aria-modal="true"></div>';
    sheetEl = overlay.querySelector('.lf-sheet');
    overlay.addEventListener('click', function (e) { if (e.target === overlay) { closeModal(); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); } });
    document.body.appendChild(overlay);
  }
  function closeModal() { if (overlay) { overlay.classList.remove('open'); } }
  function openDetail(ev) {
    ensureModal();
    var k = kindOf(ev.kind);
    var isOwner = ev.agent === 'owner';
    var color = isOwner ? OWNER_COLOR : k.color;
    var when = new Date(Number(ev.ts) || 0);
    var whenStr = isNaN(when.getTime()) ? '' : (when.toLocaleString('th-TH'));
    var html = ''
      + '<div class="lf-sh-head">'
      + '<span class="lf-sh-ic">' + (isOwner ? '👤' : k.icon) + '</span>'
      + '<div><div class="lf-sh-name">' + esc(nameOf(ev.agent)) + '</div>'
      + '<div class="lf-sh-sub">' + (ev.agent ? '@' + esc(ev.agent) + ' · ' : '') + k.label + (whenStr ? ' · ' + esc(whenStr) : '') + '</div></div>'
      + '<button class="lf-sh-x" aria-label="ปิด">✕</button>'
      + '</div><div class="lf-sh-body">'
      + '<div class="lf-sh-text">' + esc(ev.text || '') + '</div>';

    var meta = ev.meta || null;
    if (meta && Array.isArray(meta.votes) && meta.votes.length) {
      html += '<div class="lf-sh-sec"><h4>🗳️ ความเห็นที่ประชุม</h4>';
      for (var i = 0; i < meta.votes.length; i++) {
        var v = meta.votes[i] || {};
        html += '<div class="lf-vote"><b>' + esc(nameOf(v.handle)) + '</b><span>' + esc(v.say || '') + '</span></div>';
      }
      html += '</div>';
    }
    if (meta && (meta.runId || meta.found != null || meta.kept != null || meta.costTHB != null)) {
      html += '<div class="lf-sh-sec"><h4>🎯 รายละเอียดรอบ</h4><div class="lf-kv">';
      if (meta.found != null) { html += '<span class="lf-chip">เจอ <b>' + esc(meta.found) + '</b></span>'; }
      if (meta.kept != null) { html += '<span class="lf-chip">เก็บ <b>' + esc(meta.kept) + '</b> ลีด</span>'; }
      if (meta.costTHB != null) { html += '<span class="lf-chip">฿<b>' + esc((Number(meta.costTHB) || 0).toFixed(2)) + '</b></span>'; }
      if (meta.runId) { html += '<span class="lf-chip">รอบ <b>' + esc(meta.runId) + '</b></span>'; }
      html += '</div></div>';
    }
    html += '</div>';
    sheetEl.innerHTML = html;
    sheetEl.style.borderTop = '3px solid ' + color;
    if (currentTheme === 'light') { overlay.classList.add('lf-theme-light'); } else { overlay.classList.remove('lf-theme-light'); }
    var x = sheetEl.querySelector('.lf-sh-x');
    if (x) { x.addEventListener('click', closeModal); }
    overlay.classList.add('open');
  }

  /* ---------- render ---------- */
  function hasDetail(ev) {
    if (ev.meta && (Array.isArray(ev.meta.votes) && ev.meta.votes.length || ev.meta.runId)) { return true; }
    return String(ev.text || '').length > 90;
  }
  function cardHtml(ev) {
    var k = kindOf(ev.kind);
    var isOwner = ev.agent === 'owner';
    var color = isOwner ? OWNER_COLOR : k.color;
    var clickable = hasDetail(ev);
    return '<div class="lf-card' + (clickable ? ' lf-click' : '') + '" style="--lf-c:' + color + '" data-id="' + esc(ev.id || '') + '">'
      + '<div class="lf-top">'
      + '<span class="lf-ic">' + (isOwner ? '👤' : k.icon) + '</span>'
      + '<span class="lf-name">' + esc(nameOf(ev.agent)) + '</span>'
      + '<span class="lf-tag">' + k.label + '</span>'
      + '<span class="lf-time">' + timeAgo(ev.ts) + '</span>'
      + '</div>'
      + '<div class="lf-text">' + esc(ev.text || '') + '</div>'
      + (clickable ? '<div class="lf-more">แตะดูรายละเอียด ›</div>' : '')
      + '</div>';
  }
  function fill(el, label, events, byId) {
    if (!el) { return; }
    if (!events.length) { el.innerHTML = ''; if (label) { label.style.display = 'none'; } return; }
    el.innerHTML = '<div class="lf-list">' + events.map(cardHtml).join('') + '</div>';
    if (label) { label.style.display = 'block'; }
    var cards = el.querySelectorAll('.lf-card.lf-click');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        card.addEventListener('click', function () {
          var ev = byId[card.getAttribute('data-id')];
          if (ev) { openDetail(ev); }
        });
      })(cards[i]);
    }
  }

  /* ---------- public init ---------- */
  window.initLiveFeed = function (opts) {
    opts = opts || {};
    var scope = opts.scope || 'main';
    var mounts = opts.mounts || {};
    var intervalMs = opts.intervalMs || 8000;
    currentTheme = (opts.theme === 'light') ? 'light' : 'dark';
    injectCss();

    function el(id) { return id ? document.getElementById(id) : null; }
    function lbl(id) { return id ? document.getElementById(id) : null; }
    // ทาธีมสว่างให้ container (การ์ดอ่านง่ายบนพื้นครีม)
    if (currentTheme === 'light') {
      var ids = [mounts.comm, mounts.worklog, mounts.board];
      for (var mi = 0; mi < ids.length; mi++) { var me = el(ids[mi]); if (me) { me.classList.add('lf-theme-light'); } }
    }

    function tick() {
      return fetch('/api/company/feed?scope=' + encodeURIComponent(scope) + '&limit=60', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.success) { return; }
          var ev = d.events || [];
          var byId = {};
          for (var i = 0; i < ev.length; i++) { byId[ev[i].id] = ev[i]; }
          var comm = ev.filter(function (e) { return e.kind === 'chat' || e.kind === 'comm'; }).slice(0, 30);
          var work = ev.filter(function (e) { return e.kind === 'worklog' || e.kind === 'result' || e.kind === 'status'; }).slice(0, 20);
          var deci = ev.filter(function (e) { return e.kind === 'decision'; }).slice(0, 12);
          if (mounts.comm) { fill(el(mounts.comm), lbl(mounts.commLabel), comm, byId); }
          if (mounts.worklog) { fill(el(mounts.worklog), lbl(mounts.worklogLabel), work, byId); }
          if (mounts.board) { fill(el(mounts.board), lbl(mounts.boardLabel), deci, byId); }
        })
        .catch(function () { /* เงียบ */ });
    }
    tick();
    setInterval(tick, intervalMs);
    window.__liveFeedTick = tick;
    return tick;
  };
})();
