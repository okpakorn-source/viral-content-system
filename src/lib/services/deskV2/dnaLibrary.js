/**
 * =====================================================
 * 🧬 DNA Library — คลังข่าวต้นแบบ (โต๊ะข่าวกลาง v2, เฟส 1 — 16 ก.ค. 69)
 * =====================================================
 * เก็บ record ที่ผ่าน dnaContract.validateDnaRecord ลง STORE_EXEMPLARS
 * + จัดกลุ่ม cluster ตาม archetype + เก็บประวัติการรันวิจัยลง STORE_RUNS
 * 🔴 pure JS + relative import ล้วน (ให้ node เรียกเทสตรงได้ ไม่ง้อ alias @/)
 * 🔴 ห้ามใช้ persistStore.update() — มีบั๊กยืนยันแล้วว่าไม่ sync ไฟล์ fallback
 *    → ทุกจุดที่ต้อง "แก้ไข record เดิม" ใช้แพตเทิร์น remove(id) แล้ว add(ฉบับใหม่) แทนเสมอ
 */

import { createStore } from '../../persistStore.js';
import {
  STORE_EXEMPLARS,
  STORE_RUNS,
  validateDnaRecord,
  normalizeArchetype,
  makeClusterId,
} from './dnaContract.js';

// ── saveBatch ──────────────────────────────────────────────
/**
 * saveBatch — จุดเข้าเดียวของการเซฟ record ใหม่ล็อตหนึ่งลงคลัง
 * conflict policy: ชนกันทาง postKey (id) หรือ titleHash → reach ใหม่สูงกว่า = replace (สืบทอด clusterId เดิม)
 *                                                          → reach ใหม่ต่ำกว่าเท่ากัน = skip
 * @param {Array<object>} records - record ดิบ (ยังไม่ validate)
 * @returns {Promise<{saved:number, replaced:number, skipped:number, failed:Array<{title:string, errors:string[]}>}>}
 */
export async function saveBatch(records) {
  const failed = [];
  const validated = [];
  for (const raw of Array.isArray(records) ? records : []) {
    const { ok, errors, record } = validateDnaRecord(raw);
    if (!ok) {
      failed.push({ title: (raw && raw.title) || '(ไม่มีหัวข้อ)', errors });
      continue;
    }
    validated.push(record);
  }

  const store = createStore(STORE_EXEMPLARS);
  const existing = await store.getAll();

  // index 2 ชั้น: byId (postKey) + byTitleHash — ใช้เช็คชนก่อนเซฟทุกใบ
  const byId = new Map();
  const byTitleHash = new Map();
  for (const item of existing) {
    if (item.id) byId.set(item.id, item);
    if (item.titleHash) byTitleHash.set(item.titleHash, item);
  }

  // map คลัสเตอร์: archetypeNorm → clusterId — สร้างจาก existing ก่อน แล้วเติมจากใบที่กำลังเซฟชุดนี้
  const clusterMap = new Map();
  for (const item of existing) {
    if (item.archetypeNorm && item.clusterId && !clusterMap.has(item.archetypeNorm)) {
      clusterMap.set(item.archetypeNorm, item.clusterId);
    }
  }

  const now = new Date().toISOString();
  let replaced = 0;
  let skipped = 0;
  const toAdd = [];
  const toRemoveIds = new Set(); // กันลบซ้ำ id เดิมสองรอบถ้าชนทั้ง byId และ byTitleHash ของใบเดียวกัน

  for (const record of validated) {
    const conflictById = byId.get(record.id);
    const conflictByTitle = byTitleHash.get(record.titleHash);
    // ถ้าทั้งสองทางชี้ไปคนละใบ ให้ยึด byId ก่อน (postKey แม่นกว่า titleHash)
    const conflict = conflictById || conflictByTitle;

    // คลัสเตอร์: ใช้ archetypeNorm หา clusterId ที่มีอยู่ ไม่งั้นสร้างใหม่แล้วลง map ให้ใบถัดไปในชุดเดียวกันใช้ต่อ
    let clusterId = record.clusterId;
    if (!clusterId) {
      clusterId = clusterMap.get(record.archetypeNorm) || makeClusterId(record.archetypeNorm);
      clusterMap.set(record.archetypeNorm, clusterId);
    }

    if (conflict) {
      if ((Number(record.reach) || 0) > (Number(conflict.reach) || 0)) {
        // reach ใหม่สูงกว่า → replace: สืบทอด clusterId เดิมของใบที่ถูกแทนที่ (คงกลุ่มเดิมไว้ ไม่ตัดขาดคลัสเตอร์)
        if (!toRemoveIds.has(conflict.id)) {
          toRemoveIds.add(conflict.id);
        }
        const finalRecord = { ...record, clusterId: conflict.clusterId || clusterId, savedAt: now };
        toAdd.push(finalRecord);
        replaced++;
        // อัปเดต index ให้รอบถัดไปในชุดเดียวกันเห็นใบใหม่แทนใบเก่า
        byId.set(finalRecord.id, finalRecord);
        byTitleHash.set(finalRecord.titleHash, finalRecord);
        clusterMap.set(finalRecord.archetypeNorm, finalRecord.clusterId);
      } else {
        skipped++;
      }
      continue;
    }

    const finalRecord = { ...record, clusterId, savedAt: now };
    toAdd.push(finalRecord);
    byId.set(finalRecord.id, finalRecord);
    byTitleHash.set(finalRecord.titleHash, finalRecord);
  }

  // ลบใบเก่าที่ถูกแทนที่ทั้งหมดก่อน (remove ก่อน add เสมอ — ห้ามใช้ update())
  for (const id of toRemoveIds) {
    await store.remove(id).catch((e) => {
      console.error(`[DnaLibrary] saveBatch remove(${id}) ล้มเหลว: ${e.message}`);
    });
  }
  if (toAdd.length > 0) {
    await store.addMany(toAdd);
  }

  return { saved: toAdd.length, replaced, skipped, failed };
}

// ── listExemplars ──────────────────────────────────────────
/**
 * listExemplars — ดึงรายการต้นแบบ พร้อมกรอง + เรียงตาม reach มาก→น้อย
 */
export async function listExemplars({ tier, category, month, clusterId, q, limit = 100 } = {}) {
  const store = createStore(STORE_EXEMPLARS);
  let items = await store.getAll();

  if (tier) items = items.filter((r) => r.tier === tier);
  if (category) items = items.filter((r) => r.dna && r.dna.category === category);
  if (month) items = items.filter((r) => r.month === month);
  if (clusterId) items = items.filter((r) => r.clusterId === clusterId);
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((r) => {
      const title = String(r.title || '').toLowerCase();
      const archetype = String((r.dna && r.dna.archetype) || '').toLowerCase();
      return title.includes(needle) || archetype.includes(needle);
    });
  }

  items = items.slice().sort((a, b) => (Number(b.reach) || 0) - (Number(a.reach) || 0));

  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  return items.slice(0, safeLimit);
}

// ── deleteExemplar ─────────────────────────────────────────
export async function deleteExemplar(postKey) {
  const store = createStore(STORE_EXEMPLARS);
  try {
    await store.remove(postKey);
    return { found: true };
  } catch (e) {
    return { found: false };
  }
}

// ── exportAll ──────────────────────────────────────────────
export async function exportAll() {
  const store = createStore(STORE_EXEMPLARS);
  return store.getAll();
}

// ── clusterSummary ─────────────────────────────────────────
/**
 * clusterSummary — จัดกลุ่ม record ตาม clusterId แล้วสรุปสถิติต่อกลุ่ม
 * archetype ที่แสดง = ของใบ reach สูงสุดในกลุ่มนั้น (ตัวแทนกลุ่ม)
 */
export async function clusterSummary() {
  const store = createStore(STORE_EXEMPLARS);
  const items = await store.getAll();

  const groups = new Map(); // clusterId → array of records
  for (const item of items) {
    const cid = item.clusterId || 'ไม่มีคลัสเตอร์';
    if (!groups.has(cid)) groups.set(cid, []);
    groups.get(cid).push(item);
  }

  const summary = [];
  for (const [clusterId, recs] of groups) {
    const sortedByReach = recs.slice().sort((a, b) => (Number(b.reach) || 0) - (Number(a.reach) || 0));
    const top = sortedByReach[0];
    const reaches = recs.map((r) => Number(r.reach) || 0);
    const maxReach = reaches.length ? Math.max(...reaches) : 0;
    const avgReach = reaches.length ? Math.round(reaches.reduce((s, r) => s + r, 0) / reaches.length) : 0;
    const tierCounts = { S: 0, A: 0 };
    for (const r of recs) {
      if (r.tier === 'S') tierCounts.S++;
      else if (r.tier === 'A') tierCounts.A++;
    }
    summary.push({
      clusterId,
      archetype: (top && top.dna && top.dna.archetype) || '',
      count: recs.length,
      maxReach,
      avgReach,
      tierCounts,
    });
  }

  summary.sort((a, b) => b.count - a.count);
  return summary;
}

// ── Runs (STORE_RUNS) ──────────────────────────────────────
/**
 * createRun — เริ่มบันทึกการรันวิจัย/อัพโหลดไฟล์ 1 ครั้ง
 */
export async function createRun({ runId, fileName, counts, costEstimate, model } = {}) {
  const store = createStore(STORE_RUNS);
  const record = {
    id: runId,
    runId,
    fileName: fileName || '',
    counts: counts || {},
    costEstimate: costEstimate || null,
    model: model || '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
  };
  await store.add(record);
  return record;
}

/**
 * finishRun — ปิดงานการรันวิจัย: หา record เดิม (getAll แล้วหา) → remove แล้ว add ฉบับ merge
 * 🔴 ห้ามใช้ store.update() — ใช้แพตเทิร์น remove แล้ว add ตามกฎ
 */
export async function finishRun(runId, { resultCounts, costActual, synthesis } = {}) {
  const store = createStore(STORE_RUNS);
  const all = await store.getAll();
  const existing = all.find((r) => r.id === runId);
  if (!existing) {
    throw new Error(`ไม่พบ run: ${runId}`);
  }

  const merged = {
    ...existing,
    resultCounts: resultCounts || existing.resultCounts || {},
    costActual: costActual != null ? costActual : existing.costActual ?? null,
    synthesis: synthesis != null ? synthesis : existing.synthesis ?? null,
    finishedAt: new Date().toISOString(),
    status: 'done',
  };

  await store.remove(runId);
  await store.add(merged);
  return merged;
}

/**
 * listRuns — ประวัติการรัน เรียงใหม่→เก่า (ตาม startedAt)
 */
export async function listRuns(limit = 20) {
  const store = createStore(STORE_RUNS);
  const items = await store.getAll();
  const sorted = items.slice().sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
  const safeLimit = Math.max(1, Number(limit) || 20);
  return sorted.slice(0, safeLimit);
}
