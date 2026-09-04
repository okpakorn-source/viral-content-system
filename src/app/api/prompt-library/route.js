import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createStore } from '@/lib/persistStore';

const store = createStore('prompt-library');

// ★ 3 ก.ย. 69 (F14 แบบ FINAL card-library): สถานะการ์ด active/archived/proposed — ใบที่ไม่มี field = active (ทั้งคลังเดิม)
//   สวิตช์ CARD_LIBRARY_V2 default เปิด ('0' = พฤติกรรมเดิมทุกเส้นทาง) — อ่านตอนรับ request จะได้สลับโดยไม่ต้อง build ใหม่
const CARD_STATUSES = ['active', 'archived', 'proposed'];
const isCardLibV2 = () => process.env.CARD_LIBRARY_V2 !== '0';

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
      emotionalTags: body.emotionalTags || body.emotional_tags || [],
      conflictTags: body.conflictTags || body.conflict_tags || [],
      emotionalType: body.emotionalType || body.emotional_type || '', // legacy fallback
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
      narrativeArchetype: body.narrative_archetype || body.narrativeArchetype || '',
      targetCategories: body.target_categories || body.targetCategories || [],
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
      } else if (isCardLibV2() && (body.action === 'archive' || body.action === 'restore')) {
        // ★ 3 ก.ย. 69 (F14): พัก/กู้คืนรายใบแบบ action เดียวกับ use/success — ไม่ลบ (เคสเก่าอ้าง promptId ได้เสมอ)
        //   CARD_LIBRARY_V2=0 → action นี้ตกลง else ข้างล่างเหมือนโค้ดเดิม (ไม่แตะ status)
        existing.status = body.action === 'archive' ? 'archived' : 'active';
      } else {
        const fields = ['promptName', 'category', 'emotionalType', 'hookStyle', 'tone', 'structure', 'ctaStyle', 'writingStyle', 'promptText', 'viralScore', 'narrativeArchetype', 'targetCategories', 'emotionalTags', 'conflictTags'];
        fields.forEach(f => { if (body[f] !== undefined) existing[f] = body[f]; });
        // ★ 3 ก.ย. 69 (F14): เปิดรับ status ผ่าน PUT เฉพาะค่าที่รู้จักใต้สวิตช์ — ค่าอื่น/ไม่ส่ง = เมินเงียบเหมือน field นอก whitelist เดิม
        //   (viral-library spread payload จาก AI เข้า PUT ตรงๆ — ถ้าตอบ 400 ใส่ค่าเพี้ยนจะพังท่อบันทึกเดิม)
        if (isCardLibV2() && CARD_STATUSES.includes(body.status)) existing.status = body.status;
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
    
    if (id === 'all') {
      // ★ 1 ส.ค. 69 (ออดิต): ลบทั้งคลัง (200+ ใบ) เดิมยิงได้ไม่ต้องมีกุญแจ — ใส่ด่าน fail-closed (ไม่ตั้ง env = ปฏิเสธเสมอ) ลบรายใบไม่กระทบ
      const adminKey = process.env.ADMIN_API_KEY;
      const gotKey = request.headers.get('x-admin-key') || '';
      if (!adminKey || gotKey !== adminKey) {
        return NextResponse.json({
          success: false,
          error: adminKey ? 'รหัสยืนยันไม่ถูกต้อง' : 'โหมดล้างทั้งระบบถูกล็อก — ตั้ง ADMIN_API_KEY ใน env ก่อนใช้',
          errorType: 'ADMIN_KEY_REQUIRED',
        }, { status: 403 });
      }
      const result = await store.removeAll();
      return NextResponse.json({ success: true, ...result });
    }

    // ★ 3 ก.ย. 69 (F14): ลบถาวรรายใบเดิมไม่มีด่าน (store.remove ตรง) — เพิ่ม 2 ชั้น: ยืนยันซ้ำด้วย ?confirm=<id>
    //   (client ให้ผู้ใช้พิมพ์ id) + ห้ามลบใบที่เคยถูกใช้ (usageCount > 0 — เคสเก่าอ้าง promptId ให้ "พัก" แทน)
    //   CARD_LIBRARY_V2=0 → ลบตรงแบบเดิมทุกไบต์
    if (isCardLibV2()) {
      if (!id || searchParams.get('confirm') !== id) {
        return NextResponse.json({
          success: false,
          error: 'ลบถาวรต้องยืนยันซ้ำ: ส่ง confirm=<id> ให้ตรงกับ id — ถ้าแค่เลิกใช้ ให้พักการ์ด (PUT action: archive) แทน',
          errorType: 'CONFIRM_REQUIRED',
        }, { status: 400 });
      }
      const target = await store.findById(id);
      if (!target) {
        return NextResponse.json({ success: false, error: `ไม่พบ id: ${id}`, errorType: 'NOT_FOUND' }, { status: 404 });
      }
      if ((target.usageCount || 0) > 0) {
        return NextResponse.json({
          success: false,
          error: `ใบนี้ถูกใช้ไปแล้ว ${target.usageCount} ครั้ง — ลบถาวรไม่ได้ (เคสเก่ายังอ้าง promptId อยู่) ให้พักการ์ดแทน`,
          errorType: 'USAGE_PROTECTED',
        }, { status: 409 });
      }
    }

    const result = await store.remove(id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[Prompt-Library DELETE]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
