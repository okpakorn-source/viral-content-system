export const meta = {
  name: 'newsdesk-hunt',
  description: 'วางแผนล่าข่าว — ต้น (ผอ.) วางธีม+คีย์เวิร์ด → brief ให้มด (ยิงค้นจริงรอ @phupha อนุมัติ)',
  phases: [{ title: 'วางแผนล่า', detail: 'ต้น (Sonnet) วางธีม+ช่องทาง', model: 'sonnet' }],
}

const A = typeof args === 'string' ? JSON.parse(args) : args
const RUN = String((A && A.runId) || 'latest')
const THEME = (A && A.theme) || '(ผอ.เลือกเองตามกระแสวันนี้)'
const DIR = 'public/company/departments/newsdesk'

phase('วางแผนล่า')
const plan = await agent(
  'คุณคือ "ต้น" ผอ.ข่าว แผนกโต๊ะข่าว Fable & Co. (คู่ระบบโต๊ะข่าว v2). มองภาพใหญ่ วางเป็นธีม ตัดสินไว.\n' +
  'โจทย์วันนี้: ' + THEME + '\n' +
  'ช่องทางที่ยิงค้นได้: วิดีโอ, Facebook, FB Reels, TikTok, YouTube, Google\n' +
  'แนวข่าวระบบ: คลิปสัมภาษณ์คนดัง / ข่าวน้ำดี-ช่วยเหลือ / ชีวิตคน-สังคม / ไลฟ์สไตล์-ไวรัล\n\n' +
  'วางแผนล่ารอบ runId=' + RUN + ' แล้วเขียนไฟล์ (UTF-8, append ห้ามลบเดิม):\n' +
  '1. ' + DIR + '/runs/hunt-' + RUN + '.md — brief ล่า: 2-4 ธีม แต่ละธีมมี ชื่อธีม/เหตุผลสั้น/คีย์เวิร์ด 3-6 คำ/ช่องทางแนะนำ\n' +
  '2. ' + DIR + '/comm-log.md — เพิ่ม 1-2 บรรทัดสั่งมด เช่น "[n] @mod: รีเฟรชธีม X ช่องทาง Y คีย์เวิร์ด Z — รอ @phupha อนุมัติก่อนยิงจริง"\n' +
  '3. ' + DIR + '/worklog.md — เพิ่ม 1 บรรทัด "- [ล่า ' + RUN + '] ต้นวางแผน N ธีม → มด"\n' +
  'ห้ามแตะไฟล์อื่น. ตอบ structured: themes[{name, keywords, channels, why}], briefForMod',
  { label: 'วางแผนล่า:ton', phase: 'วางแผนล่า', model: 'sonnet', effort: 'medium',
    schema: { type: 'object', properties: {
      themes: { type: 'array', items: { type: 'object', properties: {
        name: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } },
        channels: { type: 'array', items: { type: 'string' } }, why: { type: 'string' } }, required: ['name', 'keywords', 'channels', 'why'] } },
      briefForMod: { type: 'string' } }, required: ['themes', 'briefForMod'] } })

return {
  runId: RUN,
  briefPath: DIR + '/runs/hunt-' + RUN + '.md',
  themes: plan ? plan.themes : [],
  note: 'มด "ยิงค้นจริง" ต้องรอ @phupha อนุมัติ brief นี้ก่อน (ห้าม auto)',
}
