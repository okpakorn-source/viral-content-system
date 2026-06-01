import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

const store = createStore('cover-presets');

/**
 * Cover Prompt Presets CRUD API
 */
export async function GET() {
  try {
    const presets = await store.getAll();
    return NextResponse.json({ success: true, presets });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'add') {
      const preset = {
        id: 'cover_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: body.name || 'Preset ไม่มีชื่อ',
        category: body.category || 'ทั่วไป',
        icon: body.icon || '📰',
        fields: body.fields || {},
        aspectRatio: body.aspectRatio || '1080x1080',
        exampleImageBase64: body.exampleImageBase64 || null,
        usageCount: 0,
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
      };
      await store.add(preset);
      return NextResponse.json({ success: true, preset });
    }

    if (action === 'update') {
      const updated = await store.update(body.id, (existing) => ({
        ...existing,
        name: body.name ?? existing.name,
        category: body.category ?? existing.category,
        icon: body.icon ?? existing.icon,
        fields: body.fields ?? existing.fields,
        aspectRatio: body.aspectRatio ?? existing.aspectRatio,
        exampleImageBase64: body.exampleImageBase64 ?? existing.exampleImageBase64,
      }));
      return NextResponse.json({ success: true, preset: updated });
    }

    if (action === 'delete') {
      await store.remove(body.id);
      return NextResponse.json({ success: true });
    }

    if (action === 'increment-usage') {
      const updated = await store.update(body.id, (existing) => ({
        ...existing,
        usageCount: (existing.usageCount || 0) + 1,
        lastUsedAt: new Date().toISOString(),
      }));
      return NextResponse.json({ success: true, preset: updated });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
