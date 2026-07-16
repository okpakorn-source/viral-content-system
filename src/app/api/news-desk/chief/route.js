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
    // ★ สั่ง บก. ด้วยข้อความ (ผู้ใช้ 11 มิ.ย.): ไม่ต้องรอรอบ cron — พิมพ์สั่งให้ไปตรวจ/วิเคราะห์/หาอะไรก็ได้
    const body = await request.json().catch(() => ({}));
    const instruction = String(body.instruction || '').slice(0, 300);
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

    // ★ ความจำรอบก่อน — บก.ใหญ่ต้องรู้ว่าตัวเองสั่งอะไรไปแล้ว จะได้ไม่พูดซ้ำ (feedback ผู้ใช้ 11 มิ.ย.: "ข้อความเดิมตลอด")
    const settingsStore = createStore('desk-settings');
    const prevBrief = (await settingsStore.getAll()).find(s => s.id === 'chief_brief') || null;
    const prevPushed = (prevBrief?.pushNow || []).map(s => String(s));
    const sinceLast = prevBrief?.at ? new Date(prevBrief.at).getTime() : Date.now() - 6 * 3600e3;
    const newSinceLast = fresh.filter(i => new Date(i.harvestedAt || 0).getTime() > sinceLast)
      .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

    // ★ คะแนนเสื่อมตามอายุ (ตรงกับหน้า feed) — ของเก่าจมเอง ไม่ค้างหัวตารางทั้งวัน
    const DECAY = { trend: 8, good: 3, evergreen: 0, followup: 4, interview: 0, buzz: 10 };
    const decayScore = (i) => {
      const ageDays = Math.max(0, (Date.now() - new Date(i.harvestedAt || 0).getTime()) / 864e5);
      return Math.max(0, Math.round((i.finalScore || 0) - ageDays * (DECAY[i.lane] ?? 4)));
    };
    const topUnclaimed = fresh.map(i => ({ ...i, _ds: decayScore(i) }))
      .sort((a, b) => b._ds - a._ds).slice(0, 10)
      .map(i => {
        // เทียบแบบตัดช่องว่าง/เครื่องหมายคำพูดทิ้ง — ชื่อเดียวกันแต่เว้นวรรคต่างกันต้องจับได้
        const norm = (s) => String(s || '').replace(/[\s"“”'‘’!]/g, '');
        const nt = norm(i.title);
        const pushedBefore = prevPushed.some(p => {
          const np = norm(p);
          return np.length >= 10 && (nt.includes(np.slice(0, 14)) || np.includes(nt.slice(0, 14)));
        });
        return `[${i._ds}] ${String(i.title).slice(0, 60)} (${i.category})${pushedBefore ? ' ← สั่งดันรอบก่อนแล้ว ทีมยังไม่หยิบ' : ''}`;
      });

    // ── สมองใหญ่วินิจฉัย ──
    const hour = new Date().toLocaleString('th-TH', { hour: 'numeric', timeZone: 'Asia/Bangkok' });
    const res = await callAI({
      prompt: `คุณคือหัวหน้ากองบรรณาธิการเพจข่าวไวรัลไทย ตอนนี้ ${hour} นาฬิกา เป้าทีม: 30-100 ข่าว/วัน ผสมน้ำดี ≥40% ดราม่า ≤20%

สถานการณ์ตอนนี้:
- คลังพร้อมทำ (สดภายใน 36 ชม.): ${JSON.stringify(byLane)} รวม ${fresh.length} ใบ
- วันนี้ส่งทำแล้ว ${sentToday.length} ข่าว ส่วนผสม: ${JSON.stringify(mixToday)}
- ข่าวเข้าใหม่ตั้งแต่รอบก่อนของคุณ: ${newSinceLast.length} ใบ ตัวเด่น:\n${newSinceLast.slice(0, 5).map(i => `[${decayScore(i)}] ${String(i.title).slice(0, 60)}`).join('\n') || '(ไม่มีของใหม่เข้าเลย — บอกทีมตรงๆ ว่ารอบนี้คลังนิ่ง)'}
- ตัวท็อปที่ยังไม่มีใครหยิบ:\n${topUnclaimed.join('\n') || '(ว่าง)'}
- การตัดสินใจล่าสุดของทีม (เลือก/ทิ้ง/ปัง/แป้ก):\n${recentFb.join('\n') || '(ยังไม่มี)'}
- โพสต์แรงในตลาดที่ทีมรายงานเข้ามา:\n${recentMkt.join('\n') || '(ยังไม่มี)'}
${prevBrief ? `- รอบก่อนคุณสั่งไปแล้ว (${new Date(prevBrief.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })} น.): ${(prevBrief.orders || []).join(' / ')} | ดันไปแล้ว: ${prevPushed.join(' · ') || '-'}` : ''}

${instruction ? `★★★ คำสั่งพิเศษจากหัวหน้าทีม (มนุษย์) — ต้องตอบ/จัดการข้อนี้เป็นอันดับแรกใน orders:\n"${instruction}"\n` : ''}
หน้าที่:
1. วินิจฉัย: วันนี้ขาดอะไร (ปริมาณ? หมวดไหนบาง? ตลาดกำลังเล่นอะไรที่เราไม่มีของ?)
2. สั่งคำค้นพิเศษ 3-6 ชุดให้หน่วยลาดตระเวนไปเก็บ "เดี๋ยวนี้" — คำค้นต้องเฉพาะเจาะจง หา "เรื่องใหม่" ที่ยังไม่มีในคลัง ห้ามสั่งซ้ำเรื่องที่อยู่ในคลังแล้ว ห้ามกว้างแบบ "ข่าววันนี้"
3. สั่งทีมเป็นข้อสั้นๆ — แต่ละข้อความยาวไม่เกิน 90 ตัวอักษร อ่านแวบเดียวรู้เรื่อง

กฎห้ามพูดซ้ำ (สำคัญมาก):
- ห้ามออกคำสั่ง (orders) ที่ใจความเหมือนรอบก่อน — ถ้าสถานการณ์เดิม ให้ขยับไปสั่งเรื่องถัดไปที่ยังไม่เคยสั่ง
- pushNow เลือกได้เฉพาะจากรายการ "ตัวท็อปที่ยังไม่มีใครหยิบ" เท่านั้น และต้องคัดลอกชื่อข่าวจากรายการตรงตัวทุกตัวอักษร (ตัดท้ายให้สั้นได้ แต่ห้ามเรียบเรียงใหม่) — ห้ามเลือกตัวที่ติดป้าย "สั่งดันรอบก่อนแล้ว" ถ้าตัวท็อปติดป้ายหมด ให้ใส่ orders ว่า "ข่าวที่สั่งดันรอบก่อนยังไม่มีใครหยิบ: <ชื่อ>" แทนการดันซ้ำ
- ถ้ามีข่าวเข้าใหม่ ให้พิจารณาของใหม่ก่อนเสมอ

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
        `🆕 ข่าวเข้าใหม่ตั้งแต่รอบก่อน **${newSinceLast.length}** ใบ · คลังพร้อมเลือก ${fresh.length} ใบ · วันนี้ส่งทำ ${sentToday.length}`,
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
