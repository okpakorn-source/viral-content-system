/**
 * ด่านตัดสิน "ข้ามผู้ตรวจ AI" — มาตรการ B (เจ้าของเคาะ 9 ก.ย. 69 "เอาการถอดที่ไวและงานลื่นสุด")
 * ────────────────────────────────────────────────────────────────────────────
 * ข้ามได้เฉพาะงานที่พิสูจน์แล้วว่าสะอาดสองชั้น:
 *   1) ประเด็น v2 ผ่านด่านคุณภาพ (composeQualityGate.pass = ด่านแข็งทุกข้อเป็นศูนย์)
 *   2) ชั้นโค้ด (checkAgainstTruth) ไม่มีจุดความรุนแรง "สูง"
 * ผลที่ได้: ตัดผู้ตรวจ AI p50 ~4.3 นาที + ~$0.61 ต่อเคส · ชั้นโค้ด + readiness ยังตรวจครบ
 * บังคับตรวจทุกเคสเหมือนเดิม = ตั้ง env CLIP_REVIEWER_ALWAYS=1
 */
export function shouldSkipReviewer({ v2Ok, codeHighCount, forceReview } = {}) {
  if (forceReview) return false;
  if (v2Ok !== true) return false;
  // นับไม่ได้ = ไม่รู้ว่าสะอาดจริงไหม → ตรวจไว้ก่อน
  if (!Number.isInteger(codeHighCount) || codeHighCount !== 0) return false;
  return true;
}
