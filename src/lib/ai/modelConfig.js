/**
 * ========================================
 * MODEL CONFIG — Centralized AI Model Names
 * ========================================
 * เปลี่ยน model ที่นี่จุดเดียว → ทุกที่ในระบบเปลี่ยนตาม
 * 
 * Last updated: 2026-06-08
 * 
 * ★ STRATEGY:
 *   gpt-5.5      = สมองใหญ่ / ตัดสินใจ / คุณภาพ
 *   gpt-5.4-mini = ลูกมือ / งานเร็ว / งานเยอะ / ประหยัด
 */

// ═══════════════════════════════════════════
// ★ กลุ่ม 1: งานหนัก — ใช้ gpt-5.5
//   วิเคราะห์ข่าว, วาง Workflow, ตัดสินใจ,
//   ตรวจคุณภาพปก, Agent คุม, เหตุผลหลายชั้น
// ═══════════════════════════════════════════
export const MODEL_MAIN_REASONING  = 'gpt-5.5';  // สมองหลัก — reasoning หลายชั้น
export const MODEL_NEWS_ANALYSIS   = 'gpt-5.5';  // วิเคราะห์ข่าว (clip-insight/news-hunt/topic-hunt + ตัวสำรองขั้นเขียน ยังใช้ค่านี้)
// ★ 16 ก.ค. 69 (B6.2 — เจ้าของเคาะ): breakdown สายข่าว text → terra ตามผล A/B
//   (เคสจริง: terra 42.1s vs gpt-5.5 125.4s, มุมข่าว 12=12 คุณภาพเท่ากัน, ราคาครึ่งเดียว $2.5/$15)
//   แยกค่าเฉพาะจุด — ไม่แตะ MODEL_NEWS_ANALYSIS กลาง กันระบบอื่นเปลี่ยนตามโดยไม่ตั้งใจ; ถอยกลับ = ค่าเดียวนี้
export const MODEL_BREAKDOWN       = 'gpt-5.6-terra';
export const MODEL_COVER_JUDGE     = 'gpt-5.5';  // ตัดสิน/ให้คะแนนปก (Curator + Judge)
export const MODEL_FINAL_QA        = 'gpt-5.5';  // ตรวจคุณภาพขั้นสุดท้าย
export const MODEL_CONTENT_WRITE   = 'gpt-5.5';  // เขียนเนื้อหาข่าว

// ═══════════════════════════════════════════
// ★ กลุ่ม 2: งานเร็ว/ประหยัด — ใช้ gpt-5.4-mini
//   สรุปสั้น, แยกคีย์เวิร์ด, จัดรูป JSON,
//   แคปชั่นสั้น, ตรวจคำผิด, งานซ้ำจำนวนมาก
// ═══════════════════════════════════════════
export const MODEL_FAST_CHEAP      = 'gpt-5.4-mini';  // ลูกมือ — งานเร็ว/เยอะ
export const MODEL_KEYWORD_EXTRACT = 'gpt-5.4-mini';  // สกัดคีย์เวิร์ด
export const MODEL_JSON_FORMATTER  = 'gpt-5.4-mini';  // จัดรูปแบบ JSON
export const MODEL_CAPTION_DRAFT   = 'gpt-5.4-mini';  // แคปชั่นสั้น / สรุป
export const MODEL_SPELL_CHECK     = 'gpt-5.4-mini';  // ตรวจคำผิดเบื้องต้น

// ═══════════════════════════════════════════
// ★ Aliases — backward compatibility
// ═══════════════════════════════════════════
export const MODEL_PRIMARY = MODEL_MAIN_REASONING;    // = gpt-5.5
export const MODEL_FAST    = MODEL_FAST_CHEAP;         // = gpt-5.4-mini
export const MODEL_VISION  = 'gpt-5.5';                // ★ อัปเกรด 10 มิ.ย. 2026 (เดิม gpt-4o legacy) — OCR ไทยแม่นขึ้น
export const MODEL_HEAVY_FALLBACK = 'gpt-4o';          // fallback เมื่อ MODEL_PRIMARY ล้มเหลว/timeout

// ★ COST LOOKUP (per 1M tokens, USD)
// ★ 16 ก.ค. 69 (B1 audit fix): แก้ราคาให้ตรงหน้าราคาจริง — ค่าเดิม gpt-5.5 3/12 ต่ำกว่าจริง
//   ทำให้ /cost รายงานต่ำกว่าบิลทั้งระบบ (โมเดลที่ถูกเรียกหนักสุด)
export const MODEL_COSTS = {
  'gpt-5.5':       { input: 5.0, output: 30.0 },
  'gpt-5.4-mini':  { input: 0.75, output: 4.50 },
  // GPT-5.6 (GA 9 ก.ค. 69) — เตรียมไว้สำหรับแผนอัปเกรด B6
  'gpt-5.6-sol':   { input: 5.0, output: 30.0 },
  'gpt-5.6-terra': { input: 2.5, output: 15.0 },
  'gpt-5.6-luna':  { input: 1.0, output: 6.0 },
  // Anthropic (ตัวเขียนจริง + ตัว A/B)
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  'claude-sonnet-5': { input: 2.0, output: 10.0 }, // โปรถึง 31 ส.ค. 69 → หลังนั้น 3/15
  // Legacy
  'gpt-4o':        { input: 2.5, output: 10.0 },  // ราคา grandfathered ปัจจุบัน (เดิมใส่ 5/15 ตกรุ่น)
  'gpt-4o-mini':   { input: 0.15, output: 0.60 },
};

/**
 * Helper: ดึง model name ตาม task type
 */
export function getModel(type = 'primary') {
  const map = {
    // กลุ่มหนัก
    primary: MODEL_MAIN_REASONING,
    reasoning: MODEL_MAIN_REASONING,
    news: MODEL_NEWS_ANALYSIS,
    cover: MODEL_COVER_JUDGE,
    qa: MODEL_FINAL_QA,
    write: MODEL_CONTENT_WRITE,
    vision: MODEL_VISION,
    // กลุ่มเร็ว
    fast: MODEL_FAST_CHEAP,
    keyword: MODEL_KEYWORD_EXTRACT,
    json: MODEL_JSON_FORMATTER,
    caption: MODEL_CAPTION_DRAFT,
    spell: MODEL_SPELL_CHECK,
  };
  return map[type] || MODEL_MAIN_REASONING;
}
