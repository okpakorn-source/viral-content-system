// ============================================================
// 🛡️ imgAirlock.js — พ่อแม่ห้องนิรภัยแปลงภาพ (เฟส "กันภาพพิษฆ่าเซิร์ฟ", 30 ก.ค. 69)
// ------------------------------------------------------------
// สั่ง spawn scripts/img-airlock-worker.mjs (โปรเซสลูกแยก) ป้อนภาพทีละใบผ่าน stdin (JSON line + base64) รอ
// ตอบทาง stdout — ถ้าลูก "ตาย" (exit ≠0 หรือ signal) ระหว่างรอตอบใบไหน = รู้ทันทีว่าใบนั้นคือภาพพิษ (native
// buffer overrun ที่ JS จับไม่ได้) → blacklist ใบนั้น + log ชัด + spawn ลูกใหม่ทำใบที่เหลือต่อ (เซิร์ฟหลักไม่ตาย
// เพราะ crash เกิดใน "โปรเซสอื่น" ตลอด)
//
// batch ต่อ child (ไม่ spawn ต่อใบ) — child 1 ตัวประมวลได้หลายใบต่อเนื่องกัน (spawn ใหม่เฉพาะตอนลูกตายจริง)
// kill-switch: MEGA_IMG_AIRLOCK (default ON, '0' = ข้ามทั้งชั้น — caller ใช้เส้นเดิม in-process ตรงๆ)
// ============================================================

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

const WORKER_PATH = path.join(process.cwd(), 'scripts', 'img-airlock-worker.mjs');

export function airlockOn() { return process.env.MEGA_IMG_AIRLOCK !== '0'; }

// ★ test seam (เหมือน _deps ทั่วทั้งคลัง): workerPath override ให้เทสจำลอง child crash ได้จริงด้วยสคริปต์ลูก
//   ปลอมที่ตั้งใจ process.exit()/throw กลางรายการ — production ไม่ส่ง = ใช้ worker จริงเป๊ะเสมอ
function spawnWorker(workerPath) {
  const child = spawn(process.execPath, [workerPath || WORKER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  child.stderr.on('data', () => {}); // เงียบ stderr ของลูก (ไม่ใช่ crash log ที่ต้องใช้ — exit code/signal พอ) กัน buffer ค้าง
  return child;
}

function timeoutPromise(ms) {
  return new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), ms));
}

/**
 * ประมวลภาพหลายใบผ่านห้องนิรภัย (โปรเซสลูก) — batch เดียวใช้ child เท่าที่จำเป็น (respawn เฉพาะตอนตาย)
 * @param {Array<{id:string, buf:Buffer}>} items
 * @param {{timeoutMs?:number, _workerPath?:string}} opts
 * @returns {Promise<Array<{id:string, ok:boolean, buf?:Buffer, width?:number, height?:number,
 *   dHash64?:string, sharpness?:number, error?:string, poisoned?:boolean}>>}
 */
export async function runAirlockBatch(items, { timeoutMs, _workerPath } = {}) {
  const TIMEOUT_MS = Math.max(1000, parseInt(timeoutMs ?? process.env.MEGA_IMG_AIRLOCK_TIMEOUT_MS ?? '15000', 10));
  const list = Array.isArray(items) ? items.filter((it) => it && it.id != null && Buffer.isBuffer(it.buf)) : [];
  const resultsById = new Map();
  let cursor = 0;
  const MAX_SPAWNS = list.length + 3; // เพดานกันวนไม่รู้จบถ้าลูกพังตั้งแต่ต้น (เช่น worker script เสียเอง)
  let spawns = 0;

  while (cursor < list.length && spawns < MAX_SPAWNS) {
    spawns++;
    const child = spawnWorker(_workerPath);
    const rl = createInterface({ input: child.stdout, terminal: false, crlfDelay: Infinity });
    let childAlive = true;
    let exitInfo = null;
    // ★ 30 ก.ค. 69 (แก้บั๊กพบระหว่างเบนช์มาร์ก): เดิมสร้าง child.once('exit'/'error') "ใหม่ทุกใบ" ในลูปข้างล่าง
    //   — ใบที่ไม่ตาย listener ที่ยังไม่ยิงจะค้างสะสมตลอดอายุ child ตัวนี้ (แบตช์ใหญ่ = MaxListenersExceededWarning
    //   จริง วัดได้ตอนเบนช์ N=15 → "11 exit/error listeners") แก้โดยสร้าง deathPromise "ครั้งเดียวต่อ child"
    //   แล้วใช้ Promise เดียวกัน race ซ้ำได้ทุกใบ (Promise race ซ้ำได้ไม่จำกัดครั้งโดยไม่เพิ่ม listener ใหม่)
    const deathPromise = new Promise((resolve) => {
      child.once('exit', (code, signal) => { childAlive = false; exitInfo = { code, signal }; resolve({ __death: true, code, signal }); });
      child.once('error', (err) => { childAlive = false; exitInfo = { code: null, signal: null, err }; resolve({ __death: true, err }); });
    });

    for (; cursor < list.length; cursor++) {
      if (!childAlive) break; // เผื่อลูกตายระหว่างรอ (event loop tick) ก่อนถึงคิวถัดไป — ออกไป respawn
      const item = list[cursor];
      const responsePromise = new Promise((resolve) => {
        const onLine = (line) => {
          let msg;
          try { msg = JSON.parse(line); } catch { return; }
          if (msg && msg.id === item.id) { rl.off('line', onLine); resolve(msg); }
        };
        rl.on('line', onLine);
      });
      try {
        child.stdin.write(JSON.stringify({ id: item.id, dataB64: item.buf.toString('base64') }) + '\n');
      } catch {
        // เขียน stdin ไม่ได้ (ลูกตายไปแล้วพอดี) — ถือเป็นภาพพิษเหมือนกัน ป้องกันค้าง
        resultsById.set(item.id, { id: item.id, ok: false, poisoned: true, error: 'stdin_write_failed (child อาจตายไปแล้ว)' });
        break;
      }
      const winner = await Promise.race([responsePromise, deathPromise, timeoutPromise(TIMEOUT_MS)]);
      if (winner && winner.__death) {
        console.warn(`[img-airlock] 🧟 ภาพพิษ: id=${item.id} (child ตาย code=${winner.code ?? '-'} signal=${winner.signal ?? '-'}${winner.err ? ' err=' + String(winner.err?.message || winner.err) : ''}) — blacklist ใบนี้ แล้ว respawn ทำต่อจากใบถัดไป`);
        resultsById.set(item.id, { id: item.id, ok: false, poisoned: true, error: `child crashed (exit ${winner.code ?? '-'}/${winner.signal ?? '-'})` });
        cursor++; // ใบนี้จบแล้ว (พิษ) — เริ่มลูกใหม่จากใบถัดไป
        break;
      }
      if (winner && winner.__timeout) {
        console.warn(`[img-airlock] ⏱️ ภาพพิษ (timeout ${TIMEOUT_MS}ms): id=${item.id} — blacklist ใบนี้ ฆ่า+respawn ลูกใหม่ทำต่อ`);
        resultsById.set(item.id, { id: item.id, ok: false, poisoned: true, error: `timeout after ${TIMEOUT_MS}ms` });
        try { child.kill(); } catch { /* ยอมรับ ล้มไม่กระทบ */ }
        cursor++;
        break; // ลูกอาจค้าง/กำลังจะตาย — ปลอดภัยกว่าถ้า respawn ใหม่ทั้งที
      }
      // ตอบปกติ (ลูกยังไม่ตาย) — ok:true/false ก็ตาม ไม่ใช่ภาพพิษระดับ process
      if (winner.ok) {
        let buf = null;
        try { buf = Buffer.from(winner.dataB64 || '', 'base64'); } catch { buf = null; }
        resultsById.set(item.id, {
          id: item.id, ok: !!buf, buf: buf || undefined,
          width: winner.width ?? null, height: winner.height ?? null,
          dHash64: winner.dHash64 ?? null, sharpness: winner.sharpness ?? null,
        });
      } else {
        resultsById.set(item.id, { id: item.id, ok: false, error: winner.error || 'unknown_error' });
      }
    }
    try { rl.close(); } catch { /* no-op */ }
    if (childAlive) {
      try { child.stdin.end(); } catch { /* no-op */ }
      try { child.kill(); } catch { /* no-op */ }
    }
  }
  // ใบที่ไม่เคยถูกประมวล (เช่นชนเพดาน MAX_SPAWNS จริงๆ — เคสหายากมาก) → ผลลัพธ์ safe-default ไม่ throw
  const out = list.map((it) => resultsById.get(it.id) || { id: it.id, ok: false, error: 'ไม่ได้ประมวล (เกินเพดาน respawn)' });
  // ★ ตัวนับสรุปต่อแบตช์ (Opus audit 30 ก.ค. ข้อ (ค)): failOn เข้มขึ้น+guard ใหม่ = มีใบถูกปัดที่เส้นเดิมเคยรับ
  //   ต้องมีบรรทัดเดียวตอบได้เสมอว่า "ปัดทิ้งกี่ใบ เพราะอะไร" — ไม่งั้นพูลหดแบบไม่มีใครรู้สาเหตุ
  const _rej = out.filter((r) => !r.ok);
  if (_rej.length) {
    const _poison = _rej.filter((r) => r.poisoned).length;
    const _guard = _rej.filter((r) => String(r.error || '').startsWith('guard:')).length;
    const _other = _rej.length - _poison - _guard;
    console.warn(`[img-airlock] 📊 สรุปแบตช์: ปัดทิ้ง ${_rej.length}/${out.length} ใบ (พิษ/crash ${_poison} · guard ${_guard} · decode-fail ${_other})`);
  }
  return out;
}
