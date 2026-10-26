/**
 * ✂️ clipSingle/segments.js — วางแผนช่วงที่จะดู + จัดผลดูคลิปให้อยู่ในรูปเดียว (ฟังก์ชันบริสุทธิ์ ไม่มี I/O)
 * ------------------------------------------------------------------
 * หลัก "ดูให้ครบ": คลิปสั้นดูทั้งคลิปรอบเดียว · คลิปยาวแบ่งเป็นช่วงยาวเท่ากันต่อกันไม่มีช่องว่าง
 *   ดูทุกช่วงพร้อมกัน แล้วโค้ดเช็คว่าช่วงที่ดูสำเร็จครอบตั้งแต่ต้นจนจบคลิป
 */

export const SINGLE_PASS_MAX_SEC = 480;   // ≤8 นาที ดูทั้งคลิปรอบเดียว
export const SEGMENT_TARGET_SEC = 360;    // คลิปยาวแบ่งช่วงละ ~6 นาที (บทถอดคำต่อคำไม่ชนเพดานคำตอบ)
export const MAX_SEGMENTS = 24;           // เพดานช่วงต่อคลิป (คลิปยาวมากช่วงจะยาวขึ้นแทน)

/** วางแผนช่วง — ไม่รู้ความยาว = [] (ผู้เรียกดูทั้งคลิปรอบเดียวแล้วขอความยาวจาก AI) */
export function planSegments(durationSec, { target = SEGMENT_TARGET_SEC, singleMax = SINGLE_PASS_MAX_SEC, max = MAX_SEGMENTS } = {}) {
  const dur = Math.round(Number(durationSec) || 0);
  if (!(dur > 0)) return [];
  if (dur <= singleMax) return [{ no: 1, startSec: 0, endSec: dur }];
  const n = Math.min(max, Math.max(2, Math.ceil(dur / target)));
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const startSec = Math.round((dur * i) / n);
    const endSec = i === n - 1 ? dur : Math.round((dur * (i + 1)) / n);
    out.push({ no: i + 1, startSec, endSec });
  }
  return out;
}

/** "m:ss" / "h:mm:ss" / ตัวเลข → วินาที (อ่านไม่ได้ = null) */
export function parseClock(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
  const parts = String(v ?? '').trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function formatClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

// ★ ผู้ตรวจอิสระรอบ 2: ขึ้นบรรทัดใหม่ในข้อความทำให้ "บรรทัดของบทถอด" เลื่อนจากรายการคำพูด (ป้ายผู้พูดจับคู่ผิดทั้งชุด) → ยุบเป็นเว้นวรรค
const text = (v) => (typeof v === 'string' ? v.replace(/\s*[\r\n]+\s*/g, ' ').trim() : '');
const list = (v) => (Array.isArray(v) ? v : []);

/**
 * จัดผลดูคลิป 1 ช่วงให้อยู่ในรูปเดียว + เลื่อนเวลาเป็นเวลาจริงของคลิปเต็ม
 *   offsetSec = เวลาเริ่มของไฟล์ที่ AI เห็น (ไฟล์ผ่าท่อน = startSec ของช่วง · ดูลิงก์/ทั้งคลิป = 0)
 */
export function normalizeWatch(data, { offsetSec = 0 } = {}) {
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const shift = (t) => {
    const sec = parseClock(t);
    return sec == null ? '' : formatClock(sec + offsetSec);
  };
  const transcript = list(d.transcript)
    .map((x) => (typeof x === 'string' ? { t: '', speaker: '', text: text(x) } : { t: shift(x?.t), speaker: text(x?.speaker), text: text(x?.text) }))
    .filter((x) => x.text);
  const screen = list(d.screen)
    .map((x) => (typeof x === 'string' ? { t: '', text: text(x) } : { t: shift(x?.t), text: text(x?.text) }))
    .filter((x) => x.text);
  const visuals = list(d.visuals).map((x) => (typeof x === 'string' ? text(x) : text(x?.text))).filter(Boolean);
  const keyPoints = list(d.keyPoints).map((x) => (typeof x === 'string' ? text(x) : text(x?.text))).filter(Boolean);
  const durationSec = Number(d.durationSec);
  return {
    transcript, screen, visuals, keyPoints,
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec) : 0,
  };
}

/** ช่วงที่ดูสำเร็จครอบทั้งคลิปไหม — คืนรายการช่วงที่หาย ([] = ครบ) */
export function missingRanges(segments = [], durationSec = 0) {
  const missing = segments.filter((s) => !s.ok).map((s) => ({ no: s.no, startSec: s.startSec, endSec: s.endSec }));
  return durationSec > 0 || segments.length ? missing : [];
}

/** ข้อความรวมสำหรับตรวจหลักฐาน (คำพูด + จอ + ภาพ) */
export function evidenceText(segments = []) {
  const ok = segments.filter((s) => s.ok);
  return {
    transcriptText: ok.flatMap((s) => s.transcript.map((t) => t.text)).join('\n'),
    speakerText: ok.flatMap((s) => s.transcript.map((t) => t.speaker)).join('\n'),
    screenText: ok.flatMap((s) => s.screen.map((x) => x.text)).join('\n'),
    visualText: ok.flatMap((s) => s.visuals).join('\n'),
  };
}
