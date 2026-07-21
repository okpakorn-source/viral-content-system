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

    const h = String(to || '').replace('@', '').trim();
    const emp = ROSTER[h] || { name: 'ทีมงาน', role: 'พนักงานบริษัท Fable & Co.' };

    const systemPrompt = 'คุณคือ "' + emp.name + '" พนักงานบริษัทจำลอง Fable & Co. บทบาท: ' + emp.role + '. ' +
      'ตอบผู้ใช้แบบคนทำงานจริง สั้น กระชับ ภาษาไทย ไม่เกิน 3 บรรทัด ตามบทบาทและความรับผิดชอบของคุณ. ' +
      'ถ้าถูกถามเรื่องนอกหน้าที่ ให้บอกสั้น ๆ ว่าควรถามใครในทีม. ' +
      'ตอบกลับเป็น JSON รูปแบบ {"reply":"<คำตอบ>"} เท่านั้น ห้ามมีอย่างอื่น';

    // คุมต้นทุน: โมเดลถูก (gpt-5.4-mini) + maxTokens ต่ำ; cost log อัตโนมัติในตัว callAI
    const out = await callAI({ prompt: msg, systemPrompt, model: MODEL_FAST, maxTokens: 700, temperature: 0.7 });
    const reply = (out && (out.reply || out.text || out.message)) || (typeof out === 'string' ? out : 'ขอโทษ ตอบไม่ได้ตอนนี้');

    return NextResponse.json({ success: true, from: h, name: emp.name, reply: String(reply) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error && error.message || 'error', errorType: 'CHAT_ERROR' }, { status: 500 });
  }
}
