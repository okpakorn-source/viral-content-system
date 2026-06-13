/**
 * =====================================================
 * กองสืบน้ำดี (Good-News Scout Squad) — เฟส 1 (13 มิ.ย. 69 คำสั่งทีม)
 * =====================================================
 * ปัญหาเดิม: เลนน้ำดีใช้คำค้นตายตัว 18 ชุดหมุนวนซ้ำ → เจอแต่ข่าวที่ทุกเพจก็เจอ
 *           ข่าวน้ำดีดีๆ ที่ "ไม่มีใครนึกถึง" ไม่เคยถูกขุด
 * วิธีใหม่: สมองสืบ 7 แนว แต่ละแนวเชี่ยวชาญคนละด้านของข่าวน้ำดี
 *   - ทุกรอบหมุนเวร 2 แนว → AI คิดคำค้น "สด" เชิงลึกตามแนวนั้น (ไม่ใช่ลิสต์ตายตัว)
 *   - ความจำกันค้นซ้ำ: ไม่คิดคำที่เพิ่งใช้ใน 3 วัน → ขุดกว้างขึ้นเรื่อยๆ ไม่วนที่เดิม
 *   - ล่มเมื่อไหร่ fallback ไปคำค้นตายตัวเดิม (ไม่ทำให้รอบเก็บพัง)
 * ต้นทุน: 1 คอล gpt-4o-mini/รอบ (~฿0.5) + Serper เท่าเดิม (6 คำค้น/รอบ)
 */
import { callAI } from '@/lib/ai/openai';
import { createStore } from '@/lib/persistStore';

// 7 แนวข่าวน้ำดีที่เพจเล่นได้ — แต่ละแนวมีคำอธิบาย + ตัวอย่างจุดที่อยากได้ (seed ให้ AI เห็นทิศ)
export const SCOUT_GENRES = [
  { key: 'celeb_good', name: 'ดาราใจบุญ-กตัญญู', brief: 'ดารา/คนดังบริจาค ดูแลพ่อแม่ ทำบุญ ช่วยเหลือเงียบๆ คืนกำไรสังคม', seed: 'ดาราสร้างตึกให้โรงพยาบาล, นักร้องดูแลแม่ป่วย, ดาราบริจาคทุนเด็กกำพร้า' },
  { key: 'ordinary_fighter', name: 'สามัญชนสู้ชีวิต', brief: 'คนธรรมดาฝ่าฟันความยากจน/อุปสรรค จนตั้งตัวได้/สำเร็จ', seed: 'แม่ค้าส่งลูกเรียนหมอ, คนพิการเปิดธุรกิจ, เด็กยากจนสอบติดมหาลัยดัง' },
  { key: 'thai_abroad', name: 'คนไทยไกลบ้าน (ใจฟู)', brief: 'คนไทยไปรุ่ง/ทำอาชีพน่าทึ่ง/สร้างชื่อในต่างแดน — แนวที่คนไทยภูมิใจ', seed: 'สาวไทยขับรถบรรทุกอเมริกาเงินเดือนสูง, เชฟไทยร้านมิชลินยุโรป, คนไทยเป็นพยาบาลญี่ปุ่น' },
  { key: 'good_samaritan', name: 'น้ำใจ-พลเมืองดี', brief: 'คืนของ/คืนเงิน ช่วยชีวิต ช่วยคนเดือดร้อน โดยไม่หวังผล', seed: 'วินคืนกระเป๋าเงินแสน, พลเมืองดีช่วยคนจมน้ำ, คนเก็บเงินได้ตามคืนเจ้าของ' },
  { key: 'animal_love', name: 'รักสัตว์', brief: 'ช่วย/เลี้ยง/รักษาสัตว์จร ความผูกพันคนกับสัตว์', seed: 'หนุ่มเลี้ยงหมาจร 50 ตัว, ช่วยช้างป่วย, แมวเฝ้าหลุมเจ้าของ' },
  { key: 'youth_good', name: 'เด็ก-เยาวชนเก่งดี', brief: 'เด็ก/เยาวชนกตัญญู เก่ง มีน้ำใจ ทำเพื่อครอบครัว/สังคม', seed: 'เด็กเก็บขยะส่งตัวเองเรียน, นักเรียนช่วยคนแก่ข้ามถนน, เด็กคืนเงินที่เก็บได้' },
  { key: 'elder_admirable', name: 'ผู้สูงวัย-อาชีพน่าทึ่ง', brief: 'คนแก่สู้ชีวิต อาชีพหายาก/น่าทึ่ง ภูมิปัญญา', seed: 'ยายขายขนม 40 ปีส่งหลานเรียนจบ, ตาวัย 80 ยังทำงานช่าง, ป้าทำอาชีพโบราณ' },
];

// ★ ทะเบียนดาราดัง (13 มิ.ย. 69): ข่าวดาราดังทำดีคือของที่ดันเพจสุด แต่คำค้นกว้างหาไม่เจอ
//   ต้องค้น "ด้วยชื่อ" ถึงเจอ เช่น "พลอย เฌอมาลย์ สร้างบ้าน" — หมุนชื่อทุกรอบ + คู่กับคำทำดี
const CELEB_REGISTRY = [
  'ญาญ่า อุรัสยา', 'ณเดชน์', 'ใบเตย อาร์สยาม', 'ลิซ่า ลลิษา', 'มาริโอ้ เมาเร่อ',
  'อั้ม พัชราภา', 'ชมพู่ อารยา', 'แต้ว ณฐพร', 'มิว นิษฐา', 'เฌอมาลย์ บุญยศักดิ์',
  'พลอย เฌอมาลย์', 'เบลล่า ราณี', 'เวียร์ ศุกลวัฒน์', 'หมาก ปริญ', 'เจมส์ จิรายุ',
  'ก้อย รัชวิน', 'ตูน บอดี้สแลม', 'พิม พิมประภา', 'มดดำ คชาภา', 'บูม กิตติคุณ',
  'เต้ย จรินทร์พร', 'แอฟ ทักษอร', 'นุ่น วรนุช', 'เจนนี่ ได้หมดถ้าสดชื่น', 'ลำไย ไหทองคำ',
  'หนูรัตน์', 'จ๊ะ นงผณี', 'ดีเจภูมิ', 'โตโน่ ภาคิน', 'บิ๊กเอ็ม กฤตฤทธิ์',
  'ก๊อต จิรายุ', 'เวฟ กันตพงศ์', 'ป๊อก ภัสสรกรณ์', 'หนิง ปณิตา', 'น้ำชา ชีรณัฐ',
  'ลูกหว้า พิจิกา', 'อ๋อม สกาวใจ', 'ฟิล์ม ธนภัทร', 'แจ๊ส ชวนชื่น', 'เก้า จิรายุ',
];

// คำ "ทำดี" คู่กับชื่อดารา
const GOOD_DEED_TERMS = ['บริจาค ช่วยเหลือ', 'สร้างบ้านให้ ยกที่ดิน', 'ทำบุญ การกุศล', 'ดูแลพ่อแม่ กตัญญู', 'ติดดิน ใจดี น้ำใจ'];

// คำค้นกว้าง "ดาราทำดี" — ไม่ระบุชื่อ ดูดได้เยอะ (Serper คืน ~10/คำ) จับว่าดาราไหนก็ตามที่เพิ่งทำดี
const CELEB_BROAD_TERMS = [
  'คนดัง สร้างบ้าน มอบ ยกที่ดิน', 'ดารา บริจาค ช่วยเหลือ ล่าสุด', 'นักร้อง นักแสดง ทำบุญ การกุศล',
  'ดาราติดดิน ใจดี น้ำใจ', 'คนดัง ช่วยน้ำท่วม ผู้ประสบภัย', 'ดารา ดูแลพ่อแม่ กตัญญู ซื้อบ้าน',
  'เซเลบ บริจาคโรงพยาบาล มูลนิธิ', 'ดารา เปิดตัวช่วยสังคม โครงการ',
];

/** คำค้นดาราทำดี: คำกว้าง 2 (เยอะ) + ชื่อเฉพาะ 1 (แม่น) — หมุนตามชั่วโมง */
function pickRotatingCelebs(count = 3) {
  const hour = Math.floor(Date.now() / 3600e3);
  const out = [];
  // 2 คำกว้าง (ดูดวอลุ่ม)
  out.push(CELEB_BROAD_TERMS[(hour * 2) % CELEB_BROAD_TERMS.length]);
  out.push(CELEB_BROAD_TERMS[(hour * 2 + 1) % CELEB_BROAD_TERMS.length]);
  // 1 ชื่อเฉพาะ (เจาะดารา A-list — วนครบทะเบียนใน ~40 ชม.)
  const name = CELEB_REGISTRY[hour % CELEB_REGISTRY.length];
  const deed = GOOD_DEED_TERMS[hour % GOOD_DEED_TERMS.length];
  out.push(`${name} ${deed}`);
  return out.slice(0, count);
}

/** หมุนเวรเลือกแนวตามชั่วโมง (celeb แยกเป็นเครื่องค้นชื่อ + พัก thai_abroad เพราะตัดต่างประเทศแล้ว) */
export function pickRotatingGenres(count = 1) {
  // celeb_good → เครื่องค้นชื่อ (ทุกรอบ) | thai_abroad → พักไว้ (ติดด่านตัดต่างประเทศ 13 มิ.ย., ปลุกคืนเฟส 2)
  const others = SCOUT_GENRES.filter(g => g.key !== 'celeb_good' && g.key !== 'thai_abroad');
  const hour = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (let i = 0; i < count; i++) out.push(others[(hour * count + i) % others.length]);
  return out;
}

const MEMORY_ID = 'scout-keyword-log';

/** อ่านคำค้นที่เพิ่งใช้ใน 3 วัน (เพื่อบอก AI ห้ามคิดซ้ำ) */
async function loadRecentKeywords() {
  try {
    const store = createStore('scout-memory');
    const all = await store.getAll();
    const doc = all.find(d => d.id === MEMORY_ID);
    if (!doc || !Array.isArray(doc.keywords)) return [];
    const cutoff = Date.now() - 3 * 864e5;
    return doc.keywords.filter(k => new Date(k.at).getTime() > cutoff).map(k => k.q);
  } catch { return []; }
}

/** บันทึกคำค้นที่เพิ่งใช้ (เก็บล่าสุด 120 คำ) */
async function saveUsedKeywords(queries) {
  try {
    const store = createStore('scout-memory');
    const all = await store.getAll();
    const doc = all.find(d => d.id === MEMORY_ID);
    const now = new Date().toISOString();
    const fresh = queries.map(q => ({ q, at: now }));
    if (doc) {
      const merged = [...fresh, ...(doc.keywords || [])].slice(0, 120);
      await store.update(MEMORY_ID, (ex) => ({ ...ex, keywords: merged }));
    } else {
      await store.add({ id: MEMORY_ID, keywords: fresh });
    }
  } catch (e) { console.log('[Scout] บันทึกความจำล้ม:', e.message?.slice(0, 40)); }
}

/**
 * สร้างคำค้นข่าวน้ำดีสด ๆ จากสมองสืบ 2 แนวที่เวรอยู่ชั่วโมงนี้
 * @returns {Promise<Array<{q:string, genre:string}>>} — [] ถ้าล่ม (ให้ caller fallback)
 */
export async function generateScoutQueries(total = 6) {
  // ★ ค้นดาราดังด้วยชื่อทุกรอบ (3 ชื่อ) — ของที่ดันเพจสุด คำกว้างหาไม่เจอ
  const celebQs = pickRotatingCelebs(3).map(q => ({ q, genre: 'ดาราดังทำดี' }));

  // + 1 แนวหมุนเวร (AI คิดคำค้นสด 3 คำ)
  const genres = pickRotatingGenres(1);
  const recent = await loadRecentKeywords();

  const prompt = `คุณคือกองสืบข่าว "น้ำดี" ของเพจข่าวไวรัลไทย หน้าที่: คิดคำค้น Google News ที่จะไปเจอข่าวน้ำดีที่ "ทำได้จริงและคนไทยรัก" แต่คนอื่นไม่ค่อยขุด

แนวที่ต้องล่าชั่วโมงนี้:
${genres.map((g, i) => `${i + 1}. [${g.name}] ${g.brief}\n   แนวตัวอย่าง: ${g.seed}`).join('\n')}

กติกาคิดคำค้น:
- คิดคำค้นเฉพาะเจาะจง ลึก หลากหลายสถานการณ์ (ไม่ใช่คำกว้างๆ ที่ทุกคนค้น) — นึกถึงเรื่องจริงที่คนจะใจฟู
- ต้องเป็น "คนไทย" หรือเรื่องที่คนไทยอินได้ (เว็บข่าวไทย)
- เลี่ยงคำที่เคยใช้ไปแล้ว (ห้ามซ้ำลิสต์นี้): ${recent.slice(0, 40).join(' | ') || '(ยังไม่มี)'}
- คำค้นละ 2-6 คำ เป็นภาษาไทย กระชับ

ตอบ JSON เท่านั้น: {"queries":[{"genre":"ชื่อแนว","q":"คำค้น"}]} รวม 3 คำ`;

  let genreQs = [];
  try {
    const res = await callAI({ model: 'gpt-4o-mini', temperature: 0.8, maxTokens: 600, prompt });
    const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
    genreQs = (parsed.queries || [])
      .map(x => ({ q: String(x.q || '').trim(), genre: String(x.genre || '') }))
      .filter(x => x.q.length >= 4 && x.q.length <= 60)
      .slice(0, 3);
  } catch (e) {
    console.log('[Scout] สมองสืบคิดคำแนวล่ม (ยังมีคำค้นดารา):', e.message?.slice(0, 50));
  }

  const all = [...celebQs, ...genreQs].slice(0, total);
  await saveUsedKeywords(all.map(x => x.q)).catch(() => {});
  console.log(`[Scout] 🕵️ กองสืบ: ดารา ${celebQs.length} คำ + แนว ${genres[0]?.name || '-'} ${genreQs.length} คำ`);
  return all;
}
