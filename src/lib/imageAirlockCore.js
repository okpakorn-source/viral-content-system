// ============================================================
// 🛡️ imageAirlockCore.js — ห้องนิรภัยแปลงภาพ (เฟส "กันภาพพิษฆ่าเซิร์ฟ", 30 ก.ค. 69)
// ------------------------------------------------------------
// บริบท: :3900 ตายซ้ำ 10+ ครั้ง/สัปดาห์ (node exit 0xC0000409 — fail-fast buffer overrun ใน native/libvips)
//   ทุกครั้งจังหวะเดียวกัน: S5 ประมวลภาพที่โหลดจากเว็บ (หลัง brains จบ) — คือจุดที่ sharp() decode buffer ดิบจาก
//   เว็บตรงๆ เป็นครั้งแรก (libraryTriage.js loadOne/toB64/computeSharpness/computeDHash64) ภาพ "พิษ" (malformed/
//   หลอก magic byte/มิติเว่อร์) ทำให้ decoder ระดับ native crash ทั้งโปรเซส — JS try/catch จับไม่ได้เพราะเป็น
//   process ตายจริง ไม่ใช่ exception
// ไฟล์นี้ = PURE ล้วน (ไม่มี IO/network/AI — import แค่ sharp) ให้ทั้ง libraryTriage.js (in-process) และ
//   scripts/img-airlock-worker.mjs (โปรเซสลูกแยก) ใช้ฟังก์ชันชุดเดียวกัน ไม่ก็อปปี้อัลกอริทึมให้ดริฟท์กัน
//
// 2 ชั้นป้องกัน (เป็นอิสระจากกัน เปิด/ปิดแยกได้):
//   ชั้น 1 (MEGA_IMG_GUARD, ถูก, in-process): magic-byte allowlist (JPEG/PNG/WebP/GIF เท่านั้น — ปฏิเสธ
//     AVIF/HEIC/BMP/TIFF/SVG/อื่นๆ) + เพดานขนาดไฟล์ + sharp limitInputPixels/failOn ตั้งค่าปลอดภัยกว่าเดิม
//     (เดิม failOn:'none' ทั้งไฟล์ — ยอมทุกอย่างแม้ข้อมูล truncated ซึ่งเป็นสาเหตุ crash ที่พบบ่อยที่สุดของ
//     libvips/sharp ในโลกจริง) — เร็ว ไม่มี IO เพิ่ม แต่ป้องกันได้แค่คลาสที่ JS-level ตรวจจับได้
//   ชั้น 2 (MEGA_IMG_AIRLOCK, โปรเซสลูก): ภาพที่ผ่านชั้น 1 แล้ว decode+re-encode จริงในโปรเซสแยก (scripts/
//     img-airlock-worker.mjs ผ่าน src/lib/imgAirlock.js) — ลูก crash ไม่กระทบเซิร์ฟหลัก เพราะเป็นคนละ OS process
//     (นี่คือเกราะจริงที่ป้องกัน native buffer overrun ได้ — ชั้น 1 ป้องกันไม่ได้เพราะเป็นบั๊กระดับ decoder เอง)
// ============================================================

import sharp from 'sharp';

// ── ชั้น 1: magic-byte allowlist ──────────────────────────────────────────
// ตรวจ signature ไบต์แรกจริง (ไม่เชื่อนามสกุลไฟล์/Content-Type ที่เว็บอาจโกหก) — allowlist เท่านั้น
// (default-reject) กัน AVIF/HEIC (ftyp box แปลกๆ ที่ sharp เวอร์ชันเก่า/build บางแพลตฟอร์มยังไม่เสถียร)
export function detectImageMagic(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
    && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'gif';
  return null; // ไม่รู้จัก/AVIF/HEIC/BMP/TIFF/SVG ฯลฯ = ปฏิเสธเสมอ (allowlist ไม่ใช่ blocklist)
}

// เพดานขนาดไฟล์ดิบ (ก่อน decode) — กันไฟล์ยักษ์กินแรม/เวลาจนกลายเป็นอีกรูปแบบ DoS
export const IMG_GUARD_MAX_BYTES = Math.max(1_000_000, parseInt(process.env.MEGA_IMG_MAX_BYTES || String(20 * 1024 * 1024), 10));
// เพดานจำนวนพิกเซลรวม (width×height) — กัน "decompression bomb" (ไฟล์เล็กแต่ header ประกาศมิติมหาศาล
//   ทำให้ sharp พยายาม allocate บัฟเฟอร์เว่อร์จนแรมพัง/crash) — ~60MP กว้างพอสำหรับภาพข่าวจริงทุกกรณี
export const IMG_GUARD_MAX_PIXELS = Math.max(1_000_000, parseInt(process.env.MEGA_IMG_MAX_PIXELS || String(60_000_000), 10));

// ตรวจด่านชั้น 1 ทั้งชุด — คืน {ok:true, magic} หรือ {ok:false, reason}
export function imageGuardCheck(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, reason: 'empty_buffer' };
  if (buf.length > IMG_GUARD_MAX_BYTES) return { ok: false, reason: `too_large:${buf.length}` };
  const magic = detectImageMagic(buf);
  if (!magic) return { ok: false, reason: 'unknown_magic' };
  return { ok: true, magic };
}

// options ปลอดภัยสำหรับ sharp() — ใช้แทน {failOn:'none'} เดิมเมื่อเปิด MEGA_IMG_GUARD (caller เช็ค env เอง
//   แล้วส่ง guardOn มา — ไฟล์นี้ไม่อ่าน process.env เอง ยกเว้นค่าคงที่ 2 ตัวด้านบน ซึ่งเป็น "ค่าคงที่ตอน import"
//   ไม่ใช่การตัดสินใจ on/off ของสวิตช์หลัก)
//   'truncated' = ปฏิเสธเฉพาะข้อมูลที่ขาดหาย/EOF ก่อนกำหนด (สาเหตุ crash ที่พบบ่อยสุดของ libvips ในโลกจริง)
//   ยังคงยอม warning เล็กๆ น้อยๆ ผ่าน (EXIF ผิดปกติ ฯลฯ) ไม่เข้มจนตัดภาพข่าวจริงที่ไม่มีปัญหาออกเกินจำเป็น
export function safeSharpOpts(guardOn) {
  return guardOn ? { failOn: 'truncated', limitInputPixels: IMG_GUARD_MAX_PIXELS } : { failOn: 'none' };
}

// ── ชั้น 2: ฟังก์ชันที่โปรเซสลูก (img-airlock-worker.mjs) เรียกจริง — ต้อง PURE ทั้งหมด ──

// ★ 9 ก.ค. เฟส 2.1 (ย้ายมาจาก libraryTriage.js — เดิมชื่อเดียวกันเป๊ะ ไม่เปลี่ยนอัลกอริทึม): Laplacian variance
export async function computeSharpness(buf, opts = {}) {
  try {
    const { data } = await sharp(buf, opts)
      .greyscale()
      .resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const n = data.length;
    if (!n) return null;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += data[i];
    const mean = sum / n;
    let sq = 0;
    for (let i = 0; i < n; i++) { const d = data[i] - mean; sq += d * d; }
    return Math.round((sq / n) * 100) / 100;
  } catch {
    return null;
  }
}

// ★ Wave3 ชุด2 (ย้ายมาจาก libraryTriage.js — อัลกอริทึมเดิมเป๊ะ): dHash 64 บิต
export async function computeDHash64(buf, opts = {}) {
  try {
    const raw = await sharp(buf, opts)
      .resize(9, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();
    if (!raw || raw.length < 72) return null;
    let bits = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = raw[y * 9 + x];
        const right = raw[y * 9 + x + 1];
        bits += (left > right) ? '1' : '0';
      }
    }
    let hex = '';
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  } catch {
    return null;
  }
}

// ★ ใหม่ (airlock เฟสนี้): decode + re-encode เป็น JPEG/PNG "สะอาด" — 🔴 ห้ามตีความว่าเป็นการเจน/แต่งภาพ
//   (กฎเหล็ก AGENTS.md §6) — นี่คือ "แปลง format ล้วน" (decode รูปเดิม → เขียนไฟล์ใหม่ pixel เดิมทุกจุด ไม่มี
//   AI/GAN/upscale/inpaint ใดๆ เจือปน) เทียบเท่า resize/crop ที่กฎอนุญาตไว้แล้ว — แค่ "คัดลอกใหม่ให้สะอาด"
//   ไม่ใช่ "สร้างใหม่" · เลือก PNG เมื่อมี alpha (กันโปร่งใสหาย) ไม่งั้น JPEG q92 (ใกล้ lossless พอ ลด
//   generation-loss สะสม) · คืน null เมื่อ decode ไม่ได้ (malformed จริง — ให้ caller ตัดสินใจว่าจะทิ้งใบนี้)
export async function reencodeCleanImage(buf, opts = {}) {
  const img = sharp(buf, opts);
  const meta = await img.metadata(); // อาจ throw (malformed) — ให้ caller จับ
  const hasAlpha = !!meta.hasAlpha;
  const out = hasAlpha
    ? await sharp(buf, opts).png().toBuffer()
    : await sharp(buf, opts).jpeg({ quality: 92 }).toBuffer();
  return { buf: out, width: meta.width || null, height: meta.height || null, hasAlpha };
}
