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
    const textWarn = fb?.hasText ? ' ⛔ มีตัวหนังสือฝัง/สกรีนช็อต — ห้ามใช้กับช่องคนทุกช่อง (main/circle/โมเมนต์) เด็ดขาด' : '';
    return `#${t.index}: ${t.width}x${t.height}px${faceTxt}${textWarn}`;
  }).join('\n');

  const templatesBlock = usable.map(t =>
    `▼ "${t.id}"${t.storyFit ? ` — เหมาะกับ: ${t.storyFit}` : ''} (ใช้ ${t.slots.length} ภาพ, canvas ${t.canvasW}x${t.canvasH})\n${templateText(t)}`
  ).join('\n\n');

  const prompt = `คุณคือ Art Director มืออาชีพของเพจข่าวไวรัล กำลังจัดปกข่าวจากภาพจริง ${thumbs.length} ใบ (เรียงตามลำดับ #0 ถึง #${thumbs.length - 1})

=== ข่าว ===
หัวข้อ: ${newsTitle || '-'}
ตัวหลัก: ${identity?.mainCharacter || '-'}
เรื่อง: ${(identity?.coreStory?.celebratedAction || identity?.mainVisualShouldBe || '').slice(0, 200)}

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
1. "main" = ภาพเล่าเรื่องที่อารมณ์แรงสุด — ★ ครอปแน่น: หน้า/ตัวบุคคลต้องกิน ≥50% ของกรอบ (อย่าครอปกว้างจนคนจมฉาก!) ห้ามตัดหัว (เผื่อที่เหนือศีรษะ ~10%)
2. ★ ทุกช่องต้องมี "จุดโฟกัสเดียว" ชัดเจน — คนหรือสิ่งสำคัญหนึ่งอย่างเด่นกลางกรอบ ไม่ใช่ภาพรวมกว้างๆ ที่ไม่รู้จะมองตรงไหน (ช่องโมเมนต์รับมอบ/จับมือ: โฟกัสที่ "คน+ของที่ส่งมอบ" ไม่ใช่ทั้งห้อง)
3. ห้ามใช้ภาพเดียวกันเกิน 1 ช่อง / ห้ามภาพคนละเหตุการณ์กับข่าว / ห้ามภาพที่มีตัวหนังสือ-โลโก้ฝังใหญ่
   ★ ช่อง main และ circle: ห้ามใช้ภาพสกรีนช็อตโพสต์/แชท/ภาพที่มีแคปชันฝัง "เด็ดขาด" — แม้จะครอปหนีข้อความได้ก็ห้าม (ถ้าครอปพลาดนิดเดียว ข้อความจะโผล่เต็มช่อง) ใช้ภาพถ่ายคนจริงเท่านั้น
4. สัดส่วนกรอบครอปควรใกล้เคียงสัดส่วนช่อง (ต่างได้ไม่เกิน ~25% — ระบบจะขยายให้พอดีเอง)
5. แต่ละช่องเล่าคนละ "โมเมนต์" ของเรื่อง (เหตุการณ์/สถานที่/ความสัมพันธ์ ไม่ใช่ portrait ซ้ำๆ)
   ★★★ สื่อเรื่องสำคัญกว่าสวย: ก่อนเลือกภาพ ให้ไล่ "beat หลักของข่าวนี้" จากเรื่องย่อก่อน
   (เช่น ข่าวมอบ/บริจาค: ①โมเมนต์ส่งมอบ ②หลักฐานที่มอบ—เอกสาร/โฉนด/สิ่งของ ③ผู้ให้ ④ผู้รับ / ข่าวกู้ภัย: วินาทีช่วย-ผู้รอด-ทีมช่วย)
   ถ้าในคลังมีภาพที่ตรง beat เหล่านี้ ต้องถูกใช้ก่อนเสมอ — ภาพคนสวย/วิวสวยที่ไม่ช่วยเล่าข่าว = ห้ามเอามาเติมช่อง
   ใน "why" ของทุกช่องต้องบอกว่าช่องนั้นเล่า beat ไหนของข่าว ถ้าตอบไม่ได้แปลว่าเลือกภาพผิด
6. กรอบครอปต้องไม่เล็กกว่า 0.15 ของภาพ (กันซูมจนแตก) — แต่ถ้าภาพต้นฉบับใหญ่ ครอปแน่นได้เต็มที่
7. ช่อง "circle" (ถ้ามี): ครอปหน้าคนแน่นเต็มวง 1 คน — ★ ต้องเป็น "คนละบุคคล" หรือ "คนละอารมณ์เด่นชัด" จากช่อง main (วงกลมที่หน้าซ้ำฮีโร่เฉยๆ = เสียช่องไปฟรี)
8. ช่อง "highlight" (ถ้ามี): วินาทีสำคัญของเหตุการณ์ (การส่งมอบ/การกระทำ/หลักฐาน)
9. ★★ HEADROOM: ขอบบนของกรอบครอปต้องอยู่ "เหนือเส้นผม" เสมอ — ถ้าหัวคนชิดขอบบนของภาพต้นฉบับให้เริ่ม y=0 ได้ แต่ห้ามตั้ง y ที่ทำให้ผม/ศีรษะหลุดกรอบเด็ดขาด
10. ★★ บุคคลเดียวกันห้ามปรากฏเกิน 2 ช่อง — ถ้าเรื่องมีบุคคลอื่น (ผู้ให้/ผู้รับ/คู่กรณี/ครอบครัว) ต้องให้พื้นที่พวกเขา ช่องที่เกินให้ใช้ฉากเหตุการณ์แทน
11. ★★★ สูตรกรอบแน่น (ใช้พิกัดใบหน้าที่ให้มา "คำนวณ" — ห้ามกะด้วยตา):
   - ช่อง main/hero: ความกว้างกรอบ = 2.2-2.8 เท่าของความกว้างใบหน้า, หน้าอยู่กึ่งกลางแนวนอนของกรอบ, ดวงตาอยู่ที่ ~35-40% จากขอบบนกรอบ → หน้าจะใหญ่เด่นเต็มช่องแบบปกไวรัลจริง (ห้ามครอปทั้งภาพแบบหลวมๆ เด็ดขาด!)
   - ช่อง circle: กรอบจัตุรัส ความกว้าง = 1.8-2.2 เท่าของความกว้างใบหน้า, ใบหน้ากึ่งกลางเป๊ะทั้งแนวตั้ง-แนวนอน — เผื่อขอบว่างรอบหน้า ≥25% ของกรอบกันหน้าล้นขอบวง — หน้าต้องเต็มวง ไม่ใช่คนครึ่งตัวจมฉากหลัง
   - ช่องโมเมนต์/รับมอบ/กลุ่มคน: กรอบ = จากเหนือหัวกลุ่มคนถึงระดับเอว ตัดเพดาน-พื้น-โต๊ะ-ผนังออฟฟิศทิ้ง — กลุ่มคนต้องกว้าง ≥60% ของกรอบ (ถ้ามีพิกัดใบหน้า ใช้เป็นจุดยึดคำนวณ)
   - ภาพที่ไม่มีพิกัดใบหน้า: ครอปแน่นที่ "หัว-ไหล่ถึงครึ่งตัว" ของคนสำคัญ ห้ามเก็บฉากหลังทั้งห้อง
   - ตัวอย่างคำนวณ: หน้ากว้าง 0.20 (x 0.35-0.55) → กรอบ hero กว้าง ~0.5 → x เริ่ม ~0.20 (กึ่งกลางหน้า 0.45 - 0.25)

ตอบ JSON เท่านั้น:
{"templateId":"ชื่อโครงที่เลือก","assignments":[{"slotId":"main","imageIndex":0,"crop":{"x":0.1,"y":0.0,"w":0.6,"h":0.9},"why":"สั้นๆ"}],"reason":"เลือกโครงนี้เพราะ... + ภาพรวมการเล่าเรื่อง"}`;

  try {
    const res = await callAI({
      prompt,
      imageContents,
      model: DIRECTOR_MODEL,
      temperature: 0.1,
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

    if (valid.length < chosenSpec.slots.length) {
      console.log(`[CoverDirector] ⚠️ assignments ใช้ได้ ${valid.length}/${chosenSpec.slots.length} ช่อง`);
      return null;
    }

    valid.forEach(a => console.log(`[CoverDirector] 🎬 ${a.slotId} ← #${a.imageIndex} crop(${a.crop.x.toFixed(2)},${a.crop.y.toFixed(2)},${a.crop.w.toFixed(2)},${a.crop.h.toFixed(2)}) — ${a.why}`));
    return { templateSpec: chosenSpec, assignments: valid, reason: String(parsed.reason || '').slice(0, 200) };
  } catch (e) {
    console.log('[CoverDirector] ❌ direct failed:', e.message?.slice(0, 80));
    return null;
  }
}

/** ครอปตั้งต้นจากกรอบหน้า (สูตรเดียวกับ rule 11): กว้าง ~2.5×หน้า + HEADROOM เหนือไรผม */
function cropFromFaceBox(fb) {
  if (!fb || !(fb.x2 > fb.x1)) return { x: 0, y: 0, w: 1, h: 1 };
  const fw = fb.x2 - fb.x1, fh = fb.y2 - fb.y1, cx = (fb.x1 + fb.x2) / 2;
  const w = Math.min(1, Math.max(0.3, fw * 2.5));
  const h = Math.min(1, Math.max(0.3, fh * 2.5));
  const x = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  const y = Math.min(Math.max(fb.y1 - fh * 0.5, 0), 1 - h);
  return { x: +x.toFixed(2), y: +y.toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2) };
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
      if (faceBoxes[i]?.hasText) continue; // ★ ห้ามเสนอภาพสกรีนช็อต/ตัวหนังสือฝังเป็นตัวสลับ (บทเรียน CASE-047)
      try {
        const thumb = await sharp(imageBuffers[i].buffer).resize(260, 260, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
        spares.push({ index: i, base64: thumb.toString('base64') });
      } catch { /* ข้ามภาพเสีย */ }
    }
    const sparesText = spares.length
      ? `\nภาพสำรองที่ยังไม่ถูกใช้ (แนบต่อจากภาพปกตามลำดับนี้): ${spares.map(s => `#${s.index}${faceBoxes[s.index] ? ` (หน้า: x ${faceBoxes[s.index].x1}-${faceBoxes[s.index].x2}, y ${faceBoxes[s.index].y1}-${faceBoxes[s.index].y2})` : ''}`).join(', ')}\n`
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
