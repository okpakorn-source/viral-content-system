import { NextResponse } from 'next/server';
import { getTemplate, saveTemplate, deleteTemplate, duplicateTemplate } from '@/lib/template-library/store';

/**
 * GET    /api/templates/[id]           — get one template
 * PATCH  /api/templates/[id]           — update (edit slots, rename, favorite)
 * DELETE /api/templates/[id]           — delete
 * POST   /api/templates/[id]/duplicate — handled via action param
 */

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const template = await getTemplate(id);
    if (!template) return NextResponse.json({ success: false, error: 'Not found: ' + id }, { status: 404 });
    return NextResponse.json({ success: true, template });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getTemplate(id);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found: ' + id }, { status: 404 });

    const body = await request.json();
    const { action } = body;

    // Action: duplicate
    if (action === 'duplicate') {
      const copy = await duplicateTemplate(id);
      return NextResponse.json({ success: true, template: copy, action: 'duplicated' });
    }

    // Action: favorite toggle
    if (action === 'favorite') {
      const updated = { ...existing, isFavorite: !existing.isFavorite, updatedAt: new Date().toISOString() };
      await saveTemplate(updated);
      return NextResponse.json({ success: true, template: updated, action: 'favorite_toggled' });
    }

    // Default: merge update (edit slots, name, etc.)
    const updated = {
      ...existing,
      ...body,
      id,                                       // id ห้ามเปลี่ยน
      createdAt: existing.createdAt,            // createdAt ห้ามเปลี่ยน
      updatedAt: new Date().toISOString(),
      version: (existing.version || 0) + 1,
    };
    delete updated.action;
    await saveTemplate(updated);
    return NextResponse.json({ success: true, template: updated });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    await deleteTemplate(id);
    return NextResponse.json({ success: true, deleted: id });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
