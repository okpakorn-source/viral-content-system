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
// ============================================================

const DEFAULT_THRESHOLDS = { hero: 1.2, other: 1.6 };

// ธง "ยืด" ทั้ง 3 ตระกูล: <prefix>:<slot>:<ratio> — ratio เป็นเลขทศนิยม
const STRETCH_RE = /^(upscaled|upscale_soft|upscaled_src):(.+):(\d+(?:\.\d+)?)$/;

// slot ที่ถือเป็น hero/main (mirror /main|hero/i ที่ composer ใช้เลือกช่องหลัก)
function isHeroSlot(slot) {
  return /main|hero/i.test(String(slot || ''));
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
      const limit = hero ? HERO_MAX : OTHER_MAX;
      if (Number.isFinite(ratio) && ratio > limit) {
        gapFail = true;
        reasons.push(
          `${hero ? 'hero/main' : `ช่อง ${slot}`} ยืด ${ratio.toFixed(2)}x เกินเพดาน ${limit}x → วัตถุดิบไม่พอดี ควรหาภาพเพิ่ม [${f}]`
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
