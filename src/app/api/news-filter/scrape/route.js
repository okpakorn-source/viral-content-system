export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';

/**
 * Scrape สำหรับ "กรองแก่นข่าว" (news-filter) — แยกเดี่ยวจาก /api/extract (เวิร์กโฟลว์ทำข่าว 🔴 ห้ามแตะ)
 * ★ 21 มิ.ย. (ผู้ใช้: "เว็บนี้ไม่สกัดเนื้อมา"): เว็บข่าว JS หนัก/เมนูเยอะ (amarintv ฯลฯ) → fetch ธรรมดาได้แต่เมนู+พาดหัว
 *   วิธี: ใช้ Firecrawl `onlyMainContent` ดึง "เฉพาะเนื้อบทความ" (ตัดเมนู/โฆษณา/ติดตามช่อง) — ตัวเดียวกับระบบปก
 *   fallback: ถ้าไม่มีคีย์/ล่ม → fetch ธรรมดา + แกะ <article>/<p> แบบง่าย
 * Body: { url } → { success, data: { text, title } }
 */

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, '’')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ── plain fetch + แกะเนื้อบทความแบบง่าย (fallback) ──
async function plainArticle(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept-Language': 'th,en;q=0.8' },
    signal: controller.signal, redirect: 'follow',
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const title = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '').trim();
  // เอาเฉพาะ <article> ถ้ามี ไม่งั้นรวม <p> ที่ยาวพอ (กันเมนู/ลิงก์สั้น)
  const articleBlock = html.match(/<article[\s\S]*?<\/article>/i)?.[0];
  let text;
  if (articleBlock) {
    text = stripTags(articleBlock);
  } else {
    const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => stripTags(m[1])).filter(t => t.length >= 40);
    text = ps.join('\n');
  }
  return { text, title };
}

// ── Firecrawl: เรนเดอร์ JS + ดึงเฉพาะเนื้อหลัก (onlyMainContent) ──
async function firecrawlArticle(url) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, timeout: 30000 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) { console.log('[NewsFilter:scrape] Firecrawl HTTP', res.status); return null; }
    const data = await res.json();
    const md = data?.data?.markdown || data?.markdown || '';
    const title = data?.data?.metadata?.title || data?.data?.metadata?.ogTitle || '';
    // ตัด markdown noise (รูป/ลิงก์เปล่า/หัวข้อสั้น) เหลือย่อหน้าเนื้อ
    const text = String(md)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // รูป
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')      // ลิงก์ → เก็บข้อความ
      .replace(/^#{1,6}\s*/gm, '')                   // หัวข้อ #
      .replace(/[*_`>]/g, '')
      .split('\n').map(l => l.trim()).filter(l => l.length >= 20) // ตัดบรรทัดสั้น (เมนู/ปุ่ม)
      .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { text, title: String(title || '').trim() };
  } catch (e) { clearTimeout(timer); console.log('[NewsFilter:scrape] Firecrawl error:', e.message?.slice(0, 50)); return null; }
}

export async function POST(request) {
  try {
    const { url } = await request.json();
    if (!url || !/^https?:\/\//i.test(String(url))) {
      return NextResponse.json({ success: false, error: 'กรุณาวางลิงก์ข่าว (http/https)', errorType: 'MISSING_URL' }, { status: 400 });
    }

    // ① Firecrawl onlyMainContent (คุณภาพดีสุด — ตัดเมนู/โฆษณา ได้เนื้อบทความจริง)
    let out = await firecrawlArticle(url);

    // ② fallback: plain fetch ถ้า Firecrawl ไม่มีคีย์/ล่ม/ได้เนื้อบาง
    if (!out || (out.text || '').length < 120) {
      try {
        const plain = await plainArticle(url);
        if (!out || (plain.text || '').length > (out.text || '').length) out = plain;
      } catch (e) { if (!out) throw e; }
    }

    const text = (out?.text || '').trim();
    if (text.length < 60) {
      return NextResponse.json({
        success: false,
        error: 'ดึงเนื้อข่าวไม่ได้ — เว็บนี้อาจบล็อกบอท/โหลดด้วยสคริปต์หนัก ลองก๊อปเนื้อข่าววางตรงๆ แทนลิงก์',
        errorType: 'SCRAPE_THIN',
      }, { status: 422 });
    }
    return NextResponse.json({ success: true, data: { text, title: out?.title || '' } });
  } catch (error) {
    console.error('[NewsFilter:scrape]', error.message);
    return NextResponse.json({ success: false, error: error.message || 'ดึงเนื้อหาไม่สำเร็จ', errorType: 'SCRAPE_ERROR' }, { status: 500 });
  }
}
