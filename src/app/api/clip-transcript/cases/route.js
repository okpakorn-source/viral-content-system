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

/**
 * ★ 11 ส.ค. 69 (เจ้าของสั่ง) — PATCH: ปักหมุด "ใช้ใบนี้" ให้เวอร์ชันที่ถูกใจ
 *   ที่มา: คลิปเดียวถอดหลายครั้งได้ผลไม่เหมือนกัน บางรอบดีบางรอบไม่ดี → ต้องให้คนเลือกเก็บรอบที่ดีไว้
 *   ปักหมุดแล้ว: กดถอดซ้ำจะได้ใบนี้คืนทันที (ไม่จ่ายค่าถอดใหม่) และใบนี้จะไม่ถูกลบตอนเก็บกวาดคลัง
 *   Body: { id, chosen: true|false }  · ปักหมุดใบใหม่ = ปลดหมุดใบเก่าของคลิปเดียวกันให้อัตโนมัติ
 */
export async function PATCH(request) {
  try {
    const { searchParams } = new URL(request.url);
    // body พัง = ความผิดของผู้เรียก ต้องตอบ 400 พร้อมข้อความที่อ่านรู้เรื่อง ไม่ใช่ 500 พร้อม error ดิบของระบบ
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'ข้อมูลที่ส่งมาไม่ถูกรูปแบบ', errorType: 'BAD_REQUEST' }, { status: 400 });
    }
    const { id } = body;
    // ★ 11 ส.ค. (ผู้ตรวจ Fable5 ข้อ 4): ต้องอ่านค่าแบบเข้มงวด — เดิมใช้ !! ทำให้ส่ง chosen:"false" มาแล้วกลายเป็น "ปัก"
    //   endpoint นี้เปิดรับจากภายนอกได้ ไม่ใช่แค่ปุ่มบนหน้าเว็บที่ส่ง boolean มาถูกเสมอ
    const raw = body.chosen;
    const chosen = raw === undefined ? true
      : (raw === true || raw === 1 || String(raw).trim().toLowerCase() === 'true' || String(raw).trim() === '1');
    if (!id) return NextResponse.json({ success: false, error: 'ต้องระบุ id', errorType: 'CASES_ERROR' }, { status: 400 });
    const store = createStore(storeName(searchParams.get('kind')));
    const all = await store.getAll();
    const target = all.find(c => c.id === id);
    if (!target) return NextResponse.json({ success: false, error: 'ไม่พบเคสนี้ในคลัง', errorType: 'CASE_NOT_FOUND' }, { status: 404 });
    // ★ 11 ส.ค. (ผู้ตรวจ Sol ข้อ 1): ปักใบใหม่ก่อน แล้วค่อยปลดใบเก่า
    //   ลำดับนี้สำคัญ: ถ้าปลดก่อนแล้วปักล้ม จะไม่เหลือใบที่เลือกไว้เลย (แย่กว่ามีสองใบ)
    //   และการปลดใบเก่าห้ามกลืน error เงียบ — ถ้าปลดไม่ครบต้องบอกให้คนรู้ว่าต้องกดซ้ำ
    await store.update(id, (r) => ({ ...r, chosen, chosenAt: chosen ? new Date().toISOString() : null }));
    const failed = [];
    if (chosen) {
      for (const c of all) {
        if (c.url === target.url && c.id !== id && c.chosen) {
          try { await store.update(c.id, (r) => ({ ...r, chosen: false })); }
          catch (e) { failed.push(c.id); console.warn('[ClipCases] ปลดหมุดใบเก่าไม่สำเร็จ:', c.id, String(e?.message || e).slice(0, 60)); }
        }
      }
    }
    if (failed.length) {
      return NextResponse.json({
        success: true, id, chosen, warning: `ปักหมุดใบนี้แล้ว แต่ปลดหมุดใบเก่าไม่สำเร็จ ${failed.length} ใบ — กดปักหมุดซ้ำอีกครั้งเพื่อให้เหลือใบเดียว`,
      });
    }
    return NextResponse.json({ success: true, id, chosen });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message || 'ปักหมุดไม่สำเร็จ', errorType: 'CASES_ERROR' }, { status: 500 });
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
