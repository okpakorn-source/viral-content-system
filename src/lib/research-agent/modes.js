// ============================================================
// 🔎 src/lib/research-agent/modes.js — สวิตช์และค่าตั้งของ Research Agent v2 ฝั่งเว็บ (เลน B · 1 ต.ค. 69)
// ------------------------------------------------------------
// อ่าน env RESEARCH_AGENT* ที่ไฟล์นี้ที่เดียว (สเปก C:\tmp\research-agent-lab\SPEC-v2.md ส่วน 2.5 / 3)
//   · RESEARCH_AGENT=1 เท่านั้นที่เปิด — ไม่ตั้ง / ว่าง / ค่าอื่น = ปิด = พฤติกรรมเดิมทุกไบต์ (คิว/ท่อ/บันทึก)
//   · RESEARCH_AGENT_MODE = shadow | assist | write (ค่าอื่น/ไม่ตั้ง = shadow) — write ในเฟส 1 ท่อข่าวทำแบบ assist
//     (นักเขียน/ด่านไม่ได้รับการ์ดจนกว่าเจ้าของอนุมัติไฟล์ล็อกในเฟส write — ข้อ 24)
//     ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3): เจ้าของเคาะเปิด write แล้ว — สายข้อความ: รอการ์ดหลังสกัด → บรรณาธิการ
//       เรียบเรียงฉบับเสริม → ใช้แทนต้นฉบับ (src/lib/research-agent/writeStage.js) · สาย URL/คลิปยังทำแบบ assist
//   · RESEARCH_AGENT_WAIT_MS = เวลาที่ท่อยอมรอการ์ด นับจากเริ่มช่อง PRE-GENERATE · shadow = 0 เสมอ (ท่อไม่รอ แม้ตั้งค่าไว้)
//     assist/write ไม่ตั้ง = 90000 · เพดาน 180000 (กันตั้งผิดจนกินงบ generate — ข้อ 4)
//     ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3): write เปลี่ยนเป็นรอ "หลังขั้นสกัด" นับจากเริ่มท่อ · ไม่ตั้ง = 300000 ·
//       เพดาน 300000 (ข้อตัดสิน #1) — บรรทัดบน (90000/180000) เหลือใช้กับ assist เท่านั้น · เส้นตายรวม (กันชน 480s) ยังตัดก่อนเสมอ
//   · RESEARCH_AGENT_DEADLINE_MIN (ค่าเริ่มต้น 15 · บีบเข้า 1–120) = เส้นตายใบขอ: deadlineAt = createdAt + นาที×60s
//     ★ ข้อตัดสินผู้คุมงาน 1 ต.ค. 69 (แทนสูตรสัญญา 2.1 เดิม "MAX_MINUTES×60s + 60s" = 7 นาที): เจ้าของบอกงานเข้า
//     30–40 ข่าว/วัน (08:00–22:00) เป็นจังหวะไม่ตายตัว · worker รับขนานได้ RESEARCH_AGENT_CONCURRENCY (ค่าเริ่มต้น 2)
//     → ใบที่ต่อคิวช่วงข่าวเข้าถี่ต้องมีเวลารอ worker ว่าง ไม่หมดอายุก่อนถูกหยิบ
//   · RESEARCH_AGENT_SECRET = กุญแจ header x-research-secret ของ worker · ไม่ตั้ง = ปิดประตู route ของ worker (fail-closed)
//   · ค่าอื่น (MAX_CALLS/MAX_MINUTES/EFFORT/ALLOW_MEDIUM/TOOLS/BRAIN/TOOL_BUDGET/CONCURRENCY/STALE_DAYS) เป็นของ worker (เลน A)
//     เฟส 1 ตั้งที่เครื่อง worker เท่านั้น — ฝั่งเว็บไม่อ่านและไม่ส่งต่อ (lease ไม่มี limits แล้ว · ข้อตัดสิน 1 ต.ค. 69:
//     กันเข้าใจผิดว่าตั้งบน Vercel แล้วมีผลกับ worker)
// ห้ามพิมพ์ค่า secret ที่ไหนเลย — ไฟล์นี้คืนแค่ boolean ว่าตั้งแล้วหรือยัง (getResearchAgentConfig)
// ============================================================

export const RESEARCH_AGENT_MODES = Object.freeze(['shadow', 'assist', 'write']);
/** เส้นตายใบขอค้นคว้า นับจาก createdAt (นาที) — ข้อตัดสินผู้คุมงาน 1 ต.ค. 69 */
export const RESEARCH_AGENT_DEFAULT_DEADLINE_MIN = 15;
export const RESEARCH_AGENT_DEADLINE_MAX_MIN = 120;
export const RESEARCH_AGENT_ASSIST_DEFAULT_WAIT_MS = 90_000;
export const RESEARCH_AGENT_WAIT_MAX_MS = 180_000;
// ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3): โหมด write รอการ์ด "หลังขั้นสกัด" ได้ ≤ 5 นาที นับจากเริ่มท่อ (ข้อตัดสิน #1)
//   ค่าเริ่มต้น + เพดานของ write เท่านั้น — assist คง 90000/180000 เดิมทุกไบต์ · เส้นตายรวมของท่อยังตัดก่อนเสมอ (readCards.waitResearchCards)
export const RESEARCH_AGENT_WRITE_DEFAULT_WAIT_MS = 300_000;
export const RESEARCH_AGENT_WRITE_WAIT_MAX_MS = 300_000;
export const RESEARCH_AGENT_DEFAULT_QUOTA_ALERT_PCT = 15;
/** ไม่มีชีพจร worker นานกว่านี้ = ออฟไลน์ (สเปกส่วน 8 แผนสำรองข้อ 3) */
export const RESEARCH_AGENT_OFFLINE_AFTER_MS = 10 * 60 * 1000;

const cleanEnv = (raw) => String(raw ?? '').trim().replace(/^["']|["']$/g, '').trim();

function boundedInt(raw, fallback, min, max) {
  const value = cleanEnv(raw);
  if (value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** สวิตช์หลัก: เปิดเมื่อ RESEARCH_AGENT=1 เท่านั้น */
export function isResearchAgentOn(env = process.env) {
  return cleanEnv(env?.RESEARCH_AGENT) === '1';
}

/** shadow | assist | write (ไม่ตั้ง/ค่าแปลก = shadow — ค่าที่ปลอดภัยที่สุด) */
export function getResearchAgentMode(env = process.env) {
  const value = cleanEnv(env?.RESEARCH_AGENT_MODE).toLowerCase();
  return RESEARCH_AGENT_MODES.includes(value) ? value : 'shadow';
}

/** เวลาที่ท่อยอมรอการ์ด (ms) — shadow = 0 เสมอ · assist นับจากเริ่มช่อง PRE-GENERATE · write นับจากเริ่มท่อ (รอหลังขั้นสกัด) */
export function getResearchAgentWaitMs(env = process.env, mode = getResearchAgentMode(env)) {
  if (mode === 'shadow') return 0;
  // ★ 1 ต.ค. 69 (Research Agent v2 โหมด write · SPEC-v3): write = ค่าเริ่มต้น 300000 · เพดาน 300000 (ข้อตัดสิน #1)
  //   ของเดิม: บรรทัด return ด้านล่างใช้กับทั้ง assist และ write (write ในเฟส 1 = แบบ assist) — assist ยังได้บรรทัดเดิมทุกไบต์
  if (mode === 'write') {
    return boundedInt(env?.RESEARCH_AGENT_WAIT_MS, RESEARCH_AGENT_WRITE_DEFAULT_WAIT_MS, 0, RESEARCH_AGENT_WRITE_WAIT_MAX_MS);
  }
  return boundedInt(env?.RESEARCH_AGENT_WAIT_MS, RESEARCH_AGENT_ASSIST_DEFAULT_WAIT_MS, 0, RESEARCH_AGENT_WAIT_MAX_MS);
}

/** เส้นตายใบขอ (นาที) = RESEARCH_AGENT_DEADLINE_MIN · ไม่ตั้ง/อ่านไม่ได้ = 15 · บีบเข้า 1–120 */
export function getResearchAgentDeadlineMin(env = process.env) {
  return boundedInt(env?.RESEARCH_AGENT_DEADLINE_MIN, RESEARCH_AGENT_DEFAULT_DEADLINE_MIN, 1, RESEARCH_AGENT_DEADLINE_MAX_MIN);
}

/** % โควตาที่เหลือซึ่งต้องเตือนเจ้าของ (ข้อ 16 = 15%) */
export function getResearchAgentQuotaAlertPct(env = process.env) {
  return boundedInt(env?.RESEARCH_AGENT_QUOTA_ALERT_PCT, RESEARCH_AGENT_DEFAULT_QUOTA_ALERT_PCT, 0, 100);
}

/** กุญแจของ worker (trim แล้ว) · '' = ไม่ได้ตั้ง — ผู้เรียกต้องปิดประตู ห้าม log ค่านี้ */
export function getResearchAgentSecret(env = process.env) {
  return typeof env?.RESEARCH_AGENT_SECRET === 'string' ? env.RESEARCH_AGENT_SECRET.trim() : '';
}

/** สรุปสถานะสวิตช์ (ไม่มีค่า secret — มีแค่ว่าตั้งแล้วหรือยัง) */
export function getResearchAgentConfig(env = process.env) {
  const mode = getResearchAgentMode(env);
  return {
    enabled: isResearchAgentOn(env),
    mode,
    waitMs: getResearchAgentWaitMs(env, mode),
    deadlineMin: getResearchAgentDeadlineMin(env),
    quotaAlertPct: getResearchAgentQuotaAlertPct(env),
    secretConfigured: getResearchAgentSecret(env) !== '',
  };
}
