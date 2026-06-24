import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

/**
 * คลังเคสสกัดข่าว (13 มิ.ย. 69) — เก็บทุกการสกัดไว้ตรวจย้อนว่าตัดใจความสำคัญไปไหม
 * GET  ?limit=30          → รายการล่าสุด (ต้นฉบับ + แก่น + สิ่งที่ตัด)
 * DELETE ?id=xxx | ?id=all → ลบเคส
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ★ 19 มิ.ย. (ผู้ใช้): type=splits → คลังประวัติ "แยกประเด็น" (ไม่ใช่สกัดเนื้อ)
const storeName = (type) => (type === 'splits' ? 'news-filter-splits' : 'news-filter-cases');

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(500, Number(searchParams.get('limit')) || 30); // ★ 24 มิ.ย.: เพดาน 500 — ตรวจสถิติรายคนย้อนหลัง
    const type = searchParams.get('type') || 'cases';
    const store = createStore(storeName(type));
    const all = await store.getAll();
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return NextResponse.json({ success: true, cases: all.slice(0, limit), total: all.length, type });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'CASES_LIST_ERROR' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const store = createStore(storeName(searchParams.get('type') || 'cases'));
    if (id === 'all') {
      const all = await store.getAll();
      for (const c of all) await store.remove(c.id).catch(() => {});
      return NextResponse.json({ success: true, removed: all.length });
    }
    if (!id) return NextResponse.json({ success: false, error: 'ต้องระบุ id' }, { status: 400 });
    const result = await store.remove(id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'CASES_DELETE_ERROR' }, { status: 500 });
  }
}
