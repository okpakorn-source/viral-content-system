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

async function toB64(buf, size = 512) {
  const out = await sharp(buf, { failOn: 'none' })
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return out.toString('base64');
}

// โหลดรูป 1 ใบ → { im, base64, brightness, detail } (คืน null ถ้าโหลด/decode ไม่ได้)
async function loadOne(im) {
  const buf = await loadImageBuffer({ imageUrl: im.thumbnailUrl || im.imageUrl, thumbnailUrl: im.imageUrl });
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
    // ★ 8 ก.ค. (CASE-360): 512→1024 — ที่ 512px ตามองไม่เห็นลายน้ำ/ตัวหนังสือเล็ก → clean=true ผิด
    //   ปลายน้ำพังยกแผง (s6 ไม่ตัดภาพเสีย + s5e ไม่แคปเฟรม) · v3 detector ใช้ 1280px เห็นจริง — ตาคัดต้องเห็นใกล้เคียงกัน
    return { im, base64: await toB64(buf, 1024), brightness, detail };
  } catch {
    return null;
  }
}

// สร้างป้าย triage จากผล classify (it) + ค่าโหลด (src มี brightness/detail)
function buildTriage(it, src) {
  return {
    // "เกี่ยวข่าว" แยกจาก "คุณภาพ" — ทิ้งเฉพาะที่ AI ตีว่าไม่เกี่ยวชัด (undefined = เก็บไว้ กัน false drop)
    relevant: it.relevant !== false,
    // ★ 8 ก.ค. เฟส A: ป้าย "ภาพแฟ้ม" — false = คนในข่าวตัวจริงแต่มาจากงาน/บริบทอื่น (ไม่ระบุ/ข้อมูลเก่า = ถือเป็นภาพข่าว)
    newsScene: it.newsScene !== false,
    clean: it.clean !== false, // พร้อมขึ้นปก (ไม่มีลายน้ำ/ตัวหนังสือ) — คนละเรื่องกับ relevant
    category: it.category || 'other',
    person: it.person || null,
    persons: Array.isArray(it.persons) ? it.persons.filter(Boolean) : it.person ? [it.person] : [],
    emotion: it.emotion || null,
    quality: typeof it.quality === 'number' ? it.quality : 5,
    faceCount: typeof it.faceCount === 'number' ? it.faceCount : it.faceBox ? 1 : 0,
    faceBox: it.faceBox || null,
    peopleBox: it.peopleBox || null,
    brightness: Math.round(src?.brightness ?? 128),
    detail: Math.round(src?.detail ?? 60),
    note: it.note || '',
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
