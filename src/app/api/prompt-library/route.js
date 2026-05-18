import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createStore } from '@/lib/persistStore';

const store = createStore('prompt-library');

// GET — ดึง prompt ทั้งหมด + filter + search + match
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const emotion = searchParams.get('emotion');
    const search = searchParams.get('search');
    const matchCategory = searchParams.get('match');

    let prompts = await store.getAll();

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
    console.error('[Prompt-Library GET]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST — เพิ่ม prompt ใหม่
export async function POST(request) {
  try {
    const body = await request.json();

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
      // DNA v2 fields
      dnaTemplate: body.dnaTemplate || body.dna_template || null,
      emotionalArc: body.emotionalArc || body.emotional_arc || null,
      visualImagination: body.visualImagination || body.visual_imagination_instruction || null,
      commentTrigger: body.commentTrigger || body.comment_trigger_instruction || null,
      shareTrigger: body.shareTrigger || body.share_trigger_instruction || null,
      sourceContentId: body.sourceContentId || null,
      exampleContent: body.exampleContent || '',
      usageCount: 0,
      successCount: 0,
      createdAt: new Date().toISOString(),
    };

    await store.add(newPrompt);
    const total = await store.count();

    return NextResponse.json({ success: true, prompt: newPrompt, total });
  } catch (error) {
    console.error('[Prompt-Library POST]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PUT — อัปเดต prompt (usage tracking, edit)
export async function PUT(request) {
  try {
    const body = await request.json();

    const prompt = await store.update(body.id, (existing) => {
      if (body.action === 'use') {
        existing.usageCount = (existing.usageCount || 0) + 1;
        existing.lastUsedAt = new Date().toISOString();
      } else if (body.action === 'success') {
        existing.successCount = (existing.successCount || 0) + 1;
      } else if (body.action === 'feedback') {
        const fb = body.feedback || {};
        if (!existing.engagementHistory) existing.engagementHistory = [];
        existing.engagementHistory.push({
          date: new Date().toISOString(),
          likes: fb.likes || 0,
          shares: fb.shares || 0,
          comments: fb.comments || 0,
          reach: fb.reach || 0,
          contentId: fb.contentId || null,
        });
        const totalEngagement = (fb.likes || 0) + (fb.shares || 0) * 3 + (fb.comments || 0) * 2;
        if (totalEngagement > 10000) {
          existing.viralScore = Math.min(100, (existing.viralScore || 70) + 5);
        } else if (totalEngagement > 1000) {
          existing.viralScore = Math.min(100, (existing.viralScore || 70) + 2);
        }
        existing.successCount = (existing.successCount || 0) + 1;
        existing.totalEngagement = (existing.totalEngagement || 0) + totalEngagement;
      } else {
        const fields = ['promptName', 'category', 'emotionalType', 'hookStyle', 'tone', 'structure', 'ctaStyle', 'writingStyle', 'promptText', 'viralScore'];
        fields.forEach(f => { if (body[f] !== undefined) existing[f] = body[f]; });
      }
      return existing;
    });

    return NextResponse.json({ success: true, prompt });
  } catch (error) {
    console.error('[Prompt-Library PUT]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const result = await store.remove(id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[Prompt-Library DELETE]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
