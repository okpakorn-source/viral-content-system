import { NextResponse } from 'next/server';
import { authorizeClipAgent } from '@/lib/services/clipAgent/auth';
import { submitClipJob } from '@/lib/services/clipJobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const denied = authorizeClipAgent(request);
    if (denied) return denied;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || (body.kind !== undefined && !['insight', 'transcript'].includes(body.kind))
      || (body.force !== undefined && typeof body.force !== 'boolean')
      || (body.user !== undefined && typeof body.user !== 'string')) {
      return NextResponse.json({ ok: false, errorType: 'BAD_REQUEST', error: 'ข้อมูลไม่ถูกต้อง — ระบุ kind, force และ user ตามรูปแบบ API' }, { status: 400 });
    }
    // ไม่เปิด model/tidy ผ่าน API นี้ และ force ต้องเป็น boolean จริงเพื่อกันถอดใหม่โดยไม่ตั้งใจ
    const { url, kind = 'insight', force = false, user = 'codex-agent' } = body;
    const { jobId, status, position, platform, dup } = await submitClipJob({ url, kind, force, user }, { strictUrl: true });
    return NextResponse.json({
      ok: true, jobId, status, position, platform, dup,
      statusUrl: `/api/clip-agent/status?id=${encodeURIComponent(jobId)}`,
    }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // ★ log ฝั่งเซิร์ฟเวอร์เฉพาะข้อความ (ไม่มีกุญแจ/ข้อมูลผู้ใช้) ให้ตามรอย 500 ได้
    if (!(error.status === 400)) console.error('[ClipAgent:submit]', error?.message || error);
    if (error.status === 400 && ['BAD_URL', 'UNSUPPORTED_PLATFORM'].includes(error.errorType)) {
      return NextResponse.json({ ok: false, errorType: error.errorType, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, errorType: 'SUBMIT_ERROR', error: 'ส่งงานเข้าคิวคลิปไม่สำเร็จ กรุณาลองใหม่ภายหลัง' }, { status: 500 });
  }
}
