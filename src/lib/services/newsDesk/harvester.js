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

const TREND_QUERIES = [
  'ข่าวดราม่าวันนี้ กระแสโซเชียล',
  'ข่าวดาราล่าสุดวันนี้',
  'คลิปไวรัลวันนี้ ชาวเน็ตแห่แชร์',
  'ข่าวสังคมวันนี้ ประเด็นร้อน',
];

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
    const candidates = all
      .filter(a => {
        const t = new Date(a.archived_at || a.createdAt || 0).getTime();
        const person = (a.key_people || [])[0];
        return t > 0 && t < cutoff && person && String(person).length >= 3;
      })
      // เรื่องที่เคยถูกใช้/คะแนนไวรัลสูงมาก่อน = น่าตามรอยสุด
      .sort((a, b) => ((b.viral_score || 0) + (b.used_count || 0) * 10) - ((a.viral_score || 0) + (a.used_count || 0) * 10));
    const day = Math.floor(Date.now() / 86400000);
    const out = [];
    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      const pick = candidates[(day * count + i) % candidates.length];
      out.push({
        query: `"${String(pick.key_people[0]).slice(0, 30)}" ล่าสุด`,
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

/**
 * รันเก็บ+คัดกรองครบ 4 ชั้น แล้วลงคลัง
 * @returns {Promise<{harvested, gated, classified, judged, added}>}
 */
export async function runHarvest({ lanes = ['trend', 'good', 'evergreen', 'followup'], judgeTop = 24 } = {}) {
  const t0 = Date.now();
  const store = createStore('news-desk');
  const existing = await store.getAll();
  const existingIds = new Set(existing.map(e => e.id));
  const stats = { harvested: 0, dupSkipped: 0, gated: 0, archiveDup: 0, judged: 0, added: 0 };

  // ── เก็บดิบ ──
  const raw = [];
  if (lanes.includes('trend')) {
    for (const q of TREND_QUERIES) {
      try { raw.push(...(await serperNews(q, { num: 10, timeRange: 'qdr:d' })).map(r => ({ ...r, lane: 'trend' }))); }
      catch (e) { console.log('[Harvester] trend query failed:', e.message?.slice(0, 50)); }
    }
  }
  if (lanes.includes('good')) {
    for (const q of pickGoodQueries(4)) {
      try { raw.push(...(await serperNews(q, { num: 8, timeRange: 'qdr:w' })).map(r => ({ ...r, lane: 'good' }))); }
      catch (e) { console.log('[Harvester] good query failed:', e.message?.slice(0, 50)); }
    }
  }
  if (lanes.includes('evergreen')) {
    // ไม่จำกัดเวลา — ของเก่าน้ำดีคือเป้าหมาย (วันไหนกระแสแห้ง เลนนี้คือบ่อสำรอง)
    for (const q of pickEvergreenQueries(3)) {
      try { raw.push(...(await serperNews(q, { num: 8, timeRange: 'qdr:y' })).map(r => ({ ...r, lane: 'evergreen' }))); }
      catch (e) { console.log('[Harvester] evergreen query failed:', e.message?.slice(0, 50)); }
    }
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
  if (finalItems.length > 0) await store.addMany(finalItems);
  stats.added = finalItems.length;

  console.log(`[Harvester] ✅ ${JSON.stringify(stats)} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return stats;
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
