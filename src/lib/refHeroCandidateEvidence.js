// ============================================================
// [MEGA · Ref-Hero Candidate Evidence — Wave1A · P1-E1 FINAL · PRIMITIVE DORMANT SENTINEL]
// ------------------------------------------------------------
// 🔴 ROOT-CAUSE สุดท้าย (independent re-review = HOLD): แม้ "zero mint" จะจริง แต่การคืน "object result" ยังพึ่ง
//   ambient Object.freeze/isFrozen/keys ในการสร้าง/แช่แข็ง. ภายใต้ threat model "same-realm primordial poisoning"
//   ผู้โจมตี wrap Object.freeze (ก่อน/หลัง import) ให้ "mutate root authenticated=true / claim.value=true ก่อน
//   delegate" หรือ no-op/throw ได้ → object ที่คืนมามี field ให้ยัดค่า. Proxy reflection ก็ติดตั้ง poison ก่อน
//   สร้าง result ได้.
//
// ✅ วิธีเดียวที่ปิดได้จริงในโหมด dormant: builder เพิกเฉย argument ทั้งหมด (ZERO input observation) และคืน
//   "PRIMITIVE literal ตัวเดียว" โดยไม่เรียก Object / Reflect / WeakMap / Proxy / deepFreeze ใด ๆ.
//   primitive string เป็น immutable โดยเนื้อแท้ → ไม่มี field ให้ mutate, ไม่มี intrinsic ให้ poison มีผล,
//   ไม่มี trap/getter ของ input ให้สังเกต. คืนค่าเดิม byte-exact ทุกครั้ง.
//
// 🛌 DORMANT: shape/base/crop validation + trusted authenticated-positive producer ถูก DEFER ไปโมดูล/เรียลม์
//   (realm/worker) ที่แยกและ trusted ในอนาคต — ไม่อยู่ในไฟล์นี้. ไฟล์นี้ไม่ทำ validation ใด ๆ, ไม่คืน object /
//   deep-frozen result, ไม่มี marker/mint/registry, ไม่มี positive path.
//
// PURE 100% — ไม่มี IO / network / env / Date / random / runtime import · ไม่มี Object/Reflect/WeakMap/Proxy call ·
//   คืน primitive literal ตัวเดียว
// ============================================================

// ★ primitive string constants only — intrinsically immutable, ไม่มี object ให้ mutate, ไม่มี Object.freeze ให้พึ่ง.
export const REF_HERO_EVIDENCE_DORMANT = 'DORMANT_NO_TRUSTED_PRODUCER'; // ← ค่าเดียวที่ builder คืน (sentinel)
export const REF_HERO_EVIDENCE_SCOPE = 'ref_hero_candidate_evidence_v1';
export const REF_HERO_EVIDENCE_PRODUCER = 'REF_HERO_CANDIDATE_EVIDENCE_V1';
export const REF_HERO_INPUT_SCOPE = 'ref_hero_candidate_evidence_input_v1';
export const REF_HERO_WIRING_NOTE =
  'DORMANT primitive sentinel: this runtime module ignores its argument, performs ZERO input observation and ZERO ' +
  'intrinsic (Object/Reflect/WeakMap/Proxy) calls, and returns exactly one immutable primitive string. It does NOT ' +
  'validate shape/base/crop and does NOT return a deep-frozen object. Shape/base/crop validation AND the trusted ' +
  'authenticated-positive producer are DEFERRED to a separate, isolated, trusted module/realm.';

// ★ The builder is a NON-CONSTRUCTABLE const ARROW (no [[Construct]], no `.prototype`) so `new builder()` /
//   `Reflect.construct(builder, [])` throw TypeError and cannot discard the primitive return to yield a fresh mutable
//   object. It IGNORES its argument entirely (no parameter bound ⇒ zero input observation — no getter/trap can fire)
//   and returns exactly ONE primitive literal. No object/array, no Object/Reflect/WeakMap/Proxy call, no deepFreeze,
//   no validation, no marker/mint. There is no field to mutate and no intrinsic whose poisoning could change the
//   result — even under same-realm primordial poisoning (pre- or post-import).
export const buildRefHeroCandidateEvidence = () => 'DORMANT_NO_TRUSTED_PRODUCER';
