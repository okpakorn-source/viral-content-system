/**
 * News Desk API — feed โต๊ะข่าว + ปุ่มทีม (จอง/ทิ้ง/ส่งเข้า workflow)
 * GET  ?tab=all|trend|good&limit=60   → รายการเรียงคะแนน
 * POST { action: 'claim'|'unclaim'|'dismiss'|'sent', id, user }
 *      ทุก action ถูกบันทึกเข้า news-desk-feedback = ข้อมูลสอน "บรรณาธิการ AI"
 */
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'all';
    const limit = Math.min(120, Number(searchParams.get('limit')) || 60);

    const store = createStore('news-desk');
    let items = await store.getAll();

    if (tab === 'trend' || tab === 'good') items = items.filter(i => i.lane === tab);
    items = items.filter(i => i.status !== 'dismissed');
    items.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

    // ส่วนผสมวันนี้ (นับเฉพาะที่ทีมส่งทำจริงวันนี้) — โชว์แถบ mix บนหน้า
    const today = new Date().toISOString().slice(0, 10);
    const sentToday = (await store.getAll()).filter(i => i.status === 'sent' && String(i.sentAt || '').startsWith(today));
    const mix = {};
    for (const s of sentToday) mix[s.category || 'อื่นๆ'] = (mix[s.category || 'อื่นๆ'] || 0) + 1;

    return NextResponse.json({ success: true, items: items.slice(0, limit), total: items.length, mixToday: mix, sentToday: sentToday.length });
  } catch (error) {
    console.error('[NewsDesk API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'DESK_FEED_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { action, id, user = 'ไม่ระบุ' } = await request.json();
    if (!action || !id) {
      return NextResponse.json({ success: false, error: 'ต้องระบุ action และ id', errorType: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const store = createStore('news-desk');
    const all = await store.getAll();
    const item = all.find(i => i.id === id);
    if (!item) {
      return NextResponse.json({ success: false, error: 'ไม่พบข่าวนี้ในคลัง', errorType: 'NOT_FOUND' }, { status: 404 });
    }

    const patch = {};
    if (action === 'claim') {
      if (item.status === 'claimed' && item.claimedBy !== user) {
        return NextResponse.json({ success: false, error: `ข่าวนี้ถูก "${item.claimedBy}" จองแล้ว`, errorType: 'ALREADY_CLAIMED' }, { status: 409 });
      }
      patch.status = 'claimed'; patch.claimedBy = user; patch.claimedAt = new Date().toISOString();
    } else if (action === 'unclaim') {
      patch.status = 'new'; patch.claimedBy = null;
    } else if (action === 'dismiss') {
      patch.status = 'dismissed'; patch.dismissedBy = user;
    } else if (action === 'sent') {
      patch.status = 'sent'; patch.claimedBy = item.claimedBy || user; patch.sentAt = new Date().toISOString();
    } else {
      return NextResponse.json({ success: false, error: `action ไม่รู้จัก: ${action}`, errorType: 'VALIDATION_ERROR' }, { status: 400 });
    }

    await store.update(id, (ex) => ({ ...ex, ...patch }));

    // ★ ทุกการตัดสินใจ = บทเรียนของบรรณาธิการ AI (few-shot ใน deskBrain)
    if (['claim', 'dismiss', 'sent'].includes(action)) {
      try {
        const fb = createStore('news-desk-feedback');
        await fb.add({
          id: `${id}_${action}_${Date.now()}`,
          newsId: id, action: action === 'claim' ? 'claimed' : action === 'sent' ? 'sent' : 'dismissed',
          title: item.title, category: item.category, lane: item.lane, user,
          at: new Date().toISOString(),
        });
      } catch (e) { console.log('[NewsDesk] feedback save failed (non-fatal):', e.message?.slice(0, 40)); }
    }

    return NextResponse.json({ success: true, id, ...patch });
  } catch (error) {
    console.error('[NewsDesk API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'DESK_ACTION_ERROR' }, { status: 500 });
  }
}
