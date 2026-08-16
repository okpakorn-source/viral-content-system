/**
 * ด่านจับของเกิน (Fabrication Gate) — ★ 4 ส.ค. 69
 *
 * จับ "ข้อเท็จจริงที่ตัวเขียนเติมเอง" (อาชีพ/แรงจูงใจ/ตัวเลข/เหตุการณ์/ฉาก) เทียบข่าวต้นฉบับ
 * แล้วผ่าออกแบบศัลยกรรม — มาจากผลทดลอง 3-4 ส.ค. (แซนด์บ็อกซ์ 10 ข่าว + ศึกตาบอด 6 นักเขียน):
 * ของเกินยืนยันจริง 9 จุด → 0 หลังผ่านด่าน โดยเนื้อส่วนอื่นไม่ถูกแตะ
 *
 * 4 ขั้น (ยืนยัน 2 ชั้นก่อนตัด — กันจับผิดของจริง เคส "เกาะไหหลำ" ในเทสรอบแรก):
 *   1. luna ชี้ผู้ต้องสงสัย
 *   2. โค้ดทวนคำ: คำเนื้อหาของประโยคนั้นมีในต้นฉบับ ≥60% = ยกฟ้อง (ฟรี ไม่ใช้ AI)
 *   3. luna ทวนซ้ำเฉพาะที่รอด (รวมกรณีเขียนคนละสำนวนความหมายเดียวกัน)
 *   4. ตัวเขียนหลัก (callClaude) ตัดเฉพาะที่ยืนยันแล้ว โดยเห็นต้นฉบับประกอบ
 *      แล้วผ่านเกราะเฉพาะด่าน — เลขจริง (มีทั้งในบทความและต้นฉบับ) ต้องอยู่ครบ + หดไม่เกิน 45%
 *      ไม่ผ่าน = ย้อนกลับเนื้อเดิม (เลขที่นักเขียนแต่งเพิ่มเอง อนุญาตให้หายไปกับการผ่า)
 *
 * กติกาความปลอดภัย: ล้มขั้นไหน = ปล่อยเนื้อเดิมผ่าน (fail-open) ห้ามทำท่อพัง
 *
 * 🔴 สถานะ 16 ส.ค. 69 — เจ้าของสั่ง "ตัวผ่าปิดเลย ไม่ใช้" (ถาวร ไม่ใช่ปิดชั่วคราว)
 *    ⇒ ค่าเริ่มต้น "ปิด" อยู่ในโค้ด **ไม่พึ่ง env เลย** · เปิดคืน: FAB_GATE=1
 *    ทำไมไม่ใช้วิธี "ตั้ง FAB_GATE=0 บน Vercel" อย่างเดียว (ผู้ตรวจ 2 ทีมชี้ตรงกัน):
 *      · ตั้ง env แล้วต้อง redeploy ด้วย ถ้าลืม = ตัวผ่ายังกินเนื้อข่าวต่อโดยไม่มีใครรู้
 *      · ค่าบน Vercel ตั้งเป็น Sensitive → อ่านย้อนไม่ได้ ตรวจสอบไม่ได้ว่าตั้งถูกไหม
 *      · ถ้าใครเผลอลบ env ทิ้ง ตัวผ่าจะกลับมาทำงานเงียบๆ
 *    ⇒ ให้ "ปิด" เป็นค่าตั้งต้นของโค้ด = ปิดเหมือนกันทุกที่ (Vercel/เครื่องทีม/เครื่องพัฒนา) โดยไม่ต้องตั้งอะไร
 */

import { callAI } from '@/lib/ai/openai';
import { callClaude, isClaudeAvailable } from '@/lib/ai/claudeClient';
import { MODEL_FAST_CHEAP } from '@/lib/ai/modelConfig';

// system prompt สั้น — กัน callClaude/callAI ยัดกฎเขียนข่าวก้อนใหญ่ที่ไม่เกี่ยวกับงานตรวจ (บทเรียน Opus NOTE-6)
const GATE_CHECK_SYS = 'คุณคือผู้ตรวจข้อเท็จจริงของกองบรรณาธิการ เทียบบทความกับต้นฉบับอย่างเข้มงวด ตอบเป็น JSON เท่านั้น';
const GATE_FIX_SYS = 'คุณคือบรรณาธิการแก้บทความแบบศัลยกรรม แก้เฉพาะจุดที่สั่ง ห้ามแตะส่วนอื่น ตอบเป็น JSON เท่านั้น';

// 🔴 16 ส.ค. 69: ตัวตัดสินว่าด่านนี้เปิดหรือปิด — **ปิดเป็นค่าตั้งต้น** เปิดได้ทางเดียวคือตั้ง FAB_GATE เป็นค่าเปิด
//   ทางเปิดคืนต้องทนรูปแบบค่าทุกแบบ ไม่งั้นวันหน้าตั้ง FAB_GATE="1" ผ่าน `vercel env add` (ที่ติดอัญประกาศมา)
//   แล้วปลุกไม่ขึ้น = ด่านนี้กลายเป็นโค้ดตายจริงๆ ปลุกไม่ได้อีกเลย
//   ⚠️ ตำแหน่งวางสำคัญ: ต้องอยู่ "ใต้ GATE_FIX_SYS" เพราะ tests/fabrication-gate-fail-open.test.mjs
//      ตัดซอร์สด้วย indexOf('const GATE_CHECK_SYS') แล้วโยนเข้า new Function — วางเหนือบรรทัดนั้นจะถูกตัดทิ้ง
function isFabGateEnabled() {
  const raw = String(process.env.FAB_GATE ?? '').trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase();
  return raw === '1' || raw === 'on' || raw === 'true' || raw === 'yes';
}

// ขั้น 2: ทวนด้วยโค้ด — คำเนื้อหา (ยาว ≥3 ตัวอักษร) ของข้อความผู้ต้องสงสัย โผล่ในต้นฉบับ ≥60% = น่าจะมีจริง
function codeVerifyInSource(source, claim) {
  const clean = (s) => String(s).replace(/[\s"'“”‘’,.!?()\[\]]+/g, ' ');
  const src = clean(source);
  const words = clean(claim).split(' ').filter((w) => w.length >= 3);
  if (words.length === 0) return false;
  const hit = words.filter((w) => src.includes(w)).length;
  return hit / words.length >= 0.6; // true = มีในต้นฉบับ → ยกฟ้อง
}

/**
 * ตรวจ+ผ่าของเกินจากเนื้อ 1 เวอร์ชัน เทียบกับข่าวต้นฉบับ
 * @param {string} content - เนื้อจากตัวเขียน
 * @param {string} newsBody - ข่าวต้นฉบับ (ความจริงอ้างอิง)
 * @param {string|null} researchFacts - ★ 14 ส.ค. 69: ข้อเท็จจริงรีเสิร์ชที่ยืนยันแล้ว (ฐานความจริงเสริม —
 *   เดิมด่านเห็นแค่ต้นฉบับ ข้อมูลรีเสิร์ชถูกต้องเลยโดนตัดเป็น "ของเกิน" = ฆ่าการพัฒนาเรื่องแบบยุค 2 เดือน)
 * @returns {{ content: string, debug: object }} เนื้อหลังด่าน + บันทึกการตรวจ (fail-open เสมอ)
 */
export async function fabricationGate(content, newsBody, researchFacts = null) {
  const debug = { checked: false, sus: 0, confirmed: 0, fixed: false };
  if (!isFabGateEnabled()) {
    console.log('  [FabGate] ⏭️ ปิดอยู่ตามคำสั่งเจ้าของ (ค่าตั้งต้นในโค้ด=ปิด · เปิดคืนด้วย FAB_GATE=1) — ปล่อยเนื้อเดิมผ่าน');
    // ป้ายเหตุผล: ใช้ 'FAB_GATE_OFF' ไม่ใช่ 'FAB_GATE=0' เดิม
    //   เพราะตั้งแต่ 16 ส.ค. 69 การข้ามด่านมาจาก "ค่าตั้งต้นในโค้ด" ไม่ใช่ "มีคนตั้ง env = 0"
    //   ถ้ายังเขียน FAB_GATE=0 คนรุ่นหลังจะไปตามหา env ที่ไม่มีอยู่จริงแล้วสรุปผิด
    //   (ค้นย้อนหลังยังหาเจอทั้งของเก่าและใหม่ด้วยคำว่า "FAB_GATE" — ข้อมูลเก่าใน job_queue ไม่หาย)
    return { content, debug: { ...debug, skipped: 'FAB_GATE_OFF' } };
  }
  // ★ ผู้ตรวจ #2: แคปต้นฉบับก่อนต่อ facts — ไม่งั้น facts อยู่ท้ายแล้วถูก slice ของพรอมต์ตัดทิ้งเงียบๆ (no-op)
  const source = String(newsBody || '').slice(0, 5000)
    + (researchFacts ? '\n\n[ข้อเท็จจริงจากการรีเสิร์ชที่ยืนยันแล้ว — ถือเป็นความจริงอ้างอิงเช่นกัน]\n' + String(researchFacts).slice(0, 2500) : '');
  debug.researchFactsLen = researchFacts ? String(researchFacts).length : 0; // ★ ผู้ตรวจ #3: ย้อนสอบได้
  // ต้นฉบับสั้นเกิน = ไม่มีความจริงพอให้เทียบ (เช่นเทสยิงตรงไม่มี body) — ข้ามอย่างเงียบ
  if (source.length < 80 || !content || String(content).length < 100) {
    return { content, debug: { ...debug, skipped: 'no-source-or-short' } };
  }

  try {
    // === ขั้น 1: luna ชี้ผู้ต้องสงสัย ===
    const flagRes = await callAI({
      model: MODEL_FAST_CHEAP,
      temperature: 0.1,
      maxTokens: 3000,
      systemPrompt: GATE_CHECK_SYS,
      // ★ ถ้อยคำชุดนี้ = เวอร์ชันที่พิสูจน์ในแซนด์บ็อกซ์เป๊ะ (ยืนยัน 1-3 จุด/เคส) — ห้ามเติม "ฉาก" เข้ารายการจับ
      //   (เทสจริง 4 ส.ค.: เติมคำว่า ฉาก แล้วด่านไล่จับสำนวนแต่งถึง 10 จุด/เวอร์ชัน จนการผ่าใหญ่เกินเกราะ)
      prompt:
        'เทียบบทความกับต้นฉบับ ชี้ทุกข้อความที่เป็น "ของเกิน" — ข้อเท็จจริง/อาชีพ/แรงจูงใจ/ตัวเลข/เหตุการณ์ที่ต้นฉบับไม่มี\n' +
        'สำนวนแต่ง/ภาพเปรียบ/การเรียบเรียงใหม่จากข้อเท็จจริงเดิม ไม่นับเป็นของเกิน\n' +
        `=== ต้นฉบับ ===\n${source.slice(0, 8000)}\n=== บทความ ===\n${content}\n=== จบ ===\n` +
        'ตอบ JSON: {"fabrications":["ข้อความของเกินที่พบ", ...]} — ไม่พบให้ตอบ {"fabrications":[]}',
    });
    debug.checked = true;
    const sus = Array.isArray(flagRes?.fabrications) ? flagRes.fabrications.filter((x) => typeof x === 'string' && x.trim()) : [];
    debug.sus = sus.length;
    if (sus.length === 0) return { content, debug };

    // === ขั้น 2: โค้ดทวน — ยกฟ้องข้อที่มีในต้นฉบับจริง ===
    const survived = sus.filter((f) => !codeVerifyInSource(source, f));
    if (survived.length === 0) return { content, debug };

    // === ขั้น 3: luna ทวนซ้ำ (ยืนยันชั้นสอง) ===
    let confirmed;
    try {
      const reRes = await callAI({
        model: MODEL_FAST_CHEAP,
        temperature: 0.1,
        maxTokens: 2000,
        systemPrompt: GATE_CHECK_SYS,
        prompt:
          'ทวนอีกครั้งอย่างเข้มงวด: รายการต่อไปนี้ ข้อไหน "มีระบุในต้นฉบับจริง" (รวมการเขียนคนละสำนวนแต่ความหมายเดียวกัน) ให้ตัดออกจากรายการ เหลือเฉพาะของเกินแท้\n' +
          `=== ต้นฉบับ ===\n${source.slice(0, 8000)}\n=== รายการ ===\n${survived.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n` +
          'ตอบ JSON: {"confirmed":["..."]}',
      });
      if (!Array.isArray(reRes?.confirmed)) {
        debug.fixSkipped = 'confirmation-invalid-response';
        console.warn('  [FabGate] ทวนซ้ำตอบรูปแบบไม่ถูกต้อง — ปล่อยเนื้อเดิมผ่าน (fail-open)');
        return { content, debug };
      }
      confirmed = reRes.confirmed.filter((x) => typeof x === 'string' && x.trim());
    } catch (reErr) {
      debug.fixSkipped = 'confirmation-failed';
      console.warn(`  [FabGate] ทวนซ้ำล้ม (${String(reErr?.message || reErr).slice(0, 200)}) — ปล่อยเนื้อเดิมผ่าน (fail-open)`);
      return { content, debug };
    }
    confirmed = confirmed.slice(0, 10); // เพดานกันด่านเพี้ยนไล่ตัดทั้งเรื่อง
    debug.confirmed = confirmed.length;
    if (confirmed.length === 0) return { content, debug };

    // === ขั้น 4: ตัวเขียนหลักผ่าเฉพาะจุด (เห็นต้นฉบับประกอบ) ===
    if (!isClaudeAvailable()) {
      debug.fixSkipped = 'no-claude-key';
      console.warn('  [FabGate] ยืนยันของเกินแล้วแต่ไม่มี ANTHROPIC_API_KEY — ปล่อยเนื้อเดิมผ่าน');
      return { content, debug };
    }
    // ★ 15 ส.ค. 69 (เจ้าของเคาะหลังศึกหมอผ่าตัด 8 โมเดล × 2 รอบ ด้วยโจทย์เดียวกันเป๊ะ): ระบุตัวผ่า = claude-opus-5
    //   เดิมไม่ระบุ model → ตกไปใช้ DEFAULT_WRITE_MODEL (claude-opus-4-8) ซึ่ง "ตัดแล้วไม่เย็บแผล"
    //   อาการจริงบนโปรดักชัน: ตัดท่อนกลางประโยคออกแล้วปล่อยประโยคขาดประธาน
    //     เคส 04119 (20:41) "ของหญิงวัย 40 ปีคนหนึ่ง กลายเป็นเช้าที่กลางถนน เธอ ก่อนถึงสี่แยก..."
    //     เคสข่าวแพท "ก่อนจะตอบตัวเองได้ว่าพร้อมมีลูกคนที่สองไหม แต่เพราะกลัวว่า..."
    //   หลักฐานเทส (_hits-formula-workspace/surgeon-results.json · ทุกตัวตัดของเกินครบ 4/4 ย่อหน้าครบ 3/3):
    //     opus-4.8    🔴 ขาดประธาน 2/2 รอบ (958 อักษร = ตรงกับที่หลุดออกโปรดักชันเป๊ะ) ฿1.20
    //     sonnet-5    🔴 2/2 · grok-4.6 🔴 2/2 · deepseek-v4-pro ไม่นิ่ง (ดี 1 พัง 1)
    //     opus-5      ✅ 2/2 เย็บด้วยคำจากต้นฉบับ ("แพท ณปภา เคยลังเล") ฿2.05 · 18 วิ  ← เลือกตัวนี้
    //     gemini-flash ✅ 2/2 ฿1.53 · glm-5.2 ✅ 2/2 แต่เวลาแกว่ง 35-135 วิ · fable-5 ✅ 2/2 แต่ ฿5.27
    //   เหตุผลที่เลือก opus-5: เย็บแผลนิ่ง 2/2 · เร็วสุดในกลุ่มที่ทำได้ · ระบบใช้รุ่นนี้อยู่แล้วที่ด่าน L4.6 (ไม่เพิ่มค่ายใหม่)
    //   ต้นทุน +~฿0.85/ครั้ง = +~฿1.7/ข่าว (2 เวอร์ชัน) จากค่าทำข่าวทั้งใบ ~฿46 · จ่ายเฉพาะข่าวที่เจอของเกินจริง
    //   ถอยกลับ: FAB_GATE_FIX_MODEL=claude-opus-4-8
    const fixRes = await callClaude({
      model: (process.env.FAB_GATE_FIX_MODEL || 'claude-opus-5').trim().replace(/^["']|["']$/g, ''),
      maxTokens: 4000,
      systemPrompt: GATE_FIX_SYS,
      prompt:
        'แก้บทความแบบศัลยกรรม: ลบ/แก้เฉพาะข้อความ "ของเกิน" ที่ยืนยันแล้วว่าต้นฉบับไม่มี ตามรายการนี้ — ห้ามแตะประโยคอื่น ห้ามลบสิ่งที่ต้นฉบับมีจริง และรักษาจำนวนย่อหน้าเดิม (คั่นด้วย \\n\\n)\n' +
        `ของเกิน:\n${confirmed.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n` +
        `=== ต้นฉบับ (ไว้ทวน) ===\n${source.slice(0, 8000)}\n=== บทความ ===\n${content}\n=== จบ ===\n` +
        'ตอบ JSON: {"content":"บทความฉบับแก้"}',
    });
    const fixedContent = typeof fixRes?.content === 'string' ? fixRes.content.trim() : '';
    if (!fixedContent || fixedContent.length < 100) {
      debug.fixSkipped = 'empty-fix';
      return { content, debug };
    }

    // เกราะเฉพาะด่าน (ไม่ใช้ guardCoreNews — ตัวนั้นเทียบกับฉบับนักเขียนซึ่งมีของเกินปนอยู่:
    //   เลขที่นักเขียนแต่งเองจะถูกบังคับเก็บ และเพดานหด 25% ตีกลับการผ่าที่ชอบธรรมบนข่าวสั้น)
    //   (ก) เลขที่มีทั้งในบทความและในต้นฉบับจริง = แก่นข่าว ต้องอยู่ครบหลังผ่า — เลขที่แต่งเพิ่มลบได้
    const numsOf = (s) => new Set((String(s).match(/\d[\d,\.]*/g) || []).map((n) => n.replace(/[,\.]+$/, '').replace(/,/g, '')));
    const srcNums = numsOf(source);
    const coreNums = [...numsOf(content)].filter((n) => srcNums.has(n));
    const fixedNums = numsOf(fixedContent);
    const missingNums = coreNums.filter((n) => !fixedNums.has(n));
    if (missingNums.length > 0) {
      debug.fixSkipped = `เลขจริงหาย:${missingNums.join(',')}`;
      console.warn(`  [FabGate] ⛔ ผ่าแล้วเลขจริงหาย (${missingNums.join(', ')}) — ย้อนเนื้อเดิม`);
      return { content, debug };
    }
    //   (ข) เพดานหด 45% — การผ่าของเกินหดเนื้อได้มากกว่างานขัดเกลา แต่หดเกินครึ่ง = ด่านเพี้ยน
    if (fixedContent.length < String(content).length * 0.55) {
      const shrink = Math.round((1 - fixedContent.length / String(content).length) * 100);
      debug.fixSkipped = `เนื้อหด ${shrink}% (เพดานด่าน 45%)`;
      console.warn(`  [FabGate] ⛔ ผ่าแล้ว${debug.fixSkipped} — ย้อนเนื้อเดิม`);
      return { content, debug };
    }
    debug.fixed = true;
    console.log(`  [FabGate] ✂️ ผ่าของเกิน ${confirmed.length} จุด (สงสัย ${debug.sus})`);
    return { content: fixedContent, debug };
  } catch (err) {
    // fail-open: ด่านล้ม = ปล่อยเนื้อเดิมผ่าน ห้ามทำท่อพัง
    console.warn(`  [FabGate] SKIPPED (${err.message})`);
    return { content, debug: { ...debug, error: err.message } };
  }
}
