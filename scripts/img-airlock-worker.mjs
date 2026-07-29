// ============================================================
// 🛡️ img-airlock-worker.mjs — โปรเซสลูกห้องนิรภัยแปลงภาพ (เฟส "กันภาพพิษฆ่าเซิร์ฟ", 30 ก.ค. 69)
// ------------------------------------------------------------
// รันเป็น "โปรเซสแยก" จากเซิร์ฟหลักเสมอ (spawn ผ่าน src/lib/imgAirlock.js) — เหตุผลที่ต้องแยกโปรเซส:
//   native buffer overrun (node exit 0xC0000409) ใน libvips/sharp เป็นการ "ตายทั้งโปรเซส" ไม่ใช่ JS exception
//   → JS try/catch ในเซิร์ฟหลักจับไม่ได้เด็ดขาด วิธีเดียวที่ป้องกันเซิร์ฟหลักได้จริงคือให้การตายเกิดใน "โปรเซสอื่น"
//   แล้วให้พ่อแม่ (parent) สังเกตการตายนั้นจากภายนอก (exit event) แทนการรอ throw
//
// โปรโตคอล (JSON line ผ่าน stdin/stdout — ไม่ใช้ temp file กันโอเวอร์เฮดดิสก์ I/O ต่อภาพ):
//   รับ: {"id":"...", "dataB64":"<base64 ของ buffer ดิบ>"}\n  (1 บรรทัด/1 ภาพ ประมวลทีละใบตามลำดับที่รับ)
//   ตอบสำเร็จ: {"id":"...", "ok":true, "dataB64":"<base64 ของ buffer สะอาด>", "width":N, "height":N,
//              "dHash64":"...", "sharpness":N}\n
//   ตอบล้ม (malformed แต่ JS จับได้ ไม่ crash): {"id":"...", "ok":false, "error":"..."}\n
//   ตอบล้มเพราะเกิน guard: {"id":"...", "ok":false, "error":"guard:<reason>"}\n
//   ภาพพิษจริง (native crash) = ไม่มีบรรทัดตอบเลย โปรเซสตายไปเลย — parent (imgAirlock.js) เป็นคนตรวจจับ
//
// 🔴 ห้าม AI เจน/แต่งภาพ: reencodeCleanImage = decode+re-encode format ล้วน (เหมือน resize/crop ที่กฎอนุญาต)
//   ไม่มี GAN/upscale/inpaint ใดๆ — ดู imageAirlockCore.js สำหรับรายละเอียดเต็ม
// ============================================================

import { createInterface } from 'node:readline';
import { imageGuardCheck, safeSharpOpts, reencodeCleanImage, computeDHash64, computeSharpness } from '../src/lib/imageAirlockCore.js';

const GUARD_ON = process.env.MEGA_IMG_GUARD !== '0'; // ★ ลูกเคารพสวิตช์เดียวกับพ่อแม่ (env สืบทอดผ่าน spawn ปกติ)
const rl = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });

async function handleOne(msg) {
  const { id } = msg;
  let buf;
  try {
    buf = Buffer.from(msg.dataB64 || '', 'base64');
  } catch (e) {
    return { id, ok: false, error: 'base64_decode_failed:' + String(e?.message || e).slice(0, 100) };
  }
  // ชั้น 1 ซ้ำในลูกด้วย (เผื่อพ่อแม่ปิด guard แต่ลูกยังอยากกันตัวเอง — เข้มกว่าเสมอไม่เสียหาย) — ไม่ throw
  const g = imageGuardCheck(buf);
  if (!g.ok) return { id, ok: false, error: 'guard:' + g.reason };

  const opts = safeSharpOpts(GUARD_ON);
  // จุดเสี่ยงจริง (native decode ครั้งแรกของบัฟเฟอร์ดิบจากเว็บ) — ถ้า crash ตรงนี้ พ่อแม่จะเห็น exit event
  //   แทนที่ response line (ไม่มีทาง JS จับ native crash ได้ — นี่คือเหตุผลทั้งหมดที่ต้องมีโปรเซสลูก)
  const clean = await reencodeCleanImage(buf, opts); // อาจ throw (malformed แต่ JS จับได้) — ปล่อยให้ catch ข้างล่างจับ
  // 🔴 dHash/sharpness ต้องคำนวณจาก buffer "ดิบ" เท่านั้น (Opus audit 30 ก.ค.: คำนวณจากตัว re-encode ทำ hash
  //   ดริฟท์จริงกับภาพถ่าย — โพรบ ref-mrbq661b-4kjq ได้ hamming=2, sharpness ดริฟท์ทุกใบ) — ค่า pHash ทั้งคลัง
  //   คำนวณจากดิบมาตลอด ถ้าเปลี่ยนแหล่ง = ด่าน dedup/คลังเพี้ยนเงียบทั้งระบบ · ปลอดภัยเพราะบรรทัดนี้อยู่ "หลัง"
  //   re-encode สำเร็จแล้ว (decode ดิบรอบสองบนภาพที่เพิ่งผ่าน decode มาแล้ว — ถ้ายัง crash ได้จริง เราอยู่ในลูก
  //   การตายถูกดูดซับเป็น "ภาพพิษ" ตามดีไซน์อยู่ดี)
  const [dHash64, sharpness] = await Promise.all([
    computeDHash64(buf, opts),
    computeSharpness(buf, opts),
  ]);
  return {
    id, ok: true,
    dataB64: clean.buf.toString('base64'),
    width: clean.width, height: clean.height,
    dHash64, sharpness,
  };
}

rl.on('line', async (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch { return; } // บรรทัดพัง (ไม่ใช่ JSON) = ข้ามเงียบ ไม่มี id ให้ตอบ
  if (!msg || typeof msg.id === 'undefined') return;
  let res;
  try {
    res = await handleOne(msg);
  } catch (e) {
    // malformed ที่ JS จับได้ (ไม่ใช่ native crash) — ตอบ ok:false แทนปล่อยให้โปรเซสตายฟรีๆ
    res = { id: msg.id, ok: false, error: String(e?.message || e).slice(0, 200) };
  }
  process.stdout.write(JSON.stringify(res) + '\n');
});

process.stdin.resume();
