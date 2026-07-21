// ครูจดคำสอน — กลั่นสิ่งที่เจ้าของสอน/คุยล่าสุด เข้าคลังคำสอนกลาง (พนักงานทุกคนจำทันที)
export const meta = {
  name: 'company-learn',
  description: 'กลั่นบทสนทนา/คำสอนเจ้าของ → อัปเดต public/company/knowledge/lessons.md',
  phases: [{ title: 'กลั่นคำสอน', detail: 'ฮาย (Haiku) อ่านแชท → เติมคลังคำสอน' }],
}

const A = typeof args === 'string' ? JSON.parse(args) : args
const EXTRA = (A && A.teach) ? String(A.teach) : ''   // เจ้าของสอนตรง ๆ ผ่าน args ก็ได้
const K = 'public/company/knowledge/lessons.md'

phase('กลั่นคำสอน')
const res = await agent(
  'คุณคือ "ฮาย" (@hai) ผู้ช่วย Fable & Co. หน้าที่: จดคำสอนเจ้าของเข้าคลังกลาง (ทุกคนใช้ร่วม)\n' +
  '1. อ่านคลังเดิม ' + K + '\n' +
  '2. อ่านบทสนทนาล่าสุด: public/company/office/chat.md และ public/company/departments/newsdesk/chat.md' +
  (EXTRA ? '\n3. คำสอนเพิ่มจากเจ้าของ (สำคัญสุด): "' + EXTRA + '"' : '') + '\n' +
  '4. กลั่นเฉพาะ "คำสอน/กติกา/ความชอบของเจ้าของ" ที่ยังไม่มีในคลัง (ไม่เอาเนื้อแชททั่วไป) → เติมลงหมวดที่เหมาะใน ' + K + ' หมวดละบรรทัดสั้น ๆ (Edit เดิม ห้ามลบของเก่า ห้ามซ้ำ)\n' +
  '5. append 1 บรรทัดลง public/company/office/log.md แจ้งว่าเรียนรู้อะไรเพิ่ม (รูปแบบ "- [วันที่ #n] 🧠 ...")\n' +
  'ถ้าไม่มีอะไรใหม่ = ไม่ต้องแก้คลัง แจ้งเฉย ๆ. ห้ามแตะไฟล์อื่น. ตอบ structured: added[] (บทเรียนที่เติม), note',
  { label: 'กลั่น:hai', phase: 'กลั่นคำสอน', model: 'haiku', effort: 'low',
    schema: { type: 'object', properties: { added: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } }, required: ['added', 'note'] } })

return { added: res ? res.added : [], note: res ? res.note : 'ล้มเหลว', lessonsPath: K, reminder: 'push ขึ้น main เพื่อให้พนักงานออนไลน์เห็นคำสอนใหม่' }
