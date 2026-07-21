// ทีมวิศวกรรมแก้ปัญหาให้แผนก — วินิจฉัย→แก้→เทส→รีวิว→รายงาน (deploy รอ @phupha อนุมัติ)
export const meta = {
  name: 'eng-fix',
  description: 'ทีมวิศวะแก้ปัญหาแผนก: อาร์ควินิจฉัย→เบค/ฝนแก้→คิวเทส→เรฟรีวิว→รายงาน',
  phases: [
    { title: 'วินิจฉัย', detail: 'อาร์ค (Opus) หารากปัญหา+วางแผน', model: 'opus' },
    { title: 'แก้', detail: 'เบค/ฝน แก้ตามแผน (แยกไฟล์)' },
    { title: 'เทส/รีวิว', detail: 'คิวเทส + เรฟรีวิวอิสระ' },
    { title: 'รายงาน', detail: 'อาร์ค ตรวจรับ+สรุป', model: 'opus' },
  ],
}

const A = typeof args === 'string' ? JSON.parse(args) : args
if (!A || !A.problem) throw new Error('ต้องส่ง {problem, scope?, runId?}')
const PROBLEM = String(A.problem)
const SCOPE = String(A.scope || 'newsdesk')
const RUN = String(A.runId || 'fix')
const EDIR = 'public/company/departments/engineering'
const CODEX = 'C:/Users/User/AppData/Local/OpenAI/Codex/bin/5dee10576ec7a5b8/codex.exe'
// ขอบเขตแก้ได้ (โค้ดบริษัท/แผนก) — ห้ามแตะระบบข่าวจริง
const GUARD = 'ขอบเขตที่แก้ได้: public/company/** และ .claude/workflows/newsdesk-*.js, company-*.js เท่านั้น. 🔴ห้ามแตะระบบข่าวจริง/ท่อผลิต (src/app/api/desk, src/lib/services, src/lib/ai) เด็ดขาด — ถ้ารากปัญหาอยู่นอกขอบเขต ให้รายงานเฉย ๆ ไม่แก้'

// ---- เฟส 1: วินิจฉัย (อาร์ค อ่านอย่างเดียว) ----
phase('วินิจฉัย')
const diag = await agent(
  'คุณคือ "อาร์ค" หัวหน้าวิศวกร/สถาปนิก ทีมวิศวกรรม Fable & Co. หารากปัญหาก่อนแก้ ไม่รีบ.\n' +
  'ปัญหาที่แผนก ' + SCOPE + ' แจ้ง: "' + PROBLEM + '"\n' + GUARD + '\n' +
  'อ่านไฟล์ที่เกี่ยวข้อง (read-only) หารากปัญหา แล้วตอบ structured: rootCause, plan[{handle(beck/fon/zip), task, files}], risk(low/medium/high). ' +
  'เลือกคนแก้ให้ตรงงาน: backend/workflow/server→beck, จอ/UI→fon, จุดเล็กด่วน→zip. อย่าเพิ่งแก้ แค่วินิจฉัย+วางแผน.',
  { label: 'วินิจฉัย:arch', phase: 'วินิจฉัย', model: 'opus', effort: 'high',
    schema: { type: 'object', properties: {
      rootCause: { type: 'string' }, risk: { type: 'string', enum: ['low', 'medium', 'high'] },
      plan: { type: 'array', items: { type: 'object', properties: {
        handle: { type: 'string', enum: ['beck', 'fon', 'zip'] }, task: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['handle', 'task', 'files'] } } },
      required: ['rootCause', 'risk', 'plan'] } })
if (!diag || !diag.plan || !diag.plan.length) return { runId: RUN, diagnosed: diag ? diag.rootCause : '(วินิจฉัยล้ม)', fixed: 0, note: 'ไม่มีแผนแก้ (อาจอยู่นอกขอบเขต) — ดู rootCause' }
log('รากปัญหา: ' + diag.rootCause.slice(0, 80) + ' | risk=' + diag.risk + ' | แก้ ' + diag.plan.length + ' จุด')

// ---- เฟส 2: แก้ (แยกไฟล์ กันชน) ----
phase('แก้')
const EMP = { beck: { name: 'เบค', model: 'sonnet' }, fon: { name: 'ฝน', model: 'sonnet' }, zip: { name: 'ซิป', codex: 'gpt-5.6-luna' } }
function doFix(p) {
  const e = EMP[p.handle]
  const files = (p.files || []).join(', ')
  if (e.codex) {
    return agent('คุณคือ runner. สั่ง Codex (ช่างแก้ด่วน ซิป) แก้ไฟล์. Bash timeout=480000:\n' +
      '"' + CODEX + '" exec -m ' + e.codex + ' -c model_reasoning_effort=low -c approval_policy=never -s workspace-write --skip-git-repo-check --ephemeral -C . "แก้: ' + String(p.task).replace(/"/g, "'") + ' เฉพาะไฟล์: ' + files + '. ' + GUARD.replace(/"/g, "'") + ' แก้ให้เสร็จ ยืนยันด้วยการอ่านซ้ำ" < /dev/null\nตอบสั้น: แก้ไฟล์ไหนบ้าง',
      { label: 'แก้:' + p.handle, phase: 'แก้', model: 'haiku', effort: 'low' })
  }
  return agent('คุณคือ "' + e.name + '" วิศวกร ทีมวิศวกรรม Fable & Co. แก้ตรงจุด สะอาด.\n' +
    'งาน: ' + p.task + '\nแก้เฉพาะไฟล์: ' + files + '\n' + GUARD + '\n' +
    'แก้แบบ incremental (Edit) อย่า rewrite ทั้งไฟล์. เสร็จแล้วตอบสั้น: แก้อะไรในไฟล์ไหน ≤3 บรรทัด',
    { label: 'แก้:' + p.handle, phase: 'แก้', model: e.model, effort: 'medium' })
}
const fixResults = await parallel(diag.plan.map(p => () => doFix(p)))

// ---- เฟส 3: เทส + รีวิว ----
phase('เทส/รีวิว')
const allFiles = diag.plan.reduce((a, p) => a.concat(p.files || []), []).join(', ')
const [test, review] = await parallel([
  () => agent('คุณคือ "คิว" QA ทีมวิศวกรรม. เทสว่าการแก้ไม่พัง: ตรวจ syntax (node --check ถ้าเป็น .js/.mjs), grep หา error ชัด ๆ, ถ้าเป็น HTML เช็ค token ต้องห้าม (?. ?? replaceAll). ไฟล์ที่แก้: ' + allFiles + '\nรัน Bash เท่าที่จำเป็น. ตอบ: PASS/FAIL + หลักฐานสั้น',
    { label: 'เทส:qa', phase: 'เทส/รีวิว', model: 'haiku', effort: 'low' }),
  () => agent('คุณคือ runner. สั่ง Codex (เรฟ ผู้ตรวจอิสระ) รีวิว diff. Bash timeout=480000:\n' +
    '"' + CODEX + '" exec -m gpt-5.6-sol -c model_reasoning_effort=high -c approval_policy=never -s workspace-write --skip-git-repo-check --ephemeral -C . "รีวิวการแก้ไฟล์ ' + allFiles.replace(/"/g, "'") + ' (git diff). หา regression/scope-creep/แตะของนอกขอบเขต. ตอบสั้น: ผ่าน/ติง + ประเด็น" < /dev/null\nตอบ: คำตัดสินเรฟ',
    { label: 'รีวิว:rev', phase: 'เทส/รีวิว', model: 'haiku', effort: 'low' }),
])

// ---- เฟส 4: รายงาน (อาร์ค) ----
phase('รายงาน')
await agent('คุณคือ "อาร์ค" หัวหน้าวิศวกร. สรุปการแก้เคสนี้ลงไฟล์ ' + EDIR + '/fixes/' + RUN + '.md (UTF-8, สร้างใหม่):\n' +
  'ปัญหา: ' + PROBLEM + '\nรากปัญหา: ' + diag.rootCause + '\nแก้: ' + JSON.stringify(fixResults.filter(Boolean)).slice(0, 500) + '\nเทส: ' + String(test).slice(0, 300) + '\nรีวิว: ' + String(review).slice(0, 300) + '\n' +
  'เขียนโครง: ปัญหา/รากปัญหา/แก้อะไรไฟล์ไหน/ผลเทส/ผลรีวิว/พร้อม deploy ไหม. append 1 บรรทัดลง ' + EDIR + '/worklog.md ด้วย. ห้ามแตะไฟล์อื่น. ตอบ structured.',
  { label: 'รายงาน:arch', phase: 'รายงาน', model: 'opus', effort: 'medium',
    schema: { type: 'object', properties: { summary: { type: 'string' }, readyToDeploy: { type: 'boolean' } }, required: ['summary', 'readyToDeploy'] } })

return {
  runId: RUN, rootCause: diag.rootCause, risk: diag.risk,
  fixedFiles: allFiles, test: String(test).slice(0, 200), review: String(review).slice(0, 200),
  reportPath: EDIR + '/fixes/' + RUN + '.md',
  note: '🔒 deploy รอ @phupha อนุมัติ (เช็ครายงาน + ผลเทส/รีวิวก่อน)',
}
