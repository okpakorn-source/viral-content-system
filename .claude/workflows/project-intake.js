export const meta = {
  name: 'project-intake',
  description: 'สายพานโปรเจกต์ Fable & Co. — Plan (Opus) → Work ขนาน → Review → Report (Opus)',
  phases: [
    { title: 'Plan', detail: 'โอ๊ต (Opus) แตกงาน เขียน 01-plan.md', model: 'opus' },
    { title: 'Work', detail: 'พนักงาน stage=work รันขนาน' },
    { title: 'Review', detail: 'ผู้ตรวจรันหลัง work จบเท่านั้น (barrier)' },
    { title: 'Report', detail: 'โอ๊ต (Opus) รวมรายงาน 03-report.md', model: 'opus' },
  ],
}

// ---- validate args (บทเรียนข้อ 4: args เป็น string → path "undefined") ----
const A = typeof args === 'string' ? JSON.parse(args) : args
if (!A || !A.projectDir) throw new Error('project-intake: ต้องส่ง args {projectDir} — ได้: ' + JSON.stringify(A))
const DIR = String(A.projectDir).replace(/\\/g, '/').replace(/\/+$/, '')
// ความปลอดภัย: projectDir ต้องเป็น company/projects/<slug> เท่านั้น (กัน .., path ซ้อน, shell metachar → command injection/scope escape)
if (!/^company\/projects\/[A-Za-z0-9_-]+$/.test(DIR)) {
  throw new Error('project-intake: projectDir ไม่ถูกรูป ต้องเป็น "company/projects/<slug>" (a-z0-9_- เท่านั้น) — ได้: ' + DIR)
}

// ---- ทำเนียบพนักงาน ----
const CODEX_EXE = 'C:\\Users\\User\\AppData\\Local\\OpenAI\\Codex\\bin\\5dee10576ec7a5b8\\codex.exe'
const EMP = {
  oat:   { kind: 'claude', model: 'opus',   effort: 'medium', name: 'โอ๊ต' },
  sun:   { kind: 'claude', model: 'sonnet', effort: 'medium', name: 'ซัน' },
  hai:   { kind: 'claude', model: 'haiku',  effort: 'low',    name: 'ฮาย' },
  sol:   { kind: 'codex', slug: 'gpt-5.6-sol',   effort: 'high',   name: 'โซล' },
  terra: { kind: 'codex', slug: 'gpt-5.6-terra', effort: 'medium', name: 'เทอร่า' },
  luna:  { kind: 'codex', slug: 'gpt-5.6-luna',  effort: 'low',    name: 'ลูน่า' },
}

// ---- เฟส 1: Plan (โอ๊ต/Opus) ----
phase('Plan')
log('โอ๊ต (Opus) กำลังอ่านโจทย์และแตกงาน...')
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    planSummary: { type: 'string', description: 'สรุปแผน 2-4 ประโยค ภาษาไทย' },
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          handle: { type: 'string', enum: ['oat', 'sun', 'hai', 'sol', 'terra', 'luna'] },
          task: { type: 'string', description: 'รายละเอียดงานภาษาไทย ระบุ deliverable ชัดเจน' },
          stage: { type: 'string', enum: ['work', 'review'] },
        },
        required: ['handle', 'task', 'stage'],
      },
    },
  },
  required: ['planSummary', 'assignments'],
}
const plan = await agent(
  'คุณคือ "โอ๊ต" (@oat) รอง CEO บริษัท Fable & Co. นิสัยละเอียดยิบ จ้างเท่าที่จำเป็น (ทุกคนที่จ้างคือ token ที่จ่าย)\n' +
  '1. อ่านธรรมนูญ public/company/COMPANY.md (ทำเนียบพนักงาน+ความถนัด) และโจทย์ ' + DIR + '/00-brief.md\n' +
  '2. แตกงานตามความถนัด: โค้ด/UI→sun · ค้น/สรุป/แปลง→hai · เหมาก้อนใหญ่→terra · งานเบาด่วน→luna · ตรวจอิสระ→sol (stage=review) · ห้าม assign phupha/oat\n' +
  '3. เขียนแผนละเอียดลงไฟล์ ' + DIR + '/01-plan.md (ภาษาไทย: เป้าหมาย, งานรายคนพร้อมรายละเอียด, ลำดับ, เกณฑ์ตรวจรับ)\n' +
  '4. กฎเหล็ก: deliverable ทุกงานต้องเป็นไฟล์ ' + DIR + '/02-work/<handle>.md เท่านั้น (ระบุ path นี้ในทุกงาน) | งานตรวจผลงานเพื่อน mark stage=review เท่านั้น | งานผลิต mark stage=work\n' +
  '5. ตอบ structured output: planSummary + assignments[{handle,task,stage}] โดย task ต้องละเอียดพอที่พนักงานทำได้โดยไม่ต้องถามกลับ',
  { label: 'plan:oat', phase: 'Plan', model: 'opus', effort: 'medium', schema: PLAN_SCHEMA }
)
if (!plan || !plan.assignments || !plan.assignments.length) throw new Error('Plan ล้มเหลว: ไม่มี assignments')
const valid = plan.assignments.filter(a => EMP[a.handle])
const dropped = plan.assignments.length - valid.length
if (dropped > 0) log('⚠️ ตัด assignment ที่ handle ไม่รู้จัก ' + dropped + ' งาน')
log('แผนพร้อม: จ้าง ' + valid.map(a => '@' + a.handle + '(' + a.stage + ')').join(', '))

// ---- ตัวจ่ายงานรายคน ----
function hire(a, stageLabel) {
  const e = EMP[a.handle]
  const deliverable = DIR + '/02-work/' + a.handle + '.md'
  if (e.kind === 'claude') {
    return agent(
      'คุณคือ "' + e.name + '" (@' + a.handle + ') พนักงาน Fable & Co.\n' +
      '1. อ่านบัตร public/company/employees/' + a.handle + '.md และกติกา public/company/COMPANY.md\n' +
      '2. บริบทงาน: อ่าน ' + DIR + '/00-brief.md และ ' + DIR + '/01-plan.md' +
      (a.stage === 'review' ? ' และผลงานเพื่อนทั้งหมดใน ' + DIR + '/02-work/' : '') + '\n' +
      '3. งานของคุณ: ' + a.task + '\n' +
      '4. เขียนผลงานเต็มลงไฟล์ ' + deliverable + ' (UTF-8, ภาษาไทย)\n' +
      '5. ปิดงาน: append เมล 1 บรรทัดต่อท้าย public/company/office/desk/' + a.handle + '.md รูปแบบ "[n] @phupha: <สรุป 1-3 บรรทัด> → ' + deliverable + '"\n' +
      'ข้อห้าม: ห้ามแตะไฟล์อื่นนอกจาก ' + deliverable + ' กับโต๊ะตัวเอง | คำตอบสุดท้าย: สรุปผล 1-3 บรรทัด + path',
      { label: stageLabel + ':' + a.handle, phase: a.stage === 'review' ? 'Review' : 'Work', model: e.model, effort: e.effort }
    )
  }
  // พนักงาน Codex → จ้างฮาย (Haiku, low) เป็น runner — บทเรียนข้อ 1-2: ปิด stdin + timeout 480000ms
  return agent(
    'คุณคือ runner ของบริษัท Fable & Co. หน้าที่: สั่งงานพนักงานข้ามค่าย "' + e.name + '" (@' + a.handle + ') ผ่าน Codex CLI แล้วตรวจผล\n' +
    '1. ใช้ Write tool เขียนไฟล์ใบสั่งงาน ' + DIR + '/02-work/_task-' + a.handle + '.txt เนื้อหา:\n' +
    '"""คุณคือ "' + e.name + '" (@' + a.handle + ') พนักงาน Fable & Co. อ่านกติกา public/company/COMPANY.md แล้วทำงานนี้: ' + a.task + '\n' +
    (a.stage === 'review' ? 'อ่านผลงานเพื่อนใน ' + DIR + '/02-work/ ประกอบการตรวจ\n' : '') +
    'เขียนผลงานเต็มลงไฟล์ ' + deliverable + ' (UTF-8 ภาษาไทย) และ append เมล 1 บรรทัดต่อท้าย public/company/office/desk/' + a.handle + '.md รูปแบบ "[n] @phupha: <สรุปสั้น> → ' + deliverable + '" ห้ามแตะไฟล์อื่น"""\n' +
    '2. รันด้วย Bash tool โดยตั้ง timeout parameter = 480000 (บังคับ — ห้ามใช้ default):\n' +
    '"' + CODEX_EXE.replace(/\\/g, '/') + '" exec -m ' + e.slug + ' -c model_reasoning_effort=' + e.effort + ' -c approval_policy=never -s workspace-write --skip-git-repo-check --ephemeral -C . "อ่านไฟล์ ' + DIR + '/02-work/_task-' + a.handle + '.txt แล้วทำตามคำสั่งในนั้นทั้งหมด" < /dev/null\n' +
    '3. ตรวจว่าไฟล์ ' + deliverable + ' เกิดจริงและมีเนื้อหา (ไม่ว่าง) — ถ้าล้มหรือไฟล์ไม่เกิด ให้คุณเขียนไฟล์ ' + deliverable + ' เองระบุ "❌ งานล้มเหลว" + สาเหตุ + ท้าย log ของ codex\n' +
    'คำตอบสุดท้าย: สำเร็จ/ล้มเหลว + ขนาดไฟล์ผลงาน',
    { label: stageLabel + ':' + a.handle + '(runner)', phase: a.stage === 'review' ? 'Review' : 'Work', model: 'haiku', effort: 'low' }
  )
}

// ---- เฟส 2: Work ขนาน (barrier ก่อนเข้า Review — บทเรียนข้อ 5) ----
phase('Work')
const workJobs = valid.filter(a => a.stage === 'work')
log('เริ่มงานผลิตขนาน ' + workJobs.length + ' งาน')
const workResults = await parallel(workJobs.map(a => () => hire(a, 'work')))
const workFailed = workResults.filter(r => r === null).length
if (workFailed > 0) log('⚠️ งานผลิตล้ม/ถูกข้าม ' + workFailed + ' งาน — Review จะเห็นจากไฟล์ที่ขาด')

// ---- เฟส 3: Review (รันหลัง work จบหมดเท่านั้น) ----
phase('Review')
const reviewJobs = valid.filter(a => a.stage === 'review')
if (reviewJobs.length) {
  log('เริ่มงานตรวจ ' + reviewJobs.length + ' งาน (หลัง barrier)')
  await parallel(reviewJobs.map(a => () => hire(a, 'review')))
} else {
  log('แผนนี้ไม่มีงานตรวจ — ข้าม')
}

// ---- เฟส 4: Report (โอ๊ต/Opus) ----
phase('Report')
log('โอ๊ต (Opus) กำลังสังเคราะห์รายงานรวม...')
const report = await agent(
  'คุณคือ "โอ๊ต" (@oat) รอง CEO บริษัท Fable & Co. งาน: รวมรายงานปิดโปรเจกต์\n' +
  '1. อ่านทั้งหมด: ' + DIR + '/00-brief.md, ' + DIR + '/01-plan.md และผลงานทุกไฟล์ใน ' + DIR + '/02-work/ (ข้ามไฟล์ _task-*.txt)\n' +
  '2. เขียน ' + DIR + '/03-report.md ภาษาไทย โครงบังคับ 6 ส่วน:\n' +
  '   1.สรุปผู้บริหาร 2.แผนดำเนินการขั้นต่อขั้น (สังเคราะห์ใหม่จากผลงานทุกคน ห้ามแปะต่อกันเฉย ๆ) 3.ผลงานรายคน (ชื่อ+โมเดล+สาระสำคัญ+path) 4.จุดขัดแย้งระหว่างผลงาน+คำตัดสินของคุณ 5.ความเสี่ยง 6.งานถัดไป+ควรจ้างใคร\n' +
  '3. ปิดงาน: append เมล 1 บรรทัดต่อท้าย public/company/office/desk/oat.md "[n] @phupha: รายงานรวมเสร็จ → ' + DIR + '/03-report.md"\n' +
  'ข้อห้าม: ห้ามแตะไฟล์อื่นนอกจาก 03-report.md กับโต๊ะตัวเอง | ตอบ structured output: executiveSummary = สรุปผู้บริหาร 3-5 ประโยค',
  { label: 'report:oat', phase: 'Report', model: 'opus', effort: 'medium',
    schema: { type: 'object', properties: { executiveSummary: { type: 'string' } }, required: ['executiveSummary'] } }
)

return {
  reportPath: DIR + '/03-report.md',
  planSummary: plan.planSummary,
  hired: valid.map(a => ({ handle: a.handle, name: EMP[a.handle].name, model: EMP[a.handle].kind === 'claude' ? EMP[a.handle].model : EMP[a.handle].slug, stage: a.stage })),
  workFailed: workFailed,
  executiveSummary: report ? report.executiveSummary : '(รายงานล้มเหลว — อ่าน ' + DIR + '/03-report.md เอง)',
}
