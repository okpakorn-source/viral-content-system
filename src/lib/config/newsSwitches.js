/**
 * ทะเบียนสวิตช์ env ของท่อข่าว (NEWS SWITCH REGISTRY) — ★ 2 ก.ย. 69 (ข้อ 13 แผนแก้บั๊กท่อข่าว · แก้ตามผู้ตรวจไขว้รอบ 2 วันเดียวกัน)
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าที่: เป็น "ความจริงเดียว" ว่าท่อข่าวสาย TEXT อ่าน env ตัวไหนบ้าง ค่าเริ่มต้นคืออะไร ปิดคืนอย่างไร
 *   · โค้ดท่อข่าวยังอ่าน process.env ตรงๆ เหมือนเดิม (ไม่ rewire — ลด churn) ทะเบียนนี้เป็นเอกสาร+ด่านตรวจเท่านั้น
 *   · ด่านตรวจ: tests/news-switch-registry.test.mjs สแกนไฟล์ใน NEWS_SWITCH_FILES ด้วย AST (@babel/parser — ไม่หลงคอมเมนต์/สตริง)
 *     เจอชื่อ env ที่ไม่ใช่คีย์ลับแล้วไม่อยู่ในทะเบียน = แดง · readBy ต้องตรงกับไฟล์ที่อ่านจริงทั้งสองทาง (ไม่ขาด ไม่เกิน)
 *     · การอ่านแบบตามชื่อไม่ได้ (process.env[ตัวแปร] / const e = process.env / {...process.env}) ทำได้เฉพาะ helper ใน DYNAMIC_ENV_READERS
 *   · เอกสารอ่านง่าย: docs/NEWS-SWITCHES.md สร้างจากไฟล์นี้ด้วย `node scripts/gen-news-changelog.mjs` (ห้ามแก้มือ)
 * ขอบเขต (ผู้ตรวจไขว้ 2 ก.ย. 69 ข้อ 3): NEWS_SWITCH_FILES = ไฟล์สาย TEXT + ด่านแก้ไข + คิว + ไคลเอนต์/ประตูที่มีแต่สวิตช์ข่าว
 *   · ไฟล์ไคลเอนต์ร่วมที่ปนสวิตช์ระบบคลิป (src/lib/ai/geminiClient.js: GEMINI_VIDEO_MODEL) และไฟล์สาย URL
 *     (promptStore.js / summarizeService.js) ไม่สแกน — แต่ readBy ยังต้องระบุถ้าไฟล์นั้นอ่านสวิตช์ในทะเบียน (เทสตรวจว่าอ่านจริง)
 *   · ★ รอบยืนยัน 2 ก.ย. 69 ข้อ 1: กวาด `process.env` ทั้ง services/ai/correction/utils/api(auto·queue·summarize·generation-logs)
 *     แล้วคัดตามกราฟ import จาก autoFlowServiceText/summarizeServiceText — เพิ่ม promptMatcher · objText · newsCap ·
 *     input-engine/narrativePayloadText · rawFactCompletenessGate · researchService · achievementResearch · api/auto/stream
 *     ไฟล์ปก/ภาพ (storyIdentity · *Resolver* · captionAnalyzer · evidenceConfidence) · คลิป · radar/desk · mega ไม่เอา
 *   · ค่าเริ่มต้นในทะเบียนถูกเทียบกับโค้ดอัตโนมัติ (เทส "ค่าเริ่มต้นในทะเบียนต้องตรงกับที่โค้ดอ่านจริง") —
 *     รอบนี้จับได้ 2 รายการที่ทะเบียนเดิมผิด: CLAUDE_WRITE_MODEL (โค้ด || 'claude-opus-4-8' ไม่ใช่ '') และ
 *     WRITER_SOURCE_CHARS (ตัวอ่านที่วิ่งจริงคือ newsForStage('WRITER') ไม่ตั้ง = ไม่จำกัด · _writerSourceText 12000 ไม่ถูกเรียก)
 *   · บอทดิสคอร์ด (discord-bot/index.js) ไม่ใช่ท่อข่าว ไม่อยู่ในชุดสแกน — แต่สวิตช์บอทลงทะเบียนได้ในหมวด "บอทดิสคอร์ด"
 *     (readBy ชี้ไฟล์บอท · เทสตรวจว่าอ่านจริงผ่าน envFlag('X', bool) — helper ของบอทเอง)
 * กติกาเขียนรายการ:
 *   name     ชื่อ env ตรงตัว
 *   default  ค่าเมื่อไม่ตั้ง env (สตริง; '' = ไม่ตั้ง/ว่าง) — ยืนยันจากโค้ดใน worktree เท่านั้น ห้ามลงทะเบียนล่วงหน้าจากแผน
 *   values   ค่าที่โค้ดรับรู้ (สวิตช์ 0/1 ส่วนใหญ่รับเฉพาะตรงตัว — ดูหมายเหตุใน meaning ถ้าตัวอ่านทน on/off)
 *   readBy   ไฟล์ที่อ่านค่าจริง (path จากรากโปรเจกต์) — ครบทุกไฟล์ที่อ่าน และไม่มีไฟล์ที่ไม่ได้อ่าน
 *   meaning  ความหมายภาษาไทย 1 ประโยค
 *   since    วันที่เกิด (จากคอมเมนต์ในโค้ด · ถ้าไม่มีใช้ git log -S)
 *   rollback วิธีคืนพฤติกรรมเดิม
 *   group    หมวดสำหรับเอกสาร · kind: 'switch' (เปิด/ปิด) | 'value' (ตัวเลข/ข้อความ/โมเดล) | 'platform'
 *            (เดิมมี 'pending' สำหรับสวิตช์ที่ยังไม่ถึง worktree — ถอดออก 2 ก.ย. 69 เพราะทำให้ทะเบียนบอกค่าเริ่มต้นผิด)
 * ไฟล์นี้ตั้งใจ "ไม่มี import" — ให้เทส/สคริปต์ import แบบสัมพัทธ์ได้โดยไม่ต้องมี alias '@/' (ตัวสแกน AST อยู่ในไฟล์เทส)
 */

/** ไฟล์ท่อข่าวที่ทะเบียนนี้ครอบ (เทสสแกนชุดนี้ทุกไฟล์) — path จากรากโปรเจกต์ */
export const NEWS_SWITCH_FILES = Object.freeze([
  'src/lib/services/autoFlowServiceText.js',
  'src/lib/services/summarizeServiceText.js',
  'src/lib/services/viralFewshot.js',
  'src/lib/services/queueService.js',
  'src/lib/correction/correctionPipeline.js',
  'src/lib/correction/editorialPolishService.js',
  'src/lib/correction/fabricationGate.js',
  'src/lib/correction/factPreservationCheck.js',
  'src/lib/correction/flagFixerService.js',
  'src/lib/correction/guardedReplace.js',
  'src/lib/correction/outputAuditService.js',
  'src/lib/correction/placeScrub.js',
  'src/lib/correction/safeCorrectionService.js',
  'src/lib/correction/semanticSanityCheck.js',
  'src/lib/correction/viralPolishService.js',
  'src/app/api/auto/process/route.js',
  'src/app/api/queue/add/route.js',
  'src/app/api/queue/clear/route.js',
  'src/app/api/queue/status/route.js',
  'src/app/api/queue/worker/route.js',
  'src/lib/ai/aiRouter.js',
  'src/lib/ai/claudeClient.js',
  'src/lib/ai/modelConfig.js',
  'src/lib/utils/withTimeout.js',
  'src/lib/utils/pipelineDeadline.js',
  'src/lib/ai/legacyLengthRules.js',
  'src/lib/utils/publishablePostText.js',
  'src/lib/utils/envFlag.js',
  'src/lib/utils/researchSwitch.js',
  // จุดอ่านสวิตช์กลางที่ท่อข่าว import (สเปกไม่บังคับ แต่ครอบไว้เพราะเป็นสวิตช์ข่าวจริง)
  'src/lib/ai/promptModes.js',
  'src/lib/ai/cardAuthority.js',
  // ★ 2 ก.ย. 69 ผู้ตรวจไขว้ข้อ 3: ไฟล์ที่อ่านสวิตช์ข่าวจริงแต่เดิมหลุดขอบเขต
  'src/lib/ai/promptStoreText.js', // FORCE_LESSON_ANGLE (summarizeServiceText import ไฟล์นี้)
  'src/lib/ai/openai.js', // LOG_FULL_PROMPT (เดิม readBy บอกแค่ claudeClient)
  'src/app/api/auto/route.js', // ALLOW_LEGACY_AUTO + TEXT_ONLY_MODE (ประตูเก่าสาย URL ที่ถูกปิด)
  // ★ 2 ก.ย. 69 รอบยืนยัน ข้อ 1: ไฟล์สาย TEXT ที่อ่านสวิตช์ข่าวจริงแต่ยังหลุดขอบเขต (คัดจากกราฟ import ของ autoFlowServiceText/summarizeServiceText)
  'src/lib/services/promptMatcher.js', // PROMPT_VARIETY_BAND + ANGLE_MIN_MATCH_SCORE (summarizeServiceText import แบบ dynamic 2 จุด)
  'src/lib/utils/objText.js', // HOOKS_OBJ_FIX (summarizeServiceText + narrativePayloadText import)
  'src/lib/utils/newsCap.js', // NEWS_CAP_* + CARD_PICK_NEWS_CHARS/WRITER_SOURCE_CHARS — อ่านผ่าน newsForStage (ชื่อจากตาราง NEWS_CAPS.*.env)
  'src/lib/input-engine/narrativePayloadText.js', // ANGLE_CLOSING_SPLIT · ANGLE_BLUEPRINT_MODE · HOOKS_AS_OPENERS · ALLOW_SIMULATION (ทั้ง 2 ไฟล์สาย TEXT import)
  'src/lib/services/rawFactCompletenessGate.js', // RAW_FACT_COMPLETENESS_GATE (autoFlowServiceText เรียก isRawFactCompletenessGateEnabled)
  'src/lib/services/researchService.js', // อ่านแต่ SERPER_API_KEY — ครอบไว้ให้สวิตช์ที่เพิ่มทีหลังโดนด่าน (autoFlowServiceText import ตรง)
  'src/lib/services/achievementResearch.js', // เช่นเดียวกัน (SERPER_API_KEY เท่านั้น)
  'src/app/api/auto/stream/route.js', // TEXT_ONLY_MODE — ประตูเก่าสาย URL (@deprecated) ที่ยังเรียกได้ จึงมีด่านเดียวกับ /api/auto
  // ★ เฟส 2 "พรอมต์นักเขียน" 2 ก.ย. 69: จุดอ่านสวิตช์บล็อกกฎ/แคชพรอมต์นักเขียน (summarizeServiceText โหลดแบบ dynamic import)
  'src/lib/services/writerPolicyText.js', // WRITER_LENGTH_TARGET_V2 · WRITER_FIDELITY_RULES_V2 · WRITER_VIRAL_RULES_V2 · WRITER_PROMPT_CACHE_V2
]);

/** ชื่อ env ที่ถือเป็นคีย์ลับ/ที่อยู่ — ไม่ใช่สวิตช์ ไม่ลงทะเบียน */
export const SECRET_ENV_RE = /(_KEY|_SECRET|_URL|_TOKEN|_PASSWORD|_DSN)$/;

/** ชื่อที่ลงท้ายเหมือนคีย์ลับแต่จริงๆ เป็นสวิตช์ 0/1 (CARD_AUTH_URL = ประตูสาย URL ของ cardAuthority ไม่ใช่ที่อยู่) */
export const SECRET_NAME_EXCEPTIONS = Object.freeze(['CARD_AUTH_URL']);

export function isSecretEnvName(name) {
  const value = String(name || '');
  if (SECRET_NAME_EXCEPTIONS.includes(value)) return false;
  return SECRET_ENV_RE.test(value);
}

/**
 * helper อ่าน env ที่ตัวสแกน (ในไฟล์เทส) รู้จัก — เรียกด้วยชื่อคงที่ helper('X') นับเป็นการอ่าน X
 * นิยามของ helper เองอ่าน process.env[name] แบบตามชื่อไม่ได้ — อนุญาตเฉพาะที่ระบุใน DYNAMIC_ENV_READERS
 */
export const ENV_HELPERS = Object.freeze(['envOn', 'envStr', '_envTok', 'readToken', 'isDefaultOnSwitch', '_numEnv',
  'envFlag', // ของบอท discord-bot/index.js: envFlag('X', bool) รับเฉพาะ '0'/'1' ตรงตัว (ไฟล์บอทไม่อยู่ในชุดสแกน — ใช้แค่ตรวจ readBy)
]);

/**
 * จุดอ่าน env แบบ "ตามชื่อไม่ได้" ที่อนุญาต (process.env[ตัวแปร] · helper(ตัวแปร)) — ไฟล์ → ชื่อฟังก์ชันที่ครอบจุดนั้น
 * ★ 2 ก.ย. 69 ผู้ตรวจไขว้ข้อ 4: เดิม regex มองไม่เห็น const { X } = process.env / process.env?.X / const e = process.env
 *   ตอนนี้ AST จับ 2 แบบแรกเป็นการอ่านชื่อ X ตรงๆ ส่วน alias/spread/index ตัวแปรที่อยู่นอกรายการนี้ = เทสแดง
 */
export const DYNAMIC_ENV_READERS = Object.freeze({
  'src/lib/utils/envFlag.js': ['envOn', 'envStr'],
  'src/lib/ai/promptModes.js': ['readToken', 'isDefaultOnSwitch'],
  'src/lib/services/viralFewshot.js': ['_envTok'],
  'src/lib/services/summarizeServiceText.js': ['_numEnv'],
  'src/lib/ai/cardAuthority.js': ['isSwitchEnabled'],
  'src/lib/utils/newsCap.js': ['newsForStage'], // process.env[cfg.env] — ชื่อ env อยู่ในตาราง NEWS_CAPS (ตัวสแกนเก็บจากช่อง env: '...')
});

const AUTO = 'src/lib/services/autoFlowServiceText.js';
const SUMMARIZE = 'src/lib/services/summarizeServiceText.js';
const FEWSHOT = 'src/lib/services/viralFewshot.js';
const QUEUE = 'src/lib/services/queueService.js';
const WORKER = 'src/app/api/queue/worker/route.js';
const QUEUE_ADD = 'src/app/api/queue/add/route.js';
const PROCESS = 'src/app/api/auto/process/route.js';
const CLAUDE = 'src/lib/ai/claudeClient.js';
const PROMPT_MODES = 'src/lib/ai/promptModes.js';
const CARD_AUTH = 'src/lib/ai/cardAuthority.js';
const CORRECTION = 'src/lib/correction/correctionPipeline.js';
const PROMPT_TEXT = 'src/lib/ai/promptStoreText.js';
const OPENAI = 'src/lib/ai/openai.js';
const GEMINI = 'src/lib/ai/geminiClient.js'; // ไม่อยู่ในชุดสแกน (ปนสวิตช์คลิป) — ใส่ใน readBy ตามจริงได้
const AUTO_ROUTE = 'src/app/api/auto/route.js';
// ★ 2 ก.ย. 69 รอบยืนยัน ข้อ 1
const PROMPT_MATCHER = 'src/lib/services/promptMatcher.js';
const OBJ_TEXT = 'src/lib/utils/objText.js';
const NEWS_CAP = 'src/lib/utils/newsCap.js';
const NARRATIVE = 'src/lib/input-engine/narrativePayloadText.js';
const RAW_GATE = 'src/lib/services/rawFactCompletenessGate.js';
const STREAM_ROUTE = 'src/app/api/auto/stream/route.js';
const BOT = 'discord-bot/index.js'; // ไม่อยู่ในชุดสแกน (ไม่ใช่ท่อข่าว) — ใส่ใน readBy ตามจริงได้
// ★ เฟส 2 "พรอมต์นักเขียน" 2 ก.ย. 69
const WRITER_POLICY = 'src/lib/services/writerPolicyText.js';

/** เพดานตัดเนื้อข่าวรายด่านใน newsCap.js — ค่าเริ่มต้นทุกด่าน 0 = ไม่จำกัด (เจ้าของสั่งปลด 16 ส.ค. 69) · was = เพดานเดิมก่อนปลด */
const newsCapRule = (name, stage, was, desc) => ({
  name, default: '0', values: ['0 = ไม่จำกัด', 'จำนวนตัวอักษร (ทน "2000"/ช่องว่าง/อัญประกาศ)'], readBy: [NEWS_CAP], group: 'เพดานเนื้อข่าว (newsCap)', kind: 'value',
  meaning: `เพดานตัวอักษรเนื้อข่าวด่าน ${stage}: ${desc} — อ่านที่เดียวผ่าน newsForStage('${stage}') · ไม่ตั้ง = ส่งเนื้อเต็ม`,
  since: '16 ส.ค. 69', rollback: `${name}=${was} = เพดานเดิมก่อนปลด`,
});

const cardAuthRule = (name, code, meaning) => ({
  name, default: '0', values: ['0', '1'], readBy: [CARD_AUTH], group: 'อำนาจการ์ด (cardAuthority)', kind: 'switch',
  meaning: `${code}: ${meaning} (รับเฉพาะ "1" ตรงตัว · CARD_AUTHORITY=1 เปิดทุกข้อแทนได้)`,
  since: '21 ส.ค. 69 (a56d011a)', rollback: 'ลบ env หรือค่าอื่นที่ไม่ใช่ 1',
});

export const NEWS_SWITCHES = Object.freeze([
  // ── มุมข่าว / โครงเรื่อง (autoFlowServiceText) ──
  {
    name: 'GEN_ANGLES', default: '2', values: ['1', '2', '3', '4'], readBy: [AUTO], group: 'มุมข่าว/โครงเรื่อง', kind: 'value',
    meaning: 'จำนวนมุมข่าวที่เจนต่อข่าว (เพดาน 1-4 ใช้สูตรเดียวกันทั้ง MULTI-ANGLE และ per_angle)',
    since: '10 ก.ค. 69 (รวมศูนย์ getGenAnglesCount 19 ส.ค. 69)', rollback: 'ลบ env = 2 มุม',
  },
  {
    name: 'GEN_PER_ANGLE', default: '1', values: ['1', '2', '3'], readBy: [AUTO], group: 'มุมข่าว/โครงเรื่อง', kind: 'value',
    meaning: 'จำนวนเวอร์ชันที่เขียนต่อมุม', since: '10 มิ.ย. 69', rollback: 'ลบ env = 1 เวอร์ชัน/มุม',
  },
  {
    name: 'ANGLE_MIN_MATCH_SCORE', default: '45', values: ['จำนวนเต็ม ≥ 0'], readBy: [AUTO, PROMPT_MATCHER], group: 'มุมข่าว/โครงเรื่อง', kind: 'value',
    meaning: 'คะแนนจับคู่การ์ดขั้นต่ำ ต่ำกว่านี้มุมนั้นใช้ Built-in Fallback แทนการ์ดจากคลัง (promptMatcher ใช้ค่าเดียวกันเป็นพื้นกันตกของวงคะแนน PROMPT_VARIETY_BAND)',
    since: '10 ก.ค. 69', rollback: 'ลบ env = 45',
  },
  {
    name: 'ANGLE_CARD_CONTEXT', default: '1', values: ['0', '1'], readBy: [AUTO, SUMMARIZE], group: 'มุมข่าว/โครงเรื่อง', kind: 'switch',
    meaning: 'ส่งข้อมูลการ์ดที่มุมก่อนหน้าใช้ไปให้ตัวเลือกการ์ดของมุมถัดไป (แบบ 2 — กันซ้ำการ์ด)',
    since: '18 ส.ค. 69', rollback: 'ANGLE_CARD_CONTEXT=0',
  },
  {
    name: 'ANGLE_CLOSING_SPLIT', default: '0', values: ['0', '1'], readBy: [AUTO, SUMMARIZE, NARRATIVE], group: 'มุมข่าว/โครงเรื่อง', kind: 'switch',
    meaning: 'แยกแผนจบรายมุม ไม่ให้ท่อนจบของ 2 มุมออกมาแฝดกัน (autoFlow/narrativePayloadText อ่าน =1 ตรงตัว · summarize อ่านผ่าน envOn)',
    since: '18 ส.ค. 69 (แบบ ก)', rollback: 'ลบ env หรือ =0 = แผนจบเดิมใบเดียวแชร์ทุกมุม',
  },
  {
    name: 'ANGLE2_BY_SCORE', default: '0', values: ['0', '1'], readBy: [AUTO], group: 'มุมข่าว/โครงเรื่อง', kind: 'switch',
    meaning: 'มุมที่ 2 เลือกตามคะแนนไวรัลแทนลำดับเดิม (จุดหั่นมุม 3 จุดสลับพร้อมกันด้วยสวิตช์เดียว)',
    since: '19 ส.ค. 69', rollback: 'ลบ env หรือ =0 = เดินโค้ดเดิม',
  },
  {
    name: 'ANGLE_BLUEPRINT_MODE', default: '', values: ['', 'per_angle'], readBy: [AUTO, SUMMARIZE, NARRATIVE], group: 'มุมข่าว/โครงเรื่อง', kind: 'switch',
    meaning: '=per_angle วาง Blueprint หนึ่งใบต่อหนึ่งมุม (แบบ A) · ค่าอื่น/ว่าง = Blueprint ใบเดียวเหมือนเดิม (narrativePayloadText อ่านซ้ำเพื่อตัด "ปิด:" ตามตราประทับมุม)',
    since: '18 ส.ค. 69', rollback: 'ลบ env',
  },
  {
    name: 'TIMELINE_FLOW_MODE', default: '', values: ['', 'natural'], readBy: [SUMMARIZE], group: 'มุมข่าว/โครงเรื่อง', kind: 'switch',
    meaning: '=natural เติมคำแนะนำ "หลัง HOOK ไล่ตามลำดับเวลาจริง" ในใบสั่งเขียน · ค่าอื่นประกอบ prompt เดิมทุกไบต์',
    since: '21 ส.ค. 69 (a56d011a)', rollback: 'ลบ env',
  },
  {
    name: 'REF_WEIGHT_BY_MATCH', default: '0', values: ['0', '1'], readBy: [AUTO, SUMMARIZE], group: 'มุมข่าว/โครงเรื่อง', kind: 'switch',
    meaning: 'ลดน้ำหนักการยึด ref ตามคุณภาพจับคู่ (BORROWED ไม่ถูกบังคับเท่า EXACT) — B5',
    since: '16 ก.ค. 69', rollback: 'ลบ env หรือ =0 = พฤติกรรมเดิม',
  },
  {
    name: 'OPENING_FAMILY_CONTRACT', default: '0', values: ['0', '1'], readBy: [AUTO], group: 'มุมข่าว/โครงเรื่อง', kind: 'switch',
    meaning: '=1 กลับไปบังคับ "ตระกูลวิธีเปิดเรื่อง" ต่อมุมแบบก่อน 2 ก.ย. · ค่าเริ่มต้น = เลิกบังคับตระกูล (เจ้าของเคาะหลังศึกโมเดล 7 แขน)',
    since: '2 ก.ย. 69', rollback: 'OPENING_FAMILY_CONTRACT=1 = พฤติกรรมก่อน 2 ก.ย.',
  },
  {
    name: 'OPENING_IDENTITY_RULE', default: '1', values: ['0', '1'], readBy: [AUTO], group: 'มุมข่าว/โครงเรื่อง', kind: 'switch',
    meaning: 'เติมกติกา "ภายในสองประโยคแรกคนอ่านต้องรู้ว่าเรื่องของใคร/อะไร" ในสัญญาเปิดเรื่องทุกมุม',
    since: '2 ก.ย. 69', rollback: 'OPENING_IDENTITY_RULE=0',
  },
  {
    name: 'ANGLE2_DISTINCT_V2', default: '1', values: ['0', '1'], readBy: [AUTO], group: 'มุมข่าว/โครงเรื่อง', kind: 'switch',
    meaning: 'จัดสรร key_points ให้แต่ละมุม "เล่าเต็ม" ไม่ซ้ำกันก่อนยิงขนาน (isAngle2DistinctV2Enabled อ่าน !== "0" = ค่าเริ่มต้นเปิด) · =0 ข้อความส่งนักเขียนเหมือนเดิมทุกไบต์',
    since: '2 ก.ย. 69 (เคสศรราม 2 มุมซ้ำ 38-42%)', rollback: 'ANGLE2_DISTINCT_V2=0',
  },

  // ── นักเขียน / ใบสั่งเขียน (summarizeServiceText) ──
  {
    name: 'WRITER_SOURCE_CHARS', default: '0', values: ['0 = ไม่จำกัด', 'จำนวนตัวอักษร'], readBy: [SUMMARIZE, NEWS_CAP], group: 'นักเขียน/ใบสั่งเขียน', kind: 'value',
    meaning: 'เพดานตัวอักษรเนื้อดิบที่ส่งให้นักเขียน — ตัวอ่านที่วิ่งจริงคือ newsForStage(\'WRITER\') ใน newsCap.js (ไม่ตั้ง = ไม่จำกัด · fallback 0) · _writerSourceText ใน summarizeServiceText (เพดาน 12000) ยังอยู่ในไฟล์แต่ไม่มีใครเรียก — ทะเบียนเดิมบอก 12000 ผิดจากโค้ดที่วิ่ง (แก้ 2 ก.ย. 69 รอบยืนยัน)',
    since: '16 ส.ค. 69', rollback: 'WRITER_SOURCE_CHARS=3000 = เพดานยุค 10 มิ.ย. 69 · ตั้งตัวเลขใดก็ได้เพื่อจำกัดกลับ',
  },
  {
    name: 'CARD_PICK_NEWS_CHARS', default: '0', values: ['0 = ไม่จำกัด', 'จำนวนตัวอักษร'], readBy: [SUMMARIZE, NEWS_CAP], group: 'นักเขียน/ใบสั่งเขียน', kind: 'value',
    meaning: 'เพดานเนื้อข่าวที่ "สมองเลือกการ์ด" ได้อ่าน (เดิมตัด 400 ตัวอักษรฝังไว้ยุคแรก) — อ่าน 2 จุด: _cardPickNewsText ใน summarizeServiceText และ newsForStage(\'CARD_PICK\') ใน newsCap ทั้งคู่ไม่ตั้ง = ไม่จำกัด',
    since: '16 ส.ค. 69', rollback: 'CARD_PICK_NEWS_CHARS=400 = เพดานเดิมยุคแรก',
  },
  {
    name: 'PARA_CAP_ENFORCE', default: '1', values: ['0', '1'], readBy: [SUMMARIZE], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: 'บังคับเพดานย่อหน้าเชิงโค้ด: เกินเพดานแล้วยุบย่อหน้าท้ายสั้น (≤160 ตัว) เข้าย่อหน้าก่อนหน้า',
    since: '4 ส.ค. 69', rollback: 'PARA_CAP_ENFORCE=0',
  },
  {
    name: 'VIRAL_HITS_FORMULA', default: '1', values: ['0', '1'], readBy: [SUMMARIZE, FEWSHOT], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: '"สูตรแสนไลก์" — ถ่วงการหยิบครูด้วยไลก์จริง + บรรทัดห้ามสำนวนบอกความรู้สึก (+ ทางแยกความยาว 250-350 ในโหมดถอย LEGACY)',
    since: '14 ส.ค. 69 ค่ำ', rollback: 'VIRAL_HITS_FORMULA=0 = สูตรเดิมทั้งชุด',
  },
  {
    name: 'FEELING_ECHO', default: '0', values: ['0', '1'], readBy: [SUMMARIZE], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: '=1 ปลดแบนสำนวนบอกความรู้สึกเฉพาะบรรทัดสูตรแสนไลก์ (หลักฐานโพสต์ 155,321 ไลก์ใช้ "ใครเห็นก็จุกในอก")',
    since: '19 ส.ค. 69', rollback: 'ลบ env = ข้อความเดิมทุกไบต์',
  },
  // ★ 2 ก.ย. 69 รอบยืนยัน ข้อ 1 — สวิตช์ในไฟล์ที่เพิ่งเข้าขอบเขต (objText / narrativePayloadText) · ค่าเริ่มต้นอ่านจากโค้ดจริง
  {
    name: 'HOOKS_OBJ_FIX', default: '1', values: ['1', '0 (รับ 0/off/false/no)'], readBy: [OBJ_TEXT], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: 'ตัวแปลงกลาง object → ข้อความสำหรับช่องที่ขั้นแตกประเด็นคืนเป็น object (best_sections/pain_points/emotional_hooks/quotes) — กัน "[object Object]" เข้าใบสั่งเขียน · isObjFixEnabled อ่าน ?? "" แล้วว่าง = เปิด',
    since: '19 ส.ค. 69 (a56d011a)', rollback: 'HOOKS_OBJ_FIX=0 = ต่อสตริงตรงแบบเดิม',
  },
  {
    name: 'HOOKS_AS_OPENERS', default: '0', values: ['0', '1'], readBy: [NARRATIVE], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: '=1 แตก "จุดที่คนอิน" (emotional_hooks) เป็นรายการแยกบรรทัดพร้อมกำกับว่าเป็นวัตถุดิบไม่บังคับ — กันนักเขียนลอกยกพวงไปเปิดเรื่อง · ค่าเริ่มต้น = บรรทัดเดิม "a | b | c" ทุกไบต์',
    since: '19 ส.ค. 69 (a56d011a — สเปคเฟเบิ้ล-สุด)', rollback: 'ลบ env',
  },
  {
    name: 'ALLOW_SIMULATION', default: '0', values: ['0', '1 (รับ 1/true/on ไม่สนตัวพิมพ์/อัญประกาศ)'], readBy: [NARRATIVE], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: '=1 คืนคำแนะนำเสริม "อนุญาตยกตัวอย่างสถานการณ์จำลอง" ในใบสั่งเขียน (ข้อความต่างกันตามโหมด LEGACY_LENGTH_RULES) · ค่าเริ่มต้น = ริบใบอนุญาตแต่งสถานการณ์ (การ์ดมีอำนาจเหนือ)',
    since: '16 ส.ค. 69 (9b9a689b)', rollback: 'ลบ env',
  },
  {
    name: 'FORCE_LESSON_ANGLE', default: '0', values: ['0', '1'], readBy: [PROMPT_TEXT, 'src/lib/ai/promptStore.js', 'src/lib/services/summarizeService.js'], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: '=1 คืนกฎเก่า "ทุกข่าวต้องหามุมดี/บทเรียนอย่างน้อย 1 จุด" · ค่าเริ่มต้น = ห้ามยัดข้อคิดที่ต้นฉบับไม่มี (เจ้าของสั่ง) — สาย TEXT อ่านที่ promptStoreText · สาย URL อ่านที่ promptStore/summarizeService (ไฟล์สาย URL ไม่อยู่ในชุดสแกน)',
    since: '1 ส.ค. 69', rollback: 'FORCE_LESSON_ANGLE=1 = กฎบังคับข้อคิดแบบเดิม',
  },
  {
    name: 'EXTRACT_FACT_LOCK', default: '0', values: ['0', '1'], readBy: [SUMMARIZE], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: '=1 เติมกฎ FACT ANCHOR (ความจริงขั้นสกัด มีอำนาจเหนือคำสั่งเพิ่มเติม) ในขั้น extract',
    since: '21 ส.ค. 69 (a56d011a)', rollback: 'ลบ env',
  },
  {
    name: 'WORD_FLEX_V2', default: '1', values: ['0', '1'], readBy: [SUMMARIZE], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: 'สูตรเพดานคำโตตามเนื้อดิบ — มีผลเฉพาะโหมดถอย LEGACY_LENGTH_RULES=1 (โหมดปกติไม่แตะ)',
    since: '16 ส.ค. 69', rollback: 'WORD_FLEX_V2=0',
  },
  {
    name: 'WORD_FLOOR', default: '165', values: ['จำนวนคำ > 0'], readBy: [SUMMARIZE], group: 'นักเขียน/ใบสั่งเขียน', kind: 'value',
    meaning: 'พื้นจำนวนคำของสูตร WORD_FLEX_V2 (เฉพาะโหมดถอย LEGACY)', since: '16 ส.ค. 69', rollback: 'ลบ env = 165',
  },
  {
    name: 'WORD_CAP_BASE', default: '350', values: ['จำนวนคำ > 0'], readBy: [SUMMARIZE], group: 'นักเขียน/ใบสั่งเขียน', kind: 'value',
    meaning: 'ฐานเพดานคำของสูตร WORD_FLEX_V2 (เฉพาะโหมดถอย LEGACY)', since: '16 ส.ค. 69', rollback: 'ลบ env = 350',
  },
  {
    name: 'WORD_CAP_RATIO', default: '0.75', values: ['สัดส่วน > 0'], readBy: [SUMMARIZE], group: 'นักเขียน/ใบสั่งเขียน', kind: 'value',
    meaning: 'สัดส่วนเพดานคำต่อเนื้อดิบของสูตร WORD_FLEX_V2 (เฉพาะโหมดถอย LEGACY)', since: '16 ส.ค. 69', rollback: 'ลบ env = 0.75',
  },
  {
    name: 'WORD_CAP_MAX', default: '900', values: ['จำนวนคำ > 0'], readBy: [SUMMARIZE], group: 'นักเขียน/ใบสั่งเขียน', kind: 'value',
    meaning: 'เพดานคำสูงสุดของสูตร WORD_FLEX_V2 (เฉพาะโหมดถอย LEGACY)', since: '16 ส.ค. 69', rollback: 'ลบ env = 900',
  },
  // ── ★ เฟส 2 "พรอมต์นักเขียน" (2 ก.ย. 69) — ค่าเริ่มต้นปิดทั้ง 5 ตัว (รอ A/B) · ปิด = ใบสั่งเดิมไบต์ต่อไบต์ (สแนปช็อต tests/writer-prompt-cache-v2.test.mjs)
  //   หลักฐาน: เพจจริง 1,927 โพสต์ 140–170 คำ ค่ากลาง 15,605 ไลก์ · 230+ ≈ 5–6 พัน · ระบบเขียน 228–296 คำ · ผู้ตรวจ 14 คน 12/14 ฉบับมีของแต่งเล็ก
  //   4 ตัวแรกอ่าน "จุดเดียว" ใน writerPolicyText.js (รับเฉพาะ '1' ตรงตัว) · WRITER_TRIM_PASS อ่านที่ autoFlowServiceText (จุดต่อสายก่อน correction)
  {
    name: 'WRITER_LENGTH_TARGET_V2', default: '0', values: ['0', '1'], readBy: [WRITER_POLICY], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: '=1 เติมบล็อกความยาวเป้าหมาย 150–190 คำ (ยืดถึง 220 เฉพาะข่าวหลายเหตุการณ์) + ลำดับการตัด + ของห้ามตัด ในโซนกฎคงที่ก่อน FINAL RAW AUTHORITY · ค่าเริ่มต้น = ไม่มีบล็อก',
    since: '2 ก.ย. 69', rollback: 'ลบ env หรือ =0 = ใบสั่งเดิมไบต์ต่อไบต์',
  },
  {
    name: 'WRITER_FIDELITY_RULES_V2', default: '0', values: ['0', '1'], readBy: [WRITER_POLICY], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: '=1 เติมบล็อกความซื่อตรง: ห้ามแต่งการกระทำ/ความคิด/ท่าทาง/ความต่างที่ต้นฉบับไม่บอก ("ไม่ได้ดุ" "นั่งลงคุย") · ห้ามเดาเพศ/บทบาท (ใช้ชื่อหรือ "เจ้าตัว") · ตีความอารมณ์ ≤ 1 ประโยค/ย่อหน้า',
    since: '2 ก.ย. 69', rollback: 'ลบ env หรือ =0 = ใบสั่งเดิมไบต์ต่อไบต์',
  },
  {
    name: 'WRITER_VIRAL_RULES_V2', default: '0', values: ['0', '1'], readBy: [WRITER_POLICY], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: '=1 เติมบล็อก "กฎจากโพสต์ปังจริง" จาก data/writer-viral-rules.json ({version, rules[{id,text,evidence}]} — เติมข้อได้โดยไม่แตะโค้ด) · ไฟล์หาย/พัง/ว่าง = ไม่ใส่บล็อก ⚠️ บน Vercel ต้องเพิ่มไฟล์ใน outputFileTracingIncludes (next.config.mjs) ก่อนเปิด',
    since: '2 ก.ย. 69', rollback: 'ลบ env หรือ =0 = ใบสั่งเดิมไบต์ต่อไบต์',
  },
  {
    name: 'WRITER_PROMPT_CACHE_V2', default: '0', values: ['0', '1'], readBy: [WRITER_POLICY], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: '=1 แตกใบสั่งเขียนเป็น 2 ก้อนส่งเป็น promptBlocks ของ callClaude: [กฎคงที่+JSON cache:true] แล้ว [RAW-first + การ์ด/ครู/ประเด็น + FINAL RAW AUTHORITY ท้าย] (aiRouter ส่งต่อเฉพาะสาย Claude · Sol ใช้สตริงเดิม) · ค่าเริ่มต้น = RAW-first สตริงเดียวเหมือนเดิม',
    since: '2 ก.ย. 69', rollback: 'ลบ env หรือ =0 = การเรียกนักเขียนเดิมทุกไบต์ (ไม่มีคีย์ promptBlocks)',
  },
  {
    name: 'WRITER_TRIM_PASS', default: '0', values: ['0', '1'], readBy: [AUTO], group: 'นักเขียน/ใบสั่งเขียน', kind: 'switch',
    meaning: '=1 ฉบับที่ยาวเกิน 220 คำ ให้ luna ตัดเฉพาะประโยคที่ไม่มีข้อเท็จจริงใหม่เหลือ ~180 คำ ก่อน correctionPipeline (งบ 25s) · fail-safe: ข้อเท็จจริงหายเพิ่ม/สั้นกว่า 146/AI ล้ม/หมดเวลา = ใช้ร่างเดิม (ผลใน version._trimPass) · ค่าเริ่มต้น = ไม่ยิง',
    since: '2 ก.ย. 69', rollback: 'ลบ env หรือ =0 = ไม่มีขั้นนี้ (เวอร์ชันเข้าด่านแก้ไขเหมือนเดิม)',
  },

  // ── สมองเลือกการ์ด (card picker) ──
  {
    name: 'CARD_PICKER_AI', default: '1', values: ['0', '1'], readBy: [SUMMARIZE], group: 'สมองเลือกการ์ด', kind: 'switch',
    meaning: 'ให้ AI เลือกการ์ดจาก top-8 ทุกกรณี (เดิมเฉพาะ BORROWED) · =0 คืนพฤติกรรมเดิม',
    since: '1 ส.ค. 69', rollback: 'CARD_PICKER_AI=0',
  },
  {
    name: 'CARD_PICKER_MODEL', default: '', values: ['model id (ว่าง = gpt-5.6-luna)'], readBy: [SUMMARIZE], group: 'สมองเลือกการ์ด', kind: 'value',
    meaning: 'โมเดลสมองเลือกการ์ดสาย A (บรรณารักษ์สารบัญ) และสำรองของสาย B · ขึ้นต้น claude- จะวิ่ง callClaude',
    since: '1 ส.ค. 69 (สาย claude 15 ส.ค. 69)', rollback: 'ลบ env = gpt-5.6-luna',
  },
  {
    name: 'CARD_PICKER_MODEL_B', default: '', values: ['model id (ว่าง = ตาม CARD_PICKER_MODEL → gpt-5.6-luna)'], readBy: [SUMMARIZE], group: 'สมองเลือกการ์ด', kind: 'value',
    meaning: 'โมเดลด่านเคาะสาย B (เลือก 1 จากผู้เข้ารอบ)', since: '15 ส.ค. 69', rollback: 'ลบ env',
  },
  {
    name: 'CARD_PICKER_EFFORT_A', default: 'low', values: ['low', 'medium', 'high'], readBy: [SUMMARIZE], group: 'สมองเลือกการ์ด', kind: 'value',
    meaning: 'ระดับคิดของ Claude สาย A (บรรณารักษ์สารบัญ)', since: '15 ส.ค. 69', rollback: 'ลบ env = low',
  },
  {
    name: 'CARD_PICKER_EFFORT_B', default: 'medium', values: ['low', 'medium', 'high'], readBy: [SUMMARIZE], group: 'สมองเลือกการ์ด', kind: 'value',
    meaning: 'ระดับคิดของ Claude สาย B (ด่านเคาะ)', since: '15 ส.ค. 69', rollback: 'ลบ env = medium',
  },
  {
    name: 'CARD_PICKER_B_TIMEOUT_MS', default: '35000', values: ['มิลลิวินาที > 0'], readBy: [SUMMARIZE], group: 'สมองเลือกการ์ด', kind: 'value',
    meaning: 'เพดานเวลาด่านเคาะสาย B (AbortController ตัดสายจริง)', since: '15 ส.ค. 69', rollback: 'ลบ env = 35000',
  },
  {
    name: 'CARD_PICKER_CACHE', default: '1', values: ['0', '1'], readBy: [SUMMARIZE], group: 'สมองเลือกการ์ด', kind: 'switch',
    meaning: 'แตกพรอมต์บรรณารักษ์เป็นก้อนคงที่ (หัว+สารบัญ) เพื่อใช้ส่วนลดแคชพรอมต์ Claude',
    since: '15 ส.ค. 69', rollback: 'CARD_PICKER_CACHE=0',
  },
  {
    name: 'CARD_CATALOG_ALL', default: '1', values: ['0', '1'], readBy: [SUMMARIZE], group: 'สมองเลือกการ์ด', kind: 'switch',
    meaning: 'บรรณารักษ์อ่านสารบัญการ์ดทั้งคลังครั้งเดียวต่อข่าว แล้วมุมถัดไปใช้โผแคช',
    since: '1 ส.ค. 69', rollback: 'CARD_CATALOG_ALL=0',
  },
  {
    name: 'CARD_CATALOG_RICH', default: '1', values: ['0', '1'], readBy: [SUMMARIZE], group: 'สมองเลือกการ์ด', kind: 'switch',
    meaning: 'สารบัญการ์ดแบบข้อมูลเต็ม (บรรณารักษ์เห็นข้อมูลการ์ดชัด)', since: '18 ส.ค. 69', rollback: 'CARD_CATALOG_RICH=0',
  },
  {
    name: 'PICKER_FULL_CARD', default: '1', values: ['0', '1'], readBy: [SUMMARIZE], group: 'สมองเลือกการ์ด', kind: 'switch',
    meaning: 'ด่านเคาะ 14→1 เห็นการ์ดเต็มใบแทนย่อ', since: '18 ส.ค. 69', rollback: 'PICKER_FULL_CARD=0',
  },
  {
    name: 'PROMPT_VARIETY_BAND', default: '0', values: ['0 = ปิด (แชมป์คะแนนสูงสุดเสมอ)', '1-8 (แนะนำ 5 · เกิน 8 ถูกตัดที่ 8)'], readBy: [PROMPT_MATCHER], group: 'สมองเลือกการ์ด', kind: 'value',
    meaning: '"วงคะแนนใกล้แชมป์" ใน promptMatcher — สุ่มหยิบการ์ดจากใบที่คะแนนห่างแชมป์ไม่เกินค่านี้ (ไม่ต่ำกว่าพื้น ANGLE_MIN_MATCH_SCORE) กระจายการใช้การ์ดที่คะแนนสูสี · Number(env) || 0 = ค่าเริ่มต้นปิด',
    since: '26 ก.ค. 69 (39062195 — เจ้าของเคาะ)', rollback: 'ลบ env = พฤติกรรมเดิม 100% (ไม่มีสถานะสะสม)',
  },

  // ── ครูตัวอย่างไวรัล (viralFewshot) ──
  {
    name: 'VIRAL_STYLE_PACK', default: '1', values: ['0', '1'], readBy: [FEWSHOT], group: 'ครูตัวอย่างไวรัล', kind: 'switch',
    meaning: 'ส่ง VIRAL STYLE PACK (สูตรบังคับ 5 ข้อ) เข้าพรอมต์นักเขียน · =0 ใช้เฉพาะตัวอย่างครู',
    since: '11 มิ.ย. 69', rollback: 'VIRAL_STYLE_PACK=0',
  },
  {
    name: 'VIRAL_ROTATE', default: '1', values: ['0', '1'], readBy: [FEWSHOT], group: 'ครูตัวอย่างไวรัล', kind: 'switch',
    meaning: 'สุ่มครูถ่วงน้ำหนักจากโผทั้งหมวด แทนหยิบ 2 ใบไลก์สูงสุดตายตัว', since: '8 ส.ค. 69', rollback: 'VIRAL_ROTATE=0',
  },
  {
    name: 'VIRAL_MATCH_MODE', default: '', values: ['', 'ai', 'score'], readBy: [FEWSHOT], group: 'ครูตัวอย่างไวรัล', kind: 'switch',
    meaning: 'วิธีจับคู่ครู: ai = บรรณารักษ์ luna อ่านเนื้อ+บัตรลักษณะ · score = คะแนนแมชโค้ดล้วน · ว่าง/ค่าอื่น = สุ่มทั้งหมวด',
    since: '10 ส.ค. 69 (เจ้าของเคาะค่าเริ่มต้น=สุ่ม 14 ส.ค. 69)', rollback: 'ลบ env = สุ่มทั้งหมวด',
  },
  {
    name: 'VIRAL_EXAMPLE_CHARS', default: '1300', values: ['300-3000'], readBy: [FEWSHOT], group: 'ครูตัวอย่างไวรัล', kind: 'value',
    meaning: 'เพดานตัวอักษรต่อครู 1 ใบ (1300 = ครูครบทั้งใบ 100%)', since: '16 ส.ค. 69', rollback: 'VIRAL_EXAMPLE_CHARS=700 (ห้าม =0 — จะถูกดันขึ้นพื้น 300)',
  },
  {
    name: 'VIRAL_SHORTLIST', default: '0', values: ['0', '1 (รับ 1/true/on/yes)'], readBy: [FEWSHOT], group: 'ครูตัวอย่างไวรัล', kind: 'switch',
    meaning: 'ชั้นคัดโผครู K ใบด้วยสัญญาณเนื้อข่าวก่อนสุ่ม (ค่าจริงบน production 24 ส.ค. = 1 ตามสมุดสวิตช์)',
    since: '16 ส.ค. 69', rollback: 'ลบ env หรือ =0',
  },
  {
    name: 'VIRAL_SHORTLIST_K', default: '8', values: ['6-40'], readBy: [FEWSHOT], group: 'ครูตัวอย่างไวรัล', kind: 'value',
    meaning: 'ขนาดโผของชั้นคัด (พื้น 6 กัน "ครูตายตัว")', since: '16 ส.ค. 69', rollback: 'ลบ env = 8',
  },
  {
    name: 'CARD_TEACHER_MATCH', default: '0', values: ['0', '1 (รับ 1/true/on/yes)'], readBy: [FEWSHOT], group: 'ครูตัวอย่างไวรัล', kind: 'switch',
    meaning: '"การ์ดนำทางครู" — ส่งป้ายสาระการ์ดที่เลือกเข้าตัวคัดโผครู (ทำงานคู่ VIRAL_SHORTLIST · production เปิด 24 ส.ค.)',
    since: '24 ส.ค. 69', rollback: 'ลบ env = ระบบเดิม 100%',
  },
  {
    name: 'VIRAL_TEACHER_GUIDE', default: '0', values: ['0', '1'], readBy: [FEWSHOT], group: 'ครูตัวอย่างไวรัล', kind: 'switch',
    meaning: '=1 เติมคำแนะนำจากครู (teacher guide) ให้มุมที่มีสิทธิ์ (teacherGuideEligible)', since: '21 ส.ค. 69 (a56d011a)', rollback: 'ลบ env',
  },

  // ── โหมดถ้อยคำในใบสั่งเขียน (promptModes — อ่านจากไฟล์นี้เท่านั้น) ──
  {
    name: 'STYLE_PACK_V2', default: '1', values: ['1', '0 (รับ 0/off/false/no)'], readBy: [PROMPT_MODES], group: 'โหมดถ้อยคำ (promptModes)', kind: 'switch',
    meaning: 'วลีลายเซ็นชุดใหม่ใน VIRAL STYLE PACK ข้อ 3 (ถอด "ขอนับถือใจ…" เก็บ "ไม่แปลกใจเลยที่…/ใครจะคิดว่า…")',
    since: '20 ส.ค. 69 (R3 ข้อ 1)', rollback: 'STYLE_PACK_V2=0 = ข้อ 3 กลับเป็นไบต์เดิม',
  },
  {
    name: 'ENDING_MODE', default: 'truth', values: ['truth', 'plain'], readBy: [PROMPT_MODES], group: 'โหมดถ้อยคำ (promptModes)', kind: 'switch',
    meaning: 'ท่อนจบข่าว: truth = จบด้วยสัจธรรมที่ผูกกับเรื่อง · plain = จบบรรยายเรียบไม่ตีความ (ค่าขยะ = truth)',
    since: '20 ส.ค. 69 (R3 ข้อ 2)', rollback: 'ลบ env = truth · สลับเป็น plain ได้ตามที่เจ้าของสำรองไว้',
  },
  {
    name: 'WITNESS_FACTLOCK', default: '1', values: ['1', '0 (รับ 0/off/false/no)'], readBy: [PROMPT_MODES], group: 'โหมดถ้อยคำ (promptModes)', kind: 'switch',
    meaning: 'บทบาท "ผู้เห็นเหตุการณ์" + PROSE CRAFT ข้อ "ภาพ" ใช้ได้เฉพาะรายละเอียดที่ต้นฉบับมีจริง',
    since: '21 ส.ค. 69 (R3 ข้อ 3)', rollback: 'WITNESS_FACTLOCK=0 = ข้อความกลับเป็นไบต์เดิม',
  },

  // ── อำนาจการ์ด (cardAuthority — อ่านจากไฟล์นี้เท่านั้น) ──
  {
    name: 'CARD_AUTHORITY', default: '0', values: ['0', '1'], readBy: [CARD_AUTH], group: 'อำนาจการ์ด (cardAuthority)', kind: 'switch',
    meaning: 'สวิตช์แม่: =1 ปลดกฎบังคับทุกข้อ (R2-RXC) ให้การ์ดมีอำนาจเหนือกฎกลาง', since: '21 ส.ค. 69 (a56d011a)', rollback: 'ลบ env',
  },
  {
    name: 'CARD_AUTH_URL', default: '0', values: ['0', '1'], readBy: [CARD_AUTH], group: 'อำนาจการ์ด (cardAuthority)', kind: 'switch',
    meaning: 'ประตูเพิ่มสำหรับสาย URL: R2/R3 จะมีผลในสาย URL ต่อเมื่อเปิดตัวนี้ด้วย', since: '21 ส.ค. 69 (a56d011a)', rollback: 'ลบ env',
  },
  cardAuthRule('CARD_AUTH_R2', 'R2', 'ปลดกฎบังคับลำดับ timeline'),
  cardAuthRule('CARD_AUTH_R3', 'R3', 'ปลดกฎสาย URL ข้อ 3'),
  cardAuthRule('CARD_AUTH_R4', 'R4', 'ปลดคำสั่งเปิดย่อหน้าแรกด้วย hook ที่กำหนด'),
  cardAuthRule('CARD_AUTH_R5A', 'R5A', 'ปลดหัวประกาศอำนาจและเป้าอารมณ์ positive reframing'),
  cardAuthRule('CARD_AUTH_R5B', 'R5B', 'ปลดข้อบังคับเปลี่ยนมุมข่าวเสียชีวิต'),
  cardAuthRule('CARD_AUTH_R6', 'R6', 'ปลดกฎห้ามเปิดด้วยวันที่'),
  cardAuthRule('CARD_AUTH_R7', 'R7', 'ปลด VIRAL STYLE PACK ข้อบังคับเลือก hook'),
  cardAuthRule('CARD_AUTH_R8', 'R8', 'ปลด VIRAL STYLE PACK ข้อบังคับจบด้วยสัจธรรม'),
  cardAuthRule('CARD_AUTH_RXC', 'RXC', 'ปลดเฉพาะท่อนที่บังคับทุกองค์ประกอบให้รับใช้มุมเดียว'),

  // ── ด่านแก้ไข/ตรวจ (correction) ──
  {
    name: 'SKIP_CORRECTION', default: '0', values: ['0', '1 (รับ 1/true/on/yes)'], readBy: ['src/lib/correction/correctionPipeline.js'], group: 'ด่านแก้ไข/ตรวจ', kind: 'switch',
    meaning: 'ข้ามท่อแก้ไขทั้งหมด (correction pipeline) — ใช้เฉพาะดีบัก', since: '1 มิ.ย. 69 (ตัวอ่านทน on/true 1 ก.ย. 69)', rollback: 'ลบ env',
  },
  {
    name: 'FAB_GATE', default: '0', values: ['0', '1 (รับ 1/on/true/yes)'], readBy: ['src/lib/correction/fabricationGate.js'], group: 'ด่านแก้ไข/ตรวจ', kind: 'switch',
    meaning: 'ด่านจับ "แต่งเรื่องเกินต้นฉบับ" (fabrication gate) — ปิดอยู่เป็นค่าเริ่มต้น', since: '4 ส.ค. 69', rollback: 'ลบ env',
  },
  {
    name: 'FAB_GATE_FIX_MODEL', default: 'claude-opus-5', values: ['model id'], readBy: ['src/lib/correction/fabricationGate.js'], group: 'ด่านแก้ไข/ตรวจ', kind: 'value',
    meaning: 'โมเดลเย็บแผลของ fabrication gate', since: '15 ส.ค. 69', rollback: 'FAB_GATE_FIX_MODEL=claude-opus-4-8',
  },
  {
    name: 'CORRECTION_MIN_KEEP', default: '0.75', values: ['(0, 1]'], readBy: ['src/lib/correction/safeCorrectionService.js'], group: 'ด่านแก้ไข/ตรวจ', kind: 'value',
    meaning: 'สัดส่วนแก่นเรื่องขั้นต่ำที่ต้องคงไว้หลังแก้ไข (core guard) — นอกช่วง = ใช้ 0.75', since: '1 ส.ค. 69', rollback: 'ลบ env = 0.75',
  },
  {
    name: 'MISSING_FACTS_GATE', default: '1', values: ['0', '1'], readBy: [CORRECTION], group: 'ด่านแก้ไข/ตรวจ', kind: 'switch',
    meaning: 'L4.7 ด่านข้อเท็จจริงหาย — เทียบต้นฉบับดิบกับผลสุดท้ายแล้วเตือนใน _missingFacts (เตือนเท่านั้น ไม่แก้เนื้อ · fail-open) · runMissingFactsGate อ่าน === "0" = ค่าเริ่มต้นเปิด',
    since: '2 ก.ย. 69 (เคสศรราม "ห่วงเรื่องการขับรถ" หาย)', rollback: 'MISSING_FACTS_GATE=0 = ไม่ทำอะไร (ผลลัพธ์เหมือนเดิมทุกไบต์)',
  },
  {
    name: 'RAW_FACT_COMPLETENESS_GATE', default: '1', values: ['0', '1'], readBy: [RAW_GATE], group: 'ด่านแก้ไข/ตรวจ', kind: 'switch',
    meaning: 'ด่าน Sol ตรวจความครบของข้อเท็จจริงจากเนื้อดิบ (สาย TEXT เท่านั้น — autoFlowServiceText เรียก isRawFactCompletenessGateEnabled) · โค้ดอ่าน ?? "1" !== "0" = ค่าเริ่มต้นเปิด ⚠️ production ตั้ง =0 โดยเจตนา (สมุดสวิตช์ 24 ส.ค. 69: RAW_FACT=0)',
    since: '21 ส.ค. 69 (a56d011a)', rollback: 'RAW_FACT_COMPLETENESS_GATE=0 = ข้ามด่าน (log "ปิดด่าน Sol ตรวจ RAW ชั่วคราว")',
  },
  {
    name: 'VIRAL_SCORE_ANNOTATE', default: '0', values: ['0', '1'], readBy: [AUTO], group: 'ด่านแก้ไข/ตรวจ', kind: 'switch',
    meaning: '=1 แนบคะแนน "โอกาสปัง" ต่อฉบับใน version._viralScore ({score 0-100 เปอร์เซ็นไทล์, band, bandLabel สูง/กลาง/ต่ำ, predictedReactions, topDrivers, warnings, modelVersion}) หลังเนื้อสุดท้ายนิ่งทุกสาขา (หลัง correction/factual editor/length gate ก่อนประกอบ response) — ridge ในเครื่องจาก data/viral-score-model.json (Spearman 0.30) ไม่ยิง API · คำเตือนให้พนักงาน ไม่ใช่คำตัดสิน (บอทแสดง "🔥 โอกาสปัง: สูง (72/100)") · โมเดลไม่มี/คำนวณล้ม = ไม่แนบคีย์ ไม่ล้มท่อ ⚠️ บน Vercel ไฟล์โมเดลต้องอยู่ใน outputFileTracingIncludes (next.config.mjs — เพิ่มครบ 4 route แล้ว)',
    since: '2 ก.ย. 69 (เฟส 3)', rollback: 'ลบ env หรือ =0 = ไม่ import โมดูล ไม่มีคีย์ _viralScore (response เดิมทุกไบต์)',
  },

  // ── ความยาว / กฎถอย (legacyLengthRules) ──
  {
    name: 'LEGACY_LENGTH_RULES', default: '0', values: ['0', '1 (รับ 1/true/on/yes)'], readBy: ['src/lib/ai/legacyLengthRules.js'], group: 'ความยาว/กฎถอย', kind: 'switch',
    meaning: 'โหมดถอยกฎความยาวเดิม (89df00a) ทั้งชุด — ค่าเริ่มต้นคือกฎใหม่หลัง 17 ส.ค.', since: '17 ส.ค. 69', rollback: 'ลบ env',
  },
  {
    name: 'LENGTH_BY_CONTENT', default: '0', values: ['0', '1'], readBy: ['src/lib/ai/legacyLengthRules.js'], group: 'ความยาว/กฎถอย', kind: 'switch',
    meaning: 'ทางแยกความยาวตามเนื้อ — มีผลเฉพาะในโหมดถอย LEGACY_LENGTH_RULES=1 (เจ้าของเคาะถอยกลับ 1 ส.ค.)',
    since: '1 ส.ค. 69', rollback: 'ลบ env',
  },

  // ── คิวงาน (queueService / api/queue) ──
  {
    name: 'TEXT_ONLY_MODE', default: '1', values: ['0', '1'], readBy: [QUEUE_ADD, PROCESS, AUTO_ROUTE, STREAM_ROUTE], group: 'คิวงาน', kind: 'switch',
    meaning: 'รับเฉพาะข้อความล้วน ปิดสายเจนข่าวจาก URL/รูป (งานปก/mineclip ไม่กระทบ) — ด่านหลักที่ queue/add · process และประตูเก่า /api/auto + /api/auto/stream (@deprecated) อ่านซ้ำ', since: '16 ก.ค. 69', rollback: 'TEXT_ONLY_MODE=0 ชั่วคราว (ห้ามลบโค้ดสาย URL)',
  },
  {
    name: 'ALLOW_LEGACY_AUTO', default: '0', values: ['0', '1'], readBy: [AUTO_ROUTE], group: 'คิวงาน', kind: 'switch',
    meaning: '=1 ปลดล็อกประตูเก่า /api/auto (สาย URL → summarizeService) ที่ถูกปิดด้วย 410 — ทีมจริงใช้ /api/queue/add → worker → /api/auto/process (สาย TEXT)',
    since: '16 ส.ค. 69', rollback: 'ลบ env = ประตูปิด (พฤติกรรมปัจจุบัน)',
  },
  {
    name: 'QUEUE_ATOMIC_CLAIM', default: '1', values: ['0', '1'], readBy: [QUEUE], group: 'คิวงาน', kind: 'switch',
    meaning: 'คว้างานแบบ conditional update (pending→processing เฉพาะที่ยัง pending) กัน 2 worker คว้างานเดียวกัน',
    since: '25 มิ.ย. 69', rollback: 'QUEUE_ATOMIC_CLAIM=0 (ไม่แนะนำ — เสี่ยงงานซ้ำ)',
  },
  {
    name: 'QUEUE_LOCAL_NEWS', default: '0', values: ['0', '1'], readBy: [QUEUE], group: 'คิวงาน', kind: 'switch',
    meaning: 'ทางหนีไฟ: =1 ยอมให้เครื่องทีม (Windows) คว้างานข่าว (ปกติงานข่าวเป็นของ Vercel)', since: '12 มิ.ย. 69', rollback: 'ลบ env',
  },
  {
    name: 'QUEUE_COVER_ON_VERCEL', default: '0', values: ['0', '1'], readBy: [QUEUE], group: 'คิวงาน', kind: 'switch',
    meaning: '=1 ยอมให้ Vercel ทำงานปก (ปกติงานปกทุกใบไปเครื่องทีม)', since: '27 มิ.ย. 69', rollback: 'ลบ env',
  },
  {
    name: 'QUEUE_NEWS_DEADLINE_MS', default: '770000', values: ['71000-770000 (นอกช่วง = 770000)'], readBy: [WORKER], group: 'คิวงาน', kind: 'value',
    meaning: 'เพดานเวลา worker รอ route ข่าว (งบท่อ = ค่านี้ − 70 วิ ไม่เกิน 700 วิ)', since: '15 ส.ค. 69', rollback: 'ลบ env = 770000',
  },
  {
    name: 'QUEUE_FETCH_LONG_AGENT', default: '1', values: ['0', '1'], readBy: [WORKER], group: 'คิวงาน', kind: 'switch',
    meaning: 'ส่ง undici Agent ยืด headersTimeout ให้ fetch งานข่าว (แก้ "fetch failed" ปลอมที่ 300 วิ)', since: '15 ส.ค. 69', rollback: 'QUEUE_FETCH_LONG_AGENT=0',
  },
  {
    name: 'QUEUE_TIMEOUT_RESCUE', default: '', values: ['', 'cover-only', 'off'], readBy: [WORKER], group: 'คิวงาน', kind: 'switch',
    meaning: 'ตาข่ายงานที่ fetch ตายแต่ route อาจยังวิ่ง: ว่าง = ทุกงาน · cover-only = เฉพาะงานปก (เดิม) · off = ปิด',
    since: '16 ส.ค. 69', rollback: 'QUEUE_TIMEOUT_RESCUE=cover-only',
  },
  {
    name: 'PORT', default: '3000', values: ['หมายเลขพอร์ต'], readBy: [QUEUE], group: 'แพลตฟอร์ม', kind: 'platform',
    meaning: 'พอร์ตเซิร์ฟเวอร์ที่ watchdog คิวใช้ปลุก /api/queue/worker ในเครื่อง (ค่าจาก Next/ระบบ)', since: '1 มิ.ย. 69', rollback: '— (ค่าแพลตฟอร์ม)',
  },

  // ── โมเดล / ไคลเอนต์ AI ──
  {
    name: 'MODEL_BREAKDOWN', default: 'gpt-5.6-sol', values: ['model id'], readBy: ['src/lib/ai/modelConfig.js'], group: 'โมเดล/ไคลเอนต์ AI', kind: 'value',
    meaning: 'โมเดลขั้น Breakdown (แตกประเด็น) — สลับชั่วคราวได้โดยไม่กระทบโมเดลอื่น', since: '16 ก.ค. 69 (เคาะ sol 21 ส.ค. 69)', rollback: 'ลบ env = gpt-5.6-sol',
  },
  {
    name: 'MODEL_BLUEPRINT', default: 'gpt-5.6-sol', values: ['model id'], readBy: ['src/lib/ai/modelConfig.js'], group: 'โมเดล/ไคลเอนต์ AI', kind: 'value',
    meaning: 'โมเดลขั้น 3 Blueprint (วางโครงอารมณ์)', since: '15 ส.ค. 69', rollback: 'MODEL_BLUEPRINT=gpt-5.6-luna',
  },
  {
    name: 'CLAUDE_WRITE_MODEL', default: 'claude-opus-4-8', values: ['model id'], readBy: [CLAUDE], group: 'โมเดล/ไคลเอนต์ AI', kind: 'value',
    meaning: 'โมเดลเริ่มต้นของ claudeClient (DEFAULT_WRITE_MODEL = env || "claude-opus-4-8") — สาย claude-write ใน aiRouter ถูกล็อกในโค้ดที่ opus-4-8 (ค่านี้ไม่ทับ) · ทะเบียนเดิมบอกค่าเริ่มต้น "" ผิดจากโค้ด (เทสค่าเริ่มต้นจับได้ 2 ก.ย. 69 รอบยืนยัน)', since: '10 มิ.ย. 69 (เคาะ opus-4-8 4 ส.ค. 69)', rollback: 'ลบ env = claude-opus-4-8 · CLAUDE_WRITE_MODEL=claude-opus-5 = ก่อน 4 ส.ค.',
  },
  {
    name: 'CLAUDE_WRITE_EFFORT', default: 'medium', values: ['low', 'medium', 'high'], readBy: [CLAUDE], group: 'โมเดล/ไคลเอนต์ AI', kind: 'value',
    meaning: 'ระดับคิดเริ่มต้นของ Claude เมื่อผู้เรียกไม่ระบุ effort', since: '10 มิ.ย. 69', rollback: 'ลบ env = medium',
  },
  {
    name: 'LOG_FULL_PROMPT', default: '0', values: ['0', '1'], readBy: [CLAUDE, OPENAI, GEMINI], group: 'โมเดล/ไคลเอนต์ AI', kind: 'switch',
    meaning: '=1 เก็บ log พรอมต์เต็ม 100% (เจ้าของสั่ง 18 ส.ค.) · ไม่ตั้ง = ตัดพรีวิวเท่าเดิม — อ่านทั้ง 3 ไคลเอนต์ claude/openai/gemini', since: '18 ส.ค. 69', rollback: 'ลบ env',
  },
  {
    name: 'WRITER_MODEL_LAB', default: '', values: ['model id (ว่าง = claude-opus-4-8)'], readBy: ['src/lib/ai/aiRouter.js'], group: 'โมเดล/ไคลเอนต์ AI', kind: 'value',
    meaning: 'ห้องทดลองสลับนักเขียน — ตั้งเฉพาะสนามเทสในเครื่อง production ไม่ตั้ง (ยังล็อก opus-4-8)', since: '2 ก.ย. 69', rollback: 'ลบ env',
  },

  // ── เครื่องมือกลาง (utils) ──
  {
    name: 'WITHTIMEOUT_ABORT', default: '0', values: ['0', '1'], readBy: ['src/lib/utils/withTimeout.js'], group: 'เครื่องมือกลาง', kind: 'switch',
    meaning: '=1 บังคับสร้าง AbortController ใน withTimeout แม้ไม่มี pipeline deadline/parent signal', since: '16 ก.ค. 69', rollback: 'ลบ env',
  },
  {
    name: 'NEWS_RESEARCH', default: '0', values: ['0', '1 (รับ 1/on/true/yes)'], readBy: ['src/lib/utils/researchSwitch.js'], group: 'เครื่องมือกลาง', kind: 'switch',
    meaning: 'เปิดค้นข้อมูลเสริมจากเน็ต (Serper/Tavily/ปุ่มหน้าเว็บ) — ค่าเริ่มต้นปิดในโค้ดตามคำสั่งเจ้าของ', since: '16 ส.ค. 69', rollback: 'ลบ env = ปิด',
  },

  // ── สวิตช์ใหม่เฟส 2 ก.ย. 69 ของเพื่อนร่วมทีม (viralFewshot.js — อ่าน !== '0' = ค่าเริ่มต้นเปิด · ยืนยันจากโค้ดใน worktree แล้ว) ──
  //   ANGLE2_DISTINCT_V2 / MISSING_FACTS_GATE ยืนยันจากโค้ดจริงแล้วเช่นกัน — ย้ายไปอยู่หมวดของตัวเอง (มุมข่าว / ด่านแก้ไข)
  {
    name: 'TEACHER_RANK_V2', default: '1', values: ['0', '1'], readBy: [FEWSHOT], group: 'ครูตัวอย่างไวรัล', kind: 'switch',
    meaning: 'กติกาหยิบครูใหม่ rank-v2 (แมตช์ก่อน แล้วยอดสูงนำ — src/lib/services/teacherRank.js) · =0 คืน weightedSample เดิมทุกไบต์',
    since: '2 ก.ย. 69', rollback: 'TEACHER_RANK_V2=0',
  },
  {
    name: 'LIB_CLASSIFIER_V2', default: '1', values: ['0', '1'], readBy: [FEWSHOT], group: 'ครูตัวอย่างไวรัล', kind: 'switch',
    meaning: 'แมปหมวดคลังครูจากช่อง breakdown (resolveLibraryCategory) แทนคีย์เวิร์ดอย่างเดียว · =0 คืน pickLibraryCategory เดิม',
    since: '2 ก.ย. 69', rollback: 'LIB_CLASSIFIER_V2=0',
  },

  // ── เพดานเนื้อข่าว (newsCap.js — ★ 2 ก.ย. 69 รอบยืนยัน ข้อ 1 · อ่านผ่าน newsForStage · ค่าเริ่มต้นทุกด่าน 0 = ไม่จำกัด) ──
  //   CARD_PICK_NEWS_CHARS / WRITER_SOURCE_CHARS ก็อยู่ในตารางนี้ด้วย — ลงทะเบียนไว้ในหมวดนักเขียนแล้ว (readBy รวม newsCap)
  newsCapRule('NEWS_CAP_DNA', 'DNA', 1500, 'ตั้งป้ายหมวด/อารมณ์ (ป้ายถูกใช้ต่อทั้งการให้คะแนนการ์ดและครู)'),
  newsCapRule('NEWS_CAP_CATALOG', 'CATALOG', 2000, 'คัดสารบัญการ์ดทั้งคลังเหลือผู้เข้ารอบ'),
  newsCapRule('NEWS_CAP_BLUEPRINT', 'BLUEPRINT', 2500, 'วางโครงอารมณ์ (Blueprint)'),
  newsCapRule('NEWS_CAP_RESEARCH', 'RESEARCH', 2000, 'สกัดคีย์เวิร์ดไปค้นข้อมูลเสริม'),
  newsCapRule('NEWS_CAP_FORMAL', 'FORMAL', 1500, 'ตรวจว่าเป็นข่าวราชพิธี/ทางการหรือไม่'),
  newsCapRule('NEWS_CAP_VIRAL_MATCH', 'VIRAL_MATCH', 900, 'ตัวจับคู่ครูไวรัล (ทำงานเมื่อ VIRAL_MATCH_MODE=ai)'),

  // ── บอทดิสคอร์ด (discord-bot/index.js — ไม่ใช่ท่อข่าว ไม่อยู่ในชุดสแกน · ลงทะเบียนเพราะเป็น env ที่เจ้าของอาจต้องปิดคืน) ──
  {
    name: 'BOT_RESUME_TRACKING', default: '1', values: ['0', '1'], readBy: [BOT], group: 'บอทดิสคอร์ด (discord-bot)', kind: 'switch',
    meaning: 'บอทจำงานที่กำลังตามอยู่ไว้ที่เซิร์ฟเวอร์ (/api/bot/tracking) — Railway redeploy/รีสตาร์ตแล้วบอทตัวใหม่ตามงานต่อเอง ไม่ค้าง "1%" · envFlag รับเฉพาะ "0"/"1" ตรงตัว ค่าอื่น = ค่าเริ่มต้นเปิด',
    since: '2 ก.ย. 69 (เคสหลวงปู่ศิลา 03:49Z)', rollback: 'BOT_RESUME_TRACKING=0 = บอททำงานเหมือนเดิมทุกไบต์ (ต้อง redeploy บอทบน Railway)',
  },
  {
    name: 'BOT_REVIEW_REACTIONS', default: '1', values: ['0', '1'], readBy: [BOT], group: 'บอทดิสคอร์ด (discord-bot)', kind: 'switch',
    meaning: 'บอทใส่ reaction 👍 ผ่าน / 👎 ไม่ผ่าน / 📌 ใช้แล้ว ใต้ผลข่าว แล้วบันทึกสถานะเข้า PATCH /api/generation-logs/[caseId] + โชว์บรรทัดเตือน (ข้อเท็จจริงหาย/ความคล้าย/โอกาสปัง) — ข้อ 6 แผนยกระดับ',
    since: '2 ก.ย. 69 (เฟส 3)', rollback: 'BOT_REVIEW_REACTIONS=0 = ไม่ใส่ reaction ไม่ฟังการกด ไม่แสดงบรรทัดเตือน (ข้อความผลเหมือนเดิม)',
  },
]);

/** หาสวิตช์ตามชื่อ — คืน undefined ถ้าไม่มีในทะเบียน */
export function findSwitch(name) {
  return NEWS_SWITCHES.find(entry => entry.name === name);
}

/** ชื่อทั้งหมดในทะเบียน (Set) */
export function registeredNames() {
  return new Set(NEWS_SWITCHES.map(entry => entry.name));
}
