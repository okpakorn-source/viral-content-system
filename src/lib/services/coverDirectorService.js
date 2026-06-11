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
 * @returns {Promise<{assignments: Array<{slotId, imageIndex, crop:{x,y,w,h}}>, reason: string}|null>}
 */
export async function directCover({ imageBuffers, identity, templateSpec, newsTitle }) {
  const thumbs = await buildThumbnails(imageBuffers);
  if (thumbs.length < templateSpec.slots.length) {
    console.log(`[CoverDirector] ⚠️ ภาพใช้ได้ ${thumbs.length} < ช่อง ${templateSpec.slots.length}`);
    return null;
  }

  const imageContents = thumbs.map(t => ({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${t.base64}`, detail: 'auto' },
  }));

  const dimsText = thumbs.map(t => `#${t.index}: ${t.width}x${t.height}px`).join(', ');

  const prompt = `คุณคือ Art Director มืออาชีพของเพจข่าวไวรัล กำลังจัดปกข่าวจากภาพจริง ${thumbs.length} ใบ (เรียงตามลำดับ #0 ถึง #${thumbs.length - 1})

=== ข่าว ===
หัวข้อ: ${newsTitle || '-'}
ตัวหลัก: ${identity?.mainCharacter || '-'}
เรื่อง: ${(identity?.coreStory?.celebratedAction || identity?.mainVisualShouldBe || '').slice(0, 200)}

=== ขนาดจริงของแต่ละภาพ ===
${dimsText}

=== TEMPLATE (canvas ${templateSpec.canvasW}x${templateSpec.canvasH}) ===
${templateText(templateSpec)}

=== งานของคุณ ===
เลือกภาพลงทุกช่อง + กำหนดกรอบครอปของแต่ละภาพเป็นสัดส่วน 0-1 ของภาพต้นฉบับ
(x,y = มุมซ้ายบนของกรอบ, w,h = กว้าง/สูงของกรอบ — เทียบกับขนาดเต็มของภาพนั้น)

กฎเหล็ก:
1. "main" = ภาพเล่าเรื่องที่อารมณ์แรงสุด — ★ ครอปแน่น: หน้า/ตัวบุคคลต้องกิน ≥50% ของกรอบ (อย่าครอปกว้างจนคนจมฉาก!) ห้ามตัดหัว (เผื่อที่เหนือศีรษะ ~10%)
2. ★ ทุกช่องต้องมี "จุดโฟกัสเดียว" ชัดเจน — คนหรือสิ่งสำคัญหนึ่งอย่างเด่นกลางกรอบ ไม่ใช่ภาพรวมกว้างๆ ที่ไม่รู้จะมองตรงไหน
3. ห้ามใช้ภาพเดียวกันเกิน 1 ช่อง / ห้ามภาพคนละเหตุการณ์กับข่าว / ห้ามภาพที่มีตัวหนังสือ-โลโก้ฝังใหญ่
4. สัดส่วนกรอบครอปควรใกล้เคียงสัดส่วนช่อง (ต่างได้ไม่เกิน ~25% — ระบบจะขยายให้พอดีเอง)
5. แต่ละช่องเล่าคนละ "โมเมนต์" ของเรื่อง (เหตุการณ์/สถานที่/ความสัมพันธ์ ไม่ใช่ portrait ซ้ำๆ)
6. กรอบครอปต้องไม่เล็กกว่า 0.15 ของภาพ (กันซูมจนแตก) — แต่ถ้าภาพต้นฉบับใหญ่ ครอปแน่นได้เต็มที่
7. ช่อง "circle" (ถ้ามี): ครอปหน้าคนแน่นเต็มวง 1 คน — ★ ต้องเป็น "คนละบุคคล" หรือ "คนละอารมณ์เด่นชัด" จากช่อง main (วงกลมที่หน้าซ้ำฮีโร่เฉยๆ = เสียช่องไปฟรี)
8. ช่อง "highlight" (ถ้ามี): วินาทีสำคัญของเหตุการณ์ (การส่งมอบ/การกระทำ/หลักฐาน)
9. ★★ HEADROOM: ขอบบนของกรอบครอปต้องอยู่ "เหนือเส้นผม" เสมอ — ถ้าหัวคนชิดขอบบนของภาพต้นฉบับให้เริ่ม y=0 ได้ แต่ห้ามตั้ง y ที่ทำให้ผม/ศีรษะหลุดกรอบเด็ดขาด
10. ★★ บุคคลเดียวกันห้ามปรากฏเกิน 2 ช่อง — ถ้าเรื่องมีบุคคลอื่น (ผู้ให้/ผู้รับ/คู่กรณี/ครอบครัว) ต้องให้พื้นที่พวกเขา ช่องที่เกินให้ใช้ฉากเหตุการณ์แทน

ตอบ JSON เท่านั้น:
{"assignments":[{"slotId":"main","imageIndex":0,"crop":{"x":0.1,"y":0.0,"w":0.6,"h":0.9},"why":"สั้นๆ"}],"reason":"ภาพรวมการเล่าเรื่อง"}`;

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

    // Validate: ครบทุกช่อง ไม่ซ้ำภาพ ดัชนีถูก
    const slotIds = new Set(templateSpec.slots.map(s => s.id));
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

    if (valid.length < templateSpec.slots.length) {
      console.log(`[CoverDirector] ⚠️ assignments ใช้ได้ ${valid.length}/${templateSpec.slots.length} ช่อง`);
      return null;
    }

    valid.forEach(a => console.log(`[CoverDirector] 🎬 ${a.slotId} ← #${a.imageIndex} crop(${a.crop.x.toFixed(2)},${a.crop.y.toFixed(2)},${a.crop.w.toFixed(2)},${a.crop.h.toFixed(2)}) — ${a.why}`));
    return { assignments: valid, reason: String(parsed.reason || '').slice(0, 200) };
  } catch (e) {
    console.log('[CoverDirector] ❌ direct failed:', e.message?.slice(0, 80));
    return null;
  }
}

/**
 * AI ตรวจปกที่ประกอบแล้ว 1 รอบ — สั่งแก้กรอบครอปถ้าหัวขาด/เพี้ยน
 * @returns {Promise<{ok: boolean, fixes: Array<{slotId, crop}>}>}
 */
export async function reviewCover({ coverBuffer, templateSpec, assignments }) {
  try {
    const small = await sharp(coverBuffer).resize(700, null, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
    const layout = assignments.map(a => `- ${a.slotId}: ภาพ #${a.imageIndex}`).join('\n');

    const prompt = `คุณคือ QC ปกข่าว ตรวจปกที่เพิ่งประกอบเสร็จ (canvas ${templateSpec.canvasW}x${templateSpec.canvasH})
ผังช่อง:
${templateText(templateSpec)}
การจัดวางปัจจุบัน:
${layout}

ตรวจเฉพาะปัญหาร้ายแรง (ไล่ตามลำดับ):
1. ★ สแกนขอบบนสุดของปกทั้งใบก่อน: มีศีรษะ/ผม/มวยผมของใครโดนตัดไหม? (จุดพลาดบ่อยสุด — ดูพิกเซลแถวบนสุดจริงๆ)
2. หัว/หน้าคนโดนตัดที่ขอบช่องอื่นๆ
3. ★ ใบหน้า/จุดโฟกัสโดน "ช่องที่ลอยทับ" บัง (กรอบไฮไลต์/วงกลมทับหน้าคนของช่องล่าง) — ต้องแก้ครอปให้หน้าย้ายไปโซนเปิดโล่ง
4. ครอปจนเหลือแต่พื้นหลัง คนหาย/เล็กจนมองไม่ออก
5. ภาพเบลอ/แตกจากการซูมเกิน

ถ้าพบ → สั่งแก้ด้วยกรอบครอปใหม่ (สัดส่วน 0-1 ของภาพต้นฉบับเดิม)
ถ้าปกใช้ได้ → ok=true, fixes=[]

ตอบ JSON เท่านั้น: {"ok":true/false,"fixes":[{"slotId":"main","crop":{"x":0,"y":0,"w":0.8,"h":0.85},"why":"สั้นๆ"}]}`;

    const res = await callAI({
      prompt,
      imageContents: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}`, detail: 'auto' } }],
      model: DIRECTOR_MODEL,
      temperature: 0,
      maxTokens: 4000,
      systemPrompt: 'You are a strict QC reviewer. Respond with valid JSON only.',
    });

    const parsed = typeof res === 'object' && res !== null ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
    const fixes = (parsed?.fixes || []).filter(f => f.slotId && f.crop).map(f => ({
      slotId: f.slotId,
      crop: {
        x: Math.min(Math.max(Number(f.crop.x) || 0, 0), 0.95),
        y: Math.min(Math.max(Number(f.crop.y) || 0, 0), 0.95),
        w: Math.min(Math.max(Number(f.crop.w) || 1, 0.15), 1),
        h: Math.min(Math.max(Number(f.crop.h) || 1, 0.15), 1),
      },
      why: String(f.why || '').slice(0, 80),
    }));
    fixes.forEach(f => console.log(`[CoverDirector] 🔧 QC fix ${f.slotId}: crop(${f.crop.x.toFixed(2)},${f.crop.y.toFixed(2)},${f.crop.w.toFixed(2)},${f.crop.h.toFixed(2)}) — ${f.why}`));
    return { ok: parsed?.ok !== false && fixes.length === 0, fixes };
  } catch (e) {
    console.log('[CoverDirector] ⚠️ review failed (non-fatal):', e.message?.slice(0, 60));
    return { ok: true, fixes: [] }; // ตรวจไม่ได้ = ปล่อยผ่าน (ปกประกอบเสร็จแล้ว)
  }
}
