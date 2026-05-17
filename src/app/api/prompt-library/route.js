import { NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = IS_VERCEL ? '/tmp' : join(process.cwd(), 'data');
const LIB_FILE = join(DATA_DIR, 'prompt-library.json');
const BUNDLED_FILE = join(process.cwd(), 'data', 'prompt-library.json');

async function loadPrompts() {
  try {
    return JSON.parse(await readFile(LIB_FILE, 'utf-8'));
  } catch {
    try {
      const { existsSync } = await import('fs');
      if (existsSync(BUNDLED_FILE)) {
        const data = JSON.parse(await readFile(BUNDLED_FILE, 'utf-8'));
        await savePrompts(data);
        return data;
      }
    } catch {}
    return [];
  }
}

async function savePrompts(items) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(LIB_FILE, JSON.stringify(items, null, 2), 'utf-8');
  try {
    await mkdir(join(process.cwd(), 'data'), { recursive: true });
    await writeFile(BUNDLED_FILE, JSON.stringify(items, null, 2), 'utf-8');
  } catch {}
}

// GET — ดึง prompt ทั้งหมด + filter + search + match
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const emotion = searchParams.get('emotion');
    const search = searchParams.get('search');
    const matchCategory = searchParams.get('match'); // สำหรับ Smart Matching

    let prompts = await loadPrompts();

    // Stats
    const categories = {};
    prompts.forEach(p => {
      const cat = p.category || 'อื่นๆ';
      categories[cat] = (categories[cat] || 0) + 1;
    });
    const stats = { total: prompts.length, categories };

    // Filters
    if (category) prompts = prompts.filter(p => p.category === category);
    if (emotion) prompts = prompts.filter(p => p.emotionalType?.includes(emotion));
    if (search) {
      const q = search.toLowerCase();
      prompts = prompts.filter(p =>
        p.category?.toLowerCase().includes(q) ||
        p.hookStyle?.toLowerCase().includes(q) ||
        p.promptText?.toLowerCase().includes(q) ||
        p.emotionalType?.toLowerCase().includes(q)
      );
    }

    // Smart Match — หา Top 5 ที่ category ตรง
    if (matchCategory) {
      const matched = prompts
        .filter(p => p.category === matchCategory)
        .sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0))
        .slice(0, 5);
      return NextResponse.json({ success: true, matched, total: matched.length });
    }

    prompts.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));

    return NextResponse.json({ success: true, prompts, stats });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST — เพิ่ม prompt ใหม่
export async function POST(request) {
  try {
    const body = await request.json();
    const prompts = await loadPrompts();

    const newPrompt = {
      id: body.id || `prompt_${randomUUID().slice(0, 8)}`,
      promptName: body.promptName || body.prompt_name || '',
      category: body.category || 'อื่นๆ',
      emotionalType: body.emotionalType || body.emotional_type || '',
      hookStyle: body.hookStyle || body.hook_style || '',
      tone: body.tone || '',
      structure: body.structure || '',
      ctaStyle: body.ctaStyle || body.cta_style || '',
      writingStyle: body.writingStyle || body.writing_style || '',
      promptText: body.promptText || body.prompt_text || '',
      viralScore: body.viralScore || body.viral_score || 0,
      doNot: body.doNot || body.do_not || [],
      exampleHooks: body.exampleHooks || body.example_hooks || [],
      sourceContentId: body.sourceContentId || null,
      exampleContent: body.exampleContent || '',
      usageCount: 0,
      successCount: 0,
      createdAt: new Date().toISOString(),
    };

    prompts.push(newPrompt);
    await savePrompts(prompts);

    return NextResponse.json({ success: true, prompt: newPrompt });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PUT — อัปเดต prompt (usage tracking, edit)
export async function PUT(request) {
  try {
    const body = await request.json();
    const prompts = await loadPrompts();
    const idx = prompts.findIndex(p => p.id === body.id);
    if (idx < 0) return NextResponse.json({ success: false, error: 'ไม่พบ' }, { status: 404 });

    // Increment usage
    if (body.action === 'use') {
      prompts[idx].usageCount = (prompts[idx].usageCount || 0) + 1;
    } else if (body.action === 'success') {
      prompts[idx].successCount = (prompts[idx].successCount || 0) + 1;
    } else {
      // General update
      const fields = ['category', 'emotionalType', 'hookStyle', 'tone', 'structure', 'ctaStyle', 'writingStyle', 'promptText', 'viralScore'];
      fields.forEach(f => { if (body[f] !== undefined) prompts[idx][f] = body[f]; });
    }
    prompts[idx].updatedAt = new Date().toISOString();

    await savePrompts(prompts);
    return NextResponse.json({ success: true, prompt: prompts[idx] });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const prompts = await loadPrompts();
    const filtered = prompts.filter(p => p.id !== id);
    if (filtered.length === prompts.length) return NextResponse.json({ success: false, error: 'ไม่พบ' }, { status: 404 });
    await savePrompts(filtered);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
