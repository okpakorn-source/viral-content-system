import { NextResponse } from 'next/server';
import { extractContent } from '@/lib/scraper/index.js';
import { performSummarize } from '@/lib/services/summarizeService';
import { autoGenerateCover } from '@/lib/services/imageSearchService';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const { url, newsTitle: manualTitle, breakdownData: manualBreakdown } = await req.json();

    const logs = [];
    const addLog = (msg) => { logs.push(msg); console.log(`[CoverTester] ${msg}`); };

    let newsTitle = manualTitle || '';
    let newsBody = '';
    let breakdownData = manualBreakdown || {};
    let sourceUrl = url || null;
    let sourceType = 'text';

    // ─── STEP 1: If URL provided, scrape and extract content ───
    if (url && url.length > 5) {
      addLog(`🌐 กำลังดึงเนื้อหาจาก URL: ${url.slice(0, 80)}...`);

      // Detect source type
      if (/tiktok\.com|vt\.tiktok|vm\.tiktok/i.test(url)) sourceType = 'tiktok';
      else if (/youtube\.com|youtu\.be/i.test(url)) sourceType = 'youtube';
      else if (/facebook\.com|fb\.watch/i.test(url)) sourceType = 'facebook';
      else sourceType = 'url';

      // Scrape URL
      const scrapeData = await extractContent({ url });
      if (!scrapeData.success || !scrapeData.text || scrapeData.text.length < 20) {
        return NextResponse.json({
          success: false,
          message: `ไม่สามารถดึงเนื้อหาจาก URL ได้: ${scrapeData.error || 'เนื้อหาสั้นเกินไป'}`,
          logs,
        }, { status: 400 });
      }
      addLog(`✅ ดึงเนื้อหาได้ ${scrapeData.text.length} ตัวอักษร`);

      // ─── STEP 2: Extract news title & body ───
      addLog('📰 AI กำลังสกัดเนื้อข่าว...');
      const extractRes = await performSummarize({
        text: scrapeData.text,
        sourceType,
        mode: 'extract',
      });

      if (!extractRes.success || !extractRes.data?.newsBody) {
        return NextResponse.json({
          success: false,
          message: `สกัดข่าวไม่สำเร็จ: ${extractRes.error || 'ไม่มีเนื้อหา'}`,
          logs,
        }, { status: 500 });
      }

      newsTitle = extractRes.data.newsTitle || newsTitle;
      newsBody = extractRes.data.newsBody;
      addLog(`✅ สกัดข่าวสำเร็จ: "${newsTitle.slice(0, 50)}..." (${newsBody.length} ตัวอักษร)`);

      // ─── STEP 3: Breakdown ───
      addLog('🔍 AI กำลังวิเคราะห์มุมข่าว...');
      const breakRes = await performSummarize({
        text: newsBody,
        newsTitle,
        sourceType,
        mode: 'breakdown',
      });

      if (breakRes.success && breakRes.data) {
        breakdownData = breakRes.data;
        addLog(`✅ วิเคราะห์ได้ ${breakdownData.key_points?.length || 0} ประเด็น, ${breakdownData.possible_angles?.length || 0} มุมข่าว`);
      } else {
        addLog('⚠️ วิเคราะห์มุมข่าวไม่สำเร็จ ใช้ข้อมูลพื้นฐานแทน');
      }
    }

    if (!newsTitle) {
      return NextResponse.json({ success: false, message: 'กรุณาใส่หัวข้อข่าว หรือ URL ข่าว' }, { status: 400 });
    }

    // ─── STEP 4: Generate Cover ───
    addLog(`🎨 กำลังค้นหาภาพและสร้างปก: "${newsTitle.slice(0, 50)}..."`);

    const result = await autoGenerateCover(
      sourceUrl,
      sourceType,
      breakdownData,
      newsTitle
    );

    if (result.success) {
      addLog('✅ สร้างปกสำเร็จ!');
      return NextResponse.json({
        success: true,
        base64: result.base64,
        newsTitle,
        logs,
      });
    } else {
      addLog(`❌ สร้างปกไม่สำเร็จ: ${result.message}`);
      return NextResponse.json({ success: false, message: result.message, logs }, { status: 500 });
    }
  } catch (error) {
    console.error('[CoverTester API] Error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
