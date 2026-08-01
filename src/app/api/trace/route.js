/**
 * 🛡️ GET /api/trace — อ่านกล่องดำ workflow ย้อนหลัง (1 ส.ค. 69)
 *   ?id=unify_xxx  → trace เต็มของงานนั้น (ร่างดิบ + before/after ทุกด่าน + คำตัดสินเกราะ)
 *   (ไม่ใส่ id)    → สรุปงานล่าสุด: งานไหน ด่านไหนแตะเนื้อบ้าง
 *   ?limit=N       → จำนวนรายการโหมดสรุป (default 20)
 * อ่านอย่างเดียว ไม่แตะการทำงานจริง
 */
import { NextResponse } from 'next/server';
import { bbLoadTraces } from '@/lib/trace/blackbox';

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id') || null;
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));
    const traces = bbLoadTraces({ id, limit });
    if (id && traces.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'ไม่พบ trace ของงานนี้ในเครื่องนี้ (กล่องดำเก็บรายเครื่อง — งานบน Vercel ให้ดูจาก response ของงานนั้น หรือรันซ้ำบนเครื่องทีม)',
        errorType: 'TRACE_NOT_FOUND',
      }, { status: 404 });
    }
    return NextResponse.json({ success: true, mode: id ? 'full' : 'summary', count: traces.length, traces });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'TRACE_READ_ERROR' }, { status: 500 });
  }
}
