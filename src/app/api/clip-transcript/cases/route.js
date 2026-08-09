import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

/**
 * คลังบทถอดคลิป (15 มิ.ย. 69) — เก็บบทสัมภาษณ์ที่ถอดแล้วไว้หยิบใช้
 * GET ?limit=40&kind=transcript|insight → รายการล่าสุด | DELETE ?id=xxx|all&kind=...
 * ★ 22 มิ.ย.: kind=insight → คลัง "ถอดประเด็นข่าว (ข้อมูลดิบ)" (store clip-insights)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// kind → ชื่อ store (กันค่ามั่ว: รับแค่ 3 ค่า) — ★ 8 ก.ค.: เพิ่ม hunt = คลังค้นประเด็นยูสเซอร์
const storeName = (kind) => (kind === 'insight' ? 'clip-insights' : kind === 'hunt' ? 'user-topic-hunts' : 'clip-transcripts');

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    // ★ 9 ส.ค. 69 (เจ้าของสั่งขยายคลังดูได้ 100 แบ่งหน้า): เพิ่ม offset แบบเข้ากันได้ย้อนหลัง —
    //   ไม่ส่ง offset = พฤติกรรมเดิมเป๊ะ (ผู้เรียกเดิมเช่น /m ไม่กระทบ) · เพดาน limit 80→100
    const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit')) || 40));
    const offset = Math.max(0, Number(searchParams.get('offset')) || 0);
    const store = createStore(storeName(searchParams.get('kind')));
    const all = await store.getAll();
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return NextResponse.json({ success: true, cases: all.slice(offset, offset + limit), total: all.length });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'CASES_ERROR' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const store = createStore(storeName(searchParams.get('kind')));
    if (id === 'all') {
      const all = await store.getAll();
      for (const c of all) await store.remove(c.id).catch(() => {});
      return NextResponse.json({ success: true, removed: all.length });
    }
    if (!id) return NextResponse.json({ success: false, error: 'ต้องระบุ id', errorType: 'CASES_ERROR' }, { status: 400 });
    const result = await store.remove(id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'CASES_ERROR' }, { status: 500 });
  }
}
