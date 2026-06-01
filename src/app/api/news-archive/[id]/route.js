import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

const STORE = 'news-archive';

// GET /api/news-archive/[id]
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const store = createStore(STORE);
    const all = await store.getAll();
    const item = all.find(i => i.id === id);
    if (!item) return NextResponse.json({ success: false, error: 'ไม่พบข่าวนี้' }, { status: 404 });
    return NextResponse.json({ success: true, data: item });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// PATCH /api/news-archive/[id] — อัพเดท tags, category, used_count
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const store = createStore(STORE);
    const updated = await store.update(id, (existing) => ({
      ...existing,
      ...body,
      updatedAt: new Date().toISOString(),
    }));
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// DELETE /api/news-archive/[id]
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const store = createStore(STORE);
    await store.remove(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
