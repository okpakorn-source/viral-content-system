/**
 * 🕵️ Image Hunt API — สืบหาภาพจากเนื้อหาข่าว (3 ก.ค. 69)
 * POST { content, caseName? }        → รันสืบครบวงจร (วิเคราะห์→ล่า→คัด→เก็บเคส)
 * GET                                 → รายการเคสทั้งหมด (เบา ไม่แนบภาพ)
 * GET ?id=IH-001                      → เคสเต็ม (ภาพ+วิเคราะห์+log)
 * POST { action:'delete', id }        → ลบเคส
 * 🔴 ระบบเดี่ยว — ไม่แตะระบบทำข่าวอัตโนมัติ/ท่อปก
 */
import { NextResponse } from 'next/server';
import { runHunt, listCases, getCase, deleteCase } from '@/lib/services/imageHuntService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // วิเคราะห์+ล่าหลายแหล่ง+วิชั่น QC ~1-3 นาที

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (id) {
      const c = await getCase(id);
      if (!c) return NextResponse.json({ success: false, error: 'ไม่พบเคสนี้', errorType: 'NOT_FOUND' }, { status: 404 });
      return NextResponse.json({ success: true, case: c });
    }
    return NextResponse.json({ success: true, cases: await listCases() });
  } catch (error) {
    console.error('[ImageHunt API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'IMAGE_HUNT_LIST_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === 'delete' && body.id) {
      await deleteCase(body.id);
      return NextResponse.json({ success: true, deleted: body.id });
    }
    const content = String(body.content || '').trim();
    if (content.length < 60) {
      return NextResponse.json({ success: false, error: 'วางเนื้อหาข่าวอย่างน้อย 60 ตัวอักษร (ยิ่งเต็มยิ่งสืบแม่น)', errorType: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY || !process.env.SERPER_API_KEY) {
      return NextResponse.json({ success: false, error: 'ขาด OPENAI_API_KEY หรือ SERPER_API_KEY', errorType: 'MISSING_KEY' }, { status: 500 });
    }
    const record = await runHunt(content, { caseName: String(body.caseName || '') });
    return NextResponse.json({ success: true, case: record });
  } catch (error) {
    console.error('[ImageHunt API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'IMAGE_HUNT_ERROR' }, { status: 500 });
  }
}
