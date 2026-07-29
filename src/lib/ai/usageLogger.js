import { prisma } from '../db.js';
import { MODEL_COSTS } from './modelConfig.js';

// Pricing per 1,000,000 tokens (USD)
const PRICING = {
  ...MODEL_COSTS,
  // Legacy + other providers
  // ★ 16 ก.ค. 69 (B1): gpt-4o override เดิม 5/15 ตกรุ่น — ใช้ราคา grandfathered จริงจาก MODEL_COSTS แทน (ไม่ override ซ้ำ)
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20240620': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'gemini-3.5-flash': { input: 1.50, output: 9.00 },
  'gemini-3.1-pro': { input: 2.0, output: 12.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  // ★ 29 ก.ค. 69 (lane2 cost-audit A1 — COST-AUDIT.md ข้อ 2-A): ก่อนหน้านี้ไม่มีราคาโมเดลนี้เลย ทั้งที่เป็นตัวเขียนจริง
  //   ของท่อปกตั้งแต่ 26 ก.ค. (aiClient.js default) → /cost รายงาน $0 ทั้งท่อ ราคาชั่วคราว = ชั้นเดียวกับ claude-opus-4-8
  //   เดิม (grandfathered) รอยืนยันราคาทางการจาก Anthropic จริงภายหลัง
  'claude-opus-5': { input: 5.0, output: 25.0 },
  // ★ 29 ก.ค. 69 (lane2 cost-audit A1 — COST-AUDIT.md ข้อ 2-B): gemini-3.6-flash ไม่มีราคาประกาศในตารางไหนของ repo เลย
  //   (coverVisionModel.js ยกจาก 2.5→3.6 ทั้งสายปกตั้งแต่ 26 ก.ค.) ยืมราคาชั้น gemini-3.5-flash ไปก่อน (สมมติฐาน "ราคาใกล้ 3.5")
  //   ⚠️ ต้องยืนยันราคาจริงจาก Google — ถ้าต่างจากนี้ ตัวเลข /cost ของงานที่ใช้ Gemini จะคลาดเคลื่อนตาม
  'gemini-3.6-flash': { input: 1.50, output: 9.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-1.5-pro': { input: 3.5, output: 10.5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
};

export async function logApiUsage({ provider, model, inputTokens, outputTokens, feature = 'autoFlow', userId = null }) {
  try {
    let costUsd = 0;
    
    // Find matching price, defaulting to 0 if not found
    // ★ 16 ก.ค. 69 (B1 audit fix): ของเดิม Object.values(...).find((_, key) => ...) — พารามิเตอร์ตัวที่ 2
    //   ของ .find บน array คือ "index ตัวเลข" ไม่ใช่ key → partial-match ไม่เคยทำงาน โมเดลชื่อไม่ตรงเป๊ะถูกบันทึก $0
    //   แก้เป็นหา key จริง เรียงยาว→สั้น (กัน 'gpt-5.5' ไปจับ 'gpt-5' ผิดตัว) และใช้ startsWith ก่อน includes
    const _priceKey = Object.keys(PRICING)
      .sort((a, b) => b.length - a.length)
      .find(k => model === k || model.startsWith(k) || model.includes(k));
    const price = PRICING[model] || (_priceKey ? PRICING[_priceKey] : undefined);
    
    if (price) {
      costUsd = ((inputTokens / 1000000) * price.input) + ((outputTokens / 1000000) * price.output);
    }

    await prisma.apiUsageLog.create({
      data: {
        provider,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        feature,
        userId,
      }
    });
    
    console.log(`[API Usage] Saved: ${provider}/${model} - Cost: $${costUsd.toFixed(5)}`);
  } catch (error) {
    console.error('[API Usage] Failed to save usage log:', error.message);
  }
}
