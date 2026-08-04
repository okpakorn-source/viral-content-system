export const maxDuration = 800; // ★ 25 มิ.ย.: 300→800 — Gemini retry ได้ 4×180s=720s เกิน 300 → Vercel ฆ่าฟังก์ชันกลางคัน คืน error page (text) ทำหน้าเว็บ parse JSON พัง "An error o..." (แพลนรองรับ 800 เท่า queue worker)
import { NextResponse } from 'next/server';
import { extractClipInsight, extractInsightFromVideoBuffer, extractMultiTopicInsight, extractMultiTopicFromVideoBuffer, currentInsightPromptRev } from '@/lib/services/clipInsightService';
import { createStore } from '@/lib/persistStore';
import { getClipVideoQueue } from '@/lib/services/clipQueue';
import { randomUUID } from 'crypto';

// ★ 4 ส.ค. 69 — ชุด "คุณภาพหลังคัดเลือก" 3 ประตู ปิดเป็นค่าเริ่มต้นทั้งหมด:
//   CLIP_SOURCE_META=1 → ดึง metadata ต้นทาง (เพจ/หัวข้อ/แคปชั่น) แบบ best-effort แล้วส่งเข้ารอบแรก+รอบ v2
//   CLIP_PROMPT_0804=1 → ป้ายรุ่นพรอมต์ชุดใหม่ (บล็อกพรอมต์จริงอยู่ฝั่ง service)
//   CLIP_QC_GATES=1    → ด่านตรวจกลไก (ธงคุณภาพ) + ลองรอบ v2 ใหม่ 1 ครั้ง + สำรองโหลด TikTok ด้วย yt-dlp
//   🔴 ประตูไม่เปิด = เส้นทางเดิมเป๊ะ 100% (ไม่โหลดโมดูลใหม่ · ไม่ยิงเน็ตเพิ่ม · ไม่เขียนคลังเพิ่ม)
//   อ่าน env ตอนเรียก (ไม่แคชตอน import) — เทส/สคริปต์สลับค่าได้ระหว่างรัน
const SOURCE_META_ON = () => process.env.CLIP_SOURCE_META === '1';
const PROMPT_0804_ON = () => process.env.CLIP_PROMPT_0804 === '1';
const QC_GATES_ON = () => process.env.CLIP_QC_GATES === '1';

// ★ 4 ส.ค.: โมดูลใหม่ 2 ตัวโหลดแบบ lazy "ในบล็อกที่ประตูเปิดเท่านั้น" (สไตล์เดียวกับ clipRawStoryService ในไฟล์นี้)
//   เหตุผล: ประตูปิด = ไม่แตะโมดูลใหม่เลย → เส้นทางเดิม/เทสปักหมุดเดิมไม่มีทางกระทบ แม้โมดูลยังไม่ถูกวาง
//   '@/lib/services/clipSourceMetaService' → getClipSourceMeta(url, opts)
//   '@/lib/services/clipQualityLint'       → lintLanguage / lintQuotePresence / lintTopicCoverage

// ดึง metadata ต้นทาง — best-effort ล้วน: ล้ม/ไม่มีโมดูล/ไม่มีข้อมูล = คืน null แล้วเดินต่อ (ห้ามทำให้ถอดคลิปล้ม)
async function _safeSourceMeta(url, opts) {
  try {
    const { getClipSourceMeta } = await import('@/lib/services/clipSourceMetaService');
    const meta = await getClipSourceMeta(url, opts);
    if (meta && (meta.uploader || meta.title || meta.caption)) {
      console.log(`[ClipInsight] 📎 metadata ต้นทาง (${meta.source || '-'}): ${String(meta.uploader || '-').slice(0, 40)}`);
      return meta;
    }
    return null;
  } catch (e) {
    console.warn('[ClipInsight] ดึง metadata ต้นทางไม่ได้ (เดินต่อแบบไม่มี meta):', String(e?.message || e).slice(0, 70));
    return null;
  }
}

// รวมเนื้อรอบ v2 (ก้อนรวม + ประเด็นย่อย) เป็นข้อความเดียวสำหรับด่านตรวจ — ไม่แตะของที่เก็บในคลัง
function _v2Text(rs) {
  return [String(rs?.rawStory || ''), ...((rs?.topics || []).map(t => String(t?.rawStory || t?.text || '')))]
    .filter(s => s.trim()).join('\n');
}

// ★ ผู้ตรวจไขว้ 4 ส.ค. (#2): สาเหตุ v2 ล้มต้องอ่านรู้เรื่อง — service ส่งรหัสสั้นมา (message) + ข้อความจริง (cause)
//   แปลงรหัสเป็นภาษาคน + พ่วงรายละเอียดจริงต่อท้าย (ไม่ทิ้งข้อมูลวินิจฉัย) — ผู้เรียกตัด 200 ตัวเองตอนเก็บ
const _V2_ERR_TH = {
  JSON_PARSE: 'คำตอบจากสมองอ่านไม่ออก',
  GEMINI_EMPTY: 'สมองไม่ส่งเนื้อกลับมา',
  UPLOAD_FAILED: 'อัปโหลดวิดีโอไม่สำเร็จ',
  TIMEOUT: 'หมดเวลาระหว่างดูคลิป',
  AUTH_FAILED: 'กุญแจระบบมีปัญหา',
};
function _v2ErrText(e) {
  const code = String(e?.message || e || '').trim();
  // Object.hasOwn — กันคีย์สืบทอด (เช่น message='constructor') ให้ค่าขยะ (ผู้ตรวจ N1)
  const human = Object.hasOwn(_V2_ERR_TH, code) ? `${_V2_ERR_TH[code]} (${code})` : code;
  const cause = e?.cause?.message ? ` — ${String(e.cause.message).slice(0, 100)}` : '';
  return human + cause;
}

// ด่านตรวจ "มีคำพูดจริงไหม" — ฟังก์ชันบริสุทธิ์ฝั่ง lint แต่ห่อกันล้มไว้ (ล้ม = คืน null แล้วข้าม)
async function _safeLintQuote(insight, storyText) {
  try {
    const { lintQuotePresence } = await import('@/lib/services/clipQualityLint');
    return lintQuotePresence(insight, storyText);
  } catch (e) {
    console.warn('[ClipInsight] ด่านตรวจคำพูดล้ม (ข้าม):', String(e?.message || e).slice(0, 70));
    return null;
  }
}

// โหลดไฟล์วิดีโอ TikTok (tikwm) — ใช้บนคลาวด์ได้
// ★ 22 ก.ค. 69: ใส่ timeout ทั้ง 2 จังหวะ — วันที่ tikwm ค้าง (เจอจริง: แขวนเกิน 7 นาที) งานเคยค้างจนโดนตัด 16 นาที/รอบแล้ววนใหม่
//   fail เร็ว → เข้าคิว retry ปกติ (ทุก ~3 นาที) แทนการแขวนคิวยาว
//   ★ 4 ส.ค. 69: รับ sink (optional) — คืนข้อมูลโพสต์ที่ tikwm ส่งมาพร้อมลิงก์วิดีโออยู่แล้ว (ผู้โพสต์/แคปชั่น)
//     ให้ผู้เรียกเอาไปทำ metadata ต้นทางได้โดยไม่ต้องยิง tikwm ซ้ำ · sink เป็นอ็อบเจ็กต์ชั่วคราวของผู้เรียก ไม่ถูกเก็บลงคลัง
async function downloadTiktokBuffer(url, sink = null) {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, { signal: AbortSignal.timeout(30_000) });
  const data = await res.json();
  const playUrl = data?.data?.hdplay || data?.data?.play;
  if (sink) sink.info = data?.data || null;
  if (!playUrl) throw new Error('tikwm: ไม่พบลิงก์วิดีโอ');
  const vres = await fetch(playUrl, { signal: AbortSignal.timeout(120_000) });
  const buf = Buffer.from(await vres.arrayBuffer());
  if (buf.length < 10000) throw new Error('วิดีโอเล็กเกินไป');
  if (buf.length > 150 * 1e6) throw new Error('วิดีโอใหญ่เกิน 150MB');
  return buf;
}

// โหลดไฟล์วิดีโอ Facebook/IG/YouTube (yt-dlp) — เครื่องทีม Windows เท่านั้น
//   ★ 26 มิ.ย.: รับ fmt ได้ (YouTube ใช้ ≤480p กันไฟล์ใหญ่/อัปนาน · FB/IG ใช้ค่าเดิม)
async function downloadMetaBuffer(url, fmt) {
  if (process.platform !== 'win32') throw new Error('Facebook/IG/YouTube โหลดวิดีโอได้เฉพาะเครื่องทีม (Windows)');
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const { readFile, unlink } = await import('fs/promises');
  const { existsSync } = await import('fs');
  const execFileAsync = promisify(execFile);
  const exe = join(process.cwd(), 'bin', 'yt-dlp.exe');
  if (!existsSync(exe)) throw new Error('ไม่พบ bin/yt-dlp.exe');
  const cookies = join(process.cwd(), 'bin', 'cookies.txt');
  const out = join(tmpdir(), `meta_${Date.now()}.mp4`);
  const args = ['-f', fmt || 'mp4/best[ext=mp4]/best', '-o', out, '--no-warnings', '--no-playlist'];
  if (existsSync(cookies)) args.push('--cookies', cookies);
  args.push(url);
  try {
    await execFileAsync(exe, args, { maxBuffer: 1024 * 1024 * 20, timeout: 180_000 });
    if (!existsSync(out)) throw new Error('โหลดวิดีโอ Meta ไม่สำเร็จ');
    const buf = await readFile(out);
    if (buf.length < 10000) throw new Error('วิดีโอเล็กเกินไป');
    return buf;
  } catch (e) {
    // ★ 4 ส.ค. 69: IG โดนกั้นโหลดแบบไม่ล็อกอิน — yt-dlp คืน "empty media response" ซึ่งอ่านแล้วไม่รู้ว่าต้องทำอะไร
    //   เปลี่ยนเป็นข้อความตรงความจริง + ทางแก้จริง (เจ้าของต้องวางไฟล์กุญแจเอง — โค้ดฝั่งอ่านคุกกี้รองรับอยู่แล้วข้างบน)
    const raw = `${e?.message || ''} ${e?.stderr || ''}`;
    if (/empty media response/i.test(raw) && /instagram\.com/i.test(String(url))) {
      const err = new Error('Instagram ต้องมีไฟล์กุญแจ bin/cookies.txt (แจ้งเจ้าของวางไฟล์) จึงจะโหลดได้');
      err.code = 'IG_COOKIES_REQUIRED';
      throw err;
    }
    throw e;
  } finally { await unlink(out).catch(() => {}); }
}

// ★ 4 ส.ค. 69 (ประตู CLIP_QC_GATES) — TikTok: tikwm ล้ม/ค้าง (เจอจริงเป็นช่วงๆ) → บนเครื่องทีมลองโหลดด้วย yt-dlp
//   ใช้ helper โหลดวิดีโอเดิม (downloadMetaBuffer) ตรงๆ ไม่เพิ่มเส้นทางโหลดใหม่ · ประตูปิด/ไม่ใช่ win32 = โยน error เดิมออกไปเหมือนเดิมเป๊ะ
async function _downloadTiktokWithFallback(url, sink = null) {
  try {
    return await downloadTiktokBuffer(url, sink);
  } catch (e) {
    if (!QC_GATES_ON() || process.platform !== 'win32') throw e;
    console.warn(`[ClipInsight] 🔄 tikwm ล้ม (${String(e.message).slice(0, 60)}) → ลองโหลดด้วย yt-dlp (เครื่องทีม)`);
    try {
      return await downloadMetaBuffer(url);
    } catch (e2) {
      const err = new Error(`${e.message} · yt-dlp สำรองไม่ผ่าน: ${String(e2.message).slice(0, 80)}`);
      err.code = e.code || e2.code || 'TIKTOK_DOWNLOAD_FAILED';
      throw err;
    }
  }
}

// ★ 24 มิ.ย.: หาความยาวคลิป (วินาที) ด้วย yt-dlp — ใช้ตัดสินใจ "คลิปยาว→แยกทุกประเด็น"
//   คืน 0 ถ้าหาไม่ได้ (ไม่มี yt-dlp/cloud) → ระบบจะใช้โหมด single (คลิปสั้น) เป็นค่าปลอดภัย ไม่ทำของเดิมพัง
async function getClipDurationSec(url) {
  try {
    if (process.platform !== 'win32') return 0;
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const execFileAsync = promisify(execFile);
    const exe = join(process.cwd(), 'bin', 'yt-dlp.exe');
    if (!existsSync(exe)) return 0;
    const cookies = join(process.cwd(), 'bin', 'cookies.txt');
    const args = ['--no-warnings', '--no-playlist', '--get-duration'];
    if (existsSync(cookies)) args.push('--cookies', cookies);
    args.push(url);
    const { stdout } = await execFileAsync(exe, args, { timeout: 60_000, maxBuffer: 1024 * 1024 });
    const line = String(stdout).trim().split('\n').filter(Boolean).pop() || '';
    const parts = line.trim().split(':').map(n => parseInt(n, 10));
    if (!parts.length || parts.some(isNaN)) return 0;
    let sec = 0; for (const n of parts) sec = sec * 60 + (n || 0);
    return sec;
  } catch { return 0; }
}

/**
 * POST /api/clip-transcript/insight (16 มิ.ย. 69) — ถอดประเด็นข่าวจากคลิป → "ข้อมูลดิบ"
 *  • YouTube → Gemini ดูคลิปจริง (ภาพ+เสียง) | ล้ม → fallback ถอดเสียง + LLM
 *  • TikTok/FB → ถอดเสียง + LLM
 * ★ แยกจากเวิร์กโฟลว์ข่าว 100% — เรียกตัววิเคราะห์ตรงๆ ไม่แตะคิว/worker/ไลน์เขียน
 */
function detectClipType(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/facebook\.com|fb\.watch|instagram\.com/i.test(url)) return 'meta';
  return null;
}

// ★ 22 มิ.ย.: แปลง error ดิบให้คนเข้าใจ — กรณี Gemini แน่นชั่วคราว (503) บอกให้กดใหม่ ไม่ใช่ "parse ไม่ได้" งงๆ
function humanizeErr(raw) {
  const m = String(raw || '');
  // ★ 25 มิ.ย.: แยก 2 กรณีให้ผู้ใช้รู้ — (ก) ระบบเรา timeout เอง (คลิปยาว/ช้า)  (ข) Gemini แน่นจริง
  // (ก) timeout/deadline = คลิปยาวเกินเวลาที่ตั้ง (ไม่ใช่ Gemini ล่ม) → บอกตรงๆ + ทางออก
  if (/deadline|timed out|timeout|ETIMEDOUT|aborted|\b504\b/i.test(m)) {
    return 'คลิปนี้ยาว/ประมวลผลนานเกินเวลาที่ตั้งไว้ (ระบบขยายเวลาเป็น ~4.5 นาทีแล้ว) — ลองกด "ถอดประเด็นข่าว" อีกครั้ง · ถ้าคลิปยาวมาก (เกิน ~15 นาที) แนะนำกด "ส่งเข้าคิว (เครื่องทีม)" ที่ให้เวลานานกว่า';
  }
  // (ข2) Gemini เปิดดูคลิปไม่ได้จริง (ส่วนตัว/จำกัดอายุ/ลิงก์เสีย) — กดใหม่ไม่ช่วย
  if (/ดูคลิปไม่ได้|ส่วนตัว|private|age.?restrict|จำกัดอายุ|unsupported|ไม่ส่งข้อมูล/i.test(m)) {
    return 'Gemini เปิดดูคลิปนี้ไม่ได้ (อาจเป็นคลิปส่วนตัว/จำกัดอายุ/ลิงก์มีปัญหา) — ลองเช็คว่าคลิปเปิดสาธารณะ หรือใช้คลิปอื่น';
  }
  // (ข) Gemini แน่น/ล่มชั่วคราว (503/429/overload) → รอแล้วกดใหม่ (ระบบใช้ Gemini ดูคลิปจริงเท่านั้น เพื่อคุณภาพสูงสุด)
  //   ★ 26 มิ.ย. (ผู้ใช้สั่ง): ไม่ถอย fallback OpenAI — รอ Gemini ดูคลิปจริงดีกว่า (ข้อมูลดิบดีกว่ามาก)
  if (/503|429|high demand|overload|unavailable|temporar|rate limit|parse ไม่ได้/i.test(m)) {
    return 'ตอนนี้ Gemini มีคนใช้งานหนัก (แน่นชั่วคราว) — กดปุ่ม "ถอดประเด็นข่าว" อีกครั้งได้เลย เดี๋ยวก็ผ่าน (ระบบรอ Gemini ดูคลิปจริงเพื่อข้อมูลดิบคุณภาพสูงสุด ไม่ถอยไปสรุปจากเสียงล้วน)';
  }
  return m.slice(0, 120) || 'ถอดประเด็นล้มเหลว';
}

// ★ 21 มิ.ย. (บั๊ก: URL ติด &fbclid=... ยาว → Gemini ดูคลิปไม่ได้): ล้าง URL ให้สะอาด
//   YouTube → ดึง video ID สร้าง watch URL ใหม่ (กันพารามิเตอร์เฟซบุ๊ก/ติดตามทำพัง) · อื่นๆ → ตัด tracking params
export function cleanClipUrl(raw) {
  const u = String(raw || '').trim();
  const yt = u.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return `https://www.youtube.com/watch?v=${yt[1]}`;
  try {
    const url = new URL(u);
    ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'si', 'feature', 'app_id', '_aem', 'mibextid'].forEach(p => url.searchParams.delete(p));
    return url.toString();
  } catch { return u.split('#')[0]; }
}

async function transcribeFor(url, type) {
  if (type === 'youtube') {
    const { transcribeYoutube } = await import('@/lib/services/youtubeService');
    const r = await transcribeYoutube({ url });
    return r.success ? (r.rawText || r.text || '') : '';
  }
  if (type === 'tiktok') {
    const { transcribeTiktok } = await import('@/lib/services/tiktokService');
    const r = await transcribeTiktok({ url });
    return r.success ? (r.rawText || r.text || '') : '';
  }
  if (type === 'meta') {
    const { transcribeMetaReel } = await import('@/lib/services/metaReelsService');
    const r = await transcribeMetaReel({ url });
    return r.success ? (r.rawText || r.text || '') : '';
  }
  return '';
}

// ★ 22 มิ.ย.: รวมตรรกะสกัด "ข้อมูลดิบ" ไว้ในฟังก์ชันเดียว (ดูคลิป→fallback ถอดเสียง) — โยน error ที่มี .code
//   เพื่อให้ห่อด้วยคิวได้สะอาด (ไม่ปน NextResponse กับงานหนัก)
// ★ 26 มิ.ย.: ตัดเวลา promise — กัน YouTube URL passthrough ค้างนาน (Gemini โหลด YouTube ไม่ได้) → รีบสลับเส้นทาง
function _raceTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => { const e = new Error(`${label} ค้างเกิน ${Math.round(ms / 1000)} วิ`); e.code = 'URL_TIMEOUT'; rej(e); }, ms)),
  ]);
}
// ★ 26 มิ.ย. (ค่ำ): จำว่า "Gemini โหลด YouTube URL เองค้าง" → ข้ามไปโหลดเองเลยชั่วคราว (กันเสีย 170 วิ ซ้ำ ๆ ทุกคลิป)
//   เครื่องทีมที่มี yt-dlp: เจอค้างครั้งแรก → จำ 20 นาที → คลิปถัดไปข้าม URL ไปโหลดเองทันที (เร็วขึ้นมาก)
//   ครบ 20 นาทีลอง URL ใหม่ (เผื่อ Gemini ฝั่งโหลด YouTube ฟื้น) — ปรับอัตโนมัติ ไม่ต้องแก้มือ
//   ★ เริ่มต้น = ข้าม URL ไว้ก่อน 20 นาที (26 มิ.ย. Gemini โหลด YouTube เองพังทั้งวัน) → YouTube เร็วทันทีทุกตัว
//     ถ้าฝั่งโหลด YouTube ฟื้น: ครบ 20 นาทีจะลอง URL เอง · ถ้าอยากกลับไปลอง URL ก่อนเสมอ ตั้งเป็น 0
let _ytUrlBrokenUntil = Date.now() + 20 * 60 * 1000;

async function buildInsight({ url, type }, ctx = null) {
  // ★ 23 ก.ค.: ctx (optional) — เก็บ buffer/URL ที่ใช้จริง ให้รอบ "เนื้อดิบมีมิติ" หยิบไปใช้ซ้ำ ไม่โหลด/ไม่แตะ insight เดิม
  // ★ 25 มิ.ย.: ใช้ insight เดียว (enhanced) เสมอ — Gemini "ตัดสินเอง" (content-aware) ว่าคลิปมีหลายประเด็นไหม
  //   มีหลายประเด็น → ใส่ subStories (เนื้อดิบแยกประเด็น) เพิ่มจาก rawData รวม · เรื่องเดียว → subStories ว่าง
  //   เลิกพึ่ง getClipDurationSec (ยึด yt-dlp = พังบนคลาวด์ → เคยได้ single เสมอ) — ตอนนี้ทำงานทั้ง cloud+โลคัล
  // ★ 26 มิ.ย. (ผู้ใช้สั่ง): ใช้ "Gemini ดูคลิปจริง" เท่านั้น — ปิด fallback ถอดเสียง+OpenAI
  //   เหตุผล: Gemini ดูคลิป (เห็นภาพ+ตัวหนังสือบนจอ+ฟังเสียง) ถอดข้อมูลดิบมีประสิทธิภาพกว่ามาก
  //   ถ้า Gemini แน่น → โยน error ให้ผู้ใช้ "รอ/กดใหม่" ดีกว่าได้ผลด้อยจาก transcript ล้วน
  //   (ฟังก์ชัน transcript ยังอยู่ในโค้ด เผื่อเปิดใช้ภายหลัง — แค่ไม่เรียกในเส้นทาง insight)
  // ★ 4 ส.ค. 69 (ประตู CLIP_SOURCE_META) — ดึง "หลักฐานระดับแคปชั่น/เพจ" ก่อนเรียกสมองดูคลิป
  //   YouTube/FB/IG: ถามตรงจากตัวดึง meta · TikTok: รอ tikwm ที่โหลดวิดีโออยู่แล้ว (อยู่ล่างสุดของฟังก์ชัน) จะได้ไม่ยิงซ้ำ
  //   ได้ null (ล้ม/ไม่มีข้อมูล) = เดินต่อแบบไม่มี meta — ห้ามทำให้เส้นทางถอดคลิปล้มเด็ดขาด
  //   ผู้ตรวจไขว้ (#7): รอบถอดซ้ำ QC ส่ง meta เดิมมาทาง ctx — ใช้ซ้ำเลย ไม่ดึงใหม่ให้เสียเวลา (สูงสุด ~28s) แล้วทิ้งผล
  let sourceMeta = (ctx && ctx.sourceMeta) || null;
  if (!sourceMeta && SOURCE_META_ON() && type !== 'tiktok') {
    sourceMeta = await _safeSourceMeta(url, { platform: type });
    if (ctx && sourceMeta) ctx.sourceMeta = sourceMeta;
  }
  const _metaArg = () => (sourceMeta ? { sourceMeta } : undefined); // ประตูปิด = undefined → รูปแบบการเรียกเท่าเดิม
  if (type === 'youtube') {
    // ★ 26 มิ.ย. (ผู้ใช้สั่ง + ปรับเร็วขึ้น): YouTube ไฮบริด "อัจฉริยะ"
    //   - เครื่องทีม (win32 มี yt-dlp): ถ้าเพิ่งเจอ URL ค้าง (ใน 20 นาที) → ข้ามไปโหลดเองเลย (ไม่เสีย 170 วิ ซ้ำ)
    //     ไม่งั้นลอง URL ก่อน (170 วิ) → ค้าง → จำไว้ + สลับโหลดเอง+อัปไฟล์ (เหมือน TikTok/FB คุณภาพเท่าเดิม)
    //   - cloud (Vercel ไม่มี yt-dlp): ใช้ URL อย่างเดียว (ทางเลือกเดียว)
    const YT_FMT = 'best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best';
    const downloadAndExtract = async () => {
      const buf = await downloadMetaBuffer(url, YT_FMT);
      if (ctx) { ctx.mode = 'buffer'; ctx.buffer = buf; ctx.mimeType = 'video/mp4'; } // ★ 23 ก.ค.: เก็บ buffer ให้รอบเนื้อดิบมีมิติใช้ซ้ำ
      return await extractInsightFromVideoBuffer(buf, 'video/mp4', _metaArg());
    };
    if (process.platform === 'win32') {
      if (Date.now() < _ytUrlBrokenUntil) {
        console.log('[ClipInsight] ⏩ YouTube: ข้าม URL (เพิ่งค้าง) → โหลดเองเลย');
        return await downloadAndExtract();
      }
      try {
        const _r = await _raceTimeout(extractClipInsight({ url, platform: 'youtube', ...(sourceMeta ? { sourceMeta } : {}) }), 170_000, 'YouTube URL passthrough');
        if (ctx) { ctx.mode = 'youtube-url'; ctx.url = url; } // ★ 23 ก.ค.: รอบเนื้อดิบมีมิติใช้ URL passthrough เช่นกัน
        return _r;
      } catch (e) {
        _ytUrlBrokenUntil = Date.now() + 20 * 60 * 1000; // จำว่า URL ค้าง → ข้าม 20 นาที
        console.log(`[ClipInsight] 🔄 YouTube URL ค้าง → โหลดเอง + ข้าม URL 20 นาที: ${String(e.message).slice(0, 60)}`);
        return await downloadAndExtract();
      }
    }
    if (ctx) { ctx.mode = 'youtube-url'; ctx.url = url; }
    return await extractClipInsight({ url, platform: 'youtube', ...(sourceMeta ? { sourceMeta } : {}) }); // cloud: URL passthrough เท่านั้น
  }
  // TikTok/FB/IG → โหลดไฟล์ให้ Gemini "ดูจริง" (เห็นภาพ+ตัวหนังสือบนจอ) — ไม่มี fallback ถอดเสียง
  const tikwmSink = {}; // ★ 4 ส.ค.: กล่องรับข้อมูลโพสต์จาก tikwm (ใช้ต่อเมื่อประตู meta เปิดเท่านั้น)
  const buf = type === 'tiktok' ? await _downloadTiktokWithFallback(url, tikwmSink) : await downloadMetaBuffer(url);
  if (ctx) { ctx.mode = 'buffer'; ctx.buffer = buf; ctx.mimeType = 'video/mp4'; } // ★ 23 ก.ค.: เก็บ buffer ให้รอบเนื้อดิบมีมิติใช้ซ้ำ
  // ★ 4 ส.ค. (ประตู CLIP_SOURCE_META): TikTok ทำ meta ตรงนี้ — ใช้ข้อมูลจาก tikwm ที่เพิ่งโหลดวิดีโอมา ไม่ยิงเน็ตซ้ำ
  if (SOURCE_META_ON() && type === 'tiktok' && !sourceMeta) {
    sourceMeta = await _safeSourceMeta(url, { platform: 'tiktok', tikwmInfo: tikwmSink.info || null });
    if (ctx && sourceMeta) ctx.sourceMeta = sourceMeta;
  }
  return await extractInsightFromVideoBuffer(buf, 'video/mp4', _metaArg());
}

// ★ (เลิกใช้ชั่วคราว 26 มิ.ย. — เก็บไว้เผื่อเปิด fallback ถอดเสียงภายหลัง)
async function _buildInsightTranscriptFallback({ url, type }) {
  const rawText = await transcribeFor(url, type);
  if (!rawText || rawText.length < 40) {
    const e = new Error('ดูคลิป/ถอดเสียงไม่สำเร็จ — คลิปอาจไม่มีเสียง หรือ Facebook/IG ทำได้เฉพาะเครื่องทีม'); e.code = 'CLIP_FAILED'; throw e;
  }
  return await extractClipInsight({ url, platform: 'transcript', rawText });
}

// ★ 8 ก.ค.: ด่านตรวจคุณภาพก่อนเก็บคลัง — เช็คง่ายๆ ไม่เรียก AI (เคยมีเคส rawData ว่าง 0 ตัวอักษรหลุดเข้าคลัง
//   จาก JSON ถูกตัดท้ายแล้วซ่อมไม่ครบ) — คืน [] = ผ่าน, ไม่ผ่านคืนรายการปัญหา
const RAWDATA_MIN_CHARS = 300;
function insightQualityIssues(insight) {
  const issues = [];
  const raw = String(insight?.rawData || '');
  if (raw.length < RAWDATA_MIN_CHARS) issues.push(`เนื้อดิบสั้นผิดปกติ (${raw.length} ตัวอักษร)`);
  if (!String(insight?.headline || '').trim()) issues.push('ไม่มีหัวข้อข่าว');
  return issues;
}

export async function POST(request) {
  try {
    // ★ 8 ก.ค.: รับเพิ่ม force (ถอดใหม่ ไม่เอาผลจากคลัง) + user (ใครส่ง — เก็บเป็น metadata คลัง)
    // ★ 3 ส.ค. (ผู้ตรวจไขว้รอบ 2 F3): skipRawStoryV2 — ให้ผู้เรียก "ภายใน" (hunt / โต๊ะวิจัย) ปิดรอบ v2 ได้
    //   เพราะสวิตช์ CLIP_RAWSTORY_V2 เป็นของทั้ง endpoint ถ้าไม่ปิด ระบบอื่นที่ยิงเข้ามาจะโดนรอบสองด้วย
    //   (จ่าย Gemini เพิ่ม + กินงบเวลาของ caller จนงานหลักโดนตัด)
    const { url: _rawUrl, force = false, user = '', skipRawStoryV2 = false } = await request.json();
    if (!_rawUrl || typeof _rawUrl !== 'string') {
      return NextResponse.json({ success: false, error: 'กรุณาวางลิงก์คลิป', errorType: 'MISSING_URL' }, { status: 400 });
    }
    const url = cleanClipUrl(_rawUrl); // ★ ล้าง fbclid/tracking ก่อน (กัน Gemini ดูคลิปพัง)
    const type = detectClipType(url);
    if (!type) {
      return NextResponse.json({ success: false, error: 'ลิงก์ไม่รองรับ — ใช้ได้เฉพาะ TikTok / YouTube / Facebook(IG)', errorType: 'UNSUPPORTED_URL' }, { status: 400 });
    }

    // ★ 8 ก.ค.: dedup ข้ามเวลา — คลิปนี้เคยถอดสำเร็จแล้ว (คุณภาพผ่านเกณฑ์) → คืนผลเดิมทันที ฟรี+เร็ว
    //   (เดิมกันซ้ำแค่งานที่ยังรันอยู่ 3 ชม. — กดซ้ำ/ส่งซ้ำคนละวัน = จ่ายค่า Gemini ดูคลิปเดิมเต็มราคา)
    //   force=true (ปุ่ม "ถอดใหม่" ใน UI) → ข้ามคลัง ถอดสดเสมอ
    if (!force) {
      try {
        const store = createStore('clip-insights');
        const all = await store.getAll();
        const hit = all
          .filter(c => c.url === url && !c.lowQuality && String(c.insight?.rawData || '').length >= RAWDATA_MIN_CHARS)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        if (hit) {
          console.log(`[ClipInsight] ⚡ ผลจากคลัง (เคยถอดแล้ว ${hit.createdAt}): ${url.slice(0, 60)}`);
          return NextResponse.json({ success: true, data: { id: hit.id, platform: hit.platform, ...hit.insight, cached: true, cachedAt: hit.createdAt } });
        }
      } catch (e) { console.warn('[ClipInsight] เช็คคลัง dedup ล้ม (ถอดสดตามปกติ):', e.message?.slice(0, 50)); }
    }

    console.log(`[ClipInsight] ${type}: ${url.slice(0, 80)}`);

    // ★ 22 มิ.ย.: ผ่าน "คิวงานหนัก" — กันยิง Gemini/Whisper ซ้อนกัน + เว้นช่วงอัตโนมัติเมื่อ API แน่น
    const startedAt = Date.now();
    const ctx = {}; // ★ 23 ก.ค.: buildInsight เก็บ buffer/URL ที่ใช้จริงไว้ที่นี่ → รอบเนื้อดิบมีมิติหยิบไปใช้ซ้ำ
    let insight;
    let attempts = 1;
    try {
      insight = await getClipVideoQueue().run(() => buildInsight({ url, type }, ctx), { label: `insight:${type}` });
    } catch (e) {
      const code = e.code || 'INSIGHT_FAILED';
      return NextResponse.json({ success: false, error: humanizeErr(e.message), errorType: code }, { status: 422 });
    }

    // ★ 8 ก.ค.: ด่านตรวจคุณภาพ — ไม่ผ่าน → ถอดใหม่อัตโนมัติ 1 ครั้ง (เฉพาะเมื่อรอบแรกเร็วพอ ไม่ชน timeout)
    //   ยังไม่ผ่านอีก → เก็บพร้อมธง lowQuality ให้เห็นชัดในคลัง (ไม่ทิ้งเงียบ ไม่ปนกับเคสดี)
    let lowQuality = false, qualityNote = '';
    let issues = insightQualityIssues(insight);
    if (issues.length && Date.now() - startedAt < 5 * 60 * 1000) {
      console.warn(`[ClipInsight] ⚠️ ไม่ผ่านด่านคุณภาพ (${issues.join(' · ')}) → ถอดใหม่อัตโนมัติ 1 ครั้ง`);
      attempts = 2;
      try {
        const retryInsight = await getClipVideoQueue().run(() => buildInsight({ url, type }, ctx.sourceMeta ? { sourceMeta: ctx.sourceMeta } : null), { label: `insight-qc-retry:${type}` });
        const retryIssues = insightQualityIssues(retryInsight);
        if (retryIssues.length < issues.length || String(retryInsight?.rawData || '').length > String(insight?.rawData || '').length) {
          insight = retryInsight; issues = retryIssues; // เอารอบที่ดีกว่า
        }
      } catch (e) { console.warn('[ClipInsight] ถอดซ้ำรอบ QC ล้ม (ใช้ผลรอบแรก):', e.message?.slice(0, 50)); }
    }
    if (issues.length) {
      lowQuality = true;
      qualityNote = `ผลอาจไม่สมบูรณ์: ${issues.join(' · ')} — แนะนำกดถอดใหม่`;
      console.warn(`[ClipInsight] ⚠️ เก็บแบบติดธง lowQuality: ${qualityNote}`);
    }

    // ★ 24 ก.ค. แก้บัค (auditor C1) — เซฟ insight ลงคลัง "ก่อน" ยิงรอบ enriched:
    //   ต่อให้ route โดน Vercel ฆ่ากลางรอบ enriched (หรือ maxDuration จริง < 800s) insight ก็อยู่ในคลังแล้ว
    //   → dedup คืนได้ทันทีเมื่อกด/รีเฟรช · ไม่ต้องพึ่งว่าแพลตฟอร์มตัดที่กี่วินาที (แข็งกว่าเดาเวลา)
    // ★ 4 ส.ค. (ประตู CLIP_SOURCE_META): ติด metadata ต้นทางเข้า insight "ก่อน" เซฟรอบแรก → เก็บลงคลังฟรี ไม่เพิ่มการเขียน
    //   ประตูปิด = ctx.sourceMeta ไม่มี → insight เท่าเดิมทุกฟิลด์
    if (ctx.sourceMeta) insight = { ...insight, sourceMeta: ctx.sourceMeta };
    const qualityFlags = []; // ★ 4 ส.ค. (ประตู CLIP_QC_GATES): รวบธงคุณภาพทุกใบ แล้วเขียนคลังครั้งเดียวตอนท้าย
    const caseId = randomUUID();
    const store = createStore('clip-insights');
    const baseRecord = {
      id: caseId, url, platform: type,
      title: (insight.headline || insight.overview || url).slice(0, 80),
      insight,
      category: insight.category || '', clipDurationSec: insight.clipDurationSec || 0,
      user: String(user || '').slice(0, 40), elapsedMs: Date.now() - startedAt, attempts,
      ...(lowQuality ? { lowQuality: true, qualityNote } : {}),
      // ★ 31 ก.ค. 69 (ผู้ตรวจไขว้เสนอแทน kill-switch): ป้ายรุ่นพร้อมท์ — ตรวจย้อนได้ว่าเคสไหนถอดด้วยกติกาชุดไหน
      //   'sub-selfcontained-0801' = ยุคกระชับ+ประเด็นย่อยครบในตัวเอง (แก้สมอ "เท่า rawData รวม" 1 ส.ค. 69)
      //   'raw-natural-0801r4' = + กฎภาษาเนื้อดิบรอบหลัก (r2 กฎตามตำแหน่ง: ประโยคแรก=เหตุการณ์ ประโยคท้าย=ข้อเท็จจริง
      //    + ตัดคำอวยของเสียงบรรยาย/ผู้ตัดต่อ — r1 แบบยกตัวอย่างห้าม โมเดลเลี่ยงคำได้ · r3-r4 เรียกคนด้วยชื่อล้วน
      //    ห้ามป้ายตัวตน/"ชื่อดัง" ต่อท้ายชื่อเด็ดขาด (เจ้าของทัก 1 ส.ค. — ยุคนิ่งติดป้าย 10% ยุคนี้พุ่ง 30%) · 1 ส.ค. 69)
      //    r5 ถอนบรรทัดเกราะ verbatim เสริม (เจ้าของสั่ง 1 ส.ค. "ปลายมิถุนาไม่มี เอาออก" — ข้อยกเว้นข้อคิดคนพูดเองยังคุ้มครองอยู่)
      //   'raw-depth2legs-0801' = + พื้น-เพดาน 2 ขา (เจ้าของเคาะหลังวินิจฉัย "ถอดผิวเผิน" 1 ส.ค. ค่ำ):
      //    พื้น=ครบเชิงเนื้อหาทุกช่วงคลิป (ไม่ใช่โควตาตัวอักษรแบบ 8 ก.ค.) · เพดาน=กฎภาษาเนื้อดิบเดิม (กันน้ำ/คำอวย)
      //   ★ 4 ส.ค. 69 (ประตู CLIP_PROMPT_0804): เปิด = ต่อท้าย '-m0804' · ปิด = ค่าเดิมเป๊ะ (เทสปักหมุดยึดค่านี้อยู่)
      //    ผู้ตรวจไขว้ (#6): ใช้ฟังก์ชันจาก service เป็นความจริงแหล่งเดียว — ห้าม hardcode ซ้ำตรงนี้
      promptRev: currentInsightPromptRev(),
      createdAt: new Date().toISOString(),
    };
    try { await store.add(baseRecord); } catch (e) { console.warn('[ClipInsight] เซฟคลัง (ก่อน enriched) ล้ม:', e.message?.slice(0, 50)); }

    // ★ 23 ก.ค. (ผู้ใช้สั่ง) — รอบ 2 "เนื้อดิบมีมิติ": Gemini ถอดคำพูดจริง (ไม่เอาเพลง) → ถักทอเข้าประเด็น (enrichedRaw)
    //   🔴 อิสระจาก insight เดิม 100%: ล้ม/แน่น/หมดเวลา = ข้าม (insight เซฟไปแล้วข้างบน = ปลอดภัย) · ใช้ buffer/URL ซ้ำจาก ctx
    //   budget-aware (auditor #1) + clearTimeout (auditor C2) + ข้าม buffer >200MB (auditor #4)
    const enrichedEnabled = process.env.CLIP_INSIGHT_ENRICHED === '1'; // default ปิด — เปิดรอบ 2 เฉพาะเมื่อเจ้าของตั้ง =1
    const ENRICH_MAXDUR_MS = 800_000;   // = maxDuration ของ route (เผื่อกรณี Vercel ตัดสั้นกว่า → มี C1 save-first กันไว้แล้ว)
    const ENRICH_SAVE_MARGIN_MS = 90_000;
    const enrichBudgetMs = ENRICH_MAXDUR_MS - (Date.now() - startedAt) - ENRICH_SAVE_MARGIN_MS;
    const bufTooBig = ctx.mode === 'buffer' && ctx.buffer && ctx.buffer.length > 200 * 1e6;
    if (enrichedEnabled && ctx.mode && !bufTooBig && enrichBudgetMs > 60_000) {
      let enrichTimer;
      try {
        const { extractTranscriptQuotes, extractTranscriptQuotesFromVideoBuffer, buildIdentityFromInsight } = await import('@/lib/services/clipInsightService');
        // ★ 24 ก.ค. (ผู้ใช้สั่ง): ส่ง "โครงประเด็น" จากรอบแรก (subStories/topics) ให้รอบ 2 แยกประเด็นตรงกัน
        //   ส่งเฉพาะหัวข้อ+ช่วงเวลา (โครงสร้าง) ไม่ส่งเนื้อความ — กันสำนวนรอบแรกไหลมาปน
        const topicHints = (insight?.subStories?.length ? insight.subStories : (insight?.topics || []))
          .map(t => ({
            topic: t?.topic || t?.title || '',
            timeRange: t?.timeRange || (t?.timeStart ? `${t.timeStart}–${t.timeEnd || ''}` : ''),
          }))
          .filter(t => t.topic);
        // ★ 27 ก.ค. (เจ้าของอนุมัติ wire): บัญชีชื่อ+ข้อเท็จจริงแกนที่รอบแรกยืนยันแล้ว → กันรอบ 2 เรียกคนกลางๆ ทั้งที่รู้ชื่อแล้ว
        //   ctx ปัจจุบันไม่มี caption/title จริง (ดูแล้ว — buildInsight ไม่เคยเซ็ต ctx.caption) → ส่ง null ไปก่อน ไม่ฝืนมั่ว
        const identity = buildIdentityFromInsight(insight, ctx.caption || null);
        const tq = await Promise.race([
          getClipVideoQueue().run(
            () => (ctx.mode === 'buffer'
              ? extractTranscriptQuotesFromVideoBuffer(ctx.buffer, ctx.mimeType, topicHints, identity)
              : extractTranscriptQuotes({ url: ctx.url, topicHints, identity })),
            { label: `enrich:${type}` }
          ),
          new Promise((_, rej) => { enrichTimer = setTimeout(() => rej(new Error(`enriched budget timeout ${Math.round(enrichBudgetMs / 1000)}s`)), enrichBudgetMs); }),
        ]);
        if (tq && (String(tq.enrichedRaw || '').trim() || String(tq.transcript || '').trim() || tq.punchyQuotes?.length || tq.enrichedTopics?.length)) {
          insight = { ...insight, transcriptQuotes: tq };
          // อัปเดต record ในคลังให้มี enriched (fire-and-forget — ถ้าล้ม insight ฐานที่เซฟไว้ก่อนก็ยังอยู่)
          store.update(caseId, (r) => ({ ...r, insight, title: (insight.headline || insight.overview || url).slice(0, 80) })).catch(() => {});
          console.log(`[ClipInsight] ✅ เนื้อดิบมีมิติ: enrichedRaw ${tq.enrichedRaw?.length || 0} ตัวอักษร · แยกประเด็น ${tq.enrichedTopics?.length || 0} · ประโยคเด็ด ${tq.punchyQuotes?.length || 0} · เพลง=${tq.hasSong ? 'มี' : 'ไม่มี'}`);
        }
      } catch (e) {
        console.warn('[ClipInsight] รอบเนื้อดิบมีมิติล้ม/หมดเวลา (ข้าม ใช้ผลเดิม):', e.message?.slice(0, 70));
      } finally { clearTimeout(enrichTimer); } // ★ C2: เคลียร์ timer กันค้าง (ทั้งกรณีสำเร็จและล้ม)
    } else if (enrichedEnabled && bufTooBig) {
      console.log(`[ClipInsight] ⏭️ ข้ามเนื้อดิบมีมิติ: คลิปใหญ่ ${Math.round(ctx.buffer.length / 1e6)}MB (กันแรมพุ่ง) — insight เดิมทำงานปกติ`);
    }

    // ★ 3 ส.ค. 69 (เจ้าของสั่ง) — รอบ "เนื้อดิบ v2": ดูคลิปอีกรอบ → เล่าเป็นเนื้อความธรรมชาติ คำพูดกลืนในเนื้อ
    //   🔴 สายใหม่แยก 100%: ไม่แตะ insight เดิม ไม่แตะรอบ enriched เดิม · ล้ม/แน่น/หมดเวลา = ข้ามเงียบ (ของเดิมเซฟไปแล้ว)
    //   ใช้ buffer/URL ซ้ำจาก ctx (ไม่โหลดคลิปใหม่) · เปิดด้วย env CLIP_RAWSTORY_V2=1
    const rawStoryV2Enabled = process.env.CLIP_RAWSTORY_V2 === '1' && !skipRawStoryV2;
    const v2BudgetMs = ENRICH_MAXDUR_MS - (Date.now() - startedAt) - ENRICH_SAVE_MARGIN_MS;
    // ★ ผู้ตรวจไขว้ W1: รอบ v2 = อัปคลิปขึ้น Gemini ใหม่ทั้งก้อน + ดูใหม่ทั้งคลิป (กินหลายนาที)
    //   งบเหลือน้อยกว่านี้ = ยิงไปก็ถูกตัดกลางทาง จ่ายเงินฟรีและยึดสล็อตคิว → ข้ามไปเลยดีกว่า
    const V2_MIN_BUDGET_MS = 300_000;
    // ★ 4 ส.ค. 69: แยก "หนึ่งรอบ v2" ออกเป็นฟังก์ชัน เพื่อยิงซ้ำได้โดยไม่ก๊อปโค้ด และไม่แตะหลักการเดิม
    //   หลักการเดิมที่ยังอยู่ครบทุกข้อ: save-first (บล็อกนี้อยู่หลัง store.add) · งบขั้นต่ำ 300s · Promise.race + clearTimeout · ข้าม buffer >200MB
    //   งบเวลาคิดใหม่ทุกครั้งที่ยิง (รอบสองเหลือน้อยลงเสมอ) — ประตูปิด = ยิงรอบเดียวเหมือนเดิมเป๊ะ
    const runRawStoryV2 = async (extraOpts = null) => {
      let v2Timer;
      const budgetMs = ENRICH_MAXDUR_MS - (Date.now() - startedAt) - ENRICH_SAVE_MARGIN_MS;
      try {
        const { extractRawStoryV2, extractRawStoryV2FromVideoBuffer } = await import('@/lib/services/clipRawStoryService');
        const { buildIdentityFromInsight } = await import('@/lib/services/clipInsightService');
        // โครงประเด็นจากรอบแรก (หัวข้อ+ช่วงเวลาเท่านั้น ไม่ส่งเนื้อความ — กันสำนวนรอบแรกไหลปน) + บัญชีชื่อที่ยืนยันแล้ว
        const v2Hints = (insight?.subStories?.length ? insight.subStories : (insight?.topics || []))
          .map(t => ({
            topic: t?.topic || t?.title || '',
            timeRange: t?.timeRange || (t?.timeStart ? `${t.timeStart}–${t.timeEnd || ''}` : ''),
          }))
          .filter(t => t.topic);
        const v2Identity = buildIdentityFromInsight(insight, ctx.caption || null);
        // ★ 4 ส.ค.: ตัวเลือกเสริม — sourceMeta (ประตู CLIP_SOURCE_META) + emphasizeQuotes (ประตู CLIP_QC_GATES รอบยิงซ้ำ)
        //   ไม่มีตัวเลือกเลย = ส่ง undefined/ไม่มีคีย์ → รูปแบบการเรียกเท่าเดิมทุกตัวอักษร
        const v2Opts = { ...(ctx.sourceMeta ? { sourceMeta: ctx.sourceMeta } : {}), ...(extraOpts || {}) };
        const hasOpts = Object.keys(v2Opts).length > 0;
        return await Promise.race([
          getClipVideoQueue().run(
            () => (ctx.mode === 'buffer'
              ? extractRawStoryV2FromVideoBuffer(ctx.buffer, ctx.mimeType, v2Hints, v2Identity, hasOpts ? v2Opts : undefined)
              : extractRawStoryV2({ url: ctx.url, topicHints: v2Hints, identity: v2Identity, ...v2Opts })),
            { label: `rawstory-v2:${type}` }
          ),
          new Promise((_, rej) => { v2Timer = setTimeout(() => rej(new Error(`rawStoryV2 budget timeout ${Math.round(budgetMs / 1000)}s`)), budgetMs); }),
        ]);
      } finally { clearTimeout(v2Timer); }
    };
    const v2HasContent = (rs) => !!(rs && (String(rs.rawStory || '').trim() || rs.topics?.length));
    const v2BudgetLeftMs = () => ENRICH_MAXDUR_MS - (Date.now() - startedAt) - ENRICH_SAVE_MARGIN_MS;

    if (rawStoryV2Enabled && ctx.mode && !bufTooBig && v2BudgetMs > V2_MIN_BUDGET_MS) {
      let rs = null;
      let v2Err = '';
      try {
        rs = await runRawStoryV2();
        if (!v2HasContent(rs)) {
          rs = null;
          v2Err = 'รอบ v2 คืนค่าว่าง (โมเดลไม่ส่งเนื้อกลับมา)';
          console.warn('[ClipInsight] เนื้อดิบ v2 คืนค่าว่าง (ข้าม ใช้ผลเดิม)');
        }
      } catch (e) {
        v2Err = _v2ErrText(e);
        console.warn('[ClipInsight] รอบเนื้อดิบ v2 ล้ม/หมดเวลา (ข้าม ใช้ผลเดิม):', v2Err.slice(0, 70));
      }

      // ★ B2 (ประตู CLIP_QC_GATES) — เดิม "ล้มแล้วข้ามเงียบ" ไม่มีใครรู้ว่าเคสไหนไม่มี v2 เพราะอะไร
      //   ล้มครั้งแรก → งบเวลายังพอ (>= งบขั้นต่ำเดิม) ลองใหม่อีก 1 ครั้งเท่านั้น → ยังล้ม = บันทึกสาเหตุลงเคส
      if (!rs && QC_GATES_ON()) {
        const retryBudgetMs = v2BudgetLeftMs();
        if (retryBudgetMs > V2_MIN_BUDGET_MS) {
          console.warn(`[ClipInsight] 🔄 ลองรอบเนื้อดิบ v2 ใหม่อีก 1 ครั้ง (งบเวลาเหลือ ${Math.round(retryBudgetMs / 1000)}s)`);
          try {
            rs = await runRawStoryV2();
            if (!v2HasContent(rs)) { rs = null; v2Err = 'รอบ v2 คืนค่าว่างทั้งสองครั้ง'; }
          } catch (e2) {
            v2Err = _v2ErrText(e2);
            console.warn('[ClipInsight] รอบเนื้อดิบ v2 (ลองใหม่) ล้มอีก:', v2Err.slice(0, 70));
          }
        } else {
          console.log(`[ClipInsight] ⏭️ ไม่ลองรอบ v2 ใหม่: งบเวลาเหลือ ${Math.round(retryBudgetMs / 1000)}s ไม่พอ (ต้องการ ${V2_MIN_BUDGET_MS / 1000}s)`);
        }
      }

      if (rs) {
        insight = { ...insight, rawStoryV2: rs };
        // ★ 4 ส.ค. (บั๊กจริงจากรันแรก — ผู้ตรวจ #8): ต้อง await — เขียนแบบไม่รอ 2 นัดแข่งกันแล้วนัดเก่าทับนัดใหม่
        //   (เคสจตุรงค์: ผลรอบย้ำคำพูดหายเพราะนัดแรกเขียนเสร็จทีหลัง) · .catch กันล้มเหมือนเดิม ไม่ทำเคสพัง
        await store.update(caseId, (r) => ({ ...r, insight })).catch(() => {});
        console.log(`[ClipInsight] ✅ เนื้อดิบ v2: ${rs.rawStory?.length || 0} ตัวอักษร · ประเด็นย่อย ${rs.topics?.length || 0} · rev=${rs.promptRev || '-'}`);
      } else if (QC_GATES_ON() && v2Err) {
        // เก็บสาเหตุไว้บน insight ก่อน — เขียนคลังรวบครั้งเดียวกับธงคุณภาพตอนท้าย (ประหยัด write)
        insight = { ...insight, rawStoryV2Error: v2Err.slice(0, 200) };
      }

      // ★ B3 (ประตู CLIP_QC_GATES) — v2 ได้เนื้อ แต่ไม่มีคำพูดจริงสักคำ ทั้งที่รอบแรกยืนยันว่ามีคนพูด
      //   → ยิงซ้ำอีก 1 ครั้งโดยย้ำให้ถักคำพูดจริง (emphasizeQuotes) · ยังไม่มี = ติดธงไว้ ไม่ทิ้งเงียบ
      if (rs && QC_GATES_ON()) {
        // ★ ผู้ตรวจไขว้ 4 ส.ค. (#1): ต้องส่ง note ของ v2 เข้าด่านด้วย — insight รอบแรกไม่มีฟิลด์ note
        //   คลิปที่ v2 ระบุเองว่า "ไม่มีเสียงพูด(ของคนในภาพ)" จะได้ไม่โดนยิงซ้ำพร้อมพรอมต์ที่บอกผิดๆ ว่ามีคนพูด (กันนั่งเทียน+จ่ายฟรี)
        const qp = await _safeLintQuote({ ...insight, note: rs?.note }, _v2Text(rs));
        if (qp && qp.expected && !qp.present) {
          const quoteBudgetMs = v2BudgetLeftMs();
          if (quoteBudgetMs > V2_MIN_BUDGET_MS) {
            console.warn(`[ClipInsight] 🔁 v2 ไม่มีคำพูดจริงทั้งที่คลิปมีคนพูด → ยิงซ้ำแบบย้ำคำพูด 1 ครั้ง (งบเหลือ ${Math.round(quoteBudgetMs / 1000)}s)`);
            let rs2 = null;
            try { rs2 = await runRawStoryV2({ emphasizeQuotes: true }); } catch (e3) {
              console.warn('[ClipInsight] ยิงซ้ำแบบย้ำคำพูดล้ม (ใช้ผล v2 เดิม):', _v2ErrText(e3).slice(0, 70));
            }
            const qp2 = v2HasContent(rs2) ? await _safeLintQuote({ ...insight, note: rs2?.note }, _v2Text(rs2)) : null;
            // ★ 4 ส.ค. (บทเรียนรันแรก): รอบยิงซ้ำเคยคืนของหด (349 ตัว) — จะทับของเดิมได้ต้อง "ไม่ด้อยกว่า":
            //   มีคำพูดจริง + ยาวรวม >= 60% ของเดิม + ประเด็นย่อยไม่หาย · ไม่ผ่านเกณฑ์ = เก็บของเดิม + ติดธงให้คนดู
            const _len = (x) => _v2Text(x).length;
            const rs2Acceptable = qp2?.present && _len(rs2) >= _len(rs) * 0.6 && (rs2.topics?.length || 0) >= (rs.topics?.length || 0);
            if (rs2Acceptable) {
              rs = rs2;
              insight = { ...insight, rawStoryV2: rs2 };
              // 🔴 ต้องเขียนคลังทันทีและ await — คลังคือของจริงที่สายเขียนข่าวหยิบไปใช้ (เคสยิงซ้ำผ่าน = ไม่มีธง ไม่มีการเขียนรอบท้าย)
              await store.update(caseId, (r) => ({ ...r, insight })).catch(() => {});
              console.log('[ClipInsight] ✅ รอบย้ำคำพูดได้คำพูดจริงแล้ว — ใช้ผลรอบนี้แทน');
            } else {
              if (qp2?.present) console.warn(`[ClipInsight] ⚠️ รอบย้ำคำพูดมีคำพูดแต่เนื้อด้อยกว่าเดิม (${_len(rs2)}/${_len(rs)} ตัว) — เก็บของเดิม+ติดธง`);
              qualityFlags.push({ area: 'v2', type: 'quote_missing' });
            }
          } else {
            console.log(`[ClipInsight] ⏭️ ไม่ยิงซ้ำแบบย้ำคำพูด: งบเวลาเหลือ ${Math.round(quoteBudgetMs / 1000)}s ไม่พอ`);
            qualityFlags.push({ area: 'v2', type: 'quote_missing' });
          }
        }
      }
    } else if (rawStoryV2Enabled && bufTooBig) {
      console.log(`[ClipInsight] ⏭️ ข้ามเนื้อดิบ v2: คลิปใหญ่ ${Math.round(ctx.buffer.length / 1e6)}MB (กันแรมพุ่ง)`);
    } else if (rawStoryV2Enabled && ctx.mode && v2BudgetMs <= V2_MIN_BUDGET_MS) {
      console.log(`[ClipInsight] ⏭️ ข้ามเนื้อดิบ v2: งบเวลาเหลือ ${Math.round(v2BudgetMs / 1000)}s ไม่พอดูคลิปรอบสอง (ต้องการ ${V2_MIN_BUDGET_MS / 1000}s)`);
    }

    // ★ B4 4 ส.ค. 69 (ประตู CLIP_QC_GATES) — ด่านตรวจ "กลไก" ล้วน: ไม่เรียก AI ไม่ยิงเน็ต ไม่แก้เนื้อ
    //   หน้าที่เดียวคือ "ติดธงให้เห็น" ว่าเนื้อที่ได้มีอาการต้องห้าม (ชวนติดตาม/สรุปสอนใจ/ป้ายตัวตน/เล่ากระบวนการ)
    //   หรือคลิปยาวแต่ประเด็นย่อยไม่ครอบคลุมทั้งคลิป — คนตรวจงานเห็นแล้วตัดสินใจเองว่าจะถอดใหม่ไหม
    if (QC_GATES_ON()) {
      try {
        const { lintLanguage, lintTopicCoverage } = await import('@/lib/services/clipQualityLint');
        for (const f of (lintLanguage(String(insight?.rawData || '')) || [])) qualityFlags.push({ area: 'rawData', ...f });
        const v2 = insight?.rawStoryV2;
        if (v2) {
          for (const f of (lintLanguage(_v2Text(v2)) || [])) qualityFlags.push({ area: 'v2', ...f });
          // คลิปยาว (>=10 นาที) เท่านั้น — คลิปสั้นประเด็นเดียวไม่ต้องคุมความครอบคลุม · ไม่รู้ความยาว (0) = ข้าม ไม่ยิง yt-dlp เพิ่ม
          const durSec = Number(insight?.clipDurationSec || 0);
          if (durSec >= 600 && v2.topics?.length) {
            const cov = lintTopicCoverage(v2.topics, durSec);
            if (cov && cov.ok === false) {
              qualityFlags.push({ area: 'v2', type: 'topics_gap' });
              console.warn(`[ClipInsight] 🚩 ประเด็นย่อยไม่ครอบคลุมทั้งคลิป: ครอบ ${Math.round((cov.coveredRatio || 0) * 100)}% · ช่องโหว่ ${cov.gaps?.length || 0} ช่วง`);
            }
          }
        }
      } catch (e) {
        console.warn('[ClipInsight] ด่านตรวจคุณภาพล้ม (ข้าม ไม่กระทบผลงาน):', String(e?.message || e).slice(0, 70));
      }
      // เขียนคลังครั้งเดียวรวบทุกธง + สาเหตุที่ v2 ไม่สำเร็จ (ประหยัด write · fire-and-forget เหมือนจุดอื่นในไฟล์นี้)
      if (qualityFlags.length || insight?.rawStoryV2Error) {
        if (qualityFlags.length) insight = { ...insight, qualityFlags: qualityFlags.slice(0, 40) };
        await store.update(caseId, (r) => ({ ...r, insight })).catch(() => {}); // await กันแข่งกับนัดก่อนหน้า (ผู้ตรวจ #8)
        if (qualityFlags.length) {
          console.warn(`[ClipInsight] 🚩 ธงคุณภาพ ${qualityFlags.length} ใบ: ${qualityFlags.slice(0, 8).map(f => `${f.area}/${f.type}`).join(' · ')}`);
        }
      }
    }

    // retention + สำเนาถาวร (fire-and-forget) — ★ 8 ก.ค.: retention 400 เคส + NDJSON ถาวร (ใช้ insight สุดท้ายที่มี enriched)
    (async () => {
      try {
        const all = await store.getAll();
        if (all.length > 400) {
          const old = all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, all.length - 400);
          for (const o of old) await store.remove(o.id).catch(() => {});
        }
      } catch (e) { console.warn('[ClipInsight] retention ล้ม:', e.message?.slice(0, 50)); }
      try {
        const { appendFile } = await import('fs/promises');
        const { join } = await import('path');
        await appendFile(join(process.cwd(), 'data', 'clip-insights-archive.ndjson'), JSON.stringify({ ...baseRecord, insight }) + '\n', 'utf8');
      } catch { /* Vercel filesystem อ่านอย่างเดียว — ข้าม */ }
    })();

    return NextResponse.json({ success: true, data: { id: caseId, platform: type, ...insight, ...(lowQuality ? { lowQuality: true, qualityNote } : {}) } });
  } catch (error) {
    console.error('[ClipInsight]', error.message);
    return NextResponse.json({ success: false, error: humanizeErr(error.message), errorType: 'INSIGHT_ERROR' }, { status: 500 });
  }
}
