/**
 * ============================================================
 * 🕸️ Research Theme Index (เฟส 9) — Virtual themes เหนือ 614 DNA
 * ============================================================
 * ปัญหาที่แก้: คลัง DNA มีคลัสเตอร์ singleton เยอะ (1 exemplar/คลัสเตอร์) ทำให้ค้นแคบ
 * (ยิงคำค้นได้แค่จากใบเดียว/คลัสเตอร์) — โมดูลนี้จับกลุ่ม "คลัสเตอร์ที่ใกล้กันจริง"
 * (category เดียวกัน + คำแอ็กชันเด่นซ้อนกัน จาก dna.archetype/newsQueries/clipQueries)
 * ขึ้นเป็น "กลุ่มเสมือน" (virtual theme) ให้ researchHunt ดึงคำค้นข้ามหลายคลัสเตอร์ได้ทีเดียว
 *
 * 🔴 pure ES module + import ได้เฉพาะ sanitizeText จาก ./dnaContract.js — node --test เรียกตรงได้
 * 🔴 ไม่แตะ/ไม่เปลี่ยน exemplar.clusterId เดิมแม้แต่ค่าเดียว — เก็บแค่ "การจับคู่"
 *    clusterId → virtualThemeId แยกต่างหากใน byClusterId (คลัสเตอร์จริงในคลัง DNA ไม่ถูกยุ่ง)
 * 🔴 deterministic ล้วน — ห้ามใช้เวลาปัจจุบันหรือค่าสุ่มเป็นเมล็ดพันธุ์; virtualThemeId = FNV-1a hash ของ
 *    (category + token เด่นเรียงตัวอักษรแล้ว) → เรียกกี่ครั้ง/สลับลำดับ input ก็ได้ id เดิม
 * 🔴 ไม่ mutate input (exemplars) — อ่านอย่างเดียว ประกอบ array/object ใหม่ทั้งหมด
 *
 * แผนแม่บท: โต๊ะข่าว v2 เฟส 9 (19 ก.ค. 69) — ต่อยอด dna-lab-plan (16 ก.ค.)
 * ผู้เรียก: researchHunt.js (ต่อสายเอง — ไฟล์นี้ไม่ผูกกับ researchHunt หรือคลังครู DNA โดยตรง)
 */

import { sanitizeText } from './dnaContract.js';

const SIGNATURE_TOKEN_COUNT = 2; // จำนวน token เด่นที่ใช้ทำ "กุญแจกลุ่ม" (ยิ่งมาก ยิ่งเข้มงวด รวมยากขึ้น)
const ACTION_TOKENS_CAP = 8;     // เพดาน actionTokens ต่อกลุ่มเสมือน (กันบวมกรณีกลุ่มใหญ่)
const MIN_TOKEN_LEN = 2;         // ตัดคำสั้นเกินไป (ไม่มีความหมายพอจะใช้จัดกลุ่ม)

// คำฟุ่มเฟือย (ไทย/อังกฤษ) ที่ไม่ควรใช้เป็น "คำเด่น" ของกลุ่ม — แนวทางเดียวกับ researchStoryIdentity.js
const STOPWORDS = new Set([
  'และ', 'ที่', 'ของ', 'ใน', 'การ', 'เป็น', 'ให้', 'กับ', 'มา', 'ไป', 'ได้', 'ว่า', 'จะ', 'ก็', 'มี',
  'ไม่', 'แต่', 'อยู่', 'คือ', 'จาก', 'ต่อ', 'เมื่อ', 'อีก', 'นี้', 'นั้น', 'ๆ', 'คน', 'เรื่อง',
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'and', 'or', 'for', 'with', 'is', 'are',
]);

// ════════════════════════════════════════════════════
// 🔧 helper ภายใน — deterministic ล้วน (ห้ามใช้ค่าสุ่ม/เวลาปัจจุบัน/crypto ใดๆ)
// ════════════════════════════════════════════════════

/** FNV-1a 32-bit — hash string → uint (เดินตามแพตเทิร์น hashSeedString ของ researchQueryPlanner.js) */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** hash hex 16 ตัว (2 pass ซอลต์ต่างกัน กันชนกันง่ายกว่า 32-bit เดี่ยว) — ล้วน deterministic */
function stableHash16(str) {
  const s = String(str ?? '');
  const h1 = fnv1a(s).toString(16).padStart(8, '0');
  const h2 = fnv1a(`${s}${s.length}`).toString(16).padStart(8, '0');
  return h1 + h2;
}

/** แตกคำจากข้อความหนึ่งบรรทัด — ตัดอักขระที่ไม่ใช่ตัวอักษร/ตัวเลขเป็นช่องว่าง แล้วกรอง stopword/คำสั้น */
function tokenizeWords(text) {
  const s = sanitizeText(text, 300).toLowerCase();
  if (!s) return [];
  return s
    // 🔴 ต้องมี \p{M} ด้วย — สระ/วรรณยุกต์ไทยที่ประกอบบนตัวพยัญชนะ (เช่น ั ี ่ ้ ์) เป็น Unicode
    //    category Mn (combining mark) ไม่ใช่ \p{L}/\p{N}; ถ้าตัดออกคำไทยจะขาดกลางคำ
    //    (ยืนยันจริง: "เลี้ยงเดี่ยว" ไม่มี \p{M} จะแหลกเป็น "ยงเด"+"ยว")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= MIN_TOKEN_LEN && !STOPWORDS.has(w));
}

// รวมคำจาก archetype + newsQueries + clipQueries ของ dna หนึ่งใบ (ตามสเปก — ไม่แตะ dna.characters
// เพราะเป็น "บทบาท" ไม่ใช่คำแอ็กชัน เช่นเดียวกับกติกา collectEntitySeeds ใน researchQueryPlanner.js)
function extractTokens(dna) {
  const d = dna && typeof dna === 'object' ? dna : {};
  const bag = [];
  bag.push(...tokenizeWords(d.archetype));
  for (const q of Array.isArray(d.newsQueries) ? d.newsQueries : []) bag.push(...tokenizeWords(q));
  for (const q of Array.isArray(d.clipQueries) ? d.clipQueries : []) bag.push(...tokenizeWords(q));
  return bag;
}

// เลือก top-N จาก Map<token,count> — เรียง count มาก→น้อย, เสมอ → ตัวอักษร a→z (total order, deterministic ล้วน)
function topByCount(countMap, limit) {
  return [...countMap.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

/**
 * buildVirtualThemeIndex — จัดกลุ่ม "คลัสเตอร์เสมือน" ครอบหลายคลัสเตอร์จริง (ไม่แตะ clusterId เดิม)
 *
 * วิธีจัดกลุ่ม (deterministic ล้วน — ไม่ขึ้นกับลำดับ exemplars ที่ส่งมา):
 *   1) รวม exemplar ทุกใบต่อ clusterId เดิม → หา category ที่พบบ่อยสุด (เสมอ → ตัวอักษรน้อยสุด)
 *      + สะสมคำจาก dna.archetype + dna.newsQueries + dna.clipQueries (ตัด stopword/คำสั้น)
 *   2) กุญแจกลุ่ม = category + token เด่นที่สุด `SIGNATURE_TOKEN_COUNT` คำของคลัสเตอร์นั้น (เรียงตัวอักษรแล้ว)
 *      คลัสเตอร์ที่กุญแจตรงกันเป๊ะ → รวมเป็น "กลุ่มเสมือน" เดียว (กุญแจไม่ตรง = คนละกลุ่ม แม้ category เดียวกัน)
 *   3) virtualThemeId = FNV-1a hash ของกุญแจกลุ่ม (คงที่เสมอ ไม่ว่าจะเรียกกี่ครั้ง/สลับลำดับ input)
 *
 * @param {Array<{clusterId:string, reach?:number, dna:{archetype?:string, category?:string,
 *   newsQueries?:string[], clipQueries?:string[], characters?:string[]}}>} exemplars
 * @returns {{
 *   themes: Array<{id:string, label:string, category:string, clusterIds:string[], exemplarCount:number, actionTokens:string[]}>,
 *   byClusterId: Object<string,string>,
 *   stats: {totalClusters:number, totalThemes:number, singletonClustersBefore:number, clustersGroupedAfter:number}
 * }}
 */
export function buildVirtualThemeIndex(exemplars) {
  const list = Array.isArray(exemplars) ? exemplars : [];

  // ── (1) รวมต่อ clusterId เดิม (อ่านอย่างเดียว — ไม่แตะ ex/ex.dna/ex.dna.newsQueries ฯลฯ) ──
  const clusterMap = new Map(); // clusterId → { count, categoryCounts:Map, tokenCounts:Map }
  for (const ex of list) {
    if (!ex || typeof ex !== 'object') continue;
    const clusterId = typeof ex.clusterId === 'string' ? ex.clusterId : '';
    if (!clusterId) continue;

    if (!clusterMap.has(clusterId)) {
      clusterMap.set(clusterId, { count: 0, categoryCounts: new Map(), tokenCounts: new Map() });
    }
    const agg = clusterMap.get(clusterId);
    agg.count += 1;

    const dna = ex.dna && typeof ex.dna === 'object' ? ex.dna : {};
    const category = sanitizeText(dna.category, 40) || 'อื่นๆ';
    agg.categoryCounts.set(category, (agg.categoryCounts.get(category) || 0) + 1);

    for (const tok of extractTokens(dna)) {
      agg.tokenCounts.set(tok, (agg.tokenCounts.get(tok) || 0) + 1);
    }
  }

  const totalClusters = clusterMap.size;
  let singletonClustersBefore = 0;
  for (const agg of clusterMap.values()) if (agg.count === 1) singletonClustersBefore++;

  // ── (2) กุญแจกลุ่มต่อคลัสเตอร์ (category + token เด่น เรียงตัวอักษร) → รวมคลัสเตอร์กุญแจตรงกัน ──
  const buckets = new Map(); // groupKey → { category, sigTokens, clusterIds:[], exemplarCount, tokenCounts:Map }
  for (const [clusterId, agg] of clusterMap) {
    const category = topByCount(agg.categoryCounts, 1)[0] || 'อื่นๆ';
    const sigTokens = topByCount(agg.tokenCounts, SIGNATURE_TOKEN_COUNT).slice().sort();
    const groupKey = `${category}${sigTokens.join('')}`;

    if (!buckets.has(groupKey)) {
      buckets.set(groupKey, { category, sigTokens, clusterIds: [], exemplarCount: 0, tokenCounts: new Map() });
    }
    const bucket = buckets.get(groupKey);
    bucket.clusterIds.push(clusterId);
    bucket.exemplarCount += agg.count;
    for (const [tok, cnt] of agg.tokenCounts) {
      bucket.tokenCounts.set(tok, (bucket.tokenCounts.get(tok) || 0) + cnt);
    }
  }

  // ── (3) ประกอบ themes[] (เรียงตาม id ให้ผลลัพธ์ทั้งก้อนไม่ขึ้นกับลำดับ input) ──
  const themes = [...buckets.values()]
    .map((bucket) => {
      const id = `vt_${stableHash16(bucket.category + '' + bucket.sigTokens.join(''))}`;
      const actionTokens = topByCount(bucket.tokenCounts, ACTION_TOKENS_CAP);
      const label = actionTokens.length
        ? `${bucket.category} · ${actionTokens.slice(0, 2).join(' ')}`
        : bucket.category;
      return {
        id,
        label,
        category: bucket.category,
        clusterIds: bucket.clusterIds.slice().sort(),
        exemplarCount: bucket.exemplarCount,
        actionTokens,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  // ── (4) byClusterId: การจับคู่แยกต่างหาก (ไม่แตะ/ไม่เปลี่ยน clusterId เดิมในคลัง) ──
  const byClusterId = {};
  for (const theme of themes) {
    for (const cid of theme.clusterIds) byClusterId[cid] = theme.id;
  }

  // ── (5) stats: singleton "หลัง" จัดกลุ่ม = เดิมเคย singleton แล้วถูกรวมเข้ากลุ่ม >1 คลัสเตอร์ ──
  const themeById = new Map(themes.map((t) => [t.id, t]));
  let clustersGroupedAfter = 0;
  for (const [clusterId, agg] of clusterMap) {
    if (agg.count !== 1) continue;
    const theme = themeById.get(byClusterId[clusterId]);
    if (theme && theme.clusterIds.length > 1) clustersGroupedAfter++;
  }

  return {
    themes,
    byClusterId,
    stats: {
      totalClusters,
      totalThemes: themes.length,
      singletonClustersBefore,
      clustersGroupedAfter,
    },
  };
}

/**
 * resolveVirtualThemeSelection — คลี่กลุ่มเสมือนที่เลือกกลับเป็น clusterId จริงทั้งหมด (unique)
 * ลำดับผลลัพธ์: ตามลำดับ virtualThemeIds ที่ส่งมา (แต่ละกลุ่ม clusterIds เรียงตัวอักษรอยู่แล้วจาก index)
 * @param {string[]} virtualThemeIds
 * @param {{themes:Array<{id:string, clusterIds:string[]}>}} index - ผลจาก buildVirtualThemeIndex
 * @returns {string[]} clusterId unique (ว่าง/ไม่พบ/index ผิดรูป → [])
 */
export function resolveVirtualThemeSelection(virtualThemeIds, index) {
  const ids = Array.isArray(virtualThemeIds) ? virtualThemeIds : [];
  const themes = index && Array.isArray(index.themes) ? index.themes : [];
  if (ids.length === 0 || themes.length === 0) return [];

  const themeById = new Map();
  for (const t of themes) {
    if (t && typeof t.id === 'string' && t.id) themeById.set(t.id, t);
  }

  const seen = new Set();
  const out = [];
  for (const rawId of ids) {
    if (typeof rawId !== 'string' || !rawId) continue;
    const theme = themeById.get(rawId);
    if (!theme || !Array.isArray(theme.clusterIds)) continue;
    for (const cid of theme.clusterIds) {
      if (typeof cid !== 'string' || !cid || seen.has(cid)) continue;
      seen.add(cid);
      out.push(cid);
    }
  }
  return out;
}
