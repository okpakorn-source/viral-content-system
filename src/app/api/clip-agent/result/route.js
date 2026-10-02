import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { authorizeClipAgent } from '@/lib/services/clipAgent/auth';
import { compactResult } from '@/lib/services/clipAgent/compactResult';
import { readRowFresh } from '@/lib/services/clipAgent/storeRead';
import { cleanClipUrl, extractFirstUrl } from '@/lib/services/clipAgent/clipUrl'; // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F6): ค้นด้วยลิงก์ห่อ/ซ้อน

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
    // ★ 30 ก.ย. 69 (เคสล่ม pepedog89) รอบ 4 (F6): คิว/route ถอดเก็บ record.url = cleanClipUrl(extractFirstUrl(ลิงก์ที่วาง))
    //   ลิงก์ซ้อน 2 รอบ · ลิงก์ห่อ l.facebook.com/l.php?u=… · ลิงก์มีข้อความปน ถูกแกะก่อนเก็บ → เอเจนต์ค้นด้วยลิงก์เดิมที่ส่งไปหาไม่เจอ
    //   เทียบตัวที่ผ่านขั้นเดียวกันด้วย (ไม่มีลิงก์ http(s) ในข้อความ = ใช้ข้อความเดิมล้างตามเดิม)
    const wanted = url ? new Set([url, cleanClipUrl(url), cleanClipUrl(extractFirstUrl(url) || url)]) : null;
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
