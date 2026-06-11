/**
 * News Desk API — feed โต๊ะข่าว + ปุ่มทีม (จอง/ทิ้ง/ส่งเข้า workflow)
 * GET  ?tab=all|trend|good&limit=60   → รายการเรียงคะแนน
 * POST { action: 'claim'|'unclaim'|'dismiss'|'sent', id, user }
 *      ทุก action ถูกบันทึกเข้า news-desk-feedback = ข้อมูลสอน "บรรณาธิการ AI"
 */
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { applyMixGovernor } from '@/lib/services/newsDesk/deskBrain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'all';
    const limit = Math.min(120, Number(searchParams.get('limit')) || 60);

    const store = createStore('news-desk');
    let items = await store.getAll();

    if (['trend', 'good', 'evergreen', 'interview', 'followup', 'buzz'].includes(tab)) items = items.filter(i => i.lane === tab);
    // ★ แท็บ ✅ พร้อมใช้: ผลงานที่ส่งเจนแล้ว (คนมาหยิบเนื้อไปทำโพสต์/ปก) — เรียงใหม่สุดก่อน
    if (tab === 'ready') {
      items = items.filter(i => i.status === 'sent' && !i.used);
      items.sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
      const lightReady = items.slice(0, limit).map(({ fullText, ...rest }) => rest);
      return NextResponse.json({ success: true, items: lightReady, total: items.length, tab: 'ready' });
    }
    items = items.filter(i => i.status !== 'dismissed');

    // ★ quick-fix: คะแนนเสื่อมตามอายุ — กระแสเก่าจมเอง (trend -8/วัน, good -3/วัน, เลนไร้กาลเวลาไม่เสื่อม)
    const DECAY = { trend: 8, good: 3, evergreen: 0, followup: 4, interview: 0, buzz: 10 }; // buzz แชร์จริงแต่หมดอายุไว
    items = items.map(i => {
      const ageDays = Math.max(0, (Date.now() - new Date(i.harvestedAt || 0).getTime()) / 864e5);
      const decayed = Math.max(0, Math.round((i.finalScore || 0) - ageDays * (DECAY[i.lane] ?? 4)));
      return { ...i, finalScore: decayed };
    });

    // ส่วนผสมวันนี้ (นับเฉพาะที่ทีมส่งทำจริงวันนี้)
    const today = new Date().toISOString().slice(0, 10);
    const sentToday = (await store.getAll()).filter(i => i.status === 'sent' && String(i.sentAt || '').startsWith(today));
    const mix = {};
    for (const s of sentToday) mix[s.category || 'อื่นๆ'] = (mix[s.category || 'อื่นๆ'] || 0) + 1;

    // ★ Mix Governor (เฟส 2): เรียง feed ตามโควตาที่เหลือของวัน — เกินเพดานดราม่าแล้วการ์ดดราม่าจม น้ำดีลอย
    const { items: governed, governor } = applyMixGovernor(items, mix);

    // fullText (บทถอดเสียงคลิป) ยาว — ไม่ส่งให้หน้า feed
    const lightItems = governed.slice(0, limit).map(({ fullText, ...rest }) => rest);

    // ★ brief ล่าสุดจาก บก.ใหญ่ AI
    let chiefBrief = null;
    try {
      const settings = createStore('desk-settings');
      chiefBrief = (await settings.getAll()).find(s => s.id === 'chief_brief') || null;
    } catch {}

    return NextResponse.json({ success: true, items: lightItems, total: items.length, mixToday: mix, sentToday: sentToday.length, governor, chiefBrief });
  } catch (error) {
    console.error('[NewsDesk API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'DESK_FEED_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { action, id, user = 'ไม่ระบุ', enabled } = await request.json();

    // ★ สวิตช์ Auto-Pilot (ไม่ผูกกับข่าวใบไหน — จัดการก่อนหา item)
    if (action === 'autopilot') {
      const settings = createStore('desk-settings');
      const allS = await settings.getAll();
      if (allS.find(s => s.id === 'autopilot')) {
        await settings.update('autopilot', (ex) => ({ ...ex, enabled: !!enabled }));
      } else {
        await settings.add({ id: 'autopilot', enabled: !!enabled, minScore: 8, perEditorPerRound: 2, dailyCap: 20 });
      }
      return NextResponse.json({ success: true, enabled: !!enabled });
    }

    if (!action || !id) {
      return NextResponse.json({ success: false, error: 'ต้องระบุ action และ id', errorType: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const store = createStore('news-desk');
    const all = await store.getAll();
    const item = all.find(i => i.id === id);
    if (!item) {
      return NextResponse.json({ success: false, error: 'ไม่พบข่าวนี้ในคลัง', errorType: 'NOT_FOUND' }, { status: 404 });
    }

    // ★ ปุ่ม 💼 ปรึกษา บก.ประจำแนว — แตกประเด็นลึก: ทำได้กี่แนว เล่นยังไง เสี่ยงอะไร
    if (action === 'consult') {
      const { consultSpecialist } = await import('@/lib/services/newsDesk/deskBrain');
      const c = await consultSpecialist(item);
      await store.update(id, (ex) => ({ ...ex, consult: c }));
      return NextResponse.json({ success: true, id, consult: c });
    }

    // ★ ปุ่ม 🔬 เจาะลึก — Research Agent หาแหล่งเพิ่ม+สังเคราะห์เนื้อพร้อมเขียน (ใช้เวลา ~30-60 วิ)
    if (action === 'research') {
      const { deepResearch } = await import('@/lib/services/newsDesk/researchAgent');
      const r = await deepResearch(item);
      if (!r.ok) {
        return NextResponse.json({ success: false, error: r.reason, errorType: 'RESEARCH_THIN' }, { status: 422 });
      }
      const boosted = Math.min(100, (item.finalScore || 0) + Math.max(0, r.readyScore - 5) * 2);
      await store.update(id, (ex) => ({ ...ex, research: r, finalScore: boosted }));
      return NextResponse.json({ success: true, id, research: r, finalScore: boosted });
    }

    // ★ ส่งเข้า workflow ฝั่งเซิร์ฟเวอร์ — เรียงตามความแน่นของวัตถุดิบ:
    //   คลิปสัมภาษณ์→บทถอดเสียงเต็ม | เจาะลึกแล้ว→เนื้อสังเคราะห์หลายแหล่ง | ปกติ→ลิงก์
    if (action === 'sendWorkflow') {
      const { buildEnrichedInput } = await import('@/lib/services/newsDesk/researchAgent');
      const input = (item.lane === 'interview' && item.fullText)
        ? item.fullText
        : (buildEnrichedInput(item) || item.url);
      const qRes = await fetch(`${request.nextUrl.origin}/api/queue/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, contentLength: 'short', userId: `desk-${user}` }),
      });
      const qData = await qRes.json();
      if (!qData.success) {
        return NextResponse.json({ success: false, error: qData.error || 'เข้าคิวไม่สำเร็จ', errorType: 'QUEUE_ADD_FAILED' }, { status: 502 });
      }
      // ★ เก็บ jobId ไว้กับการ์ด — UI ใช้ติดตามสถานะงานเขียนได้ (feedback ผู้ใช้ 11 มิ.ย.)
      await store.update(id, (ex) => ({ ...ex, status: 'sent', claimedBy: ex.claimedBy || user, sentAt: new Date().toISOString(), jobId: qData.jobId }));
      try {
        const fb = createStore('news-desk-feedback');
        await fb.add({ id: `${id}_sent_${Date.now()}`, newsId: id, action: 'sent', title: item.title, category: item.category, lane: item.lane, user, at: new Date().toISOString() });
      } catch {}
      return NextResponse.json({ success: true, id, status: 'sent', jobId: qData.jobId, position: qData.position });
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
    } else if (action === 'used') {
      // ★ คนหยิบเนื้อไปทำโพสต์แล้ว — เก็บออกจากชั้นวาง
      patch.used = true; patch.usedBy = user; patch.usedAt = new Date().toISOString();
    } else if (action === 'viral' || action === 'flop') {
      // ★ เฟส 3: รายงานผลโพสต์จริง — เข้าลูปเรียนรู้ (น้ำหนักหมวด + few-shot บรรณาธิการ AI)
      patch.performance = action;
    } else {
      return NextResponse.json({ success: false, error: `action ไม่รู้จัก: ${action}`, errorType: 'VALIDATION_ERROR' }, { status: 400 });
    }

    await store.update(id, (ex) => ({ ...ex, ...patch }));

    // ★ ทุกการตัดสินใจ = บทเรียนของบรรณาธิการ AI (few-shot + น้ำหนักหมวด ใน deskBrain)
    if (['claim', 'dismiss', 'sent', 'viral', 'flop'].includes(action)) {
      try {
        const fb = createStore('news-desk-feedback');
        const fbAction = { claim: 'claimed', sent: 'sent', dismiss: 'dismissed', viral: 'viral', flop: 'flop' }[action];
        await fb.add({
          id: `${id}_${action}_${Date.now()}`,
          newsId: id, action: fbAction,
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
