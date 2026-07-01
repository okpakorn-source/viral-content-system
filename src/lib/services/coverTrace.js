/**
 * =====================================================
 * Cover Trace — ระบบบันทึก "ทุกขั้นตอน" ของท่อทำปก (observability)
 * =====================================================
 * เป้าหมาย (ผู้ใช้สั่ง 2 ก.ค.): เห็นการทำงานจริงทุกขั้นตอน + เก็บข้อมูลทุกขั้นเข้าคลัง
 *   (ข่าวเข้า → คีย์เวิร์ด → ค้นภาพจากแหล่งไหน → ภาพดิบ → Judge → Director → ปกจริง)
 *
 * ★ ปลอดภัยเพราะ /api/auto-cover-v3 ล็อกเรนเดอร์ทีละใบ (_renderLock) → มีรันเดียว active
 *   ต่อครั้ง จึงใช้ "current run" ระดับโมดูลได้ (ไม่ต้องส่ง runId ผ่านทุกฟังก์ชัน)
 * ★ ทุกฟังก์ชัน non-fatal (try/catch เงียบ) — ห้ามทำให้ท่อปกล้มเพราะ trace
 * ★ ไม่เก็บ base64 ก้อนใหญ่ใน JSON (ปกเซฟเป็น .jpg แยก) · data: URI = mark '[video-frame]'
 */
import fs from 'fs';
import path from 'path';

const DIR = path.join(process.cwd(), 'data', 'cover-runs');
const INDEX = path.join(DIR, '_index.json');
const MAX_RUNS = 60; // เก็บ trace ล่าสุด N รัน (กันคลังบวมไม่จำกัด)

let _current = null;

function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch {} }
function runFile(runId) { return path.join(DIR, `${runId}.json`); }
function coverFile(runId) { return path.join(DIR, `${runId}.jpg`); }
function safeWrite(file, obj) { try { ensureDir(); fs.writeFileSync(file, JSON.stringify(obj, null, 2)); } catch {} }

/** ตัด URL ยาว/ภาพเฟรม (data:) ให้เบา — เก็บเฉพาะที่ดูรู้เรื่อง */
export function shortUrl(u) {
  const s = String(u || '');
  if (s.startsWith('data:')) return '[video-frame]';
  return s.length > 300 ? s.slice(0, 300) : s;
}

/** ทำความสะอาด array ของ meta ภาพ (cap + strip frame) สำหรับเก็บลง trace */
function sanitizeImages(arr, cap = 140) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, cap).map((m) => {
    if (typeof m === 'string') return { url: shortUrl(m) };
    return {
      url: shortUrl(m.url || m.link || ''),
      source: (m.source || '').toString().slice(0, 80),
      query: (m.queryText || '').toString().slice(0, 120),
      label: (m.queryLabel || '').toString().slice(0, 40),
      title: (m.title || '').toString().slice(0, 120),
      score: (m.score !== undefined ? m.score : undefined),
      role: (m.role || undefined),
    };
  });
}

/** เริ่มบันทึกรันใหม่ — คืน runId (ถ้าไม่ส่งมาจะสร้างให้) */
export function begin({ runId, newsTitle = '', content = '', sourceLinks = [] } = {}) {
  try {
    // safety: ถ้ารันก่อนหน้ายังไม่ปิด (พลาด end() ที่ early-return หายาก) → ปิดเป็น abandoned ก่อน
    if (_current && _current.status === 'running') {
      try { _current.status = 'failed'; _current.error = 'abandoned (ไม่จบตามปกติ)'; _current.finishedAt = new Date().toISOString(); persist(); updateIndex(); } catch {}
      _current = null;
    }
    const id = runId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    _current = {
      runId: id,
      startedAt: new Date().toISOString(),
      status: 'running',
      newsTitle: String(newsTitle || '').slice(0, 300),
      contentLen: (content || '').length,
      content: String(content || '').slice(0, 6000),
      sourceLinks: Array.isArray(sourceLinks) ? sourceLinks.slice(0, 20) : [],
      steps: [],
      finishedAt: null,
      elapsedMs: null,
      result: null,
      error: null,
    };
    persist();
    updateIndex();
    return id;
  } catch { return runId || null; }
}

/**
 * บันทึก 1 ขั้นตอน
 * @param {string} name  รหัสขั้น (input/identity/search/judge/facedetect/gate/director/qc/compose)
 * @param {string} label ข้อความไทยโชว์บน UI ("วิเคราะห์ประเด็น + แตกคีย์เวิร์ด")
 * @param {object} data  ข้อมูลของขั้นนั้น (คีย์เวิร์ด/แหล่ง/ภาพ ฯลฯ)
 */
export function step(name, label, data = {}) {
  if (!_current) return;
  try {
    // ★ auto-sanitize ฟิลด์ภาพที่รู้จัก (images/raw/selected) ให้เบา
    const d = { ...data };
    for (const k of ['images', 'raw', 'selected', 'accepted', 'rejected', 'candidates']) {
      if (Array.isArray(d[k])) d[k] = sanitizeImages(d[k]);
    }
    _current.steps.push({
      name,
      label,
      ts: new Date().toISOString(),
      tOffsetMs: Date.now() - Date.parse(_current.startedAt),
      data: d,
    });
    persist();
  } catch {}
}

/** จบรัน — เซฟผล + ปก (.jpg แยก) + อัปเดต index */
export function end({ success = false, result = {}, error = null, coverBase64 = null } = {}) {
  if (!_current) return null;
  try {
    if (coverBase64) {
      try {
        const b64 = String(coverBase64).replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(coverFile(_current.runId), Buffer.from(b64, 'base64'));
        result = { ...result, coverUrl: `/api/cover-trace?img=${_current.runId}` };
      } catch {}
    }
    _current.status = success ? 'done' : 'failed';
    _current.finishedAt = new Date().toISOString();
    _current.elapsedMs = Date.now() - Date.parse(_current.startedAt);
    _current.result = result;
    _current.error = error ? String(error).slice(0, 400) : null;
    persist();
    updateIndex();
  } catch {}
  const id = _current.runId;
  _current = null;
  return id;
}

function persist() { if (_current) safeWrite(runFile(_current.runId), _current); }

function updateIndex() {
  try {
    ensureDir();
    let idx = [];
    try { idx = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch {}
    if (!Array.isArray(idx)) idx = [];
    if (_current) {
      const c = _current;
      const entry = {
        runId: c.runId,
        startedAt: c.startedAt,
        status: c.status,
        newsTitle: c.newsTitle,
        elapsedMs: c.elapsedMs,
        stepCount: c.steps.length,
        score: c.result?.score ?? null,
        template: c.result?.template ?? null,
        caseId: c.result?.caseId ?? null,
        hasCover: !!c.result?.coverUrl,
      };
      idx = idx.filter((e) => e.runId !== c.runId);
      idx.unshift(entry);
    }
    if (idx.length > MAX_RUNS) {
      const drop = idx.slice(MAX_RUNS);
      idx = idx.slice(0, MAX_RUNS);
      for (const d of drop) {
        try { fs.unlinkSync(runFile(d.runId)); } catch {}
        try { fs.unlinkSync(coverFile(d.runId)); } catch {}
      }
    }
    safeWrite(INDEX, idx);
  } catch {}
}

export function getRun(runId) { try { return JSON.parse(fs.readFileSync(runFile(runId), 'utf8')); } catch { return null; } }
export function listRuns() { try { const a = JSON.parse(fs.readFileSync(INDEX, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } }
export function getCoverPath(runId) { const f = coverFile(runId); return fs.existsSync(f) ? f : null; }
export function currentRunId() { return _current?.runId || null; }
