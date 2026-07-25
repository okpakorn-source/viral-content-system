import { NextResponse } from 'next/server';
import { getPrompts, savePrompt, resetPrompt, resetAllPrompts, getAnalysisPresets, saveAnalysisPreset, deleteAnalysisPreset, resetAnalysisPresets } from '@/lib/ai/promptStore';
import { savePrompt as saveTextPrompt, resetPrompt as resetTextPrompt, resetAllPrompts as resetAllTextPrompts } from '@/lib/ai/promptStoreText';

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      data: getPrompts(),
      analysisPresets: getAnalysisPresets(),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'PROMPT_FETCH_FAILED' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    // Save analysis preset
    if (body.type === 'analysisPreset') {
      saveAnalysisPreset(body.preset);
      return NextResponse.json({ success: true, analysisPresets: getAnalysisPresets() });
    }

    // Save standard prompt
    // ★ 25 ก.ค. 69 — แก้ 3 บั๊กที่ตรวจเจอ:
    //   (1) เดิมรับ prompt ว่างได้ → บัง built-in จนระบบวิ่งด้วยคำสั่งเปล่าโดยไม่มี error
    //   (2) key ไม่ trim → ส่ง " extraction " มาแล้วสร้างคีย์ใหม่ที่ไม่มีใครอ่าน
    //   (3) แก้แค่คลังฝั่งเว็บ ขณะที่ "สายคิว" (ท่อผลิตข่าวจริง) อ่านอีกคลังหนึ่ง → แก้แล้วเหมือนไม่มีผล
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    const prompt = body.prompt;
    if (!key) {
      return NextResponse.json({ success: false, error: 'ไม่ได้ระบุชื่อพร้อมท์ (key)', errorType: 'INVALID_PROMPT_KEY' }, { status: 400 });
    }
    const res = savePrompt(key, prompt);
    if (!res?.ok) {
      return NextResponse.json({ success: false, error: res?.error || 'บันทึกไม่สำเร็จ', errorType: 'EMPTY_PROMPT' }, { status: 400 });
    }
    // มิเรอร์ไปคลังของสายคิวด้วย เพื่อให้ "แก้แล้วมีผลกับท่อผลิตข่าวจริง"
    let mirrored = false;
    try {
      const resText = saveTextPrompt(key, prompt);
      mirrored = !!resText?.ok;
    } catch { /* คีย์ไม่มีในคลังสายคิว = ข้ามไป */ }

    return NextResponse.json({
      success: true,
      data: getPrompts()[key],
      persisted: res.persisted,        // true = เขียนลงไฟล์แล้ว (อยู่ถาวรแม้รีสตาร์ท)
      mirroredToQueueStore: mirrored,  // true = สายคิว (ท่อผลิตข่าวจริง) ใช้ค่าใหม่ด้วย
      ...(res.persisted ? {} : { warning: 'บันทึกได้เฉพาะในหน่วยความจำ (ระบบไฟล์เขียนไม่ได้) — จะหายเมื่อรีสตาร์ท' }),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();

    // Delete analysis preset
    if (body.type === 'analysisPreset' && body.id) {
      deleteAnalysisPreset(body.id);
      return NextResponse.json({ success: true, analysisPresets: getAnalysisPresets() });
    }

    // Reset analysis presets
    if (body.type === 'resetAnalysisPresets') {
      resetAnalysisPresets();
      return NextResponse.json({ success: true, analysisPresets: getAnalysisPresets() });
    }

    // Reset standard prompt — ★ 25 ก.ค. 69: คืนค่าทั้งสองคลังให้ตรงกัน (เดิมคืนแค่ฝั่งเว็บ)
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (key) {
      resetPrompt(key);
      try { resetTextPrompt(key); } catch {}
    } else {
      resetAllPrompts();
      try { resetAllTextPrompts(); } catch {}
    }
    return NextResponse.json({ success: true, data: getPrompts() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
