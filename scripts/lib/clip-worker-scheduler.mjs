/**
 * ตัวจัดคิวรับงานขนานของ clip-worker — มาตรการ F (เจ้าของเคาะ 9 ก.ย. 69 "วันนึงต้องทำหลายงาน")
 * ────────────────────────────────────────────────────────────────────────────
 * แยกออกมาจาก scripts/clip-worker.mjs เพื่อให้ข้อสอบกัดตรรกะขนานได้จริงด้วย mock
 * สัญญา:
 *   - รับงานพร้อมกันได้สูงสุด `concurrency` งาน (1 = พฤติกรรมเดิมทีละงาน)
 *   - pause = หยุด "หยิบงานใหม่" เท่านั้น งานที่ทำอยู่ทำต่อจนจบ (สัญญาเดิมของไฟล์ธง 8 ก.ย.)
 *   - pullJob ล้ม = ถอย errMs · คิวว่าง = ถอย idleMs (มีงานเสร็จระหว่างรอ = ตื่นเร็วขึ้นได้ ไม่เสียหาย)
 *   - runJob ต้องจับ error เองทั้งหมด — ถ้าหลุดมาถึงนี่ จับลง log แล้วปล่อยช่องว่าง ไม่ล้มทั้ง worker
 */

export function clampConcurrency(raw, { max = 4 } = {}) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : 1;
}

export async function runWorkerLoop({
  concurrency = 1, pullJob, runJob, isPaused = () => false,
  idleMs = 5000, errMs = 8000, sleep, log = () => {},
  onPause = () => {}, onResume = () => {},
  shouldStop = () => false, // ใช้ในข้อสอบเท่านั้น — โปรดักชันวนตลอด
}) {
  const inflight = new Set();
  // รอ "ช่องว่างหรือครบเวลา" — ห้าม race กับ Set ว่าง (Promise.race([]) ค้างตลอดกาล)
  const waitSlotOrTimer = (ms) => (inflight.size ? Promise.race([...inflight, sleep(ms)]) : sleep(ms));
  let pausedLogged = false;
  while (!shouldStop()) {
    if (isPaused()) {
      if (!pausedLogged) { onPause(); pausedLogged = true; }
      await waitSlotOrTimer(idleMs);
      continue;
    }
    if (pausedLogged) { onResume(); pausedLogged = false; }
    if (inflight.size >= concurrency) {
      await Promise.race([...inflight]);
      continue;
    }
    let job = null;
    let pullFailed = false;
    try { job = await pullJob(); }
    catch (e) { pullFailed = true; log('pull-error', e); }
    if (pullFailed) { await waitSlotOrTimer(errMs); continue; }
    if (!job) { await waitSlotOrTimer(idleMs); continue; }
    const p = Promise.resolve()
      .then(() => runJob(job))
      .catch((e) => log('job-crash', e))
      .finally(() => inflight.delete(p));
    inflight.add(p);
  }
  // ทางออกของข้อสอบ: รองานค้างให้จบก่อนคืน เพื่อไม่ให้ mock รั่วข้ามเทส
  await Promise.allSettled([...inflight]);
}
