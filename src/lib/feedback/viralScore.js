// ============================================================
// 🎯 src/lib/feedback/viralScore.js — คะแนน "โอกาสปัง" ต่อเวอร์ชันข่าว (2 ก.ย. 69)
// ------------------------------------------------------------
// ตัวทำนายจากโพสต์จริง 1,927 ใบ (เทรนด้วย scripts/train-viral-score.mjs → data/viral-score-model.json)
// scoreVersion(text, model?) → { score 0–100 (เปอร์เซ็นไทล์เทียบเพจ), predictedReactions, bandLabel สูง/กลาง/ต่ำ,
//   topDrivers 3 ตัวที่ดัน/ฉุดแรงสุด (ภาษาไทย), warnings จากกติกาที่พิสูจน์แล้ว }
// โหลดโมเดลจากไฟล์ครั้งเดียว (แคชในหน่วยความจำ) · fail-safe: ไม่มีไฟล์/ไฟล์เพี้ยน → null ไม่พัง ไม่โยน
// ⛔ ยังไม่ต่อสายเข้าท่อข่าว (autoFlowServiceText เป็นของทีมอื่น) — เป็นโมดูล + API เท่านั้น
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { extractFeatures, featureVector, LENGTH_BANDS, OPENING_TYPES, OPENING_LABELS_TH } from './viralFeatures.js';

export const MODEL_FILE = 'viral-score-model.json';

export const FEATURE_LABELS_TH = {
  words: 'ความยาว (จำนวนคำ)',
  paragraphs: 'จำนวนย่อหน้า',
  threeParagraphs: 'โครง 3 ย่อหน้าเป๊ะ',
  firstParaWords: 'ความยาวย่อหน้าแรก',
  quoteCount: 'จำนวนคำพูดจริงที่ยกมา',
  quotedNames: 'ชื่อคนในเครื่องหมายคำพูด',
  hasDirectQuoteToReceiver: 'คำพูดตรงจากผู้ให้ถึงผู้รับ',
  numberCount: 'จำนวนตัวเลขในเรื่อง',
  hardshipNumber: 'ตัวเลขราคาความลำบาก/น้ำใจ (บาท/กิโล/วัน/ปี)',
  moneyNumber: 'ตัวเลขจำนวนเงิน',
  ageNumber: 'ตัวเลขอายุ',
  giftAmount: 'ระบุจำนวนเงินที่มอบให้',
  giveWords: 'คำแสดงการให้/ช่วยเหลือ',
  kinshipNameInFirst30: 'คำเครือญาติ+ชื่อ ใน 30 ตัวอักษรแรก',
  kinshipNameInFirst120: 'คำเครือญาติ+ชื่อ ในประโยคเปิด',
  kinshipWordCount: 'จำนวนคำเครือญาติ (พี่/น้อง/ยาย/ลุง…)',
  orgGiverInFirst60: 'ผู้ให้เป็นองค์กรในประโยคแรก',
  orgGiverInFirstPara: 'องค์กรโผล่ในย่อหน้าแรก',
  orgWordCount: 'จำนวนคำองค์กร/หน่วยงาน',
  titleHonorificFirst: 'ขึ้นต้นด้วย นาย/นางสาว+ชื่อจริง',
  open_contrast: 'เปิดด้วยความต่าง (แม้…แต่)',
  open_name_action: 'เปิดด้วยชื่อคน+การกระทำ',
  open_quote: 'เปิดด้วยคำพูดจริง',
  open_number: 'เปิดด้วยตัวเลข',
  open_praise: 'เปิดด้วยคำชื่นชม/ไม่แปลกใจ',
  open_question: 'เปิดด้วยคำถาม',
  open_other: 'เปิดแบบอื่นๆ',
  abstractNounDensity: 'ความหนาแน่นคำนามธรรม (ความ…)',
  closingEchoesOpening: 'ประโยคปิดสะท้อนประโยคเปิด',
  genericClosing: 'ปิดด้วยคำคมทั่วไป/อวยพรลอยๆ',
  stakeWords: 'คำเดิมพัน (ตาย/จน/ป่วย/หนี้/สูญเสีย)',
  hasStake: 'มีเดิมพันในเรื่อง',
  secondTurn: 'หักอารมณ์ครั้งที่ 2 ในย่อหน้าท้าย',
  closingTearsHug: 'ภาพน้ำตา/กอดตอนปิด',
  bodyImageWords: 'ภาพรูปธรรม (มือ/น้ำตา/เดิน/วิ่ง…)',
  narratorVerdict: 'คนเล่าฟันธง (ไม่แปลกใจ/นี่สิ…ตัวจริง)',
  friendlyTone: 'น้ำเสียงเล่าให้เพื่อนฟัง (นึง/หรอก/เด้อ)',
  comfortToReceiver: 'ประโยคปลอบถึงผู้รับ (ไม่ต้องห่วง)',
  causeOpening2: 'ย่อหน้า 2 ขึ้นด้วย เพราะ/แม้/ย้อนกลับไป',
  dashOrPoemFormat: 'จัดรูปแบบขีดกลาง/ตัดบรรทัดเป็นกลอน',
  band_lt146: 'ความยาวต่ำกว่า 146 คำ',
  band_146_169: 'ความยาว 146–169 คำ',
  band_170_199: 'ความยาว 170–199 คำ',
  band_200_229: 'ความยาว 200–229 คำ',
  band_230_269: 'ความยาว 230–269 คำ',
  band_ge270: 'ความยาว 270 คำขึ้นไป',
  hashtagCount: 'แฮชแท็ก',
  emojiCount: 'อีโมจิ',
  exclamationCount: 'เครื่องหมายตกใจ',
  questionCount: 'เครื่องหมายคำถาม',
  ellipsisCount: 'จุดไข่ปลา (..)',
  royalWords: 'คำเกี่ยวกับพระราชวงศ์',
  celebWords: 'คำเกี่ยวกับดารา/คนบันเทิง',
};

export const BAND_LABELS = { high: 'สูง', mid: 'กลาง', low: 'ต่ำ' };
const DEFAULT_BANDS = { high: 70, mid: 35 };

// ---------- โหลดโมเดล (ครั้งเดียวต่อ path · fail-safe) ----------
const _cache = new Map(); // path → model | null

function candidatePaths(modelPath) {
  if (modelPath) return [modelPath];
  const list = [path.join(process.cwd(), 'data', MODEL_FILE)];
  try { list.push(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..', 'data', MODEL_FILE)); } catch { /* bundler อาจไม่มี import.meta.url */ }
  return list;
}

export function isValidModel(model) {
  if (!model || typeof model !== 'object') return false;
  if (!Array.isArray(model.features) || !model.features.length) return false;
  if (!Array.isArray(model.weights) || model.weights.length !== model.features.length) return false;
  if (!Number.isFinite(Number(model.bias))) return false;
  const sc = model.scale;
  if (!sc || !Array.isArray(sc.mean) || !Array.isArray(sc.std)) return false;
  if (sc.mean.length !== model.features.length || sc.std.length !== model.features.length) return false;
  if (!model.calibration || !Array.isArray(model.calibration.quantiles) || model.calibration.quantiles.length < 2) return false;
  return true;
}

/**
 * โหลดโมเดลจากไฟล์ (แคชครั้งเดียว) — ไม่มีไฟล์/อ่านไม่ออก/รูปทรงผิด → null (ไม่โยน)
 * @param {string} [modelPath] path เต็ม (ไม่ส่ง = data/viral-score-model.json ของโปรเจกต์)
 */
export function loadModel(modelPath) {
  const key = modelPath || '__default__';
  if (_cache.has(key)) return _cache.get(key);
  let model = null;
  for (const p of candidatePaths(modelPath)) {
    try {
      if (!fs.existsSync(p)) continue;
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (isValidModel(parsed)) { model = parsed; break; }
    } catch { /* ไฟล์เพี้ยน → ลอง path ถัดไป */ }
  }
  _cache.set(key, model);
  return model;
}

export function resetModelCache() { _cache.clear(); }

// ---------- คณิตศาสตร์ให้คะแนน ----------
/** เปอร์เซ็นไทล์ 0–100 ของค่าดิบ เทียบ quantiles 101 จุด (interpolate) */
export function percentileOf(value, quantiles) {
  const q = quantiles;
  const n = q.length;
  if (!n) return 50;
  if (value <= q[0]) return 0;
  if (value >= q[n - 1]) return 100;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (q[mid] <= value) lo = mid; else hi = mid;
  }
  const span = q[hi] - q[lo];
  const frac = span > 0 ? (value - q[lo]) / span : 0;
  return ((lo + frac) / (n - 1)) * 100;
}

export function bandOf(percentile, bands = DEFAULT_BANDS) {
  if (percentile >= (bands.high ?? DEFAULT_BANDS.high)) return BAND_LABELS.high;
  if (percentile >= (bands.mid ?? DEFAULT_BANDS.mid)) return BAND_LABELS.mid;
  return BAND_LABELS.low;
}

/** คำนวณคะแนนดิบ + ผลของแต่ละฟีเจอร์ (log10 เทียบโพสต์เฉลี่ยของเพจ) */
export function computeRaw(features, model) {
  const x = featureVector(features, model.features);
  const contributions = [];
  let raw = Number(model.bias);
  for (let j = 0; j < x.length; j++) {
    const std = Number(model.scale.std[j]) || 1;
    const z = (x[j] - Number(model.scale.mean[j])) / std;
    const effect = Number(model.weights[j]) * z;
    raw += effect;
    contributions.push({ feature: model.features[j], value: x[j], effect });
  }
  return { raw, contributions };
}

export function buildWarnings(features) {
  const w = [];
  const f = features || {};
  const words = Number(f.words) || 0;
  if (words > 229) w.push(`ยาว ${words} คำ เกินโซนปัง (146–229 คำ)`);
  else if (words > 0 && words < 146) w.push(`สั้น ${words} คำ ต่ำกว่าพื้น 146 คำ`);
  if (Number(f.paragraphs) && Number(f.paragraphs) !== 3) w.push(`${f.paragraphs} ย่อหน้า (โพสต์ปังเป็น 3 ย่อหน้าเป๊ะ)`);
  if (f.genericClosing) w.push('ปิดด้วยคำคมทั่วไป/อวยพรลอยๆ');
  if (f.dashOrPoemFormat) w.push('จัดรูปแบบขีดกลาง/ตัดบรรทัดเป็นกลอน');
  if (f.orgGiverInFirst60) w.push('ผู้ให้เป็นองค์กรในประโยคแรก (ผู้ให้ควรมีหน้ามีชื่อ)');
  if (f.titleHonorificFirst) w.push('ขึ้นต้นด้วย นาย/นางสาว+ชื่อจริง (ควรใช้คำเครือญาติ+ชื่อเล่น)');
  if (words > 0 && !f.hasStake) w.push('ไม่มีเดิมพัน (ความตาย/จน/โรค/หนี้/สูญเสีย)');
  if (words > 0 && !f.kinshipNameInFirst120) w.push('ประโยคเปิดไม่มีคำเครือญาติ+ชื่อ (พี่/น้อง/ยาย/ลุง+ชื่อ)');
  if (words > 0 && Number(f.hardshipNumber) === 0) w.push('ไม่มีตัวเลขราคาความลำบาก/น้ำใจ (บาท/กิโล/วัน/ปี)');
  if (Number(f.abstractNounDensity) >= 3) w.push(`คำนามธรรม (ความ…) หนาแน่น ${Number(f.abstractNounDensity).toFixed(1)} ต่อ 100 คำ`);
  if (words > 0 && Number(f.closingEchoesOpening) < 0.1) w.push('ประโยคปิดไม่สะท้อนภาพ/ตัวเลขจากประโยคเปิด');
  return w;
}

function labelOf(feature) {
  return FEATURE_LABELS_TH[feature] || feature;
}

/**
 * ให้คะแนน "โอกาสปัง" ของข้อความ 1 เวอร์ชัน
 * @param {string} text
 * @param {object|{modelPath?:string}} [modelOrOpts] โมเดลที่โหลดแล้ว หรือ { modelPath } · ไม่ส่ง = โมเดลจากไฟล์
 * @returns {null|{score:number, predictedReactions:number, bandLabel:string, topDrivers:Array, warnings:string[], features:object, raw:number, openingType:string, lengthBand:string}}
 */
export function scoreVersion(text, modelOrOpts) {
  let model = null;
  if (modelOrOpts && typeof modelOrOpts === 'object' && Array.isArray(modelOrOpts.features)) {
    model = isValidModel(modelOrOpts) ? modelOrOpts : null;
  } else {
    const modelPath = modelOrOpts && typeof modelOrOpts === 'object' ? modelOrOpts.modelPath : undefined;
    model = loadModel(modelPath);
  }
  if (!model) return null;
  const features = extractFeatures(text);
  const { raw, contributions } = computeRaw(features, model);
  const percentile = percentileOf(raw, model.calibration.quantiles);
  const score = Math.round(Math.max(0, Math.min(100, percentile)));
  const predictedReactions = Math.max(0, Math.round(Math.pow(10, raw) - 1));
  const sorted = [...contributions].filter(c => Math.abs(c.effect) > 1e-6).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  const topDrivers = sorted.slice(0, 3).map(c => ({
    feature: c.feature,
    label: labelOf(c.feature),
    value: c.value,
    effect: +c.effect.toFixed(4),
    factor: +Math.pow(10, c.effect).toFixed(3),
    direction: c.effect >= 0 ? 'ดัน' : 'ฉุด',
    text: `${c.effect >= 0 ? 'ดัน' : 'ฉุด'} ${labelOf(c.feature)} (×${Math.pow(10, c.effect).toFixed(2)})`,
  }));
  const pushers = sorted.filter(c => c.effect > 0).slice(0, 3).map(c => ({ feature: c.feature, label: labelOf(c.feature), effect: +c.effect.toFixed(4) }));
  const draggers = sorted.filter(c => c.effect < 0).slice(0, 3).map(c => ({ feature: c.feature, label: labelOf(c.feature), effect: +c.effect.toFixed(4) }));
  return {
    score,
    predictedReactions,
    bandLabel: bandOf(percentile, model.bands),
    topDrivers,
    pushers,
    draggers,
    warnings: buildWarnings(features),
    raw: +raw.toFixed(4),
    openingType: OPENING_TYPES[features.openingTypeIndex] || 'other',
    openingTypeLabel: OPENING_LABELS_TH[OPENING_TYPES[features.openingTypeIndex] || 'other'],
    lengthBand: (LENGTH_BANDS[features.lengthBand] || LENGTH_BANDS[0]).label,
    features,
    modelTrainedAt: model.trainedAt || null,
  };
}

/** ให้คะแนนหลายเวอร์ชัน แล้วเรียงสูง→ต่ำ (คืน [] ถ้าไม่มีโมเดล) */
export function scoreVersions(texts, modelOrOpts) {
  if (!Array.isArray(texts)) return [];
  const out = [];
  texts.forEach((t, i) => {
    const r = scoreVersion(t, modelOrOpts);
    if (r) out.push({ index: i, ...r });
  });
  return out.sort((a, b) => b.raw - a.raw);
}

/** ตัวเลขผลเทรนของโมเดล (สำหรับ GET) — ไม่มีโมเดล → null */
export function getModelMetrics(modelPath) {
  const model = loadModel(modelPath);
  if (!model) return null;
  return {
    version: model.version ?? null,
    trainedAt: model.trainedAt || null,
    source: model.source || null,
    target: model.target || null,
    seed: model.seed ?? null,
    nAll: model.nAll ?? null,
    nTrain: model.nTrain ?? null,
    nValid: model.nValid ?? null,
    lambda: model.lambda ?? null,
    featureCount: model.features.length,
    bands: model.bands || DEFAULT_BANDS,
    metrics: model.metrics || null,
  };
}
