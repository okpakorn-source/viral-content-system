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
// ★ DNA v3.1 (12 มิ.ย. 69 — ทีมขอยืดหยุ่น): ด่านขาเข้าเป็น "ผู้ช่วยติดหมายเหตุ" ไม่ใช่ผู้พิพากษา
//   บล็อกเฉพาะ harm (โจมตี/ทำให้คนเสียหาย/ชวนทัวร์ลง) — เทคนิคอ้อมๆ ของทีมรับเข้าพร้อม screenNote ⚠️
//   ความเข้มจริงอยู่ขาออก: พร้อมท์ที่สร้างยังถูกคัด 6 เกณฑ์เต็มก่อนบันทึกเสมอ
export async function POST(request) {
  try {
    const body = await request.json();
    const contents = Array.isArray(body.contents) ? body.contents : [body];
    const { screenContent, VERDICT_LABELS } = await import('@/lib/services/contentScreen');

    const accepted = [];
    const rejected = [];
    for (const c of contents) {
      const text = String(c.content || '');
      if (text.length < 50) { rejected.push({ title: c.title || text.slice(0, 30), reason: 'เนื้อสั้นเกินไป' }); continue; }
      const screen = await screenContent(text, 'content');
      if (screen.hardFail) {
        rejected.push({
          title: c.title || text.slice(0, 30),
          reason: `${VERDICT_LABELS[screen.verdict] || screen.verdict}: ${screen.why}${screen.offending ? ` — "${screen.offending}"` : ''}`,
        });
        continue;
      }
      let screenNote = 'ผ่านด่านคัด 6 เกณฑ์';
      if (screen.needsReview) screenNote = 'ตรวจอัตโนมัติไม่สำเร็จ — ควรตรวจมือ';
      else if (!screen.pass) screenNote = `⚠️ ข้อสังเกต (${VERDICT_LABELS[screen.verdict] || screen.verdict}): ${screen.why}`;
      accepted.push({
        id: randomUUID(),
        title: c.title || '',
        content: text,
        source: c.source || '',
        platform: c.platform || 'other',
        engagement: c.engagement || {},
        status: 'raw',
        analysis: null,
        generatedPrompt: null,
        tags: c.tags || [],
        screenNote,
        createdAt: new Date().toISOString(),
      });
    }

    if (accepted.length > 0) await store.addMany(accepted);
    const total = await store.count();

    if (accepted.length === 0) {
      return NextResponse.json({
        success: false,
        error: `❌ ไม่ผ่านด่านคัดทั้งหมด: ${rejected.map(r => r.reason).join(' | ').slice(0, 300)}`,
        errorType: 'SCREEN_REJECTED',
        rejected,
      }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      added: accepted.length,
      ids: accepted.map(i => i.id),
      rejected,
      message: rejected.length > 0 ? `รับ ${accepted.length} / ปัดตก ${rejected.length}: ${rejected.map(r => r.reason).join(' | ').slice(0, 200)}` : undefined,
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

    // ★ DNA v3: เนื้อที่วิเคราะห์แล้ว (ผ่านด่านคัดตอนเข้ามาแล้ว) → sync เข้า viral_examples ด้วย
    //   เพื่อให้ "few-shot ของนักเขียน" (viralFewshot) ได้ตัวอย่างสะอาดชุดเดียวกัน — หอสมุดเดียว สองระบบใช้ร่วม
    if (body.analysis && item?.content) {
      try {
        const { getSupabase } = await import('@/lib/supabase');
        const sb = getSupabase();
        if (sb) {
          await sb.from('viral_examples').insert({
            category: body.analysis.dna_type || body.analysis.category || 'อื่นๆ',
            title: item.title || String(item.content).slice(0, 80),
            content: item.content,
            source_url: item.source || null,
            writing_notes: body.analysis.why_viral || null,
          });
          console.log('[Viral-Library] ✅ sync เข้า viral_examples (few-shot นักเขียน)');
        }
      } catch (syncErr) {
        console.warn('[Viral-Library] sync viral_examples ล้ม (ไม่กระทบหลัก):', syncErr.message?.slice(0, 50));
      }
    }

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
