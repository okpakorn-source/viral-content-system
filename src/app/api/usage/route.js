/**
 * /api/usage — สมุดบันทึกการใช้งานจริงรายยูส + สถิติ (26 ก.ค. 69 — เจ้าของสั่ง)
 * ─────────────────────────────────────────────────────────────
 * POST  {action, refId?, meta?}          — บันทึก 1 เหตุการณ์ (ต้องล็อกอิน; ตัวตนมาจาก session เท่านั้น ปลอมไม่ได้)
 * GET   ?view=me                         — สถิติ+ประวัติของตัวเอง
 * GET   ?view=team                       — ภาพรวมรายคนทั้งทีม (แอดมินเท่านั้น)
 * GET   ?view=history&userKey=&limit=    — timeline รายคน (พนักงานดูได้เฉพาะตัวเอง)
 * เก็บใน store 'usage-events' (Supabase → ไฟล์สำรอง ตามชั้นเก็บข้อมูลเดิม) — ไฟล์ใหม่ล้วน ไม่แตะระบบข่าว
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createStore } from '@/lib/persistStore';
import { getSession } from '@/lib/auth';

const store = createStore('usage-events');
const MAX_EVENTS = 6000; // เพดานสมุด — เกินแล้วตัดของเก่าทิ้ง (กันคลังบวม)

async function sess() {
  try {
    const c = await cookies();
    const token = c.get('auth_token')?.value;
    return token ? await getSession(token) : null;
  } catch { return null; }
}

const ACTIONS = new Set([
  'app_open', 'submit_news', 'job_done', 'job_failed', 'clip_submit', 'clip_done',
  'filter_run', 'split_run', 'send_topic', 'copy_version', 'regen', 'view_case',
  'cover_save',
  'cover_submit', 'cover_done',
]);

export async function POST(request) {
  try {
    const s = await sess();
    if (!s) return NextResponse.json({ success: false, error: 'ต้องล็อกอินก่อน', errorType: 'UNAUTHORIZED' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '');
    if (!ACTIONS.has(action)) {
      return NextResponse.json({ success: false, error: 'action ไม่รู้จัก', errorType: 'BAD_ACTION' }, { status: 400 });
    }
    const ev = {
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      memberId: s.memberId,
      username: s.username,
      displayName: s.displayName || s.username,
      role: s.role || 'editor',
      action,
      refId: String(body.refId || '').slice(0, 60),
      meta: body.meta && typeof body.meta === 'object' ? JSON.parse(JSON.stringify(body.meta).slice(0, 600)) : {},
      at: new Date().toISOString(),
    };
    await store.add(ev);
    // ตัดของเก่านานๆ ครั้ง (โอกาส ~2%) — แบบเดียวกับ bot-pings
    if (Math.random() < 0.02) {
      try {
        const all = await store.getAll();
        if (all.length > MAX_EVENTS) {
          const old = all.sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, all.length - MAX_EVENTS);
          for (const o of old) await store.remove(o.id).catch(() => {});
        }
      } catch {}
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'USAGE_LOG_ERROR' }, { status: 500 });
  }
}

// ── ตัวช่วยสรุปตัวเลข ──
const DAY = 86400000;
function agg(events, genRows, userKey) {
  const now = Date.now();
  const mine = events.filter(e => e.username === userKey);
  const gmine = genRows.filter(g => g.user === `mobile-${userKey}`);
  const inWin = (t, win) => now - new Date(t).getTime() < win;
  const cnt = (arr, f) => arr.filter(f).length;
  const doneTimes = gmine.filter(g => g.totalTime > 0).map(g => g.totalTime);
  return {
    today: {
      submits: cnt(mine, e => e.action === 'submit_news' && inWin(e.at, DAY)),
      done: cnt(mine, e => e.action === 'job_done' && inWin(e.at, DAY)),
      failed: cnt(mine, e => e.action === 'job_failed' && inWin(e.at, DAY)),
      copies: cnt(mine, e => e.action === 'copy_version' && inWin(e.at, DAY)),
    },
    week: {
      submits: cnt(mine, e => e.action === 'submit_news' && inWin(e.at, 7 * DAY)),
      done: cnt(mine, e => e.action === 'job_done' && inWin(e.at, 7 * DAY)),
      failed: cnt(mine, e => e.action === 'job_failed' && inWin(e.at, 7 * DAY)),
      clips: cnt(mine, e => e.action === 'clip_done' && inWin(e.at, 7 * DAY)),
      filters: cnt(mine, e => e.action === 'filter_run' && inWin(e.at, 7 * DAY)),
      topics: cnt(mine, e => e.action === 'send_topic' && inWin(e.at, 7 * DAY)),
      copies: cnt(mine, e => e.action === 'copy_version' && inWin(e.at, 7 * DAY)),
      regens: cnt(mine, e => e.action === 'regen' && inWin(e.at, 7 * DAY)),
    },
    allTimeJobs: gmine.length, // จากคลังผลงานจริง (ย้อนหลังได้ก่อนมีสมุดนี้)
    avgSecs: doneTimes.length ? Math.round(doneTimes.reduce((a, b) => a + b, 0) / doneTimes.length) : null,
    lastActive: mine.length ? mine.reduce((m, e) => (e.at > m ? e.at : m), mine[0].at) : null,
  };
}

// อ่านคลังผลงานแบบย่อ (ผ่าน endpoint list เดิม — ฟิลด์ถูก trim แล้ว ไม่หนัก)
async function genRows(origin) {
  try {
    const r = await fetch(`${origin}/api/generation-logs?limit=400`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const d = await r.json();
    return (d.cases || []).map(c => ({
      user: String(c.userId || c.user_id || ''),
      totalTime: Number(c.pipelineInfo?.totalTime || c.pipeline_info?.totalTime || 0),
      at: c.createdAt || c.created_at || '',
    }));
  } catch { return []; }
}

export async function GET(request) {
  try {
    const s = await sess();
    if (!s) return NextResponse.json({ success: false, error: 'ต้องล็อกอินก่อน', errorType: 'UNAUTHORIZED' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') || 'me';
    const events = await store.getAll();
    events.sort((a, b) => new Date(b.at) - new Date(a.at));

    if (view === 'me') {
      const rows = await genRows(request.nextUrl.origin);
      return NextResponse.json({
        success: true,
        member: { username: s.username, displayName: s.displayName, role: s.role },
        stats: agg(events, rows, s.username),
        recent: events.filter(e => e.username === s.username).slice(0, 40),
      });
    }

    if (view === 'history') {
      const limit = Math.min(120, Number(searchParams.get('limit')) || 60);
      let key = searchParams.get('userKey') || s.username;
      if (s.role !== 'admin' && key !== s.username) key = s.username; // พนักงานดูได้เฉพาะตัวเอง
      return NextResponse.json({ success: true, userKey: key, events: events.filter(e => e.username === key).slice(0, limit) });
    }

    // ═══ รีพอร์ตต้นทุน (แอดมินเท่านั้น) — โปร่งใส: จำนวนใช้จริง × เรตที่แสดงสูตรเปิดเผย ═══
    if (view === 'report') {
      if (s.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'เฉพาะแอดมิน', errorType: 'FORBIDDEN' }, { status: 403 });
      }
      // เรตต่อการกระทำ (USD) — คำนวณจากราคาโมเดลจริง × โทเค็นเฉลี่ยของท่อจริง (แจกแจงให้ตรวจได้)
      // ข่าว 1 งาน (short, 2 เวอร์ชัน ~10-15 AI calls):
      //   สกัด gemini-flash ~$0.01 + แตกประเด็น terra(3k/6k)~$0.10 + จับคู่/พิมพ์เขียว/รีเสิร์ช mini ~$0.02
      //   + เขียน opus-4-8 ×2 มุม (in12k/out3k) ~$0.14 + เกลา mini ~$0.01  ≈ $0.28
      const RATES = {
        news: { usd: 0.28, label: 'ข่าว 1 งาน (2 เวอร์ชัน)', note: 'สกัด+แตกประเด็น terra+เขียน opus-4-8 ×2 มุม+เกลา ≈ 10-15 AI calls' },
        clip: { usd: 0.03, label: 'ถอดคลิป 1 คลิป', note: 'Gemini ดูคลิป/ถอดเสียง + แตกประเด็น' },
        filterAI: { usd: 0.02, label: 'สกัดเนื้อโหมด AI', note: 'AI คัดประโยคทั้งเนื้อ' },
        split: { usd: 0.02, label: 'แยกประเด็นย่อย', note: 'AI แยก 1 ครั้ง' },
      };
      const THB = Math.max(20, Number(process.env.USD_THB) || 36);
      const rows = await genRows(request.nextUrl.origin);
      const now = Date.now();
      const win = (t, d) => now - new Date(t).getTime() < d * DAY;

      // รายยูสแอพ (จากเหตุการณ์จริง + คลังผลงานจริง)
      const names = new Map();
      for (const e of events) if (!names.has(e.username)) names.set(e.username, e.displayName || e.username);
      const users = [...names.entries()].map(([u, dn]) => {
        const mine = events.filter(e => e.username === u);
        const c = (a, d) => mine.filter(e => e.action === a && (d ? win(e.at, d) : true)).length;
        const jobs30 = rows.filter(g => g.user === `mobile-${u}` && (g.at ? win(g.at, 30) : true)).length;
        const clip30 = c('clip_done', 30), fil30 = mine.filter(e => e.action === 'filter_run' && e.meta?.ai !== false && win(e.at, 30)).length, sp30 = c('split_run', 30);
        const usd = jobs30 * RATES.news.usd + clip30 * RATES.clip.usd + fil30 * RATES.filterAI.usd + sp30 * RATES.split.usd;
        return {
          username: u, displayName: dn,
          today: { jobs: c('job_done', 1), submits: c('submit_news', 1) },
          d30: { jobs: jobs30, clips: clip30, filtersAI: fil30, splits: sp30, copies: c('copy_version', 30) },
          estUsd: Math.round(usd * 100) / 100,
          estThb: Math.round(usd * THB),
          lastActive: mine.length ? mine.reduce((m, e) => (e.at > m ? e.at : m), mine[0].at) : null,
        };
      }).sort((a, b) => b.estThb - a.estThb);

      // ช่องทางอื่น (ดิสคอร์ด/บก.AI) จากคลังผลงานจริง — ให้เห็นเงินทั้งระบบ ไม่ใช่แค่แอพ
      const channels = {};
      for (const g of rows) {
        if (!g.at || !win(g.at, 30)) continue;
        const k = g.user.startsWith('mobile-') ? 'แอพมือถือ' : g.user.startsWith('discord-') ? 'ดิสคอร์ด' : (g.user || 'ไม่ระบุ');
        channels[k] = (channels[k] || 0) + 1;
      }
      const chRows = Object.entries(channels).map(([k, n]) => ({ channel: k, jobs: n, estThb: Math.round(n * RATES.news.usd * THB) }))
        .sort((a, b) => b.jobs - a.jobs);
      const totalThb = chRows.reduce((a, r) => a + r.estThb, 0) +
        users.reduce((a, u) => a + Math.round((u.d30.clips * RATES.clip.usd + u.d30.filtersAI * RATES.filterAI.usd + u.d30.splits * RATES.split.usd) * THB), 0);

      // ต้นทุนที่ "บันทึกจริง" เท่าที่ระบบเก็บได้ (ฐานบนคลาวด์เป็นแบบชั่วคราว — มีเท่าไหร่โชว์เท่านั้น ติดป้ายชัด)
      let realLogged = null;
      try {
        const { prisma } = await import('@/lib/db');
        const logs = await prisma.apiUsageLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
        if (logs?.length) {
          const sum = {};
          for (const l of logs) sum[l.provider] = (sum[l.provider] || 0) + (l.costUsd || 0);
          realLogged = { calls: logs.length, byProvider: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Math.round(v * 100) / 100])), note: 'เท่าที่เครื่องเซิร์ฟเวอร์ตัวปัจจุบันบันทึกไว้ (ฐานชั่วคราว) — ใช้เทียบเรต ไม่ใช่ยอดรวมทั้งเดือน' };
        }
      } catch {}

      return NextResponse.json({
        success: true,
        period: '30 วันล่าสุด (อิงคลังผลงาน 400 เคสล่าสุด + สมุดเหตุการณ์)',
        thbRate: THB,
        rates: Object.fromEntries(Object.entries(RATES).map(([k, r]) => [k, { ...r, thb: Math.round(r.usd * THB * 100) / 100 }])),
        users, channels: chRows, totalThb, realLogged,
        disclosure: 'ตัวเลขเงิน = จำนวนการใช้จริง × เรตต่อการกระทำ (คำนวณจากราคาโมเดลจริง สูตรแสดงในเรตการ์ด) — ระบบคลาวด์ไม่ได้เก็บบิลจริงรายครั้งแบบถาวร จึงเป็นประมาณการโปร่งใสที่ตรวจสูตรได้',
      });
    }

    if (view === 'team') {
      if (s.role !== 'admin') {
        return NextResponse.json({ success: false, error: 'เฉพาะแอดมิน', errorType: 'FORBIDDEN' }, { status: 403 });
      }
      const rows = await genRows(request.nextUrl.origin);
      // สมาชิก = ทุกคนที่เคยมีเหตุการณ์ + ที่โผล่ในคลังผลงานช่องทางมือถือ
      const names = new Map(); // username → displayName
      for (const e of events) if (!names.has(e.username)) names.set(e.username, e.displayName || e.username);
      for (const g of rows) if (g.user.startsWith('mobile-')) { const u = g.user.slice(7); if (!names.has(u)) names.set(u, u); }
      const team = [...names.entries()].map(([u, dn]) => ({ username: u, displayName: dn, ...agg(events, rows, u) }));
      team.sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''));
      // ช่องทางอื่นที่ไม่ใช่ยูสแอพ (ดิสคอร์ด/บก.AI) — โชว์เป็นแถวรวมให้เห็นภาพทั้งระบบ
      const other = {};
      for (const g of rows) {
        if (g.user.startsWith('mobile-')) continue;
        const k = g.user.startsWith('discord-') ? 'ดิสคอร์ด' : (g.user || 'ไม่ระบุ');
        other[k] = (other[k] || 0) + 1;
      }
      return NextResponse.json({ success: true, team, otherChannels: other });
    }

    return NextResponse.json({ success: false, error: 'view ไม่รู้จัก' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message, errorType: 'USAGE_ERROR' }, { status: 500 });
  }
}
