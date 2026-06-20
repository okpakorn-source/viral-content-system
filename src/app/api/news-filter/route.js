export const maxDuration = 60; // 60 วินาที — เพียงพอสำหรับ AI classification
import { NextResponse } from 'next/server';
import { filterNews, filterNewsWithAI, extractFactCore } from '@/lib/services/newsFilterService';
import { createStore } from '@/lib/persistStore';
import { randomUUID } from 'crypto';

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
  // ★ 19 มิ.ย. (ผู้ใช้): จัดคิวสกัดข่าว — พนักงานหลายคนยิงพร้อมกัน กันล้น + โชว์สถานะเรียลไทม์
  const _qstore = createStore('news-filter-queue');
  const _jobId = randomUUID();
  let _registered = false;
  const MAX_CONCURRENT = 3;
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

    // ── เข้าคิว: ลงทะเบียน → รอช่องว่าง (ทำพร้อมกันได้ ${MAX_CONCURRENT}) → ตั้งเป็น processing ──
    try {
      const all0 = await _qstore.getAll();
      const cut = Date.now() - 120000; // เก็บกวาดงานค้าง >2 นาที
      for (const j of all0) if (new Date(j.startedAt || j.queuedAt || 0).getTime() < cut) await _qstore.remove(j.id).catch(() => {});
      await _qstore.add({ id: _jobId, status: 'queued', queuedAt: new Date().toISOString() });
      _registered = true;
      const t0 = Date.now();
      while (Date.now() - t0 < 40000) { // รอสูงสุด 40 วิ ถ้านานเกินทำเลย (กันค้าง)
        const all = await _qstore.getAll();
        if (all.filter(j => j.status === 'processing').length < MAX_CONCURRENT) break;
        await new Promise(r => setTimeout(r, 1200));
      }
      await _qstore.update(_jobId, ex => ({ ...ex, status: 'processing', startedAt: new Date().toISOString() }));
    } catch { /* คิวล่ม = ไม่บล็อก ทำต่อเลย */ }

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

    const engine = result.engine || (useAI === 'classify' ? 'ai-classify' : useAI ? 'fact-core' : 'rule-based');

    // ★ คลังเคส (13 มิ.ย. 69): เก็บทุกการสกัด (ต้นฉบับ+แก่น+สิ่งที่ตัด) ไว้ตรวจย้อนว่าตัดใจความสำคัญไปไหม
    //   fire-and-forget ไม่บล็อก response | เก็บล่าสุด 60 เคส
    if (body.save !== false) {
      (async () => {
        try {
          const store = createStore('news-filter-cases');
          await store.add({
            id: randomUUID(),
            original: String(text).slice(0, 8000),
            clean: String(result.cleanText || '').slice(0, 8000),
            mode, engine,
            originalWordCount: result.stats.originalWordCount,
            cleanWordCount: result.stats.cleanWordCount,
            removedPercent: result.stats.removedPercent,
            removedPatterns: (result.removedPatterns || []).slice(0, 12),
            title: String(text).trim().slice(0, 60),
            createdAt: new Date().toISOString(),
          });
          // ตัดให้เหลือ 60 เคสล่าสุด
          const all = await store.getAll();
          if (all.length > 60) {
            const old = all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, all.length - 60);
            for (const o of old) await store.remove(o.id).catch(() => {});
          }
        } catch (e) { console.warn('[NewsFilter] เก็บคลังเคสล้ม (ไม่กระทบผล):', e.message?.slice(0, 50)); }
      })();
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
        engine,
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
  } finally {
    // ออกจากคิวเสมอ (ทั้งสำเร็จ/พลาด) — กันคิวค้าง
    if (_registered) await _qstore.remove(_jobId).catch(() => {});
  }
}
