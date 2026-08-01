/**
 * 🌊 Saga API — จัดการซากากระแสใหญ่ (2 ก.ค. 69)
 * GET               → รายการซากาทั้งหมด (active ก่อน)
 * POST { topic }    → เปิดซากาเอง (AI แตกตัวละคร/มุมให้)
 * POST { id, action:'deactivate' } → ปิดซากา
 * 🔴 ใช้เฉพาะโต๊ะข่าวกลาง
 */
import { NextResponse } from 'next/server';
import { deskPipelineOff, deskOffPayload } from '@/lib/deskPipelineGate'; // 🛑 31 ก.ค. 69: สวิตช์ปิดโต๊ะข่าวชั่วคราว (เจ้าของสั่ง)
import { getAllSagas, addSaga, deactivateSaga, detectSagas } from '@/lib/services/newsDesk/sagaTracker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET() {
  try {
    const sagas = await getAllSagas();
    sagas.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));
    return NextResponse.json({ success: true, sagas, active: sagas.filter(s => s.active).length });
  } catch (error) {
    console.error('[Saga API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'SAGA_LIST_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === 'deactivate' && body.id) {
      await deactivateSaga(body.id);
      return NextResponse.json({ success: true, id: body.id, active: false });
    }
    // 🛑 31 ก.ค. 69 (เจ้าของสั่งปิดโต๊ะข่าวชั่วคราว): detect = LLM · deactivate (ปิดมหากาพย์ — ฟรี) ผ่านตามเดิม
    if (body.action === 'detect' && deskPipelineOff()) {
      return NextResponse.json(deskOffPayload(), { status: 503 });
    }
    if (body.action === 'detect') {
      // สั่งสแกนหาซากาจากโต๊ะทันที (ข้าม throttle ไม่ได้ — กันยิง AI ถี่)
      const r = await detectSagas();
      return NextResponse.json({ success: true, ...r });
    }
    if (body.topic) {
      const saga = await addSaga({ topic: body.topic, people: body.people || [], angles: body.angles || [] });
      return NextResponse.json({ success: true, saga });
    }
    return NextResponse.json({ success: false, error: 'ต้องระบุ topic หรือ {id, action:"deactivate"}', errorType: 'VALIDATION_ERROR' }, { status: 400 });
  } catch (error) {
    console.error('[Saga API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'SAGA_ACTION_ERROR' }, { status: 500 });
  }
}
