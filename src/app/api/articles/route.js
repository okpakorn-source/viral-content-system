import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { generateArticle, rewriteArticle } from '@/lib/ai/articleGenerator';

// POST — สร้างบทความ
export async function POST(request) {
  try {
    const { contentId, angleId, headlineIndex, hookIndex, tone = 'emotional', customPrompt = '' } = await request.json();

    if (!contentId) {
      return NextResponse.json({ success: false, error: 'ต้องระบุ contentId' }, { status: 400 });
    }

    const content = await prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      return NextResponse.json({ success: false, error: 'ไม่พบคอนเทนต์' }, { status: 404 });
    }

    let headline = '';
    let hook = '';

    // ถ้ามี angle ให้ดึง headline/hook จาก angle
    if (angleId) {
      const angle = await prisma.angle.findUnique({ where: { id: angleId } });
      if (angle) {
        const headlines = JSON.parse(angle.headlines);
        const hooks = JSON.parse(angle.hooks);
        headline = headlines[headlineIndex || 0] || headlines[0] || '';
        hook = hooks[hookIndex || 0] || hooks[0] || '';
      }
    }

    // สร้างบทความ (รองรับ custom prompt จากผู้ใช้)
    const articleData = await generateArticle({
      headline,
      hook,
      content: content.cleanedText || content.originalText,
      tone,
      instructions: customPrompt || '',
    });

    // นับ variant
    const existingCount = await prisma.article.count({ where: { contentId } });
    const variants = ['A', 'B', 'C', 'D', 'E'];

    const article = await prisma.article.create({
      data: {
        id: uuidv4(),
        contentId,
        angleId: angleId || null,
        headline: articleData.headline || headline,
        hook: articleData.hook || hook,
        body: articleData.body,
        tone,
        variant: variants[existingCount] || 'A',
        version: 1,
      },
    });

    return NextResponse.json({ success: true, data: article });
  } catch (error) {
    console.error('Articles API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET — ดึงบทความ
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const contentId = searchParams.get('contentId');
    
    const where = contentId ? { contentId } : {};
    const articles = await prisma.article.findMany({ where, orderBy: { createdAt: 'desc' } });
    
    return NextResponse.json({ success: true, data: articles });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
