// ============================================================
// [ระบบทำปกออโต้] คัดกรองคลังทั้งใบ (Full Library Triage)
// ------------------------------------------------------------
// วน "ตา" (Gemini) ดูทุกรูปในคลัง → ติดป้ายถาวรต่อรูป:
//   relevant (เกี่ยวข่าวนี้ไหม) / person / category / quality / emotion / clean / faceBox
// ทำครั้งเดียว cache ที่ imageStore → ทำปก/กรองคลังเร็ว+แม่นขึ้น
// ประมวลทีละ batch (โหลด base64 → classify → map) รายงานความคืบหน้า
// ============================================================

import sharp from 'sharp';
import { types as nodeUtilTypes } from 'node:util';
import { loadImageBuffer } from './imageBuffer.js';
import {
  geminiClassifyFrames, resolveGeminiClassifierPin,
  sanitizeStrictClassifierItem, isValidClassifierEvidence,
  computeUnguardedScore, // ★ MEGA_UNGUARDED_TAG (30 ก.ค. 69) — คะแนน "จังหวะธรรมชาติ" 0-3 (pure, ครบ 4 ช่องเท่านั้นถึงคำนวณ)
} from './gemini.js';
import { applyRehost } from './imageStore.js';
// ★ 26 ก.ค. 69 (เจ้าของอนุมัติ mapping): ตาสายปก gemini-2.5-flash → gemini-3.6-flash เฉพาะ vetImages/triageLibrary
import { COVER_GEMINI_MODEL } from './coverVisionModel.js';
// ★ Wave2 Batch B1 (10 ก.ค.): เกณฑ์ตัวเลขย้ายไป imageQualityConfig.js (single source of truth) — ค่าเดิมเป๊ะ
import { QUALITY_CAP_SHORT_SIDE, QUALITY_CAP_VALUE } from './imageQualityConfig.js';
// ★ Stage-A: authority-normalized facts (เพิ่มฟิลด์ nested candidateFacts แบบ additive — ไม่แตะฟิลด์/การตัดสินเดิม)
import { buildCandidateFactsV1 } from './candidateFactAuthority.js';
// ★ 30 ก.ค. 69 (เฟส "กันภาพพิษฆ่าเซิร์ฟ" — :3900 ตายซ้ำ node exit 0xC0000409 กลาง S5 ตอนนี้ๆ นี้แหละ):
//   computeSharpness/computeDHash64 ย้ายไป imageAirlockCore.js (PURE, ใช้ร่วมกับ scripts/img-airlock-worker.mjs)
//   เพื่อไม่ให้อัลกอริทึมสองที่ drift กัน — อัลกอริทึมเดิมเป๊ะ ไม่เปลี่ยน แค่ย้ายที่อยู่ + รับ opts เพิ่ม (default {})
import { computeSharpness, computeDHash64, imageGuardCheck, safeSharpOpts } from './imageAirlockCore.js';
// ★ เดิม export computeDHash64 ตรงจากไฟล์นี้ (ยืนยันด้วย grep: ไม่มีที่อื่น import ใช้ตอนนี้) — คง export ไว้เพื่อ back-compat
export { computeDHash64 };
import { airlockOn, runAirlockBatch } from './imgAirlock.js';

// ชั้น 1 (MEGA_IMG_GUARD, default ON, '0'=ปิด): magic-byte allowlist + เพดานขนาด + sharp failOn/limitInputPixels
//   ที่ปลอดภัยกว่าเดิม — อ่าน env "ทุกครั้งที่เรียก" (เหมือน FILE_TAG/BUSY_TAG ด้านล่างในไฟล์นี้) ไม่ cache ตอน import
function guardOn() { return process.env.MEGA_IMG_GUARD !== '0'; }
function guardOpts() { return safeSharpOpts(guardOn()); }

async function toB64(buf, size = 512) {
  const out = await sharp(buf, guardOpts())
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return out.toString('base64');
}

// ★ 9 ก.ค. เฟส 2.1: โหลด URL เดี่ยว (reuse loadImageBuffer เดิม — ส่งแค่ imageUrl ไม่มี fallback ในตัว)
async function loadSingleUrl(url) {
  if (!url) return null;
  return loadImageBuffer({ imageUrl: url });
}

// ★ 9 ก.ค. เฟส 2.1: หา "ขนาดจริง" ก่อนส่งภาพให้ Gemini — กันตาคัดให้คะแนนจากรูปย่อ
//   (ก) record มี realWidth/realHeight แล้ว (เฟส 1 วัดไว้ตอน rehost) → ใช้เลย ไม่ต้องโหลดซ้ำ
//   (ข) ไม่มี → ตามลำดับ imageUrl → rehostThumbUrl → thumbnailUrl วัดจาก buffer ที่โหลดได้จริง
//   คืน { realWidth, realHeight, measuredFrom: 'full'|'thumb', fresh: bool (ยังไม่เคยมีใน record) }
// ★ 30 ก.ค. 69: เพิ่ม knownDims (optional) — เมื่อห้องนิรภัยวัด width/height มาแล้วตอน re-encode ส่งมาใช้ตรงๆ
//   กันต้อง sharp().metadata() ซ้ำบน buffer เดิม (decode มาแล้วรอบหนึ่งในโปรเซสลูก) — ไม่ส่งมา (null/undefined)
//   = พฤติกรรมเดิมเป๊ะ (sharp().metadata() ตรงบนบัฟเฟอร์ เหมือนเดิมทุกประการ)
async function resolveRealSize(im, fallbackBuf, knownDims) {
  const rw = Number(im.realWidth), rh = Number(im.realHeight);
  if (rw > 0 && rh > 0) {
    return { realWidth: rw, realHeight: rh, measuredFrom: im.rehostQuality === 'thumbnail' ? 'thumb' : 'full', fresh: false };
  }
  // record ไม่มีขนาดจริง — ลองวัดจาก buffer ที่โหลดไว้แล้วสำหรับตา (loadOne) ก่อน กันโหลดซ้ำ
  //   knownThumbOnly เคสนี้จะไม่ผ่านมาถึงตรงนี้ (มี rw/rh อยู่แล้วเฉพาะ rehostQuality='full')
  try {
    if (fallbackBuf?.buf) {
      const meta = (knownDims && knownDims.width > 0 && knownDims.height > 0)
        ? knownDims
        : await sharp(fallbackBuf.buf, guardOpts()).metadata();
      if (meta.width > 0 && meta.height > 0) {
        return { realWidth: meta.width, realHeight: meta.height, measuredFrom: fallbackBuf.from === 'imageUrl' && im.rehostQuality !== 'thumbnail' ? 'full' : 'thumb', fresh: true };
      }
    }
  } catch { /* ตกไปลอง ladder เอง */ }
  return null;
}

// ★ 30 ก.ค. 69 (เฟส "กันภาพพิษฆ่าเซิร์ฟ"): แยก "โหลด buffer ดิบตาม ladder" ออกจาก loadOne — ให้ loadBatch
//   (เส้นห้องนิรภัย) reuse ได้โดยไม่ก็อปปี้ ladder logic ซ้ำ (กัน drift) — พฤติกรรมเดิมเป๊ะ ยกมาทั้งก้อนไม่เปลี่ยน
async function loadRawBuffer(im) {
  const knownThumbOnly = im.rehostQuality === 'thumbnail';
  const ladder = knownThumbOnly
    ? [{ url: im.rehostThumbUrl, from: 'rehostThumbUrl' }, { url: im.thumbnailUrl, from: 'thumbnailUrl' }, { url: im.imageUrl, from: 'imageUrl' }]
    : [{ url: im.imageUrl, from: 'imageUrl' }, { url: im.rehostThumbUrl, from: 'rehostThumbUrl' }, { url: im.thumbnailUrl, from: 'thumbnailUrl' }];
  for (const step of ladder) {
    if (!step.url) continue;
    const buf = await loadSingleUrl(step.url);
    if (buf) return { buf, loadedFrom: step.from };
  }
  return null;
}

// โหลดรูป 1 ใบ → { im, base64, brightness, detail, realWidth, realHeight, measuredFrom, sharpness }
//   (คืน null ถ้าโหลด/decode ไม่ได้)
// ★ 9 ก.ค. เฟส 2.1 (มิชชัน "ตาคัดต้องเห็นไฟล์จริง"): เดิมโหลด thumbnailUrl ก่อนเสมอ (แม้ imageUrl จะเป็นไฟล์จริง) —
//   สลับลำดับ: imageUrl (ของจริง) ก่อน แล้วค่อย rehostThumbUrl/thumbnailUrl · ยกเว้นรู้อยู่แล้วว่า rehost ได้แค่
//   thumbnail (rehostQuality='thumbnail') → ข้าม imageUrl ไปเลย (Phase 1 ลองแล้วไม่ผ่าน กันยิงซ้ำ 403 ฟรี)
// ★ 30 ก.ค. 69: เส้น "ตรง" ไม่ผ่านห้องนิรภัย — ใช้เมื่อ MEGA_IMG_AIRLOCK='0' หรือถูกเรียกตรงจากที่อื่น (สคริปต์/เทส)
//   ชั้น 1 (magic-byte/ขนาด) ยังทำงานถ้า MEGA_IMG_GUARD ไม่ได้ปิด (เร็ว ไม่มี IO เพิ่ม แต่ป้องกัน native crash ไม่ได้ —
//   ป้องกันได้จริงต้องผ่าน loadBatch+airlock เท่านั้น)
async function loadOne(im) {
  const raw = await loadRawBuffer(im);
  if (!raw) return null;
  const { buf, loadedFrom } = raw;
  if (guardOn()) {
    const g = imageGuardCheck(buf);
    if (!g.ok) return null; // ปฏิเสธชั้น 1 (ผิด magic byte/ใหญ่เกิน) → ปฏิบัติเหมือน "โหลดไม่ได้" (fail-open เดิม)
  }
  return processLoadedBuffer(im, buf, loadedFrom);
}

// ★ 30 ก.ค. 69: ส่วนประมวลผลหลังได้ buffer แล้ว (เดิมเป็นหางของ loadOne) — แยกออกมาให้ loadBatch (เส้นห้องนิรภัย)
//   เรียกต่อบน "buffer สะอาด" ที่ผ่าน decode+re-encode ในโปรเซสลูกมาแล้วได้เหมือนกัน (ไม่ต้อง decode raw ซ้ำในโปรเซสหลัก)
//   precomputed (optional): { sharpness, pHash64, width, height } — ห้องนิรภัยคำนวณมาแล้วระหว่าง re-encode (เรียก
//   ฟังก์ชัน core เดียวกันเป๊ะ — ค่า/อัลกอริทึมไม่ต่างกัน) ส่งมาเพื่อข้าม sharp() รอบที่ซ้ำซ้อนในโปรเซสหลัก
//   ไม่ส่งมา (default {}) → คำนวณเองบน buf ตรงๆ เหมือน loadOne เดิมทุกประการ (byte-parity เมื่อเรียกจาก loadOne)
async function processLoadedBuffer(im, buf, loadedFrom, precomputed = {}) {
  try {
    let brightness = 128;
    let detail = 60;
    try {
      const st = await sharp(buf, guardOpts()).stats();
      const ch = st.channels.slice(0, 3);
      if (ch.length) {
        brightness = ch.reduce((a, c) => a + c.mean, 0) / ch.length;
        detail = ch.reduce((a, c) => a + c.stdev, 0) / ch.length;
      }
    } catch {
      /* วัดไม่ได้ = ปกติ */
    }
    // ★ 9 ก.ค. เฟส 2.1: ขนาดจริง + ความคม — ใช้ buffer ที่เพิ่งโหลด (ตัวเดียวกับที่ตา Gemini จะเห็น)
    let realWidth = null, realHeight = null, measuredFrom = null;
    try {
      const knownDims = (typeof precomputed.width === 'number' && typeof precomputed.height === 'number')
        ? { width: precomputed.width, height: precomputed.height }
        : null;
      const size = await resolveRealSize(im, { buf, from: loadedFrom }, knownDims);
      if (size) {
        realWidth = size.realWidth;
        realHeight = size.realHeight;
        measuredFrom = size.measuredFrom;
        // เขียนกลับลง record เฉพาะตอน "วัดสด" ครั้งแรก (record เดิมไม่เคยมี) — กัน overwrite ค่าเฟส 1 ที่แม่นกว่า
        //   im.id อาจยังไม่มี (vetImages คัดรูป "ดิบ" ตอนค้น ก่อนเข้าคลัง) → ข้ามเขียน record เก็บแค่ใน triage
        // ★ 16 ก.ค. (P2 lane B): เติม realShortSide + measuredFrom พร้อมกันตรงจุด ingest จุดเดียว —
        //   record ที่เข้าคลังผ่านตาคัดจะมี provenance ครบเหมือนที่ backfill-image-dims.mjs เติมย้อนหลัง
        //   (measuredFrom ='full'|'thumb' จาก resolveRealSize — จริงกว่า 'backfill_probe' ของสคริปต์เติมย้อนหลัง)
        if (size.fresh && im.id) {
          const rss = (realWidth > 0 && realHeight > 0) ? Math.min(realWidth, realHeight) : undefined;
          applyRehost(im.id, {
            realWidth, realHeight, realBytes: buf.length,
            ...(rss ? { realShortSide: rss } : {}),
            ...(measuredFrom ? { measuredFrom } : {}),
          }).catch(() => {}); // best-effort ไม่บล็อกตาคัด
        }
      }
    } catch { /* วัดขนาดไม่ได้ = ปกติ ไม่บล็อกตาคัด */ }
    const sharpness = (typeof precomputed.sharpness === 'number') ? precomputed.sharpness : await computeSharpness(buf, guardOpts());
    // ★ Wave3 ชุด2 (10 ก.ค.): pHash64 จาก buffer เดียวกัน (ไม่โหลดซ้ำ) — วัดไม่ได้ = null
    const pHash64 = (typeof precomputed.pHash64 === 'string' && precomputed.pHash64) ? precomputed.pHash64 : await computeDHash64(buf, guardOpts());
    // ★ 15 ก.ค. (Batch 2B authority resolution + 2C P1-A): หลักฐานขนาดจาก "บัฟเฟอร์ที่ decode จริงตอนนี้" เท่านั้น —
    //   แยกขาดจาก realWidth/realHeight ด้านบน (ซึ่ง resolveRealSize อาจ reuse ค่าเก่าจาก record โดยไม่ decode) ·
    //   decode header ล้ม/ค่าไม่ใช่จำนวนเต็มบวก = ไม่มีหลักฐาน (null ทั้งชุด) — ห้าม reuse ขนาด legacy จาก record ·
    //   provenance ห้าม default-positive (P1-A): 'full' เฉพาะบัฟเฟอร์จาก imageUrl + marker ชัด rehostQuality==='full'
    //   (rehostQuality หาย/ค่าอื่น ≠ หลักฐาน full) · 'thumb' เฉพาะแหล่ง thumbnail ชัดแจ้ง (rehostThumbUrl/thumbnailUrl)
    //   · ระบุชั้นไม่ได้ = provenance null → buildTriage ไม่ส่ง resolution → facts ฝั่ง authority คง 'unknown'
    let decodedWidth = null, decodedHeight = null, decodedProvenance = null;
    try {
      const _dm = (typeof precomputed.width === 'number' && typeof precomputed.height === 'number')
        ? { width: precomputed.width, height: precomputed.height }
        : await sharp(buf, guardOpts()).metadata();
      if (Number.isInteger(_dm.width) && _dm.width > 0 && Number.isInteger(_dm.height) && _dm.height > 0) {
        decodedWidth = _dm.width;
        decodedHeight = _dm.height;
        if (loadedFrom === 'imageUrl') {
          decodedProvenance = im.rehostQuality === 'full' ? 'full' : null; // marker ชัดเท่านั้น — ไม่มี marker = ไม่ claim
        } else if (loadedFrom === 'rehostThumbUrl' || loadedFrom === 'thumbnailUrl') {
          decodedProvenance = 'thumb'; // แหล่ง thumbnail ชัดแจ้งโดยตัว URL ที่โหลดจริง
        }
      }
    } catch { /* ไม่มีหลักฐาน decode = ปล่อย null (fail-closed) */ }
    // ★ 8 ก.ค. (CASE-360): 512→1024 — ที่ 512px ตามองไม่เห็นลายน้ำ/ตัวหนังสือเล็ก → clean=true ผิด
    //   ปลายน้ำพังยกแผง (s6 ไม่ตัดภาพเสีย + s5e ไม่แคปเฟรม) · v3 detector ใช้ 1280px เห็นจริง — ตาคัดต้องเห็นใกล้เคียงกัน
    return { im, base64: await toB64(buf, 1024), brightness, detail, realWidth, realHeight, measuredFrom, sharpness, pHash64, decodedWidth, decodedHeight, decodedProvenance };
  } catch {
    return null;
  }
}

// ★ 30 ก.ค. 69 (เฟส "กันภาพพิษฆ่าเซิร์ฟ" — บริบท: :3900 ตายซ้ำ node exit 0xC0000409 ตอน S5 ประมวลภาพจากเว็บ):
//   โหลด "ทั้งแบตช์" แล้วส่งผ่านห้องนิรภัย (โปรเซสลูก) รวดเดียว — 1 child ต่อ 1 เรียก (ไม่ spawn ต่อภาพ) native
//   crash ที่เคยตายทั้งเซิร์ฟหลัก ตอนนี้ตายใน "โปรเซสอื่น" แทน (parent เห็น exit event → blacklist ใบนั้น +
//   respawn ทำใบที่เหลือต่อ) ภาพที่ผ่านห้องนิรภัยแล้วใช้ "บัฟเฟอร์สะอาด" ต่อทั้งสาย (โปรเซสหลักไม่แตะ raw bytes อีกเลย)
//   kill-switch: MEGA_IMG_AIRLOCK='0' → ข้ามชั้นนี้ทั้งหมด ใช้ Promise.all(map(loadOne)) เส้นเดิมเป๊ะ (byte-parity)
async function loadBatch(images) {
  if (!airlockOn()) {
    return Promise.all(images.map(loadOne)); // เส้นเดิม 100% (ชั้น 1 guard ยังทำงานถ้า MEGA_IMG_GUARD ไม่ปิด)
  }
  // โหลด raw buffer ทั้งแบตช์ก่อน (ยัง "ไม่" decode ใดๆ) — ตาม ladder เดิมทุกใบ
  const raws = await Promise.all(images.map(async (im) => {
    const r = await loadRawBuffer(im);
    return { buf: r?.buf || null, loadedFrom: r?.loadedFrom || null };
  }));
  // ชั้น 1 ก่อนส่งเข้าห้องนิรภัย (ประหยัด round-trip ถ้าเห็นชัดว่าพิษตั้งแต่ในโปรเซสหลัก) — ปฏิบัติเหมือน "โหลดไม่ได้"
  const gOn = guardOn();
  const items = [];
  raws.forEach((r, i) => {
    if (!r.buf) return;
    if (gOn) {
      const g = imageGuardCheck(r.buf);
      if (!g.ok) { raws[i] = { buf: null, loadedFrom: r.loadedFrom }; return; } // ปฏิเสธชั้น 1 = null เหมือนโหลดไม่ได้
    }
    items.push({ id: String(i), buf: r.buf });
  });
  if (!items.length) return images.map(() => null);

  let airlockResults;
  try {
    airlockResults = await runAirlockBatch(items);
  } catch (e) {
    // ห้องนิรภัยใช้งานไม่ได้เลยทั้งระบบ (เช่น spawn ENOENT) — ปลอดภัยไว้ก่อน: ตกกลับเส้นเดิมทั้งแบตช์นี้
    //   (ยอมรับความเสี่ยงเดิมกลับมาชั่วคราว ดีกว่าทำให้ภาพทั้งแบตช์หายไปเงียบๆ)
    console.warn('[img-airlock] เรียกห้องนิรภัยล้มทั้งระบบ — fallback เส้นเดิมสำหรับแบตช์นี้:', String(e?.message || e));
    return Promise.all(images.map(loadOne));
  }
  const byId = new Map(airlockResults.map((r) => [r.id, r]));

  return Promise.all(images.map(async (im, i) => {
    const raw = raws[i];
    if (!raw.buf) return null; // โหลดไม่ได้ หรือถูกปฏิเสธชั้น 1 = เหมือนเดิม (null)
    const res = byId.get(String(i));
    if (!res || !res.ok || !res.buf) {
      if (res?.poisoned) {
        console.warn(`[img-airlock] 🧟 ภาพพิษ: id=${im.id || im.imageUrl || im.thumbnailUrl || '(ไม่มี id)'} loadedFrom=${raw.loadedFrom} — กันไว้ไม่ให้ตกลงสายเซิร์ฟหลัก (ข้ามใบนี้เหมือนโหลดไม่ได้ ทำใบอื่นในแบตช์ต่อ)`);
      }
      return null; // ล้ม/พิษ = เหมือนโหลด/decode ไม่ได้ (fail-open พฤติกรรมเดิม — รอบหน้าลองใหม่)
    }
    // ใช้ "บัฟเฟอร์สะอาด" จากห้องนิรภัยต่อจากนี้ (ไม่ใช่ raw) — ใช้ sharpness/pHash64/width/height ที่คำนวณมาแล้ว
    //   ข้ามการคำนวณซ้ำในโปรเซสหลัก (ประหยัดเวลา + ลดจำนวนครั้งที่โปรเซสหลักต้อง decode)
    return processLoadedBuffer(im, res.buf, raw.loadedFrom, {
      sharpness: res.sharpness, pHash64: res.dHash64, width: res.width, height: res.height,
    });
  }));
}
// ★ 30 ก.ค. 69: export loadOne/loadBatch เพื่อให้เทส "กันภาพพิษฆ่าเซิร์ฟ" เรียกตรงได้ (เหมือน buildTriage ด้านล่าง
//   ที่ export ไว้ให้ Stage-A focused test เรียกตรง) — additive ล้วน ไม่กระทบ caller เดิมในไฟล์นี้/ที่อื่น
export { loadOne, loadBatch };

// ★ 9 ก.ค. เฟส 2.3: whitelist หมวดจริงที่พรอมป์ Gemini กำหนด (gemini.js geminiClassifyFrames) — กันหมวดผี
//   (เคสจริง: "face-happy" 2 ใบ โผล่เพราะไม่เคย validate) — นอกลิสต์ = 'other' เสมอ
const CATEGORY_WHITELIST = new Set(['face-emotional', 'face-neutral', 'context', 'group', 'document', 'other']);
// อารมณ์ "บวก" ที่พรอมป์เดิมเอียงไปนิยาม face-emotional แค่ฝั่งลบ (ร้องไห้/เศร้า/ตกใจ) — ดันหน้ายิ้ม/หัวเราะ
// ไปหมวด face-neutral ผิด (เคสจริง: หน้านิ่ง 47 ใบ หน้าอารมณ์ 8 ใบ ทั้งที่ข่าวบันเทิงมีรูปยิ้มเยอะ)
const POSITIVE_FACE_EMOTIONS = new Set(['happy', 'laugh', 'warm']);

// สร้างป้าย triage จากผล classify (it) + ค่าโหลด (src มี brightness/detail/realWidth/realHeight/measuredFrom/sharpness)
// ★ export เพื่อให้ Stage-A focused test เรียกตรงได้ (พฤติกรรม/ผลลัพธ์เดิมทุกฟิลด์)
// ★ Batch 5B2: strictOpts === undefined (2-arg legacy call) = พฤติกรรมเดิมเป๊ะ byte-for-byte ทุกบรรทัดด้านล่างนี้
//   ไม่แตะเลย — โหมด strict แยกไปเป็น buildTriageStrict() คนละฟังก์ชันทั้งก้อน (กัน legacy caller/test พัง)
// ★ correction P1-6: ส่ง strictOpts มา (3-arg call ใดๆ) = ต้องเข้าทาง strict เสมอ แม้ strictOpts เองผิดรูปแบบ/
//   Proxy — ห้าม fallback ไปทาง legacy เงียบๆ (นั่นคือ downgrade ความปลอดภัย จาก strict กลับไปเป็น lenient
//   dot-access) ปฏิเสธตรงๆ (null, ศูนย์ triage/admission) แทน — ไม่เรียก getter/trap ใดๆ ก่อนปฏิเสธ
export function buildTriage(it, src, strictOpts) {
  if (strictOpts === undefined) return buildTriageLegacy(it, src);
  if (strictOpts === null || nodeUtilTypes.isProxy(strictOpts) || typeof strictOpts !== 'object') return null;
  const strictFlagR = ownReadStrictOpt(strictOpts, 'strict');
  if (!strictFlagR.present || strictFlagR.value !== true) return null;
  return buildTriageStrict(it, src, strictOpts);
}

function buildTriageLegacy(it, src) {
  const emotion = it.emotion || null;
  // ★ 9 ก.ค. เฟส 2.3: validate enum + แก้พลาด face-neutral ทั้งที่อารมณ์บวกชัด (ดีกว่าพึ่งพรอมป์อย่างเดียว
  //   เพราะ Gemini ตอบไม่ตรงนิยามได้เสมอ — ด่านโค้ดกันเหนียวอีกชั้น ไม่ต้องรอแก้ที่ไฟล์ gemini.js)
  let category = CATEGORY_WHITELIST.has(it.category) ? it.category : 'other';
  if (category === 'face-neutral' && POSITIVE_FACE_EMOTIONS.has(emotion)) category = 'face-emotional';

  // ★ 9 ก.ค. เฟส 2.1: ขนาดจริง (เมื่อรู้) — ใช้คัด/เรียง hero ที่ s6 (megaAdapters.js)
  const rw = Number(src?.realWidth), rh = Number(src?.realHeight);
  const realShortSide = (rw > 0 && rh > 0) ? Math.min(rw, rh) : null;
  const measuredFrom = src?.measuredFrom || null;

  let quality = typeof it.quality === 'number' ? it.quality : 5;
  // ★ 9 ก.ค. เฟส 2.1 (quality cap กันคะแนนหลอก): วัดจากไฟล์ย่อ/ไฟล์เล็กจริง (สั้นสุด<500px) → เพดาน 6
  //   เคสจริง AC-0058: quality 9 ตกบนไฟล์ 298×372 — ถ้าปล่อยผ่านจะดัน s6 เลือกไฟล์จิ๋วเป็น hero แล้วยืดแตกตอนประกอบ
  //   ★ Wave2 B1: เลข 500/6 ย้ายมาจาก imageQualityConfig.js (single source of truth — ค่าเดิมเป๊ะ ไม่เปลี่ยน)
  if ((measuredFrom === 'thumb' || (realShortSide != null && realShortSide < QUALITY_CAP_SHORT_SIDE)) && quality > QUALITY_CAP_VALUE) {
    quality = QUALITY_CAP_VALUE;
  }

  // ★ Stage-A: descriptor สำหรับ candidate fact authority (additive — ไม่กระทบฟิลด์/การตัดสินใด ๆ ด้านล่าง)
  //   • verdict: ส่ง raw it.* (literal boolean เท่านั้นถึงนับ "รู้") — ห้าม derive จาก "!== false" (ไม่มี default-positive)
  //   • resolution (★ 15 ก.ค. Batch 2B): ส่งเฉพาะหลักฐาน "บัฟเฟอร์ decode จริงตอนนี้" (src.decodedWidth/Height/
  //     Provenance จาก loadOne) — rw/rh reuse จาก record เก่า/measuredFrom อนุมาน ไม่มีวันกลายเป็น facts (คงอยู่
  //     เฉพาะฟิลด์ legacy ด้านล่าง) · ไม่มีหลักฐาน decode = ไม่ส่ง key → authority ตีเป็น 'unknown' ตามสัญญา
  //   • hash: pHash64 วัดจาก buffer ที่ decode จริง (ค่า+algo เชื่อได้) แต่ full-vs-thumb อนุมานไม่ได้ → measuredFrom 'unknown'
  const candidateFacts = buildCandidateFactsV1({
    verdicts: { relevant: it.relevant, clean: it.clean, newsScene: it.newsScene },
    faceBox: it.faceBox, // {x,y,w,h} normalized | null (ยืนยันไม่มี) | undefined (หาย → unknown)
    ...(typeof src?.pHash64 === 'string' && src.pHash64
      ? { hash: { value: src.pHash64, algo: 'dhash_9x8_v1', measuredFrom: 'unknown' } }
      : {}),
    ...(Number.isInteger(src?.decodedWidth) && src.decodedWidth > 0
      && Number.isInteger(src?.decodedHeight) && src.decodedHeight > 0
      && (src?.decodedProvenance === 'full' || src?.decodedProvenance === 'thumb')
      ? { resolution: { decodedBuffer: true, provenance: src.decodedProvenance, width: src.decodedWidth, height: src.decodedHeight } }
      : {}),
  });

  return {
    // "เกี่ยวข่าว" แยกจาก "คุณภาพ" — ทิ้งเฉพาะที่ AI ตีว่าไม่เกี่ยวชัด (undefined = เก็บไว้ กัน false drop)
    relevant: it.relevant !== false,
    // ★ 8 ก.ค. เฟส A: ป้าย "ภาพแฟ้ม" — false = คนในข่าวตัวจริงแต่มาจากงาน/บริบทอื่น (ไม่ระบุ/ข้อมูลเก่า = ถือเป็นภาพข่าว)
    newsScene: it.newsScene !== false,
    clean: it.clean !== false, // พร้อมขึ้นปก (ไม่มีลายน้ำ/ตัวหนังสือ) — คนละเรื่องกับ relevant
    category,
    person: it.person || null,
    persons: Array.isArray(it.persons) ? it.persons.filter(Boolean) : it.person ? [it.person] : [],
    emotion,
    quality,
    faceCount: typeof it.faceCount === 'number' ? it.faceCount : it.faceBox ? 1 : 0,
    faceBox: it.faceBox || null,
    peopleBox: it.peopleBox || null,
    brightness: Math.round(src?.brightness ?? 128),
    detail: Math.round(src?.detail ?? 60),
    note: it.note || '',
    // ★ 9 ก.ค. เฟส 2.1: ฟิลด์ใหม่ — s6 (megaAdapters.js) ใช้คัด/เรียง hero ด้วยขนาดจริงแทนที่จะเชื่อ quality อย่างเดียว
    realShortSide,
    sharpness: typeof src?.sharpness === 'number' ? src.sharpness : null,
    measuredFrom, // 'full' | 'thumb' | null (วัดไม่ได้)
    // ★ Wave3 ชุด2 (10 ก.ค.): pHash64 (dHash 16 hex) — s6/solver ใช้จับภาพเกือบซ้ำระดับพิกเซล (ต่างจาก sceneKey ที่จับด้วยข้อความ)
    //   ภาพเก่าในคลังก่อนหน้านี้ไม่มีค่านี้ = null เสมอ (ไม่ backfill — ไปข้างหน้าเท่านั้น)
    pHash64: (typeof src?.pHash64 === 'string' && src.pHash64) ? src.pHash64 : null,
    // ★ Stage-A: authority-normalized nested facts (frozen/detached) — additive, ไม่กระทบฟิลด์/การตัดสินเดิม
    candidateFacts,
  };
}

// descriptor-safe own-data reader สำหรับ strictOpts เท่านั้น (แยกจาก gemini.js — ไม่ import ข้ามไฟล์สำหรับ
// primitive ระดับนี้) — accessor/non-enumerable-ไม่สำคัญ (ยอมเหมือน gemini.js ownRead ทั่วไป) แต่ปฏิเสธ getter
function ownReadStrictOpt(obj, key) {
  if (obj === null || typeof obj !== 'object') return { present: false, value: undefined };
  let d;
  try { d = Object.getOwnPropertyDescriptor(obj, key); } catch { return { present: false, value: undefined }; }
  if (!d || !('value' in d)) return { present: false, value: undefined };
  return { present: true, value: d.value };
}
// ★ correction P1-6: ตรวจ+สร้าง classifierEvidence ใหม่ (frozen, literal ล้วน) จาก strictOpts — ต้องผ่านสัญญา
//   ครบทุกจุดก่อนถึงยอมแนบเข้า triage: evidence ตรง isValidClassifierEvidence (exact-key/type/value bound ทุก
//   ฟิลด์ตามที่ gemini.js สร้างจริง) + caseId เป็น nonblank bounded string + batchIndex/resultIndex เป็นจำนวนเต็ม
//   ไม่ติดลบ — ขาด/ผิดรูปแบบจุดใดจุดหนึ่ง = null (ไม่ใช่ default ด้วย ?? null แบบเดิมที่ปล่อยผ่านง่ายเกินไป)
const MAX_CASE_ID_LEN = 200;
function buildStrictProvenance(strictOpts) {
  if (!strictOpts || nodeUtilTypes.isProxy(strictOpts) || typeof strictOpts !== 'object') return null;
  const evidenceR = ownReadStrictOpt(strictOpts, 'evidence');
  if (!evidenceR.present || !isValidClassifierEvidence(evidenceR.value)) return null;
  const caseIdR = ownReadStrictOpt(strictOpts, 'caseId');
  if (!caseIdR.present || typeof caseIdR.value !== 'string' || caseIdR.value.trim().length === 0 || caseIdR.value.length > MAX_CASE_ID_LEN) return null;
  const batchIndexR = ownReadStrictOpt(strictOpts, 'batchIndex');
  if (!batchIndexR.present || !Number.isInteger(batchIndexR.value) || batchIndexR.value < 0) return null;
  const resultIndexR = ownReadStrictOpt(strictOpts, 'resultIndex');
  if (!resultIndexR.present || !Number.isInteger(resultIndexR.value) || resultIndexR.value < 0) return null;
  const e = evidenceR.value; // ผ่าน isValidClassifierEvidence แล้ว (guardExactObject ภายใน) — dot-access ปลอดภัย
  return Object.freeze({
    caseId: caseIdR.value,
    batchIndex: batchIndexR.value,
    resultIndex: resultIndexR.value,
    requestedModel: e.requestedModel,
    actualModel: e.actualModel,
    actualModelVersion: e.actualModelVersion,
    modelMatchMode: e.modelMatchMode,
    provider: e.provider,
    schemaVersion: e.schemaVersion,
    attemptCount: e.attemptCount,
    repairCount: e.repairCount,
  });
}

// ============================================================
// ★ Batch 5B2 (+ correction P1-1/P1-6) — strict classifier mode: ผลจาก geminiClassifyFrames strict path
//   เท่านั้น — descriptor-first เต็มรูปแบบ: it ตรวจผ่าน gemini.js sanitizeStrictClassifierItem (reuse ตัวเดียว
//   กับที่ตรวจผล Gemini จริง — กัน validate-logic สองชุด drift, ปฏิเสธ Proxy/accessor/custom-prototype/exotic
//   input โดยไม่เรียก getter/trap ใดๆ ก่อนปฏิเสธ) · evidence ตรวจผ่าน buildStrictProvenance (exact contract +
//   caseId/batchIndex/resultIndex bound) · พังจุดใดจุดหนึ่ง = null (ไม่ผลิต triage/candidateFacts เลย) · ผลลัพธ์
//   detached/frozen ก่อน return เสมอ (caller mutation แก้ triage ที่เก็บไว้ไม่ได้)
// ============================================================
function buildTriageStrict(it, src, strictOpts) {
  const classifierEvidence = buildStrictProvenance(strictOpts);
  if (classifierEvidence === null) return null;

  const fileTagOnR = ownReadStrictOpt(strictOpts, 'fileTagOn');
  const fileTagOn = fileTagOnR.present && fileTagOnR.value === true;
  // ★ 21 ก.ค. (บั๊ก tagged 0/failed 0 ทั้งระบบ): busyOn ต้องตามชุดคีย์จริงของ item (ชั้นแรก validate ด้วย
  //   busyOn ตาม MEGA_CLUTTER_GUARD → item มี busy/peopleCount) — เดิมไม่ส่ง = sanitize ใช้ชุดคีย์ไม่มี busy
  //   → guardExactObject เจอ key เกิน → null เงียบทุกใบ · pattern เดียวกับ fileTagOn เป๊ะ (absent = false เดิม)
  const busyOnR = ownReadStrictOpt(strictOpts, 'busyOn');
  const busyOn = busyOnR.present && busyOnR.value === true;
  const frontalOnR = ownReadStrictOpt(strictOpts, 'frontalOn'); // ★ MEGA_HERO_FRONTAL — pattern เดียวกับ busyOn
  const frontalOn = frontalOnR.present && frontalOnR.value === true;
  const unguardedOnR = ownReadStrictOpt(strictOpts, 'unguardedOn'); // ★ MEGA_UNGUARDED_TAG — pattern เดียวกับ busyOn เป๊ะ (absent = false = เดิม)
  const unguardedOn = unguardedOnR.present && unguardedOnR.value === true;
  const heroPoseOnR = ownReadStrictOpt(strictOpts, 'heroPoseOn');
  const heroPoseOn = heroPoseOnR.present && heroPoseOnR.value === true;
  const sanitized = sanitizeStrictClassifierItem(it, fileTagOn, busyOn, frontalOn, unguardedOn, heroPoseOn);
  if (sanitized === null) return null;

  const hasNewsScene = Object.prototype.hasOwnProperty.call(sanitized, 'newsScene'); // sanitized เป็นของเราเอง (frozen literal) — ปลอดภัย
  // ★ MEGA_UNGUARDED_TAG: คำนวณครั้งเดียว (undefined = ตาตอบ null/ไม่ครบ 4 ช่อง = "วัดไม่ได้")
  const hasUnguarded = Object.prototype.hasOwnProperty.call(sanitized, 'gazeAway');
  const hasEyesClosed = Object.prototype.hasOwnProperty.call(sanitized, 'eyesClosed');
  const hasLyingDown = Object.prototype.hasOwnProperty.call(sanitized, 'lyingDown');
  const unguardedScore = hasUnguarded ? computeUnguardedScore(sanitized) : undefined;
  const emotion = sanitized.emotion || null;
  let category = sanitized.category;
  if (category === 'face-neutral' && POSITIVE_FACE_EMOTIONS.has(emotion)) category = 'face-emotional';

  const rw = Number(src?.realWidth), rh = Number(src?.realHeight);
  const realShortSide = (rw > 0 && rh > 0) ? Math.min(rw, rh) : null;
  const measuredFrom = src?.measuredFrom || null;

  let quality = sanitized.quality; // ★ ห้าม default missing→5 — sanitizeStrictClassifierItem รับประกัน finite/1-10 มาแล้ว
  if ((measuredFrom === 'thumb' || (realShortSide != null && realShortSide < QUALITY_CAP_SHORT_SIDE)) && quality > QUALITY_CAP_VALUE) {
    quality = QUALITY_CAP_VALUE;
  }

  const candidateFacts = buildCandidateFactsV1({
    verdicts: { relevant: sanitized.relevant, clean: sanitized.clean, newsScene: hasNewsScene ? sanitized.newsScene : undefined },
    faceBox: sanitized.faceBox,
    ...(typeof src?.pHash64 === 'string' && src.pHash64
      ? { hash: { value: src.pHash64, algo: 'dhash_9x8_v1', measuredFrom: 'unknown' } }
      : {}),
    ...(Number.isInteger(src?.decodedWidth) && src.decodedWidth > 0
      && Number.isInteger(src?.decodedHeight) && src.decodedHeight > 0
      && (src?.decodedProvenance === 'full' || src?.decodedProvenance === 'thumb')
      ? { resolution: { decodedBuffer: true, provenance: src.decodedProvenance, width: src.decodedWidth, height: src.decodedHeight } }
      : {}),
  });

  return Object.freeze({
    relevant: sanitized.relevant, // ★ literal ตรงๆ — ห้าม "!== false" (นั่นคือ default-positive สำหรับ undefined/missing)
    // ★ correction P1-1: FILE_SHOT_TAG=0 (newsScene ไม่อยู่ใน schema โหมดนี้) = "ไม่รู้" จริงๆ ไม่ใช่ default
    //   เป็น true — เก็บ null ตรงๆ (ทุก consumer จริงในโค้ดใช้ `!== false` อยู่แล้ว จึง null ยังนับเป็น "ไม่ปฏิเสธ"
    //   เหมือนเดิมทุกจุด แต่ไม่ fabricate ว่า "รู้ว่าเป็นข่าวจริง" ทั้งที่ไม่มีหลักฐาน)
    newsScene: hasNewsScene ? sanitized.newsScene : null,
    clean: sanitized.clean,
    category,
    person: sanitized.person,
    persons: sanitized.persons,
    emotion,
    quality,
    faceCount: sanitized.faceCount,
    faceBox: sanitized.faceBox,
    peopleBox: sanitized.peopleBox,
    // ★ 21 ก.ค. (บั๊กซ้อนชั้น 2 ของเคส busyOn): ตา (CLUTTER ON) ตอบ busy/peopleCount มาแล้ว แต่ return นี้
    //   ไม่เคยเก็บ → consumer (megaAdapters _busyOf/meta :3254,:3388 อ่าน triage.busy) ไม่เห็นค่าเลย = clutter
    //   guard ฝั่งเลือกภาพไม่ทำงานจริงบนเส้น strict — แนบ additive เฉพาะเมื่อ sanitized มี (busyOn เท่านั้น)
    //   pattern เดียวกับ newsScene (sanitized เป็น frozen literal ของเราเอง — hasOwnProperty ปลอดภัย)
    ...(Object.prototype.hasOwnProperty.call(sanitized, 'busy') ? { busy: sanitized.busy, peopleCount: sanitized.peopleCount } : {}),
    ...(Object.prototype.hasOwnProperty.call(sanitized, 'faceFront') ? { faceFront: sanitized.faceFront } : {}), // ★ MEGA_HERO_FRONTAL
    // ★ MEGA_UNGUARDED_TAG (30 ก.ค. 69): 4 ป้ายดิบ (bool | null="ตาบอกว่าไม่รู้") + คะแนนรวม 0-3
    //   🔴 unguardedScore แนบ "เฉพาะเมื่อคำนวณได้จริง" (ครบ 4 ช่องเป็น boolean) — ไม่ครบ = ไม่มีคีย์เลย
    //   (undefined = "วัดไม่ได้") ห้ามเป็น null/0 เด็ดขาด: 0 คือ "วัดได้แล้วได้ศูนย์" คนละความหมาย
    ...(hasUnguarded
      ? {
        gazeAway: sanitized.gazeAway, mouthOpen: sanitized.mouthOpen,
        inMotion: sanitized.inMotion, posedShot: sanitized.posedShot,
        ...(unguardedScore === undefined ? {} : { unguardedScore }),
      }
      : {}),
    // H-gates ใช้แต่ละป้ายอย่างอิสระ; คีย์ที่ขาดหมายถึง "ไม่รู้" และต้องไม่ทำให้คีย์อีกตัวหายตาม.
    ...(hasEyesClosed ? { eyesClosed: sanitized.eyesClosed } : {}),
    ...(hasLyingDown ? { lyingDown: sanitized.lyingDown } : {}),
    brightness: Math.round(src?.brightness ?? 128),
    detail: Math.round(src?.detail ?? 60),
    note: sanitized.note,
    realShortSide,
    sharpness: typeof src?.sharpness === 'number' ? src.sharpness : null,
    measuredFrom,
    pHash64: (typeof src?.pHash64 === 'string' && src.pHash64) ? src.pHash64 : null,
    candidateFacts,
    classifierEvidence,
  });
}

// ★ 8 ก.ค. (เร่งค้นภาพ แก้ 3): semaphore กลางจำกัดจำนวนเรียกตา Gemini พร้อมกันทั้งโปรเซส
//   — ตอนค้นหลายแหล่งขนาน (3 request × 3 ชุด/request) ไม่ให้รุมยิง Gemini เกินลิมิตจนโดน 429 ยกแผง
//   ปรับ: GEMINI_VET_CONC (ดีฟอลต์ 4)
const gemState = globalThis.__GEM_VET_SEM || (globalThis.__GEM_VET_SEM = { busy: 0, queue: [] });
async function gemAcquire() {
  const max = Math.max(1, parseInt(process.env.GEMINI_VET_CONC || '4', 10));
  while (gemState.busy >= max) await new Promise((r) => gemState.queue.push(r));
  gemState.busy++;
}
function gemRelease() {
  gemState.busy--;
  const next = gemState.queue.shift();
  if (next) next();
}

// 👁️ กรองรูป "ดิบ" ตอนค้น (ยังไม่มี id) → คืนรูปพร้อมป้าย triage ในตัว (เก็บได้เลย)
//   caller filter `triage.relevant !== false` เพื่อเก็บเฉพาะที่เกี่ยว (ใบที่โหลด/ตาล้ม = คงไว้ไม่ติดป้าย กัน false drop)
// ★ 8 ก.ค. แก้ 3: ประมวลชุดละ batchSize "ขนานกัน VET_CONC ชุด" (เดิมทีละชุด) — เกณฑ์ตา/ป้าย/
//   fail-open ต่อชุด เท่าเดิมทุกอย่าง ผลคืนเรียงลำดับรูปเดิม · kill-switch: VET_CONC=1 = ทีละชุดแบบเดิม
export async function vetImages({ images, subjects, newsGist, onProgress, onRetry, caseId, batchSize = 10, signal }) {
  const conc = Math.max(1, parseInt(process.env.VET_CONC || '3', 10));
  const total = images.length;
  const batches = [];
  for (let i = 0; i < images.length; i += batchSize) batches.push(images.slice(i, i + batchSize));
  const results = new Array(batches.length);
  let kept = 0, dropped = 0, failed = 0, doneImgs = 0;
  let keyError = null; // ไม่มีคีย์ Gemini → เก็บไว้ throw หลังทุก worker หยุด (พฤติกรรมเดิมต่อ caller)
  let abortError = null; // ★ correction P1-5: external signal cancel → หยุดทั้ง invocation (ไม่ใช่แค่แบตช์นี้)
  // ★ Batch 5B2: pin ครั้งเดียวต่อ invocation นี้ — ส่งเดิมเป๊ะเข้าทุกแบตช์/ทุก retry ห้าม re-resolve จาก env
  //   ระหว่างงาน (ถ้า env ตั้งโมเดลผิดรูปแบบ ให้ล้มทั้ง invocation ทันทีตรงนี้ ก่อนเริ่มแบตช์ไหนเลย)
  // ★ 26 ก.ค. 69: ส่ง COVER_GEMINI_MODEL ตรงๆ (สายปก) — ปุ่มถอยกลับ: env COVER_GEMINI_MODEL
  const pin = resolveGeminiClassifierPin(COVER_GEMINI_MODEL);
  // ★ correction P1-6: อ่านค่าเดียวกับที่ gemini.js อ่านเองเป๊ะ (env ตัวเดียวกัน อ่านครั้งเดียวต่อ invocation
  //   เหมือน pin) — ใช้เลือก required-key-set ที่ sanitizeStrictClassifierItem ต้องตรวจให้ตรง mode จริงของงานนี้
  const FILE_TAG = process.env.FILE_SHOT_TAG !== '0';
  // ★ 21 ก.ค. (บั๊กตาคัดทิ้งเงียบทุกใบหลัง flip MEGA_CLUTTER_GUARD=ON 20 ก.ค.): ชั้นแรก (geminiClassifyFrames)
  //   validate ด้วย busyOn ตาม env → item มี busy/peopleCount แต่ buildTriage ไม่ส่ง busyOn → sanitize เจอ key เกิน
  //   → null เงียบทุกใบ (tagged 0, failed 0) — resolve ค่าเดียวกับ gemini.js เป๊ะ แล้วส่งเข้า strictOpts ให้สองชั้นตรงกันเสมอ
  const BUSY_TAG = process.env.MEGA_CLUTTER_GUARD !== '0';
  const FRONTAL_TAG = process.env.MEGA_HERO_FRONTAL === '1'; // ★ 21 ก.ค. MEGA_HERO_FRONTAL — มุมการเห็นหน้า (ค่าเดียวกับ gemini.js เป๊ะ)
  // ★ 30 ก.ค. 69 MEGA_UNGUARDED_TAG — ต้องอ่าน env ตัวเดียวกับ gemini.js เป๊ะ แล้วส่งเข้า strictOpts ทุกครั้ง
  //   (ถ้าไม่ส่ง = ชุดคีย์สองชั้นไม่ตรง → sanitize เจอ key เกิน → null เงียบทุกใบ = บั๊ก tagged 0 ซ้ำรอย 20-21 ก.ค.)
  const UNGUARDED_TAG = process.env.MEGA_UNGUARDED_TAG === '1';
  const HERO_POSE_TAG = process.env.MEGA_HERO_H_GATES !== '0';

  async function runOneBatch(bi) {
    const slice = batches[bi];
    const out = [];
    // ★ 30 ก.ค. 69: loadBatch (1 child/แบตช์ ผ่านห้องนิรภัย เมื่อ MEGA_IMG_AIRLOCK เปิด) แทน Promise.all(map(loadOne))
    //   ตรงๆ — ปิดสวิตช์ = เส้นเดิมเป๊ะ (loadBatch เองก็ fallback ไป Promise.all(map(loadOne)) ตอน off)
    const results_ = await loadBatch(slice);
    const loads = slice.map((im, k) => ({ im, r: results_[k] }));
    doneImgs += slice.length;
    if (onProgress) onProgress({ done: Math.min(doneImgs, total), total, kept, dropped });
    const ok = loads.filter((x) => x.r);
    const failedLoads = loads.filter((x) => !x.r);
    failedLoads.forEach((x) => { out.push({ ...x.im }); failed++; }); // โหลดไม่ได้ → คงไว้ไม่ติดป้าย
    if (ok.length) {
      const frames = ok.map((x, k) => ({ index: k, base64: x.r.base64, source: x.im.source, title: x.im.title }));
      let result = null;
      await gemAcquire();
      try {
        result = await geminiClassifyFrames({ frames, subjects, newsGist, onRetry, caseId, pin, signal });
      } catch (e) {
        if (e?.errorType === 'NO_GEMINI_KEY') { keyError = e; return; } // แจ้ง caller (จะได้ fallback ไม่กรอง)
        // ★ correction P1-5: external cancel ต้อง terminal ทั้ง invocation ทันที ห้ามกลืนเป็น "แบตช์นี้ล้ม
        //   คงไว้ไม่ติดป้าย รอบหน้าลองใหม่" (raw/untagged continuation) — หยุดจ่ายแบตช์ใหม่ + rethrow terminal เดิม
        if (e?.errorType === 'ABORTED') { abortError = e; return; }
        ok.forEach((x) => { out.push({ ...x.im }); failed++; }); // ตาล้ม (รวมถึง identity/schema/deadline ใหม่) → คงไว้ไม่ติดป้าย
      } finally {
        gemRelease();
      }
      if (result) {
        const items = result.items;
        const evidence = result.evidence;
        const byIdx = {};
        for (const it of items) byIdx[it.index] = it;
        ok.forEach((x, k) => {
          const it = byIdx[k];
          // ★ audit B-R4: Gemini degrade ตอบไม่ครบฟิลด์ (ไม่มี relevant) → ห้าม default ป้ายบวกฟรี
          //   ข้ามไม่ติดป้าย (รอบหน้าตาคัดใหม่) — คงหลัก "กัน false drop" แต่ไม่ปล่อยขยะป้ายดีเข้าพูล
          //   (schema ที่ gemini.js บังคับ relevant ครบทุกใบอยู่แล้ว — เช็คนี้เป็น defense-in-depth)
          if (!it || typeof it.relevant === 'undefined') { out.push({ ...x.im }); failed++; return; }
          const triage = buildTriage(it, x.r, {
            strict: true, evidence, caseId, batchIndex: bi, resultIndex: it.index, fileTagOn: FILE_TAG, busyOn: BUSY_TAG, frontalOn: FRONTAL_TAG, unguardedOn: UNGUARDED_TAG, heroPoseOn: HERO_POSE_TAG,
          });
          if (!triage) { out.push({ ...x.im }); failed++; return; } // malformed strict item → ศูนย์ triage/admission
          out.push({ ...x.im, triage });
          if (triage.relevant === false) dropped++; else kept++;
        });
      }
    }
    results[bi] = out;
  }

  let nextBatch = 0;
  const workers = Array.from({ length: Math.min(conc, batches.length) }, async () => {
    while (nextBatch < batches.length && !keyError && !abortError) {
      const bi = nextBatch++;
      await runOneBatch(bi);
    }
  });
  await Promise.all(workers);
  if (keyError) throw keyError;
  if (abortError) throw abortError; // ★ correction P1-5: rethrow safe terminal abort — ไม่กลืนทิ้ง

  const vetted = results.flat().filter(Boolean);
  return { vetted, kept, dropped, failed };
}

// คัดกรองคลัง → คืน { map: {imageId: triage}, tagged, failed, byCategory, byPerson }
export async function triageLibrary({ images, subjects, newsGist, onProgress, onRetry, caseId, batchSize = 10, signal }) {
  const map = {};
  let tagged = 0;
  let failed = 0;
  const total = images.length;
  const byCategory = {};
  const byPerson = {};
  // ★ Batch 5B2: pin ครั้งเดียวต่อ invocation นี้ — ส่งเดิมเป๊ะเข้าทุกแบตช์/ทุก retry ห้าม re-resolve จาก env
  // ★ 26 ก.ค. 69: ส่ง COVER_GEMINI_MODEL ตรงๆ (สายปก) — ปุ่มถอยกลับ: env COVER_GEMINI_MODEL
  const pin = resolveGeminiClassifierPin(COVER_GEMINI_MODEL);
  // ★ correction P1-6: ค่าเดียวกับที่ gemini.js อ่านเองเป๊ะ — เลือก required-key-set ให้ตรง mode จริงของงานนี้
  const FILE_TAG = process.env.FILE_SHOT_TAG !== '0';
  // ★ 21 ก.ค. (บั๊กตาคัดทิ้งเงียบทุกใบหลัง flip MEGA_CLUTTER_GUARD=ON 20 ก.ค.): ชั้นแรก (geminiClassifyFrames)
  //   validate ด้วย busyOn ตาม env → item มี busy/peopleCount แต่ buildTriage ไม่ส่ง busyOn → sanitize เจอ key เกิน
  //   → null เงียบทุกใบ (tagged 0, failed 0) — resolve ค่าเดียวกับ gemini.js เป๊ะ แล้วส่งเข้า strictOpts ให้สองชั้นตรงกันเสมอ
  const BUSY_TAG = process.env.MEGA_CLUTTER_GUARD !== '0';
  const FRONTAL_TAG = process.env.MEGA_HERO_FRONTAL === '1'; // ★ 21 ก.ค. MEGA_HERO_FRONTAL — มุมการเห็นหน้า (ค่าเดียวกับ gemini.js เป๊ะ)
  // ★ 30 ก.ค. 69 MEGA_UNGUARDED_TAG — ต้องอ่าน env ตัวเดียวกับ gemini.js เป๊ะ แล้วส่งเข้า strictOpts ทุกครั้ง
  //   (ถ้าไม่ส่ง = ชุดคีย์สองชั้นไม่ตรง → sanitize เจอ key เกิน → null เงียบทุกใบ = บั๊ก tagged 0 ซ้ำรอย 20-21 ก.ค.)
  const UNGUARDED_TAG = process.env.MEGA_UNGUARDED_TAG === '1';
  const HERO_POSE_TAG = process.env.MEGA_HERO_H_GATES !== '0';

  for (let i = 0; i < images.length; i += batchSize) {
    const slice = images.slice(i, i + batchSize);
    // โหลด base64 พร้อมกันในแบตช์ (เร็วขึ้น) — ทิ้งรูปที่โหลดไม่ได้ (รอบหน้าค่อยลองใหม่)
    // ★ 30 ก.ค. 69: loadBatch (ผ่านห้องนิรภัยเมื่อ MEGA_IMG_AIRLOCK เปิด) แทน Promise.all(map(loadOne)) ตรงๆ
    const loaded = (await loadBatch(slice)).filter(Boolean);
    if (onProgress) {
      const done = Math.min(i + batchSize, total);
      onProgress({ done, total, pct: Math.round((done / total) * 100), tagged });
    }
    if (!loaded.length) {
      failed += slice.length;
      continue;
    }
    const frames = loaded.map((b, k) => ({ index: k, base64: b.base64, source: b.im.source, title: b.im.title }));
    let result = null;
    try {
      result = await geminiClassifyFrames({ frames, subjects, newsGist, onRetry, caseId, pin, signal });
    } catch (e) {
      // ★ correction P1-5: external cancel ต้อง terminal ทั้ง invocation ทันที ห้ามกลืนเป็น "แบตช์นี้ล้ม
      //   ปล่อยไว้ รอบหน้าลองใหม่" — หยุด loop + rethrow terminal เดิม
      if (e?.errorType === 'ABORTED') throw e;
      failed += loaded.length; // ตาแบตช์นี้ล้ม (รวมถึง identity/schema/deadline ใหม่) → ปล่อยไว้ รอบหน้าลองใหม่
      continue;
    }
    const batchIndex = Math.floor(i / batchSize);
    for (const it of result.items) {
      const src = loaded[it.index];
      if (!src) continue;
      if (typeof it.relevant === 'undefined') continue; // ★ audit B-R4: ตอบครึ่งฟิลด์ = ไม่ติดป้าย รอรอบหน้า (กันป้ายบวกฟรี)
      const triage = buildTriage(it, src, {
        strict: true, evidence: result.evidence, caseId, batchIndex, resultIndex: it.index, fileTagOn: FILE_TAG, busyOn: BUSY_TAG, frontalOn: FRONTAL_TAG, unguardedOn: UNGUARDED_TAG, heroPoseOn: HERO_POSE_TAG,
      });
      if (!triage) continue; // malformed strict item → ศูนย์ triage/admission
      map[src.im.id] = triage;
      tagged++;
      byCategory[triage.category] = (byCategory[triage.category] || 0) + 1;
      if (triage.person) byPerson[triage.person] = (byPerson[triage.person] || 0) + 1;
    }
  }

  return { map, tagged, failed, byCategory, byPerson };
}
