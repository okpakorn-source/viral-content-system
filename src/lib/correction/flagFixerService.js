/**
 * Flag Fixer — ผู้รับธงคุณภาพที่เคยถูกตรวจเจอแล้วปล่อยผ่าน (12 มิ.ย. 69)
 * ─────────────────────────────────────────────────────────────
 * ปัญหาเดิม: ชั้น Quality ตรวจเจอ (จบซ้ำคำต่อคำ / เลขหัวใจข่าวหาย / เปิดด้วยคำต้องห้าม)
 * แต่ทำได้แค่ log + ติดธง — ไม่มีชั้นไหนอ่านธงไปแก้ → หลุดถึงมือทีม (พิสูจน์: #00202, #00205)
 * และตั้งแต่เปลี่ยนเป็น 3 มุม × 1 เวอร์ชัน การเช็คจบซ้ำ "ภายใน call เดียว" มองไม่เห็นข้ามมุมอีกเลย
 *
 * ชั้นนี้รันใน correctionPipeline ที่เห็นทุกเวอร์ชันพร้อมกัน:
 * ① ตรวจใหม่จากของจริง (ไม่พึ่งธงเก่า): จบซ้ำข้ามเวอร์ชัน / เลขเด่นต้นฉบับหาย / เปิดเรื่องต้องห้าม
 * ② เวอร์ชันที่มีปัญหา → AI แก้เฉพาะจุด 1 ครั้ง (ไม่เจนใหม่ทั้งใบ — ประหยัดและคุมโทนเดิม)
 */

import { callAI } from '@/lib/ai/openai';

const MODEL_FIX = 'gpt-4o'; // ภาษาไทยลื่นพอ + เร็ว/ถูกกว่า write-tier

// ── ตรวจ: เลขเด่นพร้อมหน่วยจากต้นฉบับ (ตรรกะเดียวกับ extractKeyNumbers ฝั่ง summarize) ──
function keyNumbersOf(sourceText) {
  const s = String(sourceText || '');
  const found = [];
  const re = /(\d[\d,\.]*)\s*(บาท|ล้านบาท|แสนบาท|ล้าน|แสน|หมื่น|ปี|ไร่|กิโลเมตร|กม\.|คน|เดือน|วัน|%|เปอร์เซ็นต์|คัน|ทุน|แห่ง)/g;
  let m;
  while ((m = re.exec(s)) !== null && found.length < 8) {
    const num = m[1].replace(/[,\.]+$/, '');
    if (num.replace(/\D/g, '').length >= 2 || /ล้าน|แสน|หมื่น/.test(m[2])) found.push({ num, unit: m[2] });
  }
  return [...new Map(found.map(f => [f.num, f])).values()].slice(0, 3);
}

const norm = (str) => String(str || '').replace(/\s+/g, ' ').trim();

/**
 * ตรวจทุกเวอร์ชันพร้อมกัน → คืนรายการปัญหาต่อเวอร์ชัน { idx: ['dup_closing', 'missing_numbers', 'banned_opening'] }
 */
export function detectFlags(versions, sourceText) {
  const problems = versions.map(() => []);
  const contents = versions.map(v => norm(v.content || v.text || ''));

  // ① จบซ้ำ / เปิดซ้ำ / เนื้อท่อนกลางซ้ำ ข้ามเวอร์ชัน — ใบหลังถือว่าผิด (ใบแรกคือเจ้าของสำนวน)
  for (let i = 0; i < contents.length; i++) {
    for (let j = i + 1; j < contents.length; j++) {
      if (!contents[i] || !contents[j]) continue;
      if (contents[i].slice(-30) === contents[j].slice(-30)) problems[j].push('dup_closing');
      if (contents[i].slice(0, 30) === contents[j].slice(0, 30)) problems[j].push('dup_opening');
      // เนื้อกลางซ้ำ: หน้าต่าง 28 ตัวอักษรของใบแรกโผล่ในใบหลัง ≥3 จุด (เคส #00206 V3 ก๊อปท่อน V2)
      let dupWin = 0, sample = '';
      for (let p = 30; p + 28 <= contents[i].length && dupWin < 3; p += 14) {
        const win = contents[i].substr(p, 28);
        if (contents[j].includes(win)) { dupWin++; if (!sample) sample = win; }
      }
      if (dupWin >= 3) { problems[j].push('dup_body'); versions[j]._dupBodySample = sample; }
    }
  }

  // ② เลขหัวใจข่าวหาย (เช็คเฉพาะที่หายจากเวอร์ชันนั้นๆ)
  const keyNums = keyNumbersOf(sourceText);
  versions.forEach((v, i) => {
    const c = String(v.content || '');
    const missing = keyNums.filter(k => !c.includes(k.num));
    if (missing.length > 0 && keyNums.length > 0 && missing.length >= keyNums.length) {
      // หาย"ทุกตัว" เท่านั้นถึงสั่งแก้ — หายบางตัวอาจเป็นการเลือกมุมเล่าโดยตั้งใจ
      problems[i].push('missing_numbers');
      v._fixNumbers = missing.map(k => `${k.num} ${k.unit}`);
    }
  });

  // ③ เปิดเรื่องด้วยคำต้องห้าม + คำสั่งระบบรั่วลงเนื้อ (จับได้จริง: V2 ขึ้นต้น "เปิดด้วยความกดดัน..." = order leak)
  versions.forEach((v, i) => {
    if (/^(ลองนึก|ลองคิด|ลองจินตนาการ|วันที่ \d|เมื่อวันที่|เปิดด้วย|มุม(มอง)?\s*[:：]|แนวเปิด|สไตล์เปิด|เขียนย่อหน้า)/.test(String(v.content || '').trim())) {
      problems[i].push('banned_opening');
    }
  });

  return problems;
}

/**
 * ★ v3 (12 มิ.ย. — ลูปคุณภาพรอบ 1 จับได้): เวอร์ชันเปิด "ภาพ/มุมเดียวกัน" แม้ใช้คำต่างกัน
 * (เช่น ทุกเวอร์ชันเปิดด้วยรถ 31 คันจอดเรียง) — โปรแกรมเทียบตัวอักษรจับไม่ได้ ใช้ AI เช็คเชิงความหมาย 1 ครั้ง
 * เวอร์ชันแรกของกลุ่มถือเป็นเจ้าของมุม ที่เหลือถูกสั่งเขียนเปิดใหม่ด้วยมุมที่กำหนดให้
 */
async function detectSameAngleOpenings(versions) {
  if (versions.length < 2) return [];
  const opens = versions.map((v, i) => `${i + 1}: ${String(v.content || '').split('\n')[0].slice(0, 150)}`).join('\n');
  try {
    const raw = await callAI({
      model: 'gpt-4o-mini', temperature: 0.1, maxTokens: 800,
      prompt: `ประโยคเปิดของแต่ละเวอร์ชัน (ข่าวเดียวกัน เขียนคนละมุม):
${opens}

เวอร์ชันไหน "เปิดด้วยภาพ/มุม/จุดโฟกัสเดียวกัน" กับเวอร์ชันก่อนหน้า แม้ใช้คำต่างกัน? (เช่น ทุกอันเปิดด้วยภาพรถจอดเรียง = มุมเดียวกัน)
เวอร์ชันแรกของกลุ่มเป็นเจ้าของมุม — ระบุเฉพาะตัวที่ต้องเขียนใหม่ พร้อมมุมเปิดใหม่ที่ต่างจริง (อิงจากเนื้อที่เห็น)
ถ้าทุกเวอร์ชันเปิดต่างมุมกันดีแล้ว ตอบ {"rewrite":[]}
ตอบ JSON เท่านั้น: {"rewrite":[{"v":2,"newAngle":"เช่น เปิดด้วยคำพูดของผู้รับมอบ / เปิดด้วยปัญหาที่พื้นที่เจอก่อนได้รถ"}]}`,
    });
    const parsed = typeof raw === 'object' ? raw : JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] || '{}');
    return (parsed?.rewrite || []).filter(r => r.v >= 2 && r.v <= versions.length);
  } catch { return []; }
}

/**
 * แก้เวอร์ชันที่มีธง — 1 AI call ต่อเวอร์ชันที่มีปัญหาเท่านั้น
 */
export async function fixFlaggedVersions(versions, newsData) {
  const sourceText = newsData?.newsBody || '';
  const problems = detectFlags(versions, sourceText);

  // ★ เช็คเปิดมุมซ้ำเชิงความหมาย (ข้ามถ้าโปรแกรมจับเปิดซ้ำตรงตัวไปแล้ว — เดี๋ยวซ้ำซ้อน)
  const sameAngle = await detectSameAngleOpenings(versions);
  for (const r of sameAngle) {
    const idx = r.v - 1;
    if (!problems[idx].includes('dup_opening') && !problems[idx].includes('same_angle')) {
      problems[idx].push('same_angle');
      versions[idx]._newAngle = String(r.newAngle || '').slice(0, 120);
    }
  }

  const flaggedCount = problems.filter(p => p.length > 0).length;
  if (flaggedCount === 0) return { versions, fixed: 0 };

  const tasks = versions.map(async (v, i) => {
    if (problems[i].length === 0) return v;
    const content = String(v.content || '');
    const orders = [];
    if (problems[i].includes('dup_closing')) {
      const otherClosing = norm(versions.find((_, j) => j !== i)?.content || '').slice(-120);
      orders.push(`- ย่อหน้าปิดท้ายซ้ำกับเวอร์ชันอื่นคำต่อคำ → เขียนย่อหน้าปิดใหม่ให้ใจความต่างจริง (ห้ามคล้ายกับ: "...${otherClosing}")`);
    }
    if (problems[i].includes('dup_opening')) {
      orders.push('- ประโยคเปิดซ้ำกับเวอร์ชันอื่นคำต่อคำ → เขียนประโยคเปิดใหม่คนละแนว (อ่านเป็นธรรมชาติ ห้ามขึ้นต้นด้วยวันที่)');
    }
    if (problems[i].includes('same_angle')) {
      orders.push(`- เปิดเรื่องด้วยภาพ/มุมเดียวกับเวอร์ชันอื่น (แม้คำต่างกัน) → เขียนย่อหน้าเปิดใหม่โดยใช้มุมนี้: "${v._newAngle || 'มุมอื่นที่ต่างจริง'}" — เนื้อส่วนอื่นคงเดิม
  ⚠️ สำคัญ: นี่คือคำสั่งกำกับ ห้ามคัดลอกข้อความคำสั่งลงเนื้อโพสต์เด็ดขาด (ห้ามมีคำว่า "เปิดด้วย/มุม/แนวเปิด" ในประโยคแรก) — เขียนประโยคเปิดจริงที่คนอ่านเห็นเลย`);
    }
    if (problems[i].includes('dup_body')) {
      orders.push(`- มีท่อนเนื้อหากลางเรื่องซ้ำกับเวอร์ชันอื่นคำต่อคำ (เช่นท่อน "${String(v._dupBodySample || '').slice(0, 28)}...") → เล่าท่อนที่ซ้ำใหม่ด้วยคำของตัวเอง ข้อเท็จจริงเดิมครบ`);
    }
    if (problems[i].includes('missing_numbers')) {
      orders.push(`- ตัวเลขสำคัญของข่าวหายจากเนื้อ → เติม ${v._fixNumbers.join(', ')} กลับเข้าเนื้ออย่างเป็นธรรมชาติในจุดที่เหมาะสม (ห้ามแปลงค่า ห้ามปัดเศษ)`);
    }
    if (problems[i].includes('banned_opening')) {
      orders.push('- ประโยคเปิดผิดกฎ (ลองนึก/ขึ้นต้นด้วยวันที่) → เขียนประโยคเปิดใหม่: เปิดด้วยภาพเหตุการณ์ ตัวเลขสะดุดใจ หรือคำพูดคนในข่าว');
    }
    try {
      const result = await callAI({
        model: MODEL_FIX,
        temperature: 0.4,
        maxTokens: 3000,
        prompt: `นี่คือโพสต์ข่าวที่เขียนเสร็จแล้ว แก้เฉพาะจุดที่สั่งเท่านั้น — ส่วนอื่นต้องเหมือนเดิมทุกตัวอักษร
ห้ามเพิ่ม/ลดข้อเท็จจริง ห้ามเปลี่ยนโทน ความยาวใกล้เคียงเดิม

จุดที่ต้องแก้:
${orders.join('\n')}

=== โพสต์ ===
${content}
=== จบ ===

ตอบ JSON เท่านั้น (callAI ของระบบรับเฉพาะ JSON): {"fixedContent":"เนื้อโพสต์ฉบับแก้แล้วทั้งหมด"}`,
      });
      // callAI คืน object เสมอ (json_object mode) — ดึง field ออกมา (เผื่อ string ไว้กัน client เปลี่ยน)
      const fixed = String((typeof result === 'object' ? result?.fixedContent : result) || '').trim();
      const orderLeak = /^(เปิดด้วย|มุม(มอง)?\s*[:：]|แนวเปิด|สไตล์เปิด|เขียนย่อหน้า)/.test(fixed);
      if (fixed && !orderLeak && fixed.length > content.length * 0.6 && fixed.length < content.length * 1.5) {
        console.log(`[FlagFixer] ✅ V${i + 1} แก้: ${problems[i].join('+')}`);
        return { ...v, content: fixed, _flagsFixed: problems[i] };
      }
      console.log(`[FlagFixer] ⚠️ V${i + 1} ผลแก้ผิดรูป — คงของเดิม`);
      return v;
    } catch (e) {
      console.log(`[FlagFixer] ⚠️ V${i + 1} แก้ไม่สำเร็จ (${e.message?.slice(0, 40)}) — คงของเดิม`);
      return v;
    }
  });

  const settled = await Promise.allSettled(tasks);
  const out = settled.map((r, i) => (r.status === 'fulfilled' ? r.value : versions[i]));
  return { versions: out, fixed: out.filter(v => v._flagsFixed).length };
}
