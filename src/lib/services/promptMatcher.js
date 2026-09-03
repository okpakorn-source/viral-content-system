/**
 * Prompt Matcher — สมองจับคู่ข่าว↔พร้อมท์ ตัวกลางตัวเดียว (DNA v3.3 — 12 มิ.ย. 69)
 * ─────────────────────────────────────────────────────────────
 * เดิมลูปให้คะแนนถูกก๊อปไว้ 4 ที่ (analyze + getTopPrompts × แฝด Text) เริ่ม drift แล้ว
 * รวมเป็นที่เดียว ทุกเส้นทางเรียกฟังก์ชันนี้ — แก้สูตรครั้งเดียวมีผลทั้งระบบ
 *
 * ★ v3 alignment: ข่าวลบ (เศร้า/โกรธ/ช็อก) ถูก "ขยายแท็ก" เป็นอารมณ์ของมุมบวกที่จะเล่า
 *   (สอดคล้อง TONE_OVERRIDE ที่บังคับเล่าบวกท้ายน้ำอยู่แล้ว) → จับคู่พร้อมท์ v3 แท็กบวกได้เต็มเพดาน
 *   ใช้วิธี "เพิ่ม" ไม่ใช่ "แทน" — แท็กดิบเดิมยังอยู่ พฤติกรรมเก่าไม่เสีย
 */
import { EMOTION_CLUSTERS, CONFLICT_CLUSTERS, mapCategory, clusterMatch } from '@/lib/ai/semanticClusters';

// อารมณ์ดิบของข่าว → อารมณ์ของ "มุมบวกที่เพจจะเล่า" (ตามกฎ POSITIVE REFRAMING)
// ข่าวเศร้า→เล่ามุมเชิดชู, ข่าวโกรธ→เล่ามุมคนทำดี/ความถูกต้อง, ข่าวน่ากลัว→มุมเตือนภัย/คนช่วย
const POSITIVE_ANGLE_EMOTION_MAP = {
  เศร้า: ['ซึ้ง', 'ตื้นตัน', 'อบอุ่น'],
  หดหู่: ['ซึ้ง', 'ตื้นตัน'],
  สะเทือนใจ: ['ซึ้ง', 'ตื้นตัน'],
  สงสาร: ['เห็นใจ', 'ซึ้ง'],
  โกรธ: ['เห็นใจ', 'ชื่นชม'],
  เดือด: ['เห็นใจ', 'ชื่นชม'],
  แค้น: ['เห็นใจ', 'ชื่นชม'],
  กลัว: ['เห็นใจ', 'ชื่นชม'],
  หวาดกลัว: ['เห็นใจ', 'ชื่นชม'],
  ช็อก: ['เห็นใจ', 'ทึ่ง'],
};

/** ขยายแท็กอารมณ์ข่าวด้วยมุมบวก (เพิ่ม ไม่แทน — แท็กเดิมคงอยู่) */
export function expandEmotionsForPositiveTelling(tags = []) {
  const out = [...tags.map(t => String(t))];
  for (const t of tags) {
    const extras = POSITIVE_ANGLE_EMOTION_MAP[String(t).trim()];
    if (extras) for (const e of extras) { if (!out.includes(e)) out.push(e); }
  }
  return out;
}

/**
 * ให้คะแนนพร้อมท์ทุกตัวเทียบกับ DNA ข่าว — สูตรมาตรฐานเดียว
 * @param {object} newsAnalysis - {primaryCategory, secondaryCategories, emotionalTags, conflictTags, narrativeArchetype, viralHooks}
 * @param {Array} validPrompts - พร้อมท์จากหอสมุด (ต้องมี promptText แล้ว)
 * @param {object} opts - { mismatchPenalty: boolean } เส้นทาง getTopPrompts ใช้ -50 เมื่อหมวดไม่เข้าเครือ (พฤติกรรมเดิม)
 * @returns {Array<{index, score, dims}>} เรียงคะแนนมาก→น้อย
 */
export function scoreLibraryPrompts(newsAnalysis, validPrompts, { mismatchPenalty = false } = {}) {
  const nPrimary = newsAnalysis?.primaryCategory || '';
  const nSecondary = (newsAnalysis?.secondaryCategories || []).map(s => String(s));
  const nEmos = expandEmotionsForPositiveTelling(
    (newsAnalysis?.emotionalTags || newsAnalysis?.emotionalThemes || []).map(e => String(e))
  );
  const nConflicts = (newsAnalysis?.conflictTags || newsAnalysis?.conflictTypes || []).map(c => String(c));
  const nArchetype = newsAnalysis?.narrativeArchetype || '';
  const nHooks = (newsAnalysis?.viralHooks || []).map(h => String(h).toLowerCase());

  const scored = validPrompts.map((p, index) => {
    let score = 0;
    let dims = [];

    // 1. Category Match (max 30)
    const pCat = mapCategory(p.category || '');
    const mappedPrimary = mapCategory(nPrimary);
    if (pCat && mappedPrimary && pCat === mappedPrimary) {
      score += 30; dims.push('category');
    } else if (pCat && mappedPrimary) {
      const catCluster = clusterMatch(pCat, mappedPrimary, CONFLICT_CLUSTERS);
      if (catCluster === 'cluster') {
        score += 20; dims.push('category(cluster)');
      } else if (nSecondary.some(s => mapCategory(s) === pCat)) {
        score += 10; dims.push('category(secondary)');
      } else if (mismatchPenalty) {
        score -= 50; dims.push('category(mismatch)');
      }
    }

    // 2. Emotional Match (max 25) — cluster-based +12 ต่อแท็ก (แท็กข่าวถูกขยายมุมบวกแล้ว)
    let emoScore = 0;
    const pEmoTags = (p.emotionalTags && Array.isArray(p.emotionalTags) && p.emotionalTags.length > 0)
      ? p.emotionalTags
      : ((p.emotionalType || '') + ' ' + (p.tone || '')).split(/[\s,|/]+/).filter(w => w.length > 1);
    for (const nEmo of nEmos) {
      for (const pTag of pEmoTags) {
        const result = clusterMatch(pTag, nEmo, EMOTION_CLUSTERS);
        if (result) { emoScore += 12; break; }
      }
    }
    if (emoScore > 25) emoScore = 25;
    if (emoScore > 0) { score += emoScore; dims.push('emotional'); }

    // 3. Conflict Match (max 15) — +8 ต่อแท็ก
    let conflictScore = 0;
    const pConflictTags = (p.conflictTags && Array.isArray(p.conflictTags) && p.conflictTags.length > 0)
      ? p.conflictTags
      : ((p.promptName || '') + ' ' + (p.structure || '')).split(/[\s,|/]+/).filter(w => w.length > 2);
    for (const nConf of nConflicts) {
      for (const pTag of pConflictTags) {
        const result = clusterMatch(pTag, nConf, CONFLICT_CLUSTERS);
        if (result) { conflictScore += 8; break; }
      }
    }
    if (conflictScore > 15) conflictScore = 15;
    if (conflictScore > 0) { score += conflictScore; dims.push('conflict'); }

    // 4. Narrative Archetype Match (max 15)
    const pArchetype = (p.narrativeArchetype || p.structure || '').toLowerCase();
    let archScore = 0;
    if (pArchetype && nArchetype) {
      const nArchLower = nArchetype.toLowerCase();
      if (pArchetype === nArchLower || pArchetype.includes(nArchLower) || nArchLower.includes(pArchetype)) {
        archScore = 15;
        dims.push('archetype');
      } else {
        const archWords = nArchLower.split(/[\s,|/]+/).filter(w => w.length > 2);
        let archMatches = 0;
        archWords.forEach(w => { if (pArchetype.includes(w)) archMatches++; });
        archScore = Math.min(15, archMatches * 5);
        if (archScore > 0) dims.push('archetype(partial)');
      }
    }
    score += archScore;

    // 5. Viral Hook Match (max 5)
    const pHook = (p.hookStyle || '').toLowerCase();
    let hookScore = 0;
    if (pHook) {
      for (const h of nHooks) {
        if (h && (pHook.includes(h) || h.includes(pHook))) { hookScore += 5; break; }
        const hw = h.split(/[\s,|/]+/).filter(w => w.length > 2);
        if (hw.some(w => pHook.includes(w))) { hookScore += 3; break; }
      }
    }
    if (hookScore > 5) hookScore = 5;
    if (hookScore > 0) { score += hookScore; dims.push('hook'); }

    // 6. Historical Performance (max 10)
    let viral = Number(p.viralScore);
    if (isNaN(viral)) viral = 70;
    const successRate = Number(p.successRate);
    let histScore = viral * 0.05;
    if (!isNaN(successRate) && successRate > 0) histScore += successRate * 5;
    if (histScore > 10) histScore = 10;
    score += histScore;

    // 7. Cross-Dimensional Boost
    const uniqueDims = [...new Set(dims.map(d => d.replace(/\(.*\)/, '')))];
    if (score > 0) {
      const catScore = dims.some(d => d.startsWith('category') && !d.includes('mismatch')) ? (dims.includes('category') ? 30 : 20) : 0;
      if (catScore >= 20 && emoScore >= 12) {
        score += 10;
        dims.push('boost(cat+emo)');
      }
      if (uniqueDims.length >= 3) {
        score += 5;
        dims.push('boost(multi-dim)');
      }
    }

    return { index, score, dims: [...new Set(dims)] };
  });

  scored.sort((a, b) => b.score - a.score);

  // ★ 26 ก.ค. 69 (เจ้าของเคาะ): "วงคะแนนใกล้แชมป์" — กระจายการใช้การ์ดที่คะแนนสูสีแชมป์
  //   ปัญหาเดิม: สูตรคะแนน deterministic → ข่าวแนวเดิมได้ใบเดิมตลอด (ท็อป 10 กินการใช้งาน 94%)
  //   ข้อมูลจริง (จำลอง 201 ใบ × 202 ข่าว): 92.6% ของข่าว แชมป์ชนะอันดับ 2 แค่ 0-1 คะแนน = ของดีเท่ากันเป็นกลุ่ม
  //   เปิดด้วย env PROMPT_VARIETY_BAND (แนะนำ 5, เพดานแข็ง 8 — เกินนี้เกรดเริ่มหลุด) · ไม่ตั้ง/ค่าขยะ = ปิด = พฤติกรรมเดิมเป๊ะ
  //   พื้นกันตก: ไม่หยิบใบต่ำกว่าเกตตัดมุม (ANGLE_MIN_MATCH_SCORE, default 45) → ใบที่สุ่มได้เป็นใบเกรดดีเสมอ
  //   ย้อนกลับ: ถอด env = พฤติกรรมเดิม 100% (ไม่มีสถานะสะสม) · โค้ด: git revert คอมมิตนี้ / tag ก่อน-variety-band-2607
  const _band = Math.min(Number(process.env.PROMPT_VARIETY_BAND) || 0, 8);
  if (_band > 0 && scored.length > 1) {
    const _floor = Math.max(0, parseInt(process.env.ANGLE_MIN_MATCH_SCORE || '45', 10) || 45);
    if (scored[0].score >= _floor) {
      const _cut = Math.max(scored[0].score - _band, _floor);
      let _n = 1;
      while (_n < scored.length && scored[_n].score >= _cut) _n++;
      if (_n > 1) {
        const _pick = Math.floor(Math.random() * _n);
        if (_pick > 0) {
          const [_c] = scored.splice(_pick, 1);
          scored.unshift(_c);
        }
        console.log(`[PromptMatcher] 🎲 variety(pick ${_pick + 1}/${_n}, band=${_band}): ได้ score ${scored[0].score.toFixed(1)} (แชมป์เดิม ${(_pick > 0 ? scored[1] : scored[0]).score.toFixed(1)})`);
      }
    }
  }

  return scored;
}

/** ตัดเกรดมาตรฐานเดียว: ≥60+2มิติ = EXACT / ≥40 = CLOSE / ต่ำกว่า = BORROWED */
export function gradeMatch(score, dims = []) {
  const coreDims = dims.filter(d => !d.startsWith('boost'));
  if (score >= 60 && coreDims.length >= 2) return 'EXACT';
  if (score >= 40) return 'CLOSE';
  return 'BORROWED';
}

// ═══ 🧭 3 ก.ย. 69 (R234-ค) — ประตูบริบทตัวจำแนกหมวดหอสมุด (LIB_CLASSIFIER_CONTEXT) ═══
// ปัญหา: จุดเรียกตัวจำแนกหมวด V2 ใน summarizeServiceText.js (บล็อก VIRAL FEW-SHOT ~1752) ส่งแค่
//   category/emotionalTags/archetype → ขั้น 2 "รูปเรื่อง" ของ pickLibraryCategoryV2 (viralFewshot.js)
//   ไม่เคยเห็น conflictTags/humanAngles ที่ท่อวิเคราะห์ (newsAnalysis/actualBreakdown) มีอยู่แล้ว
//   → ข่าวที่ป้ายหมวดหลักไม่แมปตาราง ตกไปเดาจากคีย์เวิร์ดในป้าย/archetype ล้วน (จำแนกผิด ~1/3)
//   เคสสนามจริง (news-r233-run/result-P2fix-บันเทิง-05233.json): ป้าย 'ความรักและชีวิตคู่ในช่วงเจ็บป่วย'
//   ตกชั้น 'ข่าวเศร้า' เพราะคำ 'สูญเสีย' ในแท็กอารมณ์ ทั้งที่ conflictTags/humanAngles ('...อนาคตครอบครัว',
//   'ความห่วงลูกที่ยังเล็กเมื่อครอบครัวเผชิญ...') ชี้ชัดว่าเป็นเรื่องครอบครัวประคองกัน → ที่ถูกคือ 'ดราม่าครอบครัว'
// สูตรถ่วงน้ำหนัก (deterministic ทดสอบซ้ำได้ — โค้ดสูตรอยู่ pickLibraryCategoryV2 ขั้น 2 ใน viralFewshot.js
//   ตัวนี้เป็น "ประตูส่งของ" เท่านั้น ไม่แตะสูตร):
//   shapes = [archetype, ...humanAngles, ...conflictTags] · คะแนนชั้น = Σ ความยาววลี LIB_V2_SHAPES ที่พบใน shapes (วลีละครั้ง)
//   ชั้นคะแนนรวมสูงสุดชนะ · เสมอ = ลำดับตาราง · ป้ายหมวดหลัก (ขั้น 1) ยังชนะบริบทเสมอ — บริบทมีผลเฉพาะข่าวที่ป้ายไม่แมป
//   และบริบทชนะขั้น 3 (อารมณ์เศร้า) — ไม่มีสุ่ม ไม่มีสถานะสะสม อินพุตเดิมได้ผลเดิม 100%
// การใช้: spread ผลลัพธ์เข้าอาร์กิวเมนต์ getViralFewshotBlock — สวิตช์ปิด/ไม่มีข้อมูล = {} = อาร์กิวเมนต์เดิมทุกไบต์
// 🔴 ถอยกลับ: LIB_CLASSIFIER_CONTEXT=0 (รับเฉพาะ '0' ตรงตัว · ไม่ตั้ง = เปิด — แผนเดียวกับ LIB_CLASSIFIER_V2)
export const libClassifierContextOn = () => process.env.LIB_CLASSIFIER_CONTEXT !== '0';

// ล้างชนิดแนวเดียวกับ _v2List ฝั่งตัวจำแนก (บทเรียน TypeError 16 ส.ค. 69): รับ อาเรย์/สตริงเดี่ยว/ตัวเลข/null ไม่โยน
const _ctxList = (v) => (Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v])
  .filter((x) => typeof x === 'string' || typeof x === 'number')
  .map((x) => String(x).trim()).filter(Boolean);

/**
 * สร้างช่องบริบทสำหรับ spread เข้าอาร์กิวเมนต์ตัวจำแนกหมวด V2 (getViralFewshotBlock → resolveLibraryCategory)
 * @param {object} context - { conflictTags, humanAngles, emotionalTags? } จาก DNA ที่ท่อวิเคราะห์ได้แล้ว
 * @returns {object} {} เมื่อสวิตช์ปิด/ไม่มีข้อมูล · ไม่งั้นคืนเฉพาะช่องที่มีค่า (ไม่ปล่อยอาเรย์ว่างไปทับ default ปลายทาง)
 *   emotionalTags เป็นช่องเสริมตามสเปก — จุดเรียก summarizeServiceText "ไม่ส่ง" ช่องนี้ เพราะอาร์กิวเมนต์เดิม
 *   ส่งอยู่แล้วผ่านโซ่ fallback (emotionalTags→emotionalThemes→breakdown) — ส่งซ้ำทางนี้จะไปทับโซ่เดิม
 */
export function buildLibClassifierContext(context = {}) {
  if (!libClassifierContextOn()) return {};
  const src = context && typeof context === 'object' ? context : {};
  const out = {};
  const conflictTags = _ctxList(src.conflictTags);
  const humanAngles = _ctxList(src.humanAngles);
  const emotionalTags = _ctxList(src.emotionalTags);
  if (conflictTags.length) out.conflictTags = conflictTags;
  if (humanAngles.length) out.humanAngles = humanAngles;
  if (emotionalTags.length) out.emotionalTags = emotionalTags;
  return out;
}
