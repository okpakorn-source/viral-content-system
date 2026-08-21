/** ข้อความเดียวที่พนักงานเห็น คัดลอก ส่งตรวจ และนำไปโพสต์จริง */
export function getPublishablePostText(version) {
  return String(version?.content || '').trim();
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
  };
}
