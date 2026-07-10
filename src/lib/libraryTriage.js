// ============================================================
// [ระบบทำปกออโต้] คัดกรองคลังทั้งใบ (Full Library Triage)
// ------------------------------------------------------------
// วน "ตา" (Gemini) ดูทุกรูปในคลัง → ติดป้ายถาวรต่อรูป:
//   relevant (เกี่ยวข่าวนี้ไหม) / person / category / quality / emotion / clean / faceBox
// ทำครั้งเดียว cache ที่ imageStore → ทำปก/กรองคลังเร็ว+แม่นขึ้น
// ประมวลทีละ batch (โหลด base64 → classify → map) รายงานความคืบหน้า
// ============================================================

import sharp from 'sharp';
import { loadImageBuffer } from './imageBuffer.js';
import { geminiClassifyFrames } from './gemini.js';
import { applyRehost } from './imageStore.js';
// ★ Wave2 Batch B1 (10 ก.ค.): เกณฑ์ตัวเลขย้ายไป imageQualityConfig.js (single source of truth) — ค่าเดิมเป๊ะ
import { QUALITY_CAP_SHORT_SIDE, QUALITY_CAP_VALUE } from './imageQualityConfig.js';

async function toB64(buf, size = 512) {
  const out = await sharp(buf, { failOn: 'none' })
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return out.toString('base64');
}

// ★ 9 ก.ค. เฟส 2.1: Laplacian variance (ประมาณความคม) — sharp ไม่มี built-in variance ตรงๆ
//   greyscale → ย่อด้านยาว ≤600 (กันรูปใหญ่ช้า/รูปเล็กพอกัน) → convolve kernel Laplacian → raw → variance ของพิกเซล
//   ยิ่งค่าสูง = ยิ่งคม (ขอบ/รายละเอียดเยอะ) · ยิ่งต่ำ = ภาพเบลอ/แบน
async function computeSharpness(buf) {
  try {
    const { data } = await sharp(buf, { failOn: 'none' })
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
    return null; // วัดไม่ได้ = ปกติ (ไม่บล็อกตาคัด)
  }
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
async function resolveRealSize(im, fallbackBuf) {
  const rw = Number(im.realWidth), rh = Number(im.realHeight);
  if (rw > 0 && rh > 0) {
    return { realWidth: rw, realHeight: rh, measuredFrom: im.rehostQuality === 'thumbnail' ? 'thumb' : 'full', fresh: false };
  }
  // record ไม่มีขนาดจริง — ลองวัดจาก buffer ที่โหลดไว้แล้วสำหรับตา (loadOne) ก่อน กันโหลดซ้ำ
  //   knownThumbOnly เคสนี้จะไม่ผ่านมาถึงตรงนี้ (มี rw/rh อยู่แล้วเฉพาะ rehostQuality='full')
  try {
    if (fallbackBuf?.buf) {
      const meta = await sharp(fallbackBuf.buf, { failOn: 'none' }).metadata();
      if (meta.width > 0 && meta.height > 0) {
        return { realWidth: meta.width, realHeight: meta.height, measuredFrom: fallbackBuf.from === 'imageUrl' && im.rehostQuality !== 'thumbnail' ? 'full' : 'thumb', fresh: true };
      }
    }
  } catch { /* ตกไปลอง ladder เอง */ }
  return null;
}

// โหลดรูป 1 ใบ → { im, base64, brightness, detail, realWidth, realHeight, measuredFrom, sharpness }
//   (คืน null ถ้าโหลด/decode ไม่ได้)
// ★ 9 ก.ค. เฟส 2.1 (มิชชัน "ตาคัดต้องเห็นไฟล์จริง"): เดิมโหลด thumbnailUrl ก่อนเสมอ (แม้ imageUrl จะเป็นไฟล์จริง) —
//   สลับลำดับ: imageUrl (ของจริง) ก่อน แล้วค่อย rehostThumbUrl/thumbnailUrl · ยกเว้นรู้อยู่แล้วว่า rehost ได้แค่
//   thumbnail (rehostQuality='thumbnail') → ข้าม imageUrl ไปเลย (Phase 1 ลองแล้วไม่ผ่าน กันยิงซ้ำ 403 ฟรี)
async function loadOne(im) {
  const knownThumbOnly = im.rehostQuality === 'thumbnail';
  const ladder = knownThumbOnly
    ? [{ url: im.rehostThumbUrl, from: 'rehostThumbUrl' }, { url: im.thumbnailUrl, from: 'thumbnailUrl' }, { url: im.imageUrl, from: 'imageUrl' }]
    : [{ url: im.imageUrl, from: 'imageUrl' }, { url: im.rehostThumbUrl, from: 'rehostThumbUrl' }, { url: im.thumbnailUrl, from: 'thumbnailUrl' }];
  let buf = null;
  let loadedFrom = null;
  for (const step of ladder) {
    if (!step.url) continue;
    buf = await loadSingleUrl(step.url);
    if (buf) { loadedFrom = step.from; break; }
  }
  if (!buf) return null;
  try {
    let brightness = 128;
    let detail = 60;
    try {
      const st = await sharp(buf, { failOn: 'none' }).stats();
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
      const size = await resolveRealSize(im, { buf, from: loadedFrom });
      if (size) {
        realWidth = size.realWidth;
        realHeight = size.realHeight;
        measuredFrom = size.measuredFrom;
        // เขียนกลับลง record เฉพาะตอน "วัดสด" ครั้งแรก (record เดิมไม่เคยมี) — กัน overwrite ค่าเฟส 1 ที่แม่นกว่า
        //   im.id อาจยังไม่มี (vetImages คัดรูป "ดิบ" ตอนค้น ก่อนเข้าคลัง) → ข้ามเขียน record เก็บแค่ใน triage
        if (size.fresh && im.id) {
          applyRehost(im.id, { realWidth, realHeight, realBytes: buf.length }).catch(() => {}); // best-effort ไม่บล็อกตาคัด
        }
      }
    } catch { /* วัดขนาดไม่ได้ = ปกติ ไม่บล็อกตาคัด */ }
    const sharpness = await computeSharpness(buf);
    // ★ 8 ก.ค. (CASE-360): 512→1024 — ที่ 512px ตามองไม่เห็นลายน้ำ/ตัวหนังสือเล็ก → clean=true ผิด
    //   ปลายน้ำพังยกแผง (s6 ไม่ตัดภาพเสีย + s5e ไม่แคปเฟรม) · v3 detector ใช้ 1280px เห็นจริง — ตาคัดต้องเห็นใกล้เคียงกัน
    return { im, base64: await toB64(buf, 1024), brightness, detail, realWidth, realHeight, measuredFrom, sharpness };
  } catch {
    return null;
  }
}

// ★ 9 ก.ค. เฟส 2.3: whitelist หมวดจริงที่พรอมป์ Gemini กำหนด (gemini.js geminiClassifyFrames) — กันหมวดผี
//   (เคสจริง: "face-happy" 2 ใบ โผล่เพราะไม่เคย validate) — นอกลิสต์ = 'other' เสมอ
const CATEGORY_WHITELIST = new Set(['face-emotional', 'face-neutral', 'context', 'group', 'document', 'other']);
// อารมณ์ "บวก" ที่พรอมป์เดิมเอียงไปนิยาม face-emotional แค่ฝั่งลบ (ร้องไห้/เศร้า/ตกใจ) — ดันหน้ายิ้ม/หัวเราะ
// ไปหมวด face-neutral ผิด (เคสจริง: หน้านิ่ง 47 ใบ หน้าอารมณ์ 8 ใบ ทั้งที่ข่าวบันเทิงมีรูปยิ้มเยอะ)
const POSITIVE_FACE_EMOTIONS = new Set(['happy', 'laugh', 'warm']);

// สร้างป้าย triage จากผล classify (it) + ค่าโหลด (src มี brightness/detail/realWidth/realHeight/measuredFrom/sharpness)
function buildTriage(it, src) {
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
  };
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
export async function vetImages({ images, subjects, newsGist, onProgress, onRetry, caseId, batchSize = 10 }) {
  const conc = Math.max(1, parseInt(process.env.VET_CONC || '3', 10));
  const total = images.length;
  const batches = [];
  for (let i = 0; i < images.length; i += batchSize) batches.push(images.slice(i, i + batchSize));
  const results = new Array(batches.length);
  let kept = 0, dropped = 0, failed = 0, doneImgs = 0;
  let keyError = null; // ไม่มีคีย์ Gemini → เก็บไว้ throw หลังทุก worker หยุด (พฤติกรรมเดิมต่อ caller)

  async function runOneBatch(bi) {
    const slice = batches[bi];
    const out = [];
    const loads = await Promise.all(slice.map(async (im) => ({ im, r: await loadOne(im) })));
    doneImgs += slice.length;
    if (onProgress) onProgress({ done: Math.min(doneImgs, total), total, kept, dropped });
    const ok = loads.filter((x) => x.r);
    const failedLoads = loads.filter((x) => !x.r);
    failedLoads.forEach((x) => { out.push({ ...x.im }); failed++; }); // โหลดไม่ได้ → คงไว้ไม่ติดป้าย
    if (ok.length) {
      const frames = ok.map((x, k) => ({ index: k, base64: x.r.base64, source: x.im.source, title: x.im.title }));
      let items = null;
      await gemAcquire();
      try {
        items = await geminiClassifyFrames({ frames, subjects, newsGist, onRetry, caseId });
      } catch (e) {
        if (e?.errorType === 'NO_GEMINI_KEY') { keyError = e; return; } // แจ้ง caller (จะได้ fallback ไม่กรอง)
        ok.forEach((x) => { out.push({ ...x.im }); failed++; }); // ตาล้ม → คงไว้ไม่ติดป้าย
      } finally {
        gemRelease();
      }
      if (items) {
        const byIdx = {};
        for (const it of items) byIdx[it.index] = it;
        ok.forEach((x, k) => {
          const it = byIdx[k];
          // ★ audit B-R4: Gemini degrade ตอบไม่ครบฟิลด์ (ไม่มี relevant) → ห้าม default ป้ายบวกฟรี
          //   ข้ามไม่ติดป้าย (รอบหน้าตาคัดใหม่) — คงหลัก "กัน false drop" แต่ไม่ปล่อยขยะป้ายดีเข้าพูล
          if (!it || typeof it.relevant === 'undefined') { out.push({ ...x.im }); failed++; return; }
          const triage = buildTriage(it, x.r);
          out.push({ ...x.im, triage });
          if (triage.relevant === false) dropped++; else kept++;
        });
      }
    }
    results[bi] = out;
  }

  let nextBatch = 0;
  const workers = Array.from({ length: Math.min(conc, batches.length) }, async () => {
    while (nextBatch < batches.length && !keyError) {
      const bi = nextBatch++;
      await runOneBatch(bi);
    }
  });
  await Promise.all(workers);
  if (keyError) throw keyError;

  const vetted = results.flat().filter(Boolean);
  return { vetted, kept, dropped, failed };
}

// คัดกรองคลัง → คืน { map: {imageId: triage}, tagged, failed, byCategory, byPerson }
export async function triageLibrary({ images, subjects, newsGist, onProgress, onRetry, caseId, batchSize = 10 }) {
  const map = {};
  let tagged = 0;
  let failed = 0;
  const total = images.length;
  const byCategory = {};
  const byPerson = {};

  for (let i = 0; i < images.length; i += batchSize) {
    const slice = images.slice(i, i + batchSize);
    // โหลด base64 พร้อมกันในแบตช์ (เร็วขึ้น) — ทิ้งรูปที่โหลดไม่ได้ (รอบหน้าค่อยลองใหม่)
    const loaded = (await Promise.all(slice.map(loadOne))).filter(Boolean);
    if (onProgress) {
      const done = Math.min(i + batchSize, total);
      onProgress({ done, total, pct: Math.round((done / total) * 100), tagged });
    }
    if (!loaded.length) {
      failed += slice.length;
      continue;
    }
    const frames = loaded.map((b, k) => ({ index: k, base64: b.base64, source: b.im.source, title: b.im.title }));
    let items = [];
    try {
      items = await geminiClassifyFrames({ frames, subjects, newsGist, onRetry, caseId });
    } catch {
      failed += loaded.length; // ตาแบตช์นี้ล้ม → ปล่อยไว้ (ยังไม่ติดป้าย) รอบหน้าลองใหม่
      continue;
    }
    for (const it of items) {
      const src = loaded[it.index];
      if (!src) continue;
      if (typeof it.relevant === 'undefined') continue; // ★ audit B-R4: ตอบครึ่งฟิลด์ = ไม่ติดป้าย รอรอบหน้า (กันป้ายบวกฟรี)
      const triage = buildTriage(it, src);
      map[src.im.id] = triage;
      tagged++;
      byCategory[triage.category] = (byCategory[triage.category] || 0) + 1;
      if (triage.person) byPerson[triage.person] = (byPerson[triage.person] || 0) + 1;
    }
  }

  return { map, tagged, failed, byCategory, byPerson };
}
