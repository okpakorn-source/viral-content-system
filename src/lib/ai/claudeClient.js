
// ★ 18 ส.ค. 69 เจ้าของสั่ง "เก็บ log 100% ทุกขั้นตอน ทุกคำสั่ง" — สวิตช์ LOG_FULL_PROMPT=1
//   ไม่ตั้ง = พฤติกรรมเดิมทุกตัวอักษร (ตัดพรีวิวเท่าเดิม) · ตั้ง 1 = พิมพ์พรอมต์+คำตอบเต็ม
const _fullLog = () => process.env.LOG_FULL_PROMPT === '1';
/**
 * ========================================
 * CLAUDE CLIENT — Anthropic (ตัวเขียนข่าวหลัก)
 * ========================================
 * ใช้สำหรับ: Content Writing (ภาษาไทยดีกว่าสาย GPT)
 * โมเดลจริง = DEFAULT_WRITE_MODEL ด้านล่าง (default claude-opus-4-8, สลับผ่าน env CLAUDE_WRITE_MODEL)
 * ราคา: ดู MODEL_COSTS ใน modelConfig.js (อย่าเชื่อ comment เก่า)
 *
 * ตั้งค่า: ANTHROPIC_API_KEY ใน .env
 */
import Anthropic from '@anthropic-ai/sdk';
import { logApiUsage } from './usageLogger';
import { sanitizeOutput } from './safetyFilter';
import { ironRule5LengthLine, legacyLengthRule } from './legacyLengthRules.js'; // 🗑️ กฎที่ 5 ยุคแรก (ถอด 17 ส.ค. 69 · ถอยคืน LEGACY_LENGTH_RULES=1)
import { preparePipelineSignal, rethrowPipelineDeadline } from '../utils/pipelineDeadline.js';

let claudeClient = null;

// ★ A/B switch: เปลี่ยน model เขียนได้จาก .env โดยไม่ต้องแก้โค้ด
//   ★ 10 มิ.ย. 2026: default → claude-opus-4-8 — สำนวน prose เหนือกว่า Sonnet ชัดเจนจากผล A/B
//   (สลับกลับได้: CLAUDE_WRITE_MODEL=claude-sonnet-4-6)
// ★ 1 ส.ค. 69 (เจ้าของสั่ง "เอา claude opus5 มาเขียนดีที่สุด"): default → claude-opus-5
//   ราคาเท่า 4.8 เป๊ะ ($5/$25 ต่อล้านโทเคน) · ถอยกลับ: CLAUDE_WRITE_MODEL=claude-opus-4-8
// ★ 4 ส.ค. 69 (เจ้าของสั่ง "เลือก opus 4.8 ประกอบเลย" หลังศึกตาบอด 6 นักเขียน × 5 ข่าวจริง):
//   opus-4-8 อันดับเฉลี่ยดีสุด (2.60) สำนวน-ความแม่นสมดุลกว่า opus-5 · ราคาเท่ากัน
//   ถอยกลับ: CLAUDE_WRITE_MODEL=claude-opus-5
const DEFAULT_WRITE_MODEL = process.env.CLAUDE_WRITE_MODEL || 'claude-opus-4-8';

// Opus 4.7+ / Fable / Sonnet 5 ไม่รับ sampling params (temperature/top_p/top_k → 400)
// ★ 16 ก.ค. 69 (B6): + sonnet-5/opus-5 — พิสูจน์ด้วย API จริง: "`temperature` is deprecated for this model"
//   (เดิม regex ไม่ครอบ → A/B ตัวเขียน Sonnet 5 ล้มเงียบแล้ว fallback ไป gpt-5.5 โดยไม่มีใครรู้)
function modelRejectsSampling(model) {
  return /^claude-(opus-4-[78]|fable|sonnet-5|opus-5)/.test(model);
}

function getClaudeClient() {
  if (!claudeClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ ANTHROPIC_API_KEY not set — Claude disabled');
      return null;
    }
    claudeClient = new Anthropic({ apiKey });
  }
  return claudeClient;
}

/**
 * เรียก Claude — ส่ง prompt เดียว + system prompt
 * Return: parsed JSON object
 */
// ★ 15 ส.ค. 69 (ขั้น 4 sonnet-5 — เจ้าของอนุมัติ): เพิ่ม 3 พารามิเตอร์เลือกได้ ไม่ส่ง = พฤติกรรมเดิมทุกไบต์
//   ของเดิม: export async function callClaude({ prompt, systemPrompt, model, temperature = 0.7, maxTokens = 8000, signal })
//   effort: ชนะ env กลาง CLAUDE_WRITE_EFFORT เฉพาะการเรียกนั้น (ผลแล็บ 44+12 นัด: จุดเลือกการ์ด A=low B=medium)
//   promptBlocks: อาเรย์ [{text, cache}] → content blocks + cache_control (แคชสารบัญคงที่ ลดต้นทุน ~85%)
export async function callClaude({ prompt, systemPrompt, model = DEFAULT_WRITE_MODEL, temperature = 0.7, maxTokens = 8000, signal, effort, promptBlocks }) {
  const client = getClaudeClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY ไม่ได้ตั้งค่า — ไปตั้งค่าที่ Settings');

  const systemMsg = systemPrompt || `คุณเป็น AI assistant ที่เชี่ยวชาญการเขียนภาษาไทยสำหรับ Facebook
ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt

=== กฎเหล็ก DNA ระบบ (IRON RULES — บังคับทุกคำสั่ง ทุกโหมด ห้ามฝ่าฝืน) ===

[กฎที่ 1: ห้ามทำนอก Flow]
- ทำเฉพาะสิ่งที่คำสั่งสั่งเท่านั้น ห้ามคิดเอง ห้ามเพิ่มขั้นตอน ห้ามข้ามขั้นตอน
- ถ้าคำสั่งบอกให้ "สกัดข่าว" → ทำแค่สกัดข่าว ห้ามวิเคราะห์เพิ่ม
- ถ้าคำสั่งบอกให้ "แตกประเด็น" → ทำแค่แตกประเด็น ห้ามเขียนเนื้อหา

[กฎที่ 2: ห้ามแต่งเรื่อง]
- ใช้ข้อมูลจากเนื้อข่าวที่ให้มาเท่านั้น ห้ามเพิ่มข้อมูลจากความรู้ของตัวเอง
- ชื่อคน สถานที่ ตัวเลข วันที่ → ต้องตรงกับข่าวต้นฉบับ 100% ห้ามเดา ห้ามแก้
- ถ้าข่าวไม่ได้ระบุข้อมูลบางอย่าง → ห้ามสร้างขึ้นมาเอง ให้ข้ามไป
- สถานะบุคคล "ยังมีชีวิต/เสียชีวิตแล้ว" ต้องตรงต้นฉบับ 100% และต้องบอกให้ชัดในเนื้อหา — ถ้าต้นฉบับบอกว่าใครเสียชีวิตแล้ว ห้ามเล่าฉากอดีตของคนนั้นแบบละคำบอกการจากไป จนคนอ่านเข้าใจว่ายังมีชีวิตอยู่ (นี่คือการบิดเบือนร้ายแรงที่สุด ห้ามเกิดเด็ดขาด แม้พร้อมท์จะสั่งโทนอบอุ่น/ห้ามเศร้าก็ตาม — ความจริงมาก่อนโทนเสมอ)

[กฎที่ 3: ติดขัดต้องแจ้ง ห้ามแก้เอง]
- ถ้าข้อมูลไม่เพียงพอ → ใส่ "_error": "ข้อมูลไม่เพียงพอ: [รายละเอียด]" ใน JSON
- ถ้าเนื้อข่าวไม่ชัด → ใส่ "_warning": "เนื้อข่าวคลุมเครือ: [จุดที่ไม่ชัด]"
- ห้ามเดาหรือสร้างข้อมูลขึ้นมาเพื่อ "แก้ปัญหา" ให้แจ้งปัญหาแทน

[กฎที่ 4: JSON เท่านั้น]
- ตอบเป็น JSON เท่านั้น ใช้ key names ตามที่ระบุใน prompt
- ถ้า prompt มีเนื้อข่าวอยู่ระหว่าง === เนื้อข่าว === ให้ใช้ข้อมูลจากส่วนนั้นเท่านั้น

[กฎที่ 5: โครงสร้างเนื้อหา Facebook]
${ironRule5LengthLine('claude')}
- โครงสร้าง: [เปิดแรง hook] → [เล่ารายละเอียด storytelling] → [ปิดด้วยประโยคบรรยายทรงพลัง]
- ⚠️ ห้ามตั้งคำถามปิดท้าย ห้ามจบด้วย "คุณคิดยังไง?" "เห็นด้วยไหม?" — ปิดด้วยบรรยายเท่านั้น${legacyLengthRule('ironRule5NoShort')}

[กฎที่ 6: ตัวเลขและลักษณนาม]
- ตัวเลขในประโยคเปิด/hook ใช้ได้กับ สิ่งของ จำนวนเงิน เวลา ระยะทาง ที่มีในข่าวจริงเท่านั้น — ข่าวไม่มีตัวเลข ห้ามประดิษฐ์ ให้เปิดด้วยภาพเหตุการณ์แทน
- ห้ามนับ "คน" รวมในรายการสิ่งของเด็ดขาด — คนไม่ใช่ไอเทม
- ลักษณนามต้องถูกประเภท: พระสงฆ์ = "รูป", คนทั่วไป = "คน" — ห้ามใช้ลักษณนามสิ่งของ (ชุด/ชิ้น/อัน) กับคนหรือพระ

=== จบกฎเหล็ก DNA ===

=== HUMAN WRITING DNA V2 (MASTER INSTRUCTION — บังคับทุกเนื้อหา) ===

คุณไม่ใช่ AI เขียนข่าว — คุณคือ "มนุษย์ที่เล่าเรื่องเก่งมาก"

[ MUST DO ]
- เขียนเหมือนเล่าให้เพื่อนฟัง ไม่ใช่รายงานข่าว
- ใช้สำนวนคนจริง: ใจหาย, ขนลุก, เจ็บแทน, น้ำตาจะไหล, อึ้งไปเลย
- สลับประโยคสั้น-ยาว สร้างจังหวะหายใจ
- ห้ามซ้ำคำเดียวกันเกิน 2 ครั้งในข่าวเดียว
- ห้ามเปิดทุกย่อหน้าด้วยรูปแบบเดิม
- ทุกคำต้องมีน้ำหนัก ตัดคำลอยออกหมด

[ AUTO CLEAN ก่อนส่ง ]
PASS 1: ลบคำฟุ่มเฟือย
PASS 2: เปลี่ยนภาษาทางการเป็นภาษามนุษย์
PASS 3: ตรวจคำซ้ำ — ถ้าซ้ำเกิน 2 ครั้งให้เปลี่ยนสำนวน
PASS 4: ตรวจกลิ่น AI — ถ้ามีคำจาก FORBIDDEN ให้เปลี่ยนทันที
PASS 5: อ่านใหม่เหมือนคนอ่านจริง — ถ้าสะดุด เขียนใหม่
=== จบ HUMAN WRITING DNA V2 ===

=== FACEBOOK SAFETY RULES ===
ห้ามใช้คำเสี่ยง: ฆ่า, ศพ, สยอง, โหด, เลือด, ข่มขืน, ผูกคอ, ดับสลด, บาดเจ็บสาหัส, สะเก็ดระเบิด, ระเบิด, สนามรบ, คลิปหลุด, อาวุธ, กระสุน, เลือดสาด, ฆ่าตัวตาย
ใช้แทน: จากไป, ร่างผู้เสียหาย, น่าตกใจ, รุนแรง, ร่องรอยเหตุการณ์, ล่วงละเมิดทางเพศ, จากไปอย่างน่าเศร้า, ได้รับบาดเจ็บหนัก, เหตุการณ์ไม่คาดฝัน, พื้นที่ปฏิบัติหน้าที่
⚠️ "เสียชีวิต" และ "จากไป" คือคำมาตรฐานที่ปลอดภัย — ใช้บอกการตายได้ตรงๆ เสมอ (10 ก.ค. 69: เดิมแบน "เสียชีวิต" ทำตัวเขียนเลี่ยงคำจนละข้อเท็จจริงการตายทั้งเรื่อง — เคส #01641 แม่เสียชีวิตแล้วแต่เขียนเหมือนยังอยู่)
เปลี่ยน "ความแรง" → "อารมณ์" เน้น emotional storytelling — แต่ห้ามเลี่ยงคำจนข้อเท็จจริงสำคัญหายไปจากเรื่อง
=== จบ SAFETY RULES ===`;

  const stripSampling = modelRejectsSampling(model);
  // ★ SPEED FIX (10 มิ.ย.): Opus 4.x default effort = "high" (คิดลึกสุดทุกครั้ง) → ช้าจน timeout
  //   งานเขียนที่ prompt ละเอียดอยู่แล้วใช้ "medium" = เร็วขึ้นมาก คุณภาพแทบไม่ต่าง
  //   ปรับได้ผ่าน .env: CLAUDE_WRITE_EFFORT=low|medium|high
  // ★ 15 ส.ค. 69: effort ต่อการเรียกชนะ env กลาง (ของเดิม: const writeEffort = process.env.CLAUDE_WRITE_EFFORT || 'medium';)
  const writeEffort = effort || process.env.CLAUDE_WRITE_EFFORT || 'medium';
  console.log(`[Claude] model=${model}, temp=${stripSampling ? 'n/a (opus4.7+)' : temperature}, effort=${stripSampling ? writeEffort : 'n/a'}, maxTokens=${maxTokens}`);
  // ★ Sol #3 + Fable (15 ส.ค. 69): กันกับระเบิด — เรียกด้วย promptBlocks ล้วนโดยไม่ส่ง prompt ต้องไม่พังที่ preview
  //   (ของเดิม: prompt.slice(0, 300) ตรงๆ = TypeError เมื่อ prompt เป็น undefined)
  const _blocksOk = Array.isArray(promptBlocks) && promptBlocks.length > 0 && promptBlocks.some(b => String(b?.text || '').trim());
  const _previewSrc = prompt || (_blocksOk ? promptBlocks.map(b => String(b?.text || '')).join('') : '');
  if (_fullLog()) console.log(`[Claude] 📜 PROMPT เต็ม (${String(_previewSrc).length}ch):
${String(_previewSrc)}
[Claude] 📜 จบ PROMPT`);
  else console.log(`[Claude] prompt preview: ${String(_previewSrc).slice(0, 300)}...`);

  // ★ 1 ส.ค. 69: opus-5/fable "คิดก่อนเขียน" เปิดเองอัตโนมัติ และช่วงคิดกิน max_tokens ร่วมกับเนื้อ
  //   → เผื่อเพดานขั้นต่ำ 16000 กันเนื้อโดนตัดกลางคัน (ยังอยู่ในโซน non-streaming ปลอดภัย)
  const _thinkingOn = /^claude-(opus-5|fable)/.test(model);
  const effMaxTokens = _thinkingOn ? Math.max(maxTokens, 16000) : maxTokens;

  const requestBody = {
    model,
    max_tokens: effMaxTokens,
    // ★ Opus 4.7/4.8/Fable: ห้ามส่ง temperature (API จะ 400) — คุมความหลากหลายผ่าน prompt แทน
    ...(stripSampling ? { output_config: { effort: writeEffort } } : { temperature }),
    system: systemMsg,
    // ★ 15 ส.ค. 69: promptBlocks = แตกพรอมต์เป็นก้อน + ติด cache_control ก้อนคงที่ (สารบัญการ์ด 201 ใบเหมือนกันทุกข่าว)
    //   ของเดิม (ยังใช้เมื่อไม่ส่ง promptBlocks): content: prompt + '\n\nตอบเป็น JSON เท่านั้น ห้ามมี text อื่นนอก JSON'
    messages: [
      {
        role: 'user',
        // ★ Sol #3 + รอบ 2: ใช้ blocks เฉพาะเมื่อมีเนื้อจริง — กรองก้อนเนื้อว่างทิ้งก่อน map (กัน text block ว่างหลุดไป API)
        content: _blocksOk
          ? (() => {
              const _fb = promptBlocks.filter(b => String(b?.text || '').trim());
              return _fb.map((b, i) => ({
                type: 'text',
                text: String(b.text || '') + (i === _fb.length - 1 ? '\n\nตอบเป็น JSON เท่านั้น ห้ามมี text อื่นนอก JSON' : ''),
                ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}),
              }));
            })()
          : String(prompt || '') + '\n\nตอบเป็น JSON เท่านั้น ห้ามมี text อื่นนอก JSON',
      }
    ],
  };

  // ★ 16 ก.ค. 69 (B4): รับ AbortSignal จาก withTimeoutSignal — timeout แล้วยกเลิก HTTP จริง ตัดจ่ายซ้อน
  const requestSignal = preparePipelineSignal(signal, `claude:${model}`, 15_000);
  const _reqOpts = requestSignal ? { signal: requestSignal } : undefined;
  let response;
  try {
    response = await client.messages.create(requestBody, _reqOpts);
  } catch (effortErr) {
    rethrowPipelineDeadline(effortErr, `claude:${model}`);
    // Defensive: SDK/รุ่น model ไม่รองรับ output_config → ลองใหม่แบบไม่ส่ง (ไม่ให้ pipeline ตายเพราะ param เดียว)
    if (requestBody.output_config && /output_config|effort/i.test(effortErr.message || '')) {
      console.warn('[Claude] ⚠️ output_config not supported — retrying without effort param');
      delete requestBody.output_config;
      response = await client.messages.create(requestBody, _reqOpts);
    } else {
      throw effortErr;
    }
  }

  // ★ 1 ส.ค. 69 (Sol รอบ 2): refusal อาจมาพร้อม partial content — ตัดสินจาก stop_reason ตรงๆ ก่อนแตะเนื้อ
  if (response.stop_reason === 'refusal') {
    console.warn(`[Claude] ⚠️ refusal (${response.stop_details?.category || 'n/a'}) — ส่งต่อตัวสำรองใน chain`);
    throw new Error('Claude ปฏิเสธคำขอ (refusal) — ใช้ตัวสำรอง');
  }

  // หา text block (กันกรณีมี thinking block นำหน้าใน model ใหม่ๆ)
  const content = response.content?.find?.(b => b.type === 'text')?.text || response.content?.[0]?.text;
  
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  // ★ 15 ส.ค. 69: โชว์แคชในลอค (cacheW=เขียนแคชครั้งแรก 1.25x · cacheR=อ่านแคช 0.1x) — เกณฑ์คานารี: มุม 2-3 ต้อง cacheR ≥9,000
  const _cw = response.usage?.cache_creation_input_tokens || 0;
  const _cr = response.usage?.cache_read_input_tokens || 0;
  console.log(`[Claude] OK: tokens input=${inputTokens}, output=${outputTokens}${(_cw || _cr) ? `, cacheW=${_cw}, cacheR=${_cr}` : ''}`);
  if (_fullLog()) console.log(`[Claude] 📄 คำตอบเต็ม (${String(content||'').length}ch):
${content}
[Claude] 📄 จบคำตอบ`);
  
  // Asynchronously log usage to DB
  // ★ Sol #2 + รอบ 2 (15 ส.ค. 69): input จริง = input + cache_creation + cache_read (เดิมนับแค่ input_tokens ทำ /cost ต่ำกว่าจริง)
  //   usageLogger คิดทุกโทเคนที่อัตรา input ปกติ → แปลงโทเคนแคชเป็น "เทียบเท่าอัตราปกติ" ก่อนส่ง (cacheW 1.25x · cacheR 0.1x)
  //   เงินตรงเป๊ะ ตัวเลขโทเคนคือค่าเทียบเท่า (จดใน comment นี้กันงงตอนอ่าน /cost)
  logApiUsage({
    provider: 'anthropic',
    model,
    inputTokens: Math.round(inputTokens + _cw * 1.25 + _cr * 0.1),
    outputTokens,
    feature: 'callClaude'
  });

  if (!content) throw new Error('Claude ไม่ส่งข้อมูลกลับ');

  // Parse JSON จาก response
  try {
    // ★ BUG FIX: Strip ```json ``` wrapper before parsing (Claude wraps JSON in code blocks)
    let jsonStr = content;
    jsonStr = jsonStr.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();
    // ★ 16 ก.ค. 69 (B1): แนบโมเดลจริงไปกับผล (non-enumerable — ไม่ปนใน JSON.stringify/spread เหมือน openai.js)
    const _parsed = sanitizeOutput(JSON.parse(jsonStr));
    if (_parsed && typeof _parsed === 'object') {
      try { Object.defineProperty(_parsed, '_modelUsed', { value: model, enumerable: false }); } catch {}
    }
    return _parsed;
  } catch (e) {
    // ลอง parse ตรงๆ โดยหา { } ครอบ
    try {
      const startIdx = content.indexOf('{');
      const endIdx = content.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        const _parsed2 = sanitizeOutput(JSON.parse(content.slice(startIdx, endIdx + 1)));
        if (_parsed2 && typeof _parsed2 === 'object') {
          try { Object.defineProperty(_parsed2, '_modelUsed', { value: model, enumerable: false }); } catch {}
        }
        return _parsed2;
      }
    } catch (e2) {}
    console.error('[Claude] JSON parse failed:', content.slice(0, 500));
    throw new Error('Claude ส่งข้อมูลที่ parse ไม่ได้');
  }
}

/**
 * เช็คว่า Claude พร้อมใช้งานหรือไม่
 */
export function isClaudeAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}
