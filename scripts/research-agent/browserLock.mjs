/**
 * 🔒 scripts/research-agent/browserLock.mjs — เบราว์เซอร์ใช้ได้ทีละงาน (ข้อตัดสินผู้คุมงาน 1 ต.ค. 69 · SPEC-v2 ส่วน 8)
 * ─────────────────────────────────────────────────────────────────────────────
 * worker รับงานขนานได้ (RESEARCH_AGENT_CONCURRENCY ค่าเริ่มต้น 2) แต่เบราว์เซอร์มีโปรไฟล์เดียว (Edge "Profile 1"
 *   ล็อกอิน "เล่าเรื่อง ดารา") — สองเอเจนต์ใช้พร้อมกัน = แท็บ/เซสชันชนกัน → ใช้ได้ทีละงาน
 * วิธี: ไฟล์ล็อกสร้างแบบ exclusive (flag 'wx' = O_CREAT|O_EXCL) — กันได้ทั้งงานในโปรเซสเดียวกันและ worker หลายโปรเซส
 *   บนเครื่องเดียวกัน (worker วางไฟล์ไว้ใต้ os.tmpdir() ของผู้ใช้ = ผูกกับโปรไฟล์เบราว์เซอร์ของผู้ใช้คนนั้น)
 *   งานที่ล็อกไม่ได้ → worker ตัด browser ออกจาก TOOLS ของงานนั้น (ใบงานบอก "ห้ามใช้เบราว์เซอร์") + บันทึก tool_log
 * ล็อกค้างถูกยึดคืนเมื่อ: pid เจ้าของ (เครื่องเดียวกัน) ไม่มีชีวิตแล้ว · อายุเกิน staleMs (นานกว่างานยาวสุดที่เป็นไปได้) ·
 *   ไฟล์อ่านไม่ออกและเก่ากว่า 60 วิ · pid เป็นโปรเซสนี้เองแต่ไม่มีงานในโปรเซสถือล็อกอยู่ (ปล่อยรอบก่อนพลาด)
 *   ข้อจำกัด: worker 2 โปรเซสบนเครื่องเดียวกันที่ตัดสินล็อกค้างพร้อมกันพอดีอาจได้ล็อกทั้งคู่ 1 ครั้ง (หน้าต่างแคบมาก
 *   และเกิดได้เฉพาะตอนยึดล็อกค้าง) · ในโปรเซสเดียวกันไม่มีการชน (ฟังก์ชันนี้ sync ทั้งหมด)
 * ไม่โยน error (ทุกทางคืน {ok:false, reason}) · ไม่อ่าน env · ฉีด fs/now/pid/host/isPidAlive ได้ (เทสไม่แตะไฟล์ระบบจริง)
 */
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BROWSER_LOCK_FILE = 'research-agent-browser.lock';
/** ไฟล์อ่านไม่ออก (อาจกำลังถูกเขียนโดยโปรเซสอื่น) ต้องเก่ากว่านี้ก่อนถือว่าค้าง */
export const CORRUPT_GRACE_MS = 60_000;

/** pid ยังมีชีวิตไหม (signal 0 = ตรวจอย่างเดียว ไม่ส่งสัญญาณจริง · EPERM = มีอยู่แต่ไม่มีสิทธิ์ = ยังมีชีวิต) */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return !!(e && e.code === 'EPERM');
  }
}

/** อ่านไฟล์ล็อก → object | null (ไม่มีไฟล์/อ่านไม่ออก) */
export function readBrowserLock(file, fs = nodeFs) {
  try {
    const j = JSON.parse(String(fs.readFileSync(file, 'utf8')));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

function fileAgeMs(file, fs, now) {
  try { return now() - fs.statSync(file).mtimeMs; } catch { return 0; }
}

/** เหตุที่ล็อกปัจจุบันถือว่าค้าง (null = ยังมีเจ้าของจริง → ห้ามแย่ง) */
export function staleReason(cur, { file, staleMs, heldInProcess, fs, now, pid, host, isPidAlive }) {
  if (!cur) return fileAgeMs(file, fs, now) > CORRUPT_GRACE_MS ? 'ไฟล์ล็อกอ่านไม่ออก' : null;
  const sameHost = String(cur.host || '') === String(host);
  if (sameHost && cur.pid === pid) return heldInProcess(String(cur.jobId || '')) ? null : 'ค้างจากงานก่อนในโปรเซสนี้';
  if (sameHost && !isPidAlive(cur.pid)) return 'โปรเซสเจ้าของล็อกจบไปแล้ว';
  const at = Date.parse(String(cur.at || ''));
  const age = Number.isFinite(at) ? now() - at : fileAgeMs(file, fs, now);
  if (Number.isFinite(staleMs) && staleMs > 0 && age > staleMs) return `ถือนานเกิน ${Math.round(staleMs / 60000)} นาที`;
  return null;
}

/** ปล่อยล็อก — ลบเฉพาะเมื่อไฟล์ยังเป็นของงานนี้ (ถูกยึดไปแล้ว = ไม่ลบของคนอื่น) · คืน true เมื่อลบจริง */
export function releaseBrowserLock({ file, jobId, pid = process.pid, fs = nodeFs }) {
  const cur = readBrowserLock(file, fs);
  if (!cur || cur.pid !== pid || String(cur.jobId || '') !== String(jobId || '')) return false;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * ขอล็อกเบราว์เซอร์ให้งานหนึ่ง — ไม่โยน error
 * @param {object} p
 * @param {string} p.file           path ไฟล์ล็อก
 * @param {string} p.jobId
 * @param {string} [p.workerId]
 * @param {number} p.staleMs        อายุล็อกที่ถือว่าค้าง (ms)
 * @param {(jobId:string)=>boolean} [p.heldInProcess]  งาน jobId ในโปรเซสนี้ยังถือล็อกอยู่ไหม (ไม่ส่ง = ถือว่าถือ)
 * @returns {{ok:true, takeover:object|null, release:()=>boolean} | {ok:false, holder:object|null, reason:string}}
 */
export function acquireBrowserLock({
  file, jobId, workerId = '', staleMs, heldInProcess = () => true,
  fs = nodeFs, now = Date.now, pid = process.pid, host = os.hostname(), isPidAlive = pidAlive,
}) {
  const mine = { pid, host: String(host), workerId: String(workerId || ''), jobId: String(jobId || ''), at: new Date(now()).toISOString() };
  let takeover = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(mine), { encoding: 'utf8', flag: 'wx' });
      return { ok: true, takeover, release: () => releaseBrowserLock({ file, jobId: mine.jobId, pid, fs }) };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return { ok: false, holder: null, reason: `สร้างไฟล์ล็อกไม่ได้ (${(e && e.code) || 'error'})` };
    }
    if (attempt > 0) break;
    const cur = readBrowserLock(file, fs);
    const why = staleReason(cur, { file, staleMs, heldInProcess, fs, now, pid, host: String(host), isPidAlive });
    if (!why) return { ok: false, holder: cur, reason: 'มีงานอื่นใช้อยู่' };
    // ยึดคืน: อ่านซ้ำก่อนลบ — ถ้าเปลี่ยนไปแล้ว (มีคนยึดก่อน) ห้ามลบของเขา
    const again = readBrowserLock(file, fs);
    if (JSON.stringify(again) !== JSON.stringify(cur)) return { ok: false, holder: again, reason: 'มีงานอื่นยึดล็อกไปก่อน' };
    try { fs.rmSync(file, { force: true }); } catch (e) {
      return { ok: false, holder: cur, reason: `ลบล็อกค้างไม่ได้ (${(e && e.code) || 'error'})` };
    }
    takeover = { ...(cur || {}), staleReason: why };
  }
  return { ok: false, holder: readBrowserLock(file, fs), reason: 'มีงานอื่นยึดล็อกไปก่อน' };
}
