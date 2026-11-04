// ============================================================
// 📝 ขั้น "บก.สามย่อหน้า" — ขั้นสุดท้ายก่อนบันทึก/ส่งงานให้พนักงาน (สาย TEXT เท่านั้น) · เปิดแล้วทำงานแทน บก.จัดหน้า
// ★ 4 พ.ย. 69 เจ้าของสั่ง: "ปรับระบบเจนของเราตอนส่งผลกลับมาในดิส ให้เป็นสามย่อหน้าแบบเดิม แต่จัดโครงสร้างประโยคให้อ่านแล้วเข้าใจ ใช้วรรคตอน เครื่องหมายถูกต้อง"
//   ที่มา: บก.จัดหน้า (28 ต.ค.) แก้ถ้อยคำไม่ได้และแตกโพสต์เป็น 4–7 ย่อหน้า · ฉบับก่อนจัดของ F2X เป็น 3 ย่อหน้าอยู่แล้ว 18/23 (ที่เหลือ 4 ย่อหน้า) · คลังตัวอย่าง 63/63 เป็น 3 ย่อหน้า
// ทำอะไร: Opus 5.5 อ่านโพสต์ + ข่าวดิบ → จัด 3 ย่อหน้า เกลาโครงสร้างประโยคเฉพาะจุดที่สะดุด + วรรคตอน → ด่านโค้ด (ตัวเลข/คำพูด/คำใหม่/คำสำคัญหาย) → GPT-5.6 Sol เทียบความหมายกับฉบับก่อนแก้ → ตัวจัดวรรคตอนโค้ดล้วน
// ปลอดภัย: ไม่ผ่านด่าน/ล้ม/หมดเวลา/เวลาไม่พอ = ไม่ใช้ถ้อยคำที่ AI แก้ → ใช้ถ้อยคำเดิม + รวมย่อหน้าที่เกินด้วยโค้ด (เปลี่ยนแค่ช่องว่างและเครื่องหมายนอกคำพูด · ไม่แบ่งย่อหน้าเอง เพราะแบ่งกลางใจความได้)
//   ผู้เรียกส่ง recheck = รันด่านโค้ดของท่อ (grounding/ข้อมูลหาย/เดาเพศ) ซ้ำกับฉบับใหม่ แย่ลง = ถอยทีละชั้น จนถึงฉบับเดิมทุกไบต์
//   สวิตช์ THREE_PARA_EDIT=1 เท่านั้นที่เปิด (ต้องเปิด LAYOUT_EDIT=1 อยู่ด้วย · ปิด = บก.จัดหน้าเดิมทุกไบต์) · เก็บฉบับก่อนแก้ไว้ใน _preLayoutContent
//   AI เกลาประโยคเปิดเฉพาะ THREE_PARA_AI=1 (ค่าเริ่มต้นปิด = ไม่เรียก AI · 3 ย่อหน้า + วรรคตอนด้วยโค้ดล้วน ถ้อยคำเดิมทุกคำ)
//     ผู้ตรวจอิสระรอบ 3: โหมดปิด AI = PASS มีเงื่อนไข (ถ้อยคำเดิม 156/156) · โหมด AI = FAIL จนกว่าจะวัด gpt-5.6-sol ตัวจริงและปิดรูด่านคำ
//   ★ ผู้ตรวจอิสระ 4 พ.ย. FAIL รอบ 1: ด่านโค้ดปล่อย "ไม่ได้ตั้งใจ→ตั้งใจ" · "5 พันล้าน→5 พัน" · "5 ปี→5 เดือน" · ผลตรวจรูปแบบแปลก = ผ่าน · คำพูดปิดผิดข้าง · แบ่งย่อหน้ากลางใจความ → แก้ทั้งหมดในไฟล์นี้
//     FAIL รอบ 2: ข่าวจริงเติมผู้กระทำ "โดยบุ๋มซื้อต่อ" ที่ดิบไม่บอก · ตัด "ซึ่ง" จนคำเรียกสองคนชิดกัน · ด่านคำจับได้เฉพาะคำในตาราง → คำสั่งใหม่ + ชุดคำเท่าเดิม + คู่เลขกับคำถัดไป
//     ด่านโค้ดเป็นตะแกรงหยาบ ไม่ใช่หลักฐานว่าความหมายปลอดภัย: เคสสลับคนต้องพึ่งตัวตรวจ AI
// ============================================================
import { withTimeoutSignal } from '@/lib/utils/withTimeout';
import { sanitizeOutput } from '@/lib/ai/safetyFilter';
import { countPublishableThaiWords } from '@/lib/utils/publishablePostText'; // ตัวนับเดียวกับด่านความยาว
import { getActivePipelineDeadline } from '../utils/pipelineDeadline.js'; // ทางเดียวกับ layoutEditor = โมดูลเส้นตายตัวเดียวกัน
import { callLayoutModel, parseLayoutReply, tidyLayout, LAYOUT_MIN_WORDS, LAYOUT_DEFAULT_RESERVE_MS } from '@/lib/services/layoutEditor';
import { callF2xChecker, splitF2xIssues } from '@/lib/services/f2xWriter';

const STAGE_TIMEOUT_MS = 110_000; // ทุกฉบับขนานกัน · ต่อฉบับ = เกลา + ตรวจความหมาย
const MIN_STAGE_MS = 35_000;      // เวลาที่เหลือน้อยกว่านี้ = ไม่เรียก AI (ยังรวมย่อหน้าด้วยโค้ด)
const MIN_LENGTH_RATIO = 0.85;
const MAX_LENGTH_RATIO = 1.25;
const MAX_LOST_WORDS = 6;         // คำเนื้อหาที่หายได้ต่อฉบับ (เกลาจริง 12 ฉบับหาย ≤ค่านี้ · ตัดทั้งประโยค = เกิน)

export function isThreeParaEditEnabled() {
  return String(process.env.THREE_PARA_EDIT ?? '').trim().replace(/^["']|["']$/g, '') === '1';
}

/** THREE_PARA_AI=1 เท่านั้นที่เรียก AI เกลาประโยค · พิมพ์ผิด/ไม่ตั้ง = ปิด (ผู้ตรวจรอบ 3: โหมด AI ยังไม่ผ่าน ห้ามเปิดเพราะลืมตั้งสวิตช์) */
export function isThreeParaAiEnabled() {
  return String(process.env.THREE_PARA_AI ?? '').trim().replace(/^["']|["']$/g, '') === '1';
}

export const SYS_THREE_PARA = `คุณคือบรรณาธิการขั้นสุดท้ายของเพจข่าว "รวมไอจีดารา" ก่อนส่งโพสต์ให้พนักงานนำไปลง Facebook
เป้าหมาย: โพสต์เป็น 3 ย่อหน้า คนอ่านเข้าใจถูกตั้งแต่อ่านรอบแรก โดยยังเป็นเรื่องเดิม น้ำเสียงเดิมของแอดมินเพจ

ขั้น 1 อ่านโพสต์และข่าวดิบจนตอบได้ว่า เรื่องนี้ของใคร ใครทำอะไรกับใคร อะไรเกิดก่อนหลัง และใครเป็นคนพูด

ขั้น 2 จัดเป็น 3 ย่อหน้าพอดี คั่นด้วยบรรทัดว่าง 1 บรรทัด ภายในย่อหน้าห้ามขึ้นบรรทัดใหม่
- ย่อหน้า 1 เปิดเรื่องและใจความหลัก คงประโยคเปิดเดิมไว้ เว้นแต่อ่านแล้วไม่เข้าใจ
- ย่อหน้า 2 รายละเอียดตามลำดับเรื่อง
- ย่อหน้า 3 ปิดเรื่อง คงประโยคปิดเดิมไว้

ขั้น 3 จัดโครงสร้างประโยค เฉพาะจุดที่อ่านแล้วสะดุดหรือไม่ชัด จุดที่ดีอยู่แล้วให้คงถ้อยคำเดิม ห้ามเขียนใหม่ทั้งโพสต์ และห้ามเปลี่ยนเป็นภาษาทางการ
- ประโยคยาวที่ซ้อนหลายใจความ ให้แยกเป็นประโยคสั้นลง
- เรียงให้เห็นชัดว่าใครทำอะไร ใครพูด ส่วนขยายต้องอยู่ติดคำที่มันขยาย
- ประโยคที่ไม่บอกว่าใครทำ ให้คงไว้แบบเดิม เติมชื่อคนได้เฉพาะเมื่อข่าวดิบเขียนชัดว่าคนนั้นเป็นผู้ทำการกระทำนั้น ถ้าไม่ชัดห้ามเติม
- ปรับคำเชื่อมเท่าที่จำเป็นให้ใจความต่อกัน ใช้ได้เฉพาะ แต่ และ ส่วน โดย ซึ่ง ห้ามเพิ่มคำบอกเหตุผล เช่น เพราะ จึง เนื่องจาก ทำให้ เลย จน
- ห้ามตัดคำเชื่อม ซึ่ง ที่ โดย หรือแยกประโยค ถ้าทำให้คำเรียกคนสองคนมาติดกันจนอ่านเป็นคนเดียว เช่น “ก๊อต” สามีบุ๋ม เจ้าของที่เปิดเผยว่า
- คงคำบอกเวลาและทิศทางเดิม เช่น ก่อน หลัง ขึ้น ลง จะ เคย กำลัง อดีต ถูก ให้ ได้ จาก ห้ามเปลี่ยนหรือตัด

ขั้น 4 วรรคตอนและเครื่องหมาย
- เว้นวรรคระหว่างประโยคและระหว่างใจความ ห้ามเว้นวรรคกลางคำ และห้ามเว้นวรรคซ้อน
- เว้นวรรคก่อนและหลังเครื่องหมายคำพูด “ ” และใช้คู่เปิดปิดให้ครบ
- เว้นวรรคระหว่างคำไทยกับตัวเลขหรือคำภาษาอังกฤษที่อยู่ติดกัน เช่น ปี 2540 และ ทีม CIB
- เว้นวรรคหลังคำย่อที่นำหน้าชื่อหรือเลข เช่น ร.ต.ท. สมภพ และ 9 ต.ค. 2569
- ไม้ยมกติดคำหน้า แล้วเว้นวรรคหลัง เช่น จริงๆ แล้ว
- ห้ามใช้ .. หรือ ... หรือเครื่องหมาย ! ? ซ้ำกัน ห้ามใช้จุดจบประโยค ใช้การเว้นวรรคแทน
- ใช้จุลภาคเฉพาะในตัวเลข

สิ่งที่ห้าม (ระบบตรวจตัวเลข คำพูด และคำใหม่ทุกจุด ถ้าผิดจะทิ้งฉบับที่คุณแก้ทันที)
- ห้ามเพิ่มข้อเท็จจริง ชื่อ ตัวเลข อายุ วันที่ สถานที่ เหตุการณ์ ความรู้สึก ความเห็น หรือข้อคิดที่โพสต์เดิมไม่มี และห้ามใช้คำใหม่ที่ไม่มีทั้งในโพสต์เดิมและข่าวดิบ
- ห้ามตัดข้อเท็จจริง ชื่อ ตัวเลข หรือคำพูดที่โพสต์เดิมมี
- ตัวเลขและหน่วยต้องเหมือนเดิมทุกจุด ห้ามเปลี่ยนจำนวน
- ข้อความใน “ ” ต้องเหมือนเดิมทุกตัวอักษร ห้ามเพิ่มเครื่องหมายคำพูดให้ข้อความที่เดิมไม่มี
- ข้อกล่าวหาหรือคำกล่าวอ้างต้องคงที่มาไว้ ห้ามทำให้กลายเป็นข้อเท็จจริงของเพจ และห้ามแยกผู้พูดออกจากสิ่งที่พูด
- ห้ามเปลี่ยนสรรพนามที่ใช้แทนบุคคล ห้ามเดาเพศ และห้ามเพิ่มคำที่บอกเพศ เช่น เธอ หนุ่ม สาว นาย นาง
- ห้ามสลับความหมาย เช่น ยืนยันกับปฏิเสธ ทำแล้วกับยังไม่ทำ ผู้กระทำกับผู้ถูกกระทำ และห้ามตัดหรือเพิ่มคำว่า ไม่
- ห้ามเติม และ คั่นคำเรียกกับชื่อคน เช่น พี่สาว น้องแก้ว เพราะจะอ่านเป็นคนละคน
- ห้ามใส่หัวข้อ สัญลักษณ์ markdown อีโมจิใหม่ หรือแฮชแท็ก
- ความยาวรวมใกล้เคียงโพสต์เดิม

ตอบในรูปแบบนี้เท่านั้น ห้ามมีข้อความอื่นนอกแท็ก
<understanding>เรื่องนี้คืออะไร ใครทำอะไร (1–2 ประโยค)</understanding>
<issues>จุดที่แก้และเหตุผล (สั้นๆ ถ้าไม่มีให้ตอบว่า ไม่มี)</issues>
<post>
โพสต์ 3 ย่อหน้า
</post>`;

export const SYS_THREE_PARA_CHECK = `คุณคือบรรณาธิการตรวจทานที่เข้มงวด "ฉบับแก้" ถูกเกลาภาษาจาก "ฉบับก่อนแก้" โดยต้องไม่เปลี่ยนเนื้อหา ข่าวดิบให้ไว้เป็นหลักฐานอ้างอิง
หาเฉพาะปัญหาที่ฉบับแก้สร้างขึ้นเมื่อเทียบกับฉบับก่อนแก้ อ่านทีละประโยคและถามว่าใครทำอะไรกับใคร
- ข้อมูลใหม่ที่ฉบับก่อนแก้ไม่มี: ชื่อ ตัวเลข อายุ วันที่ สถานที่ ความสัมพันธ์ เหตุการณ์ ความรู้สึก ความเห็น
- ความหมายเปลี่ยน: สลับคน สลับตัวเลขระหว่างคน สลับผู้กระทำกับผู้ถูกกระทำ สลับผู้พูด ยืนยันกลายเป็นปฏิเสธ ลำดับเหตุการณ์เปลี่ยน
- เหตุและผลใหม่: คำเชื่อมที่ทำให้สองเรื่องกลายเป็นเหตุและผลกัน ทั้งที่ฉบับก่อนแก้ไม่ได้บอก
- จำนวนคนเปลี่ยน: คำเชื่อมที่ทำให้คนเดียวกลายเป็นสองคน หรือสองคนกลายเป็นคนเดียว
- ผู้กระทำใหม่: ฉบับก่อนแก้ไม่ระบุว่าใครทำ แต่ฉบับแก้ระบุชื่อ และข่าวดิบไม่ได้เขียนตรงๆ ว่าคนนั้นทำ
- อ่านแล้วสับสนคน: คำเรียกคนสองคนมาติดกันจนอ่านรอบแรกเป็นคนเดียว
- ข้อกล่าวหาหรือคำกล่าวอ้างกลายเป็นข้อเท็จจริง เพราะที่มาหายหรือผู้พูดเปลี่ยน
- ข้อเท็จจริงหรือคำพูดที่ฉบับก่อนแก้มี แต่ฉบับแก้หายไป
ไม่นับ: การเรียงประโยคใหม่ การแยกประโยค และวรรคตอน ที่ความหมายเท่าเดิม · ปัญหาที่ฉบับก่อนแก้มีอยู่แล้ว
severity: "หนัก" = เนื้อหาหรือความหมายเปลี่ยนจริง · "เบา" = ถ้อยคำต่างเล็กน้อย ความหมายเท่าเดิม
ตอบ JSON เท่านั้น: {"issues":[{"text":"ข้อความในฉบับแก้","why":"สั้นๆ","severity":"หนัก|เบา"}]} (ไม่มี = [])`;

// คู่เครื่องหมายคำพูด: ยอมรับคู่ที่ปิดผิดข้าง (“…“) เพราะงานจริงเจอ · " ที่ตามหลังตัวเลขคือหน่วยนิ้ว ไม่ใช่เครื่องหมายเปิด
const QUOTE_RE = /(?:[“”]|(?<!\d)")([^“”"\n]+)[“”"]|‘([^‘’\n]+)’(?![A-Za-z])/gu;
const QUOTE_SPLIT = /((?:[“”]|(?<!\d)")[^“”"\n]*[“”"]|‘[^‘’\n]*’(?![A-Za-z]))/u;
const squeeze = (s) => String(s || '').replace(/\s+/gu, '');
const stripQuotes = (s) => String(s || '').replace(QUOTE_RE, ' ');
const THAI_DIGIT_ZERO = '๐'.codePointAt(0);
const toArabic = (s) => String(s || '').replace(/[๐-๙]/gu, (d) => String(d.codePointAt(0) - THAI_DIGIT_ZERO));
const sorted = (list) => [...list].sort();
const sameList = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const diffList = (a, b) => { const rest = [...b]; return a.filter((x) => { const k = rest.indexOf(x); if (k < 0) return true; rest.splice(k, 1); return false; }); };
const countOf = (text, needle) => (needle instanceof RegExp ? (String(text || '').match(needle) || []).length : String(text || '').split(needle).length - 1);

/** ข้อความในเครื่องหมายคำพูดทั้งหมด (ไม่นับช่องว่าง) */
export const quotesOf = (text) => [...String(text || '').matchAll(QUOTE_RE)].map((m) => squeeze(m[1] ?? m[2])).filter(Boolean);

/** คำภาษาอังกฤษทั้งหมด (ชื่อหน่วยงาน/แบรนด์) — แปลงตัวพิมพ์เป็นเล็ก */
export const latinOf = (text) => [...String(text || '').matchAll(/[A-Za-z][A-Za-z0-9'’-]*/gu)].map((m) => m[0].toLowerCase());

let _seg = null;
const allTokens = (text) => [...(_seg ||= new Intl.Segmenter('th', { granularity: 'word' })).segment(toArabic(text))].filter((x) => x.isWordLike).map((x) => x.segment);
const NUMBER_TOKEN = /^\d[\d,.:/-]*$/u;
const wordsOf = (text) => allTokens(text).filter((w) => !NUMBER_TOKEN.test(w) && !/^[A-Za-z]/u.test(w));

// ด่านคำ: จำนวนต้องเท่าเดิมทุกตัว (เติม/ตัดตัวเดียวความหมายกลับ) · ชุดนี้นับแบบข้อความ
const EXACT_WORDS = ['ไม่', 'ห้าม', 'ไร้', 'ปฏิเสธ', 'ยืนยัน', 'กล่าวหา', 'อ้าง', 'อย่างน้อย', 'ร้องเรียน'];
// ชุดนี้นับเป็นคำ เพราะเป็นส่วนของคำอื่นได้ ("บอกว่า" มี กว่า · "อย่าง" มี อย่า · "เรื่องราว" มี ราว — เจอจากข่าวจริง)
//   แถวสอง: คำบอกเวลา/สถานะ/ทิศทาง สลับแล้วความหมายกลับ (ก่อน↔หลัง · ขึ้น↔ลง · ให้↔ได้ · จะฟ้อง→ฟ้อง · อดีตสามี→สามี · ถูกชก→ชก)
const EXACT_TOKENS = ['อย่า', 'ล้าน', 'แสน', 'หมื่น', 'พัน', 'ร้อย', 'กว่า', 'เกือบ', 'ราว', 'ประมาณ',
  'อดีต', 'ถูก', 'เคย', 'กำลัง', 'เตรียม', 'กล่าว', 'รายงาน', 'ลือ', 'เหมือน', 'หรือ', 'ก่อน', 'หลัง', 'ขึ้น', 'ลง', 'เลย', 'จน', 'จะ', 'ให้', 'จาก', 'ได้', 'แค่', 'สรุป', 'ตาม'];
// คำเรียกตามด้วย "และ" ใหม่ = คนเดียวอ่านเป็นสองคน (พี่สาว น้องแก้ว → พี่สาว และน้องแก้ว)
const SPLIT_PERSON = /(?:พี่สาว|พี่ชาย|น้องสาว|น้องชาย|ลูกสาว|ลูกชาย|ภรรยา|สามี|เพื่อน|แฟน|พ่อ|แม่)\s*และ/gu;
// ห้ามลด: ที่มาของข้อมูล ความไม่แน่นอน และเครือญาติ (พ่อ→แม่)
const KEEP_WORDS = ['ระบุ', 'เผย', 'แฉ', 'เล่า', 'บอก', 'แถลง', 'ซัด', 'อาจ', 'น่าจะ', 'คาดว่า', 'เชื่อว่า', 'สงสัย', 'พ่อ', 'แม่', 'สามี', 'ภรรยา', 'เมีย', 'ผัว', 'ปู่', 'ลุง', 'ป้า', 'หลาน', 'ลูก'];
// ห้ามเพิ่ม: คำบอกเหตุผล (สร้างเหตุและผลใหม่) และคำบอกเพศ (AGENTS ข้อ 10)
const NO_MORE_WORDS = ['เพราะ', 'จึง', 'เนื่องจาก', 'ทำให้', 'ส่งผลให้', 'เธอ', 'หนุ่ม', 'นาย', 'นาง', 'ผู้ชาย', 'ผู้หญิง'];
const NUMBER_WORDS = new Set(['หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ', 'ยี่สิบ']);
// คำไวยากรณ์ที่ บก. เติมได้โดยไม่เพิ่มเนื้อหา · และหายได้โดยไม่เสียเนื้อหา
const FUNCTION_WORDS = new Set(['แต่', 'และ', 'ก็', 'ก็ได้', 'บอก', 'ที่', 'ซึ่ง', 'โดย', 'ว่า', 'ของ', 'ใน', 'การ', 'ความ', 'คือ', 'เป็น', 'ได้', 'ให้', 'ไป', 'มา', 'อยู่', 'แล้ว', 'ยัง', 'อีก', 'ทั้ง', 'ส่วน', 'ก่อน', 'จะ', 'ก่อนจะ', 'หลัง', 'เมื่อ', 'ตอน', 'ตอนนั้น', 'นั้น', 'นี้', 'ครั้ง', 'ครั้งนี้', 'จน', 'กับ', 'ถึง', 'เขา', 'ตน', 'ตัว', 'เอง', 'ตัวเอง', 'ด้วย', 'พร้อม', 'ใช้', 'ต่อ', 'แก่', 'ผู้', 'นี่', 'นั่น', 'เลย', 'ไว้', 'ลง', 'ขึ้น', 'ออก', 'เพียง', 'แค่', 'เช่น', 'หรือ', 'รวมถึง', 'อีกทั้ง', 'เพียงแต่', 'ต้อง', 'มี', 'เมื่อก่อน', 'เหมือน', 'แบบ', 'ตาม', 'จาก', 'ย้อน', 'กลับ', 'ไม้', 'สำหรับ', 'แล้วก็', 'ทว่า', 'นั้นเอง']);

/** คู่ตัวเลขกับคำถัดไปนอกคำพูด เช่น 1500|คน · 5|ปี · 2|ไร่ (กัน 5 ปี→5 เดือน · 2 ไร่→2 แปลง โดยไม่ต้องมีรายการหน่วย) · คำถัดไปเป็นคำไวยากรณ์ = ไม่นับคำนั้น · เลขไทยแปลงเป็นอารบิก */
export const numbersOf = (text) => {
  const tokens = allTokens(stripQuotes(text));
  const out = [];
  tokens.forEach((w, i) => {
    if (!NUMBER_TOKEN.test(w)) return;
    const next = tokens[i + 1] || '';
    out.push(`${w.replace(/,/gu, '')}|${FUNCTION_WORDS.has(next) || NUMBER_TOKEN.test(next) ? '' : next}`);
  });
  return out;
};

/** คำใหม่ที่เกิดจากการตัดคำ ไม่ใช่คำใหม่จริง: "โดยก๊อต" ถูกตัดเป็น โด|ยก๊อต (เจอจากข่าวจริง) — เป็นเศษของคำไวยากรณ์ หรือครึ่งหนึ่งอยู่ในโพสต์เดิม อีกครึ่งเป็นเศษของคำไวยากรณ์ */
function isSegmentArtifact(word, beforeFlat) {
  if ([...FUNCTION_WORDS].some((f) => f.startsWith(word) || f.endsWith(word))) return true;
  for (let k = 1; k < word.length; k++) {
    const head = word.slice(0, k), tail = word.slice(k);
    if (tail.length >= 2 && beforeFlat.includes(tail) && [...FUNCTION_WORDS].some((f) => f.endsWith(head))) return true;
    if (head.length >= 2 && beforeFlat.includes(head) && [...FUNCTION_WORDS].some((f) => f.startsWith(tail))) return true;
  }
  return false;
}

/** เทียบคำนอกเครื่องหมายคำพูด (คำพูดมีด่านของตัวเอง) · คืนเหตุที่ไม่ผ่าน */
export function checkWordChanges(before, after, rawText = '') {
  const reasons = [];
  const B = stripQuotes(before), A = stripQuotes(after);
  const wb = wordsOf(B), wa = wordsOf(A);
  for (const w of EXACT_WORDS) { const b = countOf(B, w), a = countOf(A, w); if (a !== b) reasons.push(`คำสำคัญเปลี่ยน: ${w} ${b}→${a}`); }
  for (const w of EXACT_TOKENS) { const b = wb.filter((x) => x === w).length, a = wa.filter((x) => x === w).length; if (a !== b) reasons.push(`คำสำคัญเปลี่ยน: ${w} ${b}→${a}`); }
  if (countOf(A, SPLIT_PERSON) > countOf(B, SPLIT_PERSON)) reasons.push('เติม "และ" หลังคำเรียกคน');
  for (const w of KEEP_WORDS) { const b = countOf(B, w), a = countOf(A, w); if (a < b) reasons.push(`คำสำคัญหาย: ${w} ${b}→${a}`); }
  for (const w of NO_MORE_WORDS) { const b = countOf(B, w), a = countOf(A, w); if (a > b) reasons.push(`เพิ่มคำต้องห้าม: ${w} ${b}→${a}`); }
  const girl = /(?<!ลูก|หลาน|พี่|น้อง)สาว/gu;
  if (countOf(A, girl) > countOf(B, girl)) reasons.push('เพิ่มคำบอกเพศ: สาว');
  const numWords = (list) => list.filter((w) => NUMBER_WORDS.has(w));
  if (!sameList(numWords(wb), numWords(wa))) reasons.push(`เลขคำไทยเปลี่ยน: หาย ${diffList(numWords(wb), numWords(wa)).join(',') || '-'} · เพิ่ม ${diffList(numWords(wa), numWords(wb)).join(',') || '-'}`);
  const beforeFlat = squeeze(B), afterFlat = squeeze(A), rawFlat = squeeze(rawText);
  const fresh = [...new Set(diffList(wa, wb))].filter((w) => !FUNCTION_WORDS.has(w) && !beforeFlat.includes(w) && !rawFlat.includes(w) && !isSegmentArtifact(w, beforeFlat));
  if (fresh.length) reasons.push(`คำใหม่นอกโพสต์เดิมและข่าวดิบ: ${fresh.slice(0, 8).join(',')}`);
  const lost = [...new Set(diffList(wb, wa))].filter((w) => w.length >= 2 && !FUNCTION_WORDS.has(w) && !afterFlat.includes(w));
  if (lost.length > MAX_LOST_WORDS) reasons.push(`คำเนื้อหาหาย ${lost.length} คำ: ${lost.slice(0, 8).join(',')}`);
  return reasons;
}

/**
 * จัดวรรคตอนด้วยโค้ดล้วน: ไม่แตะตัวอักษรในเครื่องหมายคำพูด (ปรับแค่คู่เครื่องหมาย “ ”) · นอกคำพูด ตัด .. ... · เครื่องหมาย ! ? ซ้ำ · ไม้ยมกติดคำหน้าเว้นหลัง · เว้นหลังคำย่อที่นำหน้าชื่อ/เลข · เว้นรอบเครื่องหมายคำพูด
 */
export function tidyThaiPunctuation(text) {
  return tidyLayout(String(text || '').split('\n').map(tidyPunctuationLine).join('\n'));
}

function tidyPunctuationLine(line) {
  // บรรทัดที่เครื่องหมายคำพูดกำกวม (จำนวนคี่ หรือซ้อนกันคนละแบบ) = ไม่รู้ว่าส่วนไหนคือคำพูด → ไม่แตะทั้งบรรทัด
  const marks = line.match(/[“”]|(?<!\d)"/gu) || [];
  const singleOpen = (line.match(/‘/gu) || []).length, singleClose = (line.match(/’/gu) || []).length;
  if (marks.length % 2 === 1 || (/[“”]/u.test(line) && /(?<!\d)"/u.test(line)) || (singleOpen && singleOpen !== singleClose && !/‘[^‘’]*’[A-Za-z]/u.test(line))) return line;
  const parts = line.split(QUOTE_SPLIT);
  let out = '';
  parts.forEach((seg, i) => {
    if (i % 2) {
      if (out && !/[\s([/-]$/u.test(out)) out += ' ';
      out += seg.startsWith('‘') ? seg : `“${seg.slice(1, -1)}”`;
      return;
    }
    const cleaned = seg
      .replace(/[^\S\n]*(?:(?<!\d)\.{2,}|\.{2,}(?!\d)|(?<!\d)…|…(?!\d))[^\S\n]*/gu, ' ')
      .replace(/!{2,}/gu, '!')
      .replace(/\?{2,}/gu, '?')
      .replace(/(\p{Script=Thai})[^\S\n]+ๆ/gu, '$1ๆ')
      .replace(/ๆ(?!ๆ)(?=[\p{Script=Thai}0-9A-Za-z])/gu, 'ๆ ')
      .replace(/((?:[ก-ฮ]\.){2,})(?![ก-ฮ]\.)(?=[\p{Script=Thai}0-9])/gu, '$1 '); // (?!…) กันจับย้อน "ร.ต.ท. สมภพ" เป็น "ร.ต. ท. สมภพ" (เจอจากข่าวจริง 4 พ.ย.)
    // ติดเครื่องหมายคำพูดปิด: เว้นวรรคก่อนข้อความถัดไป (ยกเว้นเครื่องหมายที่ต้องติด)
    out += i && cleaned && !/^[\s,.!?)\]:;/-]/u.test(cleaned) ? ` ${cleaned}` : cleaned;
  });
  return out;
}

/** จัดย่อหน้าด้วยโค้ดล้วน (เปลี่ยนแค่ช่องว่าง): เกิน 3 = รวมย่อหน้ากลาง · ขึ้นบรรทัดในย่อหน้า = เว้นวรรค · น้อยกว่า 3 = คงเดิม (ไม่แบ่งเอง แบ่งกลางใจความได้ เช่น "นานกว่า 20 ¶ ปี") */
export function packIntoThreeParagraphs(text) {
  let paras = tidyLayout(text).split(/\n{2,}/u).map((p) => p.replace(/\n/gu, ' ').trim()).filter(Boolean);
  if (paras.length > 3) paras = [paras[0], paras.slice(1, -1).join(' '), paras[paras.length - 1]];
  return paras.join('\n\n');
}

/**
 * ด่านโค้ดของฉบับที่ AI เกลา · คืน { ok, reasons[] }
 * 3 ย่อหน้าพอดี · ตัวเลข+หน่วยครบเท่าเดิม · คำพูดเหมือนเดิมทุกตัว ไม่มีคำพูดใหม่ · คำอังกฤษเท่าเดิม · คำสำคัญ/คำใหม่/คำหาย (checkWordChanges) · ความยาว 0.85–1.25 เท่า · คำ ≥ min(ขั้นต่ำ, คำเดิม) · ไม่เพิ่มอีโมจิ/markdown/แฮชแท็ก
 */
export function checkThreeParaEdit(before, after, { minWords = LAYOUT_MIN_WORDS, rawText = '' } = {}) {
  const a = tidyLayout(after);
  if (!a) return { ok: false, reasons: ['ว่าง'] };
  const reasons = [];
  const paras = a.split(/\n{2,}/u).filter((p) => p.trim());
  if (paras.length !== 3) reasons.push(`ไม่ใช่ 3 ย่อหน้า (${paras.length})`);
  if (paras.some((p) => p.includes('\n'))) reasons.push('มีการขึ้นบรรทัดในย่อหน้า');
  const nb = numbersOf(before), na = numbersOf(a);
  if (!sameList(nb, na)) reasons.push(`ตัวเลขเปลี่ยน: หาย ${diffList(nb, na).join(',') || '-'} · เพิ่ม ${diffList(na, nb).join(',') || '-'}`);
  else if (JSON.stringify(nb) !== JSON.stringify(na)) reasons.push('ลำดับตัวเลขเปลี่ยน'); // สลับตัวเลขระหว่างคน (ลุงอายุ 60 ป้าอายุ 55 → ลุงอายุ 55 ป้าอายุ 60)
  const qb = quotesOf(before), qa = quotesOf(a);
  if (!sameList(qb, qa)) reasons.push(`คำพูดเปลี่ยน: หาย ${diffList(qb, qa).length} · เพิ่ม ${diffList(qa, qb).length}`);
  else if (JSON.stringify(qb) !== JSON.stringify(qa)) reasons.push('ลำดับคำพูดเปลี่ยน'); // สลับคำพูดระหว่างคน
  const lb = latinOf(before), la = latinOf(a);
  if (!sameList(lb, la)) reasons.push(`คำอังกฤษเปลี่ยน: หาย ${diffList(lb, la).join(',') || '-'} · เพิ่ม ${diffList(la, lb).join(',') || '-'}`);
  reasons.push(...checkWordChanges(before, a, rawText));
  const lenB = squeeze(before).length, lenA = squeeze(a).length;
  if (lenB && (lenA < lenB * MIN_LENGTH_RATIO || lenA > lenB * MAX_LENGTH_RATIO)) reasons.push(`ความยาวเปลี่ยนมาก (${lenA}/${lenB} ตัวอักษร)`);
  const words = countPublishableThaiWords({ content: a });
  if (words < Math.min(minWords, countPublishableThaiWords({ content: String(before || '') }))) reasons.push(`คำลดต่ำกว่าขั้นต่ำ (${words} คำ)`);
  const emoji = /\p{Extended_Pictographic}/gu;
  if (countOf(a, emoji) > countOf(before, emoji)) reasons.push('เพิ่มอีโมจิ');
  if (countOf(a, /[#*`_]/gu) > countOf(before, /[#*`_]/gu)) reasons.push('เพิ่มสัญลักษณ์ markdown/แฮชแท็ก');
  return { ok: reasons.length === 0, reasons };
}

/**
 * เกลา 1 ฉบับ · คืน { text, ok, reasons, understanding, issues, lightIssues } — ไม่ผ่าน = text null (ผู้เรียกใช้ถ้อยคำเดิม)
 * ไม่ผ่านการตรวจความหมาย/ตรวจไม่สำเร็จ/ผลตรวจรูปแบบแปลก = ไม่ใช้ · ห้ามส่งถ้อยคำที่ AI แก้โดยยังไม่ได้ตรวจ
 */
export async function editOneThreePara({ text, rawText = '', signal, callModel = callLayoutModel, callChecker = callF2xChecker }) {
  const before = String(text || '');
  const raw = String(rawText || '').trim();
  if (!before.trim()) return { text: null, ok: false, reasons: ['ไม่มีเนื้อโพสต์'] };
  const reply = await callModel({ system: SYS_THREE_PARA, prompt: `ข่าวดิบ (ใช้เพื่อเข้าใจเรื่องเท่านั้น):\n${raw}\n\n=====\nโพสต์ที่ต้องเกลา:\n${before}`, signal, feature: 'threeParaEdit' });
  const parsed = parseLayoutReply(reply);
  const base = { understanding: parsed.understanding, issues: parsed.issues };
  if (!parsed.post) return { text: null, ok: false, reasons: ['ไม่มีแท็ก post'], ...base };
  // ถ้อยคำเปลี่ยนได้ในขั้นนี้ → ต้องผ่านตัวกรองคำเสี่ยง Facebook ชุดเดียวกับนักเขียนซ้ำ
  const clean = sanitizeOutput({ content: parsed.post }, { scope: 'post' });
  const candidate = tidyThaiPunctuation(packIntoThreeParagraphs(String(clean?.content ?? parsed.post)));
  const gate = checkThreeParaEdit(before, candidate, { rawText: raw });
  if (!gate.ok) return { text: null, ok: false, reasons: gate.reasons, ...base };
  const verdict = await callChecker({ system: SYS_THREE_PARA_CHECK, user: `=== ข่าวดิบ ===\n${raw}\n\n=== ฉบับก่อนแก้ ===\n${before}\n\n=== ฉบับแก้ ===\n${candidate}\n=== จบ ===`, effort: 'medium', signal, feature: 'threeParaCheck' });
  if (!verdict || !Array.isArray(verdict.issues)) return { text: null, ok: false, reasons: ['ผลตรวจความหมายไม่ครบ'], ...base };
  const { heavy, light } = splitF2xIssues(verdict.issues);
  // ผู้ตรวจอิสระรอบ 1: {"issues":[{"description":"…"}]} ถูก splitF2xIssues กรองทิ้งเงียบ = กลายเป็น "ผ่าน" → จำนวนต้องครบ
  if (heavy.length + light.length !== verdict.issues.length) return { text: null, ok: false, reasons: ['ผลตรวจความหมายรูปแบบแปลก'], ...base };
  if (heavy.length) return { text: null, ok: false, reasons: [`ความหมายเปลี่ยน ${heavy.length} จุด: ${heavy.map((x) => String(x?.text || x?.why || '').slice(0, 60)).join(' · ')}`], ...base };
  return { text: candidate, ok: true, reasons: [], ...base, lightIssues: light.length, lightDetails: light.map((x) => ({ text: String(x?.text ?? '').slice(0, 160), why: String(x?.why ?? '').slice(0, 160) })) };
}

const short = (s, n = 400) => String(s || '').slice(0, n);

/**
 * เกลาทุกฉบับขนานกัน · ไม่โยน error (ขั้นเสริม)
 * ถอยทีละชั้น: ฉบับ AI เกลา → ถ้อยคำเดิมจัดด้วยโค้ด → ฉบับเดิมทุกไบต์ (recheck ไม่ผ่านทั้งสองชั้น)
 * recheck(version, newContent) → string[] เหตุ (ว่าง = ผ่าน) · โยน error = ไม่ผ่าน
 * applied = ฉบับที่ AI เกลาจนถ้อยคำเปลี่ยนและผ่านทุกด่าน (โหมดปิด AI = ฉบับที่จัดด้วยโค้ด) · 0 = log step layout-edit เป็น fallback · packed = ฉบับที่ถ้อยคำเดิม จัดด้วยโค้ด
 * skipped = เวลาไม่พอจนไม่เรียก AI · โหมดปิด AI ที่ไม่มีอะไรต้องจัด
 * @returns {{ versions: object[], applied: number, packed: number, skipped?: boolean, warning: string|null, summaryLine: string }}
 */
export async function runThreeParaEdit(versions, { rawText = '', recheck = null, callModel = callLayoutModel, callChecker = callF2xChecker, timeoutMs = STAGE_TIMEOUT_MS, reserveMs = LAYOUT_DEFAULT_RESERVE_MS, minStageMs = MIN_STAGE_MS } = {}) {
  const list = Array.isArray(versions) ? versions : [];
  if (!list.length) return { versions: list, applied: 0, packed: 0, skipped: true, warning: null, summaryLine: '📝 บก.สามย่อหน้า: ไม่มีฉบับให้เกลา' };
  const remaining = getActivePipelineDeadline()?.remainingMs?.();
  const budget = Number.isFinite(remaining) ? Math.min(timeoutMs, remaining - reserveMs) : timeoutMs;
  const aiOff = !isThreeParaAiEnabled();
  const skipAi = aiOff || (Number.isFinite(remaining) && budget < minStageMs);
  const t0 = Date.now();
  const results = new Array(list.length).fill(null);
  let error = null;
  if (!skipAi) {
    try {
      await withTimeoutSignal((signal) => Promise.all(list.map(async (v, i) => {
        try {
          const r = await editOneThreePara({ text: v.content, rawText, signal, callModel, callChecker });
          if (!signal?.aborted) results[i] = { done: true, ...r };
        } catch (e) { results[i] = { done: false, err: e?.message || String(e) }; }
      })), budget, 'three_para_edit');
    } catch (e) { error = e?.message || String(e); }
  }
  let applied = 0; let packedCount = 0; const failed = []; const rejected = [];
  const runRecheck = (v, text) => {
    if (typeof recheck !== 'function') return [];
    try { return [...(recheck(v, text) || [])]; } catch (e) { return [`ตรวจซ้ำล้ม: ${String(e?.message || e).slice(0, 60)}`]; }
  };
  const out = list.map((v, i) => {
    const r = results[i];
    if (!skipAi && !r?.done) failed.push(`V${i + 1}: ${String(r?.err || error || 'ไม่มีผล').slice(0, 80)}`);
    const meta = { mode: 'three_para', understanding: short(r?.understanding), issues: short(r?.issues), lightIssues: r?.lightIssues ?? 0, lightDetails: r?.lightDetails ?? [] };
    const reasons = r?.ok ? [] : [...(r?.reasons || [])];
    if (reasons.length) rejected.push(`V${i + 1}: ${reasons.join(' · ').slice(0, 120)}`);
    if (r?.ok && r.text) {
      const why = runRecheck(v, r.text);
      if (!why.length) {
        // แค่เปลี่ยนแบบเครื่องหมายคำพูด/ช่องว่าง = ไม่นับว่า AI เกลา
        const plain = (s) => squeeze(s).replace(/[“”]/gu, '"');
        const wordsChanged = plain(r.text) !== plain(v.content);
        if (wordsChanged) applied++; else if (r.text !== v.content) packedCount++;
        return { ...v, content: r.text, _preLayoutContent: v.content, _layoutEdit: { applied: true, rewritten: wordsChanged, fromChars: String(v.content || '').length, toChars: r.text.length, ...meta } };
      }
      reasons.push(...why);
      rejected.push(`V${i + 1}: ${why.join(' · ').slice(0, 120)}`);
    }
    // ถ้อยคำเดิมจัดด้วยโค้ด: ต้องไม่เปลี่ยนตัวเลข/คำพูด/คำอังกฤษ (ชั้นนี้ไม่มีตัวตรวจ AI)
    const packed = tidyThaiPunctuation(packIntoThreeParagraphs(v.content));
    const factsSame = sameList(numbersOf(v.content), numbersOf(packed)) && sameList(quotesOf(v.content), quotesOf(packed)) && sameList(latinOf(v.content), latinOf(packed));
    if (packed && packed !== v.content) {
      const why = factsSame ? runRecheck(v, packed) : ['ตัวจัดวรรคตอนเปลี่ยนตัวเลข/คำพูด'];
      if (!why.length) {
        packedCount++;
        return { ...v, content: packed, _preLayoutContent: v.content, _layoutEdit: { applied: true, rewritten: false, reasons, fromChars: String(v.content || '').length, toChars: packed.length, ...meta } };
      }
      reasons.push(...why);
    }
    return { ...v, _layoutEdit: { applied: false, rewritten: false, reasons, ...meta } };
  });
  const ms = Date.now() - t0;
  return {
    versions: out,
    applied: aiOff ? packedCount : applied,
    packed: packedCount,
    ...((aiOff ? packedCount === 0 : skipAi) ? { skipped: true } : {}),
    warning: failed.length ? `บก.สามย่อหน้าล้มบางฉบับ — ใช้ถ้อยคำเดิม (${failed.join(' · ')})` : null,
    summaryLine: `📝 บก.สามย่อหน้า: เกลา ${applied}/${list.length} ฉบับ · จัดด้วยโค้ด ${packedCount} · ${Math.round(ms / 1000)} วิ${aiOff ? ' · ปิด AI (THREE_PARA_AI ไม่ใช่ 1)' : skipAi ? ` · ข้าม AI เวลางานเหลือ ${Math.round(remaining / 1000)} วิ` : ''}${rejected.length ? ` · ไม่ผ่านด่าน ${rejected.length} (${rejected.join(' | ')})` : ''}${failed.length ? ` · ล้ม ${failed.length}` : ''}`,
  };
}
