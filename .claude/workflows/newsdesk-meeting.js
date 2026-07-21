export const meta = {
  name: 'newsdesk-meeting',
  description: 'ประชุมโต๊ะข่าว — เช็คเนื้อ/โทน/คัด ขนาน → เคนเคาะ เขียน minutes (ประหยัด token)',
  phases: [
    { title: 'ลงมติ', detail: 'มีน/ฟ้า/นิน ลงมติขนาน + โจ cross-check' },
    { title: 'เถียง', detail: 'นินแย้งเฉพาะข่าวที่เห็นต่าง' },
    { title: 'เคาะ', detail: 'เคน (Sonnet) สรุป+เขียน board/minutes', model: 'sonnet' },
  ],
}

const A = typeof args === 'string' ? JSON.parse(args) : args
if (!A || !Array.isArray(A.candidates) || !A.candidates.length) throw new Error('ต้องส่ง {candidates:[...], runId}')
const RUN = String(A.runId || 'latest')
const DIR = 'public/company/departments/newsdesk'
const CODEX = 'C:\\Users\\User\\AppData\\Local\\OpenAI\\Codex\\bin\\5dee10576ec7a5b8\\codex.exe'.replace(/\\/g, '/')
const CAND = A.candidates.map((c, i) => ({ id: c.id || ('N' + (i + 1)), title: c.title || '', summary: c.summary || '', tone: c.tone || '' }))
const LIST = CAND.map(c => c.id + ' | ' + c.title + ' | เนื้อ: ' + c.summary + ' | โทน: ' + c.tone).join('\n')

const VSCHEMA = { type: 'object', properties: { verdicts: { type: 'array', items: {
  type: 'object', properties: { id: { type: 'string' }, mark: { type: 'string', enum: ['✅', '⚠️', '❌'] }, reason: { type: 'string' } }, required: ['id', 'mark', 'reason'] } } }, required: ['verdicts'] }

// ---- เฟส 1: ลงมติขนาน (คืน structured ไม่เขียนไฟล์ กันชน) ----
phase('ลงมติ')
const [meen, fah, nin, joOk] = await parallel([
  () => agent('คุณคือ "มีน" คนเช็คเนื้อข่าว แผนกโต๊ะข่าว. ดูรายการข่าว ตัดสินเฉพาะ "เนื้อพอเขียนได้ไหม": ✅เนื้อแน่น ⚠️เนื้อน้อยเสี่ยง ❌ผอมเขียนไม่ออก. reason ≤12 คำไทย.\n' + LIST,
    { label: 'vote:meen', phase: 'ลงมติ', model: 'haiku', effort: 'low', schema: VSCHEMA }),
  () => agent('คุณคือ "ฟ้า" คนดูโทนข่าว แผนกโต๊ะข่าว. ตัดสินเฉพาะ "สมดุลโทนไหม": ✅โทนโอเค ⚠️แง่ลบเยอะควรหามุมบวก ❌ลบล้วนไม่ควรส่ง. reason ≤12 คำไทย.\n' + LIST,
    { label: 'vote:fah', phase: 'ลงมติ', model: 'haiku', effort: 'low', schema: VSCHEMA }),
  () => agent('คุณคือ "นิน" นักคัดข่าว แผนกโต๊ะข่าว จมูกไวเรื่องไวรัล. ตัดสิน "น่าส่งไหม": ✅น่าส่งมีมุมเด่น ⚠️ก้ำกึ่ง ❌ไม่น่าสน. reason ≤12 คำไทย.\n' + LIST,
    { label: 'vote:nin', phase: 'ลงมติ', model: 'sonnet', effort: 'low', schema: VSCHEMA }),
  () => agent('คุณคือ runner. สั่งโจ (Codex) ตรวจข้อเท็จจริงข่าว ผ่าน prompt-file (กันหัวข้อข่าวหลุดเข้า shell — ห้ามต่อ LIST เข้าคำสั่ง Bash เด็ดขาด)\n' +
    '1. ใช้ Write tool เขียนไฟล์ ' + DIR + '/runs/_factcheck-task-' + RUN + '.txt เนื้อหาตามนี้เป๊ะ ๆ:\n' +
    '"""คุณคือโจ ผู้ตรวจข้อเท็จจริง แผนกโต๊ะข่าว. ดูรายการข่าวด้านล่าง เขียนไฟล์ ' + DIR + '/runs/_factcheck-' + RUN + '.md (UTF-8) บรรทัดละข่าว: <id>: <ok/ข้อสงสัย ≤15 คำ>. ห้ามแตะไฟล์อื่น\n\n===รายการข่าว===\n' + LIST + '"""\n' +
    '2. รัน Bash (timeout=480000) โดยคำสั่งคงที่ ไม่มีเนื้อข่าวในสตริง shell:\n' +
    '"' + CODEX + '" exec -m gpt-5.6-sol -c model_reasoning_effort=medium -c approval_policy=never -s workspace-write --skip-git-repo-check --ephemeral -C . "อ่านไฟล์ ' + DIR + '/runs/_factcheck-task-' + RUN + '.txt แล้วทำตามคำสั่งในนั้นทั้งหมด" < /dev/null\n' +
    '3. ตรวจว่าไฟล์ ' + DIR + '/runs/_factcheck-' + RUN + '.md เกิดจริง ถ้าไม่เกิดให้ Write เองระบุ "โจ: ตรวจไม่ทัน". ลบไฟล์ task ทิ้ง. คำตอบ: ok/fail',
    { label: 'vote:jo(codex)', phase: 'ลงมติ', model: 'haiku', effort: 'low' }),
])
const votes = { meen: meen && meen.verdicts || [], fah: fah && fah.verdicts || [], nin: nin && nin.verdicts || [] }
const mark = (who, id) => { const v = (votes[who] || []).find(x => x.id === id); return v ? v : { mark: '?', reason: '-' } }

// ---- เฟส 2: เถียง เฉพาะข่าวที่เห็นต่าง ----
phase('เถียง')
const conflicts = CAND.filter(c => { const ms = [mark('meen', c.id).mark, mark('fah', c.id).mark, mark('nin', c.id).mark]; return ms.indexOf('❌') > -1 && ms.indexOf('✅') > -1 })
let rebut = []
if (conflicts.length) {
  log('มีข่าวเห็นต่าง ' + conflicts.length + ' ข่าว → นินแย้ง')
  const r = await agent('คุณคือ "นิน" นักคัดข่าว. เพื่อนเห็นต่างกันในข่าวเหล่านี้ ช่วยแย้ง/เสนอทางออกสั้น ๆ (เช่น "เนื้อน้อยแต่เติมมุม X ได้"). ข่าว+มติเพื่อน:\n' +
    conflicts.map(c => c.id + ' "' + c.title + '" | มีน:' + mark('meen', c.id).mark + ' ฟ้า:' + mark('fah', c.id).mark + '(' + mark('fah', c.id).reason + ')').join('\n'),
    { label: 'เถียง:nin', phase: 'เถียง', model: 'sonnet', effort: 'low',
      schema: { type: 'object', properties: { points: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, say: { type: 'string' } }, required: ['id', 'say'] } } }, required: ['points'] } })
  rebut = r && r.points || []
} else { log('ทุกคนเห็นตรง — ไม่ต้องเถียง') }

// ---- เฟส 3: เคน เคาะ + เขียนไฟล์ (single writer) ----
phase('เคาะ')
const boardRows = CAND.map(c => '- ' + c.id + ' **' + c.title + '** → มีน:' + mark('meen', c.id).mark + ' ฟ้า:' + mark('fah', c.id).mark + ' นิน:' + mark('nin', c.id).mark +
  ' | มีน:"' + mark('meen', c.id).reason + '" ฟ้า:"' + mark('fah', c.id).reason + '" นิน:"' + mark('nin', c.id).reason + '"').join('\n')
const rebutTxt = rebut.length ? rebut.map(p => p.id + ': ' + p.say).join('\n') : '(ไม่มี)'

const ken = await agent(
  'คุณคือ "เคน" หัวหน้าโต๊ะข่าว (บก.ใหญ่) แผนกโต๊ะข่าว Fable & Co. ใจเย็นฟังทุกฝ่าย เด็ดขาดตอนเคาะ.\n' +
  'รอบประชุม runId=' + RUN + '. มติทีม:\n' + boardRows + '\nคำแย้งนิน:\n' + rebutTxt + '\n' +
  '(อ่านผลตรวจข้อเท็จจริงโจที่ ' + DIR + '/runs/_factcheck-' + RUN + '.md ประกอบด้วย)\n\n' +
  'งานคุณ เขียนไฟล์ (UTF-8, append ต่อท้าย ห้ามลบเดิม):\n' +
  '1. ' + DIR + '/meeting/board.md — เพิ่มหัวข้อ "## รอบ ' + RUN + '" แล้ววางตาราง boardRows ข้างบน\n' +
  '2. ' + DIR + '/meeting/minutes.md — เพิ่ม "## รอบ ' + RUN + '" แล้วบรรทัดละข่าว: "<id> <title> → ✅ส่ง / ❌ตก / 🔧แก้ก่อน — เหตุผล 1 บรรทัด" (ตัดสินจากมติรวม: ❌ใครสักคน=คุย, เนื้อผอม+ลบล้วน=ตก, เนื้อน้อยแต่กู้ได้=แก้ก่อน)\n' +
  '3. ' + DIR + '/comm-log.md — เพิ่ม 2-3 บรรทัดสื่อสารจริง: (ก) ถึงเพื่อนตามผล เช่น "[n] @nin: #X เนื้อบาง หามุมเพิ่มก่อนส่ง" (ข) รายงานสรุปกลับ ผอ. "[n] @ton: รอบ ' + RUN + ' ส่ง x/แก้ y/ตก z" (ค) ถ้ามีข่าวผ่าน "[n] @phupha: ขออนุมัติส่ง #… เข้าคิว"\n' +
  '4. ' + DIR + '/worklog.md — เพิ่ม 1 บรรทัด "- [รอบ ' + RUN + '] เคาะ N ข่าว: ส่ง x / แก้ y / ตก z"\n' +
  'ห้ามแตะไฟล์อื่น. ตอบ structured: decisions[{id, verdict:send/drop/fix, reason}]',
  { label: 'เคาะ:ken', phase: 'เคาะ', model: 'sonnet', effort: 'medium',
    schema: { type: 'object', properties: { decisions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['send', 'drop', 'fix'] }, reason: { type: 'string' } }, required: ['id', 'verdict', 'reason'] } } }, required: ['decisions'] } })

return {
  runId: RUN,
  runPath: DIR + '/meeting/minutes.md',
  decisions: ken ? ken.decisions : [],
  note: 'ข่าว verdict=send ต้องให้ @phupha อนุมัติก่อนเข้าคิวจริง (ห้าม auto)',
}
