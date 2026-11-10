/**
 * =====================================================
 * News Studio → รูปผลแบบที่ท่อ Discord เดิมใช้ (10 พ.ย. 69)
 * =====================================================
 * บอท Discord (discord-bot/index.js) + /api/auto/process + คลัง "ผลงานที่เขียนแล้ว" อ่านผลในรูปของนักเขียนชุดเดิม
 * (processAutoFlowText) — ไฟล์นี้แปลงผลของระบบเขียนตัวใหม่ให้เป็นรูปนั้น โดยไม่ต้องแก้บอท
 *
 * สิ่งที่บอทอ่านจากแต่ละเวอร์ชัน (ดู discord-bot/index.js ช่วงประกอบ embed + buildWarningLines):
 *   content            เนื้อข่าว (บอทตัดที่ 3,800 ตัวอักษร)
 *   _sourceLabel|style ป้ายหน้าหัวข้อ "[ป้าย] พาดหัว"
 *   _source            'enhanced' = แถบเขียว · อย่างอื่น = แถบชมพู  → ใช้เขียวเฉพาะเวอร์ชันที่ผ่านและตรวจครบทุกด่าน
 *   promptId           ท้าย embed "PromptID: …" → ใส่รหัสครูที่เลียน (สืบย้อนได้)
 *   _missingFacts.missing[{type,text}]  → "⚠️ อาจตกข้อเท็จจริง: …"  ใช้กับแก่นที่ผู้ตรวจบอกว่าขาดเท่านั้น
 *   _genderWarning / _diversityWarning  → บรรทัด "⚠️ <ข้อความ>" ทั่วไป (บอทไม่ตีความชื่อช่อง)
 *      ระบบใหม่ใช้ 2 ช่องนี้ส่ง "เหตุที่ยังไม่ผ่านตัวตรวจ" และ "จุดที่ผู้ตรวจข้อเท็จจริงชี้" ให้พนักงานเห็นใต้ข่าว
 * ฟังก์ชันล้วน ไม่มี import แบบ alias — เทสได้ตรงๆ
 */

const FAIL_LABEL = {
  PARAGRAPHS: 'จำนวนย่อหน้าไม่ใช่ 3', TOO_SHORT: 'สั้นเกิน', TOO_LONG: 'ยาวเกิน', DASH: 'มีขีดยาว', EMOJI: 'มีอีโมจิ', HASHTAG: 'มีแฮชแท็ก',
  LIST: 'มีรายการ', QUESTION_END: 'จบด้วยคำถามถึงคนอ่าน', DANGLING: 'มีประโยคค้าง', COPIED_TEACHER: 'มีท่อนยกจากโพสต์ต้นแบบ', RAW_COPY: 'ยกจากเนื้อดิบมาก',
  ANGLE_DROPPED: 'ประเด็นที่ชูหายบางส่วน', FORMAT_LEAK: 'รูปแบบคำตอบหลุด', OPENING_TOO_LONG: 'ย่อหน้าแรกยาว', CLOSING_TOO_LONG: 'ย่อหน้าท้ายยาว',
  OPENING_MISSES_POINT: 'ย่อหน้าแรกยังไม่ถึงประเด็น', EMPTY: 'ไม่มีเนื้อ',
};

const OPENING_LABEL = { quote: 'เปิดด้วยคำพูด', tribute: 'เปิดด้วยการไว้อาลัย', admire: 'เปิดด้วยคำชื่นชม', contrast: 'เปิดด้วยสิ่งที่ขัดความคาดหมาย', number: 'เปิดด้วยตัวเลข', plain: 'เปิดเล่าตรงๆ' };

const arr = (v) => (Array.isArray(v) ? v : []);
const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** เวอร์ชันนี้ "ผ่านและตรวจครบ" ไหม — ด่านที่ไม่ได้ตรวจ (ล่ม/ไม่ได้ต่อ) ไม่นับเป็นผ่าน */
export const fullyPassed = (v) => !!v?.content && !!v.ok && !!v.factChecked && !!v.readChecked;

/** เหตุที่เวอร์ชันนี้ยังต้องให้คนดู (ข้อความสั้น) — ว่าง = ไม่มีอะไรต้องเตือน */
export function versionConcerns(v) {
  const out = [];
  const fails = arr(v?.fails).map((f) => FAIL_LABEL[f.code] || f.code).filter(Boolean);
  if (fails.length) out.push(`ยังไม่ผ่านแบบแผน: ${fails.join(' · ')}`);
  const major = arr(v?.factIssues).filter((i) => i.severity === 'major').length;
  if (major) out.push(`ผู้ตรวจข้อเท็จจริงพบจุดร้ายแรง ${major} จุด`);
  if (!v?.factChecked) out.push('ยังไม่ได้ตรวจข้อเท็จจริง (ผู้ตรวจล่ม)');
  if (v?.readChecked && !v.readClear) out.push(v.readOpening && v.readOpening !== 'บอกเรื่อง' ? `คนอ่านยังไม่รู้เรื่องจากย่อหน้าแรก (${v.readOpening})` : 'มีจุดที่คนอ่านตามไม่ได้');
  if (!v?.readChecked) out.push('ยังไม่ได้ตรวจการอ่าน (ผู้อ่านล่ม)');
  if (v?.stopped) out.push(`หยุดแก้ก่อนครบรอบ: ${v.stopped}`);
  return out;
}

/** 1 เวอร์ชันในรูปที่บอท/คลังผลงานอ่าน */
export function toLegacyVersion(v, { title = '' } = {}) {
  const cover = arr(v?.angle?.coverLines).map((x) => String(x || '').trim()).filter(Boolean);
  const teacherName = String(v?.teacher?.name || '').trim();
  const concerns = versionConcerns(v);
  const issues = arr(v?.factIssues);
  const missing = issues.filter((i) => i.type === 'missing').map((i) => ({ type: 'core', text: cut(`${i.problem || i.quote}`, 120) }));
  const others = issues.filter((i) => i.type !== 'missing').slice(0, 2).map((i) => `“${cut(i.quote, 60)}” ${cut(i.problem, 90)}`);
  const out = {
    title: String(title || ''),
    content: String(v?.content || ''),
    // ป้ายหน้าหัวข้อใน Discord: เลขเวอร์ชัน + บรรทัดแรกของพาดปก (พนักงานเห็นทันทีว่าเวอร์ชันนี้ชูอะไร)
    _sourceLabel: cut(`เวอร์ชัน ${v?.index ?? '?'}${cover[0] ? ` · ${cover[0]}` : ''}`, 80),
    // บรรทัด "เวอร์ชัน N — …" ในคลังผลงาน: ทิศทาง + ครู
    style: cut(`${cover.length ? `ทิศทาง: ${cover.join(' / ')}` : 'ไม่มีทิศทางจากต้นแบบปก'}${teacherName ? ` | ครู: ${teacherName}` : ''}`, 240),
    _source: fullyPassed(v) ? 'enhanced' : 'needs_review',
    promptId: String(v?.teacher?.id || ''),
    usedModel: '',
  };
  if (missing.length) out._missingFacts = { missing, checked: true };
  if (concerns.length) out._genderWarning = cut(concerns.join(' | '), 200);
  if (others.length) out._diversityWarning = cut(`ผู้ตรวจข้อเท็จจริงชี้: ${others.join(' · ')}`, 200);
  return out;
}

/** คำเตือนระดับงาน (บอทโชว์ 2 ข้อแรกในหัวข้อความ "จุดให้พนักงานตรวจ:") — เรียงเรื่องที่กระทบการใช้ก่อน */
export function runQualityWarnings(run) {
  const out = [];
  const versions = arr(run?.versions);
  const failed = versions.filter((v) => !v.content);
  if (failed.length) out.push(`เขียนได้ ${versions.length - failed.length} จาก ${versions.length} เวอร์ชัน (เวอร์ชัน ${failed.map((v) => v.index).join(', ')} เขียนไม่สำเร็จ)`);
  const review = versions.filter((v) => v.content && !fullyPassed(v));
  if (review.length) out.push(`เวอร์ชัน ${review.map((v) => v.index).join(', ')} ยังมีจุดให้ตรวจก่อนโพสต์ (ดูบรรทัดเตือนใต้ข่าว)`);
  for (const w of arr(run?.warnings)) if (w?.message && w.code !== 'RUN_NOT_SAVED') out.push(cut(w.message, 200));
  return out;
}

/**
 * ผลทั้งงานในรูป data ของ processAutoFlowText
 * @param {object} run  แถวงานที่จบแล้ว (status 'done') จาก runStudioJob
 * @param {{caseId?:string|null, modelName?:string}} [opts]
 */
export function toLegacyData(run, { caseId = null } = {}) {
  const title = String(run?.title || '').trim() || String(run?.rawText || '').trim().split('\n')[0].slice(0, 80);
  const writerModel = String(run?.models?.writer?.model || '');
  const written = arr(run?.versions).filter((v) => v.content);
  const versions = written.map((v) => ({ ...toLegacyVersion(v, { title }), usedModel: writerModel }));
  // ข่าวที่มีทิศทางเดียว: ทุกเวอร์ชันชูประเด็นเดียวกัน ต่างกันที่สำนวนครู — ป้ายใน Discord ต้องบอกสิ่งที่ต่าง ไม่ใช่ซ้ำกันสามใบ
  const labels = versions.map((v) => v._sourceLabel.replace(/^เวอร์ชัน \S+/, ''));
  versions.forEach((v, i) => {
    if (labels.filter((l) => l === labels[i]).length < 2) return;
    const opening = OPENING_LABEL[written[i]?.teacher?.openingType];
    if (opening) v._sourceLabel = cut(`เวอร์ชัน ${written[i].index} · ${opening}`, 80);
  });
  const qualityWarnings = runQualityWarnings(run);
  // ข้อมูลเสริมจากการค้น (มีเมื่อเปิด NEWS_STUDIO_DISCORD_RESEARCH=1) — บอทใช้รายการนี้ตัดสินว่าจะบอกพนักงานว่า "ต้นฉบับ 100%" หรือ "มีข้อมูลจากภายนอก"
  const researchItems = arr(run?.researchFacts).map((f) => {
    const m = String(f || '').match(/^(.*?)\s*\(ที่มา:\s*(.+?)\)\s*$/);
    return { title: cut(m ? m[1] : f, 160), sourceName: m ? cut(m[2], 60) : 'การค้นเสริม', sourceUrl: '' };
  }).filter((x) => x.title);
  const category = String(run?.analysis?.primaryCategory || '');
  const seconds = Number.isFinite(run?.timings?.total) ? Math.round(run.timings.total / 1000) : 0;
  const t = run?.timings || {};
  const s = (ms) => (Number.isFinite(ms) ? (ms / 1000).toFixed(1) : '0.0');
  return {
    generationLog: caseId ? { caseId } : null,
    newsData: { newsTitle: title, newsBody: String(run?.rawText || ''), newsCategory: category },
    breakdownData: null, // ระบบใหม่ไม่มีขั้นแตกประเด็น 4 มุม — ทิศทางข่าวอยู่ในแต่ละเวอร์ชัน (style) และในหน้าสตูดิโอ
    analysisResult: { versions, researchItems, qualityWarnings, newsTitle: title },
    blueprint: null,
    researchItems,
    factPool: null,
    simulatedComments: [],
    classicVersionCount: 0,
    enhancedVersionCount: versions.length,
    sourceType: 'plain_text',
    preset: 'news-studio',
    contentLength: 'short',
    totalTimeSeconds: seconds,
    usedPromptInfo: { source: 'news-studio', name: 'ระบบเขียนตัวใหม่ (ต้นแบบปก + ครู)', viralScore: 0, matchReason: '', newsType: category },
    stepTimings: { direction: s(t.direction), teachers: s(t.teachers), generate: s(t.writing), research: s(t.research) },
    studioRunId: String(run?.id || ''),
    pipelineLabel: 'ระบบเขียนตัวใหม่',
    providerUsed: 'news-studio',
    log: [`[news-studio] งาน ${run?.id || '?'} · ${versions.length} เวอร์ชัน · ${seconds} วินาที`],
  };
}

/** ข้อมูลที่ส่งให้ logGeneration (คลัง "ผลงานที่เขียนแล้ว") — รับได้เฉพาะช่องที่ตัวบันทึกเก็บ */
export function toGenerationLog(run, { userId = null, deskMeta = null } = {}) {
  const data = toLegacyData(run);
  return {
    sourceType: 'plain_text',
    sourceUrl: '',
    sourceText: String(run?.rawText || '').slice(0, 5000),
    newsTitle: data.newsData.newsTitle,
    breakdownData: null,
    versions: data.analysisResult.versions,
    contentLength: 'short',
    userId,
    pipelineInfo: {
      totalTime: data.totalTimeSeconds,
      promptName: 'ระบบเขียนตัวใหม่ (ต้นแบบปก + ครู)',
      promptSource: 'news-studio',
      promptId: String(run?.id || ''),
      promptMatchType: '',
      promptScore: 0,
      newsType: data.usedPromptInfo.newsType,
      stepTimings: data.stepTimings,
      desk: deskMeta || null,
    },
  };
}
