// 🩺 ข้อสอบข้อยกเว้นศัพท์แพทย์ในด่านคำต้องห้าม (14 ส.ค. 69 — เจ้าของอนุมัติ · Sol รับรอง 9.1/10)
// ใช้กฎจริงผ่าน auditOutput ตรงๆ (เงื่อนไข Sol ข้อ 1: ห้าม copy regex มาเทสแยก)
// ไฟล์จริง import '@/lib/ai/openai' (alias ที่ node เปล่าไม่รู้จัก + ต้องมี AI จริง) →
// โหลด "ซอร์สจริง ณ เวลารัน" แล้วแทน import นั้นด้วยตัวล้มเสมอ = AI-failure mock ตาม Sol ข้อ 5 ไปในตัว
// (parity guard: อ่านจากไฟล์จริงทุกครั้ง regex ในไฟล์เปลี่ยน = ข้อสอบเห็นทันที)
// รัน: node tests/medical-term-whitelist.test.mjs
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const srcUrl = new URL('../src/lib/correction/outputAuditService.js', import.meta.url);
const stubbed = readFileSync(srcUrl, 'utf8').replace(
  "import { callAI } from '@/lib/ai/openai';",
  "const callAI = async () => { throw new Error('AI-mock-failure (ข้อสอบ)'); };"
);
if (stubbed.includes('@/lib/ai/openai')) { console.log('❌ stub import ไม่สำเร็จ — โครงไฟล์เปลี่ยน ต้องอัปเดตข้อสอบ'); process.exit(1); }
const tmpUrl = new URL('../src/lib/correction/_audit-under-test.tmp.mjs', import.meta.url);
writeFileSync(tmpUrl, stubbed);
const { auditOutput } = await import(tmpUrl.href);
rmSync(tmpUrl);

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name); } };

// ดึงเฉพาะ issue คำต้องห้ามที่ "ตัวแมช" มีคำว่า เลือด (กัน false-pass จากกฎอื่นในประโยคเทส)
const bloodIssues = async (content) =>
  (await auditOutput({ content })).issues.filter((i) => i.type === 'forbidden_word' && String(i.text).includes('เลือด'));

// ── ① Safe cases (Sol ข้อ 2): ศัพท์แพทย์ 10 แบบ ต้องไม่ถูกชี้เลย ──
const SAFE = ['โรคหลอดเลือดสมอง', 'โรคหลอดเลือดในสมอง', 'เส้นเลือดในสมอง', 'ลิ่มเลือด', 'เม็ดเลือด',
  'ฟอกเลือด', 'ความดันเลือด', 'แรงดันเลือด', 'ผลักดันเลือด', 'บริจาคเลือด'];
for (const w of SAFE) {
  const hits = await bloodIssues(`ผู้ป่วยมีอาการเกี่ยวกับ${w}และรักษาต่อเนื่อง`);
  t(`ศัพท์แพทย์รอด: "${w}"`, hits.length === 0);
}

// ── ② Lookahead เดิมต้องยังรอด (Sol ข้อ 3) ──
const AHEAD = ['เลือดดี', 'เลือดข้น', 'เลือดฝาด', 'เลือดจาง', 'เลือดผสม', 'เลือดกำเดา'];
for (const w of AHEAD) {
  const hits = await bloodIssues(`คนไข้มีภาวะ${w}ตามที่แพทย์ระบุ`);
  t(`lookahead เดิมรอด: "${w}"`, hits.length === 0);
}

// ── ③ Unsafe controls (Sol ข้อ 4): ของรุนแรงจริงต้องถูกชี้เหมือนเดิม ──
{
  t('คำเดี่ยว "เลือด" ยังถูกชี้', (await bloodIssues('พบเลือดบนพื้นถนน')).length >= 1);
  t('"เลือดไหลนองพื้น" ยังถูกชี้', (await bloodIssues('มีเลือดไหลนองพื้น')).length >= 1);
  const sad = await bloodIssues('ภาพเลือดสาดกระจาย');
  t('"เลือดสาด" ยังถูกชี้ และกฎ high-severity ยังทำงาน', sad.length >= 1 && sad.some((i) => i.severity === 'high'));
}

// ── ④ Deterministic replay (Sol ข้อ 5 — ระดับ code-path): fixture ข่าวจริงมี "โรคหลอดเลือดสมอง" ──
//    เมื่อ audit ไม่ชี้ issue ของ เลือด เลย → โซ่ safeCorrect (AI rewrite/direct replace) ไม่มีทางแตะคำนี้ได้
//    (การแทนคำเกิดจาก issue ที่ audit ชี้เท่านั้น — ไม่มีสแกนอิสระที่อื่น: ยืนยันโดย Sol grep แล้ว)
{
  const fixture = 'พระมหากิตติพงษ์ดูแลมารดาที่ป่วยติดเตียงจากโรคหลอดเลือดสมองมานานกว่า 2 ปี ' +
    'ทุก 2 ชั่วโมงจะป้อนอาหารเหลว เช็ดตัว และพลิกตัวให้ โดยมีเจ้าอาวาสช่วยเหลือเดือนละ 4,000 บาท';
  const hits = await bloodIssues(fixture);
  t('fixture ข่าวพระ: ไม่มี issue เลือดแม้แต่รายการเดียว = โซ่แก้คำแตะไม่ได้เลย', hits.length === 0);
}

console.log(`\n${pass}/${pass + fail} ผ่าน${fail ? ' — ❌ ตก ' + fail + ' เคส ห้ามไปต่อ' : ' — ✅ ด่านข้อสอบผ่าน'}`);
process.exit(fail ? 1 : 0);
