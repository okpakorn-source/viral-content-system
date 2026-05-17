import { NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

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
        await saveLibrary(data);
        return data;
      }
    } catch {}
    return [];
  }
}

async function saveLibrary(items) {
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
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST — เพิ่มเนื้อหาไวรัลใหม่ (ทีละตัวหรือ batch)
export async function POST(request) {
  try {
    const body = await request.json();
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
    await saveLibrary(items);

    return NextResponse.json({
      success: true,
      added: newItems.length,
      ids: newItems.map(i => i.id),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PUT — อัปเดต item (analysis, prompt, status)
export async function PUT(request) {
  try {
    const body = await request.json();
    const items = await loadLibrary();
    const idx = items.findIndex(i => i.id === body.id);
    if (idx < 0) return NextResponse.json({ success: false, error: 'ไม่พบ' }, { status: 404 });

    if (body.analysis) {
      items[idx].analysis = body.analysis;
      items[idx].status = 'analyzed';
    }
    if (body.generatedPrompt) {
      items[idx].generatedPrompt = body.generatedPrompt;
      items[idx].status = 'prompted';
    }
    if (body.title) items[idx].title = body.title;
    if (body.tags) items[idx].tags = body.tags;
    items[idx].updatedAt = new Date().toISOString();

    await saveLibrary(items);
    return NextResponse.json({ success: true, item: items[idx] });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE — ลบ item
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const items = await loadLibrary();
    const filtered = items.filter(i => i.id !== id);
    if (filtered.length === items.length) return NextResponse.json({ success: false, error: 'ไม่พบ' }, { status: 404 });
    await saveLibrary(filtered);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
