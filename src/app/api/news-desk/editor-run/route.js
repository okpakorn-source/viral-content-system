/**
 * News Desk — สั่ง บก.รายฝ่ายทำทันที (ไม่ต้องรอรอบ 30 นาที)
 * POST { editor: 'good' | 'drama' | 'interview' }
 */
import { NextResponse } from 'next/server';
import { deskPipelineOff, deskOffPayload } from '@/lib/deskPipelineGate'; // 🛑 31 ก.ค. 69: สวิตช์ปิดโต๊ะข่าวชั่วคราว (เจ้าของสั่ง)
import { runEditorNow, runAllEditors } from '@/lib/services/newsDesk/harvester';
import { SPECIALIST_EDITORS } from '@/lib/services/newsDesk/deskBrain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

let _lock = Promise.resolve();

export async function POST(request) {
  // 🛑 31 ก.ค. 69 (เจ้าของสั่งปิดโต๊ะข่าวชั่วคราว ไม่ให้กินโทเคน) — จุดนี้เผาเงินจริง (LLM/Serper/คิวเขียน) · เปิดคืน: DESK_PIPELINE=1
  if (deskPipelineOff()) return NextResponse.json(deskOffPayload(), { status: 503 });
  const prev = _lock;
  let release;
  _lock = new Promise((r) => (release = r));
  await prev;
  try {
    const { editor, mode } = await request.json();
    // ★ 28 มิ.ย.: รับ บก ทุกแนว (good|drama|interview|celeb|citizen) + 'all' (สั่งทุก บก ไล่เก็บรอบเดียว)
    const validEditors = Object.keys(SPECIALIST_EDITORS);
    if (editor !== 'all' && !validEditors.includes(editor)) {
      return NextResponse.json({ success: false, error: `editor ต้องเป็น all | ${validEditors.join(' | ')}`, errorType: 'VALIDATION_ERROR' }, { status: 400 });
    }
    // ★ default = 'select' (คัดเข้าคลัง ยังไม่เจน) · 'generate' = เลือกส่งเจนเลย (โหมดเดิม)
    const runMode = mode === 'generate' ? 'generate' : 'select';
    const result = editor === 'all' ? await runAllEditors(runMode) : await runEditorNow(editor, runMode);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[EditorRun]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'EDITOR_RUN_ERROR' }, { status: 500 });
  } finally {
    release();
  }
}
