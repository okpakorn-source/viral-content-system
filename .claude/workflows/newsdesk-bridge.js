// สะพานเชื่อมแผนกโต๊ะข่าว (ทีม AI) ↔ ระบบ /news-desk จริง
// โหมดปลอดภัย: default = อ่าน+ประชุม+แนะนำ (ไม่ส่ง). ส่งจริงเฉพาะเมื่อมี sendIds ที่อนุมัติ
export const meta = {
  name: 'newsdesk-bridge',
  description: 'เชื่อมแผนก AI ↔ /news-desk จริง: อ่านลีด→ประชุม→แนะนำ (ส่งจริงล็อก ต้องมี sendIds อนุมัติ)',
  phases: [
    { title: 'อ่านลีดจริง', detail: 'GET /api/desk/research/leads' },
    { title: 'ประชุม', detail: 'แผนกคัดข่าวจริง (nested)' },
    { title: 'สรุป/ส่ง', detail: 'แนะนำ หรือ ส่งจริงเฉพาะ sendIds อนุมัติ' },
  ],
}

const A = typeof args === 'string' ? JSON.parse(args) : args
const BASE = (A && A.base) || 'https://viral-content-system.vercel.app'
const RUN = String((A && A.runId) || 'live')
const LIMIT = Math.min(Math.max((A && A.limit) || 8, 1), 20)
const MINSCORE = (A && A.minScore) || 0
const SEND_IDS = (A && Array.isArray(A.sendIds)) ? A.sendIds : null   // ← มีเมื่ออนุมัติแล้วเท่านั้น
const DIR = 'public/company/departments/newsdesk'

// ================= โหมดส่งจริง (gated) =================
if (SEND_IDS && SEND_IDS.length) {
  phase('สรุป/ส่ง')
  log('🚀 โหมดส่งจริง ' + SEND_IDS.length + ' ใบ (อนุมัติแล้ว)')
  const results = await parallel(SEND_IDS.slice(0, 20).map(id => () => agent(
    'คุณคือ "มด" โอเปอเรเตอร์ แผนกโต๊ะข่าว. ส่งลีดที่ @phupha อนุมัติแล้วเข้าคิวเขียนจริง.\n' +
    'ใช้ Bash (timeout 120000) ยิง:\n' +
    'curl -sS -m 90 -X POST "' + BASE + '/api/desk/research/extract" -H "Content-Type: application/json" -d \'{"action":"extractAndSend","leadId":"' + id + '"}\'\n' +
    'อ่าน response: success/sent/jobId หรือ pending/error. ' +
    'บันทึกผล (กติกา: ทุกการกระทำต้องลงคลัง): append 1 บรรทัดลง ' + DIR + '/worklog.md "- [ส่งจริง ' + RUN + '] ' + id + ' → <ผล>" ' +
    'และ append 1 แถวลงตาราง ' + DIR + '/archive/jobs.md "| <วันที่วันนี้> | ส่งข่าว ' + id + ' | ✅/❌/⏳ | <jobId หรือสาเหตุ> | รอบ ' + RUN + ' |". ' +
    'ห้ามแตะไฟล์อื่น. ตอบ structured.',
    { label: 'ส่ง:' + id, phase: 'สรุป/ส่ง', model: 'haiku', effort: 'low',
      schema: { type: 'object', properties: { leadId: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['leadId', 'ok', 'detail'] } })))
  return { mode: 'send', sent: results.filter(r => r && r.ok).length, results: results.filter(Boolean) }
}

// ================= โหมดแนะนำ (default, ไม่ส่ง) =================
// --- เฟส 1: อ่านลีดจริง (read-only) ---
phase('อ่านลีดจริง')
const CSCHEMA = { type: 'object', properties: { candidates: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, tone: { type: 'string' },
  channel: { type: 'string' }, matchScore: { type: 'number' } }, required: ['id', 'title'] } } }, required: ['candidates'] }
const read = await agent(
  'คุณคือ "มด" โอเปอเรเตอร์. ดึงลีดข่าวจริงจากระบบ (read-only) ใช้ Bash:\n' +
  'curl -sS -m 30 "' + BASE + '/api/desk/research/leads?limit=' + (LIMIT * 3) + '&status=new&minScore=' + MINSCORE + '"\n' +
  'จาก leads[] เลือก ' + LIMIT + ' ใบแรกที่ status=new. map เป็น candidates: id=lead.id, title=lead.title, summary=lead.snippet(ตัด ≤160 ตัว), tone="", channel=lead.channel, matchScore=lead.matchScore. ' +
  'ห้ามส่ง/แก้อะไรในระบบ อ่านอย่างเดียว. ตอบ structured candidates[].',
  { label: 'อ่านลีด:mod', phase: 'อ่านลีดจริง', model: 'haiku', effort: 'low', schema: CSCHEMA })
const cands = (read && read.candidates || []).slice(0, LIMIT)
if (!cands.length) { log('ไม่มีลีด status=new'); return { mode: 'recommend', candidates: 0, note: 'ไม่มีลีดใหม่ให้ประชุม' } }
log('ได้ลีดจริง ' + cands.length + ' ใบ → เข้าห้องประชุม')

// --- เฟส 2: ประชุมคัดข่าว (เรียก workflow ประชุมที่เทสแล้ว) ---
phase('ประชุม')
const meet = await workflow({ scriptPath: 'C:/Users/User/แบล็กอัพก่อนแก้2เวอร์ชัน27-5-12.16/.claude/workflows/newsdesk-meeting.js' }, { runId: 'bridge-' + RUN, candidates: cands })
const decisions = (meet && meet.decisions) || []

// --- เฟส 3: สรุป + รายการรออนุมัติ (ไม่ส่ง) ---
phase('สรุป/ส่ง')
const sendReady = decisions.filter(d => d.verdict === 'send')
log('มติ: ส่ง ' + sendReady.length + ' / แก้ ' + decisions.filter(d => d.verdict === 'fix').length + ' / ตก ' + decisions.filter(d => d.verdict === 'drop').length)
return {
  mode: 'recommend',
  runId: RUN,
  reviewed: cands.length,
  decisions: decisions,
  sendReadyIds: sendReady.map(d => d.id),
  note: '🔒 ยังไม่ส่ง — ให้ @phupha ตรวจ sendReadyIds แล้วรัน bridge ซ้ำด้วย args {sendIds:[...]} เพื่อส่งจริง (มีค่า LLM + เผยแพร่จริง)',
}
