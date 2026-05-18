import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createStore } from '@/lib/persistStore';

const store = createStore('viral-library');

// GET — ดึงรายการทั้งหมด + filter
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    let items = await store.getAll();

    // Stats
    const stats = {
      total: items.length,
      raw: items.filter(i => i.status === 'raw').length,
      analyzed: items.filter(i => i.status === 'analyzed').length,
      prompted: items.filter(i => i.status === 'prompted').length,
    };

    // Filters
    if (category) items = items.filter(i => i.analysis?.category === category);
    if (status) items = items.filter(i => i.status === status);

    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return NextResponse.json({ success: true, items, stats });
  } catch (error) {
    console.error('[Viral-Library GET]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST — เพิ่มเนื้อหาไวรัลใหม่ (ทีละตัวหรือ batch)
export async function POST(request) {
  try {
    const body = await request.json();
    const contents = Array.isArray(body.contents) ? body.contents : [body];

    const newItems = contents.map(c => ({
      id: randomUUID(),
      title: c.title || '',
      content: c.content || '',
      source: c.source || '',
      platform: c.platform || 'other',
      engagement: c.engagement || {},
      status: 'raw',
      analysis: null,
      generatedPrompt: null,
      tags: c.tags || [],
      createdAt: new Date().toISOString(),
    }));

    await store.addMany(newItems);
    const total = await store.count();

    return NextResponse.json({
      success: true,
      added: newItems.length,
      ids: newItems.map(i => i.id),
      total,
    });
  } catch (error) {
    console.error('[Viral-Library POST]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PUT — อัปเดต item (analysis, prompt, status)
export async function PUT(request) {
  try {
    const body = await request.json();

    const item = await store.update(body.id, (existing) => {
      if (body.analysis) {
        existing.analysis = body.analysis;
        existing.status = 'analyzed';
      }
      if (body.generatedPrompt) {
        existing.generatedPrompt = body.generatedPrompt;
        existing.status = 'prompted';
      }
      if (body.title) existing.title = body.title;
      if (body.tags) existing.tags = body.tags;
      return existing;
    });

    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error('[Viral-Library PUT]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE — ลบ item
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const result = await store.remove(id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[Viral-Library DELETE]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
