import { NextResponse } from 'next/server';
import { saveTemplate, getTemplates } from '@/lib/template-library/store';

/**
 * GET  /api/templates — list all saved templates
 * POST /api/templates — save a new template
 */

export async function GET() {
  try {
    const templates = await getTemplates();
    return NextResponse.json({
      success: true,
      templates,
      count: templates.length,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { template } = body;

    if (!template || !template.slots?.length) {
      return NextResponse.json({
        success: false,
        error: 'template object with slots[] required',
      }, { status: 400 });
    }

    // Stamp metadata
    const now = new Date().toISOString();
    const toSave = {
      ...template,
      id: template.id || ('tmpl_' + Date.now()),
      createdAt: template.createdAt || now,
      updatedAt: now,
      version: (template.version || 0) + 1,
      isFavorite: template.isFavorite || false,
    };

    const saved = await saveTemplate(toSave);
    return NextResponse.json({ success: true, template: saved });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
