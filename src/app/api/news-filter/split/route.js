export const maxDuration = 60; // 60 วินาที — เพียงพอสำหรับ AI แยกประเด็น
import { NextResponse } from 'next/server';
import { splitTopics } from '@/lib/services/newsFilterService';
import { createStore } from '@/lib/persistStore';
import { randomUUID } from 'crypto';

/**
 * POST /api/news-filter/split
 * แยก "เนื้อแก่นข่าว" ที่สกัดแล้ว ออกเป็นประเด็นย่อย (รัก/เงิน/ครอบครัว/อาชีพ)
 * เพื่อให้พนักงานหยิบส่งเจนทีละประเด็น → โพสต์ที่ชัดเจนประเด็นเดียว
 *
 * Body: { text: string }  — เนื้อแก่นข่าว (cleanText จากการสกัด)
 * Response: { success, data: { isSingleTopic, overview, topics: [{ id, emoji, category, title, summary, content, viralAngle, wordCount }] } }
 */
export async function POST(request) {
  try {
    const { text } = await request.json();
    if (!text || typeof text !== 'string' || text.trim().length < 20) {
      return NextResponse.json(
        { success: false, error: 'เนื้อหาสั้นเกินไป (ต้องมีอย่างน้อย 20 ตัวอักษร)', errorType: 'TEXT_TOO_SHORT' },
        { status: 400 }
      );
    }

    console.log(`[NewsFilter Split API] textLength=${text.length}`);
    const result = await splitTopics(text, {});

    // ★ 19 มิ.ย. (ผู้ใช้): เก็บ "ประวัติการแยกประเด็น" — บางข่าวทำได้หลายหัวข้อ ทีมกลับมาหยิบใช้ได้
    //   fire-and-forget ไม่บล็อก response | เก็บล่าสุด 60 รายการ
    if (result && Array.isArray(result.topics) && result.topics.length > 0) {
      (async () => {
        try {
          const store = createStore('news-filter-splits');
          await store.add({
            id: randomUUID(),
            title: String(text).trim().slice(0, 70),
            sourceText: String(text).slice(0, 8000),
            overview: result.overview || '',
            isSingleTopic: !!result.isSingleTopic,
            topics: result.topics,
            topicCount: result.topics.length,
            createdAt: new Date().toISOString(),
          });
          const all = await store.getAll();
          if (all.length > 60) {
            const old = all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, all.length - 60);
            for (const o of old) await store.remove(o.id).catch(() => {});
          }
        } catch (e) { console.warn('[NewsFilter Split] เก็บประวัติล้ม (ไม่กระทบผล):', e.message?.slice(0, 50)); }
      })();
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[NewsFilter Split API] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'แยกประเด็นไม่สำเร็จ', errorType: 'SPLIT_FAILED' },
      { status: 500 }
    );
  }
}
