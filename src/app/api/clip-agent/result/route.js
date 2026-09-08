import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { authorizeClipAgent } from '@/lib/services/clipAgent/auth';
import { compactResult } from '@/lib/services/clipAgent/compactResult';
import { readRowFresh } from '@/lib/services/clipAgent/storeRead';
import { cleanClipUrl } from '@/lib/services/clipAgent/clipUrl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const denied = authorizeClipAgent(request);
    if (denied) return denied;
    const params = new URL(request.url).searchParams;
    const kind = params.get('kind') ?? 'insight';
    if (!['insight', 'transcript'].includes(kind)) {
      return NextResponse.json({ ok: false, errorType: 'BAD_REQUEST', error: 'kind ต้องเป็น insight หรือ transcript' }, { status: 400 });
    }
    const id = params.get('id');
    const url = params.get('url');
    const notFound = () => NextResponse.json({ ok: false, errorType: 'CASE_NOT_FOUND' }, { status: 404 });
    if (!id && !url) return notFound();
    const store = createStore(kind === 'transcript' ? 'clip-transcripts' : 'clip-insights');
    // ระบุ id = อ่านแถวเดียว (ถูก) · ระบุ URL = ต้องกวาดทั้งคลัง (แพง ~9 MB บน Supabase) เลือกใบปักหมุดก่อน แล้วเรียงใหม่สุด
    //   คลังเก็บ URL ที่ล้างแล้ว (youtu.be/shorts → watch?v= · ตัด fbclid/utm) → เทียบทั้งตัวดิบและตัวล้าง
    const wanted = url ? new Set([url, cleanClipUrl(url)]) : null;
    const record = id ? await readRowFresh(store, id)
      : (await store.getAll({ authoritative: true })).filter(row => wanted.has(row.url)).sort((a, b) =>
        Number(!!b.chosen) - Number(!!a.chosen)
        || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))[0];
    if (!record) return notFound();
    return NextResponse.json({
      ok: true, result: params.get('full') === '1' ? record : compactResult(record, kind),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // log ฝั่งเซิร์ฟเวอร์เฉพาะข้อความ (ไม่มีกุญแจ) ให้ตามรอย 500 ได้
    console.error('[ClipAgent:result]', error?.message || error);
    return NextResponse.json({ ok: false, errorType: 'RESULT_ERROR', error: 'อ่านใบงานในคลังคลิปไม่สำเร็จ กรุณาลองใหม่ภายหลัง' }, { status: 500 });
  }
}
