// GET /api/mega-covers — คืนรายการปกในคลังงาน MEGA (ใหม่สุดก่อน)
import { NextResponse } from 'next/server';
import { listMegaCovers } from '@/lib/megaCoverArchive';
import { listRefCovers } from '@/lib/refCoverLibrary';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const items = await listMegaCovers(200);
    // ★ 9 ก.ค. (ผู้ใช้สั่ง "ลบเทมเพลตแล้วต้องไม่โผล่"): join ref จริงของแต่ละใบให้ UI —
    //   เดิมหน้า /mega-covers hardcode /_ref/reference_5x4.jpg โชว์คู่ทุกปก ทำให้ ref ที่ลบแล้วดูเหมือนยังถูกใช้
    //   refId ที่หาไม่เจอในคลัง (ถูกลบ) → refImagePath = null ให้ UI บอกตรงๆ ว่า "ref ถูกลบแล้ว"
    let refMap = new Map();
    try { refMap = new Map((await listRefCovers(1000)).map((r) => [r.id, r])); } catch { /* คลัง ref อ่านไม่ได้ไม่ควรล้มทั้งลิสต์ */ }
    for (const it of items) {
      const ref = it.refId ? refMap.get(it.refId) : null;
      it.refImagePath = ref?.imagePath || null;
      it.refStyleName = ref?.styleName || null;
      it.refDeleted = Boolean(it.refId && !ref);
    }
    return NextResponse.json({ success: true, count: items.length, items });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message || 'อ่านคลังไม่ได้', items: [] }, { status: 500 });
  }
}
