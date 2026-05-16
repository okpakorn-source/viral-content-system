import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { extractFromUrl, extractFromRawText } from '@/lib/scraper/urlExtractor';
import { analyzeContent } from '@/lib/ai/analyzer';

// GET — ดึงรายการคอนเทนต์ทั้งหมด
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    const where = status ? { status } : {};
    
    const [contents, total] = await Promise.all([
      prisma.content.findMany({
        where,
        include: { source: true, articles: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.content.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: contents,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST — สร้างคอนเทนต์ใหม่
export async function POST(request) {
  try {
    const body = await request.json();
    const { type, url, rawContent, autoAnalyze = true } = body;

    // 1. ดึงเนื้อหา
    let extracted;
    if (type === 'url' && url) {
      extracted = await extractFromUrl(url);
    } else if (type === 'raw' && rawContent) {
      extracted = extractFromRawText(rawContent);
    } else {
      return NextResponse.json({ success: false, error: 'ต้องระบุ type (url/raw) และข้อมูล' }, { status: 400 });
    }

    // 2. บันทึก Source
    const sourceId = uuidv4();
    await prisma.source.create({
      data: {
        id: sourceId,
        type,
        url: url || null,
        rawContent: rawContent || null,
        metadata: JSON.stringify({ image: extracted.image, source: extracted.source }),
      },
    });

    // 3. บันทึก Content
    const contentId = uuidv4();
    let contentData = {
      id: contentId,
      sourceId,
      title: extracted.title,
      originalText: extracted.content,
      cleanedText: extracted.content,
      status: 'pending',
    };

    // 4. Auto-analyze ถ้าเปิดใช้
    if (autoAnalyze) {
      contentData.status = 'analyzing';
      const content = await prisma.content.create({ data: contentData });

      try {
        const analysis = await analyzeContent(extracted.content);
        
        await prisma.content.update({
          where: { id: contentId },
          data: {
            viralScores: JSON.stringify(analysis.viral_scores),
            emotionalAnalysis: JSON.stringify(analysis.emotional_analysis),
            viralProbability: analysis.viral_probability,
            status: 'scored',
          },
        });

        const updatedContent = await prisma.content.findUnique({
          where: { id: contentId },
          include: { source: true },
        });

        return NextResponse.json({
          success: true,
          data: updatedContent,
          analysis,
        });
      } catch (aiError) {
        await prisma.content.update({
          where: { id: contentId },
          data: { status: 'pending' },
        });
        
        return NextResponse.json({
          success: true,
          data: await prisma.content.findUnique({ where: { id: contentId }, include: { source: true } }),
          warning: `AI วิเคราะห์ไม่สำเร็จ: ${aiError.message}`,
        });
      }
    }

    const content = await prisma.content.create({ data: contentData });
    return NextResponse.json({ success: true, data: content });
  } catch (error) {
    console.error('Content creation error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
