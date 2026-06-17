/**
 * ★ แตกประเด็นแบบแมนนวล (17 มิ.ย. 69) — วาง "ข้อความข่าว" หรือ "ลิงก์ข่าวต้นทาง" เข้ามาเอง
 *   ใช้สายพานเดียวกับโต๊ะข่าว: สกัดเนื้อ → ตัดขยะ(ด่านคำต้องห้าม) → จัดหมวด/วัดดราม่า → แตกประเด็นเป็นเนื้อหาดิบ
 *   ★ ใช้ฟังก์ชันที่มีอยู่ (extractContent/gateKeywords/classifyBatch/reframeNews) — ไม่แตะ pipeline เจนข่าวอัตโนมัติ
 */
import { NextResponse } from 'next/server';
import { extractContent } from '@/lib/scraper';
import { gateKeywords, classifyBatch } from '@/lib/services/newsDesk/deskBrain';
import { reframeNews } from '@/lib/services/newsDesk/reframeEngine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = String(body.input || '').trim();
    if (input.length < 10) {
      return NextResponse.json({ success: false, error: 'กรอกข้อความข่าว หรือวางลิงก์ข่าวต้นทาง (อย่างน้อย 10 ตัวอักษร)', errorType: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const isUrl = /^https?:\/\/\S+$/i.test(input);

    // ── 1) สกัดเนื้อข่าว (ลิงก์ → scrape, ข้อความ → ใช้ตรงๆ) ──
    let title = '', text = '', sourceUrl = '';
    if (isUrl) {
      const ex = await extractContent({ url: input });
      if (!ex || ex.success === false || !ex.text || ex.text.trim().length < 40) {
        return NextResponse.json({ success: false, error: 'สกัดเนื้อข่าวจากลิงก์ไม่ได้ (เพจอาจบล็อก/เป็นวิดีโอ) — ลองวางเป็นข้อความข่าวแทน', errorType: 'EXTRACT_FAILED' }, { status: 422 });
      }
      title = String(ex.title || '').replace(/\.\.\.$/, '').slice(0, 160) || ex.text.slice(0, 80);
      text = String(ex.text).trim();
      sourceUrl = input;
    } else {
      text = input;
      title = (text.split(/\n|[.!?。]/)[0] || '').trim().slice(0, 140) || 'ข่าวจากข้อความ';
    }

    const item = { title, snippet: text.slice(0, 4000), url: sourceUrl, source: isUrl ? (() => { try { return new URL(sourceUrl).hostname; } catch { return ''; } })() : 'วางข้อความเอง' };

    // ── 2) ตัดขยะ: ด่านคำต้องห้าม/นอกแบรนด์ (แบบเดียวกับโต๊ะข่าว) ──
    //   โหมดแมนนวล = ผู้ใช้เลือกเอง → คำต้องห้ามจริง(รุนแรง/พนัน/ยา/สถาบันลบ) บล็อก, นอกแบรนด์แค่เตือน
    const g = gateKeywords(item);
    const HARD_REASON = /คำต้องห้าม|สถาบัน|ต่างประเทศ|ภาษาไทย/;
    if (!g.pass && HARD_REASON.test(g.reason || '')) {
      return NextResponse.json({ success: false, error: `ด่านตัดขยะบล็อก: ${g.reason}`, errorType: 'GATE_BLOCKED', gate: g }, { status: 422 });
    }

    // ── 3) จัดหมวด + วัดดราม่า/พิษ (เกณฑ์เดียวกับโต๊ะข่าว) ──
    let classified = item;
    try { const [c] = await classifyBatch([item]); if (c) classified = { ...item, ...c }; } catch {}

    // ── 4) แตกประเด็นเป็นเนื้อหาดิบ (เก็บคลังอัตโนมัติ mode=manual) ──
    const r = await reframeNews(classified, { mode: 'manual' });
    if (!r.ok) {
      return NextResponse.json({ success: false, error: r.reason, errorType: 'REFRAME_FAILED', extracted: { title, isUrl, sourceUrl }, classify: pickClassify(classified), gate: g }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      extracted: { title, snippet: text.slice(0, 600), isUrl, sourceUrl, chars: text.length },
      gate: g,
      classify: pickClassify(classified),
      reframe: r,
    });
  } catch (error) {
    console.error('[ReframeManual]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'REFRAME_MANUAL_ERROR' }, { status: 500 });
  }
}

function pickClassify(c) {
  return { category: c.category || '', dramaType: c.dramaType || '', toxicity: c.toxicity ?? null, tone: c.tone || '', subject: c.subject || '', toneable: c.toneable };
}
