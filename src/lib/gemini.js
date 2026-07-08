// ============================================================
// [ระบบทำปกออโต้] Gemini Vision — คัดเฟรมจากคลิป
// ------------------------------------------------------------
// ส่งภาพเฟรม (base64) เป็นแบตช์ → ให้ Gemini เลือกเฟรมที่เห็น
// บุคคลเป้าหมายชัด คุณภาพดี ใช้ทำปกได้ → คืน index ที่เลือก
// คีย์: GEMINI_API_KEY (หรือ GOOGLE_API_KEY)
// ============================================================

import { withRetry } from './retry.js';
import { recordLLM } from './costStore.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';

export function geminiModel() {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

function getKey() {
  const k = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!k) {
    const e = new Error('ยังไม่ได้ตั้ง GEMINI_API_KEY — ใส่ในไฟล์ .env.local ของโปรเจกต์นี้');
    e.errorType = 'NO_GEMINI_KEY';
    throw e;
  }
  return k;
}

// เรียก Gemini พร้อม retry (กัน 503/429/overloaded) → คืน data (JSON)
// onRetry(attempt, waitMs) เรียกตอนต้องรอคิวลองใหม่ (ใช้อัปเดตสถานะ)
async function callGemini(body, { onRetry, cost } = {}) {
  const key = getKey();
  const model = geminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const data = await withRetry(
    async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const busy = res.status >= 500 || res.status === 429;
        const e = new Error(
          busy
            ? `Gemini ไม่ว่างชั่วคราว (${res.status}) — ลองหลายครั้งแล้วยังไม่ว่าง กดใหม่อีกครั้งสักครู่`
            : 'Gemini error ' + res.status + ': ' + JSON.stringify(d.error || d).slice(0, 200)
        );
        e.status = res.status;
        e.errorType = busy ? 'AI_BUSY' : 'PROVIDER_ERROR';
        throw e;
      }
      return d;
    },
    { retries: 8, onAttempt: onRetry }
  );
  // บันทึกต้นทุน (usageMetadata: promptTokenCount/candidatesTokenCount)
  if (cost) await recordLLM({ provider: 'gemini', model, usage: data.usageMetadata, step: cost.step, caseId: cost.caseId });
  return data;
}

function geminiText(data) {
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

// frames: [{ index:number, base64:string }]  → คืน [{ index, reason }]
export async function geminiSelectFrames({ frames, subjects, onRetry, caseId, newsGist, pinpoint }) {
  const COST_STEP = 'แคปเฟรม YouTube (คัดภาพ)';
  const names =
    (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';

  // ★ DEVIATION 6 ก.ค. (ผู้ใช้สั่ง): ส่ง "บริบทข่าว" ให้ตา + บังคับเก็บซีน/อารมณ์หลากหลาย
  const gistBlock = newsGist ? `\nบริบทข่าว (ใช้ตัดสินว่าเฟรมไหน "เล่าเรื่องข่าวนี้"): ${String(newsGist).slice(0, 500)}\n` : '';

  // ★ โหมดเจาะจงคลิป: ผู้ใช้ชี้คลิปนี้มาเอง = ต้องได้ภาพเยอะหลายมุม (คลิปข่าวจริงถ่ายมือ สั่นบ้างเป็นปกติ)
  const pinpointBlock = pinpoint
    ? `\n🎯 โหมดคลิปที่ผู้ใช้ชี้มาเอง (สำคัญ): ผู้ใช้ต้องการภาพจากคลิปนี้ "จำนวนมาก หลายมุม หลายซีน"
- เป้าหมาย: เลือกให้ได้มากที่สุดที่พอใช้ได้ (คลิปยาวควรได้ 12-20 เฟรม)
- ผ่อนเกณฑ์ความคม 1 ระดับ: "ชัดพอใช้" (เห็นหน้า/ท่าทาง/บริบทรู้เรื่อง) = เก็บ — ตัดเฉพาะเบลอหนักมาก/มืดสนิท/เฟรมเปลี่ยนฉากล้วนๆ
- กระจายให้ครบทุกช่วงคลิป (ต้น-กลาง-ท้าย) และทุกมุมกล้อง/ทุกคนที่ปรากฏ ไม่ใช่ซีนเดียวซ้ำ\n`
    : '';

  const promptText = `คุณคือผู้ช่วยคัดภาพจากคลิปข่าวเพื่อนำไปทำ "ปกข่าว"
มีภาพเฟรมที่แคปจากวิดีโอมาให้หลายรูป (กำกับด้วย "รูปที่ N:")
งานของคุณ: เลือกเฉพาะเฟรมที่ "ใช้ทำปกได้ดีจริง" ตามเกณฑ์
${gistBlock}${pinpointBlock}
เกณฑ์ที่ต้องผ่าน:
- เห็นบุคคลเป้าหมายชัดเจน: ${names}
- ใบหน้า/ตัวบุคคลคมชัด ไม่เบลอ ไม่ไหว ไม่มืดจนมองไม่เห็น
- เห็นสีหน้า อารมณ์ หรือองค์ประกอบที่สื่อเรื่องราว

🎭 เก็บให้ "ครบซีน ครบอารมณ์" (สำคัญ):
- ถ้ามีหลายฉาก/หลายโมเมนต์ในคลิป ให้เลือกตัวแทนของแต่ละฉากที่ผ่านเกณฑ์ ไม่ใช่ฉากเดียวซ้ำๆ
- อารมณ์ห้ามเลือกโทนเดียว: ยิ้ม, ร้องไห้/ตื้นตัน, อึ้ง/ตกใจ, กอด, จริงจัง, โมเมนต์แอ็คชัน — มีให้เก็บให้ครบ
- เฟรม "หลักฐาน/ของสำคัญในข่าว" (เอกสาร/สิ่งของ/ป้าย/สถานที่) ที่ชัดเจน = เก็บด้วย

ตัดทิ้ง (ห้ามเลือก):
- เฟรมเบลอ/ไหว/เปลี่ยนฉาก
- ไม่มีบุคคลเป้าหมาย หรือเห็นไม่ชัด (ยกเว้นเฟรมหลักฐาน/สถานที่ตามข้อบน)
- ตัวอักษร/กราฟิก/โลโก้เต็มจอ, ฉากไตเติล, โฆษณา, จอดำ

${pinpoint ? 'เลือกแบบ "ครบทุกซีนที่พอใช้ได้" (ปริมาณ+ครอบคลุม)' : 'เลือกแบบ "คุณภาพเหนือปริมาณ"'} ตอบกลับเป็น JSON เท่านั้น:
{ "selected": [ { "index": <เลขรูป>, "reason": "เหตุผลสั้นๆ" } ] }
ถ้าไม่มีเฟรมไหนดีเลย ให้ "selected": []`;

  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: frameLabel(f) });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };

  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const text = geminiText(data);
  const parsed = safeParse(text);
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : parsed.selected || parsed.frames || [];
  return list.filter((x) => x && typeof x.index === 'number');
}

// จำแนกภาพเพื่อจับคู่เข้าช่องปก + คืนกรอบใบหน้าไว้ครอป
// frames: [{index, base64}] → [{index, category, quality, faceBox|null, note}]
// รายชื่อ "ที่มา" แคตตาล็อก/โฆษณา/อสังหา ที่มักให้ภาพ "วัตถุมั่ว" (บ้าน/โครงการทั่วไป ไม่ใช่ของคนในข่าว)
// ใช้เป็น "ตัวอย่างสัญญาณ" ป้อนให้ Gemini ตัดสิน (ไม่ลบอัตโนมัติ — ให้ตาดูภาพประกอบเสมอ)
const CATALOG_SOURCE_HINTS =
  'Dot Property, AP (Thai), แสนสิริ/Sansiri, SHERA/เฌอร่า, NaiBann, CheckRaka, homethaidd, homenayoo, บ้าน-Kapook, Home.co.th, พฤกษา/Pruksa, ศุภาลัย, อนันดา, ศูนย์รวมแบบบ้าน, รับสร้างบ้าน, แบบบ้าน';

// บล็อกอธิบาย "บุคคล/สิ่งของหลักในข่าว" (ชื่อ + บทบาท) — ช่วยให้ AI รู้ว่าอะไรคือ "วัตถุ" ของข่าว
function subjectsBlock(subjects) {
  const list = (subjects || [])
    .map((s) => {
      const nm = s.name || '';
      if (!nm) return '';
      // ใส่ hint "เพศ + บทบาท/วัย" ช่วย AI แยกตัวละครในภาพครอบครัว/คู่ (พ่อ=ชายผู้ใหญ่ / ลูกชายวัย 23=ชายหนุ่ม / แม่=หญิง)
      const bits = [s.gender, s.role].filter(Boolean);
      const hint = bits.length ? ` (${bits.join(' — ')})` : '';
      return `• ${nm}${hint}`;
    })
    .filter(Boolean)
    .join('\n');
  return list || '• บุคคลในข่าว';
}

// 🎯 กฎ "ความเป็นเจ้าของ" ของภาพวัตถุ (บ้าน/รถ/สิ่งของ) — แก้ช่องโหว่ "ค้นวัตถุมั่ว"
const OWNERSHIP_RULES = `🎯 กฎ "ความเป็นเจ้าของ" ภาพวัตถุ (บ้าน/รถ/สิ่งของ/ทรัพย์สิน) — จุดที่ระบบเคยพลาดหนัก:
ภาพบ้าน/รถ/สิ่งของ จะ "ใช้ได้" เฉพาะเมื่อเป็น "ของคนในข่าวจริงๆ" เท่านั้น (เช่น บ้านของเบิ้ล ไม่ใช่บ้านสองชั้นของใครก็ไม่รู้)
- ✅ ของคนในข่าว (เก็บไว้): มีคนในข่าวอยู่ในภาพ/คู่กับวัตถุ, เป็นภาพข่าว/แคนดิดจริง, ที่มาเป็นสำนักข่าว/เพจ/โซเชียลของบุคคลนั้นที่รายงานเรื่องนี้
- ❌ วัตถุมั่ว ไม่ใช่ของคนในข่าว (ตัดทิ้ง):
   • มาจากเว็บอสังหา/รับสร้างบ้าน/แคตตาล็อก/โฆษณาโครงการ (เช่น ${CATALOG_SOURCE_HINTS})
   • เป็นภาพเรนเดอร์/โบรชัวร์/โฆษณา, มีสเปค "x ห้องนอน / พื้นที่ใช้สอย ตร.ม. / ราคา", โลโก้บริษัทรับสร้างบ้าน
   • บ้าน/รถ สวยแบบสต็อก/สตูดิโอ ที่แค่ "ตรงคีย์เวิร์ด" แต่ไม่มีอะไรโยงกับคนในข่าว
- 🏛️ ข้อยกเว้น "สถานที่สาธารณะที่ข่าวเอ่ยชื่อ": ป้าย/อาคาร/รั้วของสถาบันที่อยู่ในแก่นข่าว (เช่น มหาวิทยาลัย/โรงพยาบาล/วัด/โรงเรียน/มูลนิธิ ที่ข่าวระบุชื่อ) = ✅ ใช้ได้ ไม่ใช่วัตถุมั่ว แม้ไม่มีคนในภาพ — เป็นภาพบริบท/ปลายทางของเรื่อง (ชื่อเฉพาะระบุตัวตนสถานที่แล้ว)
ใช้ "ที่มา (source)" + "หัวข้อ (title)" ที่กำกับหน้าแต่ละรูป ประกอบการตัดสินเสมอ`;

// กำกับ label หน้าแต่ละรูป: เลขรูป + ที่มา + หัวข้อ (บริบทช่วย AI ตัดสินความเป็นเจ้าของ)
function frameLabel(f) {
  const src = f.source ? ` [ที่มา: ${f.source}]` : '';
  const ttl = f.title ? ` “${String(f.title).slice(0, 80)}”` : '';
  return `รูปที่ ${f.index}:${src}${ttl}`;
}

export async function geminiClassifyFrames({ frames, subjects, newsGist, onRetry, caseId }) {
  const COST_STEP = 'ประกอบปก (จับคู่ภาพ)';
  const names =
    (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';

  // ★ 8 ก.ค. (ผู้ใช้อนุมัติเฟส A "ป้ายภาพแฟ้ม"): พอร์เทรตคนในข่าวตัวจริงจากงานอื่น = เก็บ + ติดป้าย newsScene=false
  //   ปิดกลับพฤติกรรมเดิม (แฟ้ม=ทิ้ง): FILE_SHOT_TAG=0
  const FILE_TAG = process.env.FILE_SHOT_TAG !== '0';

  const promptText = `จำแนกภาพแต่ละรูป (กำกับด้วย "รูปที่ N:") เพื่อนำไปทำ "ปกข่าวคอลลาจ"
บุคคล/สิ่งของหลักในข่าว:
${subjectsBlock(subjects)}${newsGist ? `\nแก่นข่าว: ${newsGist}` : ''}

ตอบเป็น JSON เท่านั้น:
{ "items": [ { "index": <เลขรูป>, "category": "...", "quality": <1-10>, "relevant": true/false,${FILE_TAG ? ' "newsScene": true/false,' : ''} "person": "<ชื่อคนหลัก หรือ null>", "persons": ["<ชื่อคนในข่าวทุกคนที่เห็นชัดในรูป>"], "emotion": "<อารมณ์สีหน้า>", "clean": true/false, "faceCount": <จำนวนใบหน้าที่เห็นชัด>, "faceBox": {"x":0-1,"y":0-1,"w":0-1,"h":0-1} หรือ null, "peopleBox": {"x":0-1,"y":0-1,"w":0-1,"h":0-1} หรือ null, "note": "สั้นๆ" } ] }

relevant = "ภาพนี้เกี่ยวกับข่าวนี้ไหม" (แยกจากคุณภาพ!) —
          true = มี "บุคคล/สิ่งของ/สถานที่/เหตุการณ์ในข่าวนี้" **แม้ภาพจะมีลายน้ำ/ตัวหนังสือ/เป็นการ์ด/คุณภาพต่ำ** (ยังเกี่ยว = เก็บไว้)
          false = "ไม่เกี่ยวเลย" เท่านั้น: คนอื่น/ดาราคนอื่นที่ไม่ใช่ในข่าว, หัวข้อ/เหตุการณ์อื่น, ภาพสต็อก/โฆษณา/วัตถุมั่วที่ไม่ใช่ของคนในข่าว, กราฟิก/ภาพประกอบที่ไม่เกี่ยว
          ⚠️ อย่าตี relevant=false เพราะ "ภาพไม่สวย/มีลายน้ำ/มีตัวหนังสือ" — นั่นคือเรื่อง clean ไม่ใช่ relevant
          🏞️ ภาพ "สถานที่/บริบท" ที่ไม่มีคนในข่าว (สำคัญ): relevant=true เฉพาะเมื่อเป็นสถานที่/วัตถุ "เฉพาะของข่าวนี้"
          ที่เชื่อมโยงได้จริง (บ้าน/สิ่งของที่ข่าวพูดถึง, ป้ายชื่อสถานที่ที่ข่าวเอ่ย, เอกสาร/หลักฐานของข่าว, ฉากเหตุการณ์จริง)
          — วิวทิวทัศน์ทั่วไป/ภาพมุมกว้างของหมู่บ้าน-อำเภอ-จังหวัด/ภาพประกอบพื้นที่ ที่ไม่มีจุดเชื่อมชัดกับข่าวนี้ = relevant=false
          (ภาพบริบทต้องเกี่ยวกับข่าวโดยตรง ไม่ใช่แค่ "ถ่ายในจังหวัดเดียวกัน")${FILE_TAG ? `
          🧑‍🎨 พอร์เทรต/ภาพชัดของ "บุคคลในข่าว" ที่ยืนยันหน้าได้ว่าตรงคนจริง: relevant=true เสมอ แม้ภาพจะมาจาก
          งาน/อีเวนต์/บริบทอื่นที่ไม่ใช่ข่าวนี้ (เป็นวัตถุดิบหน้าเด่น — ป้าย newsScene ด้านล่างจะแยกให้เอง)
          ⚠️ ต้องเป็น "คนถูกจริง" เท่านั้น — หน้าคล้าย/ไม่แน่ใจว่าใช่คนในข่าว = relevant=false เหมือนเดิม
newsScene = ป้ายแยก "ภาพข่าวจริง vs ภาพแฟ้ม" (ตอบทุกรูปที่ relevant=true):
          true  = ภาพจากเหตุการณ์/ฉากของ "ข่าวนี้" จริง (ลงพื้นที่ มอบของ ฉากในเรื่อง สถานที่/หลักฐานของข่าว)
          false = "ภาพแฟ้ม" — คนในข่าวตัวจริง แต่ถ่ายจากงาน/อีเวนต์/บริบทอื่น (พรมแดง งานเก่า ภาพโปรไฟล์ ละคร)
          ไม่แน่ใจว่าฉากไหน → ถ้าองค์ประกอบภาพเข้ากับแก่นข่าว = true, ถ้าดูเป็นภาพสวยจากงานอื่นชัด = false` : ''}
clean   = true ถ้าเป็นภาพ "สะอาด + เกี่ยวกับข่าวนี้จริง" เอาขึ้นเฟรมปกได้ (คนในข่าวเด่น หรือวัตถุที่เป็นของคนในข่าวจริง)
          false ถ้าเป็น "ขยะ" — ห้ามขึ้นเฟรม:
          (ก) ลายน้ำหนา, ปกคลิป/ปกวิดีโอ, ภาพปกขาว/การ์ด, ตัวหนังสือ/แคปชั่นทับ(โดยเฉพาะทับหน้า), โลโก้/ซับ/UI บดบัง, คนไม่เด่น/ถูกบัง/มีของมาบัง
          (ก2) ลายน้ำ/username/ชื่อเพจ "แม้ตัวเล็ก" (IG/TikTok/@handle/โลโก้มุม) ที่ทับตัวคนหรืออยู่กลางภาพ = clean=false (ครอปหลบไม่ได้) — ถ้าอยู่มุมภาพห่างตัวคนและครอปหลบได้ = clean=true แต่บันทึกใน note ว่า "ลายน้ำมุมX"
          (ก3) ภาพ "แคปโพสต์ทั้งใบ" (มีกรอบขาว/หัวโพสต์ชื่อบัญชี/ปุ่มไลก์/คอมเมนต์/UI แอป) = clean=false เสมอ — ภาพจริงข้างในต่อให้ดีก็ห้าม (กรอบ/หัวโพสต์จะติดขึ้นปก)
          (ข) ภาพ "วัตถุ" (บ้าน/รถ/สิ่งของ) ที่ "ไม่ใช่ของคนในข่าว" — บ้าน/รถทั่วไปจากแคตตาล็อก/โฆษณา/อสังหา ที่แค่ตรงคีย์เวิร์ด (ดูกฎความเป็นเจ้าของด้านล่าง)
          🏛️ ยกเว้น: "สถานที่สาธารณะ/หลักฐานที่ข่าวเอ่ยถึง" (ป้าย-อาคารมหาวิทยาลัย/โรงพยาบาล/วัด ตามแก่นข่าว, จดหมาย/เช็ค/เอกสาร) = clean=true แม้ไม่มีคน/มีตัวหนังสือบนป้าย-หลักฐาน (นั่นคือของที่ต้องการ)
          ⚠️ ข้อยกเว้นนี้ใช้กับ "ภาพถ่ายจริง" เท่านั้น — โลโก้/ตราสัญลักษณ์/emblem/กราฟิกล้วนของสถาบัน = clean=false เสมอ (เป็นกราฟิก ไม่ใช่ภาพถ่ายสถานที่)

${OWNERSHIP_RULES}

emotion = อารมณ์ "สีหน้า" จริงของคนในรูป เลือก 1 (ดูตาให้ดี อย่าเหมารวมเป็น serious/happy):
  happy(ยิ้มกว้าง ร่าเริงสดใส) / laugh(หัวเราะเห็นฟัน) / warm(ยิ้มอ่อนโยน/ซึ้ง/ภูมิใจ/รักใคร่ — สายตานุ่มนวลอบอุ่น เช่นข่าวครอบครัว-ภูมิใจ-กตัญญู) / serious(นิ่งเฉย เป็นทางการ ไม่ยิ้ม) / sad(เศร้า-ร้องไห้) / worried(กังวล-เครียด-หนักใจ) / shock(ตกใจ-อึ้ง) / angry(โกรธ) / none(ไม่มีคน/ไม่ชัด)
  ⚠️ "ยิ้มบางๆ ดูอบอุ่น/ภูมิใจ" = warm (ไม่ใช่ happy); "หน้านิ่งดูอ่อนโยน" ในข่าวโทนอบอุ่น = warm (ไม่ใช่ serious)

category เลือกจาก:
- "face-emotional" = โคลสอัพใบหน้า อารมณ์ชัด (ร้องไห้/เศร้า/ตกใจ/สะเทือนใจ/เครียด/ซึ้ง)
- "face-neutral"   = โคลสอัพใบหน้าชัด แต่สีหน้าเฉยๆ
- "context"        = มีเดียม/กว้าง เห็นฉาก/แอ็คชัน/ชีวิตประจำวัน
- "group"          = มีคนตั้งแต่ 2 คนขึ้นไป
- "document"       = เอกสาร/ตัวหนังสือ/กระดาษ
- "other"          = เบลอ/มืด/ไม่มีคน/ใช้ไม่ได้

person   = ชื่อบุคคลเป้าหมายที่เป็น "คนหลัก/หน้าใหญ่สุด" ในรูป เลือกจาก: ${names} — ถ้าไม่ใช่คนเป้าหมายหรือไม่แน่ใจให้ null
persons  = ชื่อ "คนในข่าวทุกคน" ที่เห็นชัดในรูป (array) — ภาพคู่/หมู่ต้องลงให้ครบ เช่นภาพพ่อกับลูก = ["นุ้ย เชิญยิ้ม","น้องภู"] ; ไม่มีคนในข่าว = []
  🔎 วิธีแยกตัวละครในภาพครอบครัว/คู่/หมู่ (สำคัญ): ใช้ "เพศ + วัย + บทบาท" ที่กำกับข้างชื่อด้านบน + "หัวข้อรูป(title)" ประกอบ —
     เช่น พ่อ=ชายผู้ใหญ่, ลูกชายวัย 23=ชายหนุ่ม, แม่=หญิง ; ในภาพรับปริญญาที่มีชายผู้ใหญ่ยืนข้างชายหนุ่มใส่ครุย → ชายหนุ่มใส่ครุย=ลูก, ชายผู้ใหญ่=พ่อ
  👶 กฎกันผิดคน (สำคัญมาก): subject ที่เป็น "คนนิรนาม/เด็ก/ชาวบ้าน" ที่ไม่มีรูปลักษณ์สาธารณะให้เทียบ (เช่น "เด็กหญิง (ลูกสาวของแม่บ้าน)") — ห้ามเดาว่าเด็ก/คนแปลกหน้าในรูปคือคนนั้น! ให้ person=null และ **clean=false** (เอาเด็ก/คนแปลกหน้าที่ยืนยันไม่ได้ขึ้นปก = ผิดคน ร้ายแรงมาก) ; แมป person/persons ได้เฉพาะ "คนดัง/ดาราที่จดจำหน้าได้จริง" หรือคนที่ title+เพศ/วัยยืนยันตรงกันชัดเจน
faceCount= จำนวนใบหน้าคนที่เห็น "ชัด" ในรูป (เต็มหน้า ไม่ใช่หน้าเบลอ/ด้านหลัง)
faceBox  = กรอบใบหน้า "คนหลัก" เป็นสัดส่วน 0-1 (x,y = มุมซ้ายบนของกรอบ) ถ้าไม่มีใบหน้าให้ null
peopleBox= กรอบครอบ "ตัวคนทุกคนรวมกัน" (normalized 0-1) เฉพาะเมื่อมี 2 คนขึ้นไปที่เห็นชัดทั้งคู่ ไม่งั้น null
quality  = คุณภาพรวมสำหรับทำปก (คมชัด องค์ประกอบ เห็นหน้า) 1-10`;

  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: frameLabel(f) });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  };

  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const text = geminiText(data);
  const parsed = safeParse(text);
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : parsed.items || [];
  return list.filter((x) => x && typeof x.index === 'number');
}

// สแกน "ภาพขยะ" ที่ใช้ทำปกข่าวไม่ได้ → [{index, junk, reason}]
export async function geminiJunkScan({ frames, subjects, newsGist, onRetry, caseId }) {
  const COST_STEP = 'คัดขยะภาพ';
  const promptText = `คุณคือ "บรรณาธิการภาพข่าว" มืออาชีพ ใช้ "ตา" ส่องภาพแต่ละรูปอย่างละเอียด (กำกับ "รูปที่ N:")
แล้วใช้ "ตรรกะ" ตัดสินว่าเป็น "ภาพขยะ" (junk=true) หรือ "ภาพใช้ได้" (junk=false)
เพื่อคัดคลังรูปให้เหลือเฉพาะภาพที่ "เกี่ยวกับข่าวนี้จริงๆ"

บุคคล/สิ่งของหลักในข่าว:
${subjectsBlock(subjects)}${newsGist ? `\nแก่นข่าว: ${newsGist}` : ''}

นิยาม "ภาพใช้ได้" (junk=false) — เก็บไว้:
- ภาพถ่ายจริง "บุคคลในข่าว" เด่น สะอาด เห็นหน้าชัด ไม่มีตัวหนังสือ/ลายน้ำ/กราฟิกมาทับ
- ภาพ "วัตถุของคนในข่าว" (บ้าน/รถ/สิ่งของ) ที่เป็น "ของคนในข่าวจริงๆ" (ดูกฎความเป็นเจ้าของด้านล่าง)
- เอกสาร/หลักฐานที่เกี่ยวกับข่าวนี้โดยตรง (จดหมาย/เช็ค/ป้าย — ตัวหนังสือบนหลักฐานคือของที่ต้องการ ไม่ใช่ขยะ)
- 🏛️ "สถานที่สาธารณะที่ข่าวเอ่ยชื่อ" (ป้าย/อาคาร/รั้ว มหาวิทยาลัย/โรงพยาบาล/วัด/โรงเรียน ที่อยู่ในแก่นข่าว) = เก็บไว้ แม้ไม่มีคนในภาพ — เป็นภาพบริบทปลายทางของเรื่อง (เฉพาะ "ภาพถ่ายจริง" — โลโก้/ตราสัญลักษณ์/กราฟิกล้วนของสถาบัน = ขยะเหมือนเดิม)
- เอาไป "รีทัช/ครอปทำปกได้ทันที" ไม่ติดนู่นติดนี่

นิยาม "ภาพขยะ" (junk=true) — ต้องลบทิ้ง (มองด้วยตาให้ครบ):
1. มี "ตัวหนังสือ/แคปชั่น/ข้อความ" ทับบนภาพหรือ "ทับใบหน้า" — โดยเฉพาะพาดหัวตัวใหญ่ → รีทัชไม่ได้ = ขยะ
2. ปกข่าว/ปกคลิป/thumbnail คลิกเบต ที่มีข้อความพาดหัว (เช่น "อึ้ง!!", "เผยคำพูดลับ", "10 ผลงานดัง...")
3. ลายน้ำ/โลโก้/ตราสำนักข่าว/ชื่อช่อง/เว็บไซต์ ประทับบนภาพ
4. ภาพคอลลาจหลายช่อง / การ์ดกราฟิก / quote card / การ์ดวันเกิด
5. การ์ดไตเติล/อินโทรรายการ, กราฟิกล้วน, ปุ่มเล่น ▶, หน้าจอ UI, จอดำ/ขาวเปล่า
6. เบลอหนัก/มัว/มืด/เฟรมเปลี่ยนฉาก จนใช้ไม่ได้
7. ไม่ใช่บุคคลเป้าหมาย/ไม่เกี่ยวข่าว — คนอื่น, มีม, ภาพสุ่มมั่ว
8. 🎯 "วัตถุมั่ว" (บ้าน/รถ/สิ่งของ ที่ "ไม่ใช่ของคนในข่าว") — บ้าน/รถทั่วไปจากแคตตาล็อก/โฆษณา/อสังหา ที่แค่ตรงคีย์เวิร์ด (ดูกฎด้านล่าง)

${OWNERSHIP_RULES}

หลักคิด: "เก็บไว้เฉพาะภาพที่เป็นคน/ของ ของคนในข่าวจริงๆ และสะอาดรีทัชได้" — สงสัยว่าเป็นบ้าน/รถมั่วที่ไม่ใช่ของคนในข่าว = ตัดทิ้ง
ตอบเป็น JSON เท่านั้น: { "items": [ { "index": <เลขรูป>, "junk": true/false, "reason": "สั้นๆ (เช่น 'บ้านแคตตาล็อกไม่ใช่ของคนในข่าว', 'มีข้อความทับหน้า', 'ลายน้ำสำนักข่าว')" } ] }`;

  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: frameLabel(f) });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  };
  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const text = geminiText(data);
  const parsed = safeParse(text);
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : parsed.items || [];
  return list.filter((x) => x && typeof x.index === 'number');
}

// แยก "อารมณ์ภาพ" เป็นหมวดหมู่ → [{index, emotion}]
// emotion keys: happy laugh sad serious angry shock warm worried context document other
export async function geminiEmotionScan({ frames, subjects, onRetry, caseId }) {
  const COST_STEP = 'แยกอารมณ์ภาพ';
  const names =
    (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';

  const promptText = `คุณคือ "ผู้กำกับภาพ" ใช้ "ตา" ส่องสีหน้า/อารมณ์ในแต่ละรูป (กำกับ "รูปที่ N:")
แล้วใช้ "ตรรกะ" จัดแต่ละรูปเข้า "หมวดอารมณ์" 1 หมวด (บุคคลเป้าหมาย: ${names})

หมวดอารมณ์ (เลือก key เดียวต่อรูป) — เกณฑ์ชัดเจน:
- "happy"   = ยิ้ม สีหน้าเบิกบาน อารมณ์ดี มีความสุข (ยิ้มพอดี ไม่ถึงกับหัวเราะ)
- "laugh"   = หัวเราะ ปากเปิดกว้าง สนุกสุดๆ ขำ
- "sad"     = เศร้า ร้องไห้ น้ำตา ซึม โศกเศร้า ทุกข์
- "serious" = สีหน้านิ่ง จริงจัง เคร่งขรึม ไม่ยิ้ม มองตรง (neutral/สุขุม)
- "angry"   = โกรธ ขมวดคิ้ว ไม่พอใจ ตวาด หน้าบึ้ง
- "shock"   = ตกใจ ตาเบิกกว้าง ปากอ้า ประหลาดใจ ช็อก
- "warm"    = อบอุ่น ซาบซึ้ง อ่อนโยน กอด/สัมผัส โมเมนต์ครอบครัว-กำลังใจ
- "worried" = กังวล เครียด ครุ่นคิด เหนื่อยล้า วิตก
- "context" = ไม่เน้นสีหน้า — เป็นฉาก/แอ็คชัน/สถานที่/ชีวิตประจำวัน/ทำงาน
- "document"= เอกสาร/ตัวหนังสือ/กระดาษ (ไม่ใช่คน)
- "other"   = ไม่ชัด/อารมณ์ปนกันจนแยกไม่ได้/ไม่มีคน

หลักคิด: ดู "สีหน้า+ท่าทาง" เป็นหลัก แล้วเลือกหมวดที่ "เด่นสุด" ของรูปนั้น
ตอบเป็น JSON เท่านั้น: { "items": [ { "index": <เลขรูป>, "emotion": "<key>" } ] }`;

  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: frameLabel(f) });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  };
  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const text = geminiText(data);
  const parsed = safeParse(text);
  if (!parsed) return [];
  const list = Array.isArray(parsed) ? parsed : parsed.items || [];
  return list.filter((x) => x && typeof x.index === 'number' && x.emotion);
}

// 👁️ ตาเช็คฮีโร่: ดูภาพผู้ท้าชิงจริง → ใบไหน "หน้าเดี่ยวใหญ่ชัด" เหมาะเป็นฮีโร่ปกที่สุด
// (กันเคส faceBox มั่ว: ภาพผนัง/คนติดขอบถูกจัดเป็น face → ครอปฮีโร่แล้วได้ผนังเปล่า)
export async function geminiHeroPick({ frames, subjects, onRetry, caseId }) {
  const COST_STEP = 'ตาเช็คฮีโร่';
  const names = (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';
  const promptText = `ภาพแต่ละใบคือ "ตัวอย่างผลครอปฮีโร่ปกจริง" (กำกับ "รูปที่ K:") — สิ่งที่เห็นคือสิ่งที่จะขึ้นปกจริง
ฮีโร่คือช่องใหญ่สุดของปก ต้องเป็น: ใบหน้า ${names} "เดี่ยว ใหญ่ ชัด เต็มหน้า" (หน้ากินพื้นที่ภาพมาก ไม่ถูกมือ/ไมค์/วัตถุบัง ไม่ติดขอบ ไม่เบลอ ไม่หันหลัง)
🚫 unusable เด็ดขาด: เห็นแต่ผนัง/เพดาน/ฉากเปล่า/แทบไม่เห็นหน้า, หน้าโดนขอบตัด/ถูกบัง, คนตัวเล็กอยู่ไกล, เบลอหนัก
ตอบ JSON: { "best": <index ที่ดีสุด>, "order": [index เรียงดีสุด→แย่], "unusable": [index ที่ห้ามใช้] }`;
  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: `รูปที่ ${f.index}:` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } };
  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const parsed = safeParse(geminiText(data)) || {};
  return {
    best: typeof parsed.best === 'number' ? parsed.best : null,
    order: Array.isArray(parsed.order) ? parsed.order : [],
    unusable: Array.isArray(parsed.unusable) ? parsed.unusable : [],
  };
}

// 👁️ E-loop QC ทั้งปก: ดู "ผลครอปจริงของทุกช่อง" พร้อมกัน → ช่องไหนไม่ผ่าน (ผนังเปล่า/หน้าแหว่ง/ถูกบัง/ซ้ำ/ขัดแปลน)
export async function geminiCoverCheck({ frames, plan, subjects, onRetry, caseId }) {
  const COST_STEP = 'ตา QC ทั้งปก';
  const names = (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';
  const avoid = (plan?.avoid || []).join(' · ') || '-';
  const promptText = `คุณคือ QC ปกข่าวไวรัลที่เข้มงวดที่สุด — ภาพแต่ละใบคือ "ผลครอปจริง" ของช่องบนปก (กำกับ "ช่อง <ชื่อ>:")
สิ่งที่เห็นคือสิ่งที่คนจะเห็นบนปกจริง | บุคคลในข่าว: ${names}
แนวคิดปก: ${plan?.concept || '-'}
🚫 แปลนห้าม: ${avoid}

ตัดสินทีละช่อง "ไม่ผ่าน" เมื่อ:
1. เห็นแต่ผนัง/เพดาน/ผ้าม่าน/ฉากเปล่า — แทบไม่มีเนื้อหา/ไม่เห็นคน
2. หน้าแหว่ง/โดนขอบตัด/ถูกมือ-ไมค์-วัตถุ-หัวคนอื่นบังหน้า
3. เบลอหนัก/มืดมาก/ขาวโพลน
4. "ซ้ำ" = คนเดิม+อารมณ์เดิม+มุม/ฉากเดิม กับช่องอื่น → ไม่ผ่านช่องที่เล็กกว่า
   ⚠️ "ตัวเอกคนเดิมแต่คนละอารมณ์/มุม" = ถูกต้องตามสูตรปกไวรัล ห้ามตัดสินว่าซ้ำ!
5. 🚫 "คนแปลกหน้า" (ไม่ใช่บุคคลในข่าว) เป็นตัวเด่นของช่อง — โดยเฉพาะวงกลม = ตกทันที (ผิดคนร้ายแรงสุด)
6. ขัดข้อ "แปลนห้าม" ชัดเจน
ช่องที่พอใช้ได้แม้ไม่สมบูรณ์แบบ = ผ่าน (อย่าเข้มจนทุกช่องตก)
ตอบ JSON เท่านั้น: { "fail": [ { "slot": "<ชื่อช่อง>", "reason": "สั้นๆ" } ] } — ผ่านหมดให้ "fail": []`;
  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: `ช่อง ${f.slot}:` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } };
  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const parsed = safeParse(geminiText(data)) || {};
  return { fail: Array.isArray(parsed.fail) ? parsed.fail.filter((x) => x && x.slot) : [] };
}

// 🎬 "ผู้กำกับการคัดเลือกภาพ" (casting director) — เลือกภาพจากคลังให้ตรง "แปลนผู้กำกับศิลป์" เคร่งครัด
// frames: [{index, base64}] (ผู้สมัครทั้งหมด) · plan: coverPlan (shots) → คืน { assignments: {SLOT:[index,...]}, notes }
export async function geminiCastToPlan({ frames, plan, subjects, onRetry, caseId }) {
  const COST_STEP = 'คัดภาพตามแปลนปก';
  const names = (subjects || []).map((s) => s.name).filter(Boolean).join(', ') || 'บุคคลในข่าว';
  const prio = { must: 'ต้องมี', should: 'ควรมี', nice: 'มีก็ดี' };
  const planText = (plan?.shots || [])
    .map((sh) => {
      const fb = (sh.fallbacks || []).slice(0, 3).join(' / ');
      return `[${sh.slot}] (${prio[sh.priority] || ''}) อารมณ์: ${sh.emotion || '-'}\n  ต้องการ(ideal): ${sh.ideal || '-'}\n  ถ้าไม่มีใช้แทนตามลำดับ: ${fb || '-'}`;
    })
    .join('\n');

  const promptText = `คุณคือ "ผู้กำกับการคัดเลือกภาพ (casting director)" ใช้ "ตา" ดูภาพจริงทุกใบ
แล้วเลือกภาพจากคลังให้ตรงกับที่ "ผู้กำกับศิลป์" สั่งไว้ในแปลนปก "เคร่งครัดที่สุด"
บุคคลในข่าว: ${names}
แนวคิดปก: ${plan?.concept || '-'}

== แปลนปก (แต่ละช่องต้องการภาพแบบนี้) ==
${planText}

🚫 ห้ามขึ้นปกเด็ดขาด: ${(plan?.avoid || []).join(' · ') || '-'}

มีภาพผู้สมัครหลายรูป (กำกับ "รูปที่ K:") ด้านล่าง — ส่องด้วยตาให้ครบ
งานของคุณ: สำหรับ "แต่ละช่อง (SLOT)" เลือก index รูปที่ตรงกับที่สั่ง "มากที่สุด" เรียงดีสุดก่อน (สูงสุด 3 index/ช่อง)

🏆 หลักจากปกจริงหลายหมื่นไลก์: ข่าวตัวเอกเดี่ยว → ใช้ "ตัวเอกคนเดิมหลายช่องได้และควรทำ" แต่แต่ละช่องต้อง "คนละอารมณ์/คนละมุม/คนละฉาก" (เล่า arc อารมณ์: ว้าว→ยิ้ม→นิ่งเท่)
"ซ้ำ" ที่ห้ามจริงๆ = คนเดิม + อารมณ์เดิม + มุม/ฉากเดิม เท่านั้น | HERO เลือกใบที่ "อารมณ์แรงสุด+คมชัดสุด" (ว้าว/ตกใจ/ยิ้มกว้าง — ไม่เอาหน้านิ่ง candid ถ้ามีตัวเลือกดีกว่า)

เกณฑ์ตัดสิน (เรียงความสำคัญ):
1. ต้องเป็น "บุคคล/สิ่งของที่ถูกต้องตามข่าว" จริง (ไม่ใช่คนอื่น/ของมั่ว)
   ⚠️ เด็ก/บุคคลทั่วไปที่ "ยืนยันไม่ได้ว่าเป็นคนในข่าวจริง" = ห้ามใช้เด็ดขาด (ข่าวมักไม่เผยรูปเด็ก — ถ้าไม่แน่ใจ ใช้ภาพหลักฐาน/สถานที่แทน ผิดคนร้ายแรงกว่าไม่มีภาพ)
2. ตรงกับ ideal ก่อน — ถ้าไม่มี ค่อยดู fallback ตามลำดับ
3. อารมณ์สีหน้า/ระยะ/ฉาก ตรงที่สั่ง
4. ภาพสะอาด (ไม่มืด/ไม่เบลอ) — 🧾 หมายเหตุ: "ตัวหนังสือ/ตัวเลขที่เป็นส่วนของฉากจริง" (เช็ค/ป้ายมอบเงิน/แบนเนอร์งาน/เอกสารหลักฐาน/ป้ายสถาบัน) "ไม่ถือว่าขยะ" ใช้ได้เลยสำหรับช่องหลักฐาน MOMENT/CIRCLE (นั่นคือของที่ต้องการ!) ; ห้ามเฉพาะ "ภาพคอลลาจหลายช่อง/พาดหัวคลิกเบตทับ/ลายน้ำสำนักข่าว"
   🚫 เฟรมวิดีโอที่มี "ซับไตเติล/แคปชั่นรายการทับภาพ" = เลือกได้เฉพาะเมื่อ "ไม่มีทางเลือกที่สะอาดกว่า" ในช่องนั้นจริงๆ (ถ้ามีรูปสะอาดใกล้เคียง เลือกรูปสะอาดเสมอ)
5. 🏛️ ช่องที่สื่อ "สถานที่/สถาบัน" (มหาวิทยาลัย/โรงพยาบาล/วัด/โรงเรียน): เลือกเฉพาะ "ภาพถ่ายจริง" — เรียงความดี:
   (1) 🥇 ป้ายชื่อ/ซุ้มทางเข้า ที่ "ตัวหนังสือชื่อสถาบันภาษาไทยตัวใหญ่เด่นกินเฟรม อ่านออกทันทีบนมือถือ" (ดีสุด — สื่อสารแรงสุด)
   (2) อาคารเด่นที่มีป้ายชื่ออ่านได้  (3) แลนด์มาร์กที่คนจำได้
   ภาพวิว/สวนสวยแต่ "ชื่อเล็กหรือไม่มีชื่อ" = เลือกเป็นทางเลือกท้ายๆ เท่านั้น (คนเลื่อนฟีดไม่รู้ว่าที่ไหน)
   🚫 ห้ามเลือกโลโก้/ตราสัญลักษณ์/emblem/กราฟิกล้วนเด็ดขาด ; ถ้าไม่มีภาพถ่ายจริงเลย ให้ข้ามช่องนั้น ([]) ดีกว่าใส่โลโก้
❗ ถ้าไม่มีรูปไหนตรงช่องนั้นเลย ให้ใส่ [] (ห้ามยัดรูปมั่วเพื่อให้ครบ)
ห้ามใช้ index รูปเดียวซ้ำหลายช่อง — แต่ "ตัวเอกคนเดิมคนละรูป/คนละอารมณ์" ใช้หลายช่องได้ (ดีด้วย)

ตอบเป็น JSON ล้วน:
{ "assignments": { "<SLOT>": [<index>, ...], ... }, "notes": { "<SLOT>": "เหตุผลสั้นๆ ว่าเลือกเพราะตรงอะไร" } }`;

  const parts = [{ text: promptText }];
  for (const f of frames) {
    parts.push({ text: `รูปที่ ${f.index}:` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.base64 } });
  }
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } };
  const data = await callGemini(body, { onRetry, cost: { step: COST_STEP, caseId } });
  const parsed = safeParse(geminiText(data));
  if (!parsed || typeof parsed !== 'object') return { assignments: {}, notes: {} };
  return { assignments: parsed.assignments || {}, notes: parsed.notes || {} };
}

function safeParse(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s !== -1 && e !== -1 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
