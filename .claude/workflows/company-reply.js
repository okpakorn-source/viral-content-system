export const meta = {
  name: 'company-reply',
  description: 'ตอบแชทผู้ใช้ — อ่านคิว _pending.jsonl → ฝ่ายรับผิดชอบตอบ → เขียนกลับ chat.md',
  phases: [
    { title: 'รับเรื่อง', detail: 'อ่านคิว + ล้างคิว' },
    { title: 'ตอบ', detail: 'ฝ่ายที่ถูกถามตอบ (ขนาน)' },
    { title: 'ลงแชท', detail: 'จดกลับ chat.md (คนเดียว)' },
  ],
}

const A = typeof args === 'string' ? JSON.parse(args) : args
const SCOPE = (A && A.scope === 'newsdesk') ? 'newsdesk' : 'main'
const BASE = SCOPE === 'newsdesk' ? 'public/company/departments/newsdesk' : 'public/company/office'
const CHAT = BASE + '/chat.md'
const PEND = BASE + '/_pending.jsonl'
const CODEX = 'C:/Users/User/AppData/Local/OpenAI/Codex/bin/5dee10576ec7a5b8/codex.exe'

// roster: handle → {name, kind, model/slug}
const R = SCOPE === 'newsdesk' ? {
  ton: { name: 'ต้น', kind: 'claude', model: 'sonnet', role: 'ผอ.ข่าว วางธีม/สั่งล่า' },
  mod: { name: 'มด', kind: 'claude', model: 'haiku', role: 'โอเปอเรเตอร์ รีเฟรช/ยิงค้น' },
  ken: { name: 'เคน', kind: 'claude', model: 'sonnet', role: 'หัวหน้าโต๊ะ/บก.ใหญ่' },
  nin: { name: 'นิน', kind: 'claude', model: 'sonnet', role: 'นักคัดข่าว' },
  meen: { name: 'มีน', kind: 'claude', model: 'haiku', role: 'เช็คเนื้อข่าว' },
  fah: { name: 'ฟ้า', kind: 'claude', model: 'haiku', role: 'ดูโทน/สมดุล' },
  jo: { name: 'โจ', kind: 'codex', slug: 'gpt-5.6-sol', role: 'ตรวจข้อเท็จจริงอิสระ' },
} : {
  phupha: { name: 'ภูผา', kind: 'claude', model: 'opus', role: 'CEO (ตอบแทนโดยรอง CEO)' },
  oat: { name: 'โอ๊ต', kind: 'claude', model: 'opus', role: 'รอง CEO วางแผน/ตรวจรับ' },
  sun: { name: 'ซัน', kind: 'claude', model: 'sonnet', role: 'วิศวกร โค้ด/UI' },
  hai: { name: 'ฮาย', kind: 'claude', model: 'haiku', role: 'ผู้ช่วย/runner' },
  sol: { name: 'โซล', kind: 'codex', slug: 'gpt-5.6-sol', role: 'ผู้ตรวจอิสระ' },
  terra: { name: 'เทอร่า', kind: 'codex', slug: 'gpt-5.6-terra', role: 'ช่างเหมา' },
  luna: { name: 'ลูน่า', kind: 'codex', slug: 'gpt-5.6-luna', role: 'งานด่วน' },
}
const HEAD = SCOPE === 'newsdesk' ? 'ken' : 'oat'
const MEMBERS = Object.keys(R)

// ---- เฟส 1: รับเรื่อง (ย้ายคิวแบบ atomic กันข้อความหาย) ----
phase('รับเรื่อง')
const RUN = String((A && A.runId) || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '')
const PROCESSING = BASE + '/_processing-' + RUN + '.jsonl'
const intake = await agent(
  '1. เช็คว่าไฟล์ ' + PEND + ' มีอยู่จริงหรือไม่ (ถ้าไม่มี/ว่าง = ไม่มีคิว ตอบ items: [], found: false).\n' +
  '2. ถ้ามี ใช้ Bash tool สั่ง mv (atomic move) ย้าย ' + PEND + ' ไปเป็น ' + PROCESSING + ' — ห้ามใช้ Write เขียนทับ ' + PEND + '.\n' +
  '3. อ่านไฟล์ ' + PROCESSING + ' (JSONL บรรทัดละ 1 รายการ) แล้วสรุปเป็น items[] ตามสคีมา (type say/meeting, to, text, topic). ห้ามแตะไฟล์อื่น. คืน found: true เมื่อสำเร็จ.',
  { label: 'รับเรื่อง', phase: 'รับเรื่อง', model: 'haiku', effort: 'low',
    schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
      type: { type: 'string', enum: ['say', 'meeting'] }, to: { type: 'string' }, text: { type: 'string' }, topic: { type: 'string' } } } }, found: { type: 'boolean' } }, required: ['items', 'found'] } })

const items = (intake && intake.items || []).slice(0, 8)
const intakeFound = intake && intake.found
if (!intakeFound || !items.length) { log('ไม่มีข้อความในคิว'); return { scope: SCOPE, replied: 0, note: 'คิวว่าง' } }
log('มี ' + items.length + ' เรื่องในคิว (atomic: ' + intakeFound + ')')

// ---- เฟส 2: ตอบ (ฝ่ายที่ถูกถาม) ----
phase('ตอบ')
function pick(to) { // handle จาก "@xxx" → responder
  const h = String(to || '').replace('@', '').trim()
  return R[h] ? h : HEAD
}
function replyOne(handle, question, ctx) {
  const e = R[handle]
  if (e.kind === 'claude') {
    return agent(
      'คุณคือ "' + e.name + '" (@' + handle + ') พนักงาน Fable & Co. บทบาท: ' + e.role + '. ' + (ctx || '') +
      '\nผู้ใช้ถาม: "' + question + '"\nตอบสั้น กระชับ เหมือนคนทำงานจริง ≤2-3 บรรทัด ตามบทบาท/ความรับผิดชอบของคุณ. อย่าเขียนไฟล์ ตอบเป็นข้อความอย่างเดียว.',
      { label: 'ตอบ:' + handle, phase: 'ตอบ', model: e.model, effort: 'low' }
    ).then(t => ({ handle: handle, name: e.name, text: String(t || '').trim() }))
  }
  // codex → haiku runner (prompt-file pattern กัน question หลุดเข้าคำสั่ง shell)
  const askFile = BASE + '/_ask-' + handle + '.txt'
  return agent(
    'คุณคือ runner. หน้าที่: สั่งงานพนักงานข้ามค่าย "' + e.name + '" (@' + handle + ') ผ่าน Codex CLI\n' +
    '1. ใช้ Write tool เขียนไฟล์ใบสั่งงาน ' + askFile + ' เนื้อหา:\n' +
    '"""คุณคือ ' + e.name + ' (' + e.role + ') พนักงาน Fable & Co. ผู้ใช้ถาม: ' + question + '\nตอบสั้น ≤2 บรรทัด ภาษาไทย พิมพ์คำตอบออกมาอย่างเดียว"""\n' +
    '2. รันด้วย Bash tool โดยตั้ง timeout parameter = 480000 (บังคับ):\n' +
    '"' + CODEX + '" exec -m ' + e.slug + ' -c model_reasoning_effort=low -c approval_policy=never -s workspace-write --skip-git-repo-check --ephemeral -C . "อ่านไฟล์ ' + askFile + ' แล้วทำตามคำสั่งในนั้นทั้งหมด" < /dev/null\n' +
    '3. ลบไฟล์ ' + askFile + ' ทิ้งเมื่อจบ (ใบสั่งชั่วคราว)\n' +
    'คำตอบสุดท้ายของคุณ = ข้อความที่ Codex ตอบ (คัดมาเฉพาะเนื้อคำตอบ)',
    { label: 'ตอบ:' + handle + '(codex)', phase: 'ตอบ', model: 'haiku', effort: 'low' }
  ).then(t => ({ handle: handle, name: e.name, text: String(t || '').trim() }))
}

let jobs = []
for (const it of items) {
  if (it.type === 'meeting') {
    const q = 'ผู้ใช้เรียกประชุมหัวข้อ: "' + (it.topic || it.text || '') + '" — ออกความเห็นสั้น ๆ ตามบทบาทคุณ'
    MEMBERS.slice(0, 5).forEach(h => jobs.push({ h: h, q: q, tag: '📣ประชุม' }))
  } else {
    jobs.push({ h: pick(it.to), q: it.text || it.topic || '', tag: 'ตอบ' })
  }
}
jobs = jobs.slice(0, 12)
const replies = (await parallel(jobs.map(j => () => replyOne(j.h, j.q, j.tag === '📣ประชุม' ? 'นี่คือวงประชุมที่ผู้ใช้เรียก' : '')))).filter(Boolean)

// ---- เฟส 3: ลงแชท (คนเดียวกันชน) ----
phase('ลงแชท')
const block = replies.map(r => '[' + r.name + ' @' + r.handle + '] ' + (r.text || '(ไม่มีคำตอบ)').split('\n').join(' ')).join('\n')
await agent(
  'ใช้ Write/Edit ต่อท้ายไฟล์ ' + CHAT + ' (append ห้ามลบเดิม UTF-8) ด้วยบล็อกคำตอบพนักงานนี้ แต่ละบรรทัดขึ้นด้วย "↳ " :\n' + block +
  '\nห้ามแตะไฟล์อื่น ตอบสั้น ๆ ว่าเขียนกี่บรรทัด',
  { label: 'ลงแชท', phase: 'ลงแชท', model: 'haiku', effort: 'low' })

// ลงแชทสำเร็จแล้ว → ลบไฟล์คิวที่กำลังประมวลผลทิ้ง (เฉพาะเมื่อ intake found = atomic ย้ายสำเร็จแล้ว)
// ถ้าล้มก่อนหน้านี้ไฟล์จะยังอยู่ให้กู้ (recovery)
if (intakeFound) {
  await agent(
    'ใช้ Bash tool ลบไฟล์ ' + PROCESSING + ' ทิ้ง. ห้ามแตะไฟล์อื่น',
    { label: 'เคลียร์คิว', phase: 'ลงแชท', model: 'haiku', effort: 'low' })
}

return { scope: SCOPE, replied: replies.length, chat: CHAT, note: 'ตอบแล้ว ' + replies.length + ' ข้อความ — ดูใน chat.md' }
