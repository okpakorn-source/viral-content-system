/**
 * ============================================================
 * 🧲 /api/desk/research/extract — ท่อสกัดเนื้อก่อนเขียน (โต๊ะข่าวกลาง v2, R6 — 17 ก.ค. 69)
 * ============================================================
 * POST action:'extract'        — สกัดเนื้อดิบเต็มของลีด (บทความ/คลิป ตามประเภทแหล่ง) แล้วแนบเข้าลีด
 * POST action:'sendText'       — ส่งลีดที่มีเนื้อสกัดแล้วเข้าคิวเขียนข่าวแบบ "text" (สายที่ระบบเปิดไว้)
 * POST action:'extractAndSend' — 🆕 A1 (17 ก.ค. 69): รวด extract→distill→ส่ง ในคอลเดียว (ปุ่มเดียวจบ/ออโต้หลังล่า)
 * ห้ามแตะ contract ของ /api/clip-transcript/** และ /api/queue/** — ยิงผ่าน service เท่านั้น
 */
import { NextResponse } from 'next/server';
import {
  classifyExtractRoute,
  extractArticle,
  extractClip,
  attachExtract,
  sendLeadAsText,
  extractAndSend,
  getLead,
} from '@/lib/services/deskV2/researchExtract.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 420; // คลิป (โดยเฉพาะ FB/IG ที่รอเครื่องทีม) ช้า — poll เอง 6 นาที + เผื่อ insight เสริม

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const action = body?.action;
    const leadId = body?.leadId;

    if (!leadId) {
      return NextResponse.json({
        success: false,
        error: 'ต้องระบุ leadId',
        errorType: 'RESEARCH_EXTRACT_ERROR',
      }, { status: 400 });
    }

    if (action === 'extract') {
      const lead = await getLead(leadId);
      if (!lead) {
        return NextResponse.json({
          success: false,
          error: `ไม่พบลีด: ${leadId}`,
          errorType: 'RESEARCH_EXTRACT_ERROR',
        }, { status: 404 });
      }

      const route = classifyExtractRoute(lead);
      const origin = request.nextUrl.origin;

      const result = route === 'clip'
        ? await extractClip(lead.url, origin)
        : await extractArticle(lead.url);

      if (result?.pending) {
        return NextResponse.json({ success: true, route, pending: true, jobRef: result.jobRef || null });
      }

      const text = String(result?.text || '');
      if (text.length < 50) {
        return NextResponse.json({
          success: false,
          route,
          error: result?.error ? `สกัดเนื้อไม่สำเร็จ: ${result.error}` : 'สกัดเนื้อไม่สำเร็จ (เนื้อสั้นผิดปกติ) — อาจต้องคัดลอกเนื้อมาวางเอง',
          errorType: 'RESEARCH_EXTRACT_ERROR',
        }, { status: 422 });
      }

      const saved = await attachExtract(leadId, result);
      const insightTopics = [
        saved.extract?.insight?.headline,
        saved.extract?.insight?.overview,
        saved.extract?.insight?.category,
      ].filter(Boolean);

      // 🆕 D1 (17 ก.ค. 69): แจ้งผลกลั่นเนื้อกลับให้ UI โชว์ก่อนส่ง (โครงเดิมคงไว้ครบ — เพิ่ม field ใหม่เท่านั้น)
      const distilled = !!saved.extract?.distilled;
      const cleanLength = String(saved.extract?.text || '').length;
      const rawLength = String(saved.extract?.raw ?? text).length;

      return NextResponse.json({
        success: true,
        route,
        textLength: text.length,
        distilled,
        cleanLength,
        rawLength,
        insightTopics: insightTopics.length ? insightTopics : undefined,
        source: result.source || '',
      });
    }

    if (action === 'sendText') {
      const origin = request.nextUrl.origin;
      const result = await sendLeadAsText(leadId, { origin });
      return NextResponse.json(result);
    }

    // 🆕 A1 (17 ก.ค. 69): ปุ่มเดียวจบ/ออโต้หลังล่า — extractAndSend รวด extract→distill→ส่ง
    if (action === 'extractAndSend') {
      const origin = request.nextUrl.origin;
      const auto = !!body?.auto;
      const result = await extractAndSend(leadId, { origin, auto });
      return NextResponse.json(result);
    }

    return NextResponse.json({
      success: false,
      error: `action ไม่รู้จัก: ${action}`,
      errorType: 'RESEARCH_EXTRACT_ERROR',
    }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error?.message || 'สกัดเนื้อล้มเหลว',
      errorType: 'RESEARCH_EXTRACT_ERROR',
    }, { status: 500 });
  }
}
