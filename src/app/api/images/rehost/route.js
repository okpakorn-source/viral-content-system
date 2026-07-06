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
import { listNeedingRehost, applyRehost, resetRehostFailed } from '@/lib/imageStore';

export const runtime = 'nodejs';
export const maxDuration = 600;

const BUCKET = 'acs-frames';
const MAX_BYTES = 20 * 1024 * 1024; // กันไฟล์ประหลาดใหญ่เกิน 20MB

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
        let dl;
        let quality = 'full';
        try {
          dl = await downloadOriginal(im.imageUrl, im.sourceLink || im.sourceUrl || '');
        } catch (e1) {
          // 🛟 FB/TikTok บล็อกโหลดตรง (403/ตอบ HTML) → ใช้ thumbnail (gstatic) แทน
          //   ได้ไฟล์ที่ใช้งานได้จริงแน่นอน (originUrl ยังชี้ต้นฉบับให้กดไปเอาตัวใหญ่ได้)
          const th = (im.thumbnailUrl || '').trim();
          if (!th || th === im.imageUrl || !/^https?:/.test(th)) throw e1;
          dl = await downloadOriginal(th, '');
          quality = 'thumbnail';
        }
        const url = await uploadPermanent(c, dl.buf, dl.contentType, im.id);
        // thumbnail เดิมที่เป็นลิงก์หมดอายุง่าย (FB/TikTok CDN) → ชี้มาไฟล์ถาวรด้วย
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
