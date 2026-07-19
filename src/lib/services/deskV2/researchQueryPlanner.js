/**
 * =====================================================
 * 🧭 Research Query Planner — สี่กอง (โต๊ะข่าวกลาง v2, เฟส 3 — 19 ก.ค. 69)
 * =====================================================
 * แบ่งโควตาคำค้นต่อรอบวิจัยออกเป็น 4 กอง: dna (จากคลัง exemplar) / angle (จาก THEME_ACTIONS)
 * / people (คน/รายการ) / trend (กระแสรายวัน) — ให้ researchHunt เรียกใช้แทนการยิงคำค้นแบบเดิม
 * 🔴 pure JS + import ได้เฉพาะ keywordBank.js (THEME_ACTIONS, DAILY_TREND_QUERIES) + dnaContract.js (sanitizeText)
 * 🔴 ห้าม AI/network/fs/ตัวช่วยเก็บข้อมูลถาวร (persist-store) ทุกชนิด — ห้ามใช้เวลาปัจจุบันหรือค่าสุ่มเป็นเมล็ดพันธุ์
 *    (deterministic ล้วน — ใช้ hash ของ runSeed string ทำ offset การหมุนแทน)
 * 🔴 ทุกข้อความ output ผ่าน sanitizeText + dedup (case-insensitive) เสมอ
 *
 * หมายเหตุสำคัญ (อ่านก่อนต่อสาย researchHunt):
 *   - dna.characters ใน exemplar คือ "บทบาท" (เช่น 'พระเอก') ไม่ใช่ชื่อบุคคลจริง — collectEntitySeeds
 *     จึงไม่แตะฟิลด์นี้เด็ดขาด (ใช้ staffHints เป็นหลัก + ฟิลด์ entity อื่นถ้ามี)
 *   - preset bias (ขั้นตอน 5) รองรับเฉพาะ preset='kindness' ตามที่สเปกระบุชัด (เอนไปหมวด
 *     'น้ำใจ/ช่วยเหลือ' + 'กตัญญู/ครอบครัวอบอุ่น'); ชื่อ preset อื่นจาก DISCOVERY_PRESETS
 *     (interview/society/lifestyle/economy) รับเป็นค่าที่ถูกต้องได้ (ไม่ throw) แต่ยังไม่มี bias
 *     เฉพาะทาง — ขยาย PRESET_ANGLE_BIAS ทีหลังได้ถ้าต้องการ
 *   - clusterArchetype รับเข้ามาตามรูป input (ไม่ throw) แต่ยังไม่ถูกใช้ในการเอนกอง angle
 *     (สเปก 5 ขั้นตอนระบุแค่ preset เป็นตัวเอน — ไม่เดาเพิ่มเพื่อกันพฤติกรรมเกินสัญญา)
 *   - targetChannels/personId/programId ใน QueryPlanV2 ไม่ถูกเซ็ต (ไม่มีข้อมูลต้นทางให้ map จริง
 *     ในชั้นนี้) — ปล่อยให้ชั้น researchHunt เติมทีหลังได้ถ้ามีข้อมูล
 */

import { THEME_ACTIONS, DAILY_TREND_QUERIES } from '../newsDesk/keywordBank.js';
import { sanitizeText } from './dnaContract.js';

// ── น้ำหนักกองมาตรฐาน (รวม 100) — ห้ามเปลี่ยนชื่อ/รูปร่าง (researchHunt ผูกตรงกับชุดนี้) ──
export const BUCKET_WEIGHTS = Object.freeze({ dna: 35, angle: 30, people: 25, trend: 10 });

const BUCKET_KEYS = ['dna', 'angle', 'people', 'trend'];
const MAX_QUERY_LEN = 70; // เท่ากับเพดาน newsQueries/clipQueries ใน dnaContract.cleanQueries

// preset → หมวด THEME_ACTIONS ที่ต้องเอนก่อน (เฉพาะที่สเปกระบุชัด — ดูหมายเหตุหัวไฟล์)
const PRESET_ANGLE_BIAS = {
  kindness: ['น้ำใจ/ช่วยเหลือ', 'กตัญญู/ครอบครัวอบอุ่น'],
};

// ════════════════════════════════════════════════════
// 🔧 helper ภายใน — deterministic ล้วน (ห้ามใช้ค่าสุ่ม/เวลาปัจจุบันเป็นเมล็ดพันธุ์)
// ════════════════════════════════════════════════════

/** FNV-1a 32-bit — hash string → uint ล้วน (ใช้ทำ offset การหมุนจาก runSeed) */
function hashSeedString(input) {
  const s = String(input ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** หมุนลำดับ array แบบ deterministic ตาม seedKey (ไม่ mutate ต้นฉบับ) */
function rotateArray(arr, seedKey) {
  const list = Array.isArray(arr) ? arr : [];
  if (list.length < 2) return list.slice();
  const offset = hashSeedString(seedKey) % list.length;
  if (offset === 0) return list.slice();
  return [...list.slice(offset), ...list.slice(0, offset)];
}

/** sanitize + dedup (case-insensitive) รักษาลำดับที่เจอครั้งแรก */
function dedupSanitize(list, maxLen = MAX_QUERY_LEN) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const text = sanitizeText(raw, maxLen);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function clampNonNegInt(n) {
  const x = Math.trunc(Number(n));
  return Number.isFinite(x) && x > 0 ? x : 0;
}

function presetBiasCategories(preset) {
  const key = sanitizeText(preset, 40).toLowerCase();
  const cats = PRESET_ANGLE_BIAS[key];
  return cats ? cats.slice() : [];
}

// ════════════════════════════════════════════════════
// 1) allocateQueryBuckets — จัดสรรจำนวนคำค้นต่อกอง
// ════════════════════════════════════════════════════
/**
 * @param {number} total จำนวนคำค้นรวมที่ต้องการ
 * @param {{dna:number,angle:number,people:number,trend:number}} [weights=BUCKET_WEIGHTS]
 * @param {string} [runSeed=''] ใช้ทำ offset หมุนกอง (เฉพาะกรณี total<4) — deterministic ล้วน
 * @returns {{dna:number,angle:number,people:number,trend:number}} รวม = total (clamp เป็นจำนวนเต็ม >=0)
 */
export function allocateQueryBuckets(total, weights = BUCKET_WEIGHTS, runSeed = '') {
  const w = { ...BUCKET_WEIGHTS, ...(weights || {}) };
  const t = clampNonNegInt(total);
  const out = { dna: 0, angle: 0, people: 0, trend: 0 };
  if (t <= 0) return out;

  if (t < 4) {
    // กติกาพิเศษ total<4: dna ต้อง >=1 เสมอ ที่เหลือหมุนใน [angle,people,trend] ตาม runSeed
    out.dna = 1;
    let remaining = t - 1;
    const rotateKeys = ['angle', 'people', 'trend'];
    const offset = hashSeedString(runSeed) % rotateKeys.length;
    for (let i = 0; i < remaining; i++) {
      out[rotateKeys[(offset + i) % rotateKeys.length]] += 1;
    }
    return out;
  }

  // total>=4: largest-remainder method (Hamilton's method) ตามน้ำหนัก
  const totalWeight = BUCKET_KEYS.reduce((sum, k) => sum + (Number(w[k]) || 0), 0) || 1;
  const shares = {};
  const floors = {};
  let flooredSum = 0;
  for (const k of BUCKET_KEYS) {
    const share = (t * (Number(w[k]) || 0)) / totalWeight;
    shares[k] = share;
    floors[k] = Math.floor(share);
    flooredSum += floors[k];
  }
  let remainder = t - flooredSum;
  const order = [...BUCKET_KEYS].sort((a, b) => {
    const fracA = shares[a] - Math.floor(shares[a]);
    const fracB = shares[b] - Math.floor(shares[b]);
    if (fracB !== fracA) return fracB - fracA;
    return BUCKET_KEYS.indexOf(a) - BUCKET_KEYS.indexOf(b); // เสมอ → เรียงตามลำดับกองมาตรฐาน
  });
  const result = { ...floors };
  for (let i = 0; i < remainder; i++) {
    result[order[i % order.length]] += 1;
  }
  return result;
}

// ════════════════════════════════════════════════════
// 2) collectDnaSeeds — seed กอง "dna" จากคลัง exemplar
// ════════════════════════════════════════════════════
/**
 * @param {Array<{dna?:{newsQueries?:string[], clipQueries?:string[]}}>} exemplars
 * @returns {string[]} unique + sanitized (≤70 ตัวอักษร) เรียงตามลำดับที่เจอครั้งแรก
 */
export function collectDnaSeeds(exemplars) {
  const list = Array.isArray(exemplars) ? exemplars : [];
  const combined = [];
  for (const ex of list) {
    const dna = (ex && typeof ex === 'object' && ex.dna) || {};
    if (Array.isArray(dna.newsQueries)) combined.push(...dna.newsQueries);
    if (Array.isArray(dna.clipQueries)) combined.push(...dna.clipQueries);
  }
  return dedupSanitize(combined, MAX_QUERY_LEN);
}

// ════════════════════════════════════════════════════
// 3) collectEntitySeeds — seed กอง "คน/รายการ"
// ════════════════════════════════════════════════════
/**
 * ⚠️ dna.characters เป็น "บทบาท" (เช่น 'พระเอก') ไม่ใช่ชื่อบุคคลจริง — ห้ามดึงมาใช้เป็นชื่อคน
 * staffHints คือแหล่งหลัก; ฟิลด์ entity อื่น (ถ้ามี) เป็นส่วนเสริม ไม่มีเลย → คืน [] (ผู้เรียก redistribute เอง)
 * @param {Array<object>} exemplars
 * @param {string[]} [staffHints]
 * @returns {string[]} unique + sanitized (≤70 ตัวอักษร)
 */
export function collectEntitySeeds(exemplars, staffHints = []) {
  const combined = [];
  if (Array.isArray(staffHints)) combined.push(...staffHints);

  const list = Array.isArray(exemplars) ? exemplars : [];
  for (const ex of list) {
    if (!ex || typeof ex !== 'object') continue;
    if (Array.isArray(ex.entities)) combined.push(...ex.entities);
    if (typeof ex.personName === 'string') combined.push(ex.personName);
    if (typeof ex.programName === 'string') combined.push(ex.programName);
    const dna = ex.dna && typeof ex.dna === 'object' ? ex.dna : null;
    if (dna) {
      if (typeof dna.personName === 'string') combined.push(dna.personName);
      if (typeof dna.programName === 'string') combined.push(dna.programName);
    }
  }
  return dedupSanitize(combined, MAX_QUERY_LEN);
}

// ════════════════════════════════════════════════════
// pool builders ภายใน (dna/angle/people/trend) — คืน [{text, lane}] ที่ dedup+sanitize+หมุนแล้ว
// ════════════════════════════════════════════════════
function buildDnaPool(exemplars, runSeed) {
  const seeds = rotateArray(collectDnaSeeds(exemplars), `${runSeed}|dna`);
  return seeds.map((text) => ({ text, lane: 'dna' }));
}

function buildPeoplePool(exemplars, staffHints, runSeed) {
  const seeds = rotateArray(collectEntitySeeds(exemplars, staffHints), `${runSeed}|people`);
  return seeds.map((text) => ({ text, lane: 'dna' }));
}

function buildTrendPool(trendTerms, staffHints, runSeed) {
  const combined = [
    ...DAILY_TREND_QUERIES,
    ...(Array.isArray(trendTerms) ? trendTerms : []),
    ...(Array.isArray(staffHints) ? staffHints : []),
  ];
  const seeds = rotateArray(dedupSanitize(combined, MAX_QUERY_LEN), `${runSeed}|trend`);
  return seeds.map((text) => ({ text, lane: 'dna' }));
}

// lane='interview' เฉพาะแอ็กชันที่มาจาก 2 หมวดนี้ (ตามสเปก step 2) — หมวดอื่นทั้งหมด lane='dna'
const INTERVIEW_LANE_CATEGORIES = new Set(['สัมภาษณ์/บทสนทนาดี', 'คนดัง/ดราม่าบันเทิง']);

function buildAnglePool(preset, runSeed) {
  const categories = Object.keys(THEME_ACTIONS);
  const biasCats = presetBiasCategories(preset).filter((c) => categories.includes(c));
  const otherCats = rotateArray(
    categories.filter((c) => !biasCats.includes(c)),
    `${runSeed}|angle-cats`
  );
  const orderedCats = [...biasCats, ...otherCats];

  const seen = new Set();
  const pool = [];
  for (const cat of orderedCats) {
    const actions = Array.isArray(THEME_ACTIONS[cat]) ? THEME_ACTIONS[cat] : [];
    const lane = INTERVIEW_LANE_CATEGORIES.has(cat) ? 'interview' : 'dna';
    for (const action of actions) {
      const text = sanitizeText(action, MAX_QUERY_LEN);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push({ text, lane });
    }
  }
  return pool;
}

// ════════════════════════════════════════════════════
// 4) planResearchQueries — ประกอบแผนคำค้นสุดท้าย
// ════════════════════════════════════════════════════
/**
 * @typedef {object} QueryPlanV2
 * @property {string} id            stable+deterministic เช่น 'dna-0'
 * @property {string} text          คำค้น (sanitized, unique ทั้งแผน)
 * @property {'dna'|'angle'|'people'|'trend'} bucket  กองต้นทางจริงของ text นี้ (หลัง redistribute แล้ว)
 * @property {'dna'|'interview'} lane
 * @property {number} weight        = weights[bucket] (ของกองต้นทางจริง)
 * @property {string|null} preset
 * @property {string|null} clusterId
 *
 * @param {object} [input]
 * @param {Array<object>} [input.exemplars=[]]
 * @param {string} [input.clusterId]
 * @param {string} [input.clusterArchetype] รับเข้ามาได้ (ไม่ throw) — ยังไม่ใช้เอนกอง angle (ดูหมายเหตุหัวไฟล์)
 * @param {number} [input.total=4]
 * @param {{dna:number,angle:number,people:number,trend:number}} [input.weights]
 * @param {string} [input.runSeed='']
 * @param {string} [input.preset] เช่น 'kindness'
 * @param {string[]} [input.trendTerms=[]]
 * @param {string[]} [input.staffHints=[]]
 * @returns {QueryPlanV2[]} ยาว ≤ total, deterministic ล้วน (input เดิม → output เดิมเป๊ะ)
 */
export function planResearchQueries(input = {}) {
  const {
    exemplars = [],
    clusterId = null,
    // eslint-disable-next-line no-unused-vars
    clusterArchetype = null, // รับไว้ตามสัญญา input — ยังไม่ใช้ (ดูหมายเหตุหัวไฟล์)
    total = 4,
    weights = BUCKET_WEIGHTS,
    runSeed = '',
    preset = null,
    trendTerms = [],
    staffHints = [],
  } = input || {};

  const w = { ...BUCKET_WEIGHTS, ...(weights || {}) };
  const counts = allocateQueryBuckets(total, weights, runSeed);
  const cleanPreset = preset ? sanitizeText(preset, 40) : null;
  const cleanClusterId = clusterId ? sanitizeText(clusterId, 80) : null;

  const pools = {
    dna: buildDnaPool(exemplars, runSeed),
    angle: buildAnglePool(preset, runSeed),
    people: buildPeoplePool(exemplars, staffHints, runSeed),
    trend: buildTrendPool(trendTerms, staffHints, runSeed),
  };
  const cursor = { dna: 0, angle: 0, people: 0, trend: 0 };
  const idSeq = { dna: 0, angle: 0, people: 0, trend: 0 };
  const usedKeys = new Set(); // global dedup (case-insensitive) ข้ามกอง

  function takeFrom(bucket) {
    const pool = pools[bucket];
    while (cursor[bucket] < pool.length) {
      const candidate = pool[cursor[bucket]++];
      const key = candidate.text.toLowerCase();
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      return candidate;
    }
    return null;
  }

  function emit(bucket, candidate) {
    const id = `${bucket}-${idSeq[bucket]++}`;
    return {
      id,
      text: candidate.text,
      bucket,
      lane: candidate.lane || 'dna',
      weight: w[bucket],
      preset: cleanPreset,
      clusterId: cleanClusterId,
    };
  }

  const results = [];
  let shortfall = 0;
  for (const bucket of BUCKET_KEYS) {
    const need = counts[bucket] || 0;
    for (let i = 0; i < need; i++) {
      const candidate = takeFrom(bucket);
      if (candidate) results.push(emit(bucket, candidate));
      else shortfall++;
    }
  }

  // redistribute: กองไหน seed ไม่พอ → ย้ายโควตาไปกองอื่นที่ยังมี seed เหลือ (ห้ามคืนสั้นกว่าที่ควร
  // ถ้ายังมี seed เหลือที่ไหนก็ตาม) — เดินวนกองมาตรฐานจนกว่าจะครบหรือของหมดจริงทุกกอง
  while (shortfall > 0) {
    let progressed = false;
    for (const bucket of BUCKET_KEYS) {
      if (shortfall <= 0) break;
      const candidate = takeFrom(bucket);
      if (candidate) {
        results.push(emit(bucket, candidate));
        shortfall--;
        progressed = true;
      }
    }
    if (!progressed) break; // ทุกกองว่างพร้อมกันจริง — คืนเท่าที่มี (สั้นกว่า total ได้เฉพาะกรณีสุดนี้)
  }

  return results;
}
