import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import { generateAngles } from '@/lib/ai/angleGenerator';

// POST — สร้างมุมมองไวรัลจากคอนเทนต์
export async function POST(request) {
  try {
    const { contentId } = await request.json();
    
    if (!contentId) {
      return NextResponse.json({ success: false, error: 'ต้องระบุ contentId' }, { status: 400 });
    }

    const content = await prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      return NextResponse.json({ success: false, error: 'ไม่พบคอนเทนต์' }, { status: 404 });
    }

    // สร้าง angles ด้วย AI
    const analysisData = content.viralScores ? JSON.parse(content.viralScores) : {};
    const angles = await generateAngles(content.cleanedText || content.originalText, analysisData);

    // บันทึก
    const angle = await prisma.angle.create({
      data: {
        id: uuidv4(),
        contentId,
        headlines: JSON.stringify(angles.headlines || []),
        hooks: JSON.stringify(angles.hooks || []),
        emotionalDirections: JSON.stringify(angles.emotional_directions || []),
        commentBaits: JSON.stringify(angles.comment_baits || []),
        discussionAngles: JSON.stringify(angles.discussion_angles || []),
      },
    });

    // อัปเดตสถานะ
    await prisma.content.update({
      where: { id: contentId },
      data: { status: 'generating' },
    });

    return NextResponse.json({ success: true, data: angle });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
