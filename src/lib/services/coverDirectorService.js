/**
 * =====================================================
 * Cover v3 — AI Vision Director
 * =====================================================
 * แนวคิด (11 มิ.ย.): "ตาของ AI ตัดสินใจ — เครื่องจักรพิกเซลลงมือ"
 * Director เห็นภาพจริงทุกใบ แล้วสั่งเป็นตัวเลขล้วน:
 *   เลือกรูปไหน → ลงช่องไหน → ครอปกรอบไหน (normalized 0-1)
 * ตัวประกอบ (coverExecutorService) ทำตามเป๊ะ = พิกเซลต้นฉบับ 100% โดยโครงสร้าง
 * ไม่มีสูตรครอป ไม่มี face-detection math — บั๊กตระกูลครอปตัดหัวตายทั้งตระกูล
 */

import sharp from 'sharp';
import { callAI } from '@/lib/ai/openai';

const DIRECTOR_MODEL = 'gpt-5.5';

/** สร้าง thumbnail + ขนาดจริงของทุกภาพ สำหรับส่งให้ Vision */
async function buildThumbnails(imageBuffers, maxImages = 10) {
  const out = [];
  for (let i = 0; i < Math.min(imageBuffers.length, maxImages); i++) {
    const buf = imageBuffers[i]?.buffer;
    if (!buf) continue;
    try {
      const meta = await sharp(buf).metadata();
      const thumb = await sharp(buf)
        .resize(420, 420, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      out.push({ index: i, base64: thumb.toString('base64'), width: meta.width || 0, height: meta.height || 0 });
    } catch { /* ข้ามภาพเสีย */ }
  }
  return out;
}

/** คำนวณว่าช่องนี้โดนช่อง z สูงกว่า "ลอยทับ" บริเวณไหน → บอก Director ให้เลี่ยงวางหน้าคนตรงนั้น */
function occlusionNote(slot, allSlots) {
  const overlaps = [];
  for (const other of allSlots) {
    if (other.id === slot.id || (other.zIndex ?? 0) <= (slot.zIndex ?? 0)) continue;
    const ix = Math.max(slot.x, other.x);
    const iy = Math.max(slot.y, other.y);
    const ix2 = Math.min(slot.x + slot.w, other.x + other.w);
    const iy2 = Math.min(slot.y + slot.h, other.y + other.h);
    if (ix2 <= ix || iy2 <= iy) continue;
    const areaPct = ((ix2 - ix) * (iy2 - iy)) / (slot.w * slot.h);
    if (areaPct < 0.05) continue;
    // อธิบายตำแหน่งที่โดนทับแบบสัดส่วนของช่อง (อ่านง่ายสำหรับ AI)
    const lx = ((ix - slot.x) / slot.w).toFixed(2);
    const ly = ((iy - slot.y) / slot.h).toFixed(2);
    const lx2 = ((ix2 - slot.x) / slot.w).toFixed(2);
    const ly2 = ((iy2 - slot.y) / slot.h).toFixed(2);
    overlaps.push(`"${other.id}" ทับช่วง x:${lx}-${lx2}, y:${ly}-${ly2} ของช่องนี้ (~${Math.round(areaPct * 100)}%)`);
  }
  if (overlaps.length === 0) return '';
  return ` ⚠️ โดนทับ: ${overlaps.join(' | ')} — ห้ามวางหน้าคน/จุดโฟกัสในบริเวณที่โดนทับ! จัดให้หน้าคนอยู่โซนที่เปิดโล่ง`;
}

function templateText(templateSpec) {
  return templateSpec.slots
    .map(s => `- "${s.id}": ตำแหน่ง(${s.x},${s.y}) ขนาด ${s.w}x${s.h}px (สัดส่วน ${(s.w / s.h).toFixed(2)}) ${s.note || ''}${occlusionNote(s, templateSpec.slots)}`)
    .join('\n');
}

/**
 * ให้ AI Vision กำกับการจัดปก
 * @param {Array} [templateOptions] — ถ้าส่งหลาย template มา Director จะ "เลือกโครงที่เล่าเรื่องนี้ได้ดีสุด" เอง
 * @returns {Promise<{templateSpec, assignments: Array<{slotId, imageIndex, crop:{x,y,w,h}}>, reason: string}|null>}
 */
export async function directCover({ imageBuffers, identity, templateSpec, templateOptions = null, newsTitle, faceBoxes = [] }) {
  const options = (templateOptions && templateOptions.length > 0) ? templateOptions : [templateSpec];
  const thumbs = await buildThumbnails(imageBuffers);
  const usable = options.filter(t => thumbs.length >= t.slots.length);
  if (usable.length === 0) {
    console.log(`[CoverDirector] ⚠️ ภาพใช้ได้ ${thumbs.length} < ช่องของทุก template`);
    return null;
  }

  const imageContents = thumbs.map(t => ({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${t.base64}`, detail: 'auto' },
  }));

  const dimsText = thumbs.map(t => {
    const fb = faceBoxes[t.index];
    const faceTxt = (fb && fb.x1 !== undefined)
      ? ` | ใบหน้าหลัก: x ${fb.x1}-${fb.x2}, y ${fb.y1}-${fb.y2} (กว้าง ${(fb.x2 - fb.x1).toFixed(2)})${fb.count > 1 ? ` [มี ${fb.count} หน้า]` : ''}`
      : '';
    const tr = fb?.textRegion;
    const textWarn = fb?.hasText
      ? (tr
        ? ` ⚠️ มีตัวหนังสือฝังโซน x ${tr.x1.toFixed(2)}-${tr.x2.toFixed(2)}, y ${tr.y1.toFixed(2)}-${tr.y2.toFixed(2)} — ใช้ได้ถ้าครอปแน่นที่คนโดยกรอบ "ไม่ทับโซนนี้" (เฟรมรายการทีวี: ซับอยู่แถบล่าง ครอปหน้า-ไหล่หลบได้) | ห้ามใช้กับช่อง circle`
        : ' ⛔ มีตัวหนังสือฝัง/สกรีนช็อต ไม่รู้ตำแหน่งข้อความ — ห้ามใช้กับช่องคนทุกช่อง')
      : '';
    return `#${t.index}: ${t.width}x${t.height}px${faceTxt}${textWarn}`;
  }).join('\n');

  const templatesBlock = usable.map(t =>
    `▼ "${t.id}"${t.storyFit ? ` — เหมาะกับ: ${t.storyFit}` : ''} (ใช้ ${t.slots.length} ภาพ, canvas ${t.canvasW}x${t.canvasH})\n${templateText(t)}`
  ).join('\n\n');

  const prompt = `คุณคือ Art Director มืออาชีพของเพจข่าวไวรัล กำลังจัดปกข่าวจากภาพจริง ${thumbs.length} ใบ (เรียงตามลำดับ #0 ถึง #${thumbs.length - 1})

=== ข่าว ===
หัวข้อ: ${newsTitle || '-'}
ตัวหลัก: ${identity?.mainCharacter || '-'}${identity?.secondaryCharacter ? `\nตัวรอง/คู่เรื่อง: ${identity.secondaryCharacter}` : ''}
เรื่อง: ${(identity?.coreStory?.celebratedAction || identity?.mainVisualShouldBe || '').slice(0, 200)}
อารมณ์ข่าว: ${identity?.coverEmotion || identity?.emotion || 'neutral'} ${identity?.coreStory?.emotionalHook ? `(hook: ${String(identity.coreStory.emotionalHook).slice(0, 80)})` : ''}

=== ขนาดจริงของแต่ละภาพ ===
${dimsText}

=== โครงปกให้เลือก (${usable.length} แบบ — แกะจากปกไวรัลจริงที่ได้หลักหมื่นไลก์) ===
${templatesBlock}

=== งานของคุณ ===
ขั้น 1: เลือก "โครงปก" ที่เล่าเรื่องนี้ได้ดีที่สุด (ดูจาก storyFit + ภาพที่มีจริง — เช่น เรื่องให้-รับที่มีภาพสองฝ่าย = quad_circle, เรื่องผู้ดูแล = hero_stack)
★ โครงที่มี circle/clip คือ "ลุคไวรัล" ที่ต้องการ — เลือกก่อนเสมอถ้าภาพพอ; v3_grid3 = ภาพเรียงธรรมดา ใช้เป็นทางหนีไฟเมื่อภาพคุณภาพดีมีไม่พอโครงอื่นเท่านั้น
ขั้น 2: เลือกภาพลงทุกช่องของโครงนั้น + กำหนดกรอบครอปเป็นสัดส่วน 0-1 ของภาพต้นฉบับ
(x,y = มุมซ้ายบนของกรอบ, w,h = กว้าง/สูงของกรอบ — เทียบกับขนาดเต็มของภาพนั้น)

กฎเหล็ก:
0. ★★★ หลักเหนือทุกข้อ (DNA ปกไวรัลจริง): "เน้นใบหน้าคนให้มากที่สุด ฉากหลังเอาแค่จำเป็น"
   — ทุกช่องที่มีคน: คนต้องกินพื้นที่ส่วนใหญ่ของช่อง ฉากหลังเหลือแค่พอบอกใบ้สถานที่
   — ช่อง "ฉากเหตุการณ์ล้วน" (มุมสูงน้ำท่วม/สถานที่) อนุญาตกว้างได้ไม่เกิน 1-2 ช่องต่อปก
   — ครอปแล้วคนยังตัวเล็ก/ห้องทั้งห้องยังอยู่ = ครอปผิด ต้องแน่นกว่านั้น
0a. ★★★★ กฎครอป "ทุกช่อง" (ผู้ใช้สั่ง 27 มิ.ย. — กฎเหล็กเหนือทุกช่อง ไม่ใช่แค่ hero · ใช้กับช่องรอง/วงกลม/highlight ทุกช่อง):
   — แต่ละช่องต้องครอปให้ "จุดที่จะสื่อ" เด่นเต็มกรอบ · ถามทุกช่อง: "ช่องนี้สื่อ 'ใคร' หรือ 'อะไร'?" แล้วซูมให้สิ่งนั้นเด่น
   — ช่องที่เป็น "คน" → ครอปแค่ "ใบหน้า-ไหล่" (ช่วงหน้าอก/คอขึ้นไป) ให้เห็นหน้า+อารมณ์ชัด รู้ว่าเป็นใคร
     ⛔⛔ ห้ามเห็น "เต็มตัว / ครึ่งตัว / กลางตัว / คนยืนทั้งตัว / นั่งเห็นทั้งตัว" จนหน้าเล็กดูไม่ออกว่าใคร — ทุกช่อง
     ★ ถ้าต้นฉบับเป็นเต็มตัว → ครอปเฉพาะหัว-ไหล่ ทิ้งส่วนตัว/ขา/ฉากทิ้งให้หมด (เหมือน hero แต่ใช้กับทุกช่องคน)
     ★ ภาพคู่/กลุ่ม (ช่องรอง) → ครอปให้ "หน้าทุกคนใกล้+ชัด ช่วงอกขึ้นไป" ไม่เอาเต็มตัวยืนเรียงกัน
   — ช่องที่เป็น "สิ่งของ/หลักฐาน" (โฉนด/รถ/บ้าน/แหวน/ของบริจาค/รางวัล/เอกสาร) → ซูมแน่นที่สิ่งของชิ้นนั้นให้เด่นเต็มกรอบ เห็นว่าสำคัญ ⛔ ไม่เอาภาพกว้างที่ของชิ้นเล็กจมอยู่ในฉาก
0a-2. ★★★★ "สมดุล + หน้าไม่ตัดครึ่ง" (ผู้ใช้สั่ง 27 มิ.ย. — บทเรียน CASE-212/213):
   — ★ คนต้องอยู่ "กลางกรอบ" หน้าตั้งตรง สมดุล ไม่เบี้ยว/ไม่เอียงไปชิดขอบ — เป้าหมาย: "แว็บแรกรู้ทันทีว่าใคร" ในทุกช่อง ทุกเลย์เอาต์
   — ★ ครอป "อกขึ้นไปบน" พอ (เน้นใบหน้าให้ใหญ่ชัดเหมือนดูข่าวบนมือถือ) ⛔ ไม่เอาช่วงเอว/ลำตัวลงไป — ภาพมุมไกล/เห็นช่วงตัว ต้องครอปเข้าที่ "หน้า" เสมอ ไม่ปล่อยให้หน้าเล็กจมในเฟรม
   — ⛔★★ ห้าม "ใบหน้าคนถูกตัดครึ่ง" ค้างที่ขอบกรอบเด็ดขาด: ถ้าช่องมีหลายคนแล้วกรอบจะตัดโดนหน้าใครครึ่งนึง → เลือกอย่างใดอย่างหนึ่ง
     (ก) บีบกรอบให้เห็น "ครบทั้ง 2 คน เต็มหน้าทั้งคู่" หรือ (ข) ครอปใหม่ให้เหลือ "คนเดียวเต็มหน้า" ที่เด่นกว่า — ห้ามเหลือครึ่งหน้าคนค้างไว้
0b. ⛔★★★ หลีกเลี่ยงภาพเหล่านี้ให้มากที่สุด — ให้คะแนนความน่าใช้ต่ำสุด เลือกเป็นอันดับท้ายเสมอ (บทเรียน CASE-081):
   - ภาพถอดเสื้อ/โชว์ร่างกาย/ชุดชั้นใน/เซลฟี่กระจกในห้อง/ภาพออกกำลังกาย
   - ภาพคุณภาพต่ำ-เบลอ-แสงแย่-หน้าสดไม่เรียบร้อย-เหงื่อ-หน้าแดง
   - ภาพตัวหนังสือ/การ์ด/เอกสาร/ใบเชิญ/กราฟิก (ไม่ใช่หน้าคนจริง)
   ★ ถ้ามีภาพดีพอเลือกอื่นแทนได้ ต้องไม่ใช้ภาพข้างบนเลย · ★ ทุกช่องของโครงต้องมีภาพครบเสมอ ห้ามเว้นว่าง — ถ้าจำเป็นต้องใช้ภาพไม่ดีจริงๆ ให้ครอปโชว์เฉพาะ "ใบหน้า" ส่วนที่ดูดีที่สุด ตัดส่วนที่ไม่เหมาะออก
1. "main/hero" = ภาพเล่าเรื่องอารมณ์แรงสุด — ★★ ครอปแน่นแบบ "โคลสอัพ/ภาพ ID": ใบหน้าต้องกิน ≥60-65% ของกรอบ หน้าใหญ่เต็มช่อง (เหมือนปกตัวอย่างที่หน้าพระเอกเต็มช่องซ้าย) ⛔ ห้ามเอาภาพ "คนยืนเต็มตัว/ครึ่งตัวที่มีพื้น-เพดาน-หน้าต่าง-โต๊ะ-ฉากหลังเยอะ" — ถ้าภาพต้นฉบับเป็นเต็มตัว ให้ครอปเฉพาะ "หัว-ไหล่" ทิ้งส่วนตัว/ฉากหมด · ห้ามตัดหัว (เผื่อเหนือศีรษะ ~8%)
   ★★★ hero ต้อง "หน้าตรง มองกล้อง สีหน้าชัด" เสมอถ้าในคลังมี — ⛔ ห้ามภาพหันข้าง/เอียง 3/4/ก้มหน้า/เหลือบมองด้านข้าง/หลับตา มาเป็นช่องเอก (บทเรียน CASE-071: hero หันข้างหน้าไม่สู้กล้อง = ปกอ่อนลงทันที). ภาพ 3/4 หันข้างสวยๆ ให้ไปอยู่ "ช่องรอง" ได้ แต่ช่อง hero ขอภาพปะทะกล้องตรงๆ เท่านั้น
   ★★★★ hero = "ภาพเดี่ยว 1 คน เด่นสุด เห็นหน้าชัด รู้ว่าใคร" (กฎเรียบง่าย ผู้ใช้ย้ำ):
     ⛔ ห้าม "ภาพคู่/ภาพหมู่" เป็น hero (ต้องคนเดียว) · ⛔ ห้ามมุมข้าง/หันหลัง/ก้มจนมองไม่เห็นหน้า · ⛔ ห้ามมี "สิ่งของใหญ่/คนอื่น" มาขวางบังใบหน้าจนดูไม่ออกว่าใคร
     ✅ ท่าธรรมชาติใช้ได้ปกติ: มือเสยผม / มือแตะคาง-แก้ม / ผมปรกหน้าบ้าง / เครื่องประดับ — ขอแค่ "ยังเห็นหน้าชัดพอ รู้ว่าเป็นใคร"
     ⛔ กรอบครอป hero: วงกลม/กรอบไฮไลต์ต้องทับแค่ช่วงตัว/ไหล่ล่าง ห้ามทับใบหน้า
1c. ★★★★ "สีหน้า HERO" ต้องตรงอารมณ์ข่าว — นี่คือกฎสำคัญที่สุดของช่องเอก (ผู้ใช้ย้ำ: ภาพใหญ่สุดต้องสื่ออารมณ์ข่าว):
   — อ่าน "หัวข้อ + เรื่อง + อารมณ์ข่าว" ข้างบน แล้วถามว่า "แก่นอารมณ์ของข่าวนี้คืออะไร"
   — ★ ข่าวที่มี "ปม/ขัดแย้ง/เกือบแตกแยก/ห่างเหิน/ละเลย/สูญเสีย/น้ำตา/ครุ่นคิด/สำนึก" (แม้จบอบอุ่น) → **HERO ต้องเป็นสีหน้า "จริงจัง/ครุ่นคิด/สะเทือนใจ/เหม่อ/ตื้นตัน" (สีหน้าตอนเล่าเรื่อง/สัมภาษณ์)** ⛔⛔ ห้ามเอาภาพ "ยิ้มแฉ่งแฮปปี้/กลามเมอร์ถ่ายแบบ" มาเป็น HERO เด็ดขาด — มันขัดอารมณ์ข่าว ทำให้ปกแป้ก
   — ★ รอยยิ้ม/ความอบอุ่น/คืนดี = เอาไว้ "ช่องรอง/คู่/วงกลม" (เล่า before[hero ปม]→after[ช่องรองคลี่คลาย]) — แบบนี้ปกมีพลังเล่าเรื่อง
   — ★ ข่าวอวยความสำเร็จ/ดีใจล้วน → HERO ยิ้มมั่นใจได้เต็มที่
   → ถ้าในคลังมีทั้งภาพยิ้มและภาพครุ่นคิดของตัวหลัก สำหรับข่าวมีปม "ต้องเลือกภาพครุ่นคิดเป็น HERO เสมอ"
2. ★ ทุกช่องต้องมี "จุดโฟกัสเดียว" ชัดเจน — คนหรือสิ่งสำคัญหนึ่งอย่างเด่นกลางกรอบ ไม่ใช่ภาพรวมกว้างๆ ที่ไม่รู้จะมองตรงไหน (ช่องโมเมนต์รับมอบ/จับมือ: โฟกัสที่ "คน+ของที่ส่งมอบ" ไม่ใช่ทั้งห้อง)
3. ห้ามใช้ภาพเดียวกันเกิน 1 ช่อง / ห้ามภาพคนละเหตุการณ์กับข่าว / ห้ามภาพที่มีตัวหนังสือ-โลโก้ฝังใหญ่
   ★ ภาพที่มีตัวหนังสือฝังแบบรู้ตำแหน่ง (มีโซน ⚠️ ระบุ): ใช้กับช่องคนได้ "เฉพาะเมื่อกรอบครอปไม่ทับโซนข้อความ" — คำนวณจากพิกัดที่ให้ เช่น ซับรายการอยู่ y 0.75-1.0 → ครอปหน้า-ไหล่จบที่ y ≤0.70 (วิธีนี้ได้ภาพเหตุการณ์จริงจากรายการโดยไม่ติดซับ)
   ★ ช่อง circle: ห้ามภาพมีตัวหนังสือฝังเด็ดขาดทุกกรณี (วงเล็ก ครอปพลาดนิดเดียวข้อความเต็มวง) / สกรีนช็อตโพสต์-แชท: ห้ามทุกช่องคนเหมือนเดิม
4. สัดส่วนกรอบครอปควรใกล้เคียงสัดส่วนช่อง (ต่างได้ไม่เกิน ~25% — ระบบจะขยายให้พอดีเอง)
5. แต่ละช่องเล่าคนละ "โมเมนต์" ของเรื่อง (เหตุการณ์/สถานที่/ความสัมพันธ์ ไม่ใช่ portrait ซ้ำๆ)
   ★★★ สื่อเรื่องสำคัญกว่าสวย: ก่อนเลือกภาพ ให้ไล่ "beat หลักของข่าวนี้" จากเรื่องย่อก่อน
   (เช่น ข่าวมอบ/บริจาค: ①โมเมนต์ส่งมอบ ②หลักฐานที่มอบ—เอกสาร/โฉนด/สิ่งของ ③ผู้ให้ ④ผู้รับ / ข่าวกู้ภัย: วินาทีช่วย-ผู้รอด-ทีมช่วย)
   ถ้าในคลังมีภาพที่ตรง beat เหล่านี้ ต้องถูกใช้ก่อนเสมอ — ภาพคนสวย/วิวสวยที่ไม่ช่วยเล่าข่าว = ห้ามเอามาเติมช่อง
   ใน "why" ของทุกช่องต้องบอกว่าช่องนั้นเล่า beat ไหนของข่าว ถ้าตอบไม่ได้แปลว่าเลือกภาพผิด
   ★★★★ 5b. ปก "ต้องมีรายละเอียดเล่าเรื่อง" ไม่ใช่หน้าคนซ้ำๆ ทุกช่อง (ผู้ใช้ย้ำ — บทเรียน CASE-121: มีแต่หน้า น็อต/ชมพู่/ลูก ขาดบริบท):
     — hero = หน้าเดี่ยวอารมณ์ตรงข่าว · ★ ช่องรองอย่างน้อย "1-2 ช่อง" ต้องเป็น "ภาพบริบทตรงแก่นข่าว" ถ้ามีในคลัง:
       • ข่าวมรดก/ความรัก/แต่งงาน → ภาพงานแต่ง / โมเมนต์หวาน / แหวน / ครอบครัวพร้อมหน้า
       • ข่าวรวย/ธุรกิจ/ทายาท → ภาพธุรกิจ / โรงงาน / ออฟฟิศ / ทรัพย์สิน
       • ข่าวสำเร็จ/เรียนจบ → ภาพรับปริญญา / ผลงาน / รางวัล
       • ข่าวช่วยเหลือ/บริจาค → ภาพเหตุการณ์ช่วยเหลือ / ของที่มอบ / ผู้รับ
     — ★ "ภาพคู่ / ครอบครัวพร้อมหน้า" ในช่องรอง = ดี (สื่อความสัมพันธ์) ไม่ต้องครอปเป็นหน้าเดี่ยว — แต่ ★★ ครอปให้ "หน้าทุกคนใกล้+ชัด ช่วงอกขึ้นไป" (ตามกฎ 0a) ⛔ ห้ามภาพยืนเต็มตัว/ครึ่งตัวเรียงกันจนหน้าเล็ก
     — ⛔ ห้ามเอา "หน้าเดี่ยว portrait ซ้ำๆ" มาเติมทุกช่องจนปกไม่มีรายละเอียดเล่าเรื่อง
6. กรอบครอปต้องไม่เล็กกว่า 0.15 ของภาพ (กันซูมจนแตก) — แต่ถ้าภาพต้นฉบับใหญ่ ครอปแน่นได้เต็มที่
7. ช่อง "circle" (ถ้ามี): ครอปหน้าคนแน่นเต็มวง 1 คน — ★ ต้องเป็น "คนละบุคคล" หรือ "คนละอารมณ์เด่นชัด" จากช่อง main (วงกลมที่หน้าซ้ำฮีโร่เฉยๆ = เสียช่องไปฟรี)
   ⛔★★★ ห้ามภาพหมู่/ภาพครอบครัวที่มี ≥3 หน้าในวงกลมเด็ดขาด — วงเล็ก หน้าจะจิ๋วมองไม่ออก (บทเรียน CASE-070: เอาภาพครอบครัว 5 คนใส่วง หน้าเล็กหมด). เลือก "หน้าเดี่ยวคมๆ" เท่านั้น; ถ้าไม่มีหน้าเดี่ยวอื่นเหลือ ใช้ "ภาพคู่ 2 คน" ได้ แต่ห้ามเกิน 2 หน้า
8. ช่อง "highlight" (ถ้ามี): วินาทีสำคัญของเหตุการณ์ (การส่งมอบ/การกระทำ/หลักฐาน)
9. ★★ HEADROOM: ขอบบนของกรอบครอปต้องอยู่ "เหนือเส้นผม" เสมอ — ถ้าหัวคนชิดขอบบนของภาพต้นฉบับให้เริ่ม y=0 ได้ แต่ห้ามตั้ง y ที่ทำให้ผม/ศีรษะหลุดกรอบเด็ดขาด
10. ★★ บุคคลเดียวกันห้ามปรากฏเกิน 2 ช่อง — ถ้าเรื่องมีบุคคลอื่น (ผู้ให้/ผู้รับ/คู่กรณี/ครอบครัว) ต้องให้พื้นที่พวกเขา ช่องที่เกินให้ใช้ฉากเหตุการณ์แทน
10b. ★★★ สัดส่วนตัวละครต้องตรงแก่นเรื่อง (สำคัญมาก — แก้ปกที่ตัวรองท่วมตัวเอก):
   — ดู "ตัวหลัก" + "ตัวรอง/คู่เรื่อง" ข้างบน → คนสองคนนี้คือ "พระเอก/นางเอกของปก" ต้องเด่นสุด
   — ★ ข่าว "คู่รัก/สามี-ภรรยา/ความสัมพันธ์สองคน": ทั้งคู่ต้องเด่น — ช่อง hero = หนึ่งในคู่ (หน้าตรงชัด) + ต้องมี "ภาพคู่ทั้งสองคน" หรือหน้าอีกฝ่าย ≥1-2 ช่อง · ลูก/เด็ก/ตัวประกอบ "รวมกันไม่เกิน 1 ช่อง" (ห้ามเอาลูกมา 3-4 ช่องจนกลบคู่รัก!)
   — ★★★ ความหลากหลาย (กันปกซ้ำซาก — บทเรียน CASE-071/075: ภาพคู่ 3 ช่อง คนเดิมโผล่ทุกช่อง): "ภาพคู่สองคนเดิม" ใช้ได้ "ไม่เกิน 1-2 ช่องรวมวงกลม" เท่านั้น — ที่เหลือต้องเป็น "ภาพเดี่ยว" ของแต่ละคน · ถ้าในคลังมีภาพเดี่ยวของตัวรอง (เช่น ตัวรองคนเดียว) ต้องใช้ ≥1 ช่อง · เป้าหมายคือแต่ละช่องเล่าคนละช็อต: hero เดี่ยวหน้าตรง / คู่ 1 ช่อง / เดี่ยวตัวรอง 1 ช่อง / โมเมนต์-วงกลมอีกแบบ
   — ★★★ บังคับมีตัวรอง: ปกข่าวคู่รัก/ครอบครัว ต้องมี "หน้าตัวรอง (สามี/มิค) เดี่ยว" หรือ "ภาพคู่สองคน" อย่างน้อย 1 ช่องที่เห็นหน้าตัวรองชัด — ⛔ ห้ามขึ้นตัวหลัก (เบนซ์) คนเดียวทุกช่อง (บทเรียน CASE-091: เบนซ์ 3 ช่อง มิคแทบไม่มี = ไม่เล่าเรื่องความสัมพันธ์)
   — ★★★ ถ้า "ไม่มีภาพเดี่ยวของตัวรองเลย" (มีแต่ภาพคู่): ให้ "ครอปเฉพาะหน้าตัวรอง" ออกจากภาพคู่ใบหนึ่งมาทำช่องเดี่ยว 1 ช่อง — กำหนด crop ให้กรอบครอบเฉพาะครึ่งฝั่งที่เป็นหน้าตัวรอง (เช่น ตัวรองอยู่ขวา → x≈0.5-1.0) ตัดอีกคนออก · ★ ห้ามใช้ "ภาพคู่ใบเดียวกัน" ทั้งแบบเต็มคู่และแบบครอปเดี่ยว — ต้องเป็นคนละใบ (มีภาพคู่หลายใบให้เลือก) → วิธีนี้ทำให้ตัวรองมีช่องเดี่ยวแม้ในเน็ตไม่มีรูปเดี่ยวของเขา
   — ทั่วไป: ตัวประกอบ (ลูก/เพื่อน/ฉาก) ห้ามได้พื้นที่มากกว่าตัวหลัก-ตัวรองรวมกัน
11. ★★★ สูตรกรอบแน่น (ใช้พิกัดใบหน้าที่ให้มา "คำนวณ" — ห้ามกะด้วยตา):
   - ช่อง main/hero: ความกว้างกรอบ = 1.6-2.2 เท่าของความกว้างใบหน้า (แน่นแบบโคลสอัพ — เลขยิ่งน้อยหน้ายิ่งใหญ่เต็มช่อง), หน้าอยู่กึ่งกลางแนวนอนของกรอบ, ดวงตาอยู่ที่ ~35-40% จากขอบบนกรอบ → หน้าจะใหญ่เด่นเต็มช่องแบบปกไวรัลจริง (ห้ามครอปทั้งภาพแบบหลวมๆ เด็ดขาด!)
   - ช่อง circle: กรอบจัตุรัส ความกว้าง = 1.8-2.2 เท่าของความกว้างใบหน้า, ใบหน้ากึ่งกลางเป๊ะทั้งแนวตั้ง-แนวนอน — เผื่อขอบว่างรอบหน้า ≥25% ของกรอบกันหน้าล้นขอบวง — หน้าต้องเต็มวง ไม่ใช่คนครึ่งตัวจมฉากหลัง
   - ช่องโมเมนต์/รับมอบ/กลุ่มคน: กรอบ = จากเหนือหัวกลุ่มคนถึงระดับเอว ตัดเพดาน-พื้น-โต๊ะ-ผนังออฟฟิศทิ้ง — กลุ่มคนต้องกว้าง ≥60% ของกรอบ (ถ้ามีพิกัดใบหน้า ใช้เป็นจุดยึดคำนวณ)
   - ภาพที่ไม่มีพิกัดใบหน้า: ครอปแน่นที่ "หัว-ไหล่" ของคนสำคัญแบบโคลสอัพ (ไม่ใช่ครึ่งตัว/เต็มตัว) — ตัดฉากหลังทั้งห้อง/เพดาน/พื้น/หน้าต่างทิ้งให้หมด หน้าต้องเต็มกรอบ
   ⛔ กฎรวมความแน่น: ทุกช่องคน "ต้องเต็มเฟรม-เต็มกรอบ ไม่มีขอบว่าง/แถบสีพื้น" หน้าเด่นกลางช่อง ไม่ลายตาด้วยฉากหลัง — เหมือนปกตัวอย่างที่ทุกช่องหน้าคนเต็มกรอบคมชัด
   - ตัวอย่างคำนวณ: หน้ากว้าง 0.20 (x 0.35-0.55) → กรอบ hero กว้าง ~0.5 → x เริ่ม ~0.20 (กึ่งกลางหน้า 0.45 - 0.25)

ตอบ JSON เท่านั้น:
{"templateId":"ชื่อโครงที่เลือก","assignments":[{"slotId":"main","imageIndex":0,"crop":{"x":0.1,"y":0.0,"w":0.6,"h":0.9},"why":"สั้นๆ"}],"reason":"เลือกโครงนี้เพราะ... + ภาพรวมการเล่าเรื่อง"}`;

  try {
    const res = await callAI({
      prompt,
      imageContents,
      model: DIRECTOR_MODEL,
      temperature: 0, // rev.14q: นิ่งสุด — ลดความแกว่งของ Director (เลือกช่อง/ครอปคงที่ขึ้น)
      maxTokens: 6000, // reasoning model ต้องมี headroom (บทเรียนจาก curator)
      systemPrompt: 'You are a precise art director. Respond with valid JSON only.',
    });

    const parsed = typeof res === 'object' && res !== null ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
    const assignments = parsed?.assignments || [];

    // ★ โครงที่ Director เลือก (ต้องอยู่ในตัวเลือก — ไม่งั้นใช้ตัวแรก)
    const chosenSpec = usable.find(t => t.id === parsed?.templateId) || usable[0];
    console.log(`[CoverDirector] 🏗️ เลือกโครง: ${chosenSpec.id}${parsed?.templateId !== chosenSpec.id ? ' (fallback)' : ''}`);

    // Validate: ครบทุกช่อง ไม่ซ้ำภาพ ดัชนีถูก
    const slotIds = new Set(chosenSpec.slots.map(s => s.id));
    const seenSlots = new Set();
    const seenImages = new Set();
    const valid = [];
    for (const a of assignments) {
      if (!slotIds.has(a.slotId) || seenSlots.has(a.slotId)) continue;
      const idx = Number(a.imageIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= imageBuffers.length || seenImages.has(idx)) continue;
      const c = a.crop || {};
      const crop = {
        x: Math.min(Math.max(Number(c.x) || 0, 0), 0.95),
        y: Math.min(Math.max(Number(c.y) || 0, 0), 0.95),
        w: Math.min(Math.max(Number(c.w) || 1, 0.15), 1),
        h: Math.min(Math.max(Number(c.h) || 1, 0.15), 1),
      };
      if (crop.x + crop.w > 1) crop.w = 1 - crop.x;
      if (crop.y + crop.h > 1) crop.h = 1 - crop.y;
      valid.push({ slotId: a.slotId, imageIndex: idx, crop, why: String(a.why || '').slice(0, 80) });
      seenSlots.add(a.slotId);
      seenImages.add(idx);
    }

    // rev.14e guard: วงกลมต้องเป็น "หน้าใหญ่ชัด รู้ว่าใคร" — สลับถ้า: ไม่มีหน้า / หน้าจิ๋ว(เต็มตัว) / ภาพหมู่≥3
    //    (กฎเหล็กผู้ใช้: ทุกช่องต้องรู้ว่าใคร — บทเรียน CASE-083 วงกลมเบนซ์ยืนเต็มตัวหน้าจิ๋ว)
    try {
      const circleA = valid.find(a => /circle/i.test(a.slotId));
      const fbC = circleA ? faceBoxes[circleA.imageIndex] : null;
      const circleArea = (fbC && fbC.x2 > fbC.x1) ? (fbC.x2 - fbC.x1) * (fbC.y2 - fbC.y1) : 0;
      const needsSwap = circleA && (!fbC || !(fbC.x2 > fbC.x1) || (fbC.count || 1) >= 3 || circleArea < 0.02);
      if (needsSwap) {
        const usedIdx = new Set(valid.map(a => a.imageIndex));
        let best = -1, bestArea = 0;
        faceBoxes.forEach((fb, i) => {
          if (usedIdx.has(i) || !fb || !(fb.x2 > fb.x1) || (fb.count || 1) > 2 || fb.hasText) return;
          const area = (fb.x2 - fb.x1) * (fb.y2 - fb.y1);
          if (area > bestArea) { bestArea = area; best = i; }
        });
        if (best >= 0 && bestArea > circleArea) {
          circleA.imageIndex = best;
          circleA.crop = cropFromFaceBox(faceBoxes[best]);
          circleA.why = 'วงกลม: สลับเป็นหน้าใหญ่ชัด (กันหน้าจิ๋ว/ภาพหมู่/ไม่มีหน้า)';
          console.log(`[CoverDirector] 🔧 circle swap → #${best} area ${bestArea.toFixed(3)} (เดิม ${circleArea.toFixed(3)})`);
        }
      }
    } catch { /* guard ไม่สำเร็จ ไม่ critical */ }

    // rev.14h guard: ช่อง hero (main) ต้องเป็น "หน้าเดี่ยวใหญ่ชัด รู้ทันทีว่าใคร" (กฎเหล็กผู้ใช้)
    //    บทเรียน CASE-087: Director เอาภาพคู่ใส่ hero ส่วนหน้าเดี่ยวสวยไปอยู่ช่องเล็ก → สลับให้หน้าเดี่ยวขึ้น hero
    try {
      const mainA = valid.find(a => a.slotId === 'main' || /hero/i.test(a.slotId));
      const fbM = mainA ? faceBoxes[mainA.imageIndex] : null;
      const mainArea = (fbM && fbM.x2 > fbM.x1) ? (fbM.x2 - fbM.x1) * (fbM.y2 - fbM.y1) : 0;
      const mainIsBigSingle = fbM && fbM.x2 > fbM.x1 && (fbM.count || 1) === 1 && mainArea >= 0.04;
      // rev.16 (ด่าน C): hero = หน้าเดี่ยว "ใหญ่ + คม/ละเอียดสุด" — ให้คะแนนคุณภาพร่วม ไม่ใช่แค่หน้าใหญ่
      //   (บทเรียน CASE-140: hero เป็นเซลฟี่แคนดิดเบลอ ทั้งที่มีภาพคมกว่าในพูล)
      const heroScore = (fb) => {
        if (!fb || !(fb.x2 > fb.x1) || (fb.count || 1) !== 1 || fb.hasText) return 0;
        const area = (fb.x2 - fb.x1) * (fb.y2 - fb.y1);
        const q = (fb.quality === undefined ? 0.6 : fb.quality);
        return area * (0.55 + 0.45 * q);
      };
      // rev.16b: สลับเฉพาะเมื่อ hero เดิม "ไม่ใช่หน้าเดี่ยวใหญ่" (ภาพคู่/กลุ่ม/หน้าเล็ก) เท่านั้น
      //   ห้ามแตะ hero เดี่ยวที่ Director ตั้งใจเลือก (Director รู้ว่าใครคือตัวหลัก)
      //   บทเรียน CASE-143: บังคับสลับเป็น "หน้าใหญ่+คมสุด" → ได้หน้าลูกสาวขึ้น hero แทนศรราม = ผิดตัวหลัก
      if (mainA && !mainIsBigSingle) {
        let best = -1, bestScore = 0;
        faceBoxes.forEach((fb, i) => { const s = heroScore(fb); if (s > bestScore) { bestScore = s; best = i; } });
        const mainScore = heroScore(fbM);
        if (best >= 0 && best !== mainA.imageIndex && bestScore > mainScore) {
          const ownerA = valid.find(a => a.imageIndex === best);
          if (ownerA && ownerA !== mainA) {
            const tmpIdx = mainA.imageIndex, tmpCrop = mainA.crop;
            mainA.imageIndex = best; mainA.crop = cropFromFaceBox(faceBoxes[best]);
            ownerA.imageIndex = tmpIdx; ownerA.crop = tmpCrop;
            mainA.why = 'hero: สลับเอาหน้าเดี่ยวใหญ่+คมสุดขึ้น';
            console.log(`[CoverDirector] 🔧 hero SWAP slots: main↔${ownerA.slotId} (#${best} ใหญ่+คมสุดขึ้น hero)`);
          } else if (!ownerA) {
            mainA.imageIndex = best; mainA.crop = cropFromFaceBox(faceBoxes[best]);
            mainA.why = 'hero: หน้าเดี่ยวใหญ่+คมชัด';
            console.log(`[CoverDirector] 🔧 hero ← #${best} (unused single, คมสุด)`);
          }
        }
      }
    } catch { /* guard ไม่สำเร็จ ไม่ critical */ }

    // rev.13 guard: ภาพ "เดี่ยว 1 หน้า" ช่องไหนครอปหลวมเกินไป → กระชับเป็นหัว-ไหล่อัตโนมัติ
    //    บทเรียน CASE-072: ช่องรองเบนซ์ชุดแดงยืนครึ่งตัวหน้าเล็ก (Director คุมแน่นแค่ hero) — ทุกช่องคนต้องเต็มกรอบ
    //    เฉพาะ count===1 (ภาพคู่/หมู่ปล่อยกว้างตามเดิม กันครอปทิ้งคนอื่น)
    try {
      valid.forEach(a => {
        const fb = faceBoxes[a.imageIndex];
        if (!fb || !(fb.x2 > fb.x1) || (fb.count || 1) !== 1) return;
        const fw = fb.x2 - fb.x1;
        if (a.crop.w > fw * 3.2) { // กรอบกว้างเกิน 3.2 เท่าหน้า = หลวม (สูตรแน่น 1.6-2.2)
          a.crop = cropFromFaceBox(fb);
          a.why = (a.why || '').slice(0, 60) + ' [กระชับหน้า]';
        }
      });
    } catch { /* ไม่ critical */ }

    // rev.20 (ผู้ใช้ 20 มิ.ย.): ช่อง "โมเมนต์ขวา" ต้องโฟกัสหน้าคน สะอาด — บังคับครอปหน้า-ไหล่ (ตัด bg/ไมค์/โซฟา)
    //   ★ rev.20f: ถอดตัว "สลับเป็นภาพเดี่ยว" (rev-20e) ออก — มันไปดึงภาพหลุดบริบท (ชายหาด/บิกินี) ที่ judge จัดอันดับต่ำมาใช้ (CASE-156 พัง)
    //   เชื่อการคัดของ judge เหมือน CASE-155 (ดีแล้ว) แค่กระชับครอปให้แน่น โดยเฉพาะช่องล่างขวา
    tightenMomentCrops(valid, faceBoxes);

    if (valid.length < chosenSpec.slots.length) {
      console.log(`[CoverDirector] ⚠️ assignments ใช้ได้ ${valid.length}/${chosenSpec.slots.length} ช่อง`);
      return null;
    }

    valid.forEach(a => console.log(`[CoverDirector] 🎬 ${a.slotId} ← #${a.imageIndex} crop(${a.crop.x.toFixed(2)},${a.crop.y.toFixed(2)},${a.crop.w.toFixed(2)},${a.crop.h.toFixed(2)}) — ${a.why}`));
    return { templateSpec: chosenSpec, assignments: valid, reason: String(parsed.reason || '').slice(0, 200) };
  } catch (e) {
    console.log('[CoverDirector] ❌ direct failed:', e.message?.slice(0, 80));
    // ★ เครดิต/โควต้า OpenAI หมด → โยนต่อ (อย่ากลืนเป็น null = DIRECTOR_FAILED งงๆ) ให้ route แจ้งชัด
    if (/insufficient_quota|exceeded your current quota|billing/i.test(e.message || '')) throw e;
    return null;
  }
}

/** ครอปตั้งต้นจากกรอบหน้า (สูตรเดียวกับ rule 11): กว้าง ~2.5×หน้า + HEADROOM เหนือไรผม */
function cropFromFaceBox(fb, mult = 2.1) {
  if (!fb || !(fb.x2 > fb.x1)) return { x: 0, y: 0, w: 1, h: 1 };
  const fw = fb.x2 - fb.x1, fh = fb.y2 - fb.y1, cx = (fb.x1 + fb.x2) / 2;
  const w = Math.min(1, Math.max(0.28, fw * mult)); // rev.13: แน่นขึ้น 2.5→2.1 (ตามตัวอย่างหน้าเต็มกรอบ)
  const h = Math.min(1, Math.max(0.28, fh * mult));
  const x = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  const y = Math.min(Math.max(fb.y1 - fh * 0.5, 0), 1 - h);
  return { x: +x.toFixed(2), y: +y.toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2) };
}

/**
 * rev.20: บังคับช่อง "โมเมนต์ขวา" (right_ , top_right, bottom_right, top, mid, bottom) ให้โฟกัสหน้า-ไหล่ สะอาด
 *   ตัดพื้นหลัง/ไมค์/โซฟา — ใช้ทั้งหลัง Director จัด และหลัง QC แก้ (กัน QC คลายครอปกลับ)
 *   เงื่อนไข: ช่องมีหน้าใหญ่พอ (≥1.2% ของภาพ) + (ครอปกว้างเกิน 2.6 เท่าหน้า หรือ ภาพหลายคน)
 *   ★ ไม่แตะ main (ฮีโร่) / circle (มี guard เฉพาะ) / ช่องที่หน้าจิ๋ว (ปล่อยเล่าฉากตามตั้งใจ)
 */
export function tightenMomentCrops(assignments, faceBoxes = []) {
  const MOMENT_SLOT = /^right_|^top_right$|^bottom_right$|^top$|^mid$|^bottom$/;
  for (const a of assignments || []) {
    if (!a || /circle/i.test(a.slotId)) continue;
    const fb = faceBoxes[a.imageIndex];
    if (!fb || !(fb.x2 > fb.x1)) continue;
    const fArea = (fb.x2 - fb.x1) * (fb.y2 - fb.y1);
    // ★ rev.21d (ผู้ใช้ CASE-170: "ฮีโร่ต้องเต็มเฟรม หน้าใหญ่ ให้จำหน้าได้ ไม่เหลือพื้นว่าง"):
    //   ครอปฮีโร่ให้ "ใบหน้าเต็มกรอบ" (mult 1.9 = หน้าเด่นสุด + headroom พอดี) — เดิมข้าม main เลยหลวม/มีพื้นเทา
    if (a.slotId === 'main') {
      if (fArea < 0.006) continue; // หน้าจิ๋วมากในภาพต้นทาง — ปล่อย (กันครอปแล้วเบลอ)
      a.crop = cropFromFaceBox(fb, 1.8); // rev.21e: แน่นขึ้น 1.9→1.8 = หน้าเต็มเฟรมจริง ไม่เหลือพื้นว่าง/ชุดครุยล้น
      a.why = (a.why || '').slice(0, 52) + ' [ฮีโร่หน้าเต็มเฟรม]';
      continue;
    }
    if (!MOMENT_SLOT.test(a.slotId)) continue;
    if (fArea < 0.012) continue; // หน้าจิ๋ว/ภาพบริบทล้วน — ปล่อยตามตั้งใจ
    // rev.21e: ครอปแน่นขึ้นอีก (non-bottom 2.1→1.9, bottom 1.9→1.8) = ซูมหน้าเดียว ตัดคนที่เบียด/ตกเฟรมออก
    const isBottom = /bottom/.test(a.slotId);
    a.crop = cropFromFaceBox(fb, isBottom ? 1.8 : 1.9);
    a.why = (a.why || '').slice(0, 52) + (isBottom ? ' [ซูมคนแน่น]' : ' [หน้าเต็มเฟรม]');
  }
  return assignments;
}

/**
 * rev.20k: เฟรมคลิปรายการมีคำบรรยายเบิร์น (lower-third) — ครอปแน่นที่ "ใบหน้า" ทุกช่อง (รวมฮีโร่)
 *   เพื่อตัดแถบคำบรรยายออก + ดันกรอบขึ้นพ้นโซนข้อความถ้ารู้ตำแหน่ง (textRegion)
 *   ใช้กับข่าว "คนธรรมดาจากรายการทีวี" ที่ภาพมาจากเฟรมคลิปล้วน
 */
export function faceTightenAll(assignments, faceBoxes = [], mult = 2.2) {
  for (const a of assignments || []) {
    if (!a || /circle/i.test(a.slotId)) continue; // วงกลมมี guard เฉพาะ
    const fb = faceBoxes[a.imageIndex];
    if (!fb || !(fb.x2 > fb.x1)) continue;
    if (((fb.x2 - fb.x1) * (fb.y2 - fb.y1)) < 0.012) continue; // หน้าจิ๋ว/ฉากล้วน — ข้าม
    const c = cropFromFaceBox(fb, mult); // หน้า-ไหล่ ตัดแถบคำบรรยายบน/ล่างออก
    // ถ้ารู้โซนข้อความและอยู่ "ครึ่งล่าง" → กันกรอบไม่ให้ลงไปแตะ (ดันขึ้น)
    const tr = fb.textRegion;
    if (tr && typeof tr.y1 === 'number' && tr.y1 > 0.5 && (c.y + c.h) > tr.y1) {
      c.y = Math.max(0, Math.min(c.y, tr.y1 - c.h));
    }
    a.crop = c;
    a.why = (a.why || '').slice(0, 50) + ' [คลิป:ครอปหน้าตัดคำบรรยาย]';
  }
  return assignments;
}

/**
 * AI ตรวจปกที่ประกอบแล้ว 1 รอบ — สั่งแก้กรอบครอป และ rev.8: สั่งสลับรูปได้ (imageIndex)
 * @returns {Promise<{ok: boolean, fixes: Array<{slotId, crop?, imageIndex?}>}>}
 */
export async function reviewCover({ coverBuffer, templateSpec, assignments, imageBuffers = [], faceBoxes = [], identity = null, newsTitle = '' }) {
  try {
    const small = await sharp(coverBuffer).resize(700, null, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
    const layout = assignments.map(a => `- ${a.slotId}: ภาพ #${a.imageIndex}`).join('\n');
    // ★ rev.11: QC ต้องรู้เนื้อข่าว — เดิมตรวจแบบตาบอดเรื่อง เลยปล่อยภาพสวยแต่ไม่เกี่ยวผ่าน (บทเรียน CASE-048)
    const storyText = (newsTitle || identity?.mainCharacter)
      ? `ข่าว: "${(newsTitle || '').slice(0, 100)}" | ตัวหลัก: ${identity?.mainCharacter || '-'} | เรื่อง: ${String(identity?.coreStory?.celebratedAction || identity?.mainVisualShouldBe || '').slice(0, 150)}\n`
      : '';

    // ★ rev.8: แนบภาพสำรองที่ยังไม่ถูกใช้ — QC สั่ง "สลับรูป" ได้ ไม่ใช่แค่แก้ครอป
    // (บทเรียน CASE-042: คนเดิมโผล่ 3 ช่อง QC เห็นปัญหาแต่แก้ไม่ได้เพราะมีอำนาจแค่ครอป)
    const usedIdx = new Set(assignments.map(a => a.imageIndex));
    const spares = [];
    for (let i = 0; i < imageBuffers.length && spares.length < 6; i++) {
      if (usedIdx.has(i) || !imageBuffers[i]?.buffer) continue;
      // ★ ภาพมีตัวหนังสือ: เสนอเป็นตัวสลับได้เฉพาะเมื่อรู้โซนข้อความ+มีพิกัดหน้า (ครอปหลบได้) — ที่เหลือห้าม (บทเรียน CASE-047)
      if (faceBoxes[i]?.hasText && !(faceBoxes[i]?.textRegion && faceBoxes[i]?.x1 !== undefined)) continue;
      try {
        const thumb = await sharp(imageBuffers[i].buffer).resize(260, 260, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
        spares.push({ index: i, base64: thumb.toString('base64') });
      } catch { /* ข้ามภาพเสีย */ }
    }
    const sparesText = spares.length
      ? `\nภาพสำรองที่ยังไม่ถูกใช้ (แนบต่อจากภาพปกตามลำดับนี้): ${spares.map(s => {
          const fb2 = faceBoxes[s.index];
          const face = (fb2 && fb2.x1 !== undefined) ? ` (หน้า: x ${fb2.x1}-${fb2.x2}, y ${fb2.y1}-${fb2.y2})` : '';
          const txt = fb2?.textRegion ? ` [⚠️ข้อความโซน y ${fb2.textRegion.y1.toFixed(2)}-${fb2.textRegion.y2.toFixed(2)} — ครอปหลบ]` : '';
          return `#${s.index}${face}${txt}`;
        }).join(', ')}\n`
      : '';

    const prompt = `คุณคือ QC ปกข่าว ตรวจปกที่เพิ่งประกอบเสร็จ (canvas ${templateSpec.canvasW}x${templateSpec.canvasH})
${storyText}ผังช่อง:
${templateText(templateSpec)}
การจัดวางปัจจุบัน:
${layout}
${sparesText}
ตรวจเฉพาะปัญหาร้ายแรง (ไล่ตามลำดับ):
1. ★ สแกนขอบบนสุดของปกทั้งใบก่อน: มีศีรษะ/ผม/มวยผมของใครโดนตัดไหม? (จุดพลาดบ่อยสุด — ดูพิกเซลแถวบนสุดจริงๆ)
2. หัว/หน้าคนโดนตัดที่ขอบช่องอื่นๆ
3. ★ ใบหน้า/จุดโฟกัสโดน "ช่องที่ลอยทับ" บัง (กรอบไฮไลต์/วงกลมทับหน้าคนของช่องล่าง) — ต้องแก้ครอปให้หน้าย้ายไปโซนเปิดโล่ง
4. ครอปจนเหลือแต่พื้นหลัง คนหาย/เล็กจนมองไม่ออก
5. ★ คนจมฉากหลัง: ช่องที่มีคน (โมเมนต์รับมอบ/วงกลม/portrait) แต่คนกินพื้นที่ไม่ถึงครึ่งช่อง เห็นห้อง/เพดาน/ผนังเยอะกว่าคน → สั่งครอปแน่นขึ้น (จากเหนือหัวถึงเอว ตัดฉากหลังทิ้ง) — ปกไวรัลจริงเน้นหน้าคน ฉากหลังแค่จำเป็น (ยกเว้นช่องฉากเหตุการณ์ล้วน เช่น มุมสูงน้ำท่วม)
6. ภาพเบลอ/แตกจากการซูมเกิน
6.5 ★ ตัวหนังสือฝัง/ซับรายการโผล่ในช่องคน → สั่งครอปแน่นขึ้นที่หน้า-ไหล่ให้พ้นโซนข้อความ (อย่าทิ้งภาพถ้าครอปหลบได้)
7. ★ บุคคลเดียวกันโผล่เกิน 2 ช่อง (นับวงกลมด้วย) — ปกไวรัลจริงห้ามหน้าซ้ำเกิน 2 ช่อง
   → ช่องที่ซ้ำ (เก็บช่องฮีโร่ไว้) ให้สลับเป็นภาพสำรอง: ใส่ "imageIndex" ของภาพสำรอง + crop ใหม่
   (คำนวณ crop จากกรอบหน้าที่ให้: กว้าง ≈ 2.5 เท่าของหน้า หน้าอยู่กึ่งกลาง เผื่อที่ว่างเหนือไรผม)
8. ★★ ช่องที่ "ไม่เล่าข่าวนี้": ภาพคนละเหตุการณ์/คนละบุคคลกับข่าว หรือภาพสวยเฉยๆ ที่ไม่สื่อเรื่อง
   (เทียบกับเนื้อข่าวด้านบน — เช่น ข่าวมอบที่ดิน ต้องเห็น โมเมนต์ส่งมอบ/เอกสาร/ผู้ให้/ผู้รับ)
   → สลับเป็นภาพสำรองที่เล่าเรื่องตรงกว่า ถ้าภาพสำรองก็ไม่ตรง ให้คงเดิมไว้ (อย่าสลับมั่ว)

ถ้าพบ → สั่งแก้ด้วยกรอบครอปใหม่ (สัดส่วน 0-1 ของภาพต้นฉบับเดิม) และ/หรือสลับรูปด้วย imageIndex
★ ช่อง circle: คำสั่งแก้ต้องคงหลัก "หน้าเต็มวง" (กรอบจัตุรัส ~2 เท่าของหน้า) — ห้ามแก้ด้วยการซูมออกเป็นภาพเต็ม (0,0,1,1) เด็ดขาด ถ้าครอปหน้าให้สวยไม่ได้ (เช่น ภาพเป็นสกรีนช็อตข้อความ) ให้สลับเป็นภาพสำรองที่เป็นหน้าคนจริงแทน
ถ้าปกใช้ได้ → ok=true, fixes=[]

ตอบ JSON เท่านั้น: {"ok":true/false,"fixes":[{"slotId":"main","crop":{"x":0,"y":0,"w":0.8,"h":0.85},"why":"สั้นๆ"},{"slotId":"circle","imageIndex":7,"crop":{"x":0.2,"y":0.1,"w":0.5,"h":0.5},"why":"หน้าซ้ำช่องที่ 3 สลับเป็นภาพสำรอง"}]}`;

    const res = await callAI({
      prompt,
      imageContents: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}`, detail: 'auto' } },
        ...spares.map(s => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${s.base64}`, detail: 'low' } })),
      ],
      model: DIRECTOR_MODEL,
      temperature: 0,
      maxTokens: 4000,
      systemPrompt: 'You are a strict QC reviewer. Respond with valid JSON only.',
    });

    const parsed = typeof res === 'object' && res !== null ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
    const spareIdx = new Set(spares.map(s => s.index));
    const fixes = (parsed?.fixes || [])
      .filter(f => f.slotId && (f.crop || Number.isInteger(Number(f.imageIndex))))
      .map(f => {
        const out = { slotId: f.slotId, why: String(f.why || '').slice(0, 80) };
        const idx = Number(f.imageIndex);
        // สลับได้เฉพาะภาพสำรองที่ยังไม่ถูกใช้ — กันสั่งสลับเป็นภาพที่ทำให้ซ้ำหนักกว่าเดิม
        if (Number.isInteger(idx) && spareIdx.has(idx)) out.imageIndex = idx;
        let crop = f.crop;
        if (!crop && out.imageIndex !== undefined) crop = cropFromFaceBox(faceBoxes[out.imageIndex]);
        if (crop) {
          out.crop = {
            x: Math.min(Math.max(Number(crop.x) || 0, 0), 0.95),
            y: Math.min(Math.max(Number(crop.y) || 0, 0), 0.95),
            w: Math.min(Math.max(Number(crop.w) || 1, 0.15), 1),
            h: Math.min(Math.max(Number(crop.h) || 1, 0.15), 1),
          };
        }
        // ★ guard (บทเรียน CASE-046): ช่อง circle ห้าม "ซูมออกเต็มภาพ" — เคยได้กำแพงข้อความเต็มวง
        const slotShape = (templateSpec.slots || []).find(s => s.id === f.slotId)?.shape;
        if (slotShape === 'circle' && out.imageIndex === undefined && out.crop && out.crop.w >= 0.9 && out.crop.h >= 0.9) {
          const curIdx = assignments.find(a => a.slotId === f.slotId)?.imageIndex;
          const fb = faceBoxes[curIdx];
          if (fb && fb.x1 !== undefined && fb.x2 > fb.x1) {
            out.crop = cropFromFaceBox(fb); // บังคับกลับสูตรหน้าเต็มวง
            out.why = `${out.why} [guard: ใช้สูตรหน้าเต็มวงแทนซูมออก]`.trim();
          } else {
            return null; // ไม่มีพิกัดหน้า — ทิ้ง fix ดีกว่าได้วงข้อความเต็มวง
          }
        }
        return out;
      })
      .filter(f => f && (f.crop || f.imageIndex !== undefined));
    fixes.forEach(f => console.log(`[CoverDirector] 🔧 QC fix ${f.slotId}: ${f.imageIndex !== undefined ? `สลับ→#${f.imageIndex} ` : ''}${f.crop ? `crop(${f.crop.x.toFixed(2)},${f.crop.y.toFixed(2)},${f.crop.w.toFixed(2)},${f.crop.h.toFixed(2)})` : ''} — ${f.why}`));
    return { ok: parsed?.ok !== false && fixes.length === 0, fixes };
  } catch (e) {
    console.log('[CoverDirector] ⚠️ review failed (non-fatal):', e.message?.slice(0, 60));
    return { ok: true, fixes: [] }; // ตรวจไม่ได้ = ปล่อยผ่าน (ปกประกอบเสร็จแล้ว)
  }
}
