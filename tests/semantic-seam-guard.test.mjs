// 🧵 ข้อสอบ Seam Guard ด่าน L4.6 (14 ส.ค. 69 — สเปก Sol 9.1/10 · เจ้าของสั่ง "ระมัดระวังที่สุด")
// โหลดซอร์สจริง ณ เวลารัน + แทน import AI ด้วย mock คุมผลได้ (globalThis.__L46_MOCK__)
// รัน: node tests/semantic-seam-guard.test.mjs
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

let src = readFileSync(new URL('../src/lib/correction/semanticSanityCheck.js', import.meta.url), 'utf8');
const stubs = [
  ["import { callAI } from '@/lib/ai/openai';", 'const callAI = async () => globalThis.__L46_MOCK__;'],
  ["import { MODEL_FAST } from '@/lib/ai/modelConfig';", "const MODEL_FAST = 'mock';"],
  ["import { callClaude, isClaudeAvailable } from '@/lib/ai/claudeClient'; // ★ 1 ส.ค. 69: ชั้นตัดสิน/ตัดประโยคจริง → opus-5 ก่อน",
    'const callClaude = async () => { if (globalThis.__L46_THROW__) throw new Error("mock-ai-down"); return globalThis.__L46_MOCK__; }; const isClaudeAvailable = () => !globalThis.__L46_THROW__;'],
];
for (const [from, to] of stubs) {
  if (!src.includes(from)) { console.log('❌ stub ไม่เจอ import:', from.slice(0, 50)); process.exit(1); }
  src = src.replace(from, to);
}
const tmpUrl = new URL('../src/lib/correction/_seam-under-test.tmp.mjs', import.meta.url);
writeFileSync(tmpUrl, src);
const { semanticSanityCheck } = await import(tmpUrl.href);
rmSync(tmpUrl);

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };
const mock = (issues) => { globalThis.__L46_THROW__ = false; globalThis.__L46_MOCK__ = { hasIssues: issues.length > 0, issues }; };

// เนื้อจำลอง 3 ย่อหน้า (โครงเดียวกับข่าวจริง)
const P1 = '"แม่คนที่สอง" คือคำที่เข้มใช้เรียกหนิง และมันไม่ได้เกิดจากการยืนหน้ากล้องด้วยกัน แต่มาจากมื้อข้าวที่กินด้วยกัน';
const P2 = 'ความสนิทค่อยๆ โตขึ้นจากการทำงานร่วมกัน วลีพังกลางเรื่องตรงนี้ ทั้งคู่คอยเตือนกันเรื่องสุขภาพ';
const P3 = 'ท้ายเรื่องพวกเขากลายเป็นครอบครัวเดียวกัน';
const DOC = `${P1}\n\n${P2}\n\n${P3}`;

// ── ① เคส #03995 replay: issue ท้ายเรื่องมาก่อน + issue เปิดเรื่องมาทีหลัง → ต้อง no-op ทั้งก้อน ไบต์เดิมเป๊ะ ──
{
  mock([
    { brokenText: 'วลีพังกลางเรื่องตรงนี้', reason: 'ทดสอบ', severity: 'medium' },
    { brokenText: 'คือคำที่เข้มใช้เรียกหนิง', reason: 'ทดสอบ', severity: 'high' },
  ]);
  const r = await semanticSanityCheck(DOC);
  t('1 issue แตะประโยคเปิด (แม้มาเป็นลำดับสอง) → คืน input ไบต์เดิมเป๊ะ', r.sanitizedContent === DOC && r.fixed === false);
  t('2 ธง OPENING_SEAM_GUARD ขึ้น (ตรวจย้อนได้)', r.error === 'OPENING_SEAM_GUARD');
}

// ── ② เคส #03997 shape: ลบอนุประโยคแรกของเรื่อง → ต้องถูกบล็อก ──
{
  mock([{ brokenText: '"แม่คนที่สอง" คือคำที่เข้มใช้เรียกหนิง', reason: 'ทดสอบ', severity: 'high' }]);
  const r = await semanticSanityCheck(DOC);
  t('3 ลบต้นประโยคเปิด → บล็อก คืนไบต์เดิม', r.sanitizedContent === DOC && r.error === 'OPENING_SEAM_GUARD');
}

// ── ③ ลบกลางย่อหน้าแบบรอยต่อสะอาด → ต้องลบได้ตามปกติ (ของเดิมต้องไม่เสีย) ──
{
  mock([{ brokenText: 'วลีพังกลางเรื่องตรงนี้ ', reason: 'ไร้ความหมาย', severity: 'medium' }]);
  const r = await semanticSanityCheck(DOC);
  t('4 ลบกลางย่อหน้ารอยต่อสะอาด → ลบสำเร็จ', r.fixed === true && !r.sanitizedContent.includes('วลีพังกลางเรื่องตรงนี้'));
  t('5 เนื้อรอบๆ ยังครบ (ประโยคก่อน-หลังไม่โดนหางเลข)', r.sanitizedContent.includes('โตขึ้นจากการทำงานร่วมกัน') && r.sanitizedContent.includes('คอยเตือนกันเรื่องสุขภาพ'));
}

// ── ④ ลบหัวย่อหน้าแล้วเหลือคำเชื่อมกำพร้า → ต้องยกเลิกการลบ (ไม่ใช่ลบคำเชื่อมเพิ่ม) ──
{
  const doc2 = `${P1}\n\nวลีพังหัวย่อหน้า แต่เรื่องราวยังดำเนินต่อไปตามปกติ\n\n${P3}`;
  mock([{ brokenText: 'วลีพังหัวย่อหน้า ', reason: 'ทดสอบ', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc2);
  t('6 ลบแล้วเหลือ "แต่" ค้างหัวย่อหน้า → ยกเลิกการลบ คืนไบต์เดิม', r.sanitizedContent === doc2 && r.fixed === false && r.error === 'UNSAFE_SEAM_GUARD');
}

// ── ⑤ กรณี "ก็" (Sol ระบุเสี่ยงสุด ห้ามตัด) ──
{
  const doc3 = `${P1}\n\nท่อนพังตรงนี้ ก็เลยกลายเป็นเรื่องราวที่ทุกคนพูดถึง\n\n${P3}`;
  mock([{ brokenText: 'ท่อนพังตรงนี้ ', reason: 'ทดสอบ', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc3);
  t('7 เหลือ "ก็" ค้างหัวย่อหน้า → ยกเลิกการลบ', r.sanitizedContent === doc3 && r.fixed === false);
}

// ── ⑥ ลบแล้วเครื่องหมายคำพูดเสียคู่ → ยกเลิก · ลบที่คู่ครบในตัว → ผ่าน ──
{
  const doc4 = `${P1}\n\nเขาพูดว่า "ประโยคนี้มีปัญหา และท่อนท้ายยังอยู่" ก่อนเดินจากไป\n\n${P3}`;
  mock([{ brokenText: '"ประโยคนี้มีปัญหา', reason: 'ทดสอบ', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc4);
  t('8 ลบครึ่งเดียวของคู่เครื่องหมาย → ยกเลิกการลบ', r.sanitizedContent === doc4 && r.fixed === false);
  const doc5 = `${P1}\n\nกลางเรื่องมีท่อน "พังทั้งคู่ครบ" อยู่ตรงนี้ และเรื่องดำเนินต่อ\n\n${P3}`;
  mock([{ brokenText: '"พังทั้งคู่ครบ" ', reason: 'ทดสอบ', severity: 'medium' }]);
  const r2 = await semanticSanityCheck(doc5);
  t('9 ลบท่อนที่เครื่องหมายครบคู่ในตัว → ลบได้ปกติ', r2.fixed === true && !r2.sanitizedContent.includes('พังทั้งคู่ครบ'));
}

// ── ⑦ byte parity: ไม่มีปัญหา / brokenText หาไม่เจอ / AI ล่ม → คืนไบต์เดิมเป๊ะแม้เนื้อมีช่องว่างแปลก ──
{
  const oddDoc = DOC + '   \n\n\n';
  mock([]);
  t('10 ไม่มีปัญหา → ไบต์เดิมเป๊ะ (ไม่โดน trim)', (await semanticSanityCheck(oddDoc)).sanitizedContent === oddDoc);
  mock([{ brokenText: 'ข้อความที่ไม่มีอยู่จริงในเนื้อ', reason: 'ทดสอบ', severity: 'medium' }]);
  t('11 brokenText หาไม่เจอ → ไบต์เดิมเป๊ะ (จุดที่เดิมเคย trim ทิ้ง)', (await semanticSanityCheck(oddDoc)).sanitizedContent === oddDoc);
  globalThis.__L46_THROW__ = true; globalThis.__L46_MOCK__ = null;
  const r = await semanticSanityCheck(oddDoc);
  t('12 AI ล่มทั้งสองชั้น → fail-safe คืนเนื้อเดิม ไม่พังท่อ', r.sanitizedContent === oddDoc && r.fixed === false);
}

// ── ⑧ ข้อ 13 (เงื่อนไขผู้ตรวจอิสระ · เจ้าของรับทราบ 14 ส.ค. ดึก): ล็อกพฤติกรรมเดิมของ cleanup ──
//    ลบทั้งย่อหน้ากลาง → เหลือ \n\n\n\n → cleanup เดิมยุบเป็นช่องว่างเดียว = ย่อหน้าหน้า-หลังถูกรวมบรรทัด
//    (พฤติกรรมนี้มีมาก่อน Seam Guard — จดเป็นข้อสอบกันเผลอเปลี่ยนโดยไม่รู้ตัว · จะแก้จริงต้องเปิดงานแยก)
{
  const doc6 = `${P1}\n\nย่อหน้ากลางที่พังทั้งก้อนแบบไม่มีอะไรเกี่ยวกับใคร\n\n${P3}`;
  mock([{ brokenText: 'ย่อหน้ากลางที่พังทั้งก้อนแบบไม่มีอะไรเกี่ยวกับใคร', reason: 'ทดสอบ', severity: 'medium' }]);
  const r = await semanticSanityCheck(doc6);
  t('13 ลบทั้งย่อหน้ากลาง → ย่อหน้ารอบข้างถูกรวมด้วยช่องว่าง (พฤติกรรมเดิม — ล็อกไว้ตรวจจับการเปลี่ยน)',
    r.fixed === true && r.sanitizedContent === `${P1} ${P3}`);
}

console.log(`\n${pass}/${pass + fail} ผ่าน${fail ? ' — ❌ ตก ' + fail + ' เคส ห้ามไปต่อ' : ' — ✅ ด่านข้อสอบผ่าน'}`);
process.exit(fail ? 1 : 0);
