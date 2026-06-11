/**
 * News Desk — เมนูข่าวเช้า (เฟส 3)
 * GET/POST: เก็บข่าวรอบใหม่ → คัดท็อปต่อเลน → ส่งเข้า Discord (DISCORD_WEBHOOK_URL)
 * Vercel Cron: ทุกวัน 05:30 ไทย (22:30 UTC) — vercel.json
 * ไม่มี webhook → คืนเมนูเป็น JSON (ใช้ดูผ่าน browser ได้)
 */
import { NextResponse } from 'next/server';
import { runHarvest, pruneOldItems } from '@/lib/services/newsDesk/harvester';
import { createStore } from '@/lib/persistStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const LANE_HEADERS = {
  buzz: '📊 แชร์จริงในไทยตอนนี้ (BuzzSumo)',
  trend: '🔥 กระแสวันนี้',
  good: '💎 ข่าวน้ำดี',
  evergreen: '🗄️ ข่าวเก่าน้ำดี (หยิบมาทำใหม่ได้)',
  followup: '🔁 ตามรอยข่าวที่เพจเคยทำ',
};
const LANE_QUOTA = { buzz: 5, trend: 8, good: 10, evergreen: 4, followup: 3 };

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

async function sendDiscord(menu, deskUrl) {
  const webhook = await getWebhookUrl();
  if (!webhook) return { sent: false, reason: 'ไม่มี webhook — ตั้งใน env DISCORD_WEBHOOK_URL หรือ store desk-settings' };

  const date = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' });
  const messages = [`# 🗞️ เมนูข่าวเช้า — ${date}\nคัดโดยสมองโต๊ะข่าว · กดเลือกได้ที่ ${deskUrl}`];

  for (const [lane, items] of Object.entries(menu)) {
    if (!items.length) continue;
    let block = `\n## ${LANE_HEADERS[lane]}\n`;
    items.forEach((it, i) => {
      const line = `**${i + 1}. [${it.finalScore}] ${String(it.title).slice(0, 90)}**\n` +
        `${it.judgeReason ? '🧠 ' + String(it.judgeReason).slice(0, 90) + '\n' : ''}<${it.url}>\n`;
      // Discord จำกัด 2000 ตัวอักษร/ข้อความ — เกินแล้วขึ้นก้อนใหม่
      if ((block + line).length > 1850) { messages.push(block); block = ''; }
      block += line;
    });
    messages.push(block);
  }

  let sentCount = 0;
  for (const content of messages) {
    if (!content.trim()) continue;
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok || res.status === 204) sentCount++;
      else console.log('[MorningMenu] webhook ตอบ', res.status);
      await new Promise(r => setTimeout(r, 600)); // กัน rate limit
    } catch (e) { console.log('[MorningMenu] webhook error:', e.message?.slice(0, 50)); }
  }
  return { sent: sentCount > 0, messages: sentCount };
}

async function buildAndSend(request) {
  // เก็บรอบใหม่ก่อนเสมอ — เมนูเช้าต้องสะท้อนข่าวข้ามคืน
  await pruneOldItems(3);
  const stats = await runHarvest({ judgeTop: 30 });

  const store = createStore('news-desk');
  const items = await store.getAll();
  const menu = buildMenu(items);
  const totalInMenu = Object.values(menu).reduce((s, arr) => s + arr.length, 0);

  const deskUrl = `${request.nextUrl.origin}/news-desk`;
  const discord = await sendDiscord(menu, deskUrl);

  console.log(`[MorningMenu] ✅ เมนู ${totalInMenu} ข่าว | discord: ${JSON.stringify(discord)}`);
  return NextResponse.json({
    success: true,
    harvest: stats,
    menuCount: totalInMenu,
    discord,
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
