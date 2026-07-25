/**
 * ========================================
 * MODEL CONFIG — Centralized AI Model Names
 * ========================================
 * เปลี่ยน model ที่นี่จุดเดียว → ทุกที่ในระบบเปลี่ยนตาม
 *
 * Last updated: 2026-07-25 (ยกชุด GPT → ตระกูล 5.6 ทั้งตัวหลักและตัวสำรอง — เจ้าของสั่ง)
 *
 * ★ STRATEGY (25 ก.ค. 69):
 *   gpt-5.6-terra = สมองหลัก งานหนัก — เร็ว (3.2s เทสจริง) ราคาครึ่งเดียวของ sol
 *   gpt-5.6-sol   = ตัวแรงสุด — ตัดสิน/ตรวจคุณภาพ + เป็นไม้สองของงานหนัก
 *   gpt-5.6-luna  = ลูกมือ งานเร็ว/เยอะ — ถูกสุดในตระกูล 5.6
 *   (ตระกูล 5.4/5.5 และ gpt-4o = ตกรุ่น เหลือไว้แค่ในตารางราคาเพื่ออ่าน log เก่า)
 *
 * เทสจริง 25 ก.ค. 69 (ยิง API จริงทุกตัว): terra 3.2s · luna 3.1s · sol 4.9s
 *   รับ max_completion_tokens 24000 ได้ทุกตัว (ไม่ติดเพดาน 16384 แบบ gpt-4o) · รับภาพ (vision) ได้ทุกตัว
 */

// ═══════════════════════════════════════════
// ★ กลุ่ม 1: งานหนัก — ใช้ gpt-5.6-terra
//   วิเคราะห์ข่าว, วาง Workflow, ตัดสินใจ, เหตุผลหลายชั้น
// ═══════════════════════════════════════════
export const MODEL_MAIN_REASONING  = 'gpt-5.6-terra'; // สมองหลัก — reasoning หลายชั้น (เดิม gpt-5.5)
export const MODEL_NEWS_ANALYSIS   = 'gpt-5.6-terra'; // วิเคราะห์ข่าว (clip-insight/news-hunt/topic-hunt + ตัวสำรองขั้นเขียน)
// ★ 16 ก.ค. 69 (B6.2 — เจ้าของเคาะ): breakdown สายข่าว text → terra ตามผล A/B
//   (เคสจริง: terra 42.1s vs gpt-5.5 125.4s, มุมข่าว 12=12 คุณภาพเท่ากัน, ราคาครึ่งเดียว $2.5/$15)
export const MODEL_BREAKDOWN       = 'gpt-5.6-terra';
export const MODEL_COVER_JUDGE     = 'gpt-5.6-sol';   // ตัดสิน/ให้คะแนนปก (Curator + Judge) — ตัวแรงสุด ราคาเท่า gpt-5.5 เดิม
export const MODEL_FINAL_QA        = 'gpt-5.6-sol';   // ตรวจคุณภาพขั้นสุดท้าย
export const MODEL_CONTENT_WRITE   = 'gpt-5.6-sol';   // เขียนเนื้อหาข่าว (ฝั่ง GPT — ตัวเขียนหลักจริงคือ Claude)

// ═══════════════════════════════════════════
// ★ กลุ่ม 2: งานเร็ว/ประหยัด — ใช้ gpt-5.6-luna
//   สรุปสั้น, แยกคีย์เวิร์ด, จัดรูป JSON, แคปชั่นสั้น, ตรวจคำผิด, งานซ้ำจำนวนมาก
// ═══════════════════════════════════════════
export const MODEL_FAST_CHEAP      = 'gpt-5.6-luna';  // ลูกมือ — งานเร็ว/เยอะ (เดิม gpt-5.4-mini)
export const MODEL_KEYWORD_EXTRACT = 'gpt-5.6-luna';  // สกัดคีย์เวิร์ด
export const MODEL_JSON_FORMATTER  = 'gpt-5.6-luna';  // จัดรูปแบบ JSON
export const MODEL_CAPTION_DRAFT   = 'gpt-5.6-luna';  // แคปชั่นสั้น / สรุป
export const MODEL_SPELL_CHECK     = 'gpt-5.6-luna';  // ตรวจคำผิดเบื้องต้น

// ═══════════════════════════════════════════
// ★ Aliases — backward compatibility
// ═══════════════════════════════════════════
export const MODEL_PRIMARY = MODEL_MAIN_REASONING;    // = gpt-5.6-terra
export const MODEL_FAST    = MODEL_FAST_CHEAP;         // = gpt-5.6-luna
export const MODEL_VISION  = 'gpt-5.6-terra';          // ★ 25 ก.ค. 69: OCR/อ่านภาพ — เทสจริงรับภาพได้ เร็วกว่า gpt-5.5 เดิม
export const MODEL_HEAVY_FALLBACK = 'gpt-5.6-sol';     // fallback เมื่อ MODEL_PRIMARY ล้มเหลว/timeout (เดิม gpt-4o)

/**
 * ★ 25 ก.ค. 69: แผนที่ตัวสำรอง — ใครล้ม ให้ลองตัวไหนต่อ
 *   หลักการ: งานหนักล้ม → ขยับขึ้นตัวแรงกว่า (sol) · งานเบาล้ม → ขยับขึ้น terra
 *   เดิม hardcode gpt-4o ไว้ใน openai.js ซึ่ง (ก) ตกรุ่น (ข) เพดาน token 16384 ทำให้ไม้สองถูกปฏิเสธทุกครั้ง
 */
export const MODEL_FALLBACKS = {
  'gpt-5.6-terra': ['gpt-5.6-sol'],
  'gpt-5.6-sol':   ['gpt-5.6-terra'],
  'gpt-5.6-luna':  ['gpt-5.6-terra'],
};

/** เพดาน max_completion_tokens ต่อโมเดล — กันส่งค่าเกินแล้วโดนปฏิเสธทั้งคำขอ (บทเรียน gpt-4o 16384) */
export const MODEL_MAX_OUTPUT = {
  'gpt-5.6-terra': 128000,
  'gpt-5.6-sol':   128000,
  'gpt-5.6-luna':  128000,
  'gpt-4o':        16384,
  'gpt-4o-mini':   16384,
};

/** จำกัด maxTokens ให้ไม่เกินเพดานของโมเดลนั้น (ไม่รู้จัก = ปล่อยผ่าน) */
export function clampMaxTokens(model, maxTokens) {
  const cap = MODEL_MAX_OUTPUT[model];
  if (!cap || !maxTokens) return maxTokens;
  return Math.min(maxTokens, cap);
}

// ★ COST LOOKUP (per 1M tokens, USD)
export const MODEL_COSTS = {
  // GPT-5.6 (ใช้จริงตั้งแต่ 25 ก.ค. 69)
  'gpt-5.6-sol':   { input: 5.0, output: 30.0 },
  'gpt-5.6-terra': { input: 2.5, output: 15.0 },
  'gpt-5.6-luna':  { input: 1.0, output: 6.0 },
  // Anthropic (ตัวเขียนจริง + ตัว A/B)
  'claude-opus-5':   { input: 5.0, output: 25.0 }, // ★ 25 ก.ค. 69: ตัวเขียนหลักใหม่ — ราคาเท่า opus-4-8 เป๊ะ
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  'claude-sonnet-5': { input: 2.0, output: 10.0 }, // โปรถึง 31 ส.ค. 69 → หลังนั้น 3/15
  // Legacy — เหลือไว้อ่าน log เก่า (ไม่ได้ใช้เป็นตัวหลัก/ตัวสำรองแล้ว)
  'gpt-5.5':       { input: 5.0, output: 30.0 },
  'gpt-5.4-mini':  { input: 0.75, output: 4.50 },
  'gpt-4o':        { input: 2.5, output: 10.0 },
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
