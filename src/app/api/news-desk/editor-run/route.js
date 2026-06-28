/**
 * News Desk — สั่ง บก.รายฝ่ายทำทันที (ไม่ต้องรอรอบ 30 นาที)
 * POST { editor: 'good' | 'drama' | 'interview' }
 */
import { NextResponse } from 'next/server';
import { runEditorNow } from '@/lib/services/newsDesk/harvester';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

let _lock = Promise.resolve();

export async function POST(request) {
  const prev = _lock;
  let release;
  _lock = new Promise((r) => (release = r));
  await prev;
  try {
    const { editor, mode } = await request.json();
    if (!['good', 'drama', 'interview'].includes(editor)) {
      return NextResponse.json({ success: false, error: 'editor ต้องเป็น good | drama | interview', errorType: 'VALIDATION_ERROR' }, { status: 400 });
    }
    // ★ 28 มิ.ย.: default = 'select' (คัดเข้าคลัง ยังไม่เจน) · 'generate' = เลือกส่งเจนเลย (โหมดเดิม)
    const runMode = mode === 'generate' ? 'generate' : 'select';
    const result = await runEditorNow(editor, runMode);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[EditorRun]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'EDITOR_RUN_ERROR' }, { status: 500 });
  } finally {
    release();
  }
}
