/**
 * ★ เรียก AI แบบ "คงเนื้อดิบ" — ไม่ผ่านตัวกรอง FB กลาง (sanitizeOutput) — เฉพาะสายแตกประเด็น (17 มิ.ย. 69)
 *  เหตุผล (ทีมสั่ง): ตัวกรองกลางแทนคำ FB (เช่น "ศพ"→"ร่างผู้เสียชีวิต") แบบดิบ ไปตัดชื่อคนเพี้ยน
 *    (ภฤ"ศพ"ิสิฐ → ภฤร่างผู้เสียชีวิติสิฐ). สายนี้ผลิต "เนื้อหาดิบ/วัตถุดิบ" ไม่ใช่โพสต์จริง →
 *    ต้องคงชื่อ/ตัวเลข/ข้อเท็จจริงตรงต้นฉบับ 100%. FB-safety ค่อยไปทำงานตอนระบบทำข่าวอัตโนมัติเจนโพสต์จริง.
 *  ★ ไม่แตะ openai.js/safetyFilter.js — แค่เรียก client ที่ export ไว้ (getOpenAIClient) แล้วไม่ run sanitize
 */
import { getOpenAIClient } from '@/lib/ai/openai';

const SYS = `คุณเป็นบรรณาธิการข่าวไทยมืออาชีพ ตอบเป็น JSON ที่ถูกต้องเท่านั้น ตาม schema ที่ระบุใน prompt
กฎเหล็ก: ใช้เฉพาะข้อเท็จจริงจากข้อมูลที่ให้มา ห้ามแต่งเติม/บิดเบือน · ชื่อคน ตัวเลข สถานที่ คำพูด ต้องตรงต้นฉบับ 100% ห้ามเปลี่ยน/ย่อ/ตัด/แทนคำในชื่อเฉพาะ`;

export async function callRawJSON({ prompt, model, temperature = 0.5, maxTokens = 2000 }) {
  const client = getOpenAIClient();
  if (!client) throw new Error('OPENAI_API_KEY ไม่ได้ตั้งค่า');

  // fallback model เหมือน callAI: gpt-5.5→gpt-4o, gpt-5.4-mini→gpt-4o-mini
  const tryModels = [model];
  if (model === 'gpt-5.5') tryModels.push('gpt-4o');
  else if (model === 'gpt-5.4-mini') tryModels.push('gpt-4o-mini');
  else if (model !== 'gpt-4o') tryModels.push('gpt-4o');

  let lastErr = null;
  for (const m of tryModels) {
    try {
      const isNew = m.startsWith('gpt-5') || m.startsWith('o1') || m.startsWith('o3');
      const resp = await client.chat.completions.create({
        model: m,
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: prompt }],
        ...(isNew ? {} : { temperature }),          // gpt-5.x ไม่รับ temperature ≠ 1
        ...(isNew ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        response_format: { type: 'json_object' },
      });
      const content = resp.choices[0]?.message?.content;
      if (!content) throw new Error('AI returned empty content');
      return JSON.parse(content); // ★ ไม่ผ่าน sanitizeOutput — คงชื่อ/ข้อเท็จจริงเดิม
    } catch (e) { lastErr = e; }
  }
  throw new Error('callRawJSON failed: ' + (lastErr?.message || '').slice(0, 80));
}
