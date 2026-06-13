/**
 * =====================================================
 * News Desk Harvester — เครื่องเก็บข่าวเข้าโต๊ะข่าว (เฟส 1)
 * =====================================================
 * เลน 🔥 trend : Serper News ตามชุดคำค้นกระแส (สดภายใน 24-48 ชม.)
 * เลน 💎 good  : Serper News ชุดคำค้นน้ำดี — หมุนคำอัตโนมัติตามวัน ไม่ให้เจอแต่ข่าวซ้ำ
 * จากนั้นส่งเข้าสมอง 4 ชั้น (deskBrain) → ลงคลัง store 'news-desk'
 */

import crypto from 'crypto';
import { createStore } from '@/lib/persistStore';
import {
  gateKeywords, classifyBatch, fitScore, freshScore,
  loadArchiveTitles, isDuplicateOfArchive, editorialJudge, finalScore,
  getCategoryPerformance,
} from './deskBrain';

// ★ คลังคำค้นกระแส — ผ่าตัด 13 มิ.ย. 69 (ตัดคำกว้างที่ดูดขยะอากาศ/การเมือง/บอลออก)
//   เน้นเรื่องคน-ไวรัล-ดราม่าที่เพจเล่นได้จริง ไม่ใช่ "ข่าวสังคมวันนี้/โหนกระแส" ที่ดูดมั่ว
const TREND_QUERY_POOL = [
  'แห่ชื่นชม น้ำใจ ล่าสุด', 'สุดซึ้ง ชาวเน็ต ล่าสุด', 'คลิปไวรัล ประทับใจ ล่าสุด',
  'ครูนักเรียน เรื่องราวดี ไวรัล', 'คลิปกล้องวงจรปิด ช่วยเหลือ', 'ขอความเป็นธรรม ดราม่า ล่าสุด',
  'ดราม่าร้านดัง ล่าสุด', 'คนดังตอบกลับ ดราม่า ล่าสุด', 'เปิดใจทั้งน้ำตา ล่าสุด',
  'พลเมืองดี ไวรัล ล่าสุด', 'ทำดีได้ดี เรื่องจริง ไวรัล', 'สะเทือนใจ ชาวเน็ตแห่แชร์',
  'ช่วยกันแชร์ ตามหา ล่าสุด', 'หนุ่มสาวสู้ชีวิต ไวรัล', 'รีวิวร้านเด็ด คนแห่ ล่าสุด', 'คนดังทำดี ไวรัล ล่าสุด',
];

function pickTrendQueries(count = 8) {
  const slot = Math.floor(Date.now() / (3600e3 * 3)); // หมุนทุก 3 ชม. — รอบถัดไปได้คำใหม่ ไม่ชน dedupe เดิม
  const out = [];
  for (let i = 0; i < count; i++) out.push(TREND_QUERY_POOL[(slot * count + i) % TREND_QUERY_POOL.length]);
  return out;
}

// คลังคำค้นน้ำดี — หมุนวันละ 4 ชุดตามวันของปี (ครอบ pattern ที่ผู้ใช้ยกตัวอย่าง)
const GOOD_QUERY_POOL = [
  'น้ำใจคนไทย ช่วยเหลือ ล่าสุด', 'พลเมืองดี ช่วยชีวิต', 'คืนเงิน เก็บเงินได้ ส่งคืนเจ้าของ',
  'ลูกกตัญญู ดูแลแม่ ดูแลพ่อ', 'เด็กเก็บขยะ เรียนดี ทุนการศึกษา', 'ครูเสียสละ โรงเรียนห่างไกล',
  'ดาราใจบุญ บริจาค ช่วยเหลือ', 'ดาราติดดิน กินข้างทาง', 'คนดังสร้างบ้านให้ ยกที่ดิน',
  'ลุงป้าสู้ชีวิต ขายของ', 'คนพิการสู้ชีวิต ไม่ยอมแพ้', 'เก็บเงิน 10 ปี ทำตามฝัน',
  'กู้ภัยช่วยชีวิต นาทีชีวิต', 'หมอพยาบาลน้ำใจ ผู้ป่วยยากไร้', 'ทหารตำรวจช่วยประชาชน น้ำใจ',
  'คนแก่เก็บขวดขาย หาเลี้ยงหลาน', 'ร้านอาหารแจกฟรี คนตกงาน', 'นักเรียนช่วยคนแก่ ข้ามถนน ไวรัล',
];

function pickGoodQueries(count = 4) {
  const day = Math.floor(Date.now() / 86400000);
  const out = [];
  for (let i = 0; i < count; i++) out.push(GOOD_QUERY_POOL[(day * count + i) % GOOD_QUERY_POOL.length]);
  return out;
}

// ── เลน 🗄️ Evergreen (เฟส 2): ข่าวเก่าน้ำดีที่หยิบมาทำใหม่ได้ — บ่อที่ไม่มีวันแห้ง ──
// pattern จากผู้ใช้: "ดาราเคยสร้างบ้านให้คนจน / ยกที่ดิน / ติดดิน / กินก๋วยเตี๋ยวข้างทาง"
const EVERGREEN_PATTERNS = [
  'ดาราสร้างบ้านให้พ่อแม่', 'ดาราสร้างบ้านให้คนจน', 'คนดังยกที่ดิน บริจาคที่ดิน',
  'ดาราติดดิน กินข้าวแกงข้างทาง', 'ดาราขับวินมอเตอร์ไซค์ ขายของตลาด', 'นักร้องดังกลับบ้านเกิด ทำนา',
  'ดาราเลี้ยงดูพ่อแม่ป่วย กตัญญู', 'คนดังช่วยค่ารักษา เด็กป่วย', 'ดาราใช้หนี้ให้พ่อแม่',
  'เศรษฐีใจบุญ สร้างโรงเรียน สร้างวัด', 'อดีตดารา ชีวิตเรียบง่าย ปัจจุบัน', 'ดาราเปิดร้านเล็กๆ สู้ชีวิต',
  'คนเก็บขยะส่งลูกเรียนจบ', 'แม่ค้าใจบุญ เลี้ยงข้าวคนจร', 'คุณตาคุณยายสู้ชีวิต ไวรัล',
  'เด็กยอดกตัญญู ทำงานส่งตัวเองเรียน', 'วินมอเตอร์ไซค์น้ำใจงาม', 'แท็กซี่คืนของ ผู้โดยสารลืม',
  'คนไทยในต่างแดน สร้างชื่อ', 'นักเรียนช่วยชีวิต CPR', 'เจ้าของร้านใจดี แจกอาหารฟรี',
  'ชาวบ้านรวมเงินช่วย เพื่อนบ้าน', 'หนุ่มสาวออฟฟิศลาออก ทำตามฝัน สำเร็จ', 'คนเลี้ยงหมาแมวจร ใจบุญ',
];

function pickEvergreenQueries(count = 3) {
  const day = Math.floor(Date.now() / 86400000);
  const out = [];
  for (let i = 0; i < count; i++) out.push(EVERGREEN_PATTERNS[(day * count + i + 7) % EVERGREEN_PATTERNS.length]);
  return out;
}

// ── เลน 🔁 Follow-up (เฟส 3): ตามรอยข่าวที่เพจเคยทำ — "ตอนนี้เป็นยังไงแล้ว" ──
// หยิบข่าวเก่าในคลังเพจ (อายุ ≥21 วัน, มีตัวบุคคล) วันละ 3 เรื่อง → ค้นความเคลื่อนไหวล่าสุดของคนนั้น
async function buildFollowupQueries(count = 3) {
  try {
    const archive = createStore('news-archive');
    const all = await archive.getAll();
    const cutoff = Date.now() - 21 * 864e5;
    // ★ quick-fix: key_people ใน archive ปนชื่อละคร/รายการ (เคยได้ "เรื่องย่อธาตรี" มาเป็นตามรอย)
    const NOT_PERSON = /ละคร|รายการ|เรื่องย่อ|ตอนที่|ช่อง\s?\d|ศึก|ทีมชาติ|โรงเรียน|มูลนิธิ|บริษัท|วัด|ตำบล|อำเภอ|จังหวัด|ประเทศ|กระทรวง|ตำรวจภูธร/;
    const candidates = all
      .filter(a => {
        const t = new Date(a.archived_at || a.createdAt || 0).getTime();
        const person = (a.key_people || []).find(p => p && String(p).length >= 3 && String(p).length <= 35 && !NOT_PERSON.test(p));
        if (person) a._followPerson = person;
        return t > 0 && t < cutoff && !!person;
      })
      // เรื่องที่เคยถูกใช้/คะแนนไวรัลสูงมาก่อน = น่าตามรอยสุด
      .sort((a, b) => ((b.viral_score || 0) + (b.used_count || 0) * 10) - ((a.viral_score || 0) + (a.used_count || 0) * 10));
    const day = Math.floor(Date.now() / 86400000);
    const out = [];
    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      const pick = candidates[(day * count + i) % candidates.length];
      out.push({
        query: `"${String(pick._followPerson || pick.key_people[0]).slice(0, 30)}" ล่าสุด`,
        followupOf: String(pick.title || '').slice(0, 90),
      });
    }
    return out;
  } catch (e) {
    console.log('[Harvester] followup build failed:', e.message?.slice(0, 50));
    return [];
  }
}

async function serperNews(query, { num = 10, timeRange = 'qdr:d' } = {}) {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('ไม่มี SERPER_API_KEY');
  const res = await fetch('https://google.serper.dev/news', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'th', hl: 'th', num, tbs: timeRange }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data = await res.json();
  return (data.news || []).map(n => ({
    title: n.title || '',
    snippet: n.snippet || '',
    url: n.link || '',
    source: n.source || '',
    publishedAt: n.date ? parseSerperDate(n.date) : null,
    imageUrl: n.imageUrl || '',
  }));
}

// Serper ส่งวันที่แบบ "3 hours ago" / "2 days ago" — แปลงเป็น ISO คร่าวๆ
function parseSerperDate(d) {
  const m = String(d).match(/(\d+)\s*(minute|hour|day|week|month)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unitMs = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 }[m[2].toLowerCase()];
  return new Date(Date.now() - n * unitMs).toISOString();
}

const idOf = (url) => crypto.createHash('md5').update(String(url)).digest('hex').slice(0, 12);

// ── เลน 📊 BuzzSumo (แชร์จริง): RSS Trending Thailand — ทำงานเมื่อบัญชี BuzzSumo จ่ายแล้ว ──
async function getBuzzsumoRssUrl() {
  if (process.env.BUZZSUMO_RSS_URL) return process.env.BUZZSUMO_RSS_URL;
  try {
    const store = createStore('desk-settings');
    const all = await store.getAll();
    return all.find(s => s.id === 'buzzsumo_rss')?.url || null;
  } catch { return null; }
}

function parseRssItems(xml) {
  const items = [];
  const blocks = String(xml).match(/<item[\s\S]*?<\/item>/g) || [];
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m) return '';
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
  };
  for (const b of blocks.slice(0, 25)) {
    items.push({
      title: pick(b, 'title'),
      url: pick(b, 'link'),
      snippet: pick(b, 'description').slice(0, 200),
      publishedAt: (() => { const d = new Date(pick(b, 'pubDate')); return isNaN(d) ? null : d.toISOString(); })(),
      source: 'BuzzSumo Trending',
    });
  }
  return items.filter(i => i.title && i.url);
}

async function harvestBuzzsumo() {
  const url = await getBuzzsumoRssUrl();
  if (!url) return [];
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'ViralFlow-NewsDesk/1.0' } });
    const body = await res.text();
    if (!res.ok || /paid BuzzSumo subscription/i.test(body)) {
      console.log('[Harvester] 📊 BuzzSumo ยังไม่เปิดใช้ (รอจ่ายแพลน) — ข้ามเลนนี้');
      return [];
    }
    const items = parseRssItems(body).map(r => ({ ...r, lane: 'buzz' }));
    console.log(`[Harvester] 📊 BuzzSumo Trending: ${items.length} ใบ`);
    return items;
  } catch (e) {
    console.log('[Harvester] buzzsumo failed:', e.message?.slice(0, 50));
    return [];
  }
}

/**
 * รันเก็บ+คัดกรองครบ 4 ชั้น แล้วลงคลัง
 * @returns {Promise<{harvested, gated, classified, judged, added}>}
 */
export async function runHarvest({ lanes = ['trend', 'good', 'evergreen', 'followup', 'buzz'], judgeTop = 24, extraQueries = [] } = {}) {
  const t0 = Date.now();
  const store = createStore('news-desk');
  const existing = await store.getAll();
  const existingIds = new Set(existing.map(e => e.id));
  const stats = { harvested: 0, dupSkipped: 0, gated: 0, archiveDup: 0, judged: 0, added: 0 };

  // ── เก็บดิบ ──
  const raw = [];
  if (lanes.includes('trend')) {
    for (const q of pickTrendQueries(8)) {
      try { raw.push(...(await serperNews(q, { num: 10, timeRange: 'qdr:d' })).map(r => ({ ...r, lane: 'trend' }))); }
      catch (e) { console.log('[Harvester] trend query failed:', e.message?.slice(0, 50)); }
    }
  }
  if (lanes.includes('good')) {
    // ★ กองสืบน้ำดี (13 มิ.ย. 69): สมองสืบคิดคำค้นสด + ค้นดาราด้วยชื่อ — ตกลงมาใช้คำค้นตายตัวถ้าล่ม
    //   คำค้นดารา (genre='ดาราดังทำดี') ใช้ qdr:m (1 เดือน) — ข่าวดาราทำดีไม่ได้เกิดทุกสัปดาห์ ย้อนเดือนเจอมากกว่า
    //   storyNature filter ด้านล่างกันของเก่าเกินไปอยู่แล้ว
    let goodQueries = []; // [{q, isCeleb}]
    try {
      const { generateScoutQueries } = await import('./goodNewsScout');
      const scout = await generateScoutQueries(6);
      goodQueries = scout.map(x => ({ q: x.q, isCeleb: x.genre === 'ดาราดังทำดี' }));
    } catch (e) { console.log('[Harvester] scout import failed:', e.message?.slice(0, 50)); }
    if (goodQueries.length < 3) goodQueries = pickGoodQueries(6).map(q => ({ q, isCeleb: false })); // fallback
    for (const { q, isCeleb } of goodQueries) {
      try { raw.push(...(await serperNews(q, { num: 8, timeRange: isCeleb ? 'qdr:m' : 'qdr:w' })).map(r => ({ ...r, lane: 'good' }))); }
      catch (e) { console.log('[Harvester] good query failed:', e.message?.slice(0, 50)); }
    }
  }
  // ★ คำค้นพิเศษจาก Chief Editor Agent — เติมตามช่องว่างของวัน
  for (const ex of extraQueries) {
    try {
      raw.push(...(await serperNews(ex.q, { num: 8, timeRange: ex.timeRange || 'qdr:d' })).map(r => ({ ...r, lane: ex.lane || 'trend' })));
    } catch (e) { console.log('[Harvester] extra query failed:', e.message?.slice(0, 50)); }
  }
  if (lanes.includes('evergreen')) {
    // ไม่จำกัดเวลา — ของเก่าน้ำดีคือเป้าหมาย (วันไหนกระแสแห้ง เลนนี้คือบ่อสำรอง)
    for (const q of pickEvergreenQueries(4)) {
      try { raw.push(...(await serperNews(q, { num: 8, timeRange: 'qdr:y' })).map(r => ({ ...r, lane: 'evergreen' }))); }
      catch (e) { console.log('[Harvester] evergreen query failed:', e.message?.slice(0, 50)); }
    }
  }
  if (lanes.includes('buzz')) {
    raw.push(...await harvestBuzzsumo());
  }
  if (lanes.includes('followup')) {
    // ตามรอยบุคคลจากข่าวที่เพจเคยทำ — ความเคลื่อนไหวสัปดาห์ล่าสุด
    for (const f of await buildFollowupQueries(3)) {
      try {
        raw.push(...(await serperNews(f.query, { num: 5, timeRange: 'qdr:w' }))
          .map(r => ({ ...r, lane: 'followup', followupOf: f.followupOf })));
      } catch (e) { console.log('[Harvester] followup query failed:', e.message?.slice(0, 50)); }
    }
  }
  stats.harvested = raw.length;

  // ── กันซ้ำในคลังตัวเอง (url เดิม) ──
  const fresh = [];
  const seen = new Set();
  for (const r of raw) {
    if (!r.url || !r.title) continue;
    const id = idOf(r.url);
    if (existingIds.has(id) || seen.has(id)) { stats.dupSkipped++; continue; }
    seen.add(id);
    fresh.push({ ...r, id });
  }

  // ── ชั้น 0: คำต้องห้าม ──
  const gated = [];
  for (const item of fresh) {
    const g = gateKeywords(item);
    if (!g.pass) { stats.gated++; continue; }
    gated.push(item);
  }

  // ── ชั้น 1: จัดหมวด + วัดพิษ ──
  let classified = await classifyBatch(gated);
  // ทิ้งตัวพิษเกิน/เกลาไม่ได้
  classified = classified.filter(c => c.toxicity < 3 && c.fbRisk < 3 && c.toneable !== false);

  // ── ★ ตัดต่างประเทศทิ้งที่ชั้นนี้ (13 มิ.ย. 69 คำสั่งทีม "เอาแค่ไทย"): เนื้อหาที่ classify ตีเป็นเหตุการณ์ตปท. ──
  //   domain block จับเว็บนอกแล้ว ตรงนี้จับ "เว็บไทยลงข่าวต่างชาติ" (กอริลลา/เศรษฐกิจฟิลิปปินส์) ที่ติด foreignCountry
  stats.foreignDropped = 0;
  classified = classified.filter(c => {
    if (c.foreignCountry) { stats.foreignDropped++; console.log(`[Harvester] 🌏 ตัดต่างประเทศ (${c.foreignCountry}): ${String(c.title).slice(0, 50)}`); return false; }
    return true;
  });

  // ── ★ กรองกระแสอดีต (ทีมสั่ง 12 มิ.ย. ค่ำ — เคสเจนนี่จ่ายหนี้แม่): "เหตุการณ์ครั้งเดียว" ที่เก่าแล้ว ≠ ข่าวน้ำดีไร้กาลเวลา ──
  //   เลน evergreen ตั้งใจค้นย้อนทั้งปี → รับเฉพาะเรื่องแบบแผน (pattern) เท่านั้น
  //   เลนอื่น: event ที่เผยแพร่เกิน 30 วัน = ขุดของเก่า ทิ้ง
  stats.staleEvent = 0;
  classified = classified.filter(c => {
    if (c.storyNature !== 'event') return true;
    const ageDays = c.publishedAt ? (Date.now() - new Date(c.publishedAt).getTime()) / 864e5 : null;
    if (c.lane === 'evergreen') { stats.staleEvent++; console.log(`[Harvester] ⏳ ตัดกระแสอดีต (evergreen+event): ${String(c.title).slice(0, 55)}`); return false; }
    if (ageDays !== null && ageDays > 30) { stats.staleEvent++; console.log(`[Harvester] ⏳ ตัดกระแสอดีต (event เก่า ${Math.round(ageDays)} วัน): ${String(c.title).slice(0, 55)}`); return false; }
    return true;
  });

  // ── ชั้น 2: กันซ้ำกับที่เพจเคยทำ (ยกเว้นเลน followup — ตั้งใจตามเรื่องคนเดิมอยู่แล้ว) ──
  const archiveTitles = await loadArchiveTitles();
  classified = classified.filter(c => {
    if (c.lane === 'followup') return true;
    if (isDuplicateOfArchive(c.title, archiveTitles)) { stats.archiveDup++; return false; }
    return true;
  });

  // ── ชั้น 3: บรรณาธิการ AI เฉพาะตัวท็อป (เรียงคร่าวด้วย fit+fresh ก่อน) ──
  // ★ เฟส 3: น้ำหนักหมวดปรับตามผลโพสต์จริง (ปัง/แป้ก) ที่ทีมรายงานกลับ
  const perfBoost = await getCategoryPerformance();
  classified.sort((a, b) => (fitScore(b.category, perfBoost) + freshScore(b.publishedAt)) - (fitScore(a.category, perfBoost) + freshScore(a.publishedAt)));
  const toJudge = classified.slice(0, judgeTop);
  const rest = classified.slice(judgeTop);
  const judged = await editorialJudge(toJudge);
  stats.judged = judged.filter(j => j.judgeScore !== undefined).length;

  // ── ลงคลัง ──
  const now = new Date().toISOString();
  const finalItems = [...judged, ...rest].map(it => ({
    ...it,
    finalScore: finalScore(it, perfBoost),
    status: 'new',
    claimedBy: null,
    harvestedAt: now,
  }));

  // ★ ป้ายเตือนเรื่องซ้ำแบบไม่บล็อก (คำสั่งทีม 12 มิ.ย.): ใบใหม่เรื่องเดียวกับที่ "ส่งเจนไปแล้ว" ใน 72 ชม.
  //   → ติดป้าย sameStoryAs ให้ทีมเห็น (ยังหยิบทำซ้ำได้ตามนโยบาย — กระแสใหญ่บางทีตั้งใจเล่นซ้ำ)
  // ★ + ควบเรื่องเดียวกันคนละแหล่ง (ทีมสั่ง 12 มิ.ย. ค่ำ): ใบใหม่ที่เรื่องตรงกับใบ "new" บนโต๊ะ
  //   หรือตรงกันเองในรอบเดียวกัน → ไม่สร้างใบซ้ำ แต่เก็บเป็น "แหล่งเสริม" (altSources) บนใบหลัก
  let toAdd = finalItems;
  try {
    const allExisting = await store.getAll();
    const normT = (s) => String(s || '').replace(/[\s"“”'‘’!|…]/g, '').slice(0, 60);
    const sameStory = (a, b) => a.length >= 12 && b.length >= 12 && (a.includes(b.slice(0, 16)) || b.includes(a.slice(0, 16)));

    const sentRecent = allExisting.filter(i =>
      i.status === 'sent' && Date.now() - new Date(i.sentAt || i.harvestedAt || 0).getTime() < 72 * 3600e3);
    const newOnDesk = allExisting.filter(i => i.status === 'new');

    stats.mergedSources = 0;
    const kept = [];
    for (const it of finalItems) {
      const nt = normT(it.title);
      // ป้ายเรื่องซ้ำกับที่ส่งเจนแล้ว (เดิม)
      const hitSent = sentRecent.find(ex => sameStory(nt, normT(ex.title)));
      if (hitSent) it.sameStoryAs = { id: hitSent.id, title: String(hitSent.title).slice(0, 60) };

      // ควบกับใบ new บนโต๊ะ → อัพเดทใบเดิม ไม่สร้างใบใหม่
      const hitDesk = nt.length >= 12 ? newOnDesk.find(ex => sameStory(nt, normT(ex.title))) : null;
      if (hitDesk) {
        try {
          await store.update(hitDesk.id, (ex) => {
            const alt = Array.isArray(ex.altSources) ? ex.altSources : [];
            if (alt.length < 4 && !alt.some(a => a.url === it.url) && it.url !== ex.url) {
              alt.push({ url: it.url, source: it.source || '', title: String(it.title).slice(0, 80) });
            }
            return { ...ex, altSources: alt };
          });
          stats.mergedSources++;
          console.log(`[Harvester] 🔗 ควบแหล่งเสริมเข้าใบเดิม: ${String(it.title).slice(0, 50)}`);
        } catch { /* ควบไม่ได้ = ปล่อยผ่านเป็นใบใหม่ตามเดิม */ kept.push(it); }
        continue;
      }
      // ควบกันเองในรอบเดียวกัน (สองสำนักรายงานเรื่องเดียวกันพร้อมกัน)
      const hitBatch = nt.length >= 12 ? kept.find(k => sameStory(nt, normT(k.title))) : null;
      if (hitBatch) {
        const alt = Array.isArray(hitBatch.altSources) ? hitBatch.altSources : [];
        if (alt.length < 4 && it.url !== hitBatch.url) alt.push({ url: it.url, source: it.source || '', title: String(it.title).slice(0, 80) });
        hitBatch.altSources = alt;
        stats.mergedSources++;
        continue;
      }
      kept.push(it);
    }
    toAdd = kept;
    if (stats.mergedSources > 0) console.log(`[Harvester] 🔗 ควบเรื่องซ้ำคนละแหล่งรวม ${stats.mergedSources} ใบ`);
  } catch { /* เทียบไม่ได้ = เก็บแบบเดิม ไม่พังการเก็บ */ }

  if (toAdd.length > 0) await store.addMany(toAdd);
  stats.added = toAdd.length;

  // ════════════════════════════════════════════════════
  // ★ AUTO-PILOT (ผู้ใช้ 11 มิ.ย.): บก.แต่ละคนเฝ้าโต๊ะ — ข่าวที่ บก.ประจำแนวให้ ≥8 = "ทำได้"
  //   ส่งเข้าเวิร์กโฟลว์เจนเองทันที ต่อคิวกัน คนมาหยิบผลงานที่แท็บ ✅ พร้อมใช้
  // ════════════════════════════════════════════════════
  try {
    stats.autoPicked = await autoPilotPick(toAdd, store);
  } catch (e) { console.log('[AutoPilot] skip:', e.message?.slice(0, 50)); }

  // ★ Research Agent อัตโนมัติ: เจาะลึกตัวท็อป (judge ≥8) สูงสุด 3 ใบ/รอบ — การ์ดขึ้น feed แบบ "พร้อมเขียน"
  try {
    const { deepResearch } = await import('./researchAgent');
    const tops = toAdd.filter(i => (i.judgeScore ?? 0) >= 8 && i.lane !== 'interview').slice(0, 3);
    for (const top of tops) {
      const r = await deepResearch(top).catch(e => ({ ok: false, reason: e.message }));
      if (r.ok) {
        const boosted = Math.min(100, (top.finalScore || 0) + Math.max(0, r.readyScore - 5) * 2);
        await store.update(top.id, (ex) => ({ ...ex, research: r, finalScore: boosted }));
        stats.researched = (stats.researched || 0) + 1;
      }
    }
  } catch (e) { console.log('[Harvester] auto-research skip:', e.message?.slice(0, 50)); }

  console.log(`[Harvester] ✅ ${JSON.stringify(stats)} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return stats;
}

// ════════════════════════════════════════════════════
// AUTO-PILOT — บก.เลือกเอง ส่งเจนเอง
// ════════════════════════════════════════════════════
async function getAutopilotConfig() {
  const defaults = { enabled: true, minScore: 8, perEditorPerRound: 2, dailyCap: 20 };
  try {
    const settings = createStore('desk-settings');
    const all = await settings.getAll();
    const cfg = all.find(s => s.id === 'autopilot');
    return cfg ? { ...defaults, ...cfg } : defaults;
  } catch {
    // ★ fail-closed (คำสั่งทีม 12 มิ.ย. ค่ำ): อ่านสวิตช์ไม่ได้ = ถือว่าปิด
    //   เดิม fail-open เป็น enabled:true → DB สะดุดชั่วคราวทีไร Auto-Pilot "เปิดเอง" ทั้งที่ทีมสั่งปิด
    console.warn('[AutoPilot] ⚠️ อ่านสวิตช์ไม่ได้ — ถือว่าปิด (fail-closed) รอบนี้');
    return { ...defaults, enabled: false };
  }
}

async function autoPilotPick(freshItems, store, opts = {}) {
  const cfg = await getAutopilotConfig();
  if (!cfg.enabled && !opts.force) return 0;

  const { specialistForLane } = await import('./deskBrain');
  const { enqueueJob } = await import('@/lib/services/queueService');

  // เพดานรายวัน — นับที่ บก.ส่งเองวันนี้
  const today = new Date().toISOString().slice(0, 10);
  const allItems = await store.getAll();
  const autoSentToday = allItems.filter(i => i.autoPicked && String(i.sentAt || '').startsWith(today)).length;
  if (autoSentToday >= cfg.dailyCap) {
    console.log(`[AutoPilot] ⏸️ ครบเพดานวันนี้แล้ว (${autoSentToday}/${cfg.dailyCap})`);
    return 0;
  }
  let budget = cfg.dailyCap - autoSentToday;

  // ★ กันส่งเรื่องซ้ำเฉพาะโหมดออโต้ (คำสั่งทีม 12 มิ.ย. ค่ำ — เปลืองโทเคน): เทียบหัวข้อกับที่ "ส่งเจนไปแล้ว" ใน 7 วัน
  //   คนกดส่งเองซ้ำได้เสมอ (คนเลือกเวอร์ชัน/แตกประเด็นเองอยู่แล้ว) — ด่านนี้คุมเฉพาะ บก.AI
  const _normT = (s) => String(s || '').replace(/[\s"“”'‘’!|…]/g, '').slice(0, 60);
  const _sentKeys = allItems
    .filter(i => i.status === 'sent' && Date.now() - new Date(i.sentAt || 0).getTime() < 7 * 864e5)
    .map(i => _normT(i.title)).filter(t => t.length >= 12);
  const _isDupStory = (title) => {
    const nt = _normT(title);
    if (nt.length < 12) return false;
    return _sentKeys.some(ne => ne.includes(nt.slice(0, 16)) || nt.includes(ne.slice(0, 16)));
  };

  // จัดกลุ่มผู้สมัครตาม บก. — เอาเฉพาะที่ บก.ให้คะแนน "ทำได้" (judge ≥ minScore) และสะอาด
  const byEditor = new Map();
  for (const it of freshItems) {
    if ((it.judgeScore ?? 0) < cfg.minScore || it.status !== 'new') continue;
    if ((it.toxicity || 0) >= 2 || (it.fbRisk || 0) >= 2) continue;
    // ★ เรื่องซ้ำ (ป้าย sameStoryAs หรือหัวข้อพ้องกับที่ส่งแล้วใน 7 วัน) → ออโต้ข้าม
    if (it.sameStoryAs || _isDupStory(it.title)) {
      console.log(`[AutoPilot] ⏭️ ข้ามเรื่องซ้ำ: ${String(it.title).slice(0, 50)}`);
      continue;
    }
    // ★ ข่าวต่างประเทศ: ออโต้ไม่แตะเลย (13 มิ.ย. 69 คำสั่งทีม "ตปท.ไม่เอา") — หาภาพยาก+ทำให้คนไทยชอบยาก
    //   เหลือไว้บนโต๊ะให้คนตัดสินเองกรณีดาราดังไทยในต่างแดน (เช่น ลิซ่า) แต่ออโต้ห้ามส่ง
    if (it.foreignCountry) {
      console.log(`[AutoPilot] ⏭️ ข้ามต่างประเทศ (${it.foreignCountry}): ${String(it.title).slice(0, 50)}`);
      continue;
    }
    const sp = specialistForLane(it.lane);
    if (opts.onlyEditor && sp.name !== opts.onlyEditor) continue; // โหมดสั่ง บก.รายฝ่าย
    if (!byEditor.has(sp.name)) byEditor.set(sp.name, { sp, picks: [] });
    byEditor.get(sp.name).picks.push(it);
  }

  let sent = 0;
  const perRound = opts.perRound || cfg.perEditorPerRound;
  for (const { sp, picks } of byEditor.values()) {
    picks.sort((a, b) => (b.judgeScore || 0) - (a.judgeScore || 0));
    for (const pick of picks.slice(0, perRound)) {
      if (budget <= 0) break;
      // ★ เช็คซ้ำอีกรอบ ณ วินาทีส่ง — กันสองสำนักเรื่องเดียวกันหลุดเข้ากลุ่มมาพร้อมกันแล้วถูกส่งคู่
      if (_isDupStory(pick.title)) {
        console.log(`[AutoPilot] ⏭️ ข้ามเรื่องซ้ำในรอบเดียวกัน: ${String(pick.title).slice(0, 50)}`);
        continue;
      }
      try {
        // ★ กฎเหล็ก (12 มิ.ย.): ส่งได้แค่ TEXT (บทถอดเสียงข่าวเดียว) หรือ URL — เหมือนคนทำแมนนวลเป๊ะ
        //   ห้ามส่งเนื้อสังเคราะห์หลายแหล่งเข้าไลน์ (เคยทำให้เนื้อหลายข่าวปนกัน)
        let input = (pick.lane === 'interview' && pick.fullText) ? pick.fullText : pick.url;
        // ★ ข่าวต่างประเทศส่งเป็นลิงก์ตรง — แนบข้อเท็จจริงประเทศ (กันเขียนแบบไม่บอกประเทศ)
        if (pick.foreignCountry && input === pick.url) {
          input = `${pick.url}\n\nหมายเหตุบรรณาธิการ (ข้อเท็จจริง): ข่าวนี้เกิดที่ประเทศ${pick.foreignCountry} ไม่ใช่ประเทศไทย — ต้องระบุประเทศชัดเจนตั้งแต่ย่อหน้าแรกของโพสต์`;
        }
        const q = await enqueueJob(
          {
            input, contentLength: 'short', userId: `ai-${sp.name}`,
            // ★ ป้ายโต๊ะข่าว — ไหลผ่าน worker → auto/process → Generation Log (แยก บก./แนวข่าว + คะแนนความควรทำ)
            deskMeta: { newsId: pick.id, lane: pick.lane, category: pick.category || '', editor: sp.name, editorIcon: sp.icon, judgeScore: pick.judgeScore ?? null, finalScore: pick.finalScore ?? null },
          },
          `ai-${sp.name}`
        );
        await store.update(pick.id, (ex) => ({
          ...ex, status: 'sent', autoPicked: true, pickedBy: sp.name, pickedByIcon: sp.icon,
          pickReason: pick.judgeReason || '', claimedBy: `${sp.icon} ${sp.name}`,
          sentAt: new Date().toISOString(), jobId: q.jobId,
        }));
        // บันทึกเป็นบทเรียน (เหมือนทีมกดส่งเอง)
        try {
          const fb = createStore('news-desk-feedback');
          await fb.add({ id: `${pick.id}_autosent_${Date.now()}`, newsId: pick.id, action: 'sent', title: pick.title, category: pick.category, lane: pick.lane, user: sp.name, at: new Date().toISOString() });
        } catch {}
        sent++; budget--;
        // ★ กันส่งเรื่องเดียวกันคู่ในรอบเดียว: จดหัวข้อที่เพิ่งส่งเข้าลิสต์กันซ้ำทันที
        const _justSent = _normT(pick.title);
        if (_justSent.length >= 12) _sentKeys.push(_justSent);
        console.log(`[AutoPilot] ${sp.icon} ${sp.name} เลือก [${pick.judgeScore}] ${String(pick.title).slice(0, 50)} → คิว ${q.jobId.slice(0, 8)}`);
      } catch (e) {
        console.log('[AutoPilot] ส่งไม่สำเร็จ:', e.message?.slice(0, 60));
      }
    }
  }
  if (sent > 0) console.log(`[AutoPilot] ✅ บก.ส่งเจนเอง ${sent} ข่าว (วันนี้รวม ${autoSentToday + sent}/${cfg.dailyCap})`);
  return sent;
}

/** ★ แจ้ง Discord (webhook เดียวกับเมนูเช้า) — ให้คนที่ไม่อยู่หน้าคอมเห็นเหมือนกัน */
export async function notifyDiscord(content) {
  try {
    let webhook = process.env.DISCORD_WEBHOOK_URL;
    if (!webhook) {
      const settings = createStore('desk-settings');
      const all = await settings.getAll();
      webhook = all.find(s => s.id === 'discord_webhook')?.url;
    }
    if (!webhook) return false;
    await fetch(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: String(content).slice(0, 1950) }),
    });
    return true;
  } catch { return false; }
}

/**
 * ★ สั่ง บก.รายฝ่ายทำทันที (ปุ่ม/Discord) — สแกนเลนตัวเอง ตัดสินตัวที่ยังไม่มีคะแนน แล้วเลือกส่งเจน
 */
export async function runEditorNow(editorKey) {
  const { SPECIALIST_EDITORS, editorialJudge, finalScore, getCategoryPerformance } = await import('./deskBrain');
  const sp = SPECIALIST_EDITORS[editorKey];
  if (!sp) throw new Error('ไม่รู้จัก บก.: ' + editorKey);

  const store = createStore('news-desk');
  const all = await store.getAll();
  const candidates = all.filter(i =>
    i.status === 'new' && sp.lanes.includes(i.lane) &&
    Date.now() - new Date(i.harvestedAt || 0).getTime() < 48 * 3600e3);

  // ตัวที่ บก.ยังไม่เคยดู → ตัดสินก่อน (สูงสุด 16 ใบ/ครั้ง)
  const unjudged = candidates.filter(c => c.judgeScore === undefined).slice(0, 16);
  if (unjudged.length > 0) {
    const judged = await editorialJudge(unjudged);
    const perf = await getCategoryPerformance();
    for (const j of judged) {
      if (j.judgeScore === undefined) continue;
      await store.update(j.id, (ex) => ({
        ...ex, judgeScore: j.judgeScore, judgeReason: j.judgeReason, angles: j.angles,
        finalScore: finalScore(j, perf),
      }));
    }
  }

  // เลือกส่งเจน (บังคับรันแม้ Auto-Pilot ปิด — เพราะคนกดสั่งเอง)
  const fresh = await store.getAll();
  const pool = fresh.filter(i => i.status === 'new' && sp.lanes.includes(i.lane));
  const picked = await autoPilotPick(pool, store, { force: true, onlyEditor: sp.name, perRound: 3 });

  const summary = `${sp.icon} **${sp.name}** สแกนเลนตัวเองแล้ว: ดูใหม่ ${unjudged.length} ใบ · เลือกส่งเจน ${picked} ข่าว${picked > 0 ? ' (ดูที่แท็บ ✅ พร้อมใช้เมื่อเขียนเสร็จ)' : ' — ยังไม่มีตัวที่ถึงเกณฑ์ 8+'}`;
  await notifyDiscord(summary);
  return { editor: sp.name, icon: sp.icon, scanned: candidates.length, judgedNew: unjudged.length, picked, summary };
}

/** ลบข่าวเก่าเกิน N วัน กันคลังบวม (เรียกตอน harvest) */
export async function pruneOldItems(days = 3) {
  try {
    const store = createStore('news-desk');
    const all = await store.getAll();
    const cutoff = Date.now() - days * 864e5;
    let removed = 0;
    for (const it of all) {
      const keep = it.status === 'claimed' || it.status === 'sent';
      if (!keep && new Date(it.harvestedAt || 0).getTime() < cutoff) {
        await store.remove(it.id);
        removed++;
      }
    }
    if (removed) console.log(`[Harvester] 🧹 pruned ${removed} old items`);
    return removed;
  } catch { return 0; }
}
