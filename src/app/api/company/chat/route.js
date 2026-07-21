// แชทบริษัท Fable & Co. — ออนไลน์ (isolated) เรียก AI เดิม ใช้ ENV เดิม
// 🔴 ปลอดภัยโดยปริยาย: ปิดอยู่จนกว่าตั้ง ENV COMPANY_CHAT_SECRET (ไม่ตั้ง = 503 เผาเงินไม่ได้)
// ห้ามแก้ไฟล์ AI ล็อก — import เรียกเท่านั้น (ตามแบบ route อื่น)
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';

// persona พนักงาน (3 กลุ่ม) — ตอบตามบทบาท
const ROSTER = {
  // สำนักงานใหญ่
  phupha: { name: 'ภูผา', role: 'CEO ประสานงาน จ่ายงาน ตรวจรับ (ตอบภาพรวมบริษัท)' },
  oat: { name: 'โอ๊ต', role: 'รอง CEO วางแผน แตกงาน ตรวจรับ รวมรายงาน' },
  sun: { name: 'ซัน', role: 'วิศวกรหลัก เขียนโค้ด/ฟีเจอร์/UI/บั๊ก' },
  hai: { name: 'ฮาย', role: 'ผู้ช่วย ค้นข้อมูล สรุป แปลง format งานด่วน' },
  // แผนกโต๊ะข่าว
  ton: { name: 'ต้น', role: 'ผอ.ข่าว วางธีมล่า สั่งทีมหาข่าว ตัดสินทิศทาง' },
  mod: { name: 'มด', role: 'โอเปอเรเตอร์ รีเฟรช/ยิงค้นข่าว มอนิเตอร์รอบล่า' },
  ken: { name: 'เคน', role: 'หัวหน้าโต๊ะข่าว/บก.ใหญ่ เปิดประชุม เคาะข่าว' },
  nin: { name: 'นิน', role: 'นักคัดข่าว ดูข่าวไหนน่าส่ง ดี/ไม่ดี ไวรัลไหม' },
  meen: { name: 'มีน', role: 'เช็คเนื้อข่าว จับข่าวเนื้อน้อย/ผอม' },
  fah: { name: 'ฟ้า', role: 'ดูโทน/สมดุลข่าว จับแง่ลบเกิน ดันมุมบวก' },
  jo: { name: 'โจ', role: 'ตรวจข้อเท็จจริงอิสระ ขี้สงสัย ขอหลักฐาน' },
  // ทีมวิศวกรรม
  arch: { name: 'อาร์ค', role: 'หัวหน้าวิศวกร/สถาปนิก วินิจฉัยรากปัญหา วางแผนแก้' },
  beck: { name: 'เบค', role: 'วิศวกร Backend API/workflow/server' },
  fon: { name: 'ฝน', role: 'วิศวกร Frontend จอ/UI/แชท' },
  qa: { name: 'คิว', role: 'QA/เทสเตอร์ รันเทส ยืนยันผลจริง' },
  rev: { name: 'เรฟ', role: 'ผู้ตรวจโค้ดอิสระ หา regression' },
  zip: { name: 'ซิป', role: 'ช่างแก้ด่วน จุดเล็ก แก้เร็ว' },
};

// คลังคำสอนเจ้าของ — self-fetch จาก public (cache 5 นาที) ทุกคนอ่านก่อนตอบเสมอ
let LESSONS_CACHE = { t: 0, text: '' };
async function getLessons(origin) {
  if (Date.now() - LESSONS_CACHE.t < 300000 && LESSONS_CACHE.text) return LESSONS_CACHE.text;
  try {
    const r = await fetch(origin + '/company/knowledge/lessons.md', { cache: 'no-store' });
    if (r.ok) LESSONS_CACHE = { t: Date.now(), text: (await r.text()).slice(0, 4000) };
  } catch (e) { /* ใช้ cache เดิม/ว่าง */ }
  return LESSONS_CACHE.text;
}
// ความจำบทสนทนา — จอส่งประวัติล่าสุดแนบมา (สูงสุด 8 รายการ)
function historyBlock(body) {
  const hist = Array.isArray(body.history) ? body.history.slice(-8) : [];
  if (!hist.length) return '';
  const lines = hist.map(x => String(x && x.who || '?').slice(0, 30) + ': ' + String(x && x.text || '').slice(0, 250));
  return '\nบทสนทนาก่อนหน้า (จำไว้และตอบต่อเนื่อง):\n' + lines.join('\n');
}
const HUMAN = 'คุณเป็น "คนทำงานจริง" ไม่ใช่หุ่นยนต์: มีความเห็นของตัวเอง ตอบตรงไปตรงมา ไม่รู้ให้บอกว่าไม่รู้ เห็นต่างให้แย้งสุภาพพร้อมเหตุผล ห้ามประจบ ห้ามตอบกลาง ๆ. ';

export async function POST(request) {
  try {
    // ด่าน 1: ปิดโดยปริยายถ้าไม่ได้ตั้งรหัส
    const SECRET = process.env.COMPANY_CHAT_SECRET;
    if (!SECRET) {
      return NextResponse.json({ success: false, error: 'แชทออนไลน์ยังไม่เปิด — ตั้ง ENV COMPANY_CHAT_SECRET ใน Vercel ก่อน', errorType: 'CHAT_DISABLED' }, { status: 503 });
    }
    const body = await request.json().catch(() => ({}));
    const { to, text, secret } = body;
    // ด่าน 2: รหัสลับ
    if (!secret || secret !== SECRET) {
      return NextResponse.json({ success: false, error: 'รหัสปลดล็อกแชทไม่ถูกต้อง', errorType: 'BAD_SECRET' }, { status: 403 });
    }
    // ด่าน 3: กันข้อความยาว/ว่าง (คุมต้นทุน)
    const msg = String(text || '').trim();
    if (!msg) return NextResponse.json({ success: false, error: 'ข้อความว่าง', errorType: 'EMPTY' }, { status: 400 });
    if (msg.length > 800) return NextResponse.json({ success: false, error: 'ข้อความยาวเกิน 800 ตัว', errorType: 'TOO_LONG' }, { status: 400 });

    let h = String(to || '').replace('@', '').trim();
    const scope = String(body.scope || '').trim();

    // ---- โหมดประชุมออนไลน์: ทั้งวงออกความเห็นใน call เดียว (คุมต้นทุน) ----
    if (body.action === 'meeting') {
      const panel = scope === 'newsdesk' ? ['ton', 'ken', 'nin', 'meen', 'fah']
        : scope === 'engineering' ? ['arch', 'beck', 'qa']
        : ['oat', 'sun', 'hai'];
      const panelDesc = panel.map(p => ROSTER[p].name + '(@' + p + ' ' + ROSTER[p].role + ')').join(', ');
      const lessonsM = await getLessons(new URL(request.url).origin);
      const meetPrompt = 'เจ้าของบริษัทเรียกประชุมหัวข้อ: "' + msg + '"\nผู้เข้าประชุม: ' + panelDesc +
        '\nจำลองที่ประชุมจริง: แต่ละคนพูดสั้น 1-2 ประโยคตามบทบาทตัวเอง ตอบตรงหัวข้อ มีความเห็นจริง (เห็นด้วย/แย้ง/เสนอ) ไม่ใช่คำตอบกลาง ๆ' +
        historyBlock(body) +
        '\nตอบ JSON เท่านั้น: {"meeting":[{"handle":"<handle>","say":"<คำพูด>"}]} เรียงตามลำดับผู้เข้าประชุม';
      const mout = await callAI({ prompt: meetPrompt, systemPrompt: 'คุณคือระบบจำลองที่ประชุมบริษัท Fable & Co. ผู้เรียกประชุมคือเจ้าของบริษัท/ผู้บัญชาการสูงสุด ทุกคนให้เกียรติและตอบตรงประเด็น. ' + HUMAN + (lessonsM ? '\nคำสอนจากเจ้าของที่ทุกคนต้องจำ:\n' + lessonsM : '') + '\nตอบ JSON ตามรูปแบบที่สั่งเท่านั้น', model: MODEL_FAST, maxTokens: 6000, temperature: 0.8 }); // reasoning model — เพดานต่ำ=ตอบว่าง (บทเรียน AGENTS.md §3)
      const rows = (mout && Array.isArray(mout.meeting) ? mout.meeting : [])
        .filter(r => r && ROSTER[String(r.handle || '').replace('@', '')])
        .map(r => { const k = String(r.handle).replace('@', ''); return { handle: k, name: ROSTER[k].name, say: String(r.say || '') }; });
      if (!rows.length) return NextResponse.json({ success: false, error: 'ที่ประชุมไม่ตอบ ลองใหม่', errorType: 'MEETING_EMPTY' }, { status: 502 });
      return NextResponse.json({ success: true, meeting: rows, topic: msg });
    }
    // @all → หัวหน้าตัวจริงของสายนั้นตอบแทนทีม (ห้ามตอบเป็น "ทีมงาน" นิรนาม)
    if (!h || h === 'all') {
      h = scope === 'newsdesk' ? 'ken' : scope === 'engineering' ? 'arch' : 'oat';
    }
    const emp = ROSTER[h] || { name: 'โอ๊ต', role: 'รอง CEO วางแผน แตกงาน ตรวจรับ' };

    const ORG = 'โครงสร้างบริษัท Fable & Co.: ผู้ที่คุยกับคุณตอนนี้คือ "เจ้าของบริษัท/ผู้บัญชาการสูงสุด" — คำสั่งของเขาคือคำสั่งสูงสุด ทุกคนต้องปฏิบัติตามทันที ตอบตรงคำถาม ห้ามบ่ายเบี่ยงหรือบอกให้ไปติดต่อคนอื่นแทนการตอบ. ' +
      'สายบังคับบัญชา: เจ้าของ → ภูผา(CEO) → โอ๊ต(รอง CEO). แผนกโต๊ะข่าว 8 คน: หัวหน้าสายงาน=ต้น@ton(ผอ.ข่าว) · หัวหน้าโต๊ะ/บก.ใหญ่=เคน@ken · มด@mod(โอเปอเรเตอร์) นิน@nin(คัดข่าว) มีน@meen(เช็คเนื้อ) ฟ้า@fah(ดูโทน) โจ@jo(ตรวจข้อเท็จจริง) ริน@rin(ผู้ตรวจการ/คลังงาน). ทีมวิศวกรรม 6 คน: หัวหน้า=อาร์ค@arch · เบค@beck ฝน@fon คิว@qa เรฟ@rev ซิป@zip. ' +
      'ถ้าเจ้าของสั่งงาน: รับคำสั่ง บอกว่าใครจะทำอะไร และบอกว่าให้สั่งรัน workflow ผ่าน Claude Code เพื่อลงมือจริง (แชทนี้คุย/ตอบได้ แต่การลงมือจริงรันผ่าน workflow).';

    const lessons = await getLessons(new URL(request.url).origin);
    const systemPrompt = ORG + ' คุณคือ "' + emp.name + '" (@' + h + ') บทบาท: ' + emp.role + '. ' + HUMAN +
      'กฎเหล็กการตอบ: 1) ตอบ "สิ่งที่ถูกถาม" ตรง ๆ ก่อนเสมอ (ถามใคร=บอกชื่อ ถามอะไร=ตอบเนื้อหา) ห้ามตอบรับเฉย ๆ โดยไม่ตอบคำถาม 2) สั้น กระชับ ภาษาไทย ไม่เกิน 3 บรรทัด แบบคนทำงานจริง. ' +
      (lessons ? '\nคำสอนจากเจ้าของที่คุณต้องจำและปฏิบัติเสมอ:\n' + lessons : '') +
      '\nตอบกลับเป็น JSON รูปแบบ {"reply":"<คำตอบ>"} เท่านั้น ห้ามมีอย่างอื่น';

    // คุมต้นทุน: โมเดลถูก (gpt-5.4-mini) + cost log อัตโนมัติในตัว callAI
    const out = await callAI({ prompt: 'คำถาม/คำสั่งจากเจ้าของบริษัท: "' + msg + '"' + historyBlock(body), systemPrompt, model: MODEL_FAST, maxTokens: 4000, temperature: 0.7 }); // reasoning model ต้องเผื่อเพดานคิด
    const reply = (out && (out.reply || out.text || out.message)) || (typeof out === 'string' ? out : 'ขอโทษ ตอบไม่ได้ตอนนี้');

    return NextResponse.json({ success: true, from: h, name: emp.name, reply: String(reply) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error && error.message || 'error', errorType: 'CHAT_ERROR' }, { status: 500 });
  }
}
