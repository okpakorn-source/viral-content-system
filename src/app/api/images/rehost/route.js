// ============================================================
// ★ DEVIATION จากระบบทำปกออโต้ (ผู้ใช้สั่ง 6 ก.ค. 2026 — "ภาพพร้อมใช้")
// POST /api/images/rehost { action:'run', limit? }
// ------------------------------------------------------------
// ปัญหา: คลังเก็บ "ลิงก์ภาพเว็บนอก" (hotlink) — ใช้งานจริงไม่ได้ ต้องกดไป
// เซฟจากต้นทางเอง + ลิงก์ FB/TikTok หมดอายุ → ภาพหายจากคลัง
// ทางแก้: โหลด "ไฟล์ต้นฉบับคุณภาพเต็ม" (ไม่ย่อ ไม่บีบ ไม่บิดเบือน) มาเก็บ
// Supabase Storage ถาวร แล้วสลับ imageUrl เป็นไฟล์ของเรา — เก็บลิงก์เดิมไว้
// ใน originUrl + sourceLink คงเดิม (กดเข้าไปเช็ค/หาเพิ่มจากต้นทางได้)
// ผู้เรียก: acs-yt-worker บนเครื่องทีม (ตอนคิวแคปเฟรมว่าง) วนทีละก้อนเล็ก
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { listNeedingRehost, applyRehost, resetRehostFailed } from '@/lib/imageStore';

export const runtime = 'nodejs';
export const maxDuration = 600;

const BUCKET = 'acs-frames';
const MAX_BYTES = 20 * 1024 * 1024; // กันไฟล์ประหลาดใหญ่เกิน 20MB
// ★ เฟส 1 (9 ก.ค.): imageUrl ห้ามชี้ไฟล์จิ๋วโดยแอบอ้างเป็นต้นฉบับ + ตัวเลขขนาดต้องตรงไฟล์จริง
//   REHOST_PRESERVE_ORIGINAL: unset/'1' = พฤติกรรมใหม่ (1.1 คงต้นฉบับ + 1.2 วัดจริง + 1.3 retry) | '0' = เก่าเป๊ะ
const PRESERVE_ORIGINAL = process.env.REHOST_PRESERVE_ORIGINAL !== '0';
const FULL_MIN_SHORT = parseInt(process.env.REHOST_FULL_MIN_SHORT || '500', 10); // shortSide ≥ นี้ = ถือว่าต้นฉบับเต็ม
const MAX_REHOST_TRIES = parseInt(process.env.REHOST_MAX_TRIES || '3', 10); // ลองดึงต้นฉบับซ้ำสูงสุดกี่รอบ (1.3)

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key) : null;
}

// โหลดไฟล์ต้นฉบับเต็มจากเว็บ (แนบ UA + referer หลอก hotlink protection เท่าที่ทำได้)
async function downloadOriginal(url, referer) {
  const r = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      ...(referer && /^https?:/.test(referer) ? { referer } : {}),
      accept: 'image/*,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(25000),
    redirect: 'follow',
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('image/')) throw new Error('ไม่ใช่ไฟล์ภาพ: ' + ct.slice(0, 40));
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error('ไฟล์ว่าง');
  if (buf.length > MAX_BYTES) throw new Error('ไฟล์ใหญ่เกิน ' + Math.round(buf.length / 1e6) + 'MB');
  return { buf, contentType: ct.split(';')[0] };
}

// ★ เฟส 1.2: วัดขนาดจริงของไฟล์ที่โหลดได้ (ไม่เชื่อค่า SerpApi) → { width, height, shortSide }
async function measure(buf) {
  try {
    const m = await sharp(buf).metadata();
    const w = m.width || 0, h = m.height || 0;
    return { width: w || null, height: h || null, shortSide: w && h ? Math.min(w, h) : 0 };
  } catch {
    return { width: null, height: null, shortSide: 0 }; // อ่าน metadata ไม่ได้ = ไม่รู้ขนาดจริง (อย่าเดา)
  }
}

// ★ เฟส 1.4: ดึงหน้า sourceLink แล้วแกะ og:image / twitter:image (ภาพเต็มของข่าว) → โหลด URL นั้น
async function fetchOgImage(pageUrl) {
  if (!pageUrl || !/^https?:/.test(pageUrl)) return null;
  const r = await fetch(pageUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  if (!r.ok) return null;
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('html')) return null;
  const html = (await r.text()).slice(0, 200000); // อ่านแค่ช่วงหัว (og อยู่ใน <head>)
  const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };
  const og =
    pick(/<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (!og || !/^https?:/.test(og)) return null;
  return downloadOriginal(og, pageUrl);
}

// ★ เฟส 1.3+1.4: ladder โหลด "ต้นฉบับ" — (a) ตรง (b) +Referer/UA (c) og:image จาก sourceLink
//   google_news ลอง og ก่อน (thumbnail เว็บข่าวเล็กแต่กำเนิด) · คืน candidate ต้นฉบับที่ใหญ่สุดที่โหลดได้ (หรือ null)
async function tryFullOriginal(im) {
  const src = (im.imageUrl || '').trim();
  const ref = (im.sourceLink || im.sourceUrl || '').trim();
  const ogFirst = im.platform === 'google_news';
  const steps = [];
  if (ogFirst && ref) steps.push(() => fetchOgImage(ref));
  if (/^https?:/.test(src)) steps.push(() => downloadOriginal(src, ''));       // (a) ตรง
  if (/^https?:/.test(src) && ref) steps.push(() => downloadOriginal(src, ref)); // (b) +Referer
  if (!ogFirst && ref) steps.push(() => fetchOgImage(ref));                     // (c) og:image
  let best = null;
  for (const step of steps) {
    let dl;
    try { dl = await step(); } catch { continue; }
    if (!dl || !dl.buf) continue;
    const dim = await measure(dl.buf);
    const cand = { ...dl, ...dim };
    if (!best || cand.shortSide > best.shortSide) best = cand;
    if (cand.shortSide >= FULL_MIN_SHORT) return best; // ถึงเกณฑ์เต็มแล้ว หยุดเลย
  }
  return best; // อาจเป็นต้นฉบับตัวเล็ก (<500) แต่ยังเป็น "ของจริง" ไม่ใช่ gstatic — เก็บได้ (lowRes recompute ทีหลัง)
}

// ★ เฟส 1.6 (minimal): เฟรม local (/case-frames/..) — worker เครื่องทีมอ่านไฟล์ตรงจากดิสก์ (fetch พาธ local ไม่ได้)
async function loadLocalFrame(src) {
  const rel = src.replace(/^\//, '');
  const fp = path.join(process.cwd(), 'public', rel);
  const buf = await fs.readFile(fp); // ไม่มีไฟล์ = โยน → เข้าทาง fail ปกติ (จะถูก mark rehostFailed)
  if (!buf.length) throw new Error('ไฟล์ว่าง');
  const ext = (rel.split('.').pop() || 'jpg').toLowerCase();
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  return { buf, contentType };
}

async function uploadPermanent(c, buf, contentType, imageId) {
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : contentType.includes('gif') ? 'gif' : 'jpg';
  const p = `orig_${imageId}_${Date.now().toString(36)}.${ext}`;
  let { error } = await c.storage.from(BUCKET).upload(p, buf, { contentType });
  if (error && /bucket|not found/i.test(error.message)) {
    await c.storage.createBucket(BUCKET, { public: true }).catch(() => {});
    ({ error } = await c.storage.from(BUCKET).upload(p, buf, { contentType }));
  }
  if (error) throw new Error('อัป Storage ไม่สำเร็จ: ' + error.message);
  return c.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'run';
    if (action === 'reset-failed') {
      // ล้างธง "เซฟไม่ได้" ให้กลับเข้าคิวลองใหม่ (ใช้หลังปรับปรุงวิธีโหลด)
      const n = await resetRehostFailed(parseInt(body.limit, 10) || 200);
      return NextResponse.json({ success: true, reset: n });
    }
    if (action !== 'run') {
      return NextResponse.json({ success: false, error: 'action ไม่รู้จัก', errorType: 'BAD_INPUT' }, { status: 400 });
    }
    const c = sb();
    if (!c) {
      return NextResponse.json({ success: false, error: 'ไม่มี Supabase env', errorType: 'NO_SUPABASE' }, { status: 400 });
    }

    const limit = Math.min(20, Math.max(1, parseInt(body.limit, 10) || 8));
    const items = await listNeedingRehost(limit);

    let hosted = 0;
    let failed = 0;
    const results = [];
    for (const im of items) {
      try {
        const isLocalFrame = (im.imageUrl || '').startsWith('/'); // 1.6: เฟรม local
        // ★ 9 ก.ค. (คิว C): record เก่าก่อนเฟส 1 ที่ "ถูกสลับแล้ว" — imageUrl ชี้สำเนา thumbnail บน supabase
        //   ต้นฉบับจริงอยู่ใน originUrl → ladder ต้องดึงจาก originUrl (ห้ามใช้ imageUrl ที่เป็นสำเนาจิ๋ว)
        const isLegacySwap = PRESERVE_ORIGINAL && !isLocalFrame
          && /supabase\.co/.test(im.imageUrl || '')
          && im.rehostQuality === 'thumbnail'
          && /^https?:/.test((im.originUrl || '').trim());

        // ===== พฤติกรรมเก่าเป๊ะ (kill-switch REHOST_PRESERVE_ORIGINAL=0) =====
        if (!PRESERVE_ORIGINAL && !isLocalFrame) {
          let dl;
          let quality = 'full';
          try {
            dl = await downloadOriginal(im.imageUrl, im.sourceLink || im.sourceUrl || '');
          } catch (e1) {
            // 🛟 FB/TikTok บล็อกโหลดตรง (403/ตอบ HTML) → ใช้ thumbnail (gstatic) แทน
            const th = (im.thumbnailUrl || '').trim();
            if (!th || th === im.imageUrl || !/^https?:/.test(th)) throw e1;
            dl = await downloadOriginal(th, '');
            quality = 'thumbnail';
          }
          const url = await uploadPermanent(c, dl.buf, dl.contentType, im.id);
          const thumbBad = !im.thumbnailUrl || im.thumbnailUrl === im.imageUrl || /fbsbx|lookaside|tiktokcdn|tiktok\.com\/api/.test(im.thumbnailUrl || '');
          await applyRehost(im.id, {
            imageUrl: url,
            ...(thumbBad ? { thumbnailUrl: url } : {}),
            originUrl: im.imageUrl,
            rehostedAt: new Date().toISOString(),
            rehostQuality: quality,
            bytes: dl.buf.length,
          });
          hosted++;
          results.push({ id: im.id, ok: true, q: quality, kb: Math.round(dl.buf.length / 1024) });
          continue;
        }

        // ===== พฤติกรรมใหม่ (1.1–1.6) =====
        if (isLocalFrame) {
          // 1.6: เฟรม local คือ "ต้นฉบับ" อยู่แล้ว — อ่านจากดิสก์ → อัปขึ้น Supabase → วัดจริง
          const dl = await loadLocalFrame(im.imageUrl);
          const dim = await measure(dl.buf);
          const url = await uploadPermanent(c, dl.buf, dl.contentType, im.id);
          await applyRehost(im.id, {
            imageUrl: url,
            thumbnailUrl: url,
            originUrl: im.imageUrl,
            rehostedAt: new Date().toISOString(),
            rehostQuality: 'full',
            bytes: dl.buf.length,
            realBytes: dl.buf.length,
            realWidth: dim.width,
            realHeight: dim.height,
            ...(dim.width ? { width: dim.width, height: dim.height } : {}),
            lowRes: dim.shortSide > 0 ? dim.shortSide < FULL_MIN_SHORT : undefined,
          });
          hosted++;
          results.push({ id: im.id, ok: true, q: 'full', kb: Math.round(dl.buf.length / 1024), px: dim.shortSide || null });
          continue;
        }

        // 1.3+1.4: ladder ดึง "ต้นฉบับ" (direct → +Referer/UA → og:image; google_news ลอง og ก่อน)
        //   คิว (C): ต้นฉบับ = originUrl (imageUrl เป็นสำเนา thumbnail ไปแล้ว)
        const full = await tryFullOriginal(isLegacySwap ? { ...im, imageUrl: (im.originUrl || '').trim() } : im);
        if (full && full.buf) {
          // 1.2: ต้นฉบับโหลดได้จริง → imageUrl ชี้ไฟล์ถาวร + เขียน width/height = ค่าที่วัดจริง
          const url = await uploadPermanent(c, full.buf, full.contentType, im.id);
          const thumbBad = !im.thumbnailUrl || im.thumbnailUrl === im.imageUrl || /fbsbx|lookaside|tiktokcdn|tiktok\.com\/api/.test(im.thumbnailUrl || '');
          await applyRehost(im.id, {
            imageUrl: url,
            ...(thumbBad ? { thumbnailUrl: url } : {}),
            // (C): originUrl คงของเดิม (ต้นฉบับ) — ห้ามเขียนทับด้วยสำเนา thumbnail
            originUrl: isLegacySwap ? im.originUrl : im.imageUrl,
            // (C): เก็บสำเนา thumbnail เดิม (ไฟล์ถาวร) ไว้ใน rehostThumbUrl ถ้ายังไม่มี
            ...(isLegacySwap && !im.rehostThumbUrl ? { rehostThumbUrl: im.imageUrl } : {}),
            rehostedAt: new Date().toISOString(),
            rehostQuality: 'full',
            bytes: full.buf.length,
            realBytes: full.buf.length,
            realWidth: full.width,
            realHeight: full.height,
            ...(full.width ? { width: full.width, height: full.height } : {}),
            lowRes: full.shortSide > 0 ? full.shortSide < FULL_MIN_SHORT : undefined,
          });
          hosted++;
          results.push({ id: im.id, ok: true, q: 'full', kb: Math.round(full.buf.length / 1024), px: full.shortSide || null, ...(isLegacySwap ? { recovered: true } : {}) });
          continue;
        }

        // (C) กู้ไม่สำเร็จรอบนี้ → นับรอบ retry อย่างเดียว (สำเนา thumbnail เดิมยังโชว์ UI ได้ตามปกติ)
        //     ห้ามตกลงไปสาขา 1.1 ข้างล่าง — จะไปอัป thumbnail ซ้ำ/เขียน originUrl ทับด้วยสำเนา
        if (isLegacySwap) {
          const triesL = (Number(im.rehostTries) || 0) + 1;
          const maxedL = triesL >= MAX_REHOST_TRIES;
          await applyRehost(im.id, {
            rehostTries: triesL,
            // 1.2: width/height ของใบที่ถูกสลับ = ค่า SerpApi อ้าง (ไฟล์จริงคือ thumb) → ย้ายไป serpWidth/serpHeight ครั้งแรก
            ...(im.serpWidth == null && im.width != null ? { serpWidth: im.width, width: null } : {}),
            ...(im.serpHeight == null && im.height != null ? { serpHeight: im.height, height: null } : {}),
            ...(maxedL ? { rehostFailed: 'thumbnail-max-retries' } : {}),
          });
          failed++;
          results.push({ id: im.id, ok: false, legacy: true, tries: triesL, maxed: maxedL, error: 'ต้นฉบับ (originUrl) ยังโหลดไม่ได้' });
          continue;
        }

        // 1.1: ต้นฉบับโหลดไม่ได้ → เก็บ thumbnail ไว้ field แยก (rehostThumbUrl) + ชี้ thumbnailUrl มาไฟล์ปลอดภัย
        //      แต่ imageUrl "คงค่า URL ต้นฉบับเดิม" (ห้ามแอบสลับเป็นไฟล์จิ๋ว)
        const tries = (Number(im.rehostTries) || 0) + 1; // 1.3: นับรอบ retry ต้นฉบับ
        const maxed = tries >= MAX_REHOST_TRIES; // ครบเพดาน → ปิดคิว (ตั้ง rehostFailed ให้ query เดิม exclude)
        // รอบ retry ที่เคยเซฟ thumbnail ถาวรไว้แล้ว → ใช้ซ้ำ (ไม่ต้องโหลด/อัปใหม่ ประหยัด)
        let thumbUrl = (im.rehostThumbUrl || '').trim();
        let thumbPatch = {};
        if (!thumbUrl) {
          const th = (im.thumbnailUrl || '').trim();
          if (!th || th === im.imageUrl || !/^https?:/.test(th)) throw new Error('ต้นฉบับโหลดไม่ได้ และไม่มี thumbnail สำรอง');
          const dlT = await downloadOriginal(th, '');
          const dimT = await measure(dlT.buf);
          thumbUrl = await uploadPermanent(c, dlT.buf, dlT.contentType, im.id);
          thumbPatch = {
            rehostThumbUrl: thumbUrl,
            thumbnailUrl: thumbUrl, // ปลอดภัยสำหรับโชว์ UI (ไฟล์ถาวร ไม่หมดอายุ)
            thumbWidth: dimT.width,
            thumbHeight: dimT.height,
            bytes: dlT.buf.length,
          };
        }
        await applyRehost(im.id, {
          // imageUrl: คงเดิม (ต้นฉบับ) — ไม่แตะ
          ...thumbPatch,
          originUrl: im.imageUrl,
          rehostedAt: new Date().toISOString(),
          rehostQuality: 'thumbnail',
          // 1.2: ต้นฉบับจริงไม่รู้ขนาด → width/height = null (บอกตรงๆ), ย้ายค่า SerpApi ไป serpWidth/serpHeight
          ...(im.width != null ? { serpWidth: im.width } : {}),
          ...(im.height != null ? { serpHeight: im.height } : {}),
          width: null,
          height: null,
          rehostTries: tries,
          ...(maxed ? { rehostFailed: 'thumbnail-max-retries' } : {}),
        });
        hosted++;
        results.push({ id: im.id, ok: true, q: 'thumbnail', tries, maxed });
      } catch (e) {
        failed++;
        await applyRehost(im.id, { rehostFailed: e.message.slice(0, 120) }).catch(() => {});
        results.push({ id: im.id, ok: false, error: e.message.slice(0, 80) });
      }
    }

    return NextResponse.json({ success: true, checked: items.length, hosted, failed, results });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
