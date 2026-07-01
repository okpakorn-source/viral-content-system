// ============================================================================
// Cover Shot Planner — "สมองวางแผนช็อต" สำหรับสั่งงาน Gemini แคปเฟรมตามโควตา
// ----------------------------------------------------------------------------
// หลักการ (ผู้ใช้สั่ง 1 ก.ค.):
//   ปัญหา: curateFrames สั่ง Gemini แค่ "เลือกเฟรมที่ดีที่สุด" = กว้างไป Gemini เดามั่ว
//   ทางแก้: มี "สมอง" อ่านเนื้อข่าวเต็ม → แตกคีย์ (คน+เหตุการณ์+ของ) → กำหนดโควตา %
//           แล้วส่งเป็น "ใบสั่งช็อต" (Capture Brief) ให้ Gemini เลือกเฟรมตามโควตา (ไม่เดา)
//   ผล: ได้ตัวเลือกครบทุกมุม (หน้าคนเยอะ + เหตุการณ์ + ของประกอบ) → Judge/Director มีของดีเลือก
//
// ⚠️ ระบบนี้อยู่ในสาย "ปก" เท่านั้น — ไม่แตะระบบข่าวอัตโนมัติแม้แต่บรรทัดเดียว
// ⚠️ ใช้ raw fetch ตรงไป OpenAI (pattern เดียวกับ storyIdentityService.js fallback)
//    ไม่ผ่าน callAI() เพราะ callAI มี system message "เขียนข่าว" + sanitizeOutput ที่ไม่เหมาะกับงานนี้
// ⚠️ opt-in: ทำงานเฉพาะเมื่อ env COVER_SHOT_PLANNER=true (คุมที่ผู้เรียก)
// ============================================================================

const LOG = '[ShotPlanner]';

// ใช้ model เดียวกับที่ระบบปกใช้ (gpt-4o) — อ่านจาก env ถ้ามี ไม่งั้น default
const PLANNER_MODEL = process.env.COVER_SHOT_PLANNER_MODEL || 'gpt-4o';

/**
 * สมองวางแผนช็อต — อ่านข่าวเต็ม → แตกคีย์คน+เหตุการณ์+ของประกอบ → สร้างโควตาสั่ง Gemini
 *
 * @param {string} fullContent - เนื้อข่าวเต็มที่ผู้ใช้ให้ (ห้ามตัด — สมองต้องเห็นเนื้อเต็มถึงแตกคีย์ได้ดี)
 * @param {object} identity - { mainCharacter, secondaryCharacter, coreStory, location, coverEmotion, newsTitle }
 * @returns {Promise<{subjects:Array, events:Array, objects:Array, summary:string, raw:object} | null>}
 *          คืน null เมื่อ: เนื้อข่าวสั้นเกิน / ไม่มี API key / เรียกล้ม → ผู้เรียกต้อง fallback โหมดเดิม
 */
export async function planShots(fullContent, identity = {}) {
  const content = String(fullContent || '').trim();
  if (content.length < 20) {
    console.log(`${LOG} ⏭️ เนื้อข่าวสั้นเกิน (${content.length} ตัว) — ข้ามการวางแผน`);
    return null;
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.log(`${LOG} ⏭️ ไม่มี OPENAI_API_KEY — ข้ามการวางแผน`);
    return null;
  }

  const mainChar = identity?.mainCharacter || '(ดูจากเนื้อข่าว)';
  const secondaryChar = identity?.secondaryCharacter || '-';
  const celebratedAction =
    identity?.coreStory?.celebratedAction || identity?.celebratedAction || '(ดูจากเนื้อข่าว)';
  const location = identity?.location || '-';
  const coverEmotion = identity?.coverEmotion || '-';

  const prompt = `คุณเป็น "ผู้กำกับภาพข่าว" (photo director) มือโปร วางแผนว่า "ปกข่าว" นี้ต้องการภาพอะไรบ้าง
เพื่อสั่งทีมงานไปแคปเฟรมจากคลิปวิดีโอข่าวให้ได้ตัวเลือกภาพครบทุกมุม

=== เนื้อข่าวเต็ม ===
${content.slice(0, 3000)}
=== จบเนื้อข่าว ===

ข้อมูลที่ระบบวิเคราะห์ไว้แล้ว:
- ตัวละครหลัก: "${mainChar}"
- ตัวละครรอง: "${secondaryChar}"
- เหตุการณ์หลักที่ข่าวเล่า: "${celebratedAction}"
- สถานที่: "${location}"
- อารมณ์ข่าว: "${coverEmotion}"

งานของคุณ: แตก "คีย์ภาพ" ที่ปกข่าวนี้ควรมี แล้วกำหนดโควตา (%) ว่าควรเก็บเฟรมแต่ละหมวดกี่ %
เป้าหมาย = ได้ตัวเลือกภาพครบทุกมุม ไม่ใช่ได้แต่หน้าคนซ้ำ หรือได้แต่ฉากที่ไม่มีคน

หลักการกำหนดโควตา (ปรับตามเนื้อข่าวจริง):
- คนในข่าว (หน้าชัด) = สำคัญสุดเสมอ ต้องมีหน้าเด่นพอทำ HERO → มักได้ 40-60%
- เหตุการณ์/บริบท (คนกำลังทำสิ่งที่ข่าวเล่า) → 20-40%
- ของประกอบ (สิ่งของ/สถานที่/หลักฐานสำคัญในข่าว) → 10-30%
- ข่าวที่เด่นที่ตัวบุคคล → คนเยอะ · ข่าวที่เด่นที่เหตุการณ์ → บริบทเยอะ

ตอบ JSON เท่านั้น (ห้ามมีข้อความอื่นนอก JSON):
{
  "subjects": [
    {"who": "ชื่อคนในข่าว", "priority": "main|secondary", "lookFor": "ลักษณะภาพที่ต้องการ เช่น หน้าโคลสอัพ/ครึ่งตัว/สีหน้าอารมณ์", "quotaPct": 50}
  ],
  "events": [
    {"what": "เหตุการณ์ในข่าว", "lookFor": "ภาพแบบไหน เช่น คนยืนข้างรถ/อยู่ในโชว์รูม/กำลังมอบของ", "quotaPct": 30}
  ],
  "objects": [
    {"what": "สิ่งของ/สถานที่สำคัญ", "lookFor": "เช่น รถคันจริง/ป้ายทะเบียนแดง/หน้าอาคาร", "quotaPct": 20}
  ],
  "summary": "สรุป 1 ประโยคว่าปกข่าวนี้ควรมีภาพอะไรบ้าง"
}

ข้อบังคับ:
- subjects ต้องมีอย่างน้อย 1 (ตัวละครหลัก) เสมอ
- quotaPct รวมทุกหมวดต้อง = 100
- lookFor ต้องเป็นภาษาไทย ชัดเจน สั่งได้จริง
- ใช้เฉพาะข้อมูลจากเนื้อข่าว ห้ามแต่งเพิ่ม`;

  try {
    const _isNew =
      PLANNER_MODEL.startsWith('gpt-5') ||
      PLANNER_MODEL.startsWith('o1') ||
      PLANNER_MODEL.startsWith('o3');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PLANNER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        ...(_isNew ? { max_completion_tokens: 2000 } : { max_tokens: 1500 }),
        ...(_isNew ? {} : { temperature: 0.2 }),
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      console.log(`${LOG} ⚠️ OpenAI ตอบ ${res.status} — ข้ามการวางแผน (ใช้โหมดเดิม)`);
      return null;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text.trim()) {
      console.log(`${LOG} ⚠️ ตอบว่าง (finish=${data.choices?.[0]?.finish_reason}) — ข้ามการวางแผน`);
      return null;
    }

    const parsed = JSON.parse((text.match(/\{[\s\S]*\}/) || [text])[0]);
    if (!parsed || !Array.isArray(parsed.subjects) || parsed.subjects.length === 0) {
      console.log(`${LOG} ⚠️ brief ไม่มี subjects — ข้ามการวางแผน`);
      return null;
    }

    // normalize + safe defaults
    parsed.subjects = (parsed.subjects || []).filter((s) => s && s.who).slice(0, 4);
    parsed.events = (parsed.events || []).filter((e) => e && e.what).slice(0, 4);
    parsed.objects = (parsed.objects || []).filter((o) => o && o.what).slice(0, 4);
    parsed.summary = String(parsed.summary || '').slice(0, 200);

    console.log(
      `${LOG} ✅ Brief: ${parsed.subjects.length} คน, ${parsed.events.length} เหตุการณ์, ${parsed.objects.length} ของ · ${parsed.summary}`
    );
    return parsed;
  } catch (e) {
    console.log(`${LOG} ⚠️ วางแผนช็อตล้ม → ใช้โหมดเดิม: ${String(e?.message || '').slice(0, 60)}`);
    return null;
  }
}

/**
 * แปลง shot brief → บล็อกข้อความคำสั่งภาษาไทย สำหรับฝังใน prompt ของ Gemini curator
 * (แยกออกมาเพื่อให้ geminiFrameCurator.js เรียกใช้ได้โดยไม่ต้องรู้โครงสร้าง brief)
 *
 * @param {object|null} brief - ผลจาก planShots()
 * @returns {string} - บล็อกคำสั่ง (ว่างถ้าไม่มี brief)
 */
export function briefToInstruction(brief) {
  if (!brief || !Array.isArray(brief.subjects) || brief.subjects.length === 0) return '';

  const lines = [];
  lines.push('🎬 ใบสั่งช็อต (เลือกเฟรมให้ตรงโควตานี้ — ห้ามเลือกมั่ว):');

  for (const s of brief.subjects) {
    lines.push(
      `- 👤 ${s.who}${s.priority ? ` (${s.priority})` : ''}: หาเฟรม "${s.lookFor || 'หน้าชัด'}" → เก็บ ~${s.quotaPct ?? '?'}% ของเฟรมที่เลือก`
    );
  }
  for (const e of brief.events || []) {
    lines.push(`- 🎯 เหตุการณ์: ${e.what} — หาเฟรม "${e.lookFor || 'บริบทเหตุการณ์'}" → ~${e.quotaPct ?? '?'}%`);
  }
  for (const o of brief.objects || []) {
    lines.push(`- 📦 ของประกอบ: ${o.what} — หาเฟรม "${o.lookFor || 'ของ/สถานที่'}" → ~${o.quotaPct ?? '?'}%`);
  }

  lines.push('');
  lines.push('⚠️ พยายามเลือกเฟรมให้ครบทุกหมวดตามโควตา (คน+เหตุการณ์+ของ) เพื่อให้ปกมีตัวเลือกหลากหลาย');
  lines.push('   ถ้าหมวดไหนไม่มีเฟรมตรงเลย ข้ามได้ แต่ระบุใน reason ว่าขาดหมวดไหน');
  return lines.join('\n');
}
