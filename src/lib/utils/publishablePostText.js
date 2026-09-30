/** ข้อความเดียวที่พนักงานเห็น คัดลอก ส่งตรวจ และนำไปโพสต์จริง */
export function getPublishablePostText(version) {
  return String(version?.content || '').trim();
}

function makeTextLengthGateError(code, message, diagnostic = null) {
  const error = new Error(message);
  error.code = code;
  error.errorType = code;
  error.failedStep = 'auto_text_length_gate';
  if (diagnostic) error.lengthGate = diagnostic;
  return error;
}

/** นับ “คำภาษาไทยที่ใช้โพสต์จริง” ด้วย ICU word segmentation ไม่ประมาณจากจำนวนตัวอักษร/ช่องว่าง */
export function countPublishableThaiWords(version, { segmenterCtor } = {}) {
  const Segmenter = segmenterCtor === undefined ? globalThis.Intl?.Segmenter : segmenterCtor;
  if (typeof Segmenter !== 'function') {
    throw makeTextLengthGateError(
      'TEXT_NEWS_WORD_COUNTER_UNAVAILABLE',
      'ระบบนับคำภาษาไทยไม่พร้อม จึงหยุดก่อนเผยแพร่เพื่อไม่ปล่อยข่าวต่ำกว่าเกณฑ์',
    );
  }
  const segmenter = new Segmenter('th', { granularity: 'word' });
  let count = 0;
  for (const token of segmenter.segment(getPublishablePostText(version))) {
    if (token?.isWordLike) count += 1;
  }
  return count;
}

// ★ 30 ก.ย. 69 (แคมเปญแก้บั๊ก กลุ่ม 2 · เจ้าของอนุมัติ) — PL-14: "กักจริง" แทน "ทิ้งเงียบแต่บอกว่ากัก"
//   ปัญหาเดิม: ด่านท้าย (ความยาว) + ด่านข้อเท็จจริงทิ้งฉบับที่จ่ายค่าเขียนแล้วโดยไม่เก็บที่ไหนเลย ทั้งที่ข้อความบอก "ระบบกักผลไว้" /
//   "เนื้อข่าวถูกกักไว้ให้ตรวจ" → พนักงานไม่มีร่างให้ดู/กู้ ต้องส่งใหม่จ่ายซ้ำ · เลขฉบับของด่านความยาวนับหลังด่านข้อเท็จจริงคัดออก
//   (V2 เดิมถูกรายงานเป็น V1) · ไม่บอกหน่วยนับ ขณะที่ส่วนอื่นของท่อนับคำ/ตัวอักษร/ช่องว่างคนละแบบ
//   ใหม่ (ค่าเริ่มต้น): ฉบับที่ไม่ผ่าน → quarantine snapshot (เนื้อโพสต์เต็ม + provenance + จำนวนคำหน่วยเดียวกับด่านท้าย)
//   ผู้เรียก (autoFlowServiceText) เก็บลงเคส workflow ให้ดู/กู้ได้ (GET /api/workflow?id=…) · publishable:false เสมอ
//   ห้ามนำไปใส่ versions/summary · หน่วยนับเดียว = คำไทยแบบ ICU (countPublishableThaiWords) เทียบพื้น NEW_LENGTH_CFG.min (legacyLengthRules)
//   ถอย: PUBLISH_QUARANTINE=0 (หรือ legacy/off/false/no · ทนช่องว่าง/อัญประกาศ/ตัวพิมพ์) = ข้อความ/รูปผล/เลขฉบับเดิมทุกไบต์ + ไม่มี snapshot
export const PUBLISH_QUARANTINE_UNIT = 'thai_icu_word';

/** ตัวอ่านสวิตช์ PUBLISH_QUARANTINE ตัวเดียวของทั้งท่อ (ผู้เรียกห้ามอ่าน env เอง — ใช้ผลจากฟังก์ชันในไฟล์นี้) */
export function isPublishQuarantineOn(env) {
  const source = env ?? (typeof process !== 'undefined' ? process.env : undefined);
  const raw = String(source?.PUBLISH_QUARANTINE ?? '').trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
  return !['0', 'legacy', 'off', 'false', 'no'].includes(raw);
}

/**
 * ภาพถ่ายฉบับที่ถูกกัก (ด่านความยาว/ด่านข้อเท็จจริง) — เก็บให้พนักงานดู/กู้ได้ แต่ publishable:false เสมอ
 * จำนวนคำนับด้วยตัวนับเดียวกับด่านท้าย (ICU) · versionNumbers = เลขฉบับเดิมของงาน (ไม่ใช่ลำดับหลังคัด)
 * PUBLISH_QUARANTINE=0 หรือไม่มีฉบับ → null (ผู้เรียกใช้ null เป็นสัญญาณ "โหมดเดิม" ได้เลย)
 */
export function buildQuarantineSnapshot(versions, {
  stage,
  versionNumbers,
  wordCounts,
  minimumWords,
  segmenterCtor,
  env,
} = {}) {
  if (!isPublishQuarantineOn(env)) return null;
  const list = Array.isArray(versions) ? versions : [];
  if (list.length === 0) return null;
  const text = value => (typeof value === 'string' ? value : '');
  return {
    stage: String(stage || 'unknown'),
    publishable: false,
    unit: PUBLISH_QUARANTINE_UNIT,
    ...(Number.isInteger(minimumWords) ? { minimumWords } : {}),
    versions: list.map((version, index) => {
      const number = versionNumbers?.[index];
      let wordCount = Number.isInteger(wordCounts?.[index]) ? wordCounts[index] : null;
      if (wordCount === null) {
        try { wordCount = countPublishableThaiWords(version, { segmenterCtor }); } catch { wordCount = null; }
      }
      return {
        version: Number.isInteger(number) && number > 0 ? number : index + 1,
        wordCount,
        title: text(version?.title),
        content: getPublishablePostText(version),
        promptId: version?.promptId === null || version?.promptId === undefined ? '' : String(version.promptId),
        usedModel: text(version?.usedModel),
        _source: text(version?._source),
        _sourceLabel: text(version?._sourceLabel),
        style: text(version?.style),
      };
    }),
  };
}

/**
 * ด่านสุดท้ายของ TEXT news: กักทั้งฉบับที่สั้นกว่าพื้น โดยไม่แก้ข้อความ/เติมน้ำ/เรียก AI ซ้ำ
 * ฉบับที่ผ่านต้องคืน object เดิมเพื่อรักษา provenance ของ writer/card/teacher ทุก field
 * ★ 30 ก.ย. 69 (PL-14): ค่าเริ่มต้นคืน quarantine (snapshot ฉบับที่ถูกกัก) + unit · ศูนย์ฉบับผ่าน = error พก quarantine
 *   (non-enumerable — lengthGate บน error ยังไม่มีเนื้อข่าว) · versionNumbers = เลขฉบับเดิม (ใช้เฉพาะค่าเริ่มต้น)
 */
export function enforceTextNewsPublicationFloor(versions, {
  minimumWords,
  segmenterCtor,
  versionNumbers,
  env,
} = {}) {
  if (!Array.isArray(versions) || versions.length === 0
      || !Number.isInteger(minimumWords) || minimumWords < 1) {
    throw makeTextLengthGateError(
      'TEXT_NEWS_LENGTH_GATE_INVALID',
      'ข้อมูลด่านขั้นต่ำคำของข่าว TEXT ไม่ถูกต้อง',
    );
  }

  const quarantineOn = isPublishQuarantineOn(env);
  const originalNumbers = quarantineOn && Array.isArray(versionNumbers)
    && versionNumbers.length === versions.length
    && versionNumbers.every(number => Number.isInteger(number) && number > 0)
    ? versionNumbers
    : null;
  const evaluations = versions.map((version, index) => {
    const wordCount = countPublishableThaiWords(version, { segmenterCtor });
    return {
      version,
      versionNumber: originalNumbers ? originalNumbers[index] : index + 1,
      wordCount,
      passes: wordCount >= minimumWords,
    };
  });
  const passing = evaluations.filter(item => item.passes);
  const quarantined = evaluations.filter(item => !item.passes);
  const diagnostic = {
    status: quarantined.length > 0 ? 'partial' : 'passed',
    publishable: passing.length > 0,
    minimumWords,
    ...(quarantineOn ? { unit: PUBLISH_QUARANTINE_UNIT } : {}),
    checks: evaluations.map(({ versionNumber, wordCount, passes }) => ({
      version: versionNumber,
      wordCount,
      passes,
    })),
    quarantinedVersions: quarantined.map(item => item.versionNumber),
  };
  const quarantine = quarantined.length > 0
    ? buildQuarantineSnapshot(quarantined.map(item => item.version), {
      stage: 'length',
      versionNumbers: quarantined.map(item => item.versionNumber),
      wordCounts: quarantined.map(item => item.wordCount),
      minimumWords,
      env,
    })
    : null;

  if (passing.length === 0) {
    if (!quarantine) {
      throw makeTextLengthGateError(
        'TEXT_NEWS_LENGTH_REVIEW_REQUIRED',
        `ไม่มีฉบับที่ยาวถึงขั้นต่ำ ${minimumWords} คำ ระบบกักผลไว้โดยไม่เติมคำหรือเรียก AI ซ้ำ`,
        { ...diagnostic, status: 'length_review' },
      );
    }
    // ข้อความบอกเฉพาะสิ่งที่ด่านนี้ทำจริง — การเก็บร่างเป็นหน้าที่ผู้เรียก (ต่อท้ายผลการเก็บจริงเอง)
    const reviewError = makeTextLengthGateError(
      'TEXT_NEWS_LENGTH_REVIEW_REQUIRED',
      `ไม่มีฉบับที่ยาวถึงขั้นต่ำ ${minimumWords} คำ (นับคำไทยแบบ ICU: ${diagnostic.checks.map(check => `V${check.version} ${check.wordCount} คำ`).join(', ')}) — ไม่เผยแพร่ ไม่เติมคำ และไม่เรียก AI ซ้ำ`,
      { ...diagnostic, status: 'length_review' },
    );
    Object.defineProperty(reviewError, 'quarantine', {
      value: quarantine,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    throw reviewError;
  }

  return {
    ...diagnostic,
    passingVersions: passing.map(item => item.version),
    quarantinedVersions: quarantined.map(item => item.version),
    ...(quarantine ? { quarantine } : {}),
  };
}

export function countFinalVersionSources(versions) {
  const list = Array.isArray(versions) ? versions : [];
  return list.reduce((counts, version) => {
    if (version?._source === 'enhanced') counts.enhanced += 1;
    else counts.classic += 1;
    return counts;
  }, { classic: 0, enhanced: 0 });
}

export function resolveFinalUsedPreset(versions, presetByPromptId, fallbackPreset = null) {
  const promptId = versions?.[0]?.promptId;
  if (promptId === null || promptId === undefined || !String(promptId).trim()) return fallbackPreset;
  return presetByPromptId?.get?.(String(promptId).trim()) || fallbackPreset;
}

/** สร้างผลรวมจากฉบับที่ผ่านจริงเท่านั้น ไม่พาข้อความจากร่างที่ถูกกักติดออกมา
 *  ★ 30 ก.ย. 69 (PL-14): versions/summary ยังมาจากฉบับที่ผ่านเท่านั้น — ร่างที่ถูกกัก (ถ้ามี) อยู่แยกใน
 *  lengthGate.quarantine / factualGate.quarantine (publishable:false) ที่ผู้เรียกส่งมาในก้อนสรุปด่าน ไม่ปนกับฉบับโพสต์ */
export function buildPublishableAnalysisResult({
  primaryResult,
  usedPreset,
  usedModel,
  usedModels,
  versions,
  researchItems,
  qualityWarnings,
  factualGate,
  lengthGate,
}) {
  const base = primaryResult && typeof primaryResult === 'object' ? primaryResult : {};
  const safeVersions = Array.isArray(versions) ? versions : [];
  return {
    usedPreset: usedPreset || null,
    usedModel,
    usedModels: Array.isArray(usedModels) ? usedModels : [],
    versions: safeVersions,
    summary: getPublishablePostText(safeVersions[0]),
    emotion: typeof base.emotion === 'string' ? base.emotion : '',
    viral_potential: typeof base.viral_potential === 'string' ? base.viral_potential : '',
    facebook_safe_check: base.facebook_safe_check ?? null,
    availableModels: Array.isArray(base.availableModels) ? base.availableModels : [],
    debug: base.debug && typeof base.debug === 'object' ? base.debug : {},
    researchItems: Array.isArray(researchItems) ? researchItems : [],
    qualityWarnings: Array.isArray(qualityWarnings) ? qualityWarnings : [],
    factualGate: factualGate || null,
    lengthGate: lengthGate || null,
  };
}
