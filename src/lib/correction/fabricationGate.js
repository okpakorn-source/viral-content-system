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
 *      แล้วผ่านเกราะแก่นข่าว (guardCoreNews) — แก้แล้วแก่นเสีย = ย้อนกลับเนื้อเดิม
 *
 * กติกาความปลอดภัย: ล้มขั้นไหน = ปล่อยเนื้อเดิมผ่าน (fail-open) ห้ามทำท่อพัง
 * ปิดได้: FAB_GATE=0
 */

import { callAI } from '@/lib/ai/openai';
import { callClaude, isClaudeAvailable } from '@/lib/ai/claudeClient';
import { MODEL_FAST_CHEAP } from '@/lib/ai/modelConfig';
import { guardCoreNews } from './safeCorrectionService';

// system prompt สั้น — กัน callClaude/callAI ยัดกฎเขียนข่าวก้อนใหญ่ที่ไม่เกี่ยวกับงานตรวจ (บทเรียน Opus NOTE-6)
const GATE_CHECK_SYS = 'คุณคือผู้ตรวจข้อเท็จจริงของกองบรรณาธิการ เทียบบทความกับต้นฉบับอย่างเข้มงวด ตอบเป็น JSON เท่านั้น';
const GATE_FIX_SYS = 'คุณคือบรรณาธิการแก้บทความแบบศัลยกรรม แก้เฉพาะจุดที่สั่ง ห้ามแตะส่วนอื่น ตอบเป็น JSON เท่านั้น';

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
 * @returns {{ content: string, debug: object }} เนื้อหลังด่าน + บันทึกการตรวจ (fail-open เสมอ)
 */
export async function fabricationGate(content, newsBody) {
  const debug = { checked: false, sus: 0, confirmed: 0, fixed: false };
  if (process.env.FAB_GATE === '0') return { content, debug: { ...debug, skipped: 'FAB_GATE=0' } };
  const source = String(newsBody || '');
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
      prompt:
        'เทียบบทความกับต้นฉบับ ชี้ทุกข้อความที่เป็น "ของเกิน" — ข้อเท็จจริง/อาชีพ/แรงจูงใจ/ตัวเลข/เหตุการณ์/ฉาก (เวลา สถานที่ การกระทำ) ที่ต้นฉบับไม่มี\n' +
        'สำนวนแต่ง/ภาพเปรียบ/การเรียบเรียงใหม่จากข้อเท็จจริงเดิม ไม่นับเป็นของเกิน\n' +
        `=== ต้นฉบับ ===\n${source.slice(0, 6000)}\n=== บทความ ===\n${content}\n=== จบ ===\n` +
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
    let confirmed = survived;
    try {
      const reRes = await callAI({
        model: MODEL_FAST_CHEAP,
        temperature: 0.1,
        maxTokens: 2000,
        systemPrompt: GATE_CHECK_SYS,
        prompt:
          'ทวนอีกครั้งอย่างเข้มงวด: รายการต่อไปนี้ ข้อไหน "มีระบุในต้นฉบับจริง" (รวมการเขียนคนละสำนวนแต่ความหมายเดียวกัน) ให้ตัดออกจากรายการ เหลือเฉพาะของเกินแท้\n' +
          `=== ต้นฉบับ ===\n${source.slice(0, 6000)}\n=== รายการ ===\n${survived.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n` +
          'ตอบ JSON: {"confirmed":["..."]}',
      });
      if (Array.isArray(reRes?.confirmed)) confirmed = reRes.confirmed.filter((x) => typeof x === 'string' && x.trim());
    } catch (reErr) {
      console.warn(`  [FabGate] ทวนซ้ำล้ม (${reErr.message}) — ใช้ผลขั้น 2 ต่อ`);
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
    const fixRes = await callClaude({
      maxTokens: 4000,
      systemPrompt: GATE_FIX_SYS,
      prompt:
        'แก้บทความแบบศัลยกรรม: ลบ/แก้เฉพาะข้อความ "ของเกิน" ที่ยืนยันแล้วว่าต้นฉบับไม่มี ตามรายการนี้ — ห้ามแตะประโยคอื่น ห้ามลบสิ่งที่ต้นฉบับมีจริง และรักษาจำนวนย่อหน้าเดิม (คั่นด้วย \\n\\n)\n' +
        `ของเกิน:\n${confirmed.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n` +
        `=== ต้นฉบับ (ไว้ทวน) ===\n${source.slice(0, 6000)}\n=== บทความ ===\n${content}\n=== จบ ===\n` +
        'ตอบ JSON: {"content":"บทความฉบับแก้"}',
    });
    const fixedContent = typeof fixRes?.content === 'string' ? fixRes.content.trim() : '';
    if (!fixedContent || fixedContent.length < 100) {
      debug.fixSkipped = 'empty-fix';
      return { content, debug };
    }

    // เกราะแก่นข่าว: การผ่าต้องไม่ทำเลขเด่นหาย/เนื้อหดเกินเพดาน — ไม่ผ่าน = ย้อนเนื้อเดิม
    const guard = guardCoreNews(content, fixedContent);
    if (!guard.ok) {
      debug.fixSkipped = `core-guard:${guard.reason}`;
      console.warn(`  [FabGate] ⛔ เกราะแก่นข่าวหลังผ่า: ${guard.reason} — ย้อนเนื้อเดิม`);
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
