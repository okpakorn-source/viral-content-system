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

/**
 * ด่านสุดท้ายของ TEXT news: กักทั้งฉบับที่สั้นกว่าพื้น โดยไม่แก้ข้อความ/เติมน้ำ/เรียก AI ซ้ำ
 * ฉบับที่ผ่านต้องคืน object เดิมเพื่อรักษา provenance ของ writer/card/teacher ทุก field
 */
export function enforceTextNewsPublicationFloor(versions, {
  minimumWords,
  segmenterCtor,
} = {}) {
  if (!Array.isArray(versions) || versions.length === 0
      || !Number.isInteger(minimumWords) || minimumWords < 1) {
    throw makeTextLengthGateError(
      'TEXT_NEWS_LENGTH_GATE_INVALID',
      'ข้อมูลด่านขั้นต่ำคำของข่าว TEXT ไม่ถูกต้อง',
    );
  }

  const evaluations = versions.map((version, index) => {
    const wordCount = countPublishableThaiWords(version, { segmenterCtor });
    return {
      version,
      versionNumber: index + 1,
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
    checks: evaluations.map(({ versionNumber, wordCount, passes }) => ({
      version: versionNumber,
      wordCount,
      passes,
    })),
    quarantinedVersions: quarantined.map(item => item.versionNumber),
  };

  if (passing.length === 0) {
    // ★ 1 ก.ย. 69 (บั๊กระดับกลาง พิสูจน์แล้ว): เดิมกักทั้งก้อนแล้วเหลือแค่ข้อความ — คนตรวจไม่รู้ว่าขาด 3 คำหรือ 100 คำ
    //   ใหม่: ข้อความบอกจำนวนคำทุกฉบับ (checks ใน lengthGate มีอยู่แล้ว)
    //   ⚠️ จงใจ "ไม่แนบเนื้อร่าง" ใน error — สัญญา R231 (news-length-contract) ห้ามเผยร่างที่ถูกกักเหมือนผลสำเร็จ
    //   การเก็บร่างไว้ให้พนักงานกู้ต้องทำผ่านการบันทึกเข้า workflow แยกต่างหาก (ข้อเสนอ รอเจ้าของเคาะ)
    const counts = evaluations.map(e => `V${e.versionNumber}=${e.wordCount} คำ`).join(', ');
    throw makeTextLengthGateError(
      'TEXT_NEWS_LENGTH_REVIEW_REQUIRED',
      `ไม่มีฉบับที่ยาวถึงขั้นต่ำ ${minimumWords} คำ (${counts}) ระบบกักผลไว้โดยไม่เติมคำหรือเรียก AI ซ้ำ`,
      { ...diagnostic, status: 'length_review' },
    );
  }

  return {
    ...diagnostic,
    passingVersions: passing.map(item => item.version),
    quarantinedVersions: quarantined.map(item => item.version),
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

/** สร้างผลรวมจากฉบับที่ผ่านจริงเท่านั้น ไม่พาข้อความจากร่างที่ถูกกักติดออกมา */
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
