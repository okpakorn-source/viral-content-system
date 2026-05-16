import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { extractContent } from '@/lib/scraper/index.js';
import { analyzeContent } from '@/lib/ai/analyzer';

// POST — สร้างคอนเทนต์ + วิเคราะห์
export async function POST(request) {
  try {
    const body = await request.json();
    const { type = 'raw', url, rawContent, autoAnalyze = true } = body;

    // 1. Extract content
    let extractedData;
    if (type === 'raw') {
      extractedData = {
        success: true,
        type: 'raw',
        title: rawContent?.slice(0, 60) || 'Untitled',
        text: rawContent || '',
      };
    } else {
      extractedData = await extractContent({ url, type, rawContent });
    }

    const contentText = extractedData.text || rawContent || '';
    if (!contentText || contentText.length < 10) {
      return NextResponse.json({
        success: false,
        error: 'เนื้อหาสั้นเกินไป — กรุณาใส่เนื้อหาที่มีอย่างน้อย 10 ตัวอักษร',
      }, { status: 400 });
    }

    // 2. Create source record
    const sourceId = uuidv4();
    try {
      await prisma.source.create({
        data: {
          id: sourceId,
          type: type,
          url: url || null,
          rawContent: contentText,
        },
      });
    } catch (dbError) {
      // DB อาจไม่พร้อม (Vercel) — ไม่เป็นไร ทำต่อ
      console.log('DB source create skipped:', dbError.message);
    }

    // 3. Analyze with AI
    let analysis = null;
    if (autoAnalyze) {
      analysis = await analyzeContent(contentText);
    }

    // 4. Create content record
    const contentId = uuidv4();
    const viralScore = analysis?.viral_scores
      ? Math.round(Object.values(analysis.viral_scores).reduce((a, b) => a + b, 0) / Object.values(analysis.viral_scores).length)
      : 0;

    try {
      await prisma.content.create({
        data: {
          id: contentId,
          sourceId,
          title: extractedData.title || contentText.slice(0, 60),
          originalText: contentText,
          cleanedText: contentText,
          status: analysis ? 'analyzed' : 'pending',
          viralScore: viralScore,
          analysisData: analysis ? JSON.stringify(analysis) : null,
        },
      });
    } catch (dbError) {
      console.log('DB content create skipped:', dbError.message);
    }

    return NextResponse.json({
      success: true,
      data: {
        id: contentId,
        sourceId,
        title: extractedData.title || contentText.slice(0, 60),
        originalText: contentText,
        cleanedText: contentText,
        status: analysis ? 'analyzed' : 'pending',
        viralScore,
        analysis,
        extractedData: {
          type: extractedData.type,
          author: extractedData.author || null,
          image: extractedData.image || extractedData.thumbnailUrl || null,
          note: extractedData.note || null,
        },
      },
    });
  } catch (error) {
    console.error('Content API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET — ดึงรายการคอนเทนต์ทั้งหมด
export async function GET() {
  try {
    const contents = await prisma.content.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ success: true, data: contents });
  } catch (error) {
    return NextResponse.json({ success: true, data: [] });
  }
}
