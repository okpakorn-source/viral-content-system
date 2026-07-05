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
    return { im, base64: await toB64(buf), brightness, detail };
  } catch {
    return null;
  }
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
      const relevant = it.clean !== false; // clean gate ครอบคลุมความเกี่ยวข้อง/ownership/ขยะแล้ว
      const triage = {
        relevant,
        clean: it.clean !== false,
        category: it.category || 'other',
        person: it.person || null,
        persons: Array.isArray(it.persons) ? it.persons.filter(Boolean) : it.person ? [it.person] : [],
        emotion: it.emotion || null,
        quality: typeof it.quality === 'number' ? it.quality : 5,
        faceCount: typeof it.faceCount === 'number' ? it.faceCount : it.faceBox ? 1 : 0,
        faceBox: it.faceBox || null,
        peopleBox: it.peopleBox || null,
        brightness: Math.round(src.brightness),
        detail: Math.round(src.detail),
        note: it.note || '',
      };
      map[src.im.id] = triage;
      tagged++;
      byCategory[triage.category] = (byCategory[triage.category] || 0) + 1;
      if (triage.person) byPerson[triage.person] = (byPerson[triage.person] || 0) + 1;
    }
  }

  return { map, tagged, failed, byCategory, byPerson };
}
