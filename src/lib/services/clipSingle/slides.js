/**
 * 🖼️ clipSingle/slides.js — โพสต์ภาพสไลด์ (TikTok /photo/) · 10 พ.ย. 69 เคสตำรวจน๊อต (เจ้าของสั่ง "แก้เลย")
 *   เดิมตัวโหลด TikTok หยิบ play (ไฟล์เพลง) ไปให้ Gemini "ดูคลิป" → ไม่เห็นภาพ แต่งเรื่องขึ้นเอง
 *   ไฟล์นี้: โหลดภาพนิ่งทุกใบตามลำดับ + เสียงประกอบ ให้ท่อหลักแนบให้ Gemini ดูทีละภาพ
 */

// ★ 10 พ.ย. 69 (เคสตำรวจน๊อต): โหลดภาพสไลด์ TikTok ทุกใบ (เรียงตามโพสต์) + เสียงประกอบ
//   ย่อภาพด้วย sharp แบบ resize ธรรมดา (ไม่ใช่ AI วาดภาพ — ภาพต้นฉบับ 100% แค่ลดพิกเซล) ให้ทั้งชุดแนบตรงได้ในคำขอเดียว
//   ด้านยาว ≤1536px JPEG q82 (ตัวหนังสือบนภาพยังอ่านชัด) · รวมเกินงบ = ย่ออีกรอบ 1024px q72
//   โหลดไม่ได้สักภาพ = ชั่วคราว ("แน่น" → worker ลองใหม่ ยังไม่ได้จ่ายค่าโมเดล) · ขาดบางภาพ = ทำต่อแล้วติดจุดเช็ค
// ★ ผู้ตรวจอิสระ 10 พ.ย. (รอบ 1): ห้ามส่งไบต์ที่ติดป้ายชนิดผิด (sharp อ่านไม่ได้ = ใช้ชนิดจริงที่ Gemini รับ ไม่งั้นทิ้งภาพนั้น)
//   · content-type ไม่บอกว่าเป็นภาพ = ดูไบต์หัวไฟล์แทนการทิ้ง · เสียงรับเฉพาะชนิดที่ Gemini รับ · ภาพโปร่งใสรองพื้นขาว
export const SLIDES_MAX = 35;
const SLIDES_BUDGET_BYTES = 12 * 1024 * 1024; // base64 โต 1/3 → ~16MB < เพดานแนบตรง 19MB
const SLIDE_AUDIO_MAX_BYTES = 3 * 1024 * 1024;
const GEMINI_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const GEMINI_AUDIO_TYPES = new Map([
  ['audio/mpeg', 'audio/mp3'], ['audio/mp3', 'audio/mp3'], ['audio/wav', 'audio/wav'], ['audio/x-wav', 'audio/wav'],
  ['audio/aac', 'audio/aac'], ['audio/ogg', 'audio/ogg'], ['audio/flac', 'audio/flac'], ['audio/aiff', 'audio/aiff'],
]);

/** ชนิดภาพจากไบต์หัวไฟล์ (ไม่เชื่อ content-type อย่างเดียว) · ไม่รู้จัก = '' */
export function sniffImageType(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return '';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.toString('ascii', 4, 8) === 'ftyp') {
    const brand = b.toString('ascii', 8, 12);
    if (/^(heic|heix|hevc|hevx)$/.test(brand)) return 'image/heic';
    if (/^(mif1|msf1|heif)$/.test(brand)) return 'image/heif';
  }
  return '';
}

export async function downloadTiktokSlides(imageUrls, audioUrl = '', deps = {}) {
  const doFetch = deps.fetch || fetch;
  const list = imageUrls.slice(0, SLIDES_MAX);
  const raw = new Array(list.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      try {
        // eslint-disable-next-line no-await-in-loop -- จำกัดโหลดพร้อมกัน 4 ภาพ
        const r = await doFetch(list[i], { signal: AbortSignal.timeout(30_000) });
        if (r?.ok === false) continue;
        // eslint-disable-next-line no-await-in-loop
        const b = Buffer.from(await r.arrayBuffer());
        const sniffed = sniffImageType(b);
        const header = String(r?.headers?.get?.('content-type') || '').toLowerCase().split(';')[0].trim();
        if (b.length <= 1000 || !(sniffed || header.startsWith('image/'))) continue; // หน้า error/HTML = ไม่ใช่ภาพ
        raw[i] = { no: i + 1, buffer: b, type: sniffed || header, sniffed };
      } catch { /* ภาพนี้โหลดไม่ได้ — นับเป็นภาพที่ขาด */ }
    }
  }));
  const got = raw.filter(Boolean);
  if (!got.length) throw new Error('tikwm โหลดภาพสไลด์ไม่ได้สักภาพ แน่นชั่วคราว ลองใหม่ได้');
  let sharp = deps.sharp;
  if (sharp === undefined) { try { sharp = (await import('sharp')).default; } catch { sharp = null; } }
  // ย่อไม่ได้ = ใช้ไฟล์เดิมเฉพาะภาพที่ "หัวไฟล์ยืนยัน" ว่าเป็นชนิดที่ Gemini รับ (ติดป้ายตามชนิดจริง) · อื่นๆ = ทิ้ง (นับเป็นภาพที่ขาด)
  //   ★ ผู้ตรวจอิสระรอบ 2: ไม่เชื่อ content-type อย่างเดียว (HTML ที่ตอบ image/jpeg เคยหลุดเป็นภาพ)
  const asIs = (g) => (g.sniffed && GEMINI_IMAGE_TYPES.has(g.sniffed) ? { no: g.no, mimeType: g.sniffed, buffer: g.buffer } : null);
  const shrink = async (side, quality) => (await Promise.all(got.map(async (g) => {
    if (!sharp) return asIs(g);
    try {
      const out = await sharp(g.buffer).rotate()
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }) // ภาพโปร่งใส → พื้นขาว (ไม่ให้ตัวหนังสือสีดำหายไปในพื้นดำของ JPEG)
        .jpeg({ quality }).toBuffer();
      return { no: g.no, mimeType: 'image/jpeg', buffer: out };
    } catch { return asIs(g); }
  }))).filter(Boolean);
  let images = await shrink(1536, 82);
  const size = (arr) => arr.reduce((s, p) => s + p.buffer.length, 0);
  if (size(images) > SLIDES_BUDGET_BYTES) images = await shrink(1024, 72);
  while (images.length > 1 && size(images) > SLIDES_BUDGET_BYTES) images.pop(); // กันเกินเพดานจริง (ภาพท้ายที่ตัด = นับเป็นภาพที่ขาด)
  if (!images.length) throw new Error('ภาพสไลด์เป็นชนิดที่ระบบอ่านไม่ได้ทุกภาพ — กดใหม่ไม่ช่วย');
  let audio = null;
  if (audioUrl) {
    try {
      const r = await doFetch(audioUrl, { signal: AbortSignal.timeout(60_000) });
      const type = GEMINI_AUDIO_TYPES.get(String(r?.headers?.get?.('content-type') || '').toLowerCase().split(';')[0].trim());
      if (r?.ok !== false && type) {
        const b = Buffer.from(await r.arrayBuffer());
        if (b.length > 1000 && b.length <= SLIDE_AUDIO_MAX_BYTES && size(images) + b.length <= SLIDES_BUDGET_BYTES) audio = { mimeType: type, buffer: b };
      }
    } catch { /* ไม่มีเสียงประกอบก็ดูภาพได้ */ }
  }
  const kept = new Set(images.map((p) => p.no));
  const missingNos = Array.from({ length: imageUrls.length }, (_, i) => i + 1).filter((n) => !kept.has(n));
  return {
    images: images.map(({ mimeType, buffer }) => ({ mimeType, buffer })),
    audio, total: imageUrls.length, skipped: missingNos.length, missingNos,
  };
}

/** ★ 10 พ.ย. 69: ลิงก์โพสต์ภาพของ TikTok (…/photo/<id>) */
export function isTiktokPhotoUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return /(^|\.)tiktok\.com$/i.test(u.hostname) && /\/photo\/\d+/.test(u.pathname);
  } catch { return false; }
}

/**
 * ★ ผู้ตรวจอิสระ 10 พ.ย. (รอบ 1 ข้อ 2): ใบ TikTok ที่ถอดก่อนแก้ แล้ว Gemini ได้แค่ไฟล์เสียง (โพสต์รูปผ่านลิงก์สั้น vt.tiktok)
 *   ดูจากใบเสร็จ: ดูแบบวิดีโอ แต่โทเคน "VIDEO" ต่อวินาทีต่ำระดับเสียงล้วน (~25/วิ · วิดีโอจริง ~90/วิ) → คลังห้ามคืนใบนี้
 */
export function looksAudioOnlyWatch(insight) {
  const w = insight?.single?.writer;
  if (!w || w.kind !== 'gemini-video') return false;
  const dur = Number(insight?.clipDurationSec) || 0;
  const details = Array.isArray(w.usage?.promptTokensDetails) ? w.usage.promptTokensDetails : [];
  const video = details.find((d) => d?.modality === 'VIDEO');
  if (!dur || !video || details.some((d) => d?.modality === 'IMAGE')) return false;
  return Number(video.tokenCount) / dur < 40;
}
