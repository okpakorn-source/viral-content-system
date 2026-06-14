export const maxDuration = 60; // 60 วินาที — เพียงพอสำหรับ AI classification
import { NextResponse } from 'next/server';
import { filterNews, filterNewsWithAI, extractFactCore } from '@/lib/services/newsFilterService';

/**
 * POST /api/news-filter
 * 
 * กรองเนื้อข่าวให้เหลือแต่แก่น — ตัดคำฟุ่มเฟือย / อารมณ์เกิน / ตีความ
 * 
 * Body:
 *   text: string               — เนื้อข่าวต้นฉบับ
 *   mode: 'soft'|'balanced'|'strict' — โหมดกรอง (default: 'balanced')
 *   useAI: boolean             — ใช้ AI วิเคราะห์ (default: false → rule-based)
 *   options: {
 *     keepQuotes: boolean       — เก็บคำพูด/คำให้สัมภาษณ์ (default: true)
 *     keepContext: boolean      — เก็บบริบท/ข้อมูลพื้นหลัง (default: true)
 *     removeEmotional: boolean  — ลบประโยคเร้าอารมณ์ (default: false)
 *     removeInterpretation: boolean — ลบประโยคตีความ (default: false)
 *   }
 * 
 * Response:
 *   { success: true, data: { cleanText, originalWordCount, cleanWordCount, removedPercent, sentenceAnalysis, removedPatterns } }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { text, mode = 'balanced', options = {} } = body;
    // ★ อ่าน useAI จาก top-level ก่อน แล้ว fallback ไป options.useAI (กันหน้าเว็บเวอร์ชันเก่าที่ส่งใน options)
    const useAI = body.useAI ?? options.useAI ?? false;

    // ตรวจสอบ input
    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'กรุณาส่งเนื้อข่าวที่ต้องการกรอง (text)',
          errorType: 'MISSING_TEXT_INPUT',
        },
        { status: 400 }
      );
    }

    if (text.trim().length < 10) {
      return NextResponse.json(
        {
          success: false,
          error: 'เนื้อข่าวสั้นเกินไป (ต้องมีอย่างน้อย 10 ตัวอักษร)',
          errorType: 'TEXT_TOO_SHORT',
        },
        { status: 400 }
      );
    }

    // ตรวจสอบ mode ที่รองรับ
    const validModes = ['soft', 'balanced', 'strict'];
    if (!validModes.includes(mode)) {
      return NextResponse.json(
        {
          success: false,
          error: `โหมดไม่ถูกต้อง ต้องเป็น: ${validModes.join(', ')}`,
          errorType: 'INVALID_MODE',
        },
        { status: 400 }
      );
    }

    // รวม options กับ mode
    const filterOptions = {
      mode,
      keepQuotes: options.keepQuotes ?? true,
      keepContext: options.keepContext ?? true,
      removeEmotional: options.removeEmotional ?? false,
      removeInterpretation: options.removeInterpretation ?? false,
    };

    console.log(`[NewsFilter API] mode=${mode}, useAI=${useAI}, textLength=${text.length}`);

    // เรียกระบบกรอง — 3 เครื่อง:
    //   useAI=true (ค่าเริ่มต้นใหม่ 13 มิ.ย.) → extractFactCore: AI เขียนใหม่เหลือข้อเท็จจริงดิบ (ตรงเป้าทีม)
    //   useAI='classify' → filterNewsWithAI: จำแนกประโยคทีละอัน (เก่า เก็บไว้เป็นทางเลือก)
    //   useAI=false → filterNews: regex เร็ว/ออฟไลน์ (fallback)
    let result;
    if (useAI === 'classify') {
      result = await filterNewsWithAI(text, filterOptions);
    } else if (useAI) {
      result = await extractFactCore(text, filterOptions);
    } else {
      result = filterNews(text, filterOptions);
    }

    // จัด response format
    return NextResponse.json({
      success: true,
      data: {
        cleanText: result.cleanText,
        originalWordCount: result.stats.originalWordCount,
        cleanWordCount: result.stats.cleanWordCount,
        removedPercent: result.stats.removedPercent,
        sentenceCount: result.stats.sentenceCount,
        removedCount: result.stats.removedCount,
        trimmedCount: result.stats.trimmedCount,
        sentenceAnalysis: result.sentenceAnalysis,
        removedPatterns: result.removedPatterns,
        engine: result.engine || (useAI === 'classify' ? 'ai-classify' : useAI ? 'fact-core' : 'rule-based'),
        mode,
        useAI,
      },
    });

  } catch (error) {
    console.error('[NewsFilter API] Error:', error);

    // แยก error type ตามประเภท
    const isAIError = error.message?.includes('API') || error.message?.includes('AI');
    const errorType = isAIError ? 'AI_PROCESSING_FAILED' : 'NEWS_FILTER_ERROR';

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'เกิดข้อผิดพลาดในการกรองข่าว',
        errorType,
      },
      { status: 500 }
    );
  }
}
