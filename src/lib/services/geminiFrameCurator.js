/**
 * =====================================================
 * Gemini Frame Curator — "สมองคัดเฟรมทำปก" (27 มิ.ย. 2026)
 * =====================================================
 * รับเฟรมที่แตกจากคลิป (data URI) + หัวข้อข่าว → ส่งให้ Gemini "ดูทุกเฟรมพร้อมกัน" แล้วเลือก:
 *   🦸 hero  = เฟรมเด่นสุด (หน้าชัด/อารมณ์พีค/ตรงประเด็น/องค์ประกอบสวย)
 *   🖼️ context = ภาพประกอบเสริมเรื่อง (สูงสุด 4)
 *   ⛔ reject = เบลอ/มืด/ตัวหนังสือเต็มจอ/หลุดเรื่อง/ซ้ำ → ทิ้ง
 * คืนเฟรมเรียงใหม่ (hero ก่อน → context → ที่เหลือไม่โดน reject) ป้อนเข้า judge/Director ปกติต่อ
 *
 * 🔴 ใช้เฉพาะระบบทำปก (Cover Lab) — แยกอิสระจากระบบทำข่าว/ถอดคลิป
 *    เดิม metaFrameExtractor คัดด้วย "ตรวจหน้า gpt-4o-mini" เท่านั้น (กลไก ไม่เข้าใจความหมาย)
 *    ตัวนี้เติม "Gemini เข้าใจภาพ" — เลือกช็อตเด็ดที่ตรงข่าวจริง (เติมสิ่งที่ comment ตั้งใจไว้แต่ไม่เคยทำ)
 */
import { callGeminiVision } from '@/lib/ai/geminiClient';
import { briefToInstruction } from '@/lib/services/coverShotPlanner';

const LOG = '[FrameCurator]';

/**
 * @param {string[]} frames - array ของ data:image/...;base64,... (เฟรมที่แตกมา)
 * @param {string} context - หัวข้อ/บริบทข่าว (ช่วย Gemini เลือกเฟรมตรงเรื่อง)
 * @param {object} opts - { maxContext?: 4 }
 * @returns {Promise<{ frames: string[], heroIndex: number, picked: number[], reason: string, curated: boolean }>}
 */
export async function curateFrames(frames, context = '', opts = {}) {
  const maxContext = Number(opts.maxContext) || 4;
  // ★ 27 มิ.ย. (ผู้ใช้สั่ง): โหมด "ตรงข่าวเข้ม" — ใช้กับเฟรมจาก "คลิปรีเสิร์ช" ที่อาจผิดคน/ผิดเรื่อง
  //   Gemini ต้องตัดเฟรมที่ไม่ใช่บุคคลในข่าว/ไม่เกี่ยวเหตุการณ์ทิ้งก่อน เก็บเฉพาะที่มั่นใจว่าตรงข่าวจริง
  const strict = !!opts.strict;
  const person = String(opts.person || '').slice(0, 60);
  const story = String(opts.story || '').slice(0, 200);
  // ★ 1 ก.ค. (ผู้ใช้สั่ง): Shot Brief — "ใบสั่งช็อต" จาก coverShotPlanner
  //   ถ้ามี brief → Gemini เลือกเฟรมตามโควตา (คน %/เหตุการณ์ %/ของ %) แทนเลือกมั่ว
  const shotBrief = opts.shotBrief || null;
  const briefBlock = shotBrief ? briefToInstruction(shotBrief) : '';
  if (!Array.isArray(frames) || frames.length < 2) {
    return { frames: frames || [], heroIndex: 0, picked: (frames || []).map((_, i) => i), reason: 'เฟรมน้อยเกินไป ไม่ต้องคัด', curated: false };
  }
  // จำกัดจำนวนที่ส่งให้ Gemini — ปกติ 12 เฟรม · มี brief → 20 เฟรม (ตัวเลือกเยอะขึ้น จับครบทุกหมวด)
  const N = Math.min(frames.length, briefBlock ? 20 : 12);
  const use = frames.slice(0, N);
  // ★ callGeminiVision รับ { data(base64 ไม่มี prefix), mimeType } — แปลงจาก data URI · ถ้ามีเฟรมไม่ใช่ data URI (url) ข้ามการคัด (กัน index เพี้ยน)
  const imageObjs = [];
  for (const f of use) {
    const m = String(f).match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
    if (!m) return { frames, heroIndex: 0, picked: frames.map((_, i) => i), reason: 'เฟรมไม่ใช่ data URI ทั้งหมด — ข้ามการคัด', curated: false };
    imageObjs.push({ data: m[2], mimeType: m[1] });
  }

  const prompt = `คุณเป็นบรรณาธิการภาพข่าวมือโปร เลือกเฟรมจากคลิปวิดีโอข่าวเพื่อทำ "ภาพปกข่าว"
ภาพที่แนบมา ${N} รูป = เฟรมจากคลิป เรียงตาม index 0 ถึง ${N - 1} (รูปแรก=0)
บริบทข่าว: "${String(context || '').slice(0, 220)}"
${strict ? `
🔴🔴 ด่านความตรงข่าว (สำคัญสุด — ทำก่อนทุกอย่าง):
ข่าวนี้เกี่ยวกับบุคคล: "${person || '(ดูจากบริบทข่าว)'}"${story ? ` · เรื่อง: "${story}"` : ''}
เฟรมเหล่านี้มาจาก "คลิปที่ค้นด้วยคีย์เวิร์ด" อาจมีคลิปผิดคน/ผิดเรื่องปนมา → ต้อง reject ให้เด็ดขาด:
  ⛔ เป็นคนอื่นที่ไม่ใช่บุคคลในข่าว (ถ้าไม่มั่นใจว่าใช่คนเดียวกัน → reject อย่าเดา)
  ⛔ ฉาก/เหตุการณ์คนละเรื่องกับข่าวนี้ (คลิปคนละประเด็น/พิธีกร/ผู้ประกาศ/สต็อก/กราฟิก/โฆษณา)
เก็บ (ไม่ reject) เฉพาะเฟรมที่ "มั่นใจว่าเป็นบุคคลในข่าว หรือเป็นเหตุการณ์/บริบทของข่าวนี้จริง" เท่านั้น
ถ้าทั้งคลิปไม่มีเฟรมไหนตรงข่าวเลย → reject ทุกเฟรม (ตอบ context:[] และใส่ทุก index ใน reject)
` : ''}
${briefBlock ? briefBlock + '\n' : ''}เลือกและจัดอันดับเฟรมที่ "ดีที่สุดสำหรับทำปก":
- 🦸 hero (เลือก 1 เฟรม) = เฟรมเด่นสุด: เห็นหน้าตัวละครหลักชัด / อารมณ์พีค / ตรงประเด็นข่าว / องค์ประกอบสวย คมชัด
- 🖼️ context (เลือกสูงสุด ${maxContext} เฟรม) = ภาพประกอบเสริมเรื่อง: เห็นคน/สถานที่/เหตุการณ์ที่เกี่ยวข้อง มุมต่างจาก hero
- ⛔ reject = เฟรมที่ "ห้ามใช้ทำปก": เบลอ/มืด/หน้าเบลอ/ตัวหนังสือหรือซับเต็มจอ/โลโก้ช่อง/จอดำ/หลุดประเด็น/ซ้ำกับที่เลือกแล้ว

กฎ: hero ต้องเป็นเฟรมที่ "หน้าคนชัดที่สุดและตรงข่าว" · ถ้าทุกเฟรมไม่เห็นหน้าเลย เลือกเฟรมที่สื่อเรื่องดีสุดเป็น hero
ตอบ JSON เท่านั้น: {"hero": <index>, "context": [<index>,...], "reject": [<index>,...], "reason": "เหตุผลสั้นๆว่าทำไม hero ตัวนี้"}`;

  try {
    const r = await callGeminiVision({ prompt, images: imageObjs, maxTokens: 1200 });
    const inRange = (i) => Number.isInteger(i) && i >= 0 && i < N;
    const heroIndex = inRange(r.hero) ? r.hero : 0;
    const ctx = (Array.isArray(r.context) ? r.context : [])
      .filter(i => inRange(i) && i !== heroIndex)
      .filter((v, i, a) => a.indexOf(v) === i) // unique
      .slice(0, maxContext);
    const rejectSet = new Set((Array.isArray(r.reject) ? r.reject : []).filter(inRange));

    let finalOrder;
    if (strict) {
      // ★ โหมดตรงข่าวเข้ม: เก็บเฉพาะเฟรมที่ "ไม่โดน reject" (ตรงข่าวจริง) · ไม่เติม leftover · hero ที่โดน reject ก็ทิ้ง
      const heroOk = inRange(r.hero) && !rejectSet.has(r.hero) ? [r.hero] : [];
      const ctxOk = ctx.filter(i => !rejectSet.has(i));
      finalOrder = [...heroOk, ...ctxOk];
      if (finalOrder.length === 0) {
        console.log(`${LOG} 🚫 strict: ทั้งคลิปไม่มีเฟรมตรงข่าว (reject ${rejectSet.size}/${N}) — ทิ้งทั้งคลิป`);
        return { frames: [], heroIndex: 0, picked: [], reason: 'ไม่มีเฟรมตรงข่าว (strict)', curated: true };
      }
    } else {
      const order = [heroIndex, ...ctx];
      const usedSet = new Set(order);
      // ★ เซฟตี้: เติมเฟรมที่เหลือ (ไม่โดน reject + ยังไม่ถูกเลือก) ต่อท้าย — กันกรณี Gemini เลือกน้อยไป pipeline จะได้มีพอ
      const leftover = use.map((_, i) => i).filter(i => !usedSet.has(i) && !rejectSet.has(i));
      finalOrder = [...order, ...leftover];
    }
    const outFrames = finalOrder.map(i => frames[i]).filter(Boolean);

    console.log(`${LOG} ✅ Gemini${strict ? '(strict)' : ''} เลือก: ${finalOrder.length} เฟรม · reject=${rejectSet.size} จาก ${N}`);
    return { frames: outFrames, heroIndex: 0, picked: finalOrder, reason: String(r.reason || '').slice(0, 120), curated: true };
  } catch (e) {
    console.log(`${LOG} ⚠️ Gemini เลือกเฟรมล้ม → ใช้ลำดับเดิม (face-rank):`, String(e?.message || '').slice(0, 60));
    return { frames, heroIndex: 0, picked: frames.map((_, i) => i), reason: 'curator error', curated: false };
  }
}
