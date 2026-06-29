/**
 * News Desk API — feed โต๊ะข่าว + ปุ่มทีม (จอง/ทิ้ง/ส่งเข้า workflow)
 * GET  ?tab=all|trend|good&limit=60   → รายการเรียงคะแนน
 * POST { action: 'claim'|'unclaim'|'dismiss'|'sent', id, user }
 *      ทุก action ถูกบันทึกเข้า news-desk-feedback = ข้อมูลสอน "บรรณาธิการ AI"
 */
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { applyMixGovernor, applyDiscoveryRanking } from '@/lib/services/newsDesk/deskBrain';
import { enrichDeskItem, isClip, LIBRARY_KEYS, CLIP_SOURCES } from '@/lib/services/newsDesk/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'all';
    const limit = Math.min(120, Number(searchParams.get('limit')) || 60);

    const store = createStore('news-desk');
    let items = await store.getAll();

    // ★ 25 มิ.ย. — ยกเครื่องโต๊ะข่าว: 2 โซน (คลิป/ลิงก์) × 6 คลัง + พรีวิวภาพ
    //   classify แบบ derive ตอนตอบ (ไม่ migrate ข้อมูล) → ของเดิมจัดกลุ่มใหม่ทันที
    //   ?zone=clip|link  ?library=<6 คลัง>|all  ?source=<ชนิดแหล่ง>|all (โซนคลิป)
    const zone = searchParams.get('zone');
    if (zone === 'clip' || zone === 'link') {
      const wantClip = zone === 'clip';
      const lib = searchParams.get('library') || 'all';
      const src = searchParams.get('source') || 'all';
      const active = items
        .filter(i => i.status !== 'dismissed' && !i.used)
        .map(enrichDeskItem)
        .filter(i => isClip(i) === wantClip);
      // นับต่อคลัง/ต่อแหล่ง "ก่อน" กรอง — เอาไปโชว์บนชิป
      const libraryCounts = {}; for (const k of LIBRARY_KEYS) libraryCounts[k] = 0;
      const sourceCounts = {};
      for (const i of active) {
        libraryCounts[i.library] = (libraryCounts[i.library] || 0) + 1;
        if (wantClip) sourceCounts[i.sourceType] = (sourceCounts[i.sourceType] || 0) + 1;
      }
      let list = active;
      if (lib !== 'all' && LIBRARY_KEYS.includes(lib)) list = list.filter(i => i.library === lib);
      if (wantClip && src !== 'all' && CLIP_SOURCES.includes(src)) list = list.filter(i => i.sourceType === src);
      // เรียงใหม่สุดก่อน (เวลาเข้าโต๊ะ)
      list.sort((a, b) => new Date(b.harvestedAt || 0) - new Date(a.harvestedAt || 0));
      // ★ 29 มิ.ย. (ผู้ใช้สั่ง: UI ต้องเห็นข่าวครบ): ขยาย cap 400→2000 + default 120→600 → โหลดเต็มโซน (กรองด้วยหมวด/ค้นเรียลไทม์ได้)
      const lim = Math.min(2000, Number(searchParams.get('limit')) || 600);
      const light = list.slice(0, lim).map(({ fullText, ...rest }) => rest);
      return NextResponse.json({ success: true, items: light, total: list.length, zone, library: lib, source: src, libraryCounts, sourceCounts });
    }

    // ★ 16 มิ.ย.: แท็บ 🗑️ คลังขยะ — ของที่ระบบตัดออก (แง่ลบ/นอกแนว/เสี่ยง) + ที่ทีมทิ้งเอง → รีวิว+เอากลับได้
    if (tab === 'junk') {
      const jstore = createStore('news-desk-junk');
      const junkStore = (await jstore.getAll()).map(j => ({ ...j, _fromJunk: true }));
      // ★ 16 มิ.ย.: ซ่อน "ล้างกระดาน" (ทีมเคลียร์ทั้งโต๊ะ ไม่ใช่ของที่ระบบตัดเพราะนอกแนว) — ให้เห็นเฉพาะที่ควรรีวิวจริง
      const dismissed = items
        .filter(i => i.status === 'dismissed' && !i.used && !/ล้างกระดาน/.test(String(i.dismissNote || '')))
        .map(i => ({ id: i.id, title: i.title, url: i.url, source: i.source || '', lane: i.lane || '', category: i.category || '', junkReason: i.dismissNote || 'ตัดออกจากโต๊ะ', junkAt: i.dismissedAt || i.harvestedAt, _fromDesk: true, shortlisted: !!i.shortlisted }));
      const all = [...junkStore, ...dismissed].sort((a, b) => new Date(b.junkAt || 0) - new Date(a.junkAt || 0));
      return NextResponse.json({ success: true, items: all.slice(0, 200), total: all.length, tab: 'junk' });
    }

    // ★ 16 มิ.ย.: แท็บ 🎯 ผลค้นหา — ข่าวจากการ "สั่งหาเฉพาะแนว" ทุกหมวด รวมไว้ที่เดียว (เรียงรอบค้นล่าสุดก่อน) อยู่ถาวรกลับมาดูได้
    if (tab === 'focus') {
      let f = items.filter(i => i.focusTag && i.status !== 'dismissed' && !i.used);
      f.sort((a, b) => new Date(b.searchedAt || b.harvestedAt || 0) - new Date(a.searchedAt || a.harvestedAt || 0));
      const lightF = f.slice(0, limit).map(({ fullText, ...rest }) => rest);
      return NextResponse.json({ success: true, items: lightF, total: f.length, tab: 'focus' });
    }

    // ★ 19 มิ.ย. (เก็บกว้าง): แท็บ 🗂️ ทุกหมวด — ดูข่าวทุกเลน/ทุกหมวด เลื่อนดูเยอะ + กรองตามหมวด (ไม่ดัน mix-governor)
    if (tab === 'browse') {
      let list = items.filter(i => i.status !== 'dismissed' && !i.used);
      // ★ 19 มิ.ย. รอบ 3 (ผู้ใช้: กระแสเก่าไม่เอา เก็บเฉพาะเขียนใหม่ได้):
      //   หมวด "เขียนใหม่ได้" (น้ำดี/กตัญญู/สู้ชีวิต/คนดังทำดี/สัมภาษณ์/ความรัก) = เก็บทุกอายุ
      //   หมวดอื่น (กระแส/ดราม่า/คดี/บันเทิง/ไลฟ์สไตล์/กีฬา) = ตัดของเก่า >7 วันทิ้งจากหน้าโต๊ะ
      const EVERGREEN_CATS = ['น้ำใจ/ช่วยเหลือ', 'กตัญญู/ครอบครัวอบอุ่น', 'สู้ชีวิต', 'คนดังทำดี/ติดดิน', 'สัมภาษณ์/บทสนทนาดี', 'ความรัก/แต่งงาน'];
      const _oldCut = Date.now() - 7 * 864e5;
      list = list.filter(i => {
        if (EVERGREEN_CATS.includes(i.category)) return true;
        const ref = i.publishedAt || i.harvestedAt;
        return !ref || new Date(ref).getTime() >= _oldCut;
      });
      const counts = {};
      for (const i of list) { const c = i.category || 'อื่นๆ'; counts[c] = (counts[c] || 0) + 1; }
      const catParam = searchParams.get('category');
      if (catParam && catParam !== 'all') list = list.filter(i => (i.category || 'อื่นๆ') === catParam);
      list.sort((a, c) => new Date(c.harvestedAt || 0) - new Date(a.harvestedAt || 0));
      const lim = Math.min(400, Number(searchParams.get('limit')) || 200);
      const light = list.slice(0, lim).map(({ fullText, ...rest }) => rest);
      return NextResponse.json({ success: true, items: light, total: list.length, tab: 'browse', categoryCounts: counts });
    }

    // ★ 17 มิ.ย. (ทีมสั่งยุบเหลือ 2 หมวดค้น + เรียงใหม่สุดก่อน): 🔥 กระแส / 💚 ดาราน้ำดี
    const KRATASE_LANES = ['trend', 'buzz', 'trend-track'];                                             // กระแสเรียลไทม์
    const NAMDEE_LANES = ['good', 'celeb', 'evergreen', 'evergreen-celeb', 'throwback', 'followup', 'interview', 'video']; // ดาราน้ำดี (สต็อก)
    // ★ 19 มิ.ย. รอบ 5 (ผู้ใช้: "ดาราน้ำดีมีแต่ดราม่า — ผิด"): ดาราน้ำดี = กรองด้วย "หมวดน้ำดี" ไม่ใช่เลน
    //   เลน celeb มีข่าวดาราทุกแบบ (รวมดราม่า/ปะทะ) → ต้องคัดเฉพาะหมวดทำดี: กตัญญู/น้ำใจ/สู้ชีวิต/คนดังทำดี/สัมภาษณ์ดี
    const NAMDEE_CATS = ['กตัญญู/ครอบครัวอบอุ่น', 'น้ำใจ/ช่วยเหลือ', 'สู้ชีวิต', 'คนดังทำดี/ติดดิน', 'สัมภาษณ์/บทสนทนาดี'];
    const TAB_LANES = {
      kratase: KRATASE_LANES,
      namdee: NAMDEE_LANES,
      // เก็บ alias เดิมไว้กันลิงก์/บุ๊กมาร์กเก่าพัง
      trend: KRATASE_LANES, good: NAMDEE_LANES, celeb: ['celeb', 'throwback', 'evergreen-celeb'], clip: ['video', 'interview'], trendtrack: ['trend-track'],
    };
    const isCategoryTab = tab === 'kratase' || tab === 'namdee';
    // ★ 19 มิ.ย. รอบ 2: กระแสรายวัน = เลนกระแส (trend/buzz) "หรือ" หมวด 'กระแสรายวัน' (จากคีย์เชิงลึก broad)
    if (tab === 'kratase') {
      items = items.filter(i => KRATASE_LANES.includes(i.lane) || i.category === 'กระแสรายวัน');
    } else if (tab === 'namdee') {
      // ★ ดาราน้ำดี = เฉพาะหมวดทำดี (กตัญญู/น้ำใจ/สู้ชีวิต/คนดังทำดี/สัมภาษณ์) — ไม่เอาดราม่า/ปะทะ
      items = items.filter(i => NAMDEE_CATS.includes(i.category));
    } else if (TAB_LANES[tab]) {
      items = items.filter(i => TAB_LANES[tab].includes(i.lane));
    }
    // ★ กระแสรายวัน = ต้องสด ≤3 วัน (ตัดของเก่าจากหน้านี้) · ดาราน้ำดี = สต็อกได้ ไม่ตัดอายุ
    if (tab === 'kratase') {
      items = items.filter(i => {
        const ref = i.publishedAt || i.harvestedAt;
        const ageDays = ref ? (Date.now() - new Date(ref).getTime()) / 864e5 : 99;
        return ageDays <= 3;
      });
    }
    // ★ 15 มิ.ย.: แท็บ ⭐ คลังส่งเช้า — ข่าวที่เลือกเก็บไว้ส่งพนักงาน (เรียงเก็บล่าสุดก่อน, ไม่นับที่หยิบไปแล้ว)
    if (tab === 'shortlist') {
      items = items.filter(i => i.shortlisted && !i.used && i.status !== 'dismissed');
      items.sort((a, b) => new Date(b.shortlistedAt || 0) - new Date(a.shortlistedAt || 0));
      // ★ 28 มิ.ย.: enrich ให้ป้าย ♾️อมตะ/🔥กระแส + library + sourceType โชว์ในคลังด้วย
      const lightSL = items.slice(0, limit).map(({ fullText, ...rest }) => enrichDeskItem(rest));
      return NextResponse.json({ success: true, items: lightSL, total: items.length, tab: 'shortlist' });
    }
    // ★ แท็บ ✅ พร้อมใช้: ผลงานที่ส่งเจนแล้ว (คนมาหยิบเนื้อไปทำโพสต์/ปก) — เรียงใหม่สุดก่อน
    if (tab === 'ready') {
      items = items.filter(i => i.status === 'sent' && !i.used);
      items.sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
      const lightReady = items.slice(0, limit).map(({ fullText, ...rest }) => rest);
      return NextResponse.json({ success: true, items: lightReady, total: items.length, tab: 'ready' });
    }
    // ★ 13 มิ.ย.: ซ่อนทั้งที่ทิ้ง (dismissed) และที่หยิบไปใช้แล้ว (used) จากฟีดหน้าหลัก
    //   เดิมกรองแค่ dismissed → กด "หยิบไปใช้แล้ว" การ์ดไม่หาย ดูเหมือนปุ่มกดไม่ติด (ที่จริง backend ตั้ง used=true แล้ว)
    items = items.filter(i => i.status !== 'dismissed' && !i.used);

    // ★ quick-fix: คะแนนเสื่อมตามอายุ — กระแสเก่าจมเอง (trend -8/วัน, good -3/วัน, เลนไร้กาลเวลาไม่เสื่อม)
    const DECAY = { trend: 8, good: 3, evergreen: 0, 'evergreen-celeb': 0, followup: 4, interview: 0, buzz: 10, celeb: 4, throwback: 0, video: 0, 'trend-track': 6 }; // trend-track = กระแสสด เสื่อมปานกลาง | evergreen-celeb/throwback/video = ของตั้งใจหยิบ ไม่เสื่อม
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

    // ★ 17 มิ.ย. (ทีมสั่ง "เลิกเรียงสกอร์ ข่าวเดิมวนที่เดิม → เอาใหม่สุดขึ้นก่อน"):
    let ranked, governor = null;
    if (isCategoryTab) {
      // หมวด กระแส/ดาราน้ำดี = เรียง "ใหม่สุดขึ้นก่อน" (เวลาเข้าโต๊ะ) ไม่ใช้สกอร์/ไม่หมุน → ข่าวใหม่ขึ้นบนเสมอ ไม่วนเดิม
      ranked = items.slice().sort((a, b) => new Date(b.harvestedAt || 0) - new Date(a.harvestedAt || 0));
    } else {
      // แท็บรวม/เก่า: คงกลไกเดิม (governor + discovery)
      const mg = applyMixGovernor(items, mix); governor = mg.governor;
      ranked = applyDiscoveryRanking(mg.items);
    }

    // fullText (บทถอดเสียงคลิป) ยาว — ไม่ส่งให้หน้า feed
    const lightItems = ranked.slice(0, limit).map(({ fullText, ...rest }) => rest);

    // ★ brief ล่าสุดจาก บก.ใหญ่ AI + สถานะสวิตช์ Auto-Pilot จริง (UI ต้องโชว์ตามที่ทีมตั้ง ไม่ใช่ค่า default)
    let chiefBrief = null;
    let autopilotEnabled = null;
    let reframeAuto = false;
    try {
      const settings = createStore('desk-settings');
      const allS = await settings.getAll();
      chiefBrief = allS.find(s => s.id === 'chief_brief') || null;
      const ap = allS.find(s => s.id === 'autopilot');
      autopilotEnabled = ap ? !!ap.enabled : true;
      const rf = allS.find(s => s.id === 'reframe_auto');
      reframeAuto = rf ? !!rf.enabled : false; // ดีฟอลต์ปิด
    } catch {}

    // ★ สถิติ: บก.ไหนส่งไปเท่าไหร่วันนี้ + คิวตอนนี้ + ชั้นวางพร้อมใช้
    const editorStats = {};
    for (const s of sentToday) {
      const who = s.pickedBy ? `${s.pickedByIcon || '🤖'} ${s.pickedBy}` : `👤 ทีม`;
      editorStats[who] = (editorStats[who] || 0) + 1;
    }
    let queueDepth = { pending: 0, processing: 0 };
    try {
      const jq = await createStore('job_queue').getAll();
      queueDepth = {
        pending: jq.filter(j => j.status === 'pending').length,
        processing: jq.filter(j => j.status === 'processing').length,
      };
    } catch {}
    const readyCount = (await store.getAll()).filter(i => i.status === 'sent' && !i.used).length;

    return NextResponse.json({ success: true, items: lightItems, total: items.length, mixToday: mix, sentToday: sentToday.length, governor, chiefBrief, autopilot: autopilotEnabled, reframeAuto, editorStats, queueDepth, readyCount });
  } catch (error) {
    console.error('[NewsDesk API]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'DESK_FEED_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { action, id, user = 'ไม่ระบุ', enabled } = await request.json();

    // ★ ล้างกระดาน (15 มิ.ย. คำสั่งทีม): เก็บการ์ด 'new' เข้ากรุ — เคลียร์โต๊ะก่อนสั่งหาข่าวชุดใหม่
    //   ★ 16 มิ.ย. (แก้บั๊ก): ห้ามแตะการ์ดใน "คลังส่งเช้า" (shortlisted) — ทีมตั้งใจเก็บไว้ส่งพนักงาน!
    if (action === 'clearBoard') {
      const store = createStore('news-desk');
      const all = await store.getAll();
      let cleared = 0;
      for (const it of all) {
        if (it.status === 'new' && !it.shortlisted) {
          await store.update(it.id, (ex) => ({ ...ex, status: 'dismissed', dismissNote: '🧹 ล้างกระดาน (ทีมสั่งเคลียร์)' })).catch(() => {});
          cleared++;
        }
      }
      return NextResponse.json({ success: true, cleared });
    }

    // ★ 16 มิ.ย. (กู้คืน): คืนการ์ด "คลังส่งเช้า" ที่ถูกล้างกระดานเก็บเข้ากรุพลาด → กลับมาเป็น new (ยังอยู่ในคลัง)
    if (action === 'restoreShortlist') {
      const store = createStore('news-desk');
      const all = await store.getAll();
      let restored = 0;
      for (const it of all) {
        if (it.shortlisted && it.status === 'dismissed' && /ล้างกระดาน/.test(String(it.dismissNote || '')) && !it.used) {
          await store.update(it.id, (ex) => ({ ...ex, status: 'new', dismissNote: null })).catch(() => {});
          restored++;
        }
      }
      return NextResponse.json({ success: true, restored });
    }

    // ★ 16 มิ.ย.: เอากลับจากคลังขยะ → คืนขึ้นโต๊ะเป็น new (ทีมเห็นว่าระบบตัดผิด)
    if (action === 'restoreJunk') {
      if (!id) return NextResponse.json({ success: false, error: 'ต้องระบุ id', errorType: 'VALIDATION_ERROR' }, { status: 400 });
      const deskStore = createStore('news-desk');
      const jstore = createStore('news-desk-junk');
      const j = (await jstore.getAll()).find(x => x.id === id);
      if (j) {
        // ★ ตัด prefix 'jk_' ออก → ใช้ id โต๊ะปกติ (idOf url) เพื่อให้ harvest รอบหน้ากันซ้ำได้
        const cleanId = String(id).startsWith('jk_') ? String(id).slice(3) : id;
        const deskAll = await deskStore.getAll();
        if (deskAll.find(x => x.id === cleanId)) {
          await deskStore.update(cleanId, (ex) => ({ ...ex, status: 'new', dismissNote: null }));
        } else {
          await deskStore.add({ id: cleanId, title: j.title, url: j.url, source: j.source || '', lane: j.lane || 'good', category: j.category || '', status: 'new', finalScore: 50, restoredFromJunk: true, harvestedAt: new Date().toISOString() });
        }
        await jstore.remove(id).catch(() => {});
        return NextResponse.json({ success: true, restored: 1, from: 'junk' });
      }
      // ของที่ทีมทิ้งบนโต๊ะ (status dismissed)
      const d = (await deskStore.getAll()).find(x => x.id === id);
      if (d) { await deskStore.update(id, (ex) => ({ ...ex, status: 'new', dismissNote: null })); return NextResponse.json({ success: true, restored: 1, from: 'desk' }); }
      return NextResponse.json({ success: false, error: 'ไม่พบในคลังขยะ', errorType: 'NOT_FOUND' }, { status: 404 });
    }

    // ★ 17 มิ.ย.: สวิตช์ "แปลงมุมอัตโนมัติ" (เปิด/ปิด) — ดีฟอลต์ปิด กันเปลือง OpenAI ตอนระบบยังไม่สมบูรณ์
    if (action === 'reframeAuto') {
      const settings = createStore('desk-settings');
      const allS = await settings.getAll();
      if (allS.find(s => s.id === 'reframe_auto')) {
        await settings.update('reframe_auto', (ex) => ({ ...ex, enabled: !!enabled }));
      } else {
        await settings.add({ id: 'reframe_auto', enabled: !!enabled });
      }
      return NextResponse.json({ success: true, enabled: !!enabled });
    }

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

    // ★ 17 มิ.ย.: ปุ่ม ♻️ แปลงมุม — ข่าวท็อกซิก/ดราม่า/ตรงไปตรงมา → มุมเชิงบวก 2-4 มุม (แยกจากไลน์เขียน)
    if (action === 'reframe') {
      const { reframeNews } = await import('@/lib/services/newsDesk/reframeEngine');
      const r = await reframeNews(item);
      if (!r.ok) {
        return NextResponse.json({ success: false, error: r.reason, errorType: 'REFRAME_FAILED' }, { status: 422 });
      }
      await store.update(id, (ex) => ({ ...ex, reframe: r }));
      return NextResponse.json({ success: true, id, reframe: r });
    }

    // ★ ส่งเข้า workflow ฝั่งเซิร์ฟเวอร์ — กฎเหล็ก (คำสั่งทีม 12 มิ.ย.): ส่งได้แค่ 2 รูปแบบเหมือนที่คนทำแมนนวล
    //   ① TEXT = บทถอดเสียงคลิปข่าวเดียว (interview) ② URL = ลิงก์ข่าวต้นทาง
    //   ห้ามส่งเนื้อสังเคราะห์หลายแหล่ง (buildEnrichedInput) เข้าไลน์เขียน — เคยทำให้เนื้อหลายข่าวปนกัน
    //   (ผลเจาะลึก research ยังอยู่บนการ์ดให้คนอ่านประกอบ แต่ไม่ feed เข้าไลน์)
    if (action === 'sendWorkflow') {
      let input = (item.lane === 'interview' && item.fullText)
        ? item.fullText
        : item.url;
      // ★ ข่าวต่างประเทศ — แนบข้อเท็จจริงประเทศไปกับลิงก์ (pipeline ผนวกเป็นข้อมูลเพิ่มเติม ไม่ใช่เนื้อแทน)
      if (item.foreignCountry && input === item.url) {
        input = `${item.url}\n\nหมายเหตุบรรณาธิการ (ข้อเท็จจริง): ข่าวนี้เกิดที่ประเทศ${item.foreignCountry} ไม่ใช่ประเทศไทย — ต้องระบุประเทศชัดเจนตั้งแต่ย่อหน้าแรกของโพสต์`;
      }
      const qRes = await fetch(`${request.nextUrl.origin}/api/queue/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input, contentLength: 'short', userId: `desk-${user}`,
          // ★ ป้ายโต๊ะข่าว — Generation Log ใช้แยกว่าใครทำ แนวอะไร + คะแนนไว้ติดป้าย "ความควรทำ"
          deskMeta: { newsId: id, lane: item.lane, category: item.category || '', editor: user, editorIcon: '👤', judgeScore: item.judgeScore ?? null, finalScore: item.finalScore ?? null },
        }),
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
    } else if (action === 'shortlist') {
      // ★ 15 มิ.ย.: เลือกเก็บเข้า "คลังส่งเช้า" — รวมไว้พรุ่งนี้คัดลอกส่งพนักงานทีเดียว (ไม่ถูกล้างอัตโนมัติ)
      patch.shortlisted = true; patch.shortlistedAt = new Date().toISOString(); patch.shortlistedBy = user;
    } else if (action === 'unshortlist') {
      patch.shortlisted = false;
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
