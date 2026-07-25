import { NextResponse } from 'next/server';
import { extractContent } from '@/lib/scraper/index.js';

/**
 * POST /api/extract — ดึงเนื้อหาจาก URL (preview ก่อนวิเคราะห์)
 *
 * ★ 25 ก.ค. 69 — ปิดช่องที่ตรวจเจอ: ด่าน TEXT_ONLY_MODE เดิมมีแค่ 4 ประตูอัตโนมัติ
 *   (queue/add, auto, auto/process, auto/stream) แต่ "ปุ่มดึงเนื้อหา" บนหน้า /content/new
 *   ยิงตรงมาที่นี่แล้วทำข่าวจากลิงก์ได้ครบวงจร = ทะลุคำสั่งปิดรับข่าวจากลิงก์ของเจ้าของ
 *
 *   วิธีกัน: ปิดเฉพาะคำขอที่มาจาก "เบราว์เซอร์" (มี origin/referer) เท่านั้น
 *   ส่วนการเรียกภายในของเซิร์ฟเวอร์เอง (firecrawlProvider / apifyProvider / megaAdapters — สายทำปก)
 *   ไม่มี origin/referer จึงยังทำงานปกติ ไม่พังของเดิม
 *   ปิดด่านนี้ทิ้งได้ด้วย env EXTRACT_TEXT_ONLY_GATE=0
 */
export async function POST(request) {
  try {
    const { url, type, rawContent } = await request.json();

    if (!url && !rawContent) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ URL หรือข้อความ', errorType: 'MISSING_INPUT' },
        { status: 400 }
      );
    }

    const fromBrowser = !!(request.headers.get('origin') || request.headers.get('referer'));
    const gateOn = process.env.TEXT_ONLY_MODE !== '0' && process.env.EXTRACT_TEXT_ONLY_GATE !== '0';
    if (url && fromBrowser && gateOn) {
      return NextResponse.json({
        success: false,
        error: 'โหมดข้อความเท่านั้น: ระบบปิดรับการทำข่าวจากลิงก์ชั่วคราว — กรุณาคัดลอกเนื้อข่าวเป็นข้อความล้วนมาวางแทน',
        errorType: 'TEXT_ONLY_MODE',
      }, { status: 400 });
    }

    const result = await extractContent({ url, type, rawContent });

    return NextResponse.json({
      success: result.success,
      data: result,
      ...(result.success ? {} : { errorType: 'EXTRACT_FAILED' }),
    });
  } catch (error) {
    console.error('Extract API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'EXTRACT_ERROR' },
      { status: 500 }
    );
  }
}
