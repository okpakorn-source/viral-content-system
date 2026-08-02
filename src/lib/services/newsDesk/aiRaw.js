/**
 * ★ เรียก AI แบบ "คงเนื้อดิบ" — ไม่ผ่านตัวกรอง FB กลาง (sanitizeOutput) — เฉพาะสายแตกประเด็น (17 มิ.ย. 69)
 *  เหตุผล (ทีมสั่ง): ตัวกรองกลางแทนคำ FB (เช่น "ศพ"→"ร่างผู้เสียชีวิต") แบบดิบ ไปตัดชื่อคนเพี้ยน
 *    (ภฤ"ศพ"ิสิฐ → ภฤร่างผู้เสียชีวิติสิฐ). สายนี้ผลิต "เนื้อหาดิบ/วัตถุดิบ" ไม่ใช่โพสต์จริง →
 *    ต้องคงชื่อ/ตัวเลข/ข้อเท็จจริงตรงต้นฉบับ 100%. FB-safety ค่อยไปทำงานตอนระบบทำข่าวอัตโนมัติเจนโพสต์จริง.
 *  ★ ไม่แตะ openai.js/safetyFilter.js — แค่เรียก client ที่ export ไว้ (getOpenAIClient) แล้วไม่ run sanitize
 */
import { getOpenAIClient } from '@/lib/ai/openai';
import { logApiUsage } from '@/lib/ai/usageLogger';
import { DESK_MODEL_FAST } from '@/lib/services/deskModelConfig'; // 🔧 27 ก.ค. 69 (sol): กันสาย FAST โต๊ะข่าว (gpt-5.6-luna) fallback ไป gpt-4o เต็มราคา

const SYS = `คุณเป็นบรรณาธิการข่าวไทยมืออาชีพ ตอบเป็น JSON ที่ถูกต้องเท่านั้น ตาม schema ที่ระบุใน prompt
กฎเหล็ก: ใช้เฉพาะข้อเท็จจริงจากข้อมูลที่ให้มา ห้ามแต่งเติม/บิดเบือน · ชื่อคน ตัวเลข สถานที่ คำพูด ต้องตรงต้นฉบับ 100% ห้ามเปลี่ยน/ย่อ/ตัด/แทนคำในชื่อเฉพาะ`;

function logDeskUsage({ model, usage, caller }) {
  try {
    Promise.resolve(logApiUsage({
      provider: 'openai',
      model,
      inputTokens: usage?.prompt_tokens || 0,
      outputTokens: usage?.completion_tokens || 0,
      feature: `desk:${caller || 'unknown'}`,
    })).catch((error) => console.warn('[desk:usage] Failed to save usage log:', error?.message || error));
  } catch (error) {
    console.warn('[desk:usage] Failed to save usage log:', error?.message || error);
  }
}

export async function callRawJSON({ prompt, model, temperature = 0.5, maxTokens = 2000, caller = 'unknown' }) {
  const client = getOpenAIClient();
  if (!client) throw new Error('OPENAI_API_KEY ไม่ได้ตั้งค่า');

  // fallback model (โล๊ะโมเดลต่ำกว่า 5.6 — 1 ส.ค. 69): sol→terra · terra→sol · luna→terra · gpt-5.5→gpt-5.6-terra · gpt-5.4-mini→gpt-5.6-luna
  const tryModels = [model];
  if (model === 'gpt-5.6-sol') tryModels.push('gpt-5.6-terra');
  else if (model === 'gpt-5.6-terra') tryModels.push('gpt-5.6-sol');
  else if (model === 'gpt-5.6-luna') tryModels.push('gpt-5.6-terra');
  else if (model === 'gpt-5.5') tryModels.push('gpt-5.6-terra');
  else if (model === 'gpt-5.4-mini') tryModels.push('gpt-5.6-luna');
  // 🔧 สาย FAST โต๊ะข่าวที่ override ด้วย env (DESK_MODEL_FAST) ตกไปหา terra — ไม่ย้อนกลับไปหาโมเดลรุ่นเก่าอีก
  else if (model === DESK_MODEL_FAST) tryModels.push('gpt-5.6-terra');
  // ★ 1 ส.ค. 69 (Sol ตรวจจับ): โมเดลนอกลิสต์ (env override ชื่อแปลก/รุ่นเก่า) ต้องมีไม้สองเสมอ
  else if (model !== 'gpt-5.6-terra') tryModels.push('gpt-5.6-terra');

  let lastErr = null;
  // ★ 1 ส.ค. 69 (Sol รอบ 2): กันโซ่ซ้ำตัวเอง (เช่น env ชี้ terra ตรงๆ) — dedupe ก่อนยิง
  for (const m of [...new Set(tryModels)]) {
    try {
      const isNew = m.startsWith('gpt-5') || m.startsWith('o1') || m.startsWith('o3');
      const resp = await client.chat.completions.create({
        model: m,
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: prompt }],
        ...(isNew ? {} : { temperature }),          // gpt-5.x ไม่รับ temperature ≠ 1
        ...(isNew ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        response_format: { type: 'json_object' },
      });
      // Account for every completed provider response, even when its content is unusable.
      logDeskUsage({ model: m, usage: resp.usage, caller });
      const content = resp.choices[0]?.message?.content;
      if (!content) throw new Error('AI returned empty content');
      return JSON.parse(content); // ★ ไม่ผ่าน sanitizeOutput — คงชื่อ/ข้อเท็จจริงเดิม
    } catch (e) { lastErr = e; }
  }
  throw new Error('callRawJSON failed: ' + (lastErr?.message || '').slice(0, 80));
}
