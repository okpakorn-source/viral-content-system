/**
 * =====================================================
 * News Desk Brain — สมองคัดกรองข่าว 4 ชั้น (เฟส 1)
 * =====================================================
 * ชั้น 0 gateKeywords   : กติกาคำต้องห้าม — ฟรี ไม่ใช้ AI
 * ชั้น 1 classifyBatch  : gpt-4o-mini จัดหมวด+วัดพิษ+ความเสี่ยง FB (ถูก ~฿0.03/ข่าว)
 * ชั้น 2 fitAndDedupe   : JS ล้วน — ViralFit เทียบหมวดที่เพจปัง + กันซ้ำกับ archive
 * ชั้น 3 editorialJudge : gpt-5.5 "บรรณาธิการ AI" เฉพาะตัวท็อป + few-shot จากการกดเลือก/ทิ้งของทีม
 */

import { callAI } from '@/lib/ai/openai';
import { createStore } from '@/lib/persistStore';

// ── ชั้น 0: คำต้องห้าม (ตามนโยบายผู้ใช้: สงคราม/ฆ่า-ข่มขืน/เด็กถูกทำร้าย/การเมืองแรง/ศาสนา) ──
const BANNED_PATTERNS = [
  /ข่มขืน|ล่วงละเมิดทางเพศ|อนาจารเด็ก/,
  /ฆ่าตัวตาย|ปลิดชีพตัวเอง/,
  /ฆ่าหั่น|ฆ่ายกครัว|ฆาตกรรมโหด|ชำแหละศพ/,
  /สงคราม.{0,12}(ยูเครน|รัสเซีย|กาซา|อิสราเอล|ตะวันออกกลาง)|ระเบิดพลีชีพ|กราดยิง/,
  /ยุบสภา|รัฐประหาร|ม็อบ.{0,10}(ปะทะ|สลาย)|นายกฯ.{0,10}(ลาออก|อภิปราย)/,
  /หมิ่นศาสนา|ดูหมิ่นพระ|พระฉาว.{0,10}(สีกา|เสพ)/,
  // ★ 12 มิ.ย. 69 (คำสั่งทีม): พนัน/ยาเสพติด ไม่เอาทุกรูปแบบ — บล็อกตั้งแต่ประตู (สลาก/หวยรัฐไม่นับ)
  /การพนัน|เล่นพนัน|บ่อนพนัน|เว็บพนัน|พนันออนไลน์|บาคาร่า|แทงบอล|เปิดบ่อน/,
  /ยาบ้า|ยาไอซ์|ยาเสพติด|เสพยา|ค้ายา/,
  // ★ 15 มิ.ย. 69 (คำสั่งทีม "เหล้าเบียร์บุหรี่หนักๆ ไม่เอา"): เป็นกฎเหล็กเหมือนพนัน/ยา
  //   บล็อกเฉพาะที่ "เหล้า/บุหรี่เป็นแก่นเรื่องเชิงอบายมุข" — ดราม่าความสัมพันธ์/เงินของดารายังเล่นได้
  /วงเหล้า|ตั้งวงดื่ม|เมาอาละวาด|ดื่มสุรา|กินเหล้าเมา|สังสรรค์ดื่มหนัก|มั่วสุมดื่ม|บุหรี่ไฟฟ้า|พอตเด็ก|มอมเหล้า/,
];

// ── บล็อกเว็บต่างประเทศ/เพื่อนบ้านที่ประตู (13 มิ.ย. 69 คำสั่งทีม: "เอาแค่ในไทย ตปท.ไม่เอาเลย") ──
//   เหตุ: vietnam.vn เผยแพร่ภาษาไทย → AI เดาประเทศจากเนื้อหาไม่ออก หลุดเข้าโต๊ะ 48 ใบ
//   วิธีกันชัวร์สุด = เช็คโดเมน ไม่พึ่ง AI: ตัด ccTLD เพื่อนบ้าน/ตปท. + แบรนด์ข่าวตปท.ชื่อดัง
//   ★ ปกป้องโดเมนไทยเสมอ (.th ทุกชนิด) — บล็อกเฉพาะที่ "ไม่ใช่ไทยแน่ๆ"
const FOREIGN_TLD = /\.(vn|la|kh|mm|cn|kr|jp|sg|id|ph|my|tw|hk|in|bd|np)(\/|$|:)/i;
const FOREIGN_DOMAIN = /(vietnam|vnexpress|tuoitre|thanhnien|vovworld|\bvov\b|nhandan|vietnamplus|hanoitimes|laotian|laostimes|phnompenh|khmertimes|mizzima|irrawaddy|chinadaily|xinhua|globaltimes|peopledaily|scmp|koreaherald|koreatimes|yonhap|chosun|donga|japantimes|nikkei|\bnhk\b|kyodo|asahi|straitstimes|channelnewsasia|\bcna\b|antaranews|jakarta|inquirer|rappler|gmanews)/i;

// ★ ข่าวนอกแบรนด์ (13 มิ.ย. 69): เพจน้ำดี/ดราม่าคน — พวกนี้ไม่เคยเข้าฟีดเลย ตัดที่ประตูกันรกโต๊ะ
//   ระวัง: ตัดเฉพาะที่ชัดว่านอกแบรนด์ (พยากรณ์/ทายบอล/ราคาหุ้น) ไม่ตัดข่าวคนที่บังเอิญมีคำพวกนี้
const OFF_BRAND_PATTERNS = [
  /พยากรณ์อากาศ|กรมอุตุ.{0,15}(เตือน|ฉบับ|อากาศ)|อุณหภูมิ.{0,8}องศา|ฝนตก.{0,6}ร้อยละ/,
  /ทีเด็ดบอล|ทายผลบอล|วิเคราะห์บอล|ราคาบอล|ตารางบอล|บอลเต็ง|ผลบอลเมื่อคืน|โปรแกรมบอล/,
  /ราคาหุ้น.{0,10}วันนี้|ดัชนีหุ้น|ราคาทอง.{0,8}วันนี้|บิทคอยน์.{0,8}ราคา|คริปโต.{0,8}ราคา|ราคาน้ำมันวันนี้/,
  /ผลสลากกินแบ่ง|ตรวจหวย|เลขเด็ด.{0,8}งวด|หวยออก/,
  // ★ 15 มิ.ย. (คำสั่งทีม "ตัดข่าวกรมพัฒนาธุรกิจทิ้ง"): ราชการ/กรม/สัมมนาองค์กร/เศรษฐกิจมหภาค = ไม่ใช่ข่าวคน-ดารา
  //   (ระวังไม่ตัดข่าวดาราที่บังเอิญมีคำเงิน — ใช้คำเฉพาะราชการ/มหภาคที่ข่าวคนไม่ใช้)
  /กรมพัฒนาธุรกิจ|กรมการค้า|กรมส่งเสริมการ|กรมสรรพากร|กรมศุลกากร|กรมบัญชีกลาง|สภาอุตสาหกรรม|หอการค้าไทย|สำนักงานเศรษฐกิจ|ลงนาม\s?(บันทึกข้อตกลง|MOU)|สัมมนาวิชาการ|งานสัมมนา.{0,12}(องค์กร|ธุรกิจ|วิชาการ)|แถลงผลประกอบการ/,
  /ดัชนีเชื่อมั่น|เงินเฟ้อ.{0,8}(ร้อยละ|เปอร์เซ็น|%)|จีดีพี|\bGDP\b|อัตราดอกเบี้ยนโยบาย|วิกฤติหนี้ครัวเรือน|หนี้สาธารณะ|เศรษฐกิจมหภาค/,
  // ★ 15 มิ.ย. รอบ 2 (ทีมชี้เคสจริง: "ธปท. GovernorConnect 8 มาตรการ" + "กรุงเทพธุรกิจ INSIGHT วิกฤตหนี้ยุคดิจิทัล เผลอก่อหนี้"):
  //   ธนาคารกลาง/นโยบายการเงิน/บทวิเคราะห์เศรษฐกิจ-การเงิน = ไม่ใช่ข่าวคน ตัดทิ้ง
  /ธปท\.?|ธนาคารแห่งประเทศไทย|แบงก์ชาติ|ธนาคารกลาง|Bank of Thailand|GovernorConnect|กนง\.?|คณะกรรมการนโยบายการเงิน/i,
  /เผลอก่อหนี้|วิกฤต[ิ]?หนี้(ยุค|ครัวเรือน|ดิจิทัล|ประเทศ|สังคม)|ระบบการเงินทำให้|เศรษฐกิจดิจิทัล|กระตุ้นเศรษฐกิจ|มาตรการ.{0,10}(การเงิน|เศรษฐกิจ|สินเชื่อ|ภาษี)|(กรุงเทพธุรกิจ|เศรษฐกิจ).{0,6}INSIGHT/i,
  // ★ 15 มิ.ย. (ทีมชี้ "บัตรคนจนเกณฑ์ใหม่ — The Active"): สวัสดิการรัฐ/นโยบายประชานิยม/ปฏิรูปการศึกษา = ข่าวนโยบาย ไม่ใช่ข่าวคนอบอุ่น
  /บัตรคนจน|บัตรสวัสดิการแห่งรัฐ|สวัสดิการแห่งรัฐ|ลงทะเบียน.{0,6}บัตรสวัสดิการ|คนละครึ่ง|เราชนะ|เรารักกัน|เงินดิจิทัล.{0,6}หมื่น|ดิจิทัลวอลเล็ต|นโยบาย.{0,10}(รัฐบาล|ประชารัฐ|สวัสดิการ|ประชานิยม)|ปฏิรูปการศึกษา|งบประมาณรายจ่าย/,
  // ★ 15 มิ.ย. รอบ 3 (ทีมชี้ "หนุ่มไทยในไต้หวัน วนกลับมา"): คนไทยที่เหตุการณ์เกิดต่างแดน = ไม่ใช่ข่าวในไทย (เอาแค่ในไทย 100%)
  //   classify มักไม่ตีเป็นต่างประเทศเพราะตัวคนเป็นคนไทย → ดักที่ประตูด้วยคำบอกตำแหน่งต่างแดน
  /(หนุ่ม|สาว|ชาย|หญิง|ลุง|ป้า|แม่|พ่อ|แรงงาน|คนงาน|คนไทย|ลูกเรือ|นักเรียนไทย|นักศึกษาไทย|พยาบาลไทย|เชฟไทย).{0,8}ใน(ไต้หวัน|เกาหลีใต้|เกาหลี|ญี่ปุ่น|จีน|ฮ่องกง|มาเลเซีย|สิงคโปร์|อเมริกา|สหรัฐ|ออสเตรเลีย|ดูไบ|อิสราเอล|อังกฤษ|เยอรมัน|ฝรั่งเศส|สวีเดน|นอร์เวย์)/,
];

export function gateKeywords(item) {
  // ★ 15 มิ.ย. รอบ 2: รวมชื่อแหล่งข่าวด้วย — บล็อก "Bank of Thailand/ธปท." ที่เป็น source ได้ (ไม่ใช่แค่ในหัวข้อ)
  const text = `${item.title || ''} ${item.snippet || ''} ${item.source || ''}`;
  for (const p of BANNED_PATTERNS) {
    if (p.test(text)) return { pass: false, reason: `ติดคำต้องห้าม: ${p.source.slice(0, 30)}` };
  }
  for (const p of OFF_BRAND_PATTERNS) {
    if (p.test(text)) return { pass: false, reason: `นอกแบรนด์เพจ: ${p.source.slice(0, 25)}` };
  }
  // ★ 15 มิ.ย. (ทีมชี้ "Hong Kong fire" จาก Thai PBS): หัวข้อแทบไม่มีภาษาไทย = ข่าวต่างประเทศ/อินเตอร์ภาษาอังกฤษ
  //   ข่าวไทยไวรัลหัวข้อต้องเป็นไทย — หัวข้อ ENG ล้วน (Thai PBS World ฯลฯ) ตัดทิ้ง (เว้นข่าวไทยที่มี ENG ปนเล็กน้อยยังผ่าน)
  const thaiCount = (String(item.title || '').match(/[฀-๿]/g) || []).length;
  if (thaiCount < 4) return { pass: false, reason: 'หัวข้อไม่ใช่ภาษาไทย (ข่าวต่างประเทศ/อินเตอร์)' };
  // เช็คโดเมนต่างประเทศ — ตัดทิ้งทันที (เว้นโดเมนไทย .th)
  try {
    const host = new URL(item.url || '').hostname.toLowerCase();
    if (!/\.th(\/|$|:|\.)|\.th$/.test(host) && (FOREIGN_TLD.test(host) || FOREIGN_DOMAIN.test(host))) {
      return { pass: false, reason: `เว็บต่างประเทศ: ${host.slice(0, 30)}` };
    }
  } catch { /* URL พัง = ปล่อยผ่านชั้นนี้ ไปตายชั้นอื่น */ }
  return { pass: true };
}

// ── หมวดของโต๊ะข่าว + น้ำหนัก ViralFit (อิงหมวดที่หอสมุดไวรัลของเพจพิสูจน์แล้วว่าปัง) ──
export const DESK_CATEGORIES = [
  'น้ำใจ/ช่วยเหลือ', 'กตัญญู/ครอบครัวอบอุ่น', 'สู้ชีวิต', 'คนดังทำดี/ติดดิน',
  'สัมภาษณ์/บทสนทนาดี', 'บันเทิงกระแส', 'คนดัง/ดราม่าบันเทิง', 'ดราม่าสังคม', 'เตือนภัย/อุทาหรณ์', 'อื่นๆ',
];

const FIT_WEIGHTS = {
  'น้ำใจ/ช่วยเหลือ': 30, 'กตัญญู/ครอบครัวอบอุ่น': 30, 'สู้ชีวิต': 28, 'คนดังทำดี/ติดดิน': 27,
  // ★ คนดัง/ดราม่าบันเทิง (15 มิ.ย.): ดราม่านุ่มของดารา (รัก/เลิก/ครอบครัว/เงิน/วงการ/สัมภาษณ์) — คนตามจริง น้ำหนักดี
  'สัมภาษณ์/บทสนทนาดี': 22, 'คนดัง/ดราม่าบันเทิง': 21, 'บันเทิงกระแส': 18, 'ดราม่าสังคม': 15, 'เตือนภัย/อุทาหรณ์': 14, 'อื่นๆ': 6,
};

// ── ชั้น 1: จัดหมวด + วัดพิษ (เรียกทีละก้อน ก้อนละ ≤10 ข่าว ใน 1 call) ──
export async function classifyBatch(items) {
  const out = [];
  for (let i = 0; i < items.length; i += 10) {
    const chunk = items.slice(i, i + 10);
    const list = chunk.map((it, idx) => {
      let domain = '';
      try { domain = new URL(it.url || '').hostname; } catch {}
      return `${idx}: [${domain}] ${String(it.title || '').slice(0, 120)} | ${String(it.snippet || '').slice(0, 150)}`;
    }).join('\n');
    try {
      const res = await callAI({
        prompt: `จัดหมวดข่าวเพจไวรัลไทย ตอบ JSON เท่านั้น
หมวดให้เลือก: ${DESK_CATEGORIES.join(', ')}
ข่าว (รูปแบบ: เลข: [โดเมนต้นทาง] หัวข้อ | คำโปรย):
${list}

ตอบ: {"items":[{"i":0,"category":"...","tone":"บวก|กลาง|ลบ","toxicity":0-3,"fbRisk":0-3,"toneable":true/false,"country":"","storyNature":"pattern|event","subject":"celeb|public|ordinary","dramaType":"none|soft|hard"}]}
- toxicity: 0=สะอาด 3=หดหู่/รุนแรง | fbRisk: ความเสี่ยงโดน Facebook ลดรีช/ลบ (เลือด ความรุนแรง เนื้อหาล่อแหลม)
- subject: ★ "celeb"=ดารา/นักร้อง/นักแสดง/คนดังบันเทิง | "public"=บุคคลสาธารณะอื่น (นักการเมือง/นักธุรกิจ) | "ordinary"=คนทั่วไป
- dramaType: ★ "soft"=ดราม่านุ่มเล่นเป็นข่าวได้ (ความรัก/เลิกรา/อกหัก/ปัญหาครอบครัว/เพื่อน/หนี้สิน-เงิน/ดราม่าวงการบันเทิง) | "hard"=ของหนักห้ามแตะ (ฆ่า/ทารุณ/ล่วงละเมิด/เหล้า-พนัน-ยา) | "none"=ไม่ใช่ดราม่า
- ★ หมวด "คนดัง/ดราม่าบันเทิง" = ข่าวดารา/คนดังที่เป็น soft-drama (รัก/เลิก/ครอบครัว/เงิน/วงการ/สัมภาษณ์เปิดใจ) — ใส่หมวดนี้เมื่อ subject=celeb และ dramaType=soft
- ★ toxicity ของ soft-drama ดารา ให้ไม่เกิน 2 (เป็นดราม่าบันเทิงปกติ ไม่ใช่ความรุนแรง) — สงวน 3 ไว้ให้เนื้อหาหดหู่/รุนแรง/น่าสะเทือนใจจริงๆ
- toneable: ถ้าเอาไปเกลาโทนใหม่แล้วลงเพจได้แบบไม่ลบเกิน/ไม่ toxic
- country: ★ ถ้าเหตุการณ์เกิดนอกประเทศไทย ใส่ชื่อประเทศ (เช่น "เวียดนาม", "เกาหลีใต้") — ดูจากโดเมน (.vn, vietnam.vn = เวียดนาม) ชื่อสถานที่ ชื่อคน ถ้าเกิดในไทยใส่ "" เท่านั้น
  ★★ สำคัญ: คนไทยที่อยู่/ทำงาน/เรียน/เกิดเหตุ "ในต่างประเทศ" (หนุ่มไทยในไต้หวัน, แรงงานไทยในเกาหลี, สาวไทยในญี่ปุ่น, เชฟไทยในยุโรป) = ใส่ชื่อประเทศนั้น ไม่ใช่ "" เด็ดขาด — เพราะเหตุการณ์ไม่ได้เกิดในไทย (เพจเอาเฉพาะข่าวที่เกิดในไทย)
- storyNature: ★ "pattern" = เรื่องแบบแผนไร้กาลเวลา เล่าวันไหนก็ได้ (ดาราติดดิน, กตัญญูดูแลพ่อแม่, รับเลี้ยงหมาแมว, น้ำใจช่วยเหลือ) | "event" = เหตุการณ์เฉพาะครั้งเดียวที่ผูกกับช่วงเวลา (คนดังจ่ายหนี้ให้แม่ครั้งนั้น, งานแต่ง, เหตุการณ์ประกาศ/เปิดตัว) — event ที่เก่าแล้วเอามาเล่าใหม่ = เพจขุดของเก่า`,
        model: 'gpt-4o-mini',
        temperature: 0.1,
        maxTokens: 1500,
      });
      const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
      for (const r of parsed?.items || []) {
        const it = chunk[r.i];
        if (!it) continue;
        out.push({
          ...it,
          category: DESK_CATEGORIES.includes(r.category) ? r.category : 'อื่นๆ',
          tone: r.tone || 'กลาง',
          toxicity: Math.min(3, Math.max(0, Number(r.toxicity) || 0)),
          fbRisk: Math.min(3, Math.max(0, Number(r.fbRisk) || 0)),
          toneable: r.toneable !== false,
          // ★ ข่าวต่างประเทศ — ติดประเทศไว้บนการ์ด ใช้ทั้งคัดกรอง (judge) และบังคับระบุประเทศตอนเขียน
          foreignCountry: (r.country && String(r.country).trim() && !/ไทย|thailand/i.test(r.country)) ? String(r.country).trim().slice(0, 30) : null,
          // ★ ธรรมชาติของเรื่อง (12 มิ.ย. ค่ำ): pattern = ไร้กาลเวลาเล่าได้ทุกวัน | event = เหตุการณ์ครั้งเดียว (เก่าแล้ว = ขุดของเก่า)
          storyNature: r.storyNature === 'event' ? 'event' : 'pattern',
          // ★ v4 (15 มิ.ย.): ตัวบุคคล + ชนิดดราม่า — ใช้ให้ บก.AI รู้ว่าดารา+ดราม่านุ่ม = เล่นได้
          subject: ['celeb', 'public', 'ordinary'].includes(r.subject) ? r.subject : 'ordinary',
          dramaType: ['soft', 'hard'].includes(r.dramaType) ? r.dramaType : 'none',
        });
      }
    } catch (e) {
      console.log('[DeskBrain] classify chunk failed:', e.message?.slice(0, 60));
      // ก้อนที่จัดไม่ได้ → ใส่หมวดอื่นๆ ไว้ก่อน ไม่ทิ้งข่าว
      chunk.forEach(it => out.push({ ...it, category: 'อื่นๆ', tone: 'กลาง', toxicity: 1, fbRisk: 1, toneable: true }));
    }
  }
  return out;
}

// ── ชั้น 2: ViralFit + ความสด + กันซ้ำกับคลังที่เพจเคยทำ ──
// ★ เฟส 3: น้ำหนักหมวด "เรียนรู้จากผลโพสต์จริง" — ทีมกด 🔥 ปังจริง / 🧊 แป้ก บนการ์ดที่ส่งทำแล้ว
let _perfCache = { at: 0, boost: {} };
export async function getCategoryPerformance() {
  if (Date.now() - _perfCache.at < 10 * 60 * 1000) return _perfCache.boost;
  const boost = {};
  try {
    const store = createStore('news-desk-feedback');
    const all = await store.getAll();
    const counts = {};
    for (const f of all) {
      if (f.action !== 'viral' && f.action !== 'flop') continue;
      const c = f.category || 'อื่นๆ';
      counts[c] = counts[c] || { viral: 0, flop: 0 };
      counts[c][f.action]++;
    }
    for (const [cat, n] of Object.entries(counts)) {
      // ปังจริงดันหมวดขึ้น แป้กกดลง — จำกัด -6..+8 กันเหวี่ยงแรงเกิน
      boost[cat] = Math.max(-6, Math.min(8, (n.viral - n.flop) * 2));
    }
  } catch { /* อ่าน feedback ไม่ได้ = ไม่ปรับ */ }
  _perfCache = { at: Date.now(), boost };
  return boost;
}

export function fitScore(category, perfBoost = null) {
  const base = FIT_WEIGHTS[category] ?? 6;
  const learned = perfBoost?.[category] || 0;
  return Math.max(0, base + learned);
}

export function freshScore(publishedAt) {
  if (!publishedAt) return 8;
  const ageH = (Date.now() - new Date(publishedAt).getTime()) / 36e5;
  if (Number.isNaN(ageH)) return 8;
  if (ageH <= 6) return 20;
  if (ageH <= 24) return 14;
  if (ageH <= 72) return 8;
  return 4; // ข่าวเก่า — ยังมีค่าในเลนน้ำดี
}

let _archiveTitleCache = { at: 0, titles: [] };
export async function loadArchiveTitles() {
  if (Date.now() - _archiveTitleCache.at < 10 * 60 * 1000) return _archiveTitleCache.titles;
  try {
    const store = createStore('news-archive');
    const all = await store.getAll();
    _archiveTitleCache = { at: Date.now(), titles: all.map(a => String(a.title || '')).filter(Boolean) };
  } catch { /* archive อ่านไม่ได้ = ไม่กันซ้ำ ดีกว่าพังทั้งคิว */ }
  return _archiveTitleCache.titles;
}

export function isDuplicateOfArchive(title, archiveTitles) {
  const t = String(title || '').replace(/\s+/g, '');
  if (t.length < 12) return false;
  for (const at of archiveTitles) {
    const a = at.replace(/\s+/g, '');
    // แชร์ substring ยาว 14 ตัวอักษร = น่าจะเรื่องเดียวกัน
    for (let p = 0; p + 14 <= t.length; p += 7) {
      if (a.includes(t.substr(p, 14))) return true;
    }
  }
  return false;
}

// ════════════════════════════════════════════════════
// ★ ทีม บก.เฉพาะทาง (ผู้ใช้ 11 มิ.ย.) — แต่ละแนวมี บก. ที่เก่งแนวนั้นจริงๆ คนเดียว
// ใช้ 2 ที่: (1) editorialJudge เลือก persona ตามเลน (2) action "ปรึกษา บก." เจาะรายข่าว
// ════════════════════════════════════════════════════
export const SPECIALIST_EDITORS = {
  good: {
    name: 'บก.ข่าวน้ำดี',
    icon: '💚',
    lanes: ['good', 'evergreen', 'evergreen-celeb', 'followup'],
    persona: 'คุณคือ บก.ข่าวน้ำดี ประสบการณ์ 15 ปี เชี่ยวชาญข่าวน้ำใจ/กตัญญู/สู้ชีวิต/คนดังทำดี รู้ลึกว่าข่าวแนวนี้ปังเพราะ "รายละเอียดเล็กที่จริง" (ตัวเลขเงิน ระยะเวลา คำพูดจากปาก) ไม่ใช่ความซึ้งลอยๆ และรู้ว่าเรื่องซ้ำซาก (บริจาคทั่วไป) ต้องมีมุมใหม่ถึงค่อยทำ',
  },
  drama: {
    name: 'บก.ดราม่า',
    icon: '🌶️',
    lanes: ['trend', 'buzz'],
    persona: 'คุณคือ บก.ดราม่า/กระแส ที่เก่งสุดเรื่อง "เล่นดราม่าแบบไม่ไหม้" — รู้ว่าเพจโดน Facebook กดรีชถ้า toxic จึงถนัดแปลงเรื่องร้อนให้เล่าได้แบบมีชั้นเชิง: เล่าผ่านข้อเท็จจริง+คำพูดจริง ไม่ตัดสินแทนคนอ่าน ไม่โจมตีใคร และเตือนได้แม่นว่าเรื่องไหน "อย่าแตะ" เพราะเสี่ยงกฎหมาย/ดราม่าย้อนเข้าเพจ',
  },
  interview: {
    name: 'บก.บทสัมภาษณ์',
    icon: '🎙️',
    lanes: ['interview'],
    persona: 'คุณคือ บก.สายสัมภาษณ์ เก่งการฟัง 35 นาทีแล้วชี้ "ประโยคเดียวที่คนจะแชร์" ถนัดแปลงบทสนทนายาวเป็นโพสต์สั้นที่เก็บหัวใจครบ และรู้ว่าคำพูดไหนยกมาตรงๆ ได้ คำพูดไหนต้องเล่าอ้อม',
  },
  // ★ v4 (15 มิ.ย. คำสั่งทีม): บก.ดาราทุกแนว — ดราม่านุ่มของคนดังเล่นเป็นข่าวได้ กันเฉพาะกฎเหล็ก
  celeb: {
    name: 'บก.บันเทิง-คนดัง',
    icon: '🎬',
    lanes: ['celeb', 'throwback'],
    persona: 'คุณคือ บก.สายบันเทิง/คนดัง รู้ลึกว่าข่าวดารา "ทุกแนว" เล่นเป็นโพสต์ได้ — ความรัก เลิกรา อกหัก ปัญหาครอบครัว หนี้สิน-เงิน คัมแบ็ก ดราม่าวงการ และสัมภาษณ์เก่าที่หยิบมาเล่าใหม่ได้ (ย้อนฟังตอนเลิกกัน/อกหัก/ช่วงตกต่ำ) ถนัดเล่าดราม่านุ่มแบบมีรสนิยม เล่าผ่านข้อเท็จจริง+คำพูดจริง ไม่ตัดสินแทนคนอ่าน ไม่โจมตี และรู้ชัดว่าเรื่องไหนข้ามเส้นกฎเหล็ก (ฆ่า/ทารุณ/ล่วงละเมิด/เหล้า/พนัน/ยา) ต้องไม่แตะ',
  },
};

export function specialistForLane(lane) {
  for (const sp of Object.values(SPECIALIST_EDITORS)) {
    if (sp.lanes.includes(lane)) return sp;
  }
  return SPECIALIST_EDITORS.drama;
}

/** ★ ปรึกษา บก.ประจำแนว รายข่าว — แตกประเด็นลึก: ทำได้กี่แนว แต่ละแนวเล่นยังไง เสี่ยงอะไร */
export async function consultSpecialist(item) {
  const sp = specialistForLane(item.lane);
  const research = item.research?.enrichedSummary
    ? `\nข้อมูลเจาะลึกที่มี:\n${item.research.enrichedSummary}\n${(item.research.keyFacts || []).map(f => '- ' + f).join('\n')}`
    : '';
  const res = await callAI({
    prompt: `${sp.persona}

ข่าว: ${item.title}
สรุป: ${String(item.snippet || '').slice(0, 250)}${research}
${item.judgeReason ? 'ความเห็นรอบคัด: ' + item.judgeReason : ''}

วิเคราะห์แบบ บก.ตัวจริงสั่งลูกทีม ตอบ JSON เท่านั้น:
{"verdict":"ทำ|ทำแบบมีเงื่อนไข|ไม่ทำ",
"verdictWhy":"เหตุผล 1 ประโยค",
"angles":[{"name":"ชื่อแนว สั้นๆ","how":"เล่ายังไง เปิดด้วยอะไร เน้นอะไร (≤120 ตัวอักษร)","risk":"จุดเสี่ยง/ข้อระวังของแนวนี้ ('' ถ้าไม่มี)"}],
"bestAngle":"ชื่อแนวที่แนะนำสุด",
"doNot":"สิ่งที่ห้ามทำกับข่าวนี้เด็ดขาด ('' ถ้าไม่มี)"}
- ให้ 2-4 แนวที่ "ทำได้จริง" ตามแนวเพจ (น้ำดี/อบอุ่น/ดราม่ามีชั้นเชิง) ไม่ใช่แนวเพ้อ
- แนวลบ/โจมตี = ไม่นับเป็นแนว`,
    model: 'gpt-5.5',
    temperature: 0.3,
    maxTokens: 6000,
  });
  const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
  if (!parsed?.angles?.length) throw new Error('บก.วิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง');
  return {
    by: sp.name,
    icon: sp.icon,
    verdict: String(parsed.verdict || 'ทำ').slice(0, 30),
    verdictWhy: String(parsed.verdictWhy || '').slice(0, 150),
    angles: parsed.angles.slice(0, 4).map(a => ({
      name: String(a.name || '').slice(0, 50),
      how: String(a.how || '').slice(0, 150),
      risk: String(a.risk || '').slice(0, 100),
    })),
    bestAngle: String(parsed.bestAngle || '').slice(0, 50),
    doNot: String(parsed.doNot || '').slice(0, 120),
    at: new Date().toISOString(),
  };
}

// ── ชั้น 3: บรรณาธิการ AI (gpt-5.5) + few-shot จากการตัดสินใจจริงของทีม ──
// ★ 15 มิ.ย. (ทีมสั่ง "ลงสมอง AI"): คลังตัวอย่างทอง — ข่าวที่เพจปังจริง (หมื่นไลค์) สอน บก.AI ให้ล่าแนวนี้+ให้คะแนนสูง
//   แนวร่วม: "คนตัวเล็ก/ดารา ที่มีหัวใจ + การกระทำเป็นรูปธรรม + มีตัวละครชัด (ใครทำอะไรเพื่อใคร)"
//   ขยายลิสต์นี้ได้เรื่อยๆ เมื่อทีมชี้ข่าวที่ปังจริง
const GOLD_EXAMPLES = [
  'น้องอินเตอร์ ถอยรถป้ายแดง ออกรถให้พ่อแม่ — ลูกซื้อรถตอบแทนพ่อแม่ มีตัวละครชัด [กตัญญู/ครอบครัวอบอุ่น]',
  'เบสท์ คำสิงห์ ออกรถหรูให้น้องชาย เป็นของขวัญวันเกิด 18 ปี — ดาราให้ของขวัญ/ดูแลครอบครัว [กตัญญู/ครอบครัวอบอุ่น]',
  'ครูปลา จิตรลดา ครูปฐมวัยหัวใจเดียวกับเด็ก — ครูทุ่มเทเสียสละเพื่อเด็กเล็ก คนตัวเล็กมีหัวใจ [สู้ชีวิต]',
  'ลิลลี่ ภัณฑิลา ซื้อที่ดินสร้างบ้านให้คุณแม่ — ลูกกตัญญูสร้างบ้านให้แม่ [กตัญญู/ครอบครัวอบอุ่น]',
];

async function getJudgeFewshot() {
  // ★ คลังทองสอนเสมอ (แม้ยังไม่มี feedback) — เป้าหมายที่ บก.AI ต้องล่า
  const goldBlock = '\n=== 🏆 แนวที่เพจปังจริง (หมื่นไลค์+) — ข่าวคล้ายแบบนี้คือเป้าหมาย ให้คะแนนสูงเสมอ ===\n' +
    GOLD_EXAMPLES.map(g => '🏆 ' + g).join('\n') + '\n' +
    'หัวใจร่วม: คน/ดาราตัวจริงทำสิ่งดีเป็นรูปธรรม (ออกรถ/สร้างบ้าน/ทุ่มเทให้คน) + มีตัวละครชัด + อารมณ์ร่วมสูง — เจอแนวนี้ดันคะแนนขึ้น\n';
  try {
    const store = createStore('news-desk-feedback');
    const all = await store.getAll();
    const recent = all.slice(-100);
    const viral = recent.filter(f => f.action === 'viral').slice(-5);
    const flop = recent.filter(f => f.action === 'flop').slice(-5);
    const picked = recent.filter(f => f.action === 'sent' || f.action === 'claimed').slice(-6);
    // ★ 15 มิ.ย.: จำ "ที่ทีมกดไม่เอา" มากขึ้น (8 ใบ) — ระบบเรียนรู้ว่าข่าวแบบไหนทีมไม่เอา ให้คะแนนต่ำลง
    const dropped = recent.filter(f => f.action === 'dismissed').slice(-8);
    if (picked.length === 0 && dropped.length === 0 && viral.length === 0) return goldBlock;
    return goldBlock + '\n=== รสนิยมจริงของกองบรรณาธิการ (เรียนจากผลจริงล่าสุด) ===\n' +
      viral.map(f => `🔥 โพสต์แล้วปังจริง: ${String(f.title).slice(0, 80)} [${f.category || ''}]`).join('\n') + (viral.length ? '\n' : '') +
      flop.map(f => `🧊 โพสต์แล้วแป้ก: ${String(f.title).slice(0, 80)} [${f.category || ''}]`).join('\n') + (flop.length ? '\n' : '') +
      picked.map(f => `✅ ทีมเลือกทำ: ${String(f.title).slice(0, 80)} [${f.category || ''}]`).join('\n') + '\n' +
      dropped.map(f => `❌ ทีมกดทิ้ง: ${String(f.title).slice(0, 80)} [${f.category || ''}]`).join('\n') + '\n';
  } catch { return goldBlock; }
}

export async function editorialJudge(items) {
  if (!items.length) return items;
  const fewshot = await getJudgeFewshot();
  const out = [];
  // ★ จัดกลุ่มตาม บก.เฉพาะทาง — แต่ละแนวถูกตัดสินโดย บก. ที่เก่งแนวนั้นจริงๆ
  const groups = new Map();
  for (const it of items) {
    const sp = specialistForLane(it.lane);
    if (!groups.has(sp.name)) groups.set(sp.name, { sp, items: [] });
    groups.get(sp.name).items.push(it);
  }
  for (const { sp, items: groupItems } of groups.values()) {
  for (let i = 0; i < groupItems.length; i += 8) {
    const chunk = groupItems.slice(i, i + 8);
    const list = chunk.map((it, idx) =>
      `${idx}: [${it.category}|${it.tone}${it.subject === 'celeb' ? '|🎬ดารา' : ''}${it.dramaType === 'soft' ? '|ดราม่านุ่ม' : ''}${it.foreignCountry ? '|🌏' + it.foreignCountry : ''}] ${String(it.title).slice(0, 110)} — ${String(it.snippet || '').slice(0, 180)}`).join('\n');
    try {
      const res = await callAI({
        prompt: `${sp.persona}
(บริบทเพจ: แนวถนัดคือ น้ำใจ กตัญญู สู้ชีวิต คนดังทำดี เรื่องอบอุ่นใจ — เนื้อหาลบ/toxic ทำได้จำกัดเพราะเพจโดนกดรีช)
${fewshot}
ให้คะแนน "น่าหยิบมาทำโพสต์" 0-10 ต่อข่าว + เหตุผลสั้น + แตกประเด็น 2 มุมที่เพจเราเล่นได้
เกณฑ์: เรื่องคนตัวเล็ก/อารมณ์ร่วมสูง/มีตัวเลข-รายละเอียดเจาะใจ = สูง | ข่าวแถลง/การเมือง/ไกลตัวคนไทย = ต่ำ
★ ข่าวต่างประเทศ (ติดป้าย 🌏) — เกณฑ์เข้ม (ทีมสั่ง 12 มิ.ย.): ผ่านได้เฉพาะบุคคล/เรื่องที่ "นิยมในไทยจริง" คนไทยตามอยู่แล้ว (ไอดอลเกาหลีดัง, ดาราฮอลลีวูดดัง, CEO ระดับโลก, ทีม/นักกีฬาที่คนไทยเชียร์)
  ให้ 0-3 ไปเลยกับ: ข่าวชาวบ้านทั่วไปในต่างประเทศ (น้ำใจ/อุบัติเหตุ/สัตว์ทำร้ายคน) · บุคคลต่างชาติที่คนไทยไม่คุ้นหู (ดาราจีน/ฮ่องกง/ตะวันตกที่ไม่ดังในไทย) · ข่าวคนไทยเอี่ยวนิดเดียวในต่างแดน (เช่น คนไทยเก็บเงินได้/ทำดีเล็กๆ ที่ต่างประเทศ) — กลุ่มนี้หาเนื้อข่าวจริง+รูปประกอบแทบไม่ได้ แหล่งข่าวน้อย เขียนต่อไม่ได้จริง
★ ดารา/คนดัง v4 (15 มิ.ย. คำสั่งทีม "ดาราเอาทุกแนว"): ดราม่า "นุ่ม" ของดารา — ความรัก/เลิกรา/อกหัก/ปัญหาครอบครัว/หนี้สิน-เงิน/ดราม่าวงการบันเทิง/คัมแบ็ก/สัมภาษณ์เปิดใจ (รวมสัมภาษณ์เก่าหยิบมาเล่าใหม่ throwback) = เล่นเป็นข่าวได้เต็มที่ ให้คะแนนตาม "ความน่าสนใจ + คนไทยตามจริง" ไม่ใช่กดเพราะเป็นดราม่า — ดาราดังที่คนรู้จัก + เรื่องมีปม/อารมณ์ร่วม/คำพูดเจาะใจ = สูง
  (ของหนักกฎเหล็ก — ฆ่า/ทารุณ/ล่วงละเมิด/เหล้า/พนัน/ยา — ถูกตัดที่ประตูแล้ว ไม่ต้องเจอในนี้)
★ กระแสบวกในอดีต (ทีมสั่ง 12 มิ.ย. ค่ำ): เหตุการณ์เฉพาะครั้งที่จบไปแล้ว (เช่น คนดังจ่ายหนี้ให้แม่เมื่อปีก่อน) ดูเหมือนน้ำดีแต่เขียนวันนี้ = ขุดของเก่า ให้ 0-3 — ยกเว้นเสนอเป็นมุม "ตามรอย: ตอนนี้เป็นยังไงแล้ว" ถึงให้คะแนนปกติได้ | ต่างจากเรื่องแบบแผนไร้กาลเวลา (ดาราติดดิน, กตัญญู, รับเลี้ยงสัตว์) ที่เล่าได้เสมอ ให้คะแนนตามคุณภาพปกติ
  ★ ยกเว้นเลน throwback (ย้อนสัมภาษณ์ดารา — ตอนเลิกกัน/อกหัก/ช่วงตกต่ำ): ตั้งใจหยิบของเก่ามาเล่า "ย้อนฟัง" ให้คะแนนตามความน่าสนใจปกติ ไม่ถือเป็นการขุดของเก่า
ข่าว:
${list}

ตอบ JSON: {"items":[{"i":0,"score":0-10,"reason":"สั้น","angles":["มุม 1","มุม 2"]}]}`,
        model: 'gpt-5.5',
        temperature: 0.2,
        maxTokens: 6000, // reasoning model ต้องมี headroom
      });
      const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
      for (const r of parsed?.items || []) {
        const it = chunk[r.i];
        if (!it) continue;
        out.push({
          ...it,
          judgeScore: Math.min(10, Math.max(0, Number(r.score) || 0)),
          judgeReason: String(r.reason || '').slice(0, 140),
          angles: (r.angles || []).slice(0, 3).map(a => String(a).slice(0, 90)),
        });
      }
      // ตัวที่ judge ไม่ตอบ → คงไว้แบบไม่มีคะแนน judge
      chunk.forEach(it => { if (!out.find(o => o.id === it.id)) out.push(it); });
    } catch (e) {
      console.log('[DeskBrain] judge chunk failed:', e.message?.slice(0, 60));
      out.push(...chunk);
    }
  }
  }
  return out;
}

export function finalScore(item, perfBoost = null) {
  const fit = fitScore(item.category, perfBoost);
  // evergreen/throwback = ของเก่าตั้งใจหยิบ ไม่หักความสด | good/celeb = มีพื้นขั้นต่ำ | buzz = แชร์จริง+โบนัส | trend = วัดความสดจริง
  const fresh = (item.lane === 'evergreen' || item.lane === 'evergreen-celeb' || item.lane === 'throwback') ? 10
    : (item.lane === 'good' || item.lane === 'celeb') ? Math.max(8, freshScore(item.publishedAt))
    : item.lane === 'buzz' ? Math.min(20, freshScore(item.publishedAt) + 6)
    : freshScore(item.publishedAt);
  const judge = (item.judgeScore ?? 5) * 5; // 0-50
  const toxPenalty = (item.toxicity || 0) * 3 + (item.fbRisk || 0) * 3;
  return Math.max(0, Math.min(100, Math.round(fit + fresh + judge - toxPenalty)));
}

// ════════════════════════════════════════════════════
// Mix Governor (เฟส 2) — คุมส่วนผสมรายวัน กันเพจ toxic สะสมจนโดน FB กดรีช
// ════════════════════════════════════════════════════
// กลุ่มหมวด: positive (น้ำดี) ต้อง ≥40% ของที่ส่งทำวันนี้ | drama ≤20% | warn ≤15%
const CAT_GROUP = {
  'น้ำใจ/ช่วยเหลือ': 'positive', 'กตัญญู/ครอบครัวอบอุ่น': 'positive', 'สู้ชีวิต': 'positive',
  'คนดังทำดี/ติดดิน': 'positive', 'สัมภาษณ์/บทสนทนาดี': 'positive',
  // คนดัง/ดราม่าบันเทิง = neutral (ดราม่าบันเทิงปกติ ไม่ใช่ดราม่าสังคมร้อน — ไม่โดนเพดาน drama กดจม)
  'บันเทิงกระแส': 'neutral', 'คนดัง/ดราม่าบันเทิง': 'neutral', 'อื่นๆ': 'neutral',
  'ดราม่าสังคม': 'drama', 'เตือนภัย/อุทาหรณ์': 'warn',
};
export const MIX_POLICY = { positive: { min: 0.4 }, drama: { max: 0.2 }, warn: { max: 0.15 } };

/**
 * คำนวณสถานะส่วนผสมวันนี้ + boost/sink รายการ feed ตามโควตาที่เหลือ
 * @param {Array} items - feed ที่จะแสดง
 * @param {Object} mixToday - { หมวด: จำนวนที่ส่งทำวันนี้ }
 */
export function applyMixGovernor(items, mixToday) {
  const groupCount = { positive: 0, neutral: 0, drama: 0, warn: 0 };
  let total = 0;
  for (const [cat, n] of Object.entries(mixToday || {})) {
    groupCount[CAT_GROUP[cat] || 'neutral'] += n;
    total += n;
  }
  const ratio = (g) => (total > 0 ? groupCount[g] / total : 0);

  const governor = {
    total,
    positivePct: Math.round(ratio('positive') * 100),
    dramaPct: Math.round(ratio('drama') * 100),
    warnPct: Math.round(ratio('warn') * 100),
    positiveOk: total === 0 || ratio('positive') >= MIX_POLICY.positive.min,
    dramaOk: ratio('drama') <= MIX_POLICY.drama.max,
    warnOk: ratio('warn') <= MIX_POLICY.warn.max,
  };

  // boost/sink: เกินเพดานแล้ว → การ์ดกลุ่มนั้นจม / น้ำดียังไม่ถึงเป้า → การ์ดน้ำดีลอย
  const adjusted = items.map(it => {
    const g = CAT_GROUP[it.category] || 'neutral';
    let bonus = 0;
    if (total >= 3) { // เริ่มคุมเมื่อวันนี้ส่งทำแล้วอย่างน้อย 3 ข่าว
      if (g === 'drama' && !governor.dramaOk) bonus -= 25;
      if (g === 'warn' && !governor.warnOk) bonus -= 25;
      if (g === 'positive' && !governor.positiveOk) bonus += 15;
    }
    return { ...it, _govBonus: bonus, _sortScore: (it.finalScore || 0) + bonus };
  });
  adjusted.sort((a, b) => b._sortScore - a._sortScore);
  return { items: adjusted, governor };
}

// ════════════════════════════════════════════════════
// Discovery Ranking (15 มิ.ย.) — แก้ "ฟีดวนข่าวเดิม + ข่าวคะแนนกลางจมล่างไม่เคยผ่านตา"
//   เดิมเรียง _sortScore ล้วน → การ์ดคะแนนสูงเกาะหัวฟีดตลอด, 50-60 ไม่มีโอกาสถูกเห็น
//   ใหม่ 3 กลไก: ① ดันข่าวใหม่/ยังไม่มีใครแตะ ② หมุนเวียนตามเวลา (สลับลำดับเองทุกช่วง)
//             ③ สปอตไลต์ — แทรกข่าวคะแนนกลางที่ถูกฝัง ลงตำแหน่งที่มองเห็น
//   *รักษาความนิ่งพอให้คนกดทำได้: ภายในช่วงเวลาเดิม ลำดับคงที่ (rotate เป็นช่วง ไม่ใช่ทุกรีเฟรช)
// ════════════════════════════════════════════════════
export function applyDiscoveryRanking(items, opts = {}) {
  if (!Array.isArray(items) || items.length <= 3) return items || [];
  const now = Date.now();
  const rotateMs = opts.rotateMs ?? 10 * 60 * 1000;   // โครงหลักสลับลำดับทุก ~10 นาที
  const spotMs = opts.spotMs ?? 4 * 60 * 1000;        // ช่องสปอตไลต์หมุนไวกว่า ~4 นาที
  const mainBucket = Math.floor(now / rotateMs);
  const spotBucket = Math.floor(now / spotMs);
  // hash id+bucket → 0..1 (เปลี่ยน bucket = ได้ค่าใหม่ = หมุนเวียน)
  const rnd = (id, bucket, salt = 0) => {
    let h = (2166136261 ^ bucket ^ (salt * 2654435761)) >>> 0;
    const s = String(id || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return (h % 100000) / 100000;
  };

  const scored = items.map(it => {
    const base = it._sortScore ?? it.finalScore ?? 0;
    const ageH = Math.max(0, (now - new Date(it.harvestedAt || 0).getTime()) / 36e5);
    const freshBoost = ageH <= 6 ? 10 : ageH <= 24 ? 5 : 0;                       // ข่าวเพิ่งเข้าโต๊ะ ดันให้ผ่านตา
    const untouchedBoost = (!it.claimedBy && it.status === 'new') ? 4 : 0;        // ยังไม่มีใครพิจารณา ดันให้เห็น
    const jitter = (rnd(it.id, mainBucket) - 0.5) * 14;                           // ±7 หมุนเวียนตามเวลา
    const _discBase = base + freshBoost + untouchedBoost;
    return { ...it, _discBase, _disc: _discBase + jitter };
  });
  const ranked = [...scored].sort((a, b) => b._disc - a._disc);

  // ── สปอตไลต์: แทรกข่าวคะแนนกลางที่ถูกฝัง ลงตำแหน่งที่มองเห็น ──
  const SPOT_POSITIONS = opts.spotPositions ?? [5, 11, 17, 24]; // ตำแหน่ง 0-based ในฟีด
  const MID_MIN = opts.midMin ?? 40;                            // ข่าวคะแนนฐาน ≥40 ถึงคู่ควรถูกหยิบขึ้น
  const headIds = new Set(ranked.slice(0, (SPOT_POSITIONS.at(-1) || 0) + 1).map(i => i.id));
  // กองค้นพบ = คะแนนฐานพอใช้ + ไม่ใช่กลุ่มที่ governor กดจม (_govBonus<0) + ยังไม่อยู่โซนหัว
  const pool = ranked.filter(it => (it._discBase || 0) >= MID_MIN && (it._govBonus ?? 0) >= 0 && !headIds.has(it.id));
  if (pool.length === 0) return ranked;

  // หยิบจากกองค้นพบแบบหมุนเวียนเร็ว (spotBucket) — เปลี่ยนหน้าทุก ~4 นาที
  const picks = [...pool].sort((a, b) => rnd(a.id, spotBucket, 3) - rnd(b.id, spotBucket, 3)).slice(0, SPOT_POSITIONS.length)
    .map(p => ({ ...p, _spotlight: true }));
  const pickIds = new Set(picks.map(p => p.id));

  // ประกอบฟีดใหม่: เดินตาม ranked (ข้ามใบที่ถูกหยิบ) แล้ววางสปอตไลต์ตามตำแหน่ง
  const flow = ranked.filter(it => !pickIds.has(it.id));
  const out = [];
  let fi = 0, si = 0;
  for (let pos = 0; out.length < ranked.length; pos++) {
    if (si < picks.length && pos === SPOT_POSITIONS[si]) out.push(picks[si++]);
    else if (fi < flow.length) out.push(flow[fi++]);
    else if (si < picks.length) out.push(picks[si++]);
    else break;
  }
  return out;
}
