/**
 * Template List API — /api/auto-cover/templates
 * GET: ดึงรายชื่อ template ทั้ง 6 แบบจริงจากหน้าปกข่าว
 */
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { getTemplateChoices } = await import('@/lib/coverTemplateRegistry');
    const templates = getTemplateChoices();

    return NextResponse.json({
      success: true,
      templates: [
        { id: 'auto', name: '🤖 Auto', desc: 'AI เลือก template ที่เหมาะสม', source: 'auto', imageSlots: 0 },
        ...templates,
      ],
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'TEMPLATE_ERROR' },
      { status: 500 }
    );
  }
}
