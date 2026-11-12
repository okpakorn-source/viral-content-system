/**
 * =====================================================
 * Teacher Writer — นักเขียนแบบเลียนครู (10 พ.ย. 69)
 * =====================================================
 * เจ้าของสั่ง 10 พ.ย. 69: พนักงานส่งเนื้อข่าว (มีประเด็นครบแล้ว) → ระบบเขียนให้น่าอ่านแบบเดียวกับโพสต์ไวรัลจริงของเพจ
 *
 * หลักออกแบบ (ตอบข้อ "คำสั่งทับซ้อน" ของระบบเดิม):
 *   - นักเขียนเห็นของจริง 2 อย่างครบทุกตัวอักษร: โพสต์ครูฉบับเต็ม + เนื้อข่าวจากทีมฉบับเต็ม (ไม่ตัดกลางทาง)
 *   - กฎมีชุดเดียว อยู่ที่เดียว (TEACHER_RULES ด้านล่าง) ไม่มีกฎสำนวนซ้อนจากที่อื่น
 *     เหลือเฉพาะกฎที่เจ้าของเคาะให้คงไว้: ห้ามแต่งข้อมูล · ครบประเด็น · รูปแบบตามครู · คำเสี่ยง Facebook · มุมของเพจ
 *   - แบบแผนของครูถูก "วัดด้วยโค้ด" หลังเขียน (checkTeacherForm) ไม่ผ่าน = เขียนใหม่ได้อีก 1 ครั้ง (มีเพดาน ไม่วนไม่จบ)
 *
 * ไฟล์นี้ไม่เรียก AI เอง — ผู้เรียกส่งตัวเรียกโมเดลเข้ามา (callModel) จึงเทสได้โดยไม่ยิง API และไม่ผูกกับค่ายโมเดล
 * ไม่มี import แบบ alias — รันด้วย node ตรงๆ ได้
 */
import { countWordsThai } from './teacherLibrary.js';
import { formatAngleForWriter, missingMustKeep, keepsPhrase } from './angleDirector.js';

/** แบบแผนที่วัดจากโพสต์ครู 254 โพสต์: 3 ย่อหน้าทุกโพสต์ · ค่ากลาง 183 คำ · 94% อยู่ที่ 151–249 คำ */
export const TEACHER_FORM = Object.freeze({
  paragraphs: 3,
  targetMinWords: 160,
  targetMaxWords: 220,
  minWords: 140, // ต่ำ/สูงกว่านี้ = ไม่ผ่าน (นอกช่วงที่ครูเขียนจริง)
  maxWords: 240,
  // ความยาวเป็นตัวอักษร (ไม่นับช่องว่าง) — ใช้บอกนักเขียน เพราะโมเดลนับ "คำ" ไทยไม่ตรงกับตัวตัดคำ (ผลทดลอง v2: สั่ง 160–220 คำ ได้ค่ากลาง 240)
  //   ครู: ค่ากลาง 656 ตัวอักษร · 90% ไม่เกิน 803
  minChars: 620,
  maxChars: 800,
  // ถ้อยคำตรงกับเนื้อดิบ วัดนอกเครื่องหมายคำพูด (ครู 93% ยกคำพูดคนในข่าว จึงไม่นับคำพูดเป็นการลอก)
  //   ระบบปัจจุบันในข่าวชุดเดียวกัน: ค่ากลาง 38% · ท่อนยาวสุดค่ากลาง 41 ตัวอักษร (p90 = 68)
  maxRawCopy: 0.55, // สัดส่วนรวมเกินนี้ = ไม่ผ่านเมื่อเนื้อดิบยาวพอ · เตือนเมื่อเนื้อดิบสั้น (ดูเหตุผลที่ตัวตรวจ)
  retellMinRawRatio: 1.4, // เนื้อดิบยาวตั้งแต่ 1.4 เท่าของโพสต์ = มีวัตถุดิบให้เลือกเล่าใหม่ จึงบังคับ (โพสต์ ~650 ตัวอักษร → เนื้อดิบ ~900 ขึ้นไป)
  maxRawRun: 90, // ท่อนเดียวที่ยกจากเนื้อดิบยาวเกินนี้ (ตัวอักษร) = ไม่ผ่าน
  maxTeacherRun: 40, // ยกจากโพสต์ครูติดกันเกินนี้ = ไม่ผ่าน (สำนวนติดปากสั้นๆ ของแอดมินใช้ได้)
  // งบรายย่อหน้า (ตัวอักษรไม่นับช่องว่าง) — เจ้าของ 10 พ.ย. 69: "ยังเข้าใจช้า"
  //   วัดรอบ 5: ย่อหน้าแรกของระบบยาวกว่าครูที่เลียน 8% · ย่อหน้าท้ายยาวกว่า 32% · ย่อหน้ากลาง (ที่เล่าเรื่อง) กลับสั้นกว่าครู
  //   ครู 254 โพสต์: ย่อหน้าแรก ค่ากลาง 163 (สูงสุด 279) · ย่อหน้าท้าย ค่ากลาง 172 (สูงสุด 356)
  edgeParagraphMin: 160, // งบย่อหน้าแรก/ท้ายต่ำสุด แม้ครูที่เลียนจะสั้นกว่านี้
  edgeParagraphMax: 250,
  openingHardMax: 280, // ไม่มีโพสต์ครูให้เทียบ: เกินค่าสูงสุดที่ครูทั้งคลังเคยเขียน = ไม่ผ่าน
  closingHardMax: 360,
});

/** งบย่อหน้าแรกและย่อหน้าท้ายของเวอร์ชันนี้: ไม่เกินย่อหน้าเดียวกันของครูที่เลียน +15% (ครูไม่ใช่ 3 ย่อหน้า = ไม่มีงบ) */
export function paragraphBudget(teacherPost) {
  const p = String(teacherPost || '').split(/\n\s*\n/).map((x) => stripSpace(x)).filter(Boolean);
  if (p.length !== TEACHER_FORM.paragraphs) return null;
  const cap = (n) => Math.round(Math.min(TEACHER_FORM.edgeParagraphMax, Math.max(TEACHER_FORM.edgeParagraphMin, n * 1.15)) / 10) * 10;
  return { teacherOpening: p[0].length, teacherClosing: p[2].length, openingMax: cap(p[0].length), closingMax: cap(p[2].length) };
}

/** งบความยาวของเวอร์ชันนี้ (ตัวอักษรไม่นับช่องว่าง): ไม่เกินโพสต์ครูที่เลียน +10% และอยู่ในช่วงที่ครูทั้งคลังเขียนจริง */
export function lengthBudget(teacherPost) {
  const teacherChars = stripSpace(teacherPost).length;
  const max = Math.round(Math.min(TEACHER_FORM.maxChars, Math.max(TEACHER_FORM.minChars, teacherChars * 1.1)) / 10) * 10;
  return { teacherChars, maxChars: max };
}

/** กฎชุดเดียวของนักเขียนแบบครู — แก้ที่นี่ที่เดียว */
export const TEACHER_RULES = [
  'คุณคือแอดมินเพจข่าวบน Facebook ที่เล่าข่าวให้แฟนเพจอ่าน',
  'งานของคุณ: เขียนโพสต์ 1 โพสต์จาก "เนื้อข่าวจากทีม" ด้วยวิธีเขียนเดียวกับ "โพสต์ต้นแบบ" ซึ่งเป็นโพสต์จริงของเพจที่มีคนอ่านหลายล้านครั้ง',
  '',
  'สิ่งที่ต้องเลียนจากโพสต์ต้นแบบ: วิธีเปิดเรื่อง ลำดับการเล่าในแต่ละย่อหน้า จังหวะและความยาวประโยค น้ำเสียงของแอดมิน และวิธีปิดเรื่อง',
  'สิ่งที่ห้ามเอามาจากโพสต์ต้นแบบ: ข้อเท็จจริง ชื่อคน ตัวเลข สถานที่ และประโยคที่เล่าเรื่องของต้นแบบ (สำนวนติดปากสั้นๆ ของแอดมินใช้ได้) — เรื่องที่เล่าต้องมาจากเนื้อข่าวจากทีมเท่านั้น',
  'ถ้ามี "ทิศทางข่าว" ให้ยึดทิศทางนั้นเป็นแกนของโพสต์: ชูประเด็นตามที่กำหนด เล่าตามลำดับที่วางไว้ และถ้อยคำที่ระบุว่าต้องมีต้องอยู่ครบ โพสต์ต้นแบบมีหน้าที่แค่กำหนดสำนวน น้ำเสียง และรูปแบบ ห้ามใช้โพสต์ต้นแบบเปลี่ยนประเด็นหรือลำดับของทิศทางข่าว',
  // เพิ่ม 12 พ.ย. 69 — ผลตรวจ 20 ข่าวจริง: ย่อหน้ากลางของ 3 เวอร์ชันแทบเป็นก้อนเดียวกัน (ไล่เล่าเนื้อข่าวครบทุกข้อตามลำดับเดิม) ต่างกันแค่ประโยคเปิดกับประโยคปิด
  'ลำดับการเล่าในทิศทางข่าวบอกด้วยว่าย่อหน้ากลางของโพสต์นี้ขยายอะไรเป็นหลัก และปิดด้วยอะไร ให้ใช้เนื้อที่ของย่อหน้ากลางกับสิ่งที่ลำดับนั้นระบุ ข้อมูลอื่นของเนื้อข่าวที่จำเป็นต่อแก่นเรื่องให้เล่าสั้นๆ ไม่ต้องไล่เล่าทุกข้อตามลำดับของเนื้อข่าว (ข่าวเดียวกันถูกเขียนหลายโพสต์จากคนละทิศทาง โพสต์นี้ต้องเป็นของทิศทางนี้ ไม่ใช่สรุปข่าวกลางๆ)',
  '',
  'ย่อหน้าแรกคือพาดหัวของโพสต์ ต้องสั้นและตรง: มีแค่ 2–3 ประโยค คนอ่านต้องรู้ภายในสองประโยคแรกว่า ใคร (เรียกด้วยชื่อถ้าเนื้อข่าวมีชื่อ) ทำอะไรหรือเกิดอะไรขึ้น และจุดที่ทำให้เรื่องนี้น่าหยุดอ่านคืออะไร ถ้ามีทิศทางข่าว ให้เอา "ข้อความพาดปก" มาเล่าเป็นย่อหน้าแรกตรงๆ ด้วยคำง่ายๆ (ถ้าไม่มี ให้เปิดด้วยแก่นของเรื่อง) แล้วใช้วิธีเปิดของโพสต์ต้นแบบเป็นตัวส่งแรงให้ประเด็นนั้น เช่น คำชื่นชมนำหน้า โครงที่ขัดกับความคาดหมาย การวางชื่อคนในเครื่องหมายคำพูด หรือการชูตัวเลขและคำพูดจริงขึ้นก่อน ทุกประโยคในย่อหน้าแรกต้องมีข้อเท็จจริงของประเด็นที่ชู ห้ามมีประโยคที่ไม่บอกอะไรใหม่ (เช่น บอกว่าเรื่องนี้ได้รับความสนใจ) ห้ามเปิดแบบอ้อม และประวัติ ผลงานเก่า หรือเรื่องที่เกิดก่อนหน้า ให้ไปเล่าในย่อหน้ากลาง เว้นแต่สิ่งนั้นคือจุดที่ชูเอง',
  'เขียนให้อ่านรอบเดียวเข้าใจ: หนึ่งประโยคเล่าหนึ่งเรื่อง เรียกคนด้วยชื่อเมื่อพูดถึงครั้งแรกของแต่ละย่อหน้า ประโยคที่ใช้ แม้ แต่ เพราะ จึง ต้องมีเหตุผลรับกันจริง ประโยคไหนต้องอ่านซ้ำถึงจะเข้าใจ ให้แยกเป็นสองประโยค',
  'สัดส่วนแบบโพสต์ของเพจ: ย่อหน้าแรกสั้นที่สุด ราวหนึ่งในสี่ของโพสต์ ย่อหน้ากลางยาวที่สุดและเป็นที่เล่ารายละเอียด ย่อหน้าท้ายสั้น ปิดแบบที่โพสต์ต้นแบบปิด',
  '',
  'กฎ 5 ข้อ (ถ้าข้อใดขัดกับโพสต์ต้นแบบ ให้กฎชนะ)',
  '1. ความจริง — ข้อเท็จจริงทุกอย่างต้องมาจากเนื้อข่าวจากทีม (หรือ "ข้อมูลเสริม" ถ้ามีให้) ห้ามเพิ่มบุคคล ความสัมพันธ์ ตัวเลข เหตุการณ์ ฉาก สีหน้า หรือคำพูดที่เนื้อข่าวไม่ได้บอก ชื่อ ตัวเลข และคำพูดในเครื่องหมายคำพูดต้องตรงกับเนื้อข่าวทุกตัว คำบอกขนาดหรือความแน่นอนต้องคงความหมายเดิม ("กว่า 15 ปี" ห้ามเหลือ "15 ปี" · "อาจ" ห้ามกลายเป็น "มัก" · เรื่องที่เกิดครั้งเดียวห้ามเล่าเป็นเรื่องประจำ) ห้ามใส่เครื่องหมายคำพูดให้ถ้อยคำที่เนื้อข่าวไม่ได้ยกเป็นคำพูด ห้ามบอกเหตุผลหรือแรงจูงใจที่เนื้อข่าวไม่ได้บอก เนื้อข่าวไม่ระบุเพศของใคร ห้ามเดา ให้เรียกด้วยชื่อ (ใช้ "เจ้าตัว" ได้เฉพาะเมื่อประโยคนั้นพูดถึงคนเดียวจนไม่มีทางเข้าใจผิด) ความเห็นของแอดมิน (คำชื่นชม ข้อคิดปิดท้าย) ใส่ได้แบบที่ต้นแบบทำ แต่ต้องยืนบนสิ่งที่เนื้อข่าวบอกไว้จริง ห้ามยกคุณสมบัติหรือสถานการณ์ที่เนื้อข่าวไม่ได้พูดมาชม (เช่น ข่าวไม่ได้บอกว่างานหนัก ห้ามเขียนว่างานหนัก) และถ้าวิธีของต้นแบบต้องใช้ของที่เนื้อข่าวไม่มี (เช่น ต้นแบบเปิดด้วยคำพูดของญาติ แต่ข่าวไม่มีคำพูด) หรือใช้กับเรื่องนี้แล้วประโยคไม่สมเหตุผล ให้เลียนเท่าที่เนื้อข่าวมีให้ ห้ามสร้างขึ้นเองและห้ามฝืน',
  '2. เล่าใหม่ให้ครบแก่น — โพสต์ต้องบอกแก่นของเรื่องให้ครบ: ใคร ทำอะไร เกิดอะไรขึ้น ตัวเลขสำคัญ คำพูดสำคัญ และผลที่ตามมา รายละเอียดปลีกย่อยตัดได้เมื่อความยาวไม่พอ แต่ห้ามตัดแก่น และต้อง "เล่าใหม่" ด้วยภาษาของแอดมิน: จัดลำดับใหม่ตามวิธีของต้นแบบ เปลี่ยนโครงประโยค ใช้คำง่ายๆ แบบเล่าให้แฟนเพจฟัง ห้ามยกวลียาวหรือประโยคจากเนื้อข่าวมาเรียงต่อกัน (ท่อนที่ตรงกับเนื้อข่าวติดกันต้องไม่เกินราว 8–10 คำ) สิ่งที่คงตามเนื้อข่าวได้มีแค่ชื่อเฉพาะ ตัวเลข และคำพูดในเครื่องหมายคำพูด',
  `3. รูปแบบ — ${TEACHER_FORM.paragraphs} ย่อหน้า คั่นกันด้วยบรรทัดว่าง 1 บรรทัด ยาวพอๆ กับโพสต์ต้นแบบ และห้ามเกินจำนวนตัวอักษรที่ระบุไว้ท้ายคำสั่ง (โพสต์ของเพจสั้นกระชับ เลือกเล่าเฉพาะสิ่งที่ทำให้เรื่องเดิน เนื้อข่าวมีรายละเอียดมากแค่ไหนก็ห้ามยาวเกิน) ไม่ใส่อีโมจิ แฮชแท็ก ขีดยาว (—) หัวข้อย่อย หรือรายการ ไม่จบด้วยคำถามถึงคนอ่าน และไม่ชวนคอมเมนต์ กดไลก์ หรือแชร์`,
  '4. คำที่ Facebook ลดการมองเห็น — ห้ามใช้คำต่อไปนี้ตรงๆ ให้ใช้คำในวงเล็บหรือสำนวนสุภาพที่เข้ากับเรื่องแทน: ฆ่า (ก่อเหตุร้ายแรง) · ฆาตกรรม (คดีร้ายแรง) · ศพ (ร่างของผู้จากไป) · ตาย/เสียชีวิต/ดับ/สิ้นใจ (จากไป, จากไปอย่างสงบ, ลาลับ) · เลือด (ร่องรอยเหตุการณ์) · ยิง (ใช้อาวุธปืน) · แทง (ใช้ของมีคม) · ข่มขืน (ล่วงละเมิดทางเพศ) · ผูกคอ/ฆ่าตัวตาย (จากไปอย่างน่าเศร้า) · สยอง/โหด/สลด (สะเทือนใจ) · การพนัน/บ่อน/เว็บพนัน (เกมเสี่ยงโชคผิดกฎหมาย) · ยาบ้า/ยาไอซ์/เสพยา (สิ่งผิดกฎหมาย) · ทุบตี/ทำร้าย (ใช้ความรุนแรง) ข้อเท็จจริงของเหตุการณ์ยังต้องเล่าให้คนอ่านเข้าใจว่าเกิดอะไรขึ้น ห้ามเลี่ยงคำจนเรื่องขาดหาย',
  '5. มุมของเพจ — เล่าในมุมที่ให้เกียรติคนในข่าวและทำให้คนอ่านได้อะไรดีๆ กลับไป ข่าวการสูญเสียให้เล่าสิ่งที่เขาทำไว้ ไม่ขยี้ความเศร้า ไม่บรรยายความรุนแรง ไม่แซะ ไม่ประจาน ไม่โจมตีบุคคล',
  '',
  'ตอบเฉพาะเนื้อโพสต์ 3 ย่อหน้าเท่านั้น ไม่มีพาดหัว ไม่มีคำนำ ไม่มีคำอธิบาย ไม่ใช้ JSON หรือเครื่องหมายจัดรูปแบบใดๆ',
].join('\n');

/**
 * ประกอบคำสั่งรอบเขียน 1 เวอร์ชัน
 * @param {object} p
 * @param {{post:string, whyItWorks?:string, views?:number}} p.teacher  ครูที่เลือกให้เวอร์ชันนี้
 * @param {string} p.rawText  เนื้อข่าวจากทีม (ส่งเต็ม ไม่ตัด)
 * @param {Array<string>} [p.researchFacts]  ข้อมูลค้นเสริม (ถ้ามี)
 * @param {Array<string>} [p.fixNotes]  จุดที่รอบก่อนไม่ผ่านตัวตรวจ (รอบแก้เท่านั้น)
 * @param {string} [p.previousDraft]  ฉบับก่อนหน้าที่ไม่ผ่าน (รอบแก้เท่านั้น — ให้แก้จากของเดิม ไม่ต้องเริ่มใหม่ทั้งหมด)
 * @returns {{system:string, user:string}}
 */
export function buildTeacherPrompt({ teacher, rawText, researchFacts = [], fixNotes = [], previousDraft = '', angle = null }) {
  if (!teacher || !String(teacher.post || '').trim()) {
    const err = new Error('ไม่มีโพสต์ต้นแบบสำหรับเวอร์ชันนี้');
    err.errorType = 'TEACHER_MISSING';
    throw err;
  }
  const raw = String(rawText || '').trim();
  if (raw.length < 20) {
    const err = new Error('เนื้อข่าวจากทีมสั้นเกินไป');
    err.errorType = 'RAW_TEXT_TOO_SHORT';
    throw err;
  }
  const viewsLabel = Number(teacher.views) > 0 ? ` (มีคนอ่าน ${(Number(teacher.views) / 1e6).toFixed(1)} ล้านครั้ง)` : '';
  const facts = (researchFacts || []).map((f) => String(f || '').trim()).filter(Boolean);
  const notes = (fixNotes || []).map((f) => String(f || '').trim()).filter(Boolean);

  let user = `=== โพสต์ต้นแบบ${viewsLabel} ===\n${String(teacher.post).trim()}\n=== จบโพสต์ต้นแบบ ===\n\n`;
  if (String(teacher.whyItWorks || '').trim()) {
    user += `=== ทำไมโพสต์ต้นแบบนี้ได้ผล (อธิบายวิธีเขียน ไม่ใช่ข้อมูลที่จะนำไปใช้) ===\n${String(teacher.whyItWorks).trim()}\n\n`;
  }
  user += `=== เนื้อข่าวจากทีม (เรื่องที่ต้องเขียน) ===\n${raw}\n=== จบเนื้อข่าวจากทีม ===\n\n`;
  const direction = formatAngleForWriter(angle);
  if (direction) user += `=== ทิศทางข่าว (บรรณาธิการกำหนดแล้ว — ยึดเป็นแกน ห้ามเปลี่ยนประเด็น) ===\n${direction}\n=== จบทิศทางข่าว ===\n\n`;
  if (facts.length > 0) {
    user += '=== ข้อมูลเสริมจากการค้น (ใช้ได้ไม่เกิน 2 จุด เฉพาะที่ทำให้เรื่องชัดขึ้น ห้ามเบียดประเด็นจากทีม) ===\n'
      + facts.map((f, i) => `${i + 1}. ${f}`).join('\n') + '\n\n';
  }
  if (notes.length > 0) {
    const prev = String(previousDraft || '').trim();
    if (prev) user += `=== ฉบับก่อนหน้า (ยังไม่ผ่าน) ===\n${prev}\n\n`;
    user += '=== จุดที่ต้องแก้ให้ครบ (ส่วนที่ดีอยู่แล้วคงไว้ได้) ===\n' + notes.map((n) => `- ${n}`).join('\n') + '\n\n';
  }
  const budget = lengthBudget(teacher.post);
  user += `เขียนโพสต์จากเนื้อข่าวจากทีม ด้วยวิธีเขียนของโพสต์ต้นแบบ ตามกฎ 5 ข้อ
`
    + `ความยาว: โพสต์ต้นแบบยาว ${budget.teacherChars} ตัวอักษร (ไม่นับช่องว่าง) — โพสต์ของคุณต้องยาวไม่เกิน ${budget.maxChars} ตัวอักษร`;
  const pb = paragraphBudget(teacher.post);
  if (pb) {
    user += `\nย่อหน้าแรกของโพสต์ต้นแบบยาว ${pb.teacherOpening} ตัวอักษร ย่อหน้าท้ายยาว ${pb.teacherClosing} ตัวอักษร — ย่อหน้าแรกของคุณต้องไม่เกิน ${pb.openingMax} ตัวอักษร ย่อหน้าท้ายต้องไม่เกิน ${pb.closingMax} ตัวอักษร ที่เหลือให้ย่อหน้ากลางใช้เล่าเรื่อง`;
  }
  return { system: TEACHER_RULES, user };
}

const stripSpace = (s) => String(s || '').replace(/\s+/g, '');
const QUOTE_CHARS = '"“”';

/** ตัวเลขที่ปรากฏในข้อความ (ตัดจุลภาค/จุดท้าย) — ใช้เช็คว่าตัวเลขจากเนื้อข่าวไม่หาย */
function numbersIn(text) {
  const out = new Set();
  for (const m of String(text || '').match(/[0-9][0-9,]*(?:\.[0-9]+)?/g) || []) {
    const n = m.replace(/,/g, '').replace(/\.$/, '');
    if (n) out.add(n);
  }
  return out;
}

/** คำพูดในเครื่องหมายคำพูดของเนื้อข่าว (ยาว ≥ 8 ตัวอักษร) */
function quotesIn(text) {
  const out = [];
  const re = new RegExp(`[${QUOTE_CHARS}]([^${QUOTE_CHARS}\\n]{8,})[${QUOTE_CHARS}]`, 'g');
  let m;
  while ((m = re.exec(String(text || ''))) !== null) out.push(m[1].trim());
  return out;
}

/** สัดส่วนตัวอักษรของ a ที่เป็นท่อนยาว ≥ win ตัวอักษรซึ่งพบใน b ด้วย (ไม่นับช่องว่าง) — 0..1 */
export function sharedRunRatio(a, b, win = 10) {
  const A = stripSpace(a);
  const B = stripSpace(b);
  if (A.length < win || B.length < win) return 0;
  const grams = new Set();
  for (let i = 0; i + win <= B.length; i++) grams.add(B.slice(i, i + win));
  const covered = new Uint8Array(A.length);
  for (let i = 0; i + win <= A.length; i++) {
    if (grams.has(A.slice(i, i + win))) for (let k = i; k < i + win; k++) covered[k] = 1;
  }
  let n = 0;
  for (const c of covered) n += c;
  return n / A.length;
}

/** ท่อนที่ยาวที่สุดซึ่ง a กับ b มีตรงกัน (ไม่นับช่องว่าง) — คืนความยาว */
export function longestSharedRun(a, b, cap = 60) {
  const A = stripSpace(a);
  const B = stripSpace(b);
  let lo = 0;
  let hi = Math.min(cap, A.length, B.length);
  const has = (len) => {
    if (len === 0) return true;
    const grams = new Set();
    for (let i = 0; i + len <= B.length; i++) grams.add(B.slice(i, i + len));
    for (let i = 0; i + len <= A.length; i++) if (grams.has(A.slice(i, i + len))) return true;
    return false;
  };
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (has(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** ท่อนยาวที่สุดที่ a ยกมาจาก b (ไม่นับช่องว่าง) เรียงยาว→สั้น ไม่ซ้อนกัน — ใช้บอกนักเขียนว่าต้องเล่าใหม่ตรงไหน */
export function longestSharedRuns(a, b, { min = 24, top = 3 } = {}) {
  const A = stripSpace(a);
  const B = stripSpace(b);
  if (A.length < min || B.length < min) return [];
  const grams = new Set();
  for (let i = 0; i + min <= B.length; i++) grams.add(B.slice(i, i + min));
  const runs = [];
  let i = 0;
  while (i + min <= A.length) {
    if (!grams.has(A.slice(i, i + min))) { i++; continue; }
    let end = i + min;
    while (end < A.length && B.includes(A.slice(i, end + 1))) end++;
    runs.push(A.slice(i, end));
    i = end;
  }
  return runs.sort((x, y) => y.length - x.length).slice(0, top).map((r) => (r.length > 70 ? r.slice(0, 70) + '…' : r));
}

/**
 * ตรวจโพสต์ที่เขียนเทียบ "แบบแผนของครู" และเนื้อข่าวจากทีม — โค้ดล้วน ไม่เรียก AI
 * @returns {{ok:boolean, fails:Array<{code:string,message:string}>, warns:Array<{code:string,message:string}>, metrics:object}}
 *   fails = ต้องเขียนใหม่ · warns = ให้คนตรวจดู (ไม่บล็อก)
 */
export function checkTeacherForm(content, { rawText = '', teacherPost = '', angle = null } = {}) {
  const text = String(content || '').replace(/\r\n/g, '\n').trim();
  const fails = [];
  const warns = [];
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const words = countWordsThai(text);

  if (!text) fails.push({ code: 'EMPTY', message: 'ไม่มีเนื้อโพสต์' });
  if (text && paragraphs.length !== TEACHER_FORM.paragraphs) {
    fails.push({ code: 'PARAGRAPHS', message: `ต้องมี ${TEACHER_FORM.paragraphs} ย่อหน้าคั่นด้วยบรรทัดว่าง (ตอนนี้มี ${paragraphs.length})` });
  }
  if (text && words < TEACHER_FORM.minWords) {
    fails.push({ code: 'TOO_SHORT', message: `สั้นเกินไป (${words} คำ) — เล่าให้ครบประเด็น ความยาวรวมประมาณ ${TEACHER_FORM.targetMinWords}–${TEACHER_FORM.targetMaxWords} คำ` });
  }
  const chars = stripSpace(text).length;
  const charLimit = teacherPost ? lengthBudget(teacherPost).maxChars : TEACHER_FORM.maxChars;
  if (words > TEACHER_FORM.maxWords || chars > charLimit * 1.08) {
    const over = Math.max(chars - charLimit, 40);
    fails.push({ code: 'TOO_LONG', message: `ยาวเกินไป (${chars} ตัวอักษร) — ต้องไม่เกิน ${charLimit} ตัวอักษร ตัดออกอย่างน้อย ${over} ตัวอักษร (ราว ${Math.max(1, Math.round(over / 60))} ประโยค) โดยตัดรายละเอียดปลีกย่อย ไม่ตัดแก่นเรื่อง` });
  }
  if (/[—–]/.test(text)) fails.push({ code: 'DASH', message: 'มีขีดยาว (—) — โพสต์ของเพจไม่ใช้ ให้เขียนเป็นประโยคปกติ' });
  if (/\p{Extended_Pictographic}/u.test(text)) fails.push({ code: 'EMOJI', message: 'มีอีโมจิ — โพสต์ของเพจไม่ใช้' });
  if (/#\S/.test(text)) fails.push({ code: 'HASHTAG', message: 'มีแฮชแท็ก — โพสต์ของเพจไม่ใช้' });
  if (/^\s*(?:[-•*]|\d+[.)])\s+/m.test(text)) fails.push({ code: 'LIST', message: 'มีหัวข้อย่อยหรือรายการ — ให้เขียนเป็นย่อหน้า' });

  const lastPara = paragraphs[paragraphs.length - 1] || '';
  // จับเฉพาะ "คำถามถึงคนอ่าน" — ครูบางโพสต์ปิดด้วยประโยครำพึงที่ลงท้าย "ไหม" (เช่น "ไม่รู้ว่าจะ…ด้วยไหม") ซึ่งไม่ใช่การถามคนอ่าน
  const asksReader = /[?？]\s*["”']?\s*$/.test(lastPara)
    || /(คิด(?:เห็น)?(?:ยังไง|อย่างไร)(?:บ้าง|กัน)?|เห็นด้วย(?:ไหม|มั้ย|หรือไม่|หรือเปล่า)|ว่าไง(?:บ้าง|กัน)?|(?:คุณ|พวกเรา|ทุกคน)[^\n]{0,30}(?:ไหม|มั้ย|หรือเปล่า|หรือไม่))\s*$/.test(lastPara);
  if (asksReader) {
    fails.push({ code: 'QUESTION_END', message: 'จบด้วยคำถามถึงคนอ่าน — ให้ปิดด้วยประโยคบอกเล่า' });
  }
  // ย่อหน้าจบค้างกลางประโยค (อาการที่เคยเจอในระบบเดิม เคส #07585)
  for (let i = 0; i < paragraphs.length; i++) {
    if (/(?:^|\s)(และ|แต่|หรือ|เพราะ|โดย|ซึ่ง|กับ|ที่|ว่า|เพื่อ|จาก|ของ|ใน)\s*$/.test(paragraphs[i])) {
      fails.push({ code: 'DANGLING', message: `ย่อหน้าที่ ${i + 1} จบค้างกลางประโยค — เขียนให้จบความ` });
    }
  }

  // ตัวเลขจากเนื้อข่าว
  const rawNums = [...numbersIn(rawText)];
  const outNums = numbersIn(text);
  const missingNumbers = rawNums.filter((n) => !outNums.has(n));
  // เตือนเท่านั้น ไม่ตีตก: โค้ดแยกไม่ได้ว่าตัวเลขไหนเป็นแก่นเรื่อง และรูปเขียนต่างกันได้ ("300,000" ↔ "3 แสน", "16.00" ↔ "4 โมงเย็น") — ให้คนตรวจดู
  if (missingNumbers.length > 0) {
    warns.push({ code: 'NUMBERS_MISSING', message: `ตัวเลขจากเนื้อข่าวที่ไม่อยู่ในโพสต์: ${missingNumbers.join(', ')}` });
  }
  // ตัวเลขที่โพสต์มีแต่เนื้อข่าวไม่มี = เสี่ยงแต่งข้อมูล
  const rawNumSet = new Set(rawNums);
  const inventedNumbers = [...outNums].filter((n) => !rawNumSet.has(n));
  if (inventedNumbers.length > 0) {
    warns.push({ code: 'NUMBERS_NEW', message: `ตัวเลขที่เนื้อข่าวไม่มี: ${inventedNumbers.join(', ')}` });
  }

  // คำพูดในเครื่องหมายคำพูด: โพสต์ห้ามมีคำพูดที่เนื้อข่าวไม่มี
  const rawFlat = stripSpace(rawText);
  const inventedQuotes = quotesIn(text).filter((q) => stripSpace(q).length >= 12 && !rawFlat.includes(stripSpace(q).slice(0, 12)));
  if (inventedQuotes.length > 0) {
    warns.push({ code: 'QUOTES_NEW', message: `คำพูดในเครื่องหมายคำพูดที่ไม่พบในเนื้อข่าว: ${inventedQuotes.map((q) => `"${q.slice(0, 40)}"`).join(' | ')}` });
  }

  // ยืมเนื้อจากครู
  const teacherRun = teacherPost ? longestSharedRun(text, teacherPost, 80) : 0;
  if (teacherRun >= TEACHER_FORM.maxTeacherRun) {
    fails.push({ code: 'COPIED_TEACHER', message: 'มีท่อนที่ยกมาจากโพสต์ต้นแบบตรงๆ — เลียนได้เฉพาะวิธีเขียน ห้ามยกถ้อยคำ' });
  }
  // ลอกเนื้อข่าว: สัดส่วนตัวอักษรที่เป็นท่อน ≥ 10 ตัวอักษรตรงกับเนื้อดิบ (ชื่อเฉพาะ/ตัวเลขยังนับอยู่ จึงไม่มีวันเป็น 0)
  const narration = text.replace(/["“”][^"“”\n]{2,}["“”]/g, ' '); // ไม่นับคำพูดในเครื่องหมายคำพูด
  const rawCopy = rawText ? sharedRunRatio(narration, rawText, 10) : 0;
  const rawRun = rawText ? longestSharedRun(narration, rawText, 240) : 0;
  // ตก = ยกทั้งประโยคยาวมาวาง (ท่อนเดียวเกิน maxRawRun) หรือ สัดส่วนรวมสูง "เมื่อเนื้อดิบยาวพอให้เลือกเล่าใหม่"
  // เนื้อดิบสั้นพอๆ กับโพสต์ → สัดส่วนสูง = เตือนเท่านั้น
  //   ผลคณะผู้ตรวจปิดชื่อรอบ 6 (20 ข่าว เทียบแบบบังคับทุกข่าว กับแบบไม่บังคับเลย):
  //   เนื้อดิบสั้น (<900 ตัวอักษร 14 ข่าว): บังคับเปลี่ยนคำ → จุดผิดข้อเท็จจริง 30 จุด · ไม่บังคับ 19 จุด (ไม่มีวัตถุดิบให้เลือก จึงเปลี่ยนคำจนเพี้ยน และชนกับผู้ตรวจข้อเท็จจริง → เขียนวน 3 รอบ)
  //   เนื้อดิบยาว (≥900 ตัวอักษร 6 ข่าว): จุดผิดเท่ากัน (10 กับ 9) แต่บังคับแล้ว "เล่าใหม่" ได้ 4.0/5 เทียบ 3.0/5
  const rawRoom = chars > 0 ? stripSpace(rawText).length / chars : 0;
  const mustRetell = rawRoom >= TEACHER_FORM.retellMinRawRatio;
  if (rawRun > TEACHER_FORM.maxRawRun || (mustRetell && rawCopy > TEACHER_FORM.maxRawCopy)) {
    const runs = longestSharedRuns(narration, rawText, { min: 24, top: 3 });
    fails.push({
      code: 'RAW_COPY',
      message: (rawRun > TEACHER_FORM.maxRawRun
        ? `ยกประโยคจากเนื้อข่าวมาวางทั้งท่อน (ยาวสุด ${rawRun} ตัวอักษร)`
        : `ยกถ้อยคำจากเนื้อข่าวมามากเกินไป (${Math.round(rawCopy * 100)}%)`)
        + ' — เล่าใหม่ด้วยคำของแอดมิน เปลี่ยนโครงประโยค โดยข้อเท็จจริง ชื่อ ตัวเลข และคำพูดต้องคงเดิม'
        + (runs.length ? ` โดยเฉพาะท่อน: ${runs.map((r) => `"${r}"`).join(' / ')}` : ''),
    });
  } else if (rawCopy > TEACHER_FORM.maxRawCopy) {
    warns.push({ code: 'RAW_COPY', message: `ถ้อยคำตรงกับเนื้อข่าว ${Math.round(rawCopy * 100)}% (เนื้อข่าวสั้นพอๆ กับโพสต์ จึงไม่บังคับเปลี่ยนคำ)` });
  }
  // ย่อหน้าแรกต้องสั้นและถึงประเด็น · ย่อหน้าท้ายต้องไม่ยืด — เทียบกับย่อหน้าเดียวกันของครูที่เลียน (เผื่อคลาด 10% แบบเดียวกับความยาวรวม)
  if (paragraphs.length === TEACHER_FORM.paragraphs) {
    const pb = paragraphBudget(teacherPost);
    const openChars = stripSpace(paragraphs[0]).length;
    const closeChars = stripSpace(paragraphs[2]).length;
    const openLimit = pb ? Math.round(pb.openingMax * 1.1) : TEACHER_FORM.openingHardMax;
    const closeLimit = pb ? Math.round(pb.closingMax * 1.1) : TEACHER_FORM.closingHardMax;
    if (openChars > openLimit) {
      fails.push({ code: 'OPENING_TOO_LONG', message: `ย่อหน้าแรกยาว ${openChars} ตัวอักษร เกินงบ ${pb ? pb.openingMax : openLimit} — ตัดออกอย่างน้อย ${openChars - (pb ? pb.openingMax : openLimit)} ตัวอักษร ให้เหลือแค่ใคร ทำอะไร และจุดที่ชู แล้วย้ายรายละเอียดไปย่อหน้ากลาง` });
    }
    if (closeChars > closeLimit) {
      fails.push({ code: 'CLOSING_TOO_LONG', message: `ย่อหน้าท้ายยาว ${closeChars} ตัวอักษร เกินงบ ${pb ? pb.closingMax : closeLimit} — ตัดออกอย่างน้อย ${closeChars - (pb ? pb.closingMax : closeLimit)} ตัวอักษร ปิดให้สั้นแบบที่โพสต์ต้นแบบปิด ไม่พูดวนซ้ำสิ่งที่เล่าไปแล้ว` });
    }
    if (angle?.mustKeep?.length) {
      if (!angle.mustKeep.some((m) => keepsPhrase(paragraphs[0], m))) {
        fails.push({ code: 'OPENING_MISSES_POINT', message: `ย่อหน้าแรกยังไม่ถึงประเด็นที่ชู — เปิดด้วยข้อความพาดปก "${(angle.coverLines || []).join(' / ')}" ให้คนอ่านรู้ทันทีว่าเรื่องนี้คืออะไร` });
      }
    }
  }
  // ประเด็นต้องยังอยู่: ถ้อยคำที่ทิศทางข่าวกำหนดว่าต้องมี (คัดจากเนื้อข่าวตรงตัว) หายจากโพสต์ = ไม่ผ่าน
  const dropped = angle ? missingMustKeep(text, angle) : [];
  if (dropped.length > 0) {
    fails.push({ code: 'ANGLE_DROPPED', message: `ทิศทางข่าวกำหนดให้มีถ้อยคำเหล่านี้ แต่โพสต์ไม่มี: ${dropped.map((d) => `"${d}"`).join(' · ')} — ใส่ให้ครบตามเนื้อข่าว` });
  }
  // คำตอบหลุดรูปแบบ (JSON / โค้ดบล็อก / หัวข้อ) — เคยเป็นเหตุให้ข้อความดิบหลุดถึงพนักงาน
  if (/^\s*[{\[]|"content"\s*:|```|^\s*#{1,6}\s/m.test(text)) {
    fails.push({ code: 'FORMAT_LEAK', message: 'คำตอบมี JSON/โค้ด/หัวข้อปนมา — ตอบเฉพาะเนื้อโพสต์ล้วน' });
  }

  return {
    ok: fails.length === 0,
    fails,
    warns,
    metrics: {
      words,
      paragraphs: paragraphs.length,
      rawNumbers: rawNums.length,
      missingNumbers: missingNumbers.length,
      chars,
      charLimit,
      paragraphChars: paragraphs.map((p) => stripSpace(p).length),
      rawCopyPct: Math.round(rawCopy * 100),
      rawRun,
      teacherRun,
    },
  };
}

/** ดึง {title, content} จากคำตอบของโมเดล (รับทั้ง object ที่ parse แล้ว และข้อความ JSON/ข้อความล้วน) */
export function readWriterOutput(result) {
  let obj = result;
  if (typeof result === 'string') {
    const s = result.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try { obj = JSON.parse(s); } catch {
      const a = s.indexOf('{');
      const b = s.lastIndexOf('}');
      try { obj = a !== -1 && b > a ? JSON.parse(s.slice(a, b + 1)) : { content: s }; } catch {
        // JSON เสีย (เช่น ขึ้นบรรทัดใหม่จริงในสตริง) — ดึงช่อง content ออกมาเอง ไม่ปล่อย JSON ดิบเป็นเนื้อโพสต์
        const m = s.match(/"content"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"[a-zA-Z_]+"\s*:|\}\s*$)/);
        obj = m ? { content: m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') } : { content: s };
      }
    }
  }
  const v = Array.isArray(obj?.versions) ? obj.versions[0] : obj;
  const content = String(v?.content || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: String(v?.title || '').trim(), content };
}

/**
 * เขียน 1 เวอร์ชันโดยเลียนครู 1 โพสต์ — เขียน → ตรวจแบบแผน → ไม่ผ่านให้เขียนใหม่ (รวมไม่เกิน maxAttempts)
 * @param {object} p
 * @param {(req:{system:string,user:string}) => Promise<object|string>} p.callModel  ตัวเรียกโมเดล (ผู้เรียกกำหนดค่าย/รุ่น)
 * @returns {Promise<{ok:boolean, title:string, content:string, attempts:number, check:object, teacherId:string}>}
 *   ok=false = ฉบับที่ดีที่สุดที่ได้ยังไม่ผ่านตัวตรวจ (ผู้เรียกตัดสินใจเองว่าจะส่งพร้อมป้ายเตือนหรือไม่ — ห้ามทิ้งเงียบ)
 */
export async function writeWithTeacher({ teacher, rawText, researchFacts = [], angle = null, callModel, callChecker = null, callReader = null, maxAttempts = 2, canRetry = null }) {
  if (typeof callModel !== 'function') throw new Error('writeWithTeacher: ต้องส่ง callModel');
  const limit = Math.max(1, Math.min(3, maxAttempts)); // มีเพดานเสมอ (กฎระบบ: ห้าม retry ไม่จำกัด)
  let best = null;
  const trail = [];
  let fixNotes = [];
  let previousDraft = '';
  for (let attempt = 1; attempt <= limit; attempt++) {
    // รอบแก้ (รอบ 2 ขึ้นไป) เริ่มได้เมื่อผู้เรียกยังมีเวลาเหลือ — หมดเวลา = ส่งฉบับที่ดีที่สุดที่มี พร้อมบอกเหตุ (ไม่ปล่อยให้ทั้งงานถูกตัดกลางทาง)
    if (attempt > 1 && typeof canRetry === 'function' && !canRetry()) {
      return { ...best, stopped: 'เวลาของงานใกล้หมด จึงไม่ได้แก้รอบถัดไป' };
    }
    const prompt = buildTeacherPrompt({ teacher, rawText, researchFacts, fixNotes, previousDraft, angle });
    let reply;
    try {
      reply = await callModel(prompt);
    } catch (e) {
      // นักเขียนล่มในรอบแก้: ฉบับที่เขียนได้แล้วยังใช้ได้ — ส่งฉบับนั้นพร้อมผลตรวจและเหตุที่หยุด (รอบแรกล่ม = ไม่มีอะไรให้ส่ง โยนต่อ)
      if (!best) throw e;
      return { ...best, stopped: `นักเขียนล่มในรอบแก้ที่ ${attempt}: ${String(e?.message || e).slice(0, 120)}` };
    }
    const out = readWriterOutput(reply);
    const check = checkTeacherForm(out.content, { rawText, teacherPost: teacher.post, angle });
    // ด่านตรวจข้อเท็จจริง (ถ้าผู้เรียกส่งตัวตรวจมา): ตรวจทุกฉบับที่มีเนื้อ — ฉบับที่ตกแบบแผนก็ตรวจด้วย เพื่อให้รอบแก้รอบเดียวแก้ได้ทั้งสองเรื่อง
    // ผู้อ่านจับใจความ (ถ้าผู้เรียกส่งมา): เห็นแค่โพสต์ ไม่เห็นเนื้อข่าว — ถ้าอ่านแล้วไม่ได้ใจความทันที = ต้องแก้
    // สองด่านเป็นคำขอแยกกัน ไม่เห็นผลของกัน จึงเรียกพร้อมกันได้ (ไม่เพิ่มเวลารอ)
    const runFacts = async () => {
      if (typeof callChecker !== 'function' || !out.content) return null;
      try {
        return readFactCheck(await callChecker(buildFactCheckPrompt({ content: out.content, rawText, researchFacts, angle })));
      } catch (e) {
        return { checked: false, issues: [], error: String(e?.message || e).slice(0, 160) }; // ตัวตรวจล้ม = บอกว่า "ไม่ได้ตรวจ" ห้ามถือว่าผ่าน
      }
    };
    const runReader = async () => {
      if (typeof callReader !== 'function' || !out.content) return null;
      try {
        return readReaderReport(await callReader(buildReaderPrompt(out.content)));
      } catch (e) {
        return { read: false, clear: false, understand: '', gist: '', hardParts: [], error: String(e?.message || e).slice(0, 160) };
      }
    };
    const [facts, reader] = await Promise.all([runFacts(), runReader()]);
    const major = facts ? facts.issues.filter((i) => i.severity === 'major') : [];
    const readerOk = !reader || !reader.read || reader.clear; // ผู้อ่านล่ม = ไม่บล็อก (เป็นด่านเสริม) แต่ผลบอกว่าไม่ได้อ่าน
    const ok = check.ok && major.length === 0 && (!facts || facts.checked) && readerOk;
    // บันทึกทุกรอบ: รอบไหนตกเพราะอะไร (ให้คนเห็นว่าระบบแก้อะไรไปบ้าง และใช้วัดว่ากฎข้อไหนทำให้ต้องเขียนซ้ำ)
    trail.push({
      attempt,
      fails: check.fails.map((f) => f.code),
      factMajor: major.length,
      factChecked: facts ? !!facts.checked : null,
      readerClear: reader?.read ? reader.clear : null,
    });
    const candidate = { ok, title: out.title, content: out.content, attempts: attempt, check, facts, reader, trail, teacherId: teacher.id };
    if (ok) return candidate;
    // เก็บฉบับที่ "ผิดน้อยที่สุด" ไว้ (เสมอกัน = เอาฉบับหลัง ซึ่งผ่านการแก้มาแล้ว)
    const badness = (c) => c.check.fails.length + (c.facts ? c.facts.issues.filter((i) => i.severity === 'major').length : 0) + (c.reader?.read && !c.reader.clear ? 1 : 0);
    best = (!best || badness(candidate) <= badness(best)) ? candidate : { ...best, attempts: attempt };
    fixNotes = [
      ...check.fails.map((f) => f.message),
      ...(facts ? facts.issues.map((i) => `${FACT_ISSUE_LABEL[i.type] || 'ต้องแก้'}: "${i.quote}" — ${i.problem}${i.fix ? ` → ${i.fix}` : ''}`) : []),
      ...(reader?.read && !reader.clear ? [
        ...(reader.opening !== 'บอกเรื่อง' ? [`คนอ่านที่เห็นแค่โพสต์นี้ อ่านย่อหน้าแรกแล้วยังไม่รู้ว่าเกิดอะไรขึ้น${reader.gist ? ` (เขาเข้าใจได้แค่ว่า: ${reader.gist})` : ''} — ย่อหน้าแรกต้องบอกตรงๆ ว่าใคร ทำอะไรหรือเกิดอะไรขึ้น ห้ามเกริ่นแล้วไปเฉลยย่อหน้าหลัง`] : []),
        ...reader.hardParts.map((h) => `คนอ่านตามไม่ได้ (${h.kind}): "${h.quote}" — ${h.why}`),
      ] : []),
    ];
    previousDraft = out.content;
    if (fixNotes.length === 0) break; // ไม่ผ่านเพราะตัวตรวจล้มอย่างเดียว — เขียนใหม่ไม่ช่วย
  }
  return best;
}

// ───────── ผู้อ่านจับใจความ (เจ้าของ 10 พ.ย. 69: "ยังแอบงง เข้าใจยาก เข้าใจช้า") ─────────
// หลัก: ผู้อ่านเห็น "แค่โพสต์" เหมือนคนเลื่อนฟีดจริง — ไม่เห็นเนื้อข่าว ไม่เห็นทิศทาง จึงบอกได้ว่าโพสต์อธิบายตัวเองพอไหม

// ปรับเทียบกับโพสต์ครูจริง 40 โพสต์ (scripts/teacher-trial/reader-calibrate.mjs): เกณฑ์ชุดแรก ("ไม่รู้เรื่องมาก่อน" + ติทุกจุดที่สะดุด)
//   ตีครูตก 40/40 เพราะติชื่อเฉพาะ คำสะกด และภูมิหลังที่แฟนเพจรู้อยู่แล้ว — จึงเหลือเฉพาะ 3 อย่างที่ทำให้ "ตามเรื่องไม่ได้" จริง
export const READER_KINDS = ['สรรพนาม', 'เหตุผล', 'ประโยคซ้อน'];
export const READER_MAX_HARD_PARTS = 1; // จุดสะดุดเกินนี้ = ต้องแก้ (ค่าที่ครูผ่านเกือบหมด — ดูผลปรับเทียบ)

export const READER_RULES = [
  'คุณคือแฟนเพจข่าวบน Facebook ที่ตามข่าวทั่วไปอยู่บ้าง กำลังเลื่อนฟีดแล้วเจอโพสต์นี้ และอ่านแค่รอบเดียว',
  'ทำ 3 อย่าง',
  '1. อ่านเฉพาะย่อหน้าแรก แล้วเขียน gist ว่า ใคร ทำอะไรหรือเกิดอะไรขึ้น ตามที่ย่อหน้าแรกบอกไว้จริง ห้ามเอาข้อมูลจากย่อหน้าหลังมาเติม',
  '2. ตัดสินย่อหน้าแรก (opening): "บอกเรื่อง" = ย่อหน้าแรกบอกแล้วว่าใคร และการกระทำหรือเหตุการณ์หลักคืออะไร (ไม่ต้องมีภูมิหลังครบ ชื่อคนที่คุณไม่รู้จักหรือรายละเอียดที่ยังไม่เล่าไม่ถือว่าผิด) · "เกริ่น" = ย่อหน้าแรกปูพื้น พูดกว้างๆ หรือบอกใบ้ว่ามีอะไรเกิดขึ้น แต่ยังไม่บอกว่าเกิดอะไร ต้องอ่านย่อหน้าหลังถึงรู้ · "งง" = อ่านแล้วไม่รู้ว่าพูดถึงใครหรือเรื่องอะไร',
  '3. อ่านทั้งโพสต์ แล้วยกเฉพาะจุดที่ทำให้ "ตามเรื่องไม่ได้หรือเข้าใจผิด" จริงๆ ซึ่งมี 3 ชนิดเท่านั้น: "สรรพนาม" = คำเรียกหรือสรรพนามที่ไม่รู้ว่าหมายถึงใคร · "เหตุผล" = เหตุกับผลในประโยคไม่รับกัน · "ประโยคซ้อน" = ประโยคยาวซ้อนหลายชั้นจนต้องอ่านซ้ำถึงรู้ว่าใครทำอะไร',
  'ไม่นับ: คำสะกด ชื่อเฉพาะหรือศัพท์ที่ไม่คุ้น ข้อมูลที่อยากรู้เพิ่ม ภูมิหลังที่โพสต์ไม่ได้เล่า และรสนิยมสำนวน โพสต์ที่เขียนดีมักไม่มีจุดแบบนี้เลย ไม่มีก็ส่งรายการว่าง ยกได้ไม่เกิน 3 จุด',
  'ตอบเป็น JSON เท่านั้น: {"gist": "ใคร ทำอะไร ตามที่ย่อหน้าแรกบอก", "opening": "บอกเรื่อง|เกริ่น|งง", "hardParts": [{"quote": "ถ้อยคำตรงตัวจากโพสต์", "kind": "สรรพนาม|เหตุผล|ประโยคซ้อน", "why": "ตามไม่ได้เพราะอะไร สั้นๆ"}]}',
].join('\n');

/** คำสั่งให้ผู้อ่านจับใจความ — ส่งให้แค่โพสต์ */
export function buildReaderPrompt(content) {
  return { system: READER_RULES, user: `=== โพสต์ ===\n${String(content || '').trim()}\n=== จบโพสต์ ===` };
}

/**
 * อ่านผลของผู้อ่านจับใจความ
 * @returns {{read:boolean, clear:boolean, opening:string, gist:string, hardParts:Array<{quote:string,kind:string,why:string}>}}
 *   clear = ย่อหน้าแรก "บอกเรื่อง" และจุดที่ตามไม่ได้ไม่เกิน READER_MAX_HARD_PARTS · read=false = อ่านผลไม่ได้ (ไม่ถือว่าผ่านหรือตก — ผู้เรียกแสดงว่า "ไม่ได้อ่าน")
 */
export function readReaderReport(result) {
  let obj = result;
  if (typeof result === 'string') {
    const s = result.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try { obj = JSON.parse(s); } catch {
      const a = s.indexOf('{');
      const b = s.lastIndexOf('}');
      try { obj = a !== -1 && b > a ? JSON.parse(s.slice(a, b + 1)) : null; } catch { obj = null; }
    }
  }
  const opening = String(obj?.opening || '').trim();
  if (!obj || !['บอกเรื่อง', 'เกริ่น', 'งง'].includes(opening)) return { read: false, clear: false, opening: '', gist: '', hardParts: [] };
  // นับเฉพาะ 3 ชนิดที่กำหนด — ผู้อ่านติเรื่องอื่นมา (คำสะกด ชื่อไม่คุ้น) ไม่นับเป็นจุดที่ต้องแก้
  const hardParts = (Array.isArray(obj.hardParts) ? obj.hardParts : [])
    .filter((h) => h && String(h.quote || '').trim() && READER_KINDS.includes(String(h.kind || '').trim()))
    .slice(0, 3)
    .map((h) => ({ quote: String(h.quote).trim().slice(0, 200), kind: String(h.kind).trim(), why: String(h.why || '').trim().slice(0, 200) }));
  return { read: true, clear: opening === 'บอกเรื่อง' && hardParts.length <= READER_MAX_HARD_PARTS, opening, gist: String(obj.gist || '').trim().slice(0, 300), hardParts };
}

// ───────── ด่านตรวจข้อเท็จจริง (แทนด่านแก้หลังเขียนชุดเดิมที่ลบ/แทนคำในเนื้อข่าวเอง) ─────────
// หลัก: ตัวตรวจ "ชี้" อย่างเดียว ไม่แก้เนื้อเอง — คนแก้คือนักเขียน ซึ่งเห็นเนื้อข่าวครบ และฉบับแก้ถูกตรวจแบบแผนซ้ำทุกครั้ง

const FACT_ISSUE_LABEL = { added: 'ข้อมูลที่เนื้อข่าวไม่มี', wrong: 'ไม่ตรงกับเนื้อข่าว', missing: 'แก่นเรื่องที่ขาดไป', unclear: 'ประโยคไม่ชัดหรือไม่สมเหตุผล' };

export const FACT_CHECK_RULES = [
  'คุณคือผู้ตรวจข้อเท็จจริงของเพจข่าว งานของคุณคือเทียบ "โพสต์" กับ "เนื้อข่าวจากทีม" ทีละประโยค แล้วรายงานเฉพาะจุดที่ต้องแก้ คุณไม่ได้เขียนใหม่และไม่ได้ให้คะแนนสำนวน',
  'เนื้อข่าวจากทีม (และ "ข้อมูลเสริม" ถ้ามี) คือความจริงแหล่งเดียว',
  '',
  'ให้รายงาน 4 ชนิด',
  '- added: โพสต์ยืนยันสิ่งที่เนื้อข่าวไม่ได้บอก — บุคคล ความสัมพันธ์ ตัวเลข เหตุการณ์ ฉาก สีหน้า เหตุผล แรงจูงใจ คุณสมบัติของคน หรือคำพูดในเครื่องหมายคำพูดที่เนื้อข่าวไม่ได้ยกเป็นคำพูด',
  '- wrong: โพสต์เล่าไม่ตรงกับเนื้อข่าว — ตัวเลข ชื่อ (รวมสะกดไม่ตรงหรือสะกดไม่คงที่) ใครทำอะไรกับใคร ลำดับเหตุการณ์ คำบอกขนาดหรือความแน่นอนที่ความหมายเปลี่ยน ("กว่า 15 ปี" เป็น "15 ปี" · "อาจ" เป็น "มัก") เรื่องครั้งเดียวที่ถูกเล่าเป็นเรื่องประจำ หรือเหตุกับผลที่เนื้อข่าวไม่ได้ผูกกัน',
  '- missing: แก่นของเรื่องที่โพสต์ไม่ได้บอก — ใคร ทำอะไร เกิดอะไรขึ้น ตัวเลขหรือคำพูดที่เป็นหัวใจของข่าว และผลที่ตามมา (รายละเอียดปลีกย่อยที่ตัดออกไม่นับ)',
  '- unclear: ประโยคที่คนอ่านไทยอ่านแล้วสะดุด ไม่สมเหตุผล หรือไม่รู้ว่าสรรพนามหมายถึงใคร',
  '',
  'ไม่ต้องรายงาน: ความเห็นหรือคำชื่นชมของแอดมินที่ยืนบนสิ่งที่เนื้อข่าวบอกจริง · การใช้คำสุภาพแทนคำเรื่องการสูญเสียหรือความรุนแรง · การเรียบเรียงถ้อยคำใหม่ที่ความหมายเท่าเดิม · การตัดรายละเอียดปลีกย่อย',
  'ก่อนรายงานว่าอะไรถูกเพิ่มหรือขาด ให้กลับไปอ่านเนื้อข่าวซ้ำว่าไม่มีจริงหรือมีจริง',
  '',
  'severity: "major" = คนอ่านจะเข้าใจข้อเท็จจริงผิด หรือแก่นเรื่องขาด หรือประโยคอ่านไม่รู้เรื่อง · "minor" = คลาดเล็กน้อยที่ไม่เปลี่ยนความเข้าใจ',
  'ตอบเป็น JSON เท่านั้น: {"issues": [{"type": "added|wrong|missing|unclear", "severity": "major|minor", "quote": "ถ้อยคำในโพสต์ตรงตัว (ชนิด missing ให้ใส่สิ่งที่ขาด)", "problem": "ผิดอย่างไร สั้นๆ", "fix": "ควรแก้เป็นอย่างไรตามเนื้อข่าว"}]}',
  'ไม่มีจุดต้องแก้ ให้ตอบ {"issues": []} รายงานไม่เกิน 8 จุด เรียงจากร้ายแรงที่สุด',
].join('\n');

/** ประกอบคำสั่งให้ผู้ตรวจข้อเท็จจริง */
export function buildFactCheckPrompt({ content, rawText, researchFacts = [], angle = null }) {
  const facts = (researchFacts || []).map((f) => String(f || '').trim()).filter(Boolean);
  let user = `=== เนื้อข่าวจากทีม ===\n${String(rawText || '').trim()}\n=== จบเนื้อข่าวจากทีม ===\n\n`;
  if (facts.length > 0) user += '=== ข้อมูลเสริม ===\n' + facts.map((f, i) => `${i + 1}. ${f}`).join('\n') + '\n\n';
  const direction = formatAngleForWriter(angle);
  if (direction) user += `=== ทิศทางข่าวที่บรรณาธิการกำหนด (โพสต์ต้องชูประเด็นนี้ — ถ้าประเด็นนี้หายหรือถูกเปลี่ยน ให้รายงานเป็น missing) ===\n${direction}\n\n`;
  user += `=== โพสต์ที่ต้องตรวจ ===\n${String(content || '').trim()}\n=== จบโพสต์ ===\n\nตรวจโพสต์เทียบกับเนื้อข่าวจากทีม`;
  return { system: FACT_CHECK_RULES, user };
}

/**
 * อ่านผลของผู้ตรวจข้อเท็จจริง
 * @returns {{checked:boolean, issues:Array<{type:string,severity:string,quote:string,problem:string,fix:string}>}}
 *   checked=false = อ่านผลไม่ได้ (ห้ามถือว่าผ่าน — ผู้เรียกต้องแจ้งว่าฉบับนี้ "ยังไม่ได้ตรวจข้อเท็จจริง")
 */
export function readFactCheck(result) {
  let obj = result;
  if (typeof result === 'string') {
    const s = result.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try { obj = JSON.parse(s); } catch {
      const a = s.indexOf('{');
      const b = s.lastIndexOf('}');
      try { obj = a !== -1 && b > a ? JSON.parse(s.slice(a, b + 1)) : null; } catch { obj = null; }
    }
  }
  if (!obj || !Array.isArray(obj.issues)) return { checked: false, issues: [] };
  const TYPES = ['added', 'wrong', 'missing', 'unclear'];
  const issues = obj.issues
    .filter((i) => i && typeof i === 'object' && String(i.quote || '').trim())
    .slice(0, 8)
    .map((i) => ({
      type: TYPES.includes(i.type) ? i.type : 'wrong',
      severity: i.severity === 'minor' ? 'minor' : 'major', // ไม่ระบุ/ผิดรูป = ถือว่าร้ายแรงไว้ก่อน
      quote: String(i.quote).trim().slice(0, 200),
      problem: String(i.problem || '').trim().slice(0, 240),
      fix: String(i.fix || '').trim().slice(0, 240),
    }));
  return { checked: true, issues };
}
