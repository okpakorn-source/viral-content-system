/**
 * ============================================================
 * ⚖️ Research Diversify (เฟส 2) — รวมหลักฐาน URL ซ้ำ + จัดโควตา 16 ใบให้กระจาย
 * ============================================================
 * ปัญหาที่แก้: (1) URL เดียวที่หลายคำค้น/หลายช่องเจอ ถูกทิ้งเป็น dup → เสียหลักฐานว่า "ยืนยันหลายทาง"
 *   (2) judge ได้รับแต่ผลจากคำค้น/ช่องแรกๆ (เรียง position ล้วน) → เนื้อกระจุก ไม่หลากหลาย
 *
 * 🔴 pure JS + import เฉพาะ sanitizeText (dnaContract = pure, node --test ตรงได้ ไม่ง้อ persistStore)
 * 🔴 ทุกฟังก์ชัน "ไม่ mutate input" · deterministic (tie-break ด้วย position → urlKey) · array มี cap
 */

import { sanitizeText } from './dnaContract.js';

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const keyOfUrl = (c) => String((c && (c._urlKey || c.url)) || '');

// sourceType หยาบๆ จาก host/channel (ก่อนเฟส 4 ที่จะเติมของจริง) — ใช้จัดกลุ่มหลักฐาน
function _sourceTypeOf(c) {
  const g = String((c && c.platformGroup) || '').toLowerCase();
  if (g === 'meta' || g === 'tiktok' || g === 'youtube') return 'social';
  if (g === 'web') return 'serper-web';
  return 'other';
}

/**
 * mergeCandidateEvidence — รวม candidate ที่ urlKey เดียวกันเป็นใบเดียว + สะสมหลักฐาน
 *   evidence: { queryHits:[{queryId?,query,bucket?,position}], discoveryChannels[], sourceTypes[], hitCount }
 *   ใบที่คงไว้ = ใบแรกที่เจอ (first-seen wins — ตรงกับ dedup เดิม) · ไม่ mutate input
 * @param {object[]} candidates
 * @param {{urlKeyFn?:function}} [opts]
 * @returns {object[]} merged (เรียงตามลำดับที่เจอครั้งแรก)
 */
export function mergeCandidateEvidence(candidates, { urlKeyFn } = {}) {
  const keyOf = typeof urlKeyFn === 'function' ? urlKeyFn : keyOfUrl;
  const order = [];
  const map = new Map();

  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c) continue;
    const k = keyOf(c);
    if (!k) continue;
    if (!map.has(k)) {
      map.set(k, { first: c, hits: [], channels: new Set(), sourceTypes: new Set() });
      order.push(k);
    }
    const g = map.get(k);
    const hit = { query: sanitizeText(c.query, 70), position: num(c.position) };
    if (c.queryId != null) hit.queryId = sanitizeText(String(c.queryId), 60);
    if (c.queryBucket) hit.bucket = sanitizeText(c.queryBucket, 20);
    g.hits.push(hit);
    const via = c.discoveredVia || c.channel;
    if (via) g.channels.add(sanitizeText(via, 20));
    g.sourceTypes.add(sanitizeText(c.sourceType || _sourceTypeOf(c), 20));
  }

  return order.map((k) => {
    const g = map.get(k);
    return {
      ...g.first,
      evidence: {
        queryHits: g.hits.slice(0, 20),
        discoveryChannels: [...g.channels].filter(Boolean).slice(0, 10),
        sourceTypes: [...g.sourceTypes].filter(Boolean).slice(0, 10),
        hitCount: g.hits.length,
      },
    };
  });
}

/**
 * allocateWeightedSlots — จัดสรร `total` ที่นั่งข้าม strata ตามน้ำหนัก โดยไม่เกินของที่มี (available)
 *   วิธี: เติมทีละใบให้ strata ที่ "ขาดเป้าตามน้ำหนักมากสุด" และยังมีที่ว่าง (Webster/largest-deficit)
 *   → redistribute อัตโนมัติ (strata ที่ของหมดถูกข้าม) · deterministic (tie-break ชื่อ strata)
 * @param {number} total
 * @param {Object<string,number>} available - {stratum: จำนวนของที่มี}
 * @param {Object<string,number>} weights   - {stratum: น้ำหนัก}
 * @returns {Object<string,number>} {stratum: จำนวนที่จัดสรร} (รวม ≤ total และ ≤ available รวม)
 */
export function allocateWeightedSlots(total, available, weights) {
  const av = available || {};
  const strata = Object.keys(av);
  const cap = {};
  for (const s of strata) cap[s] = Math.max(0, Math.floor(num(av[s])));
  const alloc = {};
  for (const s of strata) alloc[s] = 0;

  const totalAvail = strata.reduce((a, s) => a + cap[s], 0);
  const target = Math.min(Math.max(0, Math.floor(num(total))), totalAvail);
  const w = (s) => Math.max(0, num((weights || {})[s]));
  const sumW = strata.reduce((a, s) => a + w(s), 0);

  let placed = 0;
  let guard = 0;
  const maxGuard = target + strata.length + 10;
  while (placed < target && guard++ < maxGuard * 4 + 10) {
    const open = strata.filter((s) => alloc[s] < cap[s]).sort();
    if (open.length === 0) break;
    let pick = open[0];
    let best = -Infinity;
    for (const s of open) {
      const share = sumW > 0 ? w(s) / sumW : 1 / strata.length;
      const deficit = share * (placed + 1) - alloc[s];
      if (deficit > best) { best = deficit; pick = s; }
    }
    alloc[pick]++;
    placed++;
  }
  return alloc;
}

/**
 * rankDiverseCandidates — จัดอันดับ (diversityRank) ให้ candidate กระจายข้าม platformGroup
 *   รอบ 1: ทุกกลุ่มที่มีของได้ 1 ใบก่อน (ทุก strata ได้โอกาสก่อนหยิบรอบสอง)
 *   รอบต่อไป: weighted round-robin ตาม deficit จนหมด → top-N ที่ ResearchTab ตัด (เช่น 16) จะกระจายตามน้ำหนัก
 *   ในกลุ่มเรียง position → urlKey (deterministic) · ไม่ mutate input · คืน array ใหม่พร้อม field diversityRank
 * @param {object[]} candidates
 * @param {{weights?:Object, groupFn?:function}} [options]
 * @returns {object[]} เรียงตาม diversityRank (1..N) พร้อม field diversityRank
 */
export function rankDiverseCandidates(candidates, options = {}) {
  const list = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  if (list.length === 0) return [];
  const groupOf = typeof options.groupFn === 'function' ? options.groupFn : (c) => String(c.platformGroup || 'other');
  const weights = options.weights || { meta: 45, tiktok: 29, youtube: 26, web: 12, other: 4 };

  // strata → คิวเรียง position → urlKey
  const queues = new Map();
  for (const c of list) {
    const g = groupOf(c);
    if (!queues.has(g)) queues.set(g, []);
    queues.get(g).push(c);
  }
  for (const arr of queues.values()) {
    arr.sort((a, b) => (num(a.position) - num(b.position)) || keyOfUrl(a).localeCompare(keyOfUrl(b)));
  }

  const groups = [...queues.keys()];
  const w = (g) => Math.max(0, num((weights || {})[g]));
  const sumW = groups.reduce((a, g) => a + w(g), 0);
  const taken = {};
  for (const g of groups) taken[g] = 0;
  const cursor = {};
  for (const g of groups) cursor[g] = 0;

  const ordered = [];
  const pull = (g) => { const item = queues.get(g)[cursor[g]]; cursor[g]++; taken[g]++; ordered.push(item); };

  // ── รอบ 1: ทุกกลุ่มที่มีของได้ 1 ใบ (เรียงน้ำหนักมาก→น้อย, tie-break ชื่อ) ──
  const firstRound = groups.slice().sort((a, b) => (w(b) - w(a)) || a.localeCompare(b));
  for (const g of firstRound) if (cursor[g] < queues.get(g).length) pull(g);

  // ── รอบต่อไป: weighted round-robin ตาม deficit ──
  let guard = 0;
  while (ordered.length < list.length && guard++ < list.length * 4 + 10) {
    const open = groups.filter((g) => cursor[g] < queues.get(g).length).sort();
    if (open.length === 0) break;
    let pick = open[0];
    let best = -Infinity;
    const placed = ordered.length;
    for (const g of open) {
      const share = sumW > 0 ? w(g) / sumW : 1 / groups.length;
      const deficit = share * (placed + 1) - taken[g];
      if (deficit > best) { best = deficit; pick = g; }
    }
    pull(pick);
  }

  return ordered.map((c, i) => ({ ...c, diversityRank: i + 1 }));
}
