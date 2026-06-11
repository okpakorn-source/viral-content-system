/**
 * Chief Editor Agent — บรรณาธิการใหญ่ AI (News Desk)
 * รอบ 12:30 + 18:30 ไทย (Vercel Cron) หรือสั่งเองผ่านปุ่ม
 * ทำอะไร: มองภาพรวมวัน (คลังเหลืออะไร/ทีมส่งทำอะไรไป/โพสต์แรงตลาดบอกอะไร/ปัง-แป้กล่าสุด)
 *        → วินิจฉัยช่องว่าง → "สั่งคำค้นพิเศษ" ให้ Scout เก็บเพิ่มทันที → สรุป brief สั้นแปะหน้าโต๊ะ + Discord
 */
import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { callAI } from '@/lib/ai/openai';
import { runHarvest } from '@/lib/services/newsDesk/harvester';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

let _chiefLock = Promise.resolve();

async function getWebhookUrl() {
  if (process.env.DISCORD_WEBHOOK_URL) return process.env.DISCORD_WEBHOOK_URL;
  try {
    const store = createStore('desk-settings');
    const all = await store.getAll();
    return all.find(s => s.id === 'discord_webhook')?.url || null;
  } catch { return null; }
}

export async function POST(request) {
  const prev = _chiefLock;
  let release;
  _chiefLock = new Promise((r) => (release = r));
  await prev;
  try {
    const t0 = Date.now();
    const desk = createStore('news-desk');
    const fbStore = createStore('news-desk-feedback');
    const mktStore = createStore('market-hot-posts');

    const [items, feedback, market] = await Promise.all([desk.getAll(), fbStore.getAll(), mktStore.getAll()]);
    const today = new Date().toISOString().slice(0, 10);

    // ── รวบสถานการณ์ ──
    const fresh = items.filter(i => i.status === 'new' && Date.now() - new Date(i.harvestedAt || 0).getTime() < 36 * 3600e3);
    const byLane = {};
    for (const i of fresh) byLane[i.lane] = (byLane[i.lane] || 0) + 1;
    const sentToday = items.filter(i => i.status === 'sent' && String(i.sentAt || '').startsWith(today));
    const mixToday = {};
    for (const s of sentToday) mixToday[s.category || 'อื่นๆ'] = (mixToday[s.category || 'อื่นๆ'] || 0) + 1;
    const recentFb = feedback.slice(-25).map(f => `${f.action}: ${String(f.title).slice(0, 60)} [${f.category || ''}]`);
    const recentMkt = market.slice(-10).map(m => `${m.topic} — แรงเพราะ: ${m.whyViral}${m.rewriteAngle ? ' | มุมที่เล่นได้: ' + m.rewriteAngle : ''}`);
    const topUnclaimed = fresh.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0)).slice(0, 10)
      .map(i => `[${i.finalScore}] ${String(i.title).slice(0, 60)} (${i.category})`);

    // ── สมองใหญ่วินิจฉัย ──
    const hour = new Date().toLocaleString('th-TH', { hour: 'numeric', timeZone: 'Asia/Bangkok' });
    const res = await callAI({
      prompt: `คุณคือหัวหน้ากองบรรณาธิการเพจข่าวไวรัลไทย ตอนนี้ ${hour} นาฬิกา เป้าทีม: 30-100 ข่าว/วัน ผสมน้ำดี ≥40% ดราม่า ≤20%

สถานการณ์ตอนนี้:
- คลังพร้อมทำ (สดภายใน 36 ชม.): ${JSON.stringify(byLane)} รวม ${fresh.length} ใบ
- วันนี้ส่งทำแล้ว ${sentToday.length} ข่าว ส่วนผสม: ${JSON.stringify(mixToday)}
- ตัวท็อปที่ยังไม่มีใครหยิบ:\n${topUnclaimed.join('\n') || '(ว่าง)'}
- การตัดสินใจล่าสุดของทีม (เลือก/ทิ้ง/ปัง/แป้ก):\n${recentFb.join('\n') || '(ยังไม่มี)'}
- โพสต์แรงในตลาดที่ทีมรายงานเข้ามา:\n${recentMkt.join('\n') || '(ยังไม่มี)'}

หน้าที่:
1. วินิจฉัย: วันนี้ขาดอะไร (ปริมาณ? หมวดไหนบาง? ตลาดกำลังเล่นอะไรที่เราไม่มีของ?)
2. สั่งคำค้นพิเศษ 3-6 ชุดให้หน่วยลาดตระเวนไปเก็บ "เดี๋ยวนี้" — คำค้นต้องเฉพาะเจาะจง หา "เรื่องใหม่" ที่ยังไม่มีในคลัง ห้ามสั่งซ้ำเรื่องที่อยู่ในคลังแล้ว ห้ามกว้างแบบ "ข่าววันนี้"
3. สั่งทีมเป็นข้อสั้นๆ — แต่ละข้อความยาวไม่เกิน 90 ตัวอักษร อ่านแวบเดียวรู้เรื่อง

ตอบ JSON เท่านั้น:
{"diagnosis":"สั้นๆ 1 ประโยค",
"orders":["คำสั่งหลัก 1-3 ข้อ เช่น 'เร่งหยิบข่าว 78+ น้ำดี 2-3 : ครอบครัว 1'"],
"warnings":["ข้อควรระวัง 0-2 ข้อ เช่น 'ข่าวเจนนี่ เขียนโทนอบอุ่น ห้ามโจมตีครอบครัว'"],
"pushNow":["ชื่อข่าวสั้นๆ ที่ควรดันตอนนี้ 0-4 เรื่อง"],
"extraQueries":[{"q":"คำค้น","lane":"trend|good|evergreen","timeRange":"qdr:d|qdr:w|qdr:y"}]}`,
      model: 'gpt-5.5',
      temperature: 0.3,
      maxTokens: 8000,
    });
    const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
    const extraQueries = (parsed.extraQueries || []).slice(0, 6)
      .filter(e => e?.q && String(e.q).length >= 4)
      .map(e => ({ q: String(e.q).slice(0, 80), lane: ['trend', 'good', 'evergreen'].includes(e.lane) ? e.lane : 'trend', timeRange: e.timeRange }));

    // ── สั่ง Scout เก็บตามคำสั่งทันที ──
    let harvestStats = null;
    if (extraQueries.length > 0) {
      harvestStats = await runHarvest({ lanes: [], extraQueries, judgeTop: 16 });
    }

    // ── แปะ brief หน้าโต๊ะ + ยิง Discord (รูปแบบหัวข้อสั้น อ่านแวบเดียวรู้เรื่อง) ──
    const orders = (parsed.orders || []).slice(0, 3).map(s => String(s).slice(0, 100));
    const warnings = (parsed.warnings || []).slice(0, 2).map(s => String(s).slice(0, 100));
    const pushNow = (parsed.pushNow || []).slice(0, 4).map(s => String(s).slice(0, 60));
    const brief = {
      id: 'chief_brief',
      at: new Date().toISOString(),
      diagnosis: String(parsed.diagnosis || '').slice(0, 200),
      orders, warnings, pushNow,
      brief: orders.join(' · '), // เผื่อ UI เก่า
      extraQueries: extraQueries.map(e => e.q),
      harvested: harvestStats?.added || 0,
    };
    const settings = createStore('desk-settings');
    const all = await settings.getAll();
    if (all.find(s => s.id === 'chief_brief')) await settings.update('chief_brief', (ex) => ({ ...ex, ...brief }));
    else await settings.add(brief);

    const webhook = await getWebhookUrl();
    if (webhook && (orders.length || warnings.length)) {
      const lines = [
        `## 🧠 บก.ใหญ่ AI — ${hour} น.`,
        ...(orders.length ? ['**📌 คำสั่งตอนนี้**', ...orders.map(o => `> ${o}`)] : []),
        ...(warnings.length ? ['**⚠️ ระวัง**', ...warnings.map(w => `> ${w}`)] : []),
        ...(pushNow.length ? ['**🚀 ดันทันที**', '> ' + pushNow.join(' · ')] : []),
        ...(extraQueries.length ? [`🔎 สั่งลาดตระเวนเพิ่ม ${extraQueries.length} คำค้น → ได้ข่าวใหม่ ${brief.harvested} ใบ`] : []),
      ];
      await fetch(webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: lines.join('\n').slice(0, 1950) }),
      }).catch(() => {});
    }

    console.log(`[Chief] ✅ ${brief.diagnosis.slice(0, 80)} | extra ${extraQueries.length} queries → +${brief.harvested} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    return NextResponse.json({ success: true, ...brief, harvestStats });
  } catch (error) {
    console.error('[Chief]', error.message);
    return NextResponse.json({ success: false, error: error.message, errorType: 'CHIEF_ERROR' }, { status: 500 });
  } finally {
    release();
  }
}

export async function GET(request) {
  return POST(request);
}
