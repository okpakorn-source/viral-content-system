export const maxDuration = 300; // ดึงเนื้อข่าว + วิจัย + ค้น (ไม่ต้องดูคลิป — เร็วกว่า clip hunt)
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createStore } from '@/lib/persistStore';
import { extractContent } from '@/lib/scraper/index.js';
import { runNewsHunt } from '@/lib/services/newsHuntService';

/**
 * POST /api/clip-transcript/news-hunt (8 ก.ค. 69) — "วิจัยลิงก์ข่าว → หาข่าวเสริม"
 *  1) ดึงเนื้อข่าวจากลิงก์ (extractContent: Firecrawl→Jina→direct — ทำงานบนคลาวด์ได้)
 *  2) newsHuntService: วิจัยเชิงลึก → ค้น Serper → คัด (reuse สมองคลิป)
 *  3) เก็บ store 'user-topic-hunts' (★ คลังเดียวกับคลิป) sourceType='article' — ผลแยกด้วยป้าย
 *  • Body: { url, user?, caseId? (ค้นเพิ่มเข้าเคสเดิม), rawContent? (ก๊อบเนื้อมาวางแทน) }
 * ★ แยกจากโต๊ะข่าวกลาง/เวิร์กโฟลว์ข่าว 100%
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ลิงก์คลิป → ให้ไปใช้ปุ่มคลิปแทน (news-hunt สำหรับ "ข่าวเว็บ")
function isClipUrl(url) {
  return /youtube\.com|youtu\.be|tiktok\.com|facebook\.com|fb\.watch|instagram\.com/i.test(url);
}

export async function POST(request) {
  try {
    const { url: _rawUrl, user = '', caseId = null, rawContent = '' } = await request.json();
    const url = String(_rawUrl || '').trim();
    if (!url && !rawContent) {
      return NextResponse.json({ success: false, error: 'กรุณาวางลิงก์ข่าว', errorType: 'MISSING_URL' }, { status: 400 });
    }
    if (url && !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ success: false, error: 'ลิงก์ไม่ถูกต้อง (ต้องขึ้นต้น http/https)', errorType: 'BAD_URL' }, { status: 400 });
    }
    if (url && isClipUrl(url) && !rawContent) {
      return NextResponse.json({ success: false, error: 'ลิงก์นี้เป็นคลิป — ใช้ปุ่ม "🧭 ถอด+ค้นข่าวคล้าย" แทน (ปุ่มนี้สำหรับลิงก์ข่าวเว็บ)', errorType: 'IS_CLIP_URL' }, { status: 400 });
    }

    // 1) ดึงเนื้อข่าว (หรือใช้เนื้อที่ก๊อบมาวาง)
    let article;
    if (rawContent && String(rawContent).trim().length >= 120) {
      article = { title: String(rawContent).slice(0, 80), text: String(rawContent), url };
    } else {
      const ex = await extractContent({ url });
      if (!ex?.success || !ex.text || ex.text.length < 120) {
        return NextResponse.json({
          success: false,
          error: ex?.error || 'ดึงเนื้อข่าวจากลิงก์นี้ไม่ได้ (เว็บอาจบล็อกบอต) — ลองก๊อบเนื้อข่าวมาวางในช่องแทน',
          errorType: 'EXTRACT_FAILED', suggestion: 'paste',
        }, { status: 422 });
      }
      article = { title: ex.title || '', text: ex.text, url };
    }

    // 2) วิจัย → ค้น → คัด
    const hunt = await runNewsHunt({ url: url || `paste:${Date.now()}`, article, user });

    // 3) เก็บคลังร่วม user-topic-hunts (แยกด้วย sourceType) — ลิงก์เดิม/caseId → รวมผลเข้าเคสเดิม
    const store = createStore('user-topic-hunts');
    const all = await store.getAll();
    const ex = (caseId ? await store.findById(caseId) : null) || (url ? all.find(c => c.sourceUrl === url) : null);
    if (ex) {
      const seen = new Set((ex.results || []).map(r => r.url));
      const merged = [...(ex.results || []), ...hunt.results.filter(r => !seen.has(r.url))].sort((a, b) => b.score - a.score);
      await store.update(ex.id, (e) => ({
        ...e, results: merged, insight: hunt.insight, styleProfile: hunt.styleProfile,
        searchKeys: [...new Set([...(e.searchKeys || []), ...hunt.searchKeys])],
        stats: { ...(e.stats || {}), kept: merged.length, lastHuntAt: new Date().toISOString() },
        updatedAt: new Date().toISOString(),
      }));
      const updated = await store.findById(ex.id);
      return NextResponse.json({ success: true, data: updated, merged: true });
    }

    const record = {
      id: randomUUID(), platform: 'article', ...hunt,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await store.add(record); // ★ เก็บถาวร — ไม่หมุนทิ้ง
    return NextResponse.json({ success: true, data: record });
  } catch (error) {
    console.error('[NewsHunt]', error.message);
    return NextResponse.json({ success: false, error: String(error.message || 'วิจัยลิงก์ข่าวล้มเหลว').slice(0, 200), errorType: 'NEWS_HUNT_ERROR' }, { status: 500 });
  }
}
