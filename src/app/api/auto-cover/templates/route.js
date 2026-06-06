/**
 * Template List API — /api/auto-cover/templates
 * GET: ดึงรายชื่อ template ทั้งหมด (builtin + user-created)
 */
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { getTemplateChoices, getTemplateById, normalizeTemplate } = await import('@/lib/coverTemplateRegistry');
    const builtinChoices = getTemplateChoices();

    // ★ Enrich builtin templates with full slots data for manual slot UI
    const enrichedBuiltins = builtinChoices.map(t => {
      const full = getTemplateById(t.id);
      return { ...t, slots: full?.slots || [] };
    });

    // ── Merge user templates from template-library store ──
    let userChoices = [];
    try {
      const { getTemplates } = await import('@/lib/template-library/store');
      const userTemplates = await getTemplates();
      if (userTemplates && userTemplates.length > 0) {
        userChoices = userTemplates
          .filter(t => t.slots && t.slots.length > 0) // valid cover templates only
          .map(t => {
            const norm = normalizeTemplate(t);
            return {
              id: norm.id,
              name: norm.templateName || norm.name || norm.id,
              desc: norm.desc || `User template — ${norm.slots?.length || 0} slots`,
              imageSlots: norm.imageSlots,
              hasText: norm.textSlots?.length > 0,
              source: 'user',
              slots: norm.slots || [],
            };
          });
        if (userChoices.length > 0) {
          console.log(`[AutoCover/Templates] ✅ Merged ${userChoices.length} user templates`);
        }
      }
    } catch (userErr) {
      // Non-critical: user templates failed, serve builtin only
      console.warn('[AutoCover/Templates] User templates load failed (non-critical):', userErr.message);
    }

    return NextResponse.json({
      success: true,
      templates: [
        { id: 'auto', name: '🤖 Auto', desc: 'AI เลือก template ที่เหมาะสม', source: 'auto', imageSlots: 0 },
        ...enrichedBuiltins,
        ...userChoices,
      ],
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'TEMPLATE_ERROR' },
      { status: 500 }
    );
  }
}
