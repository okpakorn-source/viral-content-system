// GET /api/mega-covers — คืนรายการปกในคลังงาน MEGA (ใหม่สุดก่อน)
import { NextResponse } from 'next/server';
import { listMegaCovers } from '@/lib/megaCoverArchive';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const items = await listMegaCovers(200);
    return NextResponse.json({ success: true, count: items.length, items });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message || 'อ่านคลังไม่ได้', items: [] }, { status: 500 });
  }
}
