// ============================================================
// [MEGA · Candidate Metric Measurements — Batch B2 SHADOW] ผู้วัด "ค่าที่วัดได้จริง" ต่อภาพผู้สมัคร
// ------------------------------------------------------------
// โมดูลนี้ PURE 100% — ไม่มี import / env / IO / Date / random / network เลยแม้แต่ตัวเดียว
//
// หน้าที่: รับหลักฐานที่ "ผ่าน validator แล้ว" (candidate_facts_v1 + face-cache entry ที่ faceDetector
//   วัดไว้แล้ว) → คืน measurements object ที่ผลิต "เฉพาะฟิลด์ที่วัดได้จริง" (วัดไม่ได้ = ไม่ใส่ฟิลด์ =
//   absent ≠ default). ผลลัพธ์นี้ป้อนเข้า buildCandidateMetricsV1 (candidateMetricAuthority B1) เพื่อ
//   แช่แข็ง/hash/bind ต่อ — โมดูลนี้ "วัด" อย่างเดียว ไม่ produce carrier/snapshot เอง
//
// 🔴 กฎเหล็กแหล่งความจริง (fail-closed):
//   • ผลิตจาก "หลักฐานที่ validate แล้ว" เท่านั้น — ห้าม invent/map/เดา
//   • faceShare/headroom/edgeCut มาจาก facts.faceBox (normalized 0-1) เท่านั้น · faceBox null/'unknown'/
//     ไม่มีกล่อง = ไม่ผลิต 3 ฟิลด์นี้ (นิยาม faceShare/headroom ตรงกับ megaAdapters._rhHeroCandidate:2100-2101)
//   • faceCount มาจาก faceCacheEntry.faces.length (การวัดอิสระของ faceDetector) เท่านั้น — 🔴ห้ามใช้
//     triage.faceCount (raw self-reported จากผลค้น — batch4 ล็อกห้ามยกระดับ) · ไม่มี cache entry = ไม่ผลิต
// ============================================================

// ค่าตัวเลข measured field ทั้งหมดอยู่ในช่วง unit [0,1] (สอดคล้อง UNIT_FIELDS ใน candidateMetricAuthority)
const MAX_FACE_COUNT = 100000; // เพดานกันตัวเลขเพี้ยน/หลอก (ตรงกับ candidateMetricAuthority.MAX_FACE_COUNT)

// ── edgeCut policy ──
// EDGE_SAFE_MARGIN = ระยะขอบ "ปลอดภัย" (สัดส่วนของเฟรม) ที่ faceBox ควรเว้นจากขอบทั้งสี่ด้าน
//   ถ้ากล่องหน้าเว้นระยะจากขอบทุกด้าน ≥ margin นี้ ⇒ edgeCut = 0 (ปลอดภัย ไม่โดนตัด)
// EDGE_CUT_POLICY_MAX = เพดานนโยบาย (ผู้บริโภคภายหลังใช้ตัดสิน) — วัดค่าเกินนี้ = "ชิด/ชนขอบเกินรับได้"
export const EDGE_SAFE_MARGIN = 0.05; // 5% ของเฟรม
export const EDGE_CUT_POLICY_MAX = 0.10;

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);
const clampUnit = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

// อ่าน faceBox ที่ผ่าน validator แล้ว → {x1,y1,x2,y2} ที่ปลอดภัย หรือ null (null/'unknown'/พัง = null)
//   candidate_facts_v1.faceBox = object {x1,y1,x2,y2} normalized 0-1 · null (ยืนยันไม่มีหน้า) · 'unknown' (หาย)
function readFaceBox(facts) {
  try {
    if (facts === null || typeof facts !== 'object') return null;
    const fb = facts.faceBox;
    if (fb === null || typeof fb !== 'object') return null; // 'unknown' (string) / null / ไม่มีกล่อง
    const { x1, y1, x2, y2 } = fb;
    if (![x1, y1, x2, y2].every(isFiniteNum)) return null;
    // ต้องอยู่ในกรอบ [0,1] + มีพื้นที่จริง (positive area) — มิฉะนั้นถือว่าไม่มีกล่องที่วัดได้
    if (x1 < 0 || y1 < 0 || x2 > 1 || y2 > 1) return null;
    if (!(x2 > x1) || !(y2 > y1)) return null;
    return { x1, y1, x2, y2 };
  } catch {
    return null; // facts พิสดาร (proxy/getter โยน) = ไม่มีกล่องที่วัดได้ (ไม่ทำให้การวัดอื่นล้ม)
  }
}

// ============================================================
// edgeCut — สัดส่วนการชิด/ชนขอบเฟรมของ faceBox แบบ deterministic
// ------------------------------------------------------------
// นิยาม (deterministic, monotonic, ช่วง [0,1]):
//   ระยะขอบทั้งสี่ด้านของกล่องหน้าเทียบเฟรม = [ x1 (ซ้าย), y1 (บน), 1-x2 (ขวา), 1-y2 (ล่าง) ]
//   minMargin = ระยะขอบที่ "แคบที่สุด" (ด้านที่ชิดขอบมากที่สุด)
//   edgeCut = clamp( 1 - minMargin / EDGE_SAFE_MARGIN , 0, 1 )
//
//   • กล่องกลางเฟรม (ทุกด้านเว้นระยะ ≥ EDGE_SAFE_MARGIN) ⇒ minMargin ≥ 0.05 ⇒ edgeCut = 0  (~0 ตามสเปค)
//   • กล่องชน/ชิดขอบ (บางด้าน margin → 0) ⇒ edgeCut → 1  (สูงกว่า EDGE_CUT_POLICY_MAX=0.10 ชัดเจน)
//   • กล่องเต็มเฟรม (x1≈0,y1≈0,x2≈1,y2≈1) ⇒ ทุก margin ≈ 0 ⇒ edgeCut ≈ 1
//   จุดคุ้ม: edgeCut = 0.10 พอดีเมื่อ minMargin = 0.045 (ต่ำกว่านี้ = เกินนโยบาย)
// ============================================================
export function computeEdgeCut(box) {
  const minMargin = Math.min(box.x1, box.y1, 1 - box.x2, 1 - box.y2);
  return clampUnit(1 - minMargin / EDGE_SAFE_MARGIN);
}

// นับจำนวนหน้าจาก faceCacheEntry ที่ faceDetector วัดไว้ (การวัดอิสระ) — faces ต้องเป็น array เท่านั้น
//   faceCacheEntry = { faces: [...] } (เช่น result object ใน data/face-cache.json ที่มี faces เป็น array)
//   ไม่มี entry / faces ไม่ใช่ array / เกินเพดาน ⇒ undefined (ไม่ผลิต faceCount)
function readFaceCount(faceCacheEntry) {
  try {
    if (faceCacheEntry === null || typeof faceCacheEntry !== 'object') return undefined;
    const faces = faceCacheEntry.faces;
    if (!Array.isArray(faces)) return undefined;
    const n = faces.length;
    if (!Number.isInteger(n) || n < 0 || n > MAX_FACE_COUNT) return undefined;
    return n;
  } catch {
    return undefined; // cache entry พิสดาร = ไม่ผลิต faceCount (ไม่ทำให้การวัดอื่นล้ม)
  }
}

// ============================================================
// measureCandidateMetrics({ facts, faceCacheEntry }) → measurements (เฉพาะที่วัดได้จริง)
//   ★ ห้าม throw กับ input ใด ๆ (top-level backstop) — วัดไม่ได้ = ไม่ใส่ฟิลด์
// ============================================================
export function measureCandidateMetrics(input) {
  const out = {};
  try {
    const src = (input === null || typeof input !== 'object') ? {} : input;
    const facts = src.facts;
    const faceCacheEntry = src.faceCacheEntry;

    const box = readFaceBox(facts);
    if (box) {
      out.faceShare = clampUnit(box.y2 - box.y1); // สัดส่วนความสูงกล่องหน้าต่อเฟรม (นิยามเดียวกับ _rhHeroCandidate:2100)
      out.headroom = clampUnit(box.y1);           // ระยะเหนือหัวถึงขอบบน (นิยามเดียวกับ _rhHeroCandidate:2101)
      out.edgeCut = computeEdgeCut(box);
    }

    const faceCount = readFaceCount(faceCacheEntry);
    if (faceCount !== undefined) out.faceCount = faceCount;
  } catch {
    return {}; // input พิสดารใด ๆ = absent ทั้งก้อน (ห้าม throw ให้ผู้เรียก)
  }
  return out;
}
