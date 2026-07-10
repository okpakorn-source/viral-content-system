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
    // ── ③ ที่เหลือ = benign (feather_capped/enhanced/border_trimmed/hero_pose/enhance_failed/upscale_soft ช่องอื่น≤1.6) — ไม่นับ ──
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
