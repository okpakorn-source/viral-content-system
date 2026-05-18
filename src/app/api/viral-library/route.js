import { NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { withFileLock } from '@/lib/fileLock';

const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = IS_VERCEL ? '/tmp' : join(process.cwd(), 'data');
const LIB_FILE = join(DATA_DIR, 'viral-library.json');
const BUNDLED_FILE = join(process.cwd(), 'data', 'viral-library.json');

async function loadLibrary() {
  try {
    return JSON.parse(await readFile(LIB_FILE, 'utf-8'));
  } catch {
    try {
      const { existsSync } = await import('fs');
      if (existsSync(BUNDLED_FILE)) {
        const data = JSON.parse(await readFile(BUNDLED_FILE, 'utf-8'));
        await _saveRaw(data);
        return data;
      }
    } catch {}
    return [];
  }
}

async function _saveRaw(items) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(LIB_FILE, JSON.stringify(items, null, 2), 'utf-8');
  try {
    await mkdir(join(process.cwd(), 'data'), { recursive: true });
    await writeFile(BUNDLED_FILE, JSON.stringify(items, null, 2), 'utf-8');
  } catch {}
}

// GET — ดึงรายการทั้งหมด + filter
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status'); // raw, analyzed, prompted
    let items = await loadLibrary();

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

    const result = await withFileLock(LIB_FILE, async () => {
      const items = await loadLibrary();

      // Batch mode: รับ array ของ contents
      const contents = Array.isArray(body.contents) ? body.contents : [body];

      const newItems = contents.map(c => ({
        id: randomUUID(),
        title: c.title || '',
        content: c.content || '',
        source: c.source || '',          // URL, Facebook, manual
        platform: c.platform || 'other', // facebook, tiktok, youtube, other
        engagement: c.engagement || {},   // likes, shares, comments
        status: 'raw',                   // raw → analyzed → prompted
        analysis: null,                  // จะถูก fill โดย AI Analyzer
        generatedPrompt: null,           // จะถูก fill โดย Prompt Generator
        tags: c.tags || [],
        createdAt: new Date().toISOString(),
      }));

      items.push(...newItems);
      await _saveRaw(items);

      console.log(`[Viral-Library POST] ✅ Added ${newItems.length} items → total: ${items.length}`);
      return { added: newItems.length, ids: newItems.map(i => i.id), total: items.length };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[Viral-Library POST]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PUT — อัปเดต item (analysis, prompt, status)
export async function PUT(request) {
  try {
    const body = await request.json();

    const result = await withFileLock(LIB_FILE, async () => {
      const items = await loadLibrary();
      const idx = items.findIndex(i => i.id === body.id);
      if (idx < 0) throw new Error(`ไม่พบ item id: ${body.id}`);

      if (body.analysis) {
        items[idx].analysis = body.analysis;
        items[idx].status = 'analyzed';
        console.log(`[Viral-Library PUT] ✅ analysis saved for "${items[idx].title?.slice(0,30)}"`);
      }
      if (body.generatedPrompt) {
        items[idx].generatedPrompt = body.generatedPrompt;
        items[idx].status = 'prompted';
        console.log(`[Viral-Library PUT] ✅ prompt saved for "${items[idx].title?.slice(0,30)}"`);
      }
      if (body.title) items[idx].title = body.title;
      if (body.tags) items[idx].tags = body.tags;
      items[idx].updatedAt = new Date().toISOString();

      await _saveRaw(items);
      return { item: items[idx] };
    });

    return NextResponse.json({ success: true, ...result });
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

    const result = await withFileLock(LIB_FILE, async () => {
      const items = await loadLibrary();
      const filtered = items.filter(i => i.id !== id);
      if (filtered.length === items.length) throw new Error('ไม่พบ');
      await _saveRaw(filtered);
      console.log(`[Viral-Library DELETE] ✅ Deleted ${id} → remaining: ${filtered.length}`);
      return { remaining: filtered.length };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[Viral-Library DELETE]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
