/**
 * ============================================================
 * 🗝️ Preset → คีย์ค้นกว้าง (Plan A, 20 ก.ค. 69) — ให้ปุ่ม "แนวข่าว" (preset) ขับการค้นเองได้
 * ============================================================
 * โจทย์ผู้ใช้: เลือกแนวข่าวแล้วต้องค้นได้เลย ไม่ต้องติ๊กคลัสเตอร์ครูที่เจาะจงเกิน (เจอ ·1)
 * ทางแก้ (Plan A): ดึง "คีย์กว้าง" จากคลังที่มีอยู่แล้ว (keywordBank.js) = วงการ(SUBJECTS) × แอ็กชัน(THEME_ACTIONS)
 *   → คีย์แบบ "ดารา เปิดใจ" / "นักร้อง บริจาค" / "หมอ รักษาฟรี" — กว้างพอหาเจอเยอะ + ติดหมวดในตัว
 *
 * 🔴 pure + deterministic (หมุนชุดด้วย runSeed ไม่พึ่งเวลาจริง/ค่าสุ่ม) → node --test เรียกตรงได้
 * 🔴 ไม่มี AI · ไม่แตะภาพ · import ได้เฉพาะ keywordBank.js + dnaContract.js (แพตเทิร์น deskV2)
 * 🔴 หมวดของ preset ตรงกับ PRESET_ANGLE_BIAS ใน researchQueryPlanner.js (แหล่งความจริงเดียว)
 */

import { THEME_ACTIONS, SUBJECTS, FIELD_ANGLES } from '../newsDesk/keywordBank.js';
import { sanitizeText } from './dnaContract.js';

// preset id → หมวด THEME_ACTIONS ที่เกี่ยว (ตรงกับ PRESET_ANGLE_BIAS) · economy=ทดลอง ยังไม่แมป
export const PRESET_CATEGORIES = {
  interview: ['สัมภาษณ์/บทสนทนาดี', 'คนดัง/ดราม่าบันเทิง'],
  kindness: ['น้ำใจ/ช่วยเหลือ', 'กตัญญู/ครอบครัวอบอุ่น'],
  society: ['สู้ชีวิต', 'คนดังทำดี/ติดดิน'],
  lifestyle: ['บันเทิงกระแส', 'ความรัก/แต่งงาน'],
};

/** หมวดของ preset (คืน array ว่างถ้าไม่รู้จัก/economy) */
export function presetCategories(presetId) {
  const key = sanitizeText(presetId, 40).toLowerCase();
  const cats = PRESET_CATEGORIES[key];
  return Array.isArray(cats) ? cats.slice() : [];
}

/** FNV-1a 32-bit — hash → uint (deterministic ล้วน, ทำ offset หมุนชุด) */
function hashSeed(input) {
  const s = String(input ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * buildPresetQueries — คีย์ค้นกว้างของ preset นั้น (วงการ × แอ็กชัน + FIELD_ANGLES หมวดตรง)
 * @param {string} presetId เช่น 'kindness'
 * @param {{count?:number, runSeed?:string}} [opts] count=เพดานคีย์ (default 24) · runSeed=หมุนชุดข้ามรอบ
 * @returns {Array<{query:string, category:string, lane:'broad'}>} unique + sanitized (≤70) ; preset ไม่รู้จัก → []
 */
export function buildPresetQueries(presetId, { count = 24, runSeed = '' } = {}) {
  const cats = presetCategories(presetId);
  if (!cats.length) return [];
  const seed = hashSeed(runSeed || presetId);

  const seen = new Set();
  const out = [];
  const push = (query, category) => {
    const q = sanitizeText(query, 70);
    if (!q) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ query: q, category, lane: 'broad' });
  };

  // (1) วงการ × แอ็กชัน — หมุน subject ตาม seed ให้ได้ชุดต่างกันข้ามรอบ (action ครบทุกตัวของหมวด)
  cats.forEach((cat, ci) => {
    const actions = Array.isArray(THEME_ACTIONS[cat]) ? THEME_ACTIONS[cat] : [];
    for (let i = 0; i < actions.length; i++) {
      const subj = SUBJECTS[(seed + ci * 7 + i) % SUBJECTS.length];
      push(`${subj} ${actions[i]}`, cat);
    }
  });

  // (2) วงการเฉพาะทาง (พระ/หมอ/ครู/กู้ภัย/เกษตรกร ฯลฯ) เฉพาะหมวดที่ตรง preset
  for (const [subj, angles, cat] of Array.isArray(FIELD_ANGLES) ? FIELD_ANGLES : []) {
    if (!cats.includes(cat)) continue;
    for (const a of Array.isArray(angles) ? angles : []) push(`${subj} ${a}`, cat);
  }

  // หมุนลำดับด้วย seed แล้วตัด count → แต่ละรอบล่าได้ชุดคีย์ต่างมุมกัน
  const offset = out.length ? seed % out.length : 0;
  const rotated = offset ? [...out.slice(offset), ...out.slice(0, offset)] : out;
  return rotated.slice(0, Math.max(1, count));
}
