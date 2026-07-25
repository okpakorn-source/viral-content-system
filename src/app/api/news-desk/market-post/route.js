/**
 * News Desk — คลังโพสต์แรงตลาด (ตา engagement ของระบบ แบบถูกกฎ)
 * แนวคิด: ทีม 10 คนเลื่อนฟีดทั้งวันคือ sensor ที่ดีที่สุด — เห็นโพสต์แรงที่ไหน วางลิงก์เข้าระบบ
 * POST { url, note?, user? } → ดึงเนื้อ (FB/IG/TikTok/เว็บ) → gpt-4o-mini ถอด pattern ความแรง
 *                            → เก็บเข้า store 'market-hot-posts' (Chief Agent + few-shot ใช้ต่อ)
 * GET → รายการล่าสุด
 */
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { callAI } from '@/lib/ai/openai';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function pullContent(url) {
  // วิดีโอ Meta/TikTok → ใช้ตัวถอดที่มี | อื่นๆ → scrape
  try {
    if (/facebook\.com\/(reel|watch|share\/[rv]\/|video)|fb\.watch|instagram\.com\/(reel|reels|tv)/i.test(url)) {
      const { transcribeMetaReel } = await import('@/lib/services/metaReelsService');
      const r = await transcribeMetaReel({ url });
      if (r.success) return { text: r.text, kind: 'คลิป Meta' };
      return { text: '', kind: 'คลิป Meta (ดึงไม่ได้: ' + r.error?.slice(0, 60) + ')' };
    }
    if (/tiktok\.com/i.test(url)) {
      const { transcribeTiktok } = await import('@/lib/services/tiktokService');
      const r = await transcribeTiktok({ url });
      return { text: r.success ? (r.text || '') : '', kind: 'TikTok' };
    }
    const { extractContent } = await import('@/lib/scraper/index.js');
    const r = await extractContent({ url });
    return { text: (r?.text || '').slice(0, 5000), kind: 'โพสต์/เว็บ' };
  } catch (e) {
    return { text: '', kind: 'ดึงไม่ได้: ' + e.message?.slice(0, 50) };
  }
}

export async function POST(request) {
  try {
    const { url, note = '', user = 'ไม่ระบุ' } = await request.json();
    if (!url || !/^https?:\/\//.test(url)) {
      return NextResponse.json({ success: false, error: 'ต้องวางลิงก์โพสต์/คลิปที่เห็นว่าแรง', errorType: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const { text, kind } = await pullContent(url);
    const material = text || note;
    if (!material || material.length < 30) {
      return NextResponse.json({ success: false, error: `ดึงเนื้อหาไม่ได้ (${kind}) — พิมพ์สรุปสั้นๆ มากับลิงก์ในช่อง note ก็ได้`, errorType: 'NO_CONTENT' }, { status: 422 });
    }

    // ถอด pattern ความแรง — สมองถูก (mini) พอ
    let analysis = {};
    try {
      const res = await callAI({
        prompt: `โพสต์นี้ทีมข่าวรายงานว่ากำลังแรงในโซเชียล วิเคราะห์สั้นๆ ตอบ JSON:
${note ? 'หมายเหตุจากทีม: ' + note + '\n' : ''}เนื้อหา: ${material.slice(0, 2500)}

{"topic":"เรื่องอะไรใน 1 ประโยค","category":"หมวด","whyViral":"ทำไมแรง (hook/อารมณ์/ตัวเลข/จังหวะ)","rewritable":true/false,"rewriteAngle":"ถ้าเพจเราจะเล่นเรื่องนี้/แนวนี้ ควรเล่นมุมไหน"}`,
        model: 'gpt-4o-mini',
        temperature: 0.2,
        maxTokens: 500,
      });
      analysis = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
    } catch {}

    const store = createStore('market-hot-posts');
    const item = {
      id: 'mkt_' + crypto.createHash('md5').update(url).digest('hex').slice(0, 10),
      url, note, user, kind,
      content: material.slice(0, 3000),
      topic: String(analysis.topic || '').slice(0, 120),
      category: String(analysis.category || '').slice(0, 40),
      whyViral: String(analysis.whyViral || '').slice(0, 200),
      rewritable: analysis.rewritable !== false,
      rewriteAngle: String(analysis.rewriteAngle || '').slice(0, 200),
      addedAt: new Date().toISOString(),
    };
    const all = await store.getAll();
    if (all.find(i => i.id === item.id)) await store.update(item.id, (ex) => ({ ...ex, ...item }));
    else await store.add(item);

    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error('[MarketPost]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'MARKET_POST_ERROR' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const store = createStore('market-hot-posts');
    const all = await store.getAll();
    all.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    return NextResponse.json({ success: true, items: all.slice(0, 40) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'MARKET_POST_ERROR' }, { status: 500 });
  }
}
