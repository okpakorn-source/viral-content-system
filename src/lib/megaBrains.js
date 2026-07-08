// ============================================================
// 🏭 MEGA Workflow — สมองเล็กประจำสายพาน (เฟส 1: S1.5 / S2.5 / S4 · เฟส 2: S6)
// ------------------------------------------------------------
// ทุกตัวรับ "แฟ้มบริบท" แล้วคืน JSON ตายตัว — ใช้ callBrain (Claude หลัก/OpenAI สำรอง)
// หลักการ: อ่านของที่สถานีก่อนหน้าเขียนไว้เสมอ + เขียนเหตุผลกลับให้สถานีถัดไป
// ============================================================

import { callBrain } from '@/lib/aiClient';

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('สมองไม่ตอบเป็น JSON');
  return JSON.parse(t.slice(s, e + 1));
}

// ---------- S1.5 Preflight: ข่าวนี้ "ลงทุนแล้วคุ้ม" ไหม (ตายเร็ว = ถูก) ----------
export async function preflightBrain({ card }) {
  const system = `คุณคือบรรณาธิการโต๊ะข่าวไวรัล ประเมินว่า "ข่าวการ์ดนี้" ควรลงทุนผลิตครบวงจร (เจนเนื้อ+หาภาพ+ทำปก) หรือไม่
เกณฑ์: (1) มีแหล่งต้นทาง/ลิงก์จริงไหม (2) ทำเป็น "ภาพ" ได้ไหม — มีคนเด่นชัด/มีคลิป/เหตุการณ์ถ่ายรูปได้ (3) ไม่ใช่ข่าวนามธรรม/นโยบายล้วน
ตอบ JSON เท่านั้น: {"score":0.0-1.0,"hasPrimarySource":bool,"hasUsableVisuals":bool,"hasKnownPeople":bool,"hasClip":bool,"decision":"pass|skip","reason":"สั้นๆ ภาษาไทย"}
decision=pass เมื่อ score>=0.6 และ hasUsableVisuals=true`;
  const user = `การ์ดข่าวจากโต๊ะข่าว (JSON):\n${JSON.stringify(card, null, 1).slice(0, 3500)}`;
  const out = await callBrain({ system, user, maxTokens: 500, temperature: 0.1, cost: { step: 'MEGA S1.5 preflight' } });
  return parseJson(out.text || out);
}

// ---------- S2.5 เข็มทิศเรื่อง: วิสัยทัศน์เดียวกำกับทุกสถานีหลังจากนี้ ----------
export async function compassBrain({ card, extractText }) {
  const system = `คุณคือบรรณาธิการบริหารข่าวไวรัลไทย กำหนด "เข็มทิศเรื่อง" ให้ทีมทั้งสายพาน (คนเขียน/คนหาภาพ/คนทำปก) ใช้ร่วมกัน
กฎ: อิงเฉพาะข้อเท็จจริงในเนื้อข่าว ห้ามแต่งเพิ่ม · อารมณ์ต้องตรงหลักฐาน · ช็อตภาพในฝันต้องเป็นภาพที่ "มีโอกาสหาเจอจริง"
ตอบ JSON เท่านั้น:
{"angle":"มุมเล่าหลัก 1 ประโยค","primaryEmotion":"อารมณ์หลัก","secondaryEmotions":["อารมณ์รอง 2-3"],
"mainCharacters":[{"name":"ชื่อ-นามสกุลจริงตามข่าว พร้อมฉายา/ชื่อเล่นในวงเล็บถ้ามี เช่น 'จุน วนวิทย์ (อากงจุน)' — ห้ามใช้ฉายาลอยๆ โดยไม่มีชื่อจริง","role":"hero|reaction|context"}],
"visualDreamShots":[{"slot":"hero|reaction|action|context|evidence","description":"ช็อตที่อยากได้"}],
"doNotUse":["สิ่งที่ห้ามใช้ เช่น ภาพคนผิด/เหตุการณ์อื่น"],
"contentComplete":bool,"missingFacts":["ข้อเท็จจริงที่ยังขาด ถ้ามี"]}`;
  const user = `การ์ดข่าว: ${JSON.stringify({ title: card?.title, lane: card?.lane, category: card?.category }, null, 0)}\n\nเนื้อข่าวที่สกัดได้ (เต็ม):\n"""\n${String(extractText || '').slice(0, 6000)}\n"""`;
  const out = await callBrain({ system, user, maxTokens: 900, temperature: 0.2, cost: { step: 'MEGA S2.5 compass' } });
  return parseJson(out.text || out);
}

// ---------- S4 บก.คัดเวอร์ชัน: เลือกเนื้อที่ดีที่สุดแบบ "กันตาเอียง" ----------
// กัน position bias (งานวิจัย LLM-judge): ปิดชื่อเวอร์ชัน + สลับลำดับ + ให้คะแนนราย rubric ก่อนเลือก
export async function judgeBrain({ versions, extractText, compass }) {
  // สลับลำดับ + ปิดชื่อ (ก/ข/ค…) — เก็บ map ไว้ถอดกลับ
  const order = versions.map((_, i) => i).sort(() => Math.random() - 0.5);
  const labels = 'กขคงจฉชซ'.split('');
  const blinded = order.map((origIdx, k) => ({
    label: labels[k],
    text: String(versions[origIdx]?.content || versions[origIdx]?.text || versions[origIdx] || '').slice(0, 2600),
  }));

  const system = `คุณคือบรรณาธิการอาวุโสข่าวไวรัลไทย ตัดสิน "ฉบับร่าง" หลายตัวโดยยุติธรรม
ให้คะแนนราย rubric ทีละฉบับก่อน แล้วค่อยเลือกผู้ชนะ (ห้ามเลือกก่อนให้คะแนน):
- factuality (35): ตรงข้อเท็จจริงในเนื้อต้นทาง ไม่แต่งเพิ่ม
- angle (20): ตรงเข็มทิศเรื่อง (มุมเล่า/อารมณ์)
- platform_fit (15): เหมาะโพสต์เฟซบุ๊กไทย อ่านลื่น ย่อหน้าสั้น
- hook (15): เปิดเรื่องดึงคนหยุดอ่าน
- clarity (10): ใคร-ทำอะไร-ที่ไหน ชัด
- risk (5): ไม่หมิ่นเหม่/ไม่ชี้นำผิด
ตอบ JSON เท่านั้น: {"scores":[{"label":"ก","factuality":0,"angle":0,"platform_fit":0,"hook":0,"clarity":0,"risk":0,"total":0,"note":"สั้นๆ"}],"winner":"ก","reason":"ทำไมชนะ 1-2 ประโยค"}`;
  const user = `เข็มทิศเรื่อง: ${JSON.stringify(compass || {}, null, 0).slice(0, 1200)}
เนื้อต้นทาง (ย่อ): """${String(extractText || '').slice(0, 2500)}"""

ฉบับร่างทั้งหมด (ลำดับสุ่ม ไม่บอกที่มา):
${blinded.map((b) => `--- ฉบับ ${b.label} ---\n${b.text}`).join('\n\n')}`;

  const out = await callBrain({ system, user, maxTokens: 1200, temperature: 0.1, cost: { step: 'MEGA S4 judge' } });
  const res = parseJson(out.text || out);
  const winIdx = labels.indexOf(res.winner);
  return {
    chosenIndex: order[winIdx >= 0 ? winIdx : 0], // ถอดกลับเป็น index จริงของ versions
    scores: res.scores || [],
    reason: res.reason || '',
    blindOrder: order,
  };
}

// ---------- S6 ผู้กำกับจับคู่ช่อง: ป้าย triage (จ่ายเงินแล้วใน S5) + สูตรปกแสนไลค์ → ช่องละใบ+สำรอง ----------
// ไม่ดูภาพซ้ำ (ประหยัด) — ตัดสินจาก metadata ที่ตาติดป้ายไว้: ใคร/หมวด/อารมณ์/คุณภาพ/จำนวนหน้า
export async function slotDirectorBrain({ imagesMeta, compass, deskTitle, refDNA = null }) {
  // 🎯 7 ก.ค. (ผู้ใช้สั่ง ref-first): ปกเป้าจากคลัง reference ต้อง "ขับการเลือกภาพ" ไม่ใช่แค่ตอนจัดวาง
  //   gated: ไม่มี refDNA = prompt เดิมเป๊ะ
  const refBlock = refDNA ? `
=== 🎯 ปกเป้าหมาย (คัดจากคลังปกไวรัลที่แนวตรงข่าวนี้ — เลือกภาพให้ตอบโจทย์ปกแบบนี้) ===
โครง: ${refDNA.layoutType || '-'}
ช่องของปกเป้า: ${(refDNA.slots || []).map((s) => `${s.role}=${s.desc || s.subject || ''}${s.emotion ? `(${s.emotion})` : ''}`).join(' · ') || '-'}
เล่าเรื่อง: ${String(refDNA.storyFlow || refDNA.compositionLogic || '').slice(0, 180)}
→ เลือกภาพลงช่องให้ได้ "บทบาท+อารมณ์" ใกล้ปกเป้าที่สุดเท่าที่พูลมีจริง (กฎเหล็กเดิมยังเหนือกว่าเสมอ)
⛔ กฎเหล็กเหนือปกเป้า: hero = "หน้าเดี่ยว" ของตัวเอกเสมอ (faces=1) — ห้ามภาพหมู่/ครอบครัว/คู่ขึ้น hero แม้ปกเป้าเป็นแนวครอบครัว (ภาพหมู่/คู่ไว้ช่อง reaction/context)
` : '';
  const system = `คุณคือผู้กำกับภาพปกข่าวไวรัลไทย จับคู่ "ภาพ → ช่องปก" ตามสูตรปกแสนไลค์ (5 ช่อง 5 บทบาท):
- hero: ตัวเอกของข่าว อารมณ์ตรงเรื่อง หน้าชัด (สำคัญสุด)
- reaction: บุคคลที่สอง/ปฏิกิริยาต่อเหตุการณ์
- action: เหตุการณ์กำลังเกิด/โมเมนต์เคลื่อนไหว
- context: บริบท สถานที่ สิ่งของ ที่เล่าเรื่อง
- circle: โมเมนต์-หลักฐานเด็ด (ภาพวงกลมที่คนต้องซูมดู)
กฎเหล็ก: (1) ถูกคน 100% เหนือทุกข้อ — hero ต้องเป็นตัวละครหลักตามเข็มทิศเท่านั้น (2) ทุกช่องคนละภาพ ห้ามซ้ำ และควรคนละฉาก (3) เลือกจาก id ในรายการเท่านั้น (4) quality ต่ำ (<4) ใช้เมื่อจำเป็นจริงๆ (5) ช่องไหนไม่มีภาพเข้าเกณฑ์จริงๆ ให้ id=null พร้อมเหตุผล — ห้ามฝืนยัดภาพผิดคน (6) ภาพ clean=false (มีลายน้ำ/ตัวหนังสือทับ) ห้ามขึ้นช่อง เลือกภาพ clean=true ก่อนเสมอ — ยอมใช้ clean=false เฉพาะเมื่อไม่มีภาพสะอาดที่ถูกคน/เข้าเกณฑ์จริงๆ (hero ยังยึด "ถูกคน 100%" เหนือข้อนี้)
ตอบ JSON เท่านั้น:
{"slots":{"hero":{"id":"...","reason":"สั้นๆ","backups":["id","id"]},"reaction":{...},"action":{...},"context":{...},"circle":{...}},"note":"ข้อสังเกตรวม 1 ประโยค"}`;
  const user = `ข่าว: ${String(deskTitle || '').slice(0, 120)}
เข็มทิศเรื่อง: ${JSON.stringify(compass || {}, null, 0).slice(0, 1200)}
${refBlock}
คลังภาพที่ตายืนยันแล้วว่าเกี่ยวข้อง (metadata ต่อใบ):
${JSON.stringify(imagesMeta, null, 0).slice(0, 9000)}`;
  const out = await callBrain({ system, user, maxTokens: 1100, temperature: 0.1, cost: { step: 'MEGA S6 slot director' } });
  return parseJson(out.text || out);
}
