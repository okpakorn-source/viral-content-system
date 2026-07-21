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

// ---- เฟส 1: รับเรื่อง (อ่านคิว + ล้างคิว) ----
phase('รับเรื่อง')
const intake = await agent(
  'อ่านไฟล์ ' + PEND + ' (JSONL บรรทัดละ 1 รายการ; ถ้าไม่มีไฟล์/ว่าง = ไม่มีคิว). ' +
  'สรุปเป็น items[] ตามสคีมา (type say/meeting, to, text, topic). ' +
  'จากนั้น**ล้างคิว**: ใช้ Write เขียนทับ ' + PEND + ' ให้เป็นไฟล์ว่าง (สตริงว่าง). ห้ามแตะไฟล์อื่น.',
  { label: 'รับเรื่อง', phase: 'รับเรื่อง', model: 'haiku', effort: 'low',
    schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
      type: { type: 'string', enum: ['say', 'meeting'] }, to: { type: 'string' }, text: { type: 'string' }, topic: { type: 'string' } } } } }, required: ['items'] } })

const items = (intake && intake.items || []).slice(0, 8)
if (!items.length) { log('ไม่มีข้อความในคิว'); return { scope: SCOPE, replied: 0, note: 'คิวว่าง' } }
log('มี ' + items.length + ' เรื่องในคิว')

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
  // codex → haiku runner
  return agent(
    'คุณคือ runner. รัน Bash (timeout=480000) ให้ Codex ตอบแทนพนักงาน "' + e.name + '":\n' +
    '"' + CODEX + '" exec -m ' + e.slug + ' -c model_reasoning_effort=low -c approval_policy=never -s workspace-write --skip-git-repo-check --ephemeral -C . "คุณคือ ' + e.name + ' (' + e.role + ') พนักงาน Fable & Co. ผู้ใช้ถาม: ' + String(question).replace(/"/g, "'") + ' — ตอบสั้น ≤2 บรรทัด ภาษาไทย พิมพ์คำตอบออกมาอย่างเดียว" < /dev/null\n' +
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

return { scope: SCOPE, replied: replies.length, chat: CHAT, note: 'ตอบแล้ว ' + replies.length + ' ข้อความ — ดูใน chat.md' }
