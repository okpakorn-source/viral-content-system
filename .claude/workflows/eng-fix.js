// ทีมวิศวกรรมแก้ปัญหา — 2 โซน:
//   company (default): แก้ระบบบริษัท AI เองได้เลย (deploy รออนุมัติ)
//   newsdesk-prod: แตะระบบข่าวจริงได้ (ปลดล็อก 21 ก.ค.) แต่ propose-only จนกว่าเจ้าของ apply
// เบรกความปลอดภัย: ไฟล์หัวใจ 4 ตัวห้ามแตะเด็ดขาด · production ต้อง diagnose→propose→approve→apply→test→review→deploy(gated)
export const meta = {
  name: 'eng-fix',
  description: 'ทีมวิศวะแก้ปัญหา: อาร์ควินิจฉัย→(เสนอ/แก้)→คิวเทส→เรฟรีวิว→รายงาน (prod=gated ทุกขั้น)',
  phases: [
    { title: 'วินิจฉัย', detail: 'อาร์ค (Opus) หารากปัญหา+วางแผน', model: 'opus' },
    { title: 'ลงมือ', detail: 'เสนอแผน (prod) หรือ แก้จริง (company/approved)' },
    { title: 'เทส/รีวิว', detail: 'คิวเทส + เรฟรีวิวอิสระ' },
    { title: 'รายงาน', detail: 'อาร์ค ตรวจรับ+สรุป', model: 'opus' },
  ],
}

const A = typeof args === 'string' ? JSON.parse(args) : args
if (!A || !A.problem) throw new Error('ต้องส่ง {problem, target?, apply?, runId?}')
const PROBLEM = String(A.problem)
const TARGET = A.target === 'newsdesk-prod' ? 'newsdesk-prod' : 'company'
const APPLY = A.apply === true                 // prod: ต้อง apply:true (เจ้าของอนุมัติแผนแล้ว) ถึงจะแก้จริง
function sanitizeRunId(r) { return String(r || 'fix').replace(/\.\./g, '').replace(/[^a-zA-Z0-9_\-]/g, '_') || 'fix' }
const RUN = sanitizeRunId(A.runId)
const EDIR = 'public/company/departments/engineering'
const CODEX = 'C:/Users/User/AppData/Local/OpenAI/Codex/bin/5dee10576ec7a5b8/codex.exe'
const PLAN_PATH = EDIR + '/fixes/' + RUN + '.plan.json'

// P0-04(a): กันงานแตะไฟล์หัวใจ/นอกเขตที่ระดับโค้ด (ไม่พึ่งวินัย prompt อย่างเดียว)
const ALLOWED_PREFIXES = ['src/', 'public/company/', '.claude/workflows/']
function guardPlan(plan) {
  const kept = []
  for (const p of (plan || [])) {
    const files = p.files || []
    const bad = files.filter(f => {
      const norm = String(f).replace(/\\/g, '/')
      const hitsCritical = CRITICAL.split(', ').some(c => norm.includes(c))
      const outOfZone = !ALLOWED_PREFIXES.some(pre => norm.startsWith(pre))
      return hitsCritical || outOfZone
    })
    if (bad.length) { log('⛔ ตัดงาน ' + p.handle + ' — แตะไฟล์หัวใจ/นอกเขต: ' + bad.join(', ')); continue }
    kept.push(p)
  }
  return kept
}

// ไฟล์หัวใจห้ามแตะเด็ดขาด (ทุกโซน) — แก้ต้องเจ้าของสั่งตรงเป็นเคสพิเศษเท่านั้น
const CRITICAL = 'src/lib/ai/openai.js, src/lib/ai/aiRouter.js, src/lib/ai/claudeClient.js, prisma/schema.prisma, scripts/validate-workflow.mjs'
const ZONE = TARGET === 'newsdesk-prod'
  ? 'โซน: ระบบข่าวจริง /news-desk (production — ปลดล็อกแล้ว แต่ระวังสูงสุด). แก้ได้: src/app/**, src/lib/services/**, src/app/api/desk/** และโค้ดที่เกี่ยวข้องโดยตรง. ' +
    '🔴 ห้ามแตะเด็ดขาด (ไฟล์หัวใจ): ' + CRITICAL + ' — เจอรากปัญหาที่นี่ให้รายงานเฉย ๆ. ' +
    'ยึด SYSTEM_SAFETY_RULES: แก้น้อยที่สุด · isolated · รักษา backward-compat (ห้ามเปลี่ยน function name/response/schema/API contract) · ทุก flow มี fallback · ห้าม refactor แถม.'
  : 'โซน: ระบบบริษัท AI เอง. แก้ได้: public/company/** และ .claude/workflows/newsdesk-*.js, company-*.js, eng-fix.js. 🔴ห้ามแตะระบบข่าวจริง/ท่อผลิตในโซนนี้.'

// ---- เฟส 1: วินิจฉัย (อ่านอย่างเดียว) ----
phase('วินิจฉัย')
const diag = await agent(
  'คุณคือ "อาร์ค" หัวหน้าวิศวกร/สถาปนิก ทีมวิศวกรรม Fable & Co. หารากปัญหาก่อนแก้ ไม่รีบ.\n' +
  'ปัญหาที่แจ้ง: "' + PROBLEM + '"\n' + ZONE + '\n' +
  'อ่านไฟล์ที่เกี่ยวข้อง (read-only, scoped — ห้าม scan ทั้ง repo) หารากปัญหา แล้วตอบ structured: ' +
  'rootCause, inScope(true ถ้าแก้ได้ในขอบเขต / false ถ้ารากอยู่ที่ไฟล์หัวใจหรือนอกเขต), risk(low/medium/high), ' +
  'plan[{handle(beck/fon/zip), task, files}] (backend/workflow/server→beck, จอ/UI→fon, จุดเล็ก→zip), ' +
  'impact(ผลกระทบถ้าแก้ — อะไรอาจพังตาม). อย่าเพิ่งแก้ แค่วินิจฉัย+วางแผน.',
  { label: 'วินิจฉัย:arch', phase: 'วินิจฉัย', model: 'opus', effort: 'high',
    schema: { type: 'object', properties: {
      rootCause: { type: 'string' }, inScope: { type: 'boolean' }, risk: { type: 'string', enum: ['low', 'medium', 'high'] },
      impact: { type: 'string' },
      plan: { type: 'array', items: { type: 'object', properties: {
        handle: { type: 'string', enum: ['beck', 'fon', 'zip'] }, task: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['handle', 'task', 'files'] } } },
      required: ['rootCause', 'inScope', 'risk', 'impact', 'plan'] } })

if (!diag) return { runId: RUN, note: 'วินิจฉัยล้มเหลว' }
log('ราก: ' + String(diag.rootCause).slice(0, 70) + ' | inScope=' + diag.inScope + ' risk=' + diag.risk)

// P0-04(a): กรองแผนที่ระดับโค้ดก่อนใช้งานต่อ (ไม่ไว้ใจ prompt อย่างเดียว)
const rawPlanCount = (diag.plan || []).length
diag.plan = guardPlan(diag.plan)
if (rawPlanCount && !diag.plan.length) {
  await writeReport('บล็อก — งานทั้งหมดแตะไฟล์หัวใจ/นอกเขต', 'guard ตัดงานทุกจุดออกหลังกรอง (ดู log ⛔ ด้านบน) — ไม่แก้')
  return { runId: RUN, target: TARGET, mode: 'blocked', rootCause: diag.rootCause, note: '⛔ ทุกจุดในแผนแตะไฟล์หัวใจ/นอกเขต — guard ตัดออกหมด ไม่แก้ ดูรายงาน' }
}

// เขียนใบวินิจฉัย/แผนเสมอ (บันทึกทุกอย่าง)
async function writeReport(status, extra) {
  await agent('คุณคือ "อาร์ค". เขียนบันทึกเคสลง ' + EDIR + '/fixes/' + RUN + '.md (UTF-8 สร้าง/ต่อท้าย):\n' +
    'เป้าหมาย: ' + TARGET + ' | สถานะ: ' + status + '\nปัญหา: ' + PROBLEM + '\nรากปัญหา: ' + diag.rootCause + '\nผลกระทบ: ' + diag.impact + '\nแผน: ' + JSON.stringify(diag.plan).slice(0, 500) + '\n' + (extra || '') +
    '\nโครง: ปัญหา/รากปัญหา/ผลกระทบ/แผนแก้/สถานะ/ขั้นต่อไป. append 1 บรรทัดลง ' + EDIR + '/worklog.md. ห้ามแตะไฟล์อื่น. ตอบสั้น.',
    { label: 'บันทึก:arch', phase: 'รายงาน', model: 'haiku', effort: 'low' })
}

// ---- prod + ยังไม่อนุมัติ → เสนอแผนแล้วหยุด (ห้ามแก้ production โดยไม่อนุมัติ) ----
if (TARGET === 'newsdesk-prod' && !APPLY) {
  phase('ลงมือ')
  log('🔒 โหมดเสนอแผน (ยังไม่แตะ production) — รอเจ้าของอนุมัติ')
  // P0-04(b): เขียนแผนลงไฟล์ (หลักฐานอนุมัติ) ให้รอบ apply:true มาอ่านยืนยัน
  await agent('เขียนไฟล์ ' + PLAN_PATH + ' (UTF-8, สร้างโฟลเดอร์ถ้าไม่มี, เขียนทับได้) ด้วยเนื้อหา JSON ต่อไปนี้เป๊ะ ๆ ห้ามแก้/ห้ามเพิ่ม:\n' +
    JSON.stringify(diag) + '\nห้ามแตะไฟล์อื่น ตอบสั้น: เขียนสำเร็จหรือไม่',
    { label: 'บันทึกแผน:arch', phase: 'ลงมือ', model: 'haiku', effort: 'low' })
  await writeReport('เสนอแผน รออนุมัติ', 'หมายเหตุ: production — ยังไม่แก้ รอเจ้าของสั่ง apply · แผนบันทึกที่ ' + PLAN_PATH)
  return {
    runId: RUN, target: TARGET, mode: 'proposal', inScope: diag.inScope,
    rootCause: diag.rootCause, risk: diag.risk, impact: diag.impact,
    plan: diag.plan, reportPath: EDIR + '/fixes/' + RUN + '.md', planPath: PLAN_PATH,
    note: '🔒 ยังไม่แตะ /news-desk — ตรวจแผน+ผลกระทบ แล้วสั่ง apply (รัน eng-fix ซ้ำด้วย {target:"newsdesk-prod", apply:true, runId:"' + RUN + '"}) เพื่อลงมือจริง',
  }
}
// P0-04(c): apply:true บน prod ต้องมีไฟล์แผนที่อนุมัติไว้แล้วเท่านั้น — ไม่มีไฟล์ = ปฏิเสธ
if (TARGET === 'newsdesk-prod' && APPLY) {
  phase('ลงมือ')
  const planCheck = await agent('อ่านไฟล์ ' + PLAN_PATH + ' ถ้ามีอยู่จริง คืน found=true พร้อม content=เนื้อหาไฟล์ทั้งหมด (raw string). ถ้าไม่มีไฟล์ คืน found=false เฉย ๆ ห้ามสร้างไฟล์ใหม่ ห้ามเดา.',
    { label: 'ตรวจแผนอนุมัติ:arch', phase: 'ลงมือ', model: 'haiku', effort: 'low',
      schema: { type: 'object', properties: { found: { type: 'boolean' }, content: { type: 'string' } }, required: ['found'] } })
  if (!planCheck || !planCheck.found) {
    log('⛔ ไม่พบไฟล์แผนอนุมัติที่ ' + PLAN_PATH + ' — ปฏิเสธ ไม่แก้ production')
    await writeReport('บล็อก — ไม่พบไฟล์แผนอนุมัติ', 'apply:true แต่ไม่มี ' + PLAN_PATH + ' (ต้องรันโหมดเสนอแผนก่อนเพื่อสร้างไฟล์นี้) — ไม่แก้')
    return { runId: RUN, target: TARGET, mode: 'blocked', note: '⛔ ไม่พบไฟล์แผนอนุมัติ ' + PLAN_PATH + ' — ต้องรันโหมดเสนอแผน (apply ไม่ระบุ/false) ก่อน เพื่อสร้างหลักฐานแผน แล้วค่อย apply:true' }
  }
}
if (!diag.inScope || !diag.plan.length) {
  await writeReport('นอกขอบเขต/ไม่มีแผน', 'รากปัญหาอยู่นอกเขตที่แก้ได้ (อาจเป็นไฟล์หัวใจ) — ไม่แก้')
  return { runId: RUN, target: TARGET, mode: 'blocked', rootCause: diag.rootCause, note: 'รากปัญหาอยู่นอกขอบเขต/ไฟล์หัวใจ — ไม่แก้ ดูรายงาน' }
}

// ---- เฟส 2: แก้จริง (company เสมอ / prod เมื่อ apply=true) ----
phase('ลงมือ')
log('🔧 ลงมือแก้ ' + diag.plan.length + ' จุด (' + TARGET + ')')
const EMP = { beck: { name: 'เบค', model: 'sonnet' }, fon: { name: 'ฝน', model: 'sonnet' }, zip: { name: 'ซิป', codex: 'gpt-5.6-luna' } }
function doFix(p) {
  const e = EMP[p.handle]
  const files = (p.files || []).join(', ')
  const rules = ZONE + ' 🔴ห้ามแตะไฟล์หัวใจ: ' + CRITICAL + '. แก้เฉพาะไฟล์ที่ระบุ · incremental (Edit) ห้าม rewrite ทั้งไฟล์ · รักษา backward-compat.'
  if (e.codex) {
    const taskFile = EDIR + '/fixes/_task-' + RUN + '-' + p.handle + '.txt'
    const taskBody = 'แก้: ' + p.task + '\nเฉพาะไฟล์: ' + files + '\n' + rules + '\nยืนยันด้วยการอ่านซ้ำ'
    return agent('เขียนไฟล์ ' + taskFile + ' (UTF-8, สร้างโฟลเดอร์ถ้าไม่มี) ด้วยเนื้อหาเป๊ะ ๆ ต่อไปนี้:\n---\n' + taskBody + '\n---\n' +
      'จากนั้นสั่ง Codex (ซิป) แก้ตามใบสั่งในไฟล์นั้น. Bash timeout=480000:\n' +
      '"' + CODEX + '" exec -m ' + e.codex + ' -c model_reasoning_effort=low -c approval_policy=never -s workspace-write --skip-git-repo-check --ephemeral -C . "$(cat ' + taskFile + ')" < /dev/null\n' +
      'ห้ามแก้ prompt ก่อนส่ง (ต้องอ่านจากไฟล์ที่เขียนเป๊ะ ๆ) ตอบสั้น: แก้ไฟล์ไหน',
      { label: 'แก้:' + p.handle, phase: 'ลงมือ', model: 'haiku', effort: 'low' })
  }
  return agent('คุณคือ "' + e.name + '" วิศวกร ทีมวิศวกรรม Fable & Co. แก้ตรงจุด สะอาด.\n' +
    'งาน: ' + p.task + '\nแก้เฉพาะไฟล์: ' + files + '\n' + rules + '\nตอบสั้น: แก้อะไรในไฟล์ไหน ≤3 บรรทัด',
    { label: 'แก้:' + p.handle, phase: 'ลงมือ', model: e.model, effort: 'medium' })
}
const fixResults = await parallel(diag.plan.map(p => () => doFix(p)))

// ---- เฟส 3: เทส + รีวิว ----
phase('เทส/รีวิว')
const allFiles = diag.plan.reduce((a, p) => a.concat(p.files || []), []).join(', ')
const [test, review] = await parallel([
  () => agent('คุณคือ "คิว" QA ทีมวิศวกรรม. เทสว่าการแก้ไม่พัง: node --check ถ้าเป็น .js/.mjs, ถ้า .html เช็ค token ต้องห้าม (?. ?? replaceAll), grep error ชัด ๆ. ไฟล์: ' + allFiles + '\nรัน Bash เท่าที่จำเป็น. ตอบ: PASS/FAIL + หลักฐานสั้น',
    { label: 'เทส:qa', phase: 'เทส/รีวิว', model: 'haiku', effort: 'low' }),
  () => {
    const reviewFile = EDIR + '/fixes/_review-' + RUN + '.txt'
    const reviewBody = 'รีวิว git diff ไฟล์ ' + allFiles + '\nหา regression/scope-creep/แตะไฟล์หัวใจ/แตะของนอกเขต/breaking change. ตอบสั้น: ผ่าน/ติง + ประเด็น'
    return agent('เขียนไฟล์ ' + reviewFile + ' (UTF-8, สร้างโฟลเดอร์ถ้าไม่มี) ด้วยเนื้อหาเป๊ะ ๆ ต่อไปนี้:\n---\n' + reviewBody + '\n---\n' +
      'จากนั้นสั่ง Codex (เรฟ ผู้ตรวจอิสระ) รีวิวตามใบสั่งในไฟล์นั้น. Bash timeout=480000:\n' +
      '"' + CODEX + '" exec -m gpt-5.6-sol -c model_reasoning_effort=high -c approval_policy=never -s workspace-write --skip-git-repo-check --ephemeral -C . "$(cat ' + reviewFile + ')" < /dev/null\n' +
      'ห้ามแก้ prompt ก่อนส่ง (ต้องอ่านจากไฟล์ที่เขียนเป๊ะ ๆ) ตอบ: คำตัดสินเรฟ',
      { label: 'รีวิว:rev', phase: 'เทส/รีวิว', model: 'haiku', effort: 'low' })
  },
])

// ---- เฟส 4: รายงาน ----
phase('รายงาน')
await writeReport(TARGET === 'newsdesk-prod' ? 'แก้ production แล้ว รอ deploy อนุมัติ' : 'แก้แล้ว รอ deploy',
  'แก้: ' + JSON.stringify(fixResults.filter(Boolean)).slice(0, 400) + '\nเทส: ' + String(test).slice(0, 250) + '\nรีวิว: ' + String(review).slice(0, 250))

return {
  runId: RUN, target: TARGET, mode: 'applied',
  rootCause: diag.rootCause, risk: diag.risk, fixedFiles: allFiles,
  test: String(test).slice(0, 200), review: String(review).slice(0, 200),
  reportPath: EDIR + '/fixes/' + RUN + '.md',
  note: '🔒 deploy รอ @phupha อนุมัติ (เช็ครายงาน+เทส+รีวิว' + (TARGET === 'newsdesk-prod' ? ' — นี่คือ production ข่าวจริง ระวังสูงสุด' : '') + ')',
}
