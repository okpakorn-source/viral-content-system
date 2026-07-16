/**
 * 🔥🧊 Feedback API — รับคลิกรายงานผลโพสต์จากลิงก์ Discord (2 ก.ค. 69)
 * GET ?id=<newsId>&a=viral|flop&k=<hmac> → บันทึก performance + feedback (ลูปเรียนรู้ บก.AI)
 * ตอบเป็น HTML สั้นๆ (คนคลิกจาก Discord เห็นผลทันที ปิดแท็บได้เลย)
 * 🔴 ใช้เฉพาะโต๊ะข่าวกลาง — เขียน store เดียวกับปุ่ม viral/flop บนเว็บ (news-desk + news-desk-feedback)
 */
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { verifyFeedback } from '@/lib/services/newsDesk/feedbackLink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const page = (emoji, title, detail, ok = true) => new NextResponse(
  `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center;padding:32px;max-width:480px">
<div style="font-size:64px">${emoji}</div>
<h2 style="margin:12px 0 6px">${title}</h2>
<p style="color:#94a3b8;font-size:14px;line-height:1.6">${detail}</p>
<p style="color:#64748b;font-size:12px">ปิดแท็บนี้ได้เลย — ระบบบันทึกเข้าสมองคัดข่าวแล้ว</p>
</div></body></html>`,
  { status: ok ? 200 : 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const action = searchParams.get('a');
    const key = searchParams.get('k');

    if (!['viral', 'flop'].includes(action) || !verifyFeedback(id, action, key)) {
      return page('🚫', 'ลิงก์ไม่ถูกต้อง', 'ลิงก์หมดอายุหรือถูกแก้ไข — ใช้ลิงก์จากข้อความ Discord เท่านั้น', false);
    }

    const store = createStore('news-desk');
    const item = (await store.getAll()).find(i => i.id === id);
    const title = item ? String(item.title).slice(0, 90) : id;

    // บันทึกลง item (ถ้ายังอยู่บนโต๊ะ) — กดซ้ำ = เปลี่ยนคำตอบล่าสุด (แก้กดผิดได้)
    if (item) {
      await store.update(id, (ex) => ({ ...ex, performance: action, performanceAt: new Date().toISOString(), performanceBy: 'discord' })).catch(() => {});
    }
    // บันทึกลง feedback store (ลูปเรียนรู้: น้ำหนักหมวด + few-shot บก.AI อ่านจากที่นี่)
    try {
      const fb = createStore('news-desk-feedback');
      await fb.add({
        id: `${id}_${action}_${Date.now()}`,
        newsId: id, action,
        title: item?.title || '', category: item?.category || '', lane: item?.lane || '',
        user: 'discord-click', at: new Date().toISOString(),
      });
    } catch (e) { console.log('[Feedback] fb save failed:', e.message?.slice(0, 40)); }

    // ★ 2 ก.ค.: โพสต์ปังจริง → ดึงชื่อคนเข้า Living Watchlist (น้ำหนัก 3) — ระบบจะเกาะคนนี้ในรอบหาข่าวถัดๆ ไป
    if (action === 'viral' && item?.title) {
      try {
        const { addFromTitle } = await import('@/lib/services/newsDesk/watchlistService');
        await Promise.race([addFromTitle(item.title, 'viral'), new Promise(r => setTimeout(r, 6000))]);
      } catch (e) { console.log('[Feedback] watchlist skip:', e.message?.slice(0, 40)); }
    }

    console.log(`[Feedback] ${action === 'viral' ? '🔥' : '🧊'} discord-click: ${title}`);
    return action === 'viral'
      ? page('🔥', 'บันทึกแล้ว: โพสต์นี้ปัง!', `"${title}" — บก.AI จะล่าข่าวแนวนี้มากขึ้น`)
      : page('🧊', 'บันทึกแล้ว: โพสต์นี้แป้ก', `"${title}" — บก.AI จะลดน้ำหนักแนวนี้ลง`);
  } catch (error) {
    console.error('[Feedback API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'FEEDBACK_ERROR' }, { status: 500 });
  }
}
