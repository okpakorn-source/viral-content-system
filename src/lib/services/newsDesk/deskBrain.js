/**
 * =====================================================
 * News Desk Brain — สมองคัดกรองข่าว 4 ชั้น (เฟส 1)
 * =====================================================
 * ชั้น 0 gateKeywords   : กติกาคำต้องห้าม — ฟรี ไม่ใช้ AI
 * ชั้น 1 classifyBatch  : gpt-4o-mini จัดหมวด+วัดพิษ+ความเสี่ยง FB (ถูก ~฿0.03/ข่าว)
 * ชั้น 2 fitAndDedupe   : JS ล้วน — ViralFit เทียบหมวดที่เพจปัง + กันซ้ำกับ archive
 * ชั้น 3 editorialJudge : gpt-5.5 "บรรณาธิการ AI" เฉพาะตัวท็อป + few-shot จากการกดเลือก/ทิ้งของทีม
 */

import { callAI } from '@/lib/ai/openai';
import { createStore } from '@/lib/persistStore';

// ── ชั้น 0: คำต้องห้าม (ตามนโยบายผู้ใช้: สงคราม/ฆ่า-ข่มขืน/เด็กถูกทำร้าย/การเมืองแรง/ศาสนา) ──
const BANNED_PATTERNS = [
  /ข่มขืน|ล่วงละเมิดทางเพศ|อนาจารเด็ก/,
  /ฆ่าตัวตาย|ปลิดชีพตัวเอง/,
  /ฆ่าหั่น|ฆ่ายกครัว|ฆาตกรรมโหด|ชำแหละศพ/,
  /สงคราม.{0,12}(ยูเครน|รัสเซีย|กาซา|อิสราเอล|ตะวันออกกลาง)|ระเบิดพลีชีพ|กราดยิง/,
  /ยุบสภา|รัฐประหาร|ม็อบ.{0,10}(ปะทะ|สลาย)|นายกฯ.{0,10}(ลาออก|อภิปราย)/,
  /หมิ่นศาสนา|ดูหมิ่นพระ|พระฉาว.{0,10}(สีกา|เสพ)/,
];

export function gateKeywords(item) {
  const text = `${item.title || ''} ${item.snippet || ''}`;
  for (const p of BANNED_PATTERNS) {
    if (p.test(text)) return { pass: false, reason: `ติดคำต้องห้าม: ${p.source.slice(0, 30)}` };
  }
  return { pass: true };
}

// ── หมวดของโต๊ะข่าว + น้ำหนัก ViralFit (อิงหมวดที่หอสมุดไวรัลของเพจพิสูจน์แล้วว่าปัง) ──
export const DESK_CATEGORIES = [
  'น้ำใจ/ช่วยเหลือ', 'กตัญญู/ครอบครัวอบอุ่น', 'สู้ชีวิต', 'คนดังทำดี/ติดดิน',
  'สัมภาษณ์/บทสนทนาดี', 'บันเทิงกระแส', 'ดราม่าสังคม', 'เตือนภัย/อุทาหรณ์', 'อื่นๆ',
];

const FIT_WEIGHTS = {
  'น้ำใจ/ช่วยเหลือ': 30, 'กตัญญู/ครอบครัวอบอุ่น': 30, 'สู้ชีวิต': 28, 'คนดังทำดี/ติดดิน': 27,
  'สัมภาษณ์/บทสนทนาดี': 22, 'บันเทิงกระแส': 18, 'ดราม่าสังคม': 15, 'เตือนภัย/อุทาหรณ์': 14, 'อื่นๆ': 6,
};

// ── ชั้น 1: จัดหมวด + วัดพิษ (เรียกทีละก้อน ก้อนละ ≤10 ข่าว ใน 1 call) ──
export async function classifyBatch(items) {
  const out = [];
  for (let i = 0; i < items.length; i += 10) {
    const chunk = items.slice(i, i + 10);
    const list = chunk.map((it, idx) =>
      `${idx}: ${String(it.title || '').slice(0, 120)} | ${String(it.snippet || '').slice(0, 150)}`).join('\n');
    try {
      const res = await callAI({
        prompt: `จัดหมวดข่าวเพจไวรัลไทย ตอบ JSON เท่านั้น
หมวดให้เลือก: ${DESK_CATEGORIES.join(', ')}
ข่าว:
${list}

ตอบ: {"items":[{"i":0,"category":"...","tone":"บวก|กลาง|ลบ","toxicity":0-3,"fbRisk":0-3,"toneable":true/false}]}
- toxicity: 0=สะอาด 3=หดหู่/รุนแรง | fbRisk: ความเสี่ยงโดน Facebook ลดรีช/ลบ (เลือด ความรุนแรง เนื้อหาล่อแหลม)
- toneable: ถ้าเอาไปเกลาโทนใหม่แล้วลงเพจได้แบบไม่ลบเกิน/ไม่ toxic`,
        model: 'gpt-4o-mini',
        temperature: 0.1,
        maxTokens: 1200,
      });
      const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
      for (const r of parsed?.items || []) {
        const it = chunk[r.i];
        if (!it) continue;
        out.push({
          ...it,
          category: DESK_CATEGORIES.includes(r.category) ? r.category : 'อื่นๆ',
          tone: r.tone || 'กลาง',
          toxicity: Math.min(3, Math.max(0, Number(r.toxicity) || 0)),
          fbRisk: Math.min(3, Math.max(0, Number(r.fbRisk) || 0)),
          toneable: r.toneable !== false,
        });
      }
    } catch (e) {
      console.log('[DeskBrain] classify chunk failed:', e.message?.slice(0, 60));
      // ก้อนที่จัดไม่ได้ → ใส่หมวดอื่นๆ ไว้ก่อน ไม่ทิ้งข่าว
      chunk.forEach(it => out.push({ ...it, category: 'อื่นๆ', tone: 'กลาง', toxicity: 1, fbRisk: 1, toneable: true }));
    }
  }
  return out;
}

// ── ชั้น 2: ViralFit + ความสด + กันซ้ำกับคลังที่เพจเคยทำ ──
// ★ เฟส 3: น้ำหนักหมวด "เรียนรู้จากผลโพสต์จริง" — ทีมกด 🔥 ปังจริง / 🧊 แป้ก บนการ์ดที่ส่งทำแล้ว
let _perfCache = { at: 0, boost: {} };
export async function getCategoryPerformance() {
  if (Date.now() - _perfCache.at < 10 * 60 * 1000) return _perfCache.boost;
  const boost = {};
  try {
    const store = createStore('news-desk-feedback');
    const all = await store.getAll();
    const counts = {};
    for (const f of all) {
      if (f.action !== 'viral' && f.action !== 'flop') continue;
      const c = f.category || 'อื่นๆ';
      counts[c] = counts[c] || { viral: 0, flop: 0 };
      counts[c][f.action]++;
    }
    for (const [cat, n] of Object.entries(counts)) {
      // ปังจริงดันหมวดขึ้น แป้กกดลง — จำกัด -6..+8 กันเหวี่ยงแรงเกิน
      boost[cat] = Math.max(-6, Math.min(8, (n.viral - n.flop) * 2));
    }
  } catch { /* อ่าน feedback ไม่ได้ = ไม่ปรับ */ }
  _perfCache = { at: Date.now(), boost };
  return boost;
}

export function fitScore(category, perfBoost = null) {
  const base = FIT_WEIGHTS[category] ?? 6;
  const learned = perfBoost?.[category] || 0;
  return Math.max(0, base + learned);
}

export function freshScore(publishedAt) {
  if (!publishedAt) return 8;
  const ageH = (Date.now() - new Date(publishedAt).getTime()) / 36e5;
  if (Number.isNaN(ageH)) return 8;
  if (ageH <= 6) return 20;
  if (ageH <= 24) return 14;
  if (ageH <= 72) return 8;
  return 4; // ข่าวเก่า — ยังมีค่าในเลนน้ำดี
}

let _archiveTitleCache = { at: 0, titles: [] };
export async function loadArchiveTitles() {
  if (Date.now() - _archiveTitleCache.at < 10 * 60 * 1000) return _archiveTitleCache.titles;
  try {
    const store = createStore('news-archive');
    const all = await store.getAll();
    _archiveTitleCache = { at: Date.now(), titles: all.map(a => String(a.title || '')).filter(Boolean) };
  } catch { /* archive อ่านไม่ได้ = ไม่กันซ้ำ ดีกว่าพังทั้งคิว */ }
  return _archiveTitleCache.titles;
}

export function isDuplicateOfArchive(title, archiveTitles) {
  const t = String(title || '').replace(/\s+/g, '');
  if (t.length < 12) return false;
  for (const at of archiveTitles) {
    const a = at.replace(/\s+/g, '');
    // แชร์ substring ยาว 14 ตัวอักษร = น่าจะเรื่องเดียวกัน
    for (let p = 0; p + 14 <= t.length; p += 7) {
      if (a.includes(t.substr(p, 14))) return true;
    }
  }
  return false;
}

// ── ชั้น 3: บรรณาธิการ AI (gpt-5.5) + few-shot จากการตัดสินใจจริงของทีม ──
async function getJudgeFewshot() {
  try {
    const store = createStore('news-desk-feedback');
    const all = await store.getAll();
    const recent = all.slice(-100);
    const viral = recent.filter(f => f.action === 'viral').slice(-5);
    const flop = recent.filter(f => f.action === 'flop').slice(-5);
    const picked = recent.filter(f => f.action === 'sent' || f.action === 'claimed').slice(-6);
    const dropped = recent.filter(f => f.action === 'dismissed').slice(-6);
    if (picked.length === 0 && dropped.length === 0 && viral.length === 0) return '';
    return '\n=== รสนิยมจริงของกองบรรณาธิการ (เรียนจากผลจริงล่าสุด) ===\n' +
      viral.map(f => `🔥 โพสต์แล้วปังจริง: ${String(f.title).slice(0, 80)} [${f.category || ''}]`).join('\n') + (viral.length ? '\n' : '') +
      flop.map(f => `🧊 โพสต์แล้วแป้ก: ${String(f.title).slice(0, 80)} [${f.category || ''}]`).join('\n') + (flop.length ? '\n' : '') +
      picked.map(f => `✅ ทีมเลือกทำ: ${String(f.title).slice(0, 80)} [${f.category || ''}]`).join('\n') + '\n' +
      dropped.map(f => `❌ ทีมกดทิ้ง: ${String(f.title).slice(0, 80)} [${f.category || ''}]`).join('\n') + '\n';
  } catch { return ''; }
}

export async function editorialJudge(items) {
  if (!items.length) return items;
  const fewshot = await getJudgeFewshot();
  const out = [];
  for (let i = 0; i < items.length; i += 8) {
    const chunk = items.slice(i, i + 8);
    const list = chunk.map((it, idx) =>
      `${idx}: [${it.category}|${it.tone}] ${String(it.title).slice(0, 110)} — ${String(it.snippet || '').slice(0, 180)}`).join('\n');
    try {
      const res = await callAI({
        prompt: `คุณคือหัวหน้ากองบรรณาธิการเพจข่าวไวรัลไทย (แนวถนัดของเพจ: น้ำใจ กตัญญู สู้ชีวิต คนดังทำดี เรื่องอบอุ่นใจ — เนื้อหาลบ/toxic ทำได้จำกัดเพราะเพจโดนกดรีช)
${fewshot}
ให้คะแนน "น่าหยิบมาทำโพสต์" 0-10 ต่อข่าว + เหตุผลสั้น + แตกประเด็น 2 มุมที่เพจเราเล่นได้
เกณฑ์: เรื่องคนตัวเล็ก/อารมณ์ร่วมสูง/มีตัวเลข-รายละเอียดเจาะใจ = สูง | ข่าวแถลง/การเมือง/ไกลตัวคนไทย = ต่ำ
ข่าว:
${list}

ตอบ JSON: {"items":[{"i":0,"score":0-10,"reason":"สั้น","angles":["มุม 1","มุม 2"]}]}`,
        model: 'gpt-5.5',
        temperature: 0.2,
        maxTokens: 6000, // reasoning model ต้องมี headroom
      });
      const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
      for (const r of parsed?.items || []) {
        const it = chunk[r.i];
        if (!it) continue;
        out.push({
          ...it,
          judgeScore: Math.min(10, Math.max(0, Number(r.score) || 0)),
          judgeReason: String(r.reason || '').slice(0, 140),
          angles: (r.angles || []).slice(0, 3).map(a => String(a).slice(0, 90)),
        });
      }
      // ตัวที่ judge ไม่ตอบ → คงไว้แบบไม่มีคะแนน judge
      chunk.forEach(it => { if (!out.find(o => o.id === it.id)) out.push(it); });
    } catch (e) {
      console.log('[DeskBrain] judge chunk failed:', e.message?.slice(0, 60));
      out.push(...chunk);
    }
  }
  return out;
}

export function finalScore(item, perfBoost = null) {
  const fit = fitScore(item.category, perfBoost);
  // evergreen = ของเก่าที่ตั้งใจหยิบ ไม่หักความสด | good = มีพื้นขั้นต่ำ | buzz = แชร์จริงจาก BuzzSumo +โบนัส | trend = วัดความสดจริง
  const fresh = item.lane === 'evergreen' ? 10
    : item.lane === 'good' ? Math.max(8, freshScore(item.publishedAt))
    : item.lane === 'buzz' ? Math.min(20, freshScore(item.publishedAt) + 6)
    : freshScore(item.publishedAt);
  const judge = (item.judgeScore ?? 5) * 5; // 0-50
  const toxPenalty = (item.toxicity || 0) * 3 + (item.fbRisk || 0) * 3;
  return Math.max(0, Math.min(100, Math.round(fit + fresh + judge - toxPenalty)));
}

// ════════════════════════════════════════════════════
// Mix Governor (เฟส 2) — คุมส่วนผสมรายวัน กันเพจ toxic สะสมจนโดน FB กดรีช
// ════════════════════════════════════════════════════
// กลุ่มหมวด: positive (น้ำดี) ต้อง ≥40% ของที่ส่งทำวันนี้ | drama ≤20% | warn ≤15%
const CAT_GROUP = {
  'น้ำใจ/ช่วยเหลือ': 'positive', 'กตัญญู/ครอบครัวอบอุ่น': 'positive', 'สู้ชีวิต': 'positive',
  'คนดังทำดี/ติดดิน': 'positive', 'สัมภาษณ์/บทสนทนาดี': 'positive',
  'บันเทิงกระแส': 'neutral', 'อื่นๆ': 'neutral',
  'ดราม่าสังคม': 'drama', 'เตือนภัย/อุทาหรณ์': 'warn',
};
export const MIX_POLICY = { positive: { min: 0.4 }, drama: { max: 0.2 }, warn: { max: 0.15 } };

/**
 * คำนวณสถานะส่วนผสมวันนี้ + boost/sink รายการ feed ตามโควตาที่เหลือ
 * @param {Array} items - feed ที่จะแสดง
 * @param {Object} mixToday - { หมวด: จำนวนที่ส่งทำวันนี้ }
 */
export function applyMixGovernor(items, mixToday) {
  const groupCount = { positive: 0, neutral: 0, drama: 0, warn: 0 };
  let total = 0;
  for (const [cat, n] of Object.entries(mixToday || {})) {
    groupCount[CAT_GROUP[cat] || 'neutral'] += n;
    total += n;
  }
  const ratio = (g) => (total > 0 ? groupCount[g] / total : 0);

  const governor = {
    total,
    positivePct: Math.round(ratio('positive') * 100),
    dramaPct: Math.round(ratio('drama') * 100),
    warnPct: Math.round(ratio('warn') * 100),
    positiveOk: total === 0 || ratio('positive') >= MIX_POLICY.positive.min,
    dramaOk: ratio('drama') <= MIX_POLICY.drama.max,
    warnOk: ratio('warn') <= MIX_POLICY.warn.max,
  };

  // boost/sink: เกินเพดานแล้ว → การ์ดกลุ่มนั้นจม / น้ำดียังไม่ถึงเป้า → การ์ดน้ำดีลอย
  const adjusted = items.map(it => {
    const g = CAT_GROUP[it.category] || 'neutral';
    let bonus = 0;
    if (total >= 3) { // เริ่มคุมเมื่อวันนี้ส่งทำแล้วอย่างน้อย 3 ข่าว
      if (g === 'drama' && !governor.dramaOk) bonus -= 25;
      if (g === 'warn' && !governor.warnOk) bonus -= 25;
      if (g === 'positive' && !governor.positiveOk) bonus += 15;
    }
    return { ...it, _govBonus: bonus, _sortScore: (it.finalScore || 0) + bonus };
  });
  adjusted.sort((a, b) => b._sortScore - a._sortScore);
  return { items: adjusted, governor };
}
