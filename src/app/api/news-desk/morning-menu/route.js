/**
 * News Desk — เมนูข่าวเช้า (เฟส 3)
 * GET/POST: เก็บข่าวรอบใหม่ → คัดท็อปต่อเลน → ส่งเข้า Discord (DISCORD_WEBHOOK_URL)
 * Vercel Cron: ทุกวัน 05:30 ไทย (22:30 UTC) — vercel.json
 * ไม่มี webhook → คืนเมนูเป็น JSON (ใช้ดูผ่าน browser ได้)
 */
import { NextResponse } from 'next/server';
import { runHarvest, pruneOldItems } from '@/lib/services/newsDesk/harvester';
import { createStore } from '@/lib/persistStore';
import { feedbackLinks } from '@/lib/services/newsDesk/feedbackLink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const LANE_HEADERS = {
  saga: '🌊 ซากากระแสใหญ่ (ธีมแชมป์ — เกาะต่อเนื่อง)',
  buzz: '📊 แชร์จริงในไทยตอนนี้ (BuzzSumo)',
  trend: '🔥 กระแสวันนี้',
  good: '💎 ข่าวน้ำดี',
  entrss: '⭐ ตรงจากสำนักบันเทิง (RSS)',
  evergreen: '🗄️ ข่าวเก่าน้ำดี (หยิบมาทำใหม่ได้)',
  followup: '🔁 ตามรอยข่าวที่เพจเคยทำ',
};
const LANE_QUOTA = { saga: 5, buzz: 5, trend: 8, good: 10, entrss: 5, evergreen: 4, followup: 3 }; // ★ 2 ก.ค.: +saga/+entrss

function buildMenu(items) {
  const menu = {};
  for (const lane of Object.keys(LANE_QUOTA)) {
    menu[lane] = items
      .filter(i => i.lane === lane && i.status === 'new')
      .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))
      .slice(0, LANE_QUOTA[lane]);
  }
  return menu;
}

// webhook อ่านได้ 2 ทาง: env → settings store (Supabase ที่ local/prod แชร์กัน — ไม่ต้องตั้ง env บน Vercel)
async function getWebhookUrl() {
  if (process.env.DISCORD_WEBHOOK_URL) return process.env.DISCORD_WEBHOOK_URL;
  try {
    const store = createStore('desk-settings');
    const all = await store.getAll();
    return all.find(s => s.id === 'discord_webhook')?.url || null;
  } catch { return null; }
}

// ★ 2 ก.ค.: ข้อความ "เช็กผลโพสต์" — ข่าวที่ส่งทำ 18 ชม.-4 วันก่อน + ลิงก์ 🔥ปัง/🧊แป้ก คลิกเดียวบันทึก
//   ปิดจุดบอดลูปเรียนรู้: feedback 730 รายการมี viral/flop = 0 เพราะปุ่มบนเว็บไม่มีใครกด → ย้ายมากดใน Discord
function buildPerfCheck(items, origin) {
  const now = Date.now();
  const sent = items
    .filter(i => {
      if (i.status !== 'sent' || i.performance) return false; // ที่รายงานแล้วไม่ถามซ้ำ
      const ageH = (now - new Date(i.sentAt || 0).getTime()) / 36e5;
      return ageH >= 18 && ageH <= 96; // โพสต์แล้วพอมีผลจริงให้ตัดสิน
    })
    .sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0))
    .slice(0, 10);
  if (!sent.length) return null;
  let desc = '';
  for (const it of sent) {
    const links = feedbackLinks(origin, it.id);
    const line = `**${String(it.title).slice(0, 70)}**\n[🔥 ปัง](${links.viral}) · [🧊 แป้ก](${links.flop})\n`;
    if (desc.length + line.length < 3900) desc += line;
  }
  return {
    embeds: [{
      title: '📊 เช็กผลโพสต์ (ส่งทำ 1-4 วันก่อน) — กดบอกผลให้ บก.AI เรียนรู้',
      description: desc,
      color: 0xf97316,
      footer: { text: 'คลิกลิงก์ = บันทึกทันที ไม่ต้องล็อกอิน · กดซ้ำ = แก้คำตอบได้' },
    }],
  };
}

async function sendDiscord(menu, deskUrl, extraPayloads = []) {
  const webhook = await getWebhookUrl();
  if (!webhook) return { sent: false, reason: 'ไม่มี webhook — ตั้งใน env DISCORD_WEBHOOK_URL หรือ store desk-settings' };

  const date = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' });
  const LANE_COLORS = { saga: 0x0ea5e9, buzz: 0x3b82f6, trend: 0xef4444, good: 0x22c55e, entrss: 0xec4899, evergreen: 0x8b5cf6, followup: 0xf59e0b };

  // ★ ใช้ embed: ลิงก์ฝังในชื่อข่าว ไม่มี URL ยาวเกะกะ อ่านง่ายกว่ากำแพงข้อความ (feedback ผู้ใช้)
  const payloads = [{ content: `# 🗞️ เมนูข่าวเช้า — ${date}\nคัดโดยสมองโต๊ะข่าว · จอง/ส่งทำได้ที่ ${deskUrl}` }];
  for (const [lane, items] of Object.entries(menu)) {
    if (!items.length) continue;
    let desc = '';
    items.forEach((it, i) => {
      const line = `**${i + 1}.** \`${it.finalScore}\` [${String(it.title).slice(0, 80)}](${it.url})` +
        `${it.judgeReason ? `\n→ ${String(it.judgeReason).slice(0, 80)}` : ''}\n`;
      if (desc.length + line.length < 3900) desc += line;
    });
    payloads.push({ embeds: [{ title: LANE_HEADERS[lane], description: desc, color: LANE_COLORS[lane] || 0x6b7280 }] });
  }

  payloads.push(...extraPayloads); // ★ 2 ก.ค.: ต่อท้ายข้อความเช็กผลโพสต์ (🔥/🧊)

  let sentCount = 0;
  for (const payload of payloads) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok || res.status === 204) sentCount++;
      else console.log('[MorningMenu] webhook ตอบ', res.status);
      await new Promise(r => setTimeout(r, 600)); // กัน rate limit
    } catch (e) { console.log('[MorningMenu] webhook error:', e.message?.slice(0, 50)); }
  }
  return { sent: sentCount > 0, messages: sentCount };
}

async function buildAndSend(request) {
  // ★ 2 ก.ค.: ?dry=1 = โหมดเทส — ไม่ harvest ไม่ส่ง Discord แค่คืนพรีวิวเมนู+ข้อความเช็กผล
  const dry = new URL(request.url).searchParams.get('dry') === '1';

  let stats = { skipped: true };
  if (!dry) {
    // เก็บรอบใหม่ก่อนเสมอ — เมนูเช้าต้องสะท้อนข่าวข้ามคืน
    await pruneOldItems(3);
    stats = await runHarvest({ judgeTop: 30 });
  }

  const store = createStore('news-desk');
  const items = await store.getAll();
  const menu = buildMenu(items);
  const totalInMenu = Object.values(menu).reduce((s, arr) => s + arr.length, 0);

  const origin = request.nextUrl.origin;
  const deskUrl = `${origin}/news-desk`;
  // ★ 2 ก.ค.: ข้อความเช็กผลโพสต์ (🔥ปัง/🧊แป้ก) — ลูปเรียนรู้ บก.AI
  const perfCheck = buildPerfCheck(items, origin);

  const discord = dry
    ? { sent: false, reason: 'dry mode (เทส)' }
    : await sendDiscord(menu, deskUrl, perfCheck ? [perfCheck] : []);

  console.log(`[MorningMenu] ✅ เมนู ${totalInMenu} ข่าว | เช็กผล ${perfCheck ? 'มี' : 'ไม่มีของค้าง'} | discord: ${JSON.stringify(discord)}`);
  return NextResponse.json({
    success: true,
    harvest: stats,
    menuCount: totalInMenu,
    discord,
    perfCheck: perfCheck ? perfCheck.embeds[0] : null,
    menu: Object.fromEntries(Object.entries(menu).map(([k, v]) => [k, v.map(i => ({ score: i.finalScore, title: i.title, url: i.url }))])),
  });
}

export async function GET(request) {
  try { return await buildAndSend(request); }
  catch (error) {
    console.error('[MorningMenu]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'MORNING_MENU_ERROR' }, { status: 500 });
  }
}

export async function POST(request) {
  return GET(request);
}
