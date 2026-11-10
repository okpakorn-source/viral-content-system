/**
 * GET /api/news-studio/exemplar-image?id=a01 — ภาพปกต้นแบบ (ไฟล์อยู่ใน data/angle-exemplars/images ไม่ได้อยู่ใน public/)
 * ส่งไฟล์ต้นฉบับตรงๆ ไม่แปลง ไม่ย่อ ไม่ผ่านโมเดลใดๆ
 */
import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { exemplarImageFile } from '@/lib/services/newsStudio/server';
import { studioSession, unauthorized, serviceError } from '@/lib/services/newsStudio/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    if (!(await studioSession())) return unauthorized();
    const file = exemplarImageFile(request.nextUrl.searchParams.get('id'));
    const buffer = await readFile(file);
    return new NextResponse(buffer, {
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(buffer.length), 'Cache-Control': 'private, max-age=86400' },
    });
  } catch (e) {
    return serviceError(e, 'EXEMPLAR_IMAGE_FAILED');
  }
}
