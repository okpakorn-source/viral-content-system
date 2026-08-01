/**
 * 🛡️ กล่องดำ workflow (Black Box) — 1 ส.ค. 69 (เจ้าของสั่ง: "เจอจุดไหนมีปัญหา ต้องระบุได้ทันทีว่าเกิดจากอะไร ไม่เดาสุ่ม")
 *
 * เก็บหลักฐาน before/after ของทุกด่านที่ "แตะเนื้อข่าว" ต่อเวอร์ชัน:
 *   ร่างดิบตัวเขียน → postProcess → L3 แก้คำ → L4 เช็คข้อเท็จจริง → L4.5 ล้างสถานที่ →
 *   L4.6 ตัดประโยค (ผู้ต้องสงสัยเบอร์หนึ่ง) → L5 ขัดเกลา → เกราะแก่นข่าว
 * เกิดเคสมั่ว: เปิด trace มาเทียบทีละด่าน จะเห็นทันทีว่าประโยคพังที่ด่านไหน
 *
 * กติกาเหล็ก: กล่องดำห้ามทำงานจริงพัง — ทุกฟังก์ชันกลืน error เงียบ (best-effort เท่านั้น)
 * ที่เก็บ: data/blackbox/trace-YYYY-MM-DD.jsonl (เครื่องทีม) · /tmp/blackbox (Vercel — ephemeral, trace เต็มยังติดไปกับ
 * response ทุกครั้งอยู่แล้วผ่าน versions[]._blackbox) · อ่านย้อนหลัง: GET /api/trace
 * ⚠️ เครื่องทีมมี VERCEL=1 ค้างใน env — ห้ามใช้ตัดสิน platform ใช้ process.platform แทน (บทเรียน 17 ก.ค.)
 */
import fs from 'fs';
import path from 'path';

const CLIP = 700; // ตัดยาวต่อ snapshot กัน trace บวม

function _dir() {
  return process.platform === 'win32'
    ? path.join(process.cwd(), 'data', 'blackbox')
    : path.join('/tmp', 'blackbox');
}

/** บันทึก 1 ด่านลงกล่องดำของเวอร์ชัน — เก็บ before/after เฉพาะตอน "ข้อความเปลี่ยนจริง" */
export function bbStep(arr, layer, before, after, extra = {}) {
  try {
    const b = String(before ?? '');
    const a = String(after ?? '');
    const changed = b !== a;
    arr.push({
      layer,
      changed,
      ...(changed ? { before: b.slice(0, CLIP), after: a.slice(0, CLIP) } : {}),
      ...extra,
    });
  } catch { /* กล่องดำห้ามทำงานจริงพัง */ }
}

/** เซฟ trace ทั้งงานลงไฟล์รายวัน (JSONL) — วันตามเวลาไทย + เพดานไฟล์ 10MB (Opus P2-C/H) */
export function bbSaveTrace(trace) {
  try {
    const dir = _dir();
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); // วันไทย (UTC+7)
    const file = path.join(dir, `trace-${day}.jsonl`);
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 10 * 1024 * 1024) {
        console.warn('[blackbox] ไฟล์วันนี้เกิน 10MB — หยุดเก็บเพิ่มของวันนี้');
        return false;
      }
    } catch {}
    fs.appendFileSync(file, JSON.stringify(trace) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** อ่าน trace ย้อนหลัง — id เจาะงานเดียว (เต็ม) / ไม่ใส่ id = สรุปงานล่าสุด */
export function bbLoadTraces({ id = null, limit = 20 } = {}) {
  try {
    const dir = _dir();
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().reverse().slice(0, 7);
    const out = [];
    for (const f of files) {
      // (Opus P2-C): ไฟล์ใหญ่ผิดปกติ (>15MB) ข้าม — กันอ่านทั้งก้อนเข้าหน่วยความจำจนเครื่องอืด
      try { if (fs.statSync(path.join(dir, f)).size > 15 * 1024 * 1024) continue; } catch { continue; }
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').reverse();
      for (const ln of lines) {
        if (!ln) continue;
        let t;
        try { t = JSON.parse(ln); } catch { continue; }
        if (id) {
          if (t.traceId === id) return [t];
          continue;
        }
        out.push({
          traceId: t.traceId,
          at: t.at,
          title: t.title || '',
          error: t.error || null,
          card: t.card?.name || null,
          versions: (t.versions || []).map(v => ({
            promptId: v.promptId,
            layersChanged: (v.blackbox || []).filter(s => s.changed).map(s => s.layer),
            coreGuard: v.corr?.coreGuard || null,
          })),
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
  } catch {
    return [];
  }
}
