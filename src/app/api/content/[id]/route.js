import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// GET — ดึงรายละเอียดคอนเทนต์
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const content = await prisma.content.findUnique({
      where: { id },
      include: {
        source: true,
        angles: true,
        articles: { orderBy: { createdAt: 'desc' } },
        thumbnails: true,
        reviews: { include: { reviewer: { select: { name: true, role: true } } }, orderBy: { reviewedAt: 'desc' } },
        publications: { include: { analytics: true } },
      },
    });

    if (!content) {
      return NextResponse.json({ success: false, error: 'ไม่พบคอนเทนต์' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: content });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PATCH — อัปเดตคอนเทนต์
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    const content = await prisma.content.update({
      where: { id },
      data: body,
    });

    return NextResponse.json({ success: true, data: content });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE — ลบคอนเทนต์
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    await prisma.content.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
