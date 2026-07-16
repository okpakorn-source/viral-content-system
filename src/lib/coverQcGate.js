// ============================================================
// 🚦 MEGA — Hard QC Gate (Wave 2 · Batch A1)
// ------------------------------------------------------------
// ปัญหาเดิม: composeAndVerify คืน success:true "เสมอ" และ S7 เก็บทุกใบเข้าคลัง
//   → คลังจริงมีของเสียปนกว่าครึ่ง (ปกยืดเบลอ/คนโดนตัด/วงคนซ้ำ hero)
// หน้าที่ไฟล์นี้: ฟังก์ชัน pure ตัวเดียว ตัดสินจาก "ธงคุณภาพ deterministic" (qcFlags)
//   ที่ composer ติดให้ (megaComposerService.js) — เทสได้โดด ไม่แตะ IO/LLM
//
// 🔴 กติกาสำคัญ: refSimilarity (ตาเทียบ ref) เป็น "advisory เท่านั้น ห้ามใช้ตัด"
//   พิสูจน์แล้ว 10 ก.ค. เคส AC-0066: ตาให้ 0% ทั้งที่ปกมี circle ตรงกับ ref จริง
//   → เชื่อไม่ได้จนกว่าจะมีเครื่องวัดใหม่ (งานค้างใน mega-v2-plan)
//
// รูปแบบ qcFlags (ยืนยันจาก megaComposerService.js — ห้ามเดา):
//   FAIL → needs_gap_search (วัตถุดิบไม่พอดี ควรหาภาพเพิ่ม):
//     · 'upscaled:<slot>:<ratio>'      ยืดจริง >1.6x (executor วัด region→slot)
//     · 'upscale_soft:<slot>:<ratio>'  ยืดจริง 1.2–1.6x
//     · 'upscaled_src:<slot>:<ratio>'  ยืดต้นทาง (hard floor 3.1 หาใบยืดน้อยกว่าไม่ได้)
//     → hero/main เกิน 1.2x = ไม่ผ่าน · ช่องอื่นเกิน 1.6x = ไม่ผ่าน
//   FAIL → manual_review (คนต้องดู — composer พยายามแก้จนสุดแล้วยังไม่ได้):
//     · 'blind_crop:<slot>'            ครอปตาบอด (ไร้หน้า/subject)
//     · 'person_cut:<slot>'            คนโดนเฟรมตัด (ไม่มีตัวสำรอง/ครอปแก้ไม่ได้)
//     · 'circle_same_person_as_hero'   วงกลมเป็นคนเดียวกับ hero (ไม่มีตัวเลือกจริง)
//     · 'hero_profile_forced'          hero มุมข้าง/หลัง เพราะคลังไม่มีหน้าตรง/เฉียง
//     · 'blank_image:<slot>'           ภาพเปล่า/เกือบสีเดียวล้วน (aHash บิตเกือบเท่ากันหมด — เคสวงกลมว่างในคลังจริง)
//     · 'hero_gate_error'              ★ AC-0099 (LANE-D): ด่านตรวจ hero (legacy composeCore) โยน exception → fail-open ปล่อยผ่าน แต่ hero ไม่ถูกยืนยัน
//     · 'hero_unverified_kept'         ★ AC-0099 (LANE-D): hero ไม่ผ่านด่านบังคับแต่ไม่มีตัวสำรอง → คงใบเดิมทั้งที่ยังไม่ยืนยัน
//   BENIGN (ไม่นับ — ไม่กระทบ pass): feather_capped · enhanced:hero:* ·
//     border_trimmed:* · hero_pose:* · enhance_failed:hero · upscale_soft:<ช่องอื่น> ≤1.6
//
// ★ Wave2 Batch D2 (10 ก.ค.): ธง "กติกาวัดได้" 23 ข้อจากคลังเทคนิคปก (measureTechRules ใน megaComposerService.js)
//   โหมดจาก env MEGA_TECH_RULES_MODE: 'advisory' (default) = ทุกธงใหม่ลง advisory[] ไม่กระทบ pass · 'hard' = บางธงตัด
//   รูปแบบธงใหม่ (อ้าง P-id ในคลัง):
//     · 'face_share_out:<slot>:<pct>'   หน้ากินช่องนอก band panelNorms (P-CROP-01/panelNorms รายช่อง)
//     · 'headroom_out:<slot>:<pct>'     headroom hero นอก -2..15% (P-CROP-01)
//     · 'circle_face_overlap:<slot>'    วงกลมทับ/ใกล้หน้าคนในช่องใต้ (P-CIRCLE-01)
//     · 'ladder_break:<a>:<b>:<gap>'    บันไดขนาดหน้าคู่ติดกันห่าง <8pt (P-ZOOM-01)
//     · 'panel_count_out:<n>'           จำนวนช่อง >6 (P-LAYOUT-01)
//     · 'circle_border_out:<px>'        ขอบขาววง 0/ไม่มี หรือ >16px (P-CIRCLE-01)
//   โหมด hard ตัดเฉพาะ: face_share_out/headroom_out "เฉพาะ hero" → needs_gap_search ·
//     circle_face_overlap → manual_review · ที่เหลือ (ladder_break/panel_count_out/circle_border_out/
//     face_share_out ช่องรอง) = advisory เสมอแม้ hard (เหตุผล: pair แยกไม่ได้ · ฐาน px วงไม่รู้)
//   MEGA_HARD_QC=0 ยัง bypass ทั้งด่านเหมือนเดิม (ธงใหม่ก็ไม่ทำให้ fail)
//
// ★ แบตช์ F (17 ก.ค.): ธงคุณภาพชุดใหม่ — แต่ละตัวมี kill-switch env ของตัวเอง (default ON), ไม่ขึ้นกับ MEGA_TECH_RULES_MODE
//   · 'face_overflow:<slot>:<pct>'         หน้ากินช่อง ≥100% → manual_review · MEGA_FACE_OVERFLOW_HARD='0' → advisory
//   · 'duplicate_person_panels:<p>:<n>'    คนเดียว ≥3/5 ช่อง → manual_review · MEGA_PERSON_DIVERSITY='0' → advisory
//   · 'duplicate_scene:<a>:<b>'            ฉากซ้ำ (ฝั่งไร้หน้า) → manual_review · MEGA_SCENE_DEDUP='0' → advisory
//   · 'hero_face_unmeasured'               hero วัดหน้าไม่ได้ → advisory เสมอ (ไม่ gating — แค่มองเห็น)
//   · ธงยืด 'upscaled/upscale_soft:<circle>' → เพดานเข้ม 1.2x เท่า hero · MEGA_CIRCLE_STRICT_UPSCALE='0' → 1.6x เดิม
// ============================================================

const DEFAULT_THRESHOLDS = { hero: 1.2, other: 1.6 };

// ธง "ยืด" ทั้ง 3 ตระกูล: <prefix>:<slot>:<ratio> — ratio เป็นเลขทศนิยม
const STRETCH_RE = /^(upscaled|upscale_soft|upscaled_src):(.+):(\d+(?:\.\d+)?)$/;

// slot ที่ถือเป็น hero/main (mirror /main|hero/i ที่ composer ใช้เลือกช่องหลัก)
function isHeroSlot(slot) {
  return /main|hero/i.test(String(slot || ''));
}

// ★ แบตช์ F (F4): slot วงกลม (identity focus) — mirror shape 'circle' / id ที่ขึ้นต้น circle ใน composer
function isCircleSlot(slot) {
  return /circle/i.test(String(slot || ''));
}

/**
 * ประเมินด่าน QC ของปก 1 ใบ (pure — เทสได้โดด ไม่มี side effect)
 * @param {{ qcFlags?: string[], refSimilarity?: number|null, manifest?: object|null }} input
 * @param {{ thresholds?: { hero?: number, other?: number } }} [opts] override เพดานยืด (เผื่ออนาคต)
 * @returns {{ pass: boolean, reasons: string[], suggestedStatus: ('needs_gap_search'|'manual_review'|null), advisory: string[] }}
 */
export function evaluateCoverQc(input = {}, opts = {}) {
  const { qcFlags = [], refSimilarity = null } = input || {};
  const HERO_MAX = Number(opts?.thresholds?.hero ?? DEFAULT_THRESHOLDS.hero);
  const OTHER_MAX = Number(opts?.thresholds?.other ?? DEFAULT_THRESHOLDS.other);

  const flags = Array.isArray(qcFlags) ? qcFlags.map((f) => String(f)) : [];
  const reasons = [];
  const advisory = [];
  let gapFail = false; // → needs_gap_search
  let reviewFail = false; // → manual_review
  // ★ Wave2 Batch D2: โหมดกติกาวัดได้ — 'advisory' (default) ไม่กระทบ pass · 'hard' = บางธงตัด
  const techHard = process.env.MEGA_TECH_RULES_MODE === 'hard';

  for (const f of flags) {
    // ── ① ธงยืด (needs_gap_search) ──
    const ms = STRETCH_RE.exec(f);
    if (ms) {
      const slot = ms[2];
      const ratio = Number(ms[3]);
      const hero = isHeroSlot(slot);
      // ★ แบตช์ F (F4): วงกลมคือจุดโฟกัส identity — เข้ากลุ่มเพดานเข้ม 1.2x เท่า hero (เดิม 1.6x ทำ 1.39x เงียบ)
      //   kill-switch MEGA_CIRCLE_STRICT_UPSCALE='0' → วงกลมกลับไปเพดาน 1.6x เดิม (byte-parity)
      const circleStrict = process.env.MEGA_CIRCLE_STRICT_UPSCALE !== '0' && !hero && isCircleSlot(slot);
      const limit = (hero || circleStrict) ? HERO_MAX : OTHER_MAX;
      if (Number.isFinite(ratio) && ratio > limit) {
        gapFail = true;
        reasons.push(
          `${hero ? 'hero/main' : circleStrict ? `วงกลม ${slot}` : `ช่อง ${slot}`} ยืด ${ratio.toFixed(2)}x เกินเพดาน ${limit}x → วัตถุดิบไม่พอดี ควรหาภาพเพิ่ม [${f}]`
        );
      }
      continue; // ธงยืดที่ไม่เกินเพดาน = ยอมรับได้ (benign)
    }

    // ── ② ธงคนต้องดู (manual_review) — composer พยายามแก้จนสุดแล้ว ──
    if (/^blind_crop(:|$)/.test(f)) {
      reviewFail = true;
      reasons.push(`ครอปตาบอด (ไร้หน้า/subject) [${f}] → คนต้องดู`);
      continue;
    }
    if (/^person_cut(:|$)/.test(f)) {
      reviewFail = true;
      reasons.push(`คนโดนเฟรมตัด (ไม่มีตัวสำรอง/ครอปแก้ไม่ได้) [${f}] → คนต้องดู`);
      continue;
    }
    if (f === 'circle_same_person_as_hero') {
      reviewFail = true;
      reasons.push('วงกลมเป็นคนเดียวกับ hero (ไม่มีตัวเลือกจริง) → คนต้องดู');
      continue;
    }
    if (f === 'hero_profile_forced') {
      reviewFail = true;
      reasons.push('hero เป็นมุมข้าง/หลัง (คลังไม่มีหน้าตรง/เฉียงให้เลือก) → คนต้องดู');
      continue;
    }
    // ★ W2 (จากคลังจริง 10 ก.ค.): ภาพเปล่า/เกือบสีเดียวล้วนลงช่อง — เจอ "วงกลมว่าง" 2 ใบในคลัง
    //   composer ติดธงจาก aHash เกือบทุกบิตเท่ากัน (blank_image:<slot>) → คนต้องดูเสมอ
    if (/^blank_image(:|$)/.test(f)) {
      reviewFail = true;
      reasons.push(`ภาพเปล่า/เกือบสีเดียวล้วนลงช่อง [${f}] → คนต้องดู`);
      continue;
    }
    // ★ AC-0099 (LANE-D): ความล้มเหลวเงียบของ hero pixel-gate ใน legacy composeCore (เดิม fail-open เงียบ)
    //   composer คง fail-open ปล่อยงานผ่านเหมือนเดิม แต่ติดธงให้ QC เห็น → คนต้องดู (ไม่วนหาภาพเพิ่มเปล่าๆ)
    if (f === 'hero_gate_error') {
      reviewFail = true;
      reasons.push('ด่านตรวจ hero ล้ม (exception) → hero ไม่ถูกยืนยัน ปล่อยผ่านแบบ fail-open [hero_gate_error] → คนต้องดู');
      continue;
    }
    if (f === 'hero_unverified_kept') {
      reviewFail = true;
      reasons.push('hero ไม่ผ่านด่านบังคับแต่ไม่มีตัวสำรอง → คงใบเดิมทั้งที่ยังไม่ยืนยัน [hero_unverified_kept] → คนต้องดู');
      continue;
    }
    // ── ★ แบตช์ F: ธงคุณภาพชุดใหม่ (F1/F2/F3/F5) — แต่ละตัวมี kill-switch env เป็นของตัวเอง ──
    // F1 face_overflow: หน้าใหญ่กว่าช่อง ≥100% → manual_review "ทุก mode" (ไม่ขึ้นกับ MEGA_TECH_RULES_MODE)
    //   default hard (≥100% ผิดแน่ ไม่มี false positive) · MEGA_FACE_OVERFLOW_HARD='0' → advisory (ธงยังออก)
    if (/^face_overflow(:|$)/.test(f)) {
      if (process.env.MEGA_FACE_OVERFLOW_HARD !== '0') {
        reviewFail = true;
        reasons.push(`หน้าใหญ่กว่าช่อง (≥100%) [${f}] → เป็นไปไม่ได้ที่จะครอปถูก คนต้องดู (hard ทุก mode)`);
      } else {
        advisory.push(`หน้าใหญ่กว่าช่อง (≥100%) [${f}] — advisory (MEGA_FACE_OVERFLOW_HARD=0)`);
      }
      continue;
    }
    // F2 duplicate_person_panels: คนเดียวกินหลายช่อง (≥3/5) → manual_review · MEGA_PERSON_DIVERSITY='0' → advisory
    if (/^duplicate_person_panels(:|$)/.test(f)) {
      if (process.env.MEGA_PERSON_DIVERSITY !== '0') {
        reviewFail = true;
        reasons.push(`คนเดียวกินหลายช่อง (≥3 จาก 5) [${f}] → คนต้องดู`);
      } else {
        advisory.push(`คนเดียวกินหลายช่อง [${f}] — advisory (MEGA_PERSON_DIVERSITY=0)`);
      }
      continue;
    }
    // F3 duplicate_scene: ฉากซ้ำระหว่างช่อง (ฝั่งไร้หน้า, aHash ใกล้กัน) → manual_review · MEGA_SCENE_DEDUP='0' → advisory
    if (/^duplicate_scene(:|$)/.test(f)) {
      if (process.env.MEGA_SCENE_DEDUP !== '0') {
        reviewFail = true;
        reasons.push(`ฉากซ้ำระหว่างช่อง (aHash ใกล้กัน ฝั่งไร้หน้า) [${f}] → คนต้องดู`);
      } else {
        advisory.push(`ฉากซ้ำระหว่างช่อง [${f}] — advisory (MEGA_SCENE_DEDUP=0)`);
      }
      continue;
    }
    // F5 hero_face_unmeasured: hero วัดหน้าไม่ได้ (faceMetrics null) → advisory เสมอ (มองเห็น ไม่ gating)
    if (f === 'hero_face_unmeasured') {
      advisory.push('hero วัดหน้าไม่ได้ (faceMetrics null) — advisory (มองเห็น ไม่ตัด)');
      continue;
    }

    // ── ③ ★ Wave2 Batch D2: ธง "กติกาวัดได้" จากคลังเทคนิคปก (advisory default / hard บางตัว) ──
    //   face_share_out/headroom_out เฉพาะ hero → needs_gap_search (hard) · ช่องรอง = advisory เสมอ
    const mShare = /^(?:face_share_out|headroom_out):([^:]+):/.exec(f);
    if (mShare) {
      const slot = mShare[1];
      const hero = isHeroSlot(slot);
      const kind = f.startsWith('headroom') ? 'headroom' : 'หน้ากินช่อง';
      if (techHard && hero) {
        gapFail = true;
        reasons.push(`${kind} hero นอกเกณฑ์คลังเทคนิค [${f}] → วัตถุดิบไม่พอดี ควรหาภาพเพิ่ม (hard)`);
      } else {
        advisory.push(`${kind} ${hero ? 'hero' : `ช่อง ${slot}`} นอกเกณฑ์คลังเทคนิค [${f}]${techHard && !hero ? ' — ช่องรอง = advisory แม้ hard' : ''}`);
      }
      continue;
    }
    // circle_face_overlap → manual_review (hard) — วงทับหน้าคนในช่องใต้ (P-CIRCLE-01)
    if (/^circle_face_overlap(:|$)/.test(f)) {
      if (techHard) {
        reviewFail = true;
        reasons.push(`วงกลมทับ/ใกล้หน้าคนในช่องใต้ [${f}] → คนต้องดู (hard)`);
      } else {
        advisory.push(`วงกลมทับ/ใกล้หน้าคนในช่องใต้ [${f}] — advisory`);
      }
      continue;
    }
    // ladder_break → advisory เสมอแม้ hard (P-ZOOM-01: คู่ข่าว pair ที่ถูกต้องก็ติดธงนี้ แยกไม่ได้)
    if (/^ladder_break(:|$)/.test(f)) {
      advisory.push(`บันไดขนาดหน้าคู่ช่องติดกันห่างไม่ถึง 8pt [${f}] — advisory เสมอ (คู่ข่าว pair ถูกต้องก็ติด แยก role ไม่ได้)`);
      continue;
    }
    // panel_count_out → advisory เสมอ (P-LAYOUT-01)
    if (/^panel_count_out(:|$)/.test(f)) {
      advisory.push(`จำนวนช่องเกินผังมาตรฐาน (>6) [${f}] — advisory`);
      continue;
    }
    // circle_border_out → advisory เสมอ (P-CIRCLE-01: ฐานกว้างตอนศึกษา ref ไม่รู้ → เชื่อเป็นเส้นตัดไม่ได้)
    if (/^circle_border_out(:|$)/.test(f)) {
      advisory.push(`ขอบขาววงกลมนอกเกณฑ์ 4-10px [${f}] — advisory (ฐานกว้าง ref ไม่รู้)`);
      continue;
    }

    // ── ④ ที่เหลือ = benign (feather_capped/enhanced/border_trimmed/hero_pose/enhance_failed/upscale_soft ช่องอื่น≤1.6) — ไม่นับ ──
  }

  // ── refSimilarity: advisory เท่านั้น (ห้ามใช้ตัด — พิสูจน์แล้วสวนตาคนจริง) ──
  if (refSimilarity != null) {
    advisory.push(
      `refSimilarity=${refSimilarity} — advisory เท่านั้น (ตาเทียบให้ 0% กับปกที่มี circle จริง พิสูจน์ 10 ก.ค. เคส AC-0066 · เชื่อไม่ได้จนกว่ามีเครื่องวัดใหม่)`
    );
  }

  const failed = gapFail || reviewFail;
  // precedence: manual_review ชนะ needs_gap_search เมื่อเกิดพร้อมกัน —
  //   ธง manual_review ยิงหลัง composer พยายามหาตัวสำรอง/ครอปแก้จนสุดแล้ว (person_cut="แก้ไม่ได้จริง",
  //   circle_same="ไม่มีตัวเลือกจริง", hero_profile_forced="ไม่มีหน้าตรงให้เลือก") → คนควรตัดสิน ไม่ใช่วนหาภาพเพิ่มเปล่าๆ
  //   (reasons เก็บครบทุกข้ออยู่แล้ว — ไม่เสียข้อมูล) · แก้ทีเดียวถ้าจะสลับลำดับ
  let suggestedStatus = null;
  if (failed) suggestedStatus = reviewFail ? 'manual_review' : 'needs_gap_search';

  // ── kill switch: MEGA_HARD_QC=0 → คืน pass:true เสมอ (แต่ยังรายงาน reasons ให้เห็นความจริง) ──
  if (process.env.MEGA_HARD_QC === '0') {
    return {
      pass: true,
      reasons,
      suggestedStatus: null,
      advisory: [...advisory, 'MEGA_HARD_QC=0 (kill switch) — ด่านปิด ปล่อยผ่านทุกใบ (reasons ยังรายงาน)'],
    };
  }

  return { pass: !failed, reasons, suggestedStatus, advisory };
}

export default evaluateCoverQc;
