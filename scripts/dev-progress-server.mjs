#!/usr/bin/env node
// ============================================================
// 📊 Dev Progress Server — จอดูความคืบหน้าการพัฒนาแบบเรียลไทม์ (เลน 2, 29 ก.ค. 69)
// ------------------------------------------------------------
// เจ้าของขอ UI ดูงานสด — standalone เบาๆ ไม่พึ่ง Next build (ใช้ได้ทันทีไม่ต้องรอ B-2)
// Node ล้วน: http/fs/child_process/path built-in เท่านั้น — ไม่มี dependency ใหม่ ไม่มี auth (เครื่องมือ localhost)
// อ่านอย่างเดียวทั้งหมด — ไม่เขียนอะไรนอกจาก log คอนโซลของตัวเอง
//
// วิธีสตาร์ท (แบบ detached — ปิด terminal ได้ ตัว server ไม่ตาย):
//   PowerShell:
//     Start-Process -FilePath "node" -ArgumentList "scripts/dev-progress-server.mjs" `
//       -WorkingDirectory "<repo root>" -WindowStyle Hidden
//   แล้วเปิด http://localhost:3950
//   หยุด: หา process node ที่ฟังพอร์ต 3950 แล้ว Stop-Process (หรือ Get-NetTCPConnection -LocalPort 3950 |
//     Select -Expand OwningProcess | Stop-Process)
//
//   รันตรงหน้าจอ (debug เห็น log สด): node scripts/dev-progress-server.mjs
//
// ปรับพอร์ต/แหล่งข้อมูลด้วย env (ไม่ตั้ง = ค่า default ทั้งหมด):
//   DEV_PROGRESS_PORT       (default 3950)
//   DEV_PROGRESS_HEAVY_BASE (default http://localhost:3900 — เซิร์ฟเวอร์งานหนัก quick-test/mega-covers)
//   DEV_PROGRESS_BOARD      (default data/dev-progress-board.json)
//   DEV_PROGRESS_COVERS     (default data/mega-cover-runs.json)
//
// โครง board JSON ที่ไฟล์นี้อ่าน — ดู data/dev-progress-board.json (Fable อัปเดตมือทุกเหตุการณ์):
//   { updatedAt, overallPct, phases:[{key,title,status,pct,items:[{name,status,note}]}],
//     deploys:[{sha,title,time}], incidents:[{title,status,severity,note}],
//     formulaScore:{passed,total,detail} }
// ============================================================

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

export const PORT = parseInt(process.env.DEV_PROGRESS_PORT || '3950', 10);
export const HEAVY_BASE = process.env.DEV_PROGRESS_HEAVY_BASE || 'http://localhost:3900';
const BOARD_PATH = process.env.DEV_PROGRESS_BOARD || path.join(REPO_ROOT, 'data', 'dev-progress-board.json');
const COVERS_PATH = process.env.DEV_PROGRESS_COVERS || path.join(REPO_ROOT, 'data', 'mega-cover-runs.json');
const FETCH_TIMEOUT_MS = 5000;
const GIT_TIMEOUT_MS = 5000;

// ============================================================
// helpers — pure/testable ล้วน (ไม่มี side effect นอกจาก IO ที่ระบุชัด)
// ============================================================

/** ตัด qcFlags ให้สั้นพอโชว์บนการ์ด (≤3 อัน + "+N อื่นๆ") */
export function shortenQcFlags(flags, max = 3) {
  const arr = Array.isArray(flags) ? flags.map((f) => String(f)) : [];
  if (arr.length <= max) return arr;
  return [...arr.slice(0, max), `+${arr.length - max} อื่นๆ`];
}

/** เลือกปกล่าสุด n ใบจากคลัง — เรียงตาม `at` ใหม่สุดก่อนเสมอ (ไม่พึ่งลำดับเดิมของไฟล์ กันวันหน้าลำดับเปลี่ยน) */
export function pickLatestCovers(coversArr, n = 3) {
  const arr = Array.isArray(coversArr) ? coversArr.filter(Boolean) : [];
  return arr
    .slice()
    .sort((a, b) => String(b?.at || '').localeCompare(String(a?.at || '')))
    .slice(0, n)
    .map((c) => ({
      id: c.id || null,
      at: c.at || null,
      title: String(c.title || '').slice(0, 80),
      qcStatus: c.qcStatus || null,
      qcFlags: shortenQcFlags(c.qcFlags),
      refId: c.refId || null,
      template: c.template || null,
      refSimilarity: c.refSimilarity ?? null,
      // ★ แบตช์เฟส D ข้อ 1 (29 ก.ค. 69 — เสียบ coverFormulaCheck): คะแนนสูตร 478 ใบต่อใบปก (ไม่ใช่ formulaScore
      //   ระดับบอร์ดจาก dev-progress-board.json ด้านล่าง — คนละก้อนคนละความหมาย ตั้งใจแยกชื่อฟิลด์กันสับสน)
      //   ไม่มี = null (เรคคอร์ดเก่า/ปิดสวิตช์ MEGA_FORMULA_CHECK — การ์ดจะไม่โชว์บรรทัดนี้เลย)
      coverFormulaScore: (c.formulaScore && typeof c.formulaScore === 'object') ? { passed: c.formulaScore.passed ?? null, total: c.formulaScore.total ?? null, score: c.formulaScore.score ?? null } : null,
    }));
}

/** ยุบ job สดจาก /api/quick-test ให้เหลือฟิลด์ที่การ์ดต้องใช้ */
export function shapeQueueJob(j) {
  return {
    id: j?.id || null,
    kind: j?.kind || null,
    label: String(j?.label || '').slice(0, 80),
    status: j?.status || null,
    pct: j?.progress?.pct ?? null,
    step: j?.progress?.step || null,
    dispatch: j?.dispatch || null,
    createdAt: j?.createdAt || null,
  };
}

/** parse `git log --oneline -N` → [{sha, title}] — ทนบรรทัดว่าง/รูปแบบแปลก */
export function parseGitLogOneline(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(\S+)\s+(.*)$/.exec(l);
      return m ? { sha: m[1], title: m[2] } : { sha: l, title: '' };
    });
}

// fetch พร้อม timeout — คืน { data, error } เสมอ ไม่ throw ออกไปนอกฟังก์ชัน
async function safeFetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { data: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { data, error: null };
  } catch (e) {
    return { data: null, error: String(e?.message || e).slice(0, 200) };
  }
}

async function safeReadJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return { data: JSON.parse(raw), error: null };
  } catch (e) {
    return { data: null, error: String(e?.message || e).slice(0, 200) };
  }
}

async function safeGitLog(repoRoot = REPO_ROOT, n = 10) {
  try {
    const { stdout } = await execFileP('git', ['log', '--oneline', `-${n}`], {
      cwd: repoRoot,
      timeout: GIT_TIMEOUT_MS,
    });
    return { data: parseGitLogOneline(stdout), error: null };
  } catch (e) {
    return { data: null, error: String(e?.message || e).slice(0, 200) };
  }
}

// ============================================================
// รวมข้อมูลทุกแหล่งเป็น state เดียว — แหล่งไหนล้ม field นั้นมี error สั้นๆ ไม่ทำทั้งก้อนพัง
// ============================================================
export async function buildState({ heavyBase = HEAVY_BASE, boardPath = BOARD_PATH, coversPath = COVERS_PATH } = {}) {
  const [board, gitLog, queue, covers] = await Promise.all([
    safeReadJsonFile(boardPath),
    safeGitLog(),
    safeFetchJson(`${heavyBase}/api/quick-test?kinds=compose,ref&limit=8`),
    safeReadJsonFile(coversPath),
  ]);

  const boardData = board.data || {};
  return {
    serverTime: new Date().toISOString(),
    overallPct: Number.isFinite(boardData.overallPct) ? boardData.overallPct : null,
    boardUpdatedAt: boardData.updatedAt || null,
    phases: Array.isArray(boardData.phases) ? boardData.phases : [],
    incidents: Array.isArray(boardData.incidents) ? boardData.incidents : [],
    formulaScore: boardData.formulaScore || null,
    deploys: {
      board: Array.isArray(boardData.deploys) ? boardData.deploys : [],
      git: gitLog.data || [],
      gitError: gitLog.error,
    },
    queue: {
      jobs: Array.isArray(queue.data?.jobs) ? queue.data.jobs.map(shapeQueueJob) : [],
      error: queue.error || (queue.data && queue.data.success === false ? String(queue.data.error || 'unknown').slice(0, 200) : null),
    },
    covers: {
      items: pickLatestCovers(covers.data, 3),
      error: covers.error,
    },
    errors: {
      board: board.error,
      git: gitLog.error,
      queue: queue.error,
      covers: covers.error,
    },
  };
}

// ============================================================
// หน้า HTML — ฝัง CSS/JS ในไฟล์เดียว (ธีมมืด, ภาษาไทย, มือถือดูได้, poll /api/state ทุก 15 วิ)
// ============================================================
function renderHtml() {
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ความคืบหน้าการพัฒนา — สด</title>
<style>
  :root {
    --bg: #0e1116; --panel: #171b23; --panel2: #1e232d; --border: #2a303c;
    --text: #e6e9ef; --sub: #9aa4b2; --accent: #5b9dff; --ok: #3ecf8e; --warn: #f2b84b; --bad: #ef5a5a;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: 'Segoe UI', 'Noto Sans Thai', sans-serif; padding: 12px; }
  h1 { font-size: 18px; margin: 4px 0 2px; }
  .sub { color: var(--sub); font-size: 12px; margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
  .card h2 { font-size: 14px; margin: 0 0 8px; color: var(--accent); display: flex; align-items: center; gap: 6px; }
  .bar { height: 8px; border-radius: 5px; background: var(--panel2); overflow: hidden; margin: 4px 0 8px; }
  .bar > div { height: 100%; background: var(--accent); }
  .item { font-size: 12.5px; padding: 5px 0; border-bottom: 1px dashed var(--border); }
  .item:last-child { border-bottom: none; }
  .note { color: var(--sub); font-size: 11.5px; }
  .badge { display: inline-block; font-size: 10.5px; padding: 1px 7px; border-radius: 9px; margin-right: 5px; }
  .b-deployed, .b-done, .b-ok, .b-resolved { background: rgba(62,207,142,.18); color: var(--ok); }
  .b-in_progress, .b-monitoring { background: rgba(242,184,75,.18); color: var(--warn); }
  .b-blocked, .b-open, .b-fail { background: rgba(239,90,90,.18); color: var(--bad); }
  .b-queued { background: rgba(154,164,178,.18); color: var(--sub); }
  .covers { display: flex; gap: 8px; overflow-x: auto; }
  .cover { flex: 0 0 auto; width: 130px; }
  .cover img { width: 130px; height: 162px; object-fit: cover; border-radius: 6px; background: var(--panel2); display: block; }
  .cover .t { font-size: 10.5px; color: var(--sub); margin-top: 4px; max-height: 28px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td, th { padding: 4px 3px; text-align: left; border-bottom: 1px dashed var(--border); }
  .err { color: var(--bad); font-size: 11.5px; padding: 4px 0; }
  .score-num { font-size: 26px; font-weight: 700; }
  .score-num.low { color: var(--bad); } .score-num.mid { color: var(--warn); } .score-num.hi { color: var(--ok); }
  .full { grid-column: 1 / -1; }
  a { color: var(--accent); }
  #topbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  #dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--sub); }
  #dot.live { background: var(--ok); }
</style>
</head>
<body>
  <div id="topbar">
    <div>
      <h1>📊 ความคืบหน้าการพัฒนา — สด</h1>
      <div class="sub"><span id="dot"></span> อัปเดตล่าสุด: <span id="updatedAt">-</span> · poll ทุก 15 วิ</div>
    </div>
  </div>
  <div class="card full" style="margin:10px 0">
    <h2>ความคืบหน้ารวม</h2>
    <div class="bar"><div id="overallBar" style="width:0%"></div></div>
    <div class="sub" id="overallPct">-</div>
  </div>
  <div class="grid" id="phaseGrid"></div>
  <div class="grid" style="margin-top:10px">
    <div class="card">
      <h2>🚀 ไทม์ไลน์ deploy วันนี้</h2>
      <div id="deployList"></div>
    </div>
    <div class="card">
      <h2>🧮 คะแนนสูตร 478 ล่าสุด</h2>
      <div id="formulaBox"></div>
    </div>
    <div class="card full">
      <h2>📋 คิวงานสด (:3900)</h2>
      <div id="queueBox"></div>
    </div>
    <div class="card full">
      <h2>🖼️ ปกล่าสุด 3 ใบ</h2>
      <div class="covers" id="coversBox"></div>
    </div>
    <div class="card full">
      <h2>⚠️ ความผิดพลาดที่พบ + สถานะ</h2>
      <div id="incidentsBox"></div>
    </div>
  </div>

<script>
function badge(status) {
  var cls = 'b-' + String(status || '').toLowerCase();
  return '<span class="badge ' + cls + '">' + (status || '-') + '</span>';
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function fmtTime(iso) { if (!iso) return '-'; try { return new Date(iso).toLocaleString('th-TH'); } catch { return iso; } }

function renderPhases(phases) {
  var el = document.getElementById('phaseGrid');
  el.innerHTML = (phases || []).map(function(p) {
    var items = (p.items || []).map(function(it) {
      return '<div class="item">' + badge(it.status) + esc(it.name) + '<div class="note">' + esc(it.note || '') + '</div></div>';
    }).join('');
    return '<div class="card"><h2>เฟส ' + esc(p.key) + ' — ' + esc(p.title || '') + ' ' + badge(p.status) + '</h2>' +
      '<div class="bar"><div style="width:' + (p.pct || 0) + '%"></div></div>' +
      '<div class="sub">' + (p.pct || 0) + '%</div>' + items + '</div>';
  }).join('');
}

function renderDeploys(d) {
  var rows = (d.board || []).map(function(x) {
    return '<div class="item"><b>' + esc(x.sha) + '</b> ' + esc(x.title) + '<div class="note">' + fmtTime(x.time) + '</div></div>';
  }).join('');
  var gitRows = d.gitError
    ? '<div class="err">git log ล้ม: ' + esc(d.gitError) + '</div>'
    : '<div class="note" style="margin-top:6px">git log ล่าสุด: ' + (d.git || []).slice(0, 5).map(function(g) { return esc(g.sha); }).join(', ') + '</div>';
  document.getElementById('deployList').innerHTML = (rows || '<div class="note">ยังไม่มี</div>') + gitRows;
}

function renderFormula(f) {
  var el = document.getElementById('formulaBox');
  if (!f) { el.innerHTML = '<div class="note">ยังไม่มีข้อมูล</div>'; return; }
  var pct = f.total ? Math.round((f.passed / f.total) * 100) : 0;
  var cls = pct >= 80 ? 'hi' : pct >= 50 ? 'mid' : 'low';
  el.innerHTML = '<div class="score-num ' + cls + '">' + f.passed + '/' + f.total + '</div><div class="note">' + esc(f.detail || '') + '</div>';
}

function renderQueue(q) {
  var el = document.getElementById('queueBox');
  if (q.error) { el.innerHTML = '<div class="err">ต่อคิวสดไม่ได้: ' + esc(q.error) + '</div>'; return; }
  if (!q.jobs || !q.jobs.length) { el.innerHTML = '<div class="note">คิวว่าง</div>'; return; }
  el.innerHTML = '<table><tr><th>งาน</th><th>ชนิด</th><th>สถานะ</th><th>ความคืบหน้า</th></tr>' +
    q.jobs.map(function(j) {
      return '<tr><td>' + esc(j.label) + '</td><td>' + esc(j.kind) + '</td><td>' + badge(j.status) + '</td><td>' +
        (j.pct != null ? j.pct + '% ' : '') + esc(j.step || '') + '</td></tr>';
    }).join('') + '</table>';
}

function renderCovers(c) {
  var el = document.getElementById('coversBox');
  if (c.error) { el.innerHTML = '<div class="err">อ่านคลังปกไม่ได้: ' + esc(c.error) + '</div>'; return; }
  if (!c.items || !c.items.length) { el.innerHTML = '<div class="note">ยังไม่มี</div>'; return; }
  el.innerHTML = c.items.map(function(x) {
    // ★ แบตช์เฟส D ข้อ 1 (29 ก.ค. 69): โชว์คะแนนสูตร 478 ใบต่อใบถ้ามี (ไม่มี = ไม่เพิ่มบรรทัดนี้เลย — เหมือน
    //   แพทเทิร์น boardUpdatedAt ด้านล่างของไฟล์นี้)
    var fs = x.coverFormulaScore;
    var formulaLine = (fs && fs.total != null) ? ('<br>สูตร: ' + esc(fs.passed) + '/' + esc(fs.total) + (fs.score != null ? ' (' + esc(fs.score) + '%)' : '')) : '';
    return '<div class="cover">' +
      '<img src="/cover-img?id=' + encodeURIComponent(x.id || '') + '" loading="lazy" onerror="this.style.opacity=0.15">' +
      '<div class="t">' + badge(x.qcStatus) + esc(x.title) + '<br>' + esc((x.qcFlags || []).join(', ')) + '<br>ref: ' + esc(x.refId) + formulaLine + '</div>' +
      '</div>';
  }).join('');
}

function renderIncidents(list) {
  var el = document.getElementById('incidentsBox');
  el.innerHTML = (list || []).map(function(x) {
    return '<div class="item">' + badge(x.severity || x.status) + '<b>' + esc(x.title) + '</b> — ' + esc(x.status) +
      '<div class="note">' + esc(x.note || '') + '</div></div>';
  }).join('') || '<div class="note">ไม่มี</div>';
}

async function tick() {
  try {
    var r = await fetch('/api/state', { cache: 'no-store' });
    var s = await r.json();
    document.getElementById('dot').className = 'live';
    document.getElementById('updatedAt').textContent = fmtTime(s.serverTime);
    document.getElementById('overallBar').style.width = (s.overallPct || 0) + '%';
    document.getElementById('overallPct').textContent = (s.overallPct != null ? s.overallPct + '%' : 'ไม่ทราบ') +
      (s.boardUpdatedAt ? (' · บอร์ดอัปเดตล่าสุด ' + fmtTime(s.boardUpdatedAt)) : '');
    renderPhases(s.phases);
    renderDeploys(s.deploys);
    renderFormula(s.formulaScore);
    renderQueue(s.queue);
    renderCovers(s.covers);
    renderIncidents(s.incidents);
  } catch (e) {
    document.getElementById('dot').className = '';
  }
}
tick();
setInterval(tick, 15000);
</script>
</body>
</html>`;
}

// ============================================================
// HTTP server — factory (แยกจาก auto-start เพื่อให้เทส inject config/port เองได้)
// ============================================================
export function createServer(opts = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/') {
        const html = renderHtml();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        const state = await buildState(opts);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(state));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/cover-img') {
        const id = url.searchParams.get('id');
        if (!id) { res.writeHead(400); res.end('missing id'); return; }
        const heavyBase = opts.heavyBase || HEAVY_BASE;
        try {
          const upstream = await fetch(`${heavyBase}/api/mega-covers/img?id=${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (!upstream.ok || !upstream.body) { res.writeHead(upstream.status || 502); res.end(); return; }
          res.writeHead(200, {
            'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
            'Cache-Control': 'no-store',
          });
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.end(buf);
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('proxy error: ' + String(e?.message || e).slice(0, 200));
        }
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    } catch (e) {
      // ห้ามให้ทั้งเซิร์ฟเวอร์ล้มจาก request เดียว — 500 พร้อมข้อความสั้นเสมอ
      try {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: String(e?.message || e).slice(0, 300) }));
      } catch { /* response อาจถูกส่งไปแล้วบางส่วน — ปล่อยผ่าน */ }
    }
  });
}

// ============================================================
// auto-start เฉพาะตอนรันไฟล์นี้ตรงๆ (node scripts/dev-progress-server.mjs) — import ไปเทสไม่ให้เปิดพอร์ตเอง
// ============================================================
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`[dev-progress-server] 📊 ฟังอยู่ที่ http://localhost:${PORT} (heavy base: ${HEAVY_BASE})`);
  });
}
