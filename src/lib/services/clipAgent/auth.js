import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

// ตรวจทุกคำขอก่อนอ่าน body/store และไม่เขียนกุญแจลง log
export function authorizeClipAgent(request) {
  const key = process.env.CLIP_AGENT_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, errorType: 'AGENT_API_DISABLED', error: 'ยังไม่ได้ตั้ง CLIP_AGENT_API_KEY' }, { status: 503 });
  }
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const supplied = request.headers.get('x-clip-agent-key') || bearer || '';
  const expectedBytes = Buffer.from(key);
  const suppliedBytes = Buffer.from(supplied);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return NextResponse.json({ ok: false, errorType: 'UNAUTHORIZED' }, { status: 401 });
  }
  return null;
}
