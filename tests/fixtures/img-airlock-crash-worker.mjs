// ============================================================
// 🧪 img-airlock-crash-worker.mjs — worker ปลอมสำหรับเทสจำลอง "child ตายกลางรายการ"
// ------------------------------------------------------------
// ทำโปรโตคอลเดียวกับ scripts/img-airlock-worker.mjs จริงทุกอย่าง (รับ {id,dataB64} ทาง stdin,
// ตอบ {id,ok,...} ทาง stdout) ยกเว้นข้อเดียว: ถ้า id ที่ได้รับ ขึ้นต้นด้วย 'POISON' จะ process.exit(1) ทันที
// (จำลอง native buffer overrun แบบ 0xC0000409 — ตายทั้งโปรเซสไม่มีบรรทัดตอบ) ใบอื่นตอบ ok:true ปกติ
// (ขึ้นต้นด้วย ไม่ใช่ === เป๊ะ — เผื่อเทสต้องมีภาพพิษหลายใบต่างกันในแถวเดียว เช่น POISON-1, POISON-2)
// (ค่า dummy ไม่ได้ decode จริง — ไม่ต้องพึ่ง sharp/imageAirlockCore เพื่อความง่าย/เร็วของเทส)
//
// ใช้ผ่าน runAirlockBatch(items, { _workerPath: <path นี้> }) เท่านั้น (test-only seam ใน imgAirlock.js)
// ============================================================

import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });

rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch { return; }
  if (!msg || typeof msg.id === 'undefined') return;

  if (typeof msg.id === 'string' && msg.id.startsWith('POISON')) {
    // จำลอง native crash: ตายทันทีไม่ตอบบรรทัดใดๆ (เหมือน 0xC0000409 จริง)
    process.exit(1);
  }

  // ★ Opus audit 30 ก.ค.: เคสขอบ "ตายหลังตอบใบสุดท้ายแล้ว" — ตอบ ok:true ปกติก่อน แล้วค่อยตายหลัง flush
  //   (ห้ามมีใบไหนถูกใส่ร้ายเป็นพิษย้อนหลัง — จับบั๊ก off-by-one แบบโทษใบสุดท้าย)
  if (typeof msg.id === 'string' && msg.id.startsWith('DIE-AFTER-REPLY')) {
    const res = {
      id: msg.id, ok: true,
      dataB64: Buffer.from('fake-clean-bytes-' + msg.id).toString('base64'),
      width: 100, height: 100, dHash64: 'deadbeefdeadbeef', sharpness: 42,
    };
    process.stdout.write(JSON.stringify(res) + '\n', () => process.exit(1));
    return;
  }

  const res = {
    id: msg.id, ok: true,
    dataB64: Buffer.from('fake-clean-bytes-' + msg.id).toString('base64'),
    width: 100, height: 100, dHash64: 'deadbeefdeadbeef', sharpness: 42,
  };
  process.stdout.write(JSON.stringify(res) + '\n');
});

process.stdin.resume();
