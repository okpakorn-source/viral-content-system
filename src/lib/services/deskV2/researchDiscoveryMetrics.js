/**
 * ============================================================
 * 📏 Research Discovery Metrics (เฟส 0) — คำนวณ "ตัววัดผล" ของ 1 รอบล่า
 * ============================================================
 * โหมด shadow: รับตัวอย่างที่ ResearchTab ส่งมา → นับ "เรื่องใหม่จริง" / สัดส่วนช่องทาง /
 *   ลีดสัมภาษณ์ / เรื่องซ้ำ / ส่วนต่างจากเป้า — ยังไม่เปลี่ยน candidate ที่ผู้ใช้เห็น
 *
 * 🔴 pure JS + ไม่มี import ใดๆ (ให้ node เรียกเทสตรงได้ ไม่ง้อ node_modules/alias)
 * 🔴 ผู้เรียก (researchTrace.logRun) เป็นคนดึง priorStoryKeys + targets มาป้อน
 *    — priorStoryKeys "ต้องตัด record ของ runId ปัจจุบันออกก่อน" (กันนับเรื่องตัวเองเป็นของเก่า)
 *
 * รูป item ที่รับ (ทุก field optional ยกเว้นตัวชี้ตัวตน):
 *   { urlKey, storyKey?, fingerprint?, channel?, platformGroup?, category?, lane?, kept? }
 */

// ── นับความถี่ตาม key ──────────────────────────────────────────
function tally(items, keyFn) {
  const out = {};
  for (const it of items) {
    if (!it) continue;
    const k = keyFn(it);
    if (k == null || k === '') continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// ── ส่วนต่างสัดส่วนช่องทางจริง vs เป้า (targets.platformPct) ──
function computeTargetDelta(byGroup, targetPct) {
  const total = Object.values(byGroup).reduce((a, b) => a + b, 0);
  const groups = new Set([...Object.keys(byGroup), ...Object.keys(targetPct || {})]);
  const delta = {};
  for (const g of [...groups].sort()) {
    const actualPct = total ? Math.round(((byGroup[g] || 0) / total) * 1000) / 10 : 0; // 1 ทศนิยม (%)
    const targetP = Number((targetPct || {})[g] || 0);
    delta[g] = { actualPct, targetPct: targetP, deltaPct: Math.round((actualPct - targetP) * 10) / 10 };
  }
  return delta;
}

// provisionalStoryKey — คีย์เรื่องชั่วคราว (ใช้ก่อนเฟส 5) จาก fingerprint {names,action,timeHint,numbers}
//   คืน '' ถ้าไม่มั่นใจ (ไม่มีชื่อ + ไม่มี action) → ผู้เรียกถือว่า "ระบุเรื่องไม่ได้" (นับเป็นเรื่องแยก)
//   ชื่อเรียงก่อน hash เพื่อให้เรื่องเดียวกัน (คนละลำดับชื่อ) ได้คีย์เดียวกัน
export function provisionalStoryKey(fingerprint) {
  const f = fingerprint || {};
  const names = (Array.isArray(f.names) ? f.names : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean).sort();
  const action = String(f.action || '').trim().toLowerCase();
  const timeHint = String(f.timeHint || '').trim().toLowerCase();
  const numbers = (Array.isArray(f.numbers) ? f.numbers : []).map((x) => String(x).trim()).filter(Boolean).sort();
  if (!names.length && !action) return '';
  return [names.join('|'), action, timeHint, numbers.join('|')].join('::');
}

// ตัวชี้ตัวตน "เรื่อง" — storyKey → fingerprint(เฉพาะ string) → urlKey
//   fingerprint แบบ object ต้องถูกแปลงเป็น storyKey ด้วย provisionalStoryKey โดยผู้เรียกก่อน (กัน "[object Object]")
function storyKeyOf(it) {
  if (!it) return '';
  if (it.storyKey) return String(it.storyKey);
  if (typeof it.fingerprint === 'string' && it.fingerprint) return it.fingerprint;
  return String(it.urlKey || '');
}

/**
 * computeDiscoveryMetrics — สรุปเมตริก 1 รอบล่า
 * @param {object} args
 * @param {object[]} [args.sample=[]]        - ตัวอย่างที่วัด (candidate หลัง judge)
 * @param {string[]} [args.priorStoryKeys=[]] - เรื่องที่เพจเคยทำ (ตัด runId ปัจจุบันออกแล้ว)
 * @param {object} [args.targets={}]          - {platformPct:{...}} จาก getDiscoveryConfig
 * @param {number} [args.sourceFailureCount=0]
 * @param {string} [args.mode='shadow']
 */
export function computeDiscoveryMetrics({
  sample = [],
  priorStoryKeys = [],
  targets = {},
  sourceFailureCount = 0,
  mode = 'shadow',
} = {}) {
  const items = Array.isArray(sample) ? sample.filter(Boolean) : [];
  const priorSet = new Set((Array.isArray(priorStoryKeys) ? priorStoryKeys : []).map(String));

  const kept = items.filter((it) => it.kept);

  // เรื่องไม่ซ้ำในกลุ่มที่เก็บ + เรื่องใหม่ (ไม่เคยทำ)
  const keptStoryKeys = new Set(kept.map(storyKeyOf).filter(Boolean));
  const uniqueStoryCount = keptStoryKeys.size;
  let novelStoryCount = 0;
  for (const k of keptStoryKeys) if (!priorSet.has(k)) novelStoryCount++;
  const noveltyRate = uniqueStoryCount
    ? Math.round((novelStoryCount / uniqueStoryCount) * 1000) / 1000
    : 0;

  const byPlatformGroup = tally(items, (it) => it.platformGroup || it.channel || 'unknown');
  const byCategory = tally(items, (it) => it.category || 'unknown');

  // เรื่องซ้ำ = url เดียวโผล่หลายครั้ง (ผลรวมส่วนเกิน)
  const urlCounts = tally(items, (it) => String(it.urlKey || ''));
  let duplicateEvidenceCount = 0;
  for (const n of Object.values(urlCounts)) if (n > 1) duplicateEvidenceCount += n - 1;

  const interviewCandidateCount = items.filter((it) => it.lane === 'interview').length;
  const interviewKeptCount = kept.filter((it) => it.lane === 'interview').length;

  return {
    schemaVersion: 2,
    mode,
    candidateCount: items.length,
    judgedCount: items.length, // shadow: ทุกใบใน sample ผ่านการตัดสินแล้ว
    keptCount: kept.length,
    uniqueStoryCount,
    novelStoryCount,
    noveltyRate,
    byPlatformGroup,
    byCategory,
    interviewCandidateCount,
    interviewKeptCount,
    duplicateEvidenceCount,
    sourceFailureCount: Math.max(0, Number(sourceFailureCount) || 0),
    targetDelta: computeTargetDelta(byPlatformGroup, targets.platformPct || {}),
  };
}
