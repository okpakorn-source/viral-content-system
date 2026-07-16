/**
 * Image Scout API — หาแหล่งภาพประกอบข่าว (ลิงก์ทุกช่องทาง ไม่แคปภาพ)
 * POST { newsId }  → หาจากการ์ดโต๊ะข่าว แล้วเก็บผลไว้บนการ์ด (imageSources)
 * POST { caseId }  → หาจากเคสคลังผลงาน (ถ้าเคสมีป้าย desk.newsId จะเก็บผลบนการ์ดโต๊ะด้วย)
 * POST { title, content } → หาแบบสด ไม่บันทึก
 * ส่ง force: true เพื่อหาใหม่ทับผลเดิม (ปกติมีผลแล้วคืน cache เลย)
 */
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { scoutImages } from '@/lib/services/newsDesk/imageScout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  try {
    const { newsId, caseId, title, content, force = false } = await request.json();

    // ── จากการ์ดโต๊ะข่าว ──
    if (newsId) {
      const store = createStore('news-desk');
      const item = (await store.getAll()).find(i => i.id === newsId);
      if (!item) {
        return NextResponse.json({ success: false, error: 'ไม่พบข่าวนี้ในคลัง', errorType: 'NOT_FOUND' }, { status: 404 });
      }
      if (item.imageSources && !force) {
        return NextResponse.json({ success: true, cached: true, imageSources: item.imageSources });
      }
      const text = item.research?.enrichedSummary || item.fullText || item.snippet || item.title;
      const result = await scoutImages({ title: item.title, content: text });
      await store.update(newsId, (ex) => ({ ...ex, imageSources: result }));
      return NextResponse.json({ success: true, imageSources: result });
    }

    // ── จากเคสคลังผลงาน ──
    if (caseId) {
      const { getCaseDetail } = await import('@/lib/services/generationLogger');
      const c = await getCaseDetail(caseId);
      if (!c) {
        return NextResponse.json({ success: false, error: `ไม่พบเคส #${caseId}`, errorType: 'NOT_FOUND' }, { status: 404 });
      }
      const deskNewsId = c.pipelineInfo?.desk?.newsId || null;
      const store = createStore('news-desk');
      if (deskNewsId && !force) {
        const item = (await store.getAll()).find(i => i.id === deskNewsId);
        if (item?.imageSources) {
          return NextResponse.json({ success: true, cached: true, imageSources: item.imageSources });
        }
      }
      const result = await scoutImages({ title: c.newsTitle, content: c.sourceText || c.newsTitle });
      if (deskNewsId) {
        // เคสนี้มาจากโต๊ะข่าว → แปะผลบนการ์ดโต๊ะด้วย ทีมเห็นจากทั้งสองหน้า
        await store.update(deskNewsId, (ex) => ({ ...ex, imageSources: result })).catch(() => {});
      }
      return NextResponse.json({ success: true, imageSources: result });
    }

    // ── แบบสด ──
    if (title || content) {
      const result = await scoutImages({ title: title || '', content: content || title || '' });
      return NextResponse.json({ success: true, imageSources: result });
    }

    return NextResponse.json({ success: false, error: 'ต้องระบุ newsId หรือ caseId หรือ title/content', errorType: 'VALIDATION_ERROR' }, { status: 400 });
  } catch (error) {
    console.error('[ImageScout API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'IMAGE_SCOUT_ERROR' }, { status: 500 });
  }
}
