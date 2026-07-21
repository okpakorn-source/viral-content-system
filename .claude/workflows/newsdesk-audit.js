// ริน ผู้ตรวจการ — ตามผลงานจริงจากระบบ → อัปเดตคลังประวัติ → พบปัญหารายงาน @arch ทีมวิศวะ
export const meta = {
  name: 'newsdesk-audit',
  description: 'ริน ตรวจผลงานจริง (คิวเขียน/สถานะ job) → อัปเดต archive/jobs.md → ปัญหารายงานทีมวิศวะ',
  phases: [
    { title: 'ตรวจผลจริง', detail: 'ริน (Haiku) เช็คระบบ + อัปเดตคลัง' },
    { title: 'รายงาน', detail: 'ปัญหา→วิศวะ @arch · สรุป→ต้น/ผู้ใช้' },
  ],
}

const A = typeof args === 'string' ? JSON.parse(args) : args
const DEFAULT_BASE = 'https://viral-content-system.vercel.app'
const validateBase = (base) => {
  try {
    const url = new URL(base)
    return url.protocol === 'https:' ? base : null
  } catch (_e) {
    return null
  }
}
const baseFromArgs = (A && A.base) || DEFAULT_BASE
const BASE = validateBase(baseFromArgs) || (() => {
  if (baseFromArgs !== DEFAULT_BASE) {
    log(`⚠️ BASE URL ไม่ถูกรูป (ต้องเป็น https://...): ${baseFromArgs} — ใช้ค่าดีฟอลต์: ${DEFAULT_BASE}`)
  }
  return DEFAULT_BASE
})()
const RUN = String((A && A.runId) || 'audit')
const DIR = 'public/company/departments/newsdesk'
const ENG = 'public/company/departments/engineering'

phase('ตรวจผลจริง')
const audit = await agent(
  'คุณคือ "ริน" (@rin) ผู้ตรวจการ/เก็บคลัง แผนกโต๊ะข่าว Fable & Co. เนี้ยบ จดทุกอย่าง ตามจนได้คำตอบ.\n' +
  '1. อ่านคลัง ' + DIR + '/archive/jobs.md — หางานที่ยังไม่ปิด (⏳) หรือมี jobId ที่ควรตามผล\n' +
  '2. เช็คของจริง (read-only เท่านั้น ห้าม POST):\n' +
  '   - คิวเขียน: curl -sS -m 25 "' + BASE + '/api/queue/status" แล้วหา jobId ที่อยู่ในคลัง (เช็คสถานะ: รอ/กำลังเขียน/เสร็จ/ตาย)\n' +
  '   - ลีดที่เคยส่ง: curl -sS -m 25 "' + BASE + '/api/desk/research/leads?status=sent&limit=20" เทียบกับคลัง\n' +
  '3. อัปเดต ' + DIR + '/archive/jobs.md: งานที่รู้ผลแล้วแก้บรรทัดเป็น ✅/❌ + รายละเอียดจริง, งานที่ยังรอเติม ⏳ + สถานะล่าสุด, งานใหม่ที่ระบบมีแต่คลังไม่มีให้เพิ่มบรรทัด\n' +
  '4. append 1 บรรทัดลง ' + DIR + '/worklog.md: "- [ตรวจ ' + RUN + '] ริน ตรวจ N งาน: ✅x ❌y ⏳z"\n' +
  'ห้ามแตะไฟล์อื่น. ตอบ structured: checked, ok, failed, pending, problems[] (รายการปัญหาที่ต้องส่งวิศวะ: {job, cause})',
  { label: 'ตรวจ:rin', phase: 'ตรวจผลจริง', model: 'haiku', effort: 'low',
    schema: { type: 'object', properties: {
      checked: { type: 'number' }, ok: { type: 'number' }, failed: { type: 'number' }, pending: { type: 'number' },
      problems: { type: 'array', items: { type: 'object', properties: { job: { type: 'string' }, cause: { type: 'string' } }, required: ['job', 'cause'] } } },
      required: ['checked', 'ok', 'failed', 'pending', 'problems'] } })

phase('รายงาน')
if (audit && audit.problems && audit.problems.length) {
  log('พบปัญหา ' + audit.problems.length + ' งาน → รายงานทีมวิศวะ')
  await agent(
    'คุณคือ "ริน" (@rin) ผู้ตรวจการแผนกโต๊ะข่าว. รายงานปัญหาให้ทีมวิศวะ (ทุกการสื่อสารต้องมีบันทึก):\n' +
    'ปัญหา: ' + JSON.stringify(audit.problems).slice(0, 600) + '\n' +
    '1. append ลง ' + ENG + '/comm-log.md บรรทัดละปัญหา: "[' + RUN + '] @arch: <งาน> พัง — <สาเหตุ> (จากคลังแผนกโต๊ะข่าว รอวินิจฉัย)"\n' +
    '2. append ลง ' + DIR + '/comm-log.md 1 บรรทัด: "[' + RUN + '] @ton: รายงานปัญหา N งานให้ทีมวิศวะแล้ว → engineering/comm-log.md"\n' +
    'ห้ามแตะไฟล์อื่น. ตอบสั้น: ส่งรายงานกี่เรื่อง',
    { label: 'รายงานวิศวะ:rin', phase: 'รายงาน', model: 'haiku', effort: 'low' })
} else {
  log('ไม่พบปัญหาใหม่')
}

return {
  runId: RUN,
  checked: audit ? audit.checked : 0, ok: audit ? audit.ok : 0, failed: audit ? audit.failed : 0, pending: audit ? audit.pending : 0,
  reportedToEngineering: audit && audit.problems ? audit.problems.length : 0,
  archivePath: DIR + '/archive/jobs.md',
}
