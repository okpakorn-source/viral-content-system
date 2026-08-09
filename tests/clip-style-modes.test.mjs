// ★ 8 ส.ค. 69 — เทสยามชุด "สไตล์กรอบเทา+เขียว" (CLIP_V2_STYLE / CLIP_STYLE_DIRECT)
//   คุม: (1) สวิตช์ปิด = รุ่น/พรอมต์เดิมเป๊ะ (2) ac = แนบ altPolished ไม่แทนที่ (3) ตัวขัดเกลาใช้ luna ไม่ใช่ callGemini
//   (4) ด่านกลไกขัดเกลาครบ (5) กติกาเงียบ+ตัวอย่างโครงสร้างห้ามหาย
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';

// hook resolve '@/...' + ปลอมตัวเรียก AI (แบบเดียวกับ clip-flags-off — ห้ามยิงจริง)
const SRC_ROOT = new URL('../src/', import.meta.url).href;
const mod = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const STUB = mod(`export async function callAI(){throw new Error('FORBIDDEN');}
export async function callGeminiVideo(){return {};}
export async function callGeminiVideoFile(){return {};}
export const MODEL_FAST='t'; export const MODEL_NEWS_ANALYSIS='t';`);
const hook = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/ai/openai' || specifier === '@/lib/ai/modelConfig' || specifier === '@/lib/ai/geminiClient') return { url: ${JSON.stringify(STUB)}, shortCircuit: true };
  if (specifier.startsWith('@/')) {
    const suffix = specifier.slice(2) + (specifier.endsWith('.js') || specifier.endsWith('.mjs') ? '' : '.js');
    return nextResolve(new URL(suffix, ${JSON.stringify(SRC_ROOT)}).href, context);
  }
  return nextResolve(specifier, context);
}`;
register(mod(hook));

const RAW_SRC = await readFile(new URL('../src/lib/services/clipRawStoryService.js', import.meta.url), 'utf8');
const INS_SRC = await readFile(new URL('../src/lib/services/clipInsightService.js', import.meta.url), 'utf8');

const SW = ['CLIP_V2_STYLE', 'CLIP_STYLE_DIRECT', 'CLIP_V2_QUOTES', 'CLIP_PROMPT_0804', 'CLIP_SOURCE_META', 'CLIP_QC_GATES'];
const saved = {};
for (const k of SW) { saved[k] = process.env[k]; delete process.env[k]; }
const restore = () => { for (const k of SW) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
process.on('exit', restore);

const raw = await import('../src/lib/services/clipRawStoryService.js');
const ins = await import('../src/lib/services/clipInsightService.js');

test('สวิตช์ปิดทั้งหมด: promptRev สองฝั่งเป็นค่าเดิมเป๊ะ ไม่มี style/direct ต่อท้าย', () => {
  for (const k of SW) delete process.env[k];
  assert.equal(raw.normalizeRawStory({ rawStory: 'x' }).promptRev, 'rawstory-v2-0803');
  assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801');
});

test('CLIP_V2_STYLE ค่าแปลก (x/A ตัวใหญ่ไม่ใช่ปัญหา/ว่าง) ต้องเท่ากับปิด', () => {
  for (const k of SW) delete process.env[k];
  for (const v of ['x', 'abc', '1', 'AC ', '']) {
    process.env.CLIP_V2_STYLE = v;
    const rev = raw.normalizeRawStory({ rawStory: 'x' }).promptRev;
    if (v.trim().toLowerCase() === 'ac') continue; // 'AC ' มีช่องว่าง — ไม่นับ ต้องเท่าปิด
    assert.equal(rev, 'rawstory-v2-0803', `ค่า "${v}" ต้องเท่ากับปิด`);
  }
  delete process.env.CLIP_V2_STYLE;
});

test('เปิด CLIP_V2_STYLE=ac / CLIP_STYLE_DIRECT=1: ป้ายรุ่นต่อท้ายถูกฝั่ง', () => {
  for (const k of SW) delete process.env[k];
  process.env.CLIP_V2_STYLE = 'ac';
  assert.equal(raw.normalizeRawStory({ rawStory: 'x' }).promptRev, 'rawstory-v2-0803-styleAC2');
  // ★ ผู้ตรวจรอบ 3: ปักหมุดโหมด b ต้อง "ไม่" bump (สาย b ไม่ถูกแตะในชุดกฎใหม่ — รีแฟกเตอร์เผลอ bump ต้องจับได้)
  process.env.CLIP_V2_STYLE = 'b';
  assert.equal(raw.normalizeRawStory({ rawStory: 'x' }).promptRev, 'rawstory-v2-0803-styleB');
  delete process.env.CLIP_V2_STYLE;
  process.env.CLIP_STYLE_DIRECT = '1';
  assert.equal(ins.currentInsightPromptRev(), 'raw-depth2legs-0801-direct2');
  delete process.env.CLIP_STYLE_DIRECT;
});

test('โหมด ac ต้อง "แนบ" altPolished ไม่ใช่แทนที่เวอร์ชันหลัก (ห้ามถอยกลับ)', () => {
  assert.match(RAW_SRC, /styleMode\(\) === 'ac'[\s\S]{0,700}altPolished/,
    'ac ต้องเดินเส้น altPolished');
  assert.match(RAW_SRC, /return \{\s*\.\.\.out,\s*altPolished:/,
    'ต้อง spread out เดิมไว้ครบแล้วแนบ altPolished — เวอร์ชันหลักห้ามเปลี่ยน');
  // ★ ผู้ตรวจ B4: แนบเฉพาะก้อนที่ขัดเกลาจริง — ห้ามแนบของเท่าต้นฉบับใต้ป้าย (ขัดเกลา)
  assert.match(RAW_SRC, /mainChanged|changedTopics/, 'ต้องคัดเฉพาะก้อนที่เปลี่ยนจริงก่อนแนบ');
});

test('ตัวขัดเกลาต้องใช้ luna ผ่าน callAI — ห้ามกลับไป callGemini (เพดาน 15 วิ + system FB)', () => {
  const polishBlock = (RAW_SRC.split('async function _polishStyleC')[1] || '').split('export async function')[0];
  assert.ok(polishBlock.includes("callAI"), 'ต้องเรียก callAI');
  assert.ok(polishBlock.includes('gpt-5.6-luna'), 'ต้องใช้โมเดล luna');
  assert.ok(polishBlock.includes('AbortSignal.timeout'), 'ต้องมีเพดานเวลาของตัวเอง (ผู้ตรวจ B6)');
  // จับการ import จริง ไม่ใช่คำในคอมเมนต์บทเรียน — เหตุผลจริง: callGemini text มีเพดานเวลา 15 วิ hardcode
  assert.ok(!polishBlock.includes("import('@/lib/ai/geminiClient')"), 'ห้าม import geminiClient ในตัวขัดเกลา (เพดานเวลา 15 วิ ไม่พองานก้อนยาว)');
});

test('ด่านกลไกขัดเกลาครบ: คำพูดรอดครบ + กรอบความยาว 85-110% + ล้ม=ต้นฉบับ', () => {
  assert.match(RAW_SRC, /_quoteSpans/, 'ต้องมีตัวดึงช่วงคำพูด');
  assert.match(RAW_SRC, /0\.85/, 'พื้นความยาว 85%');
  assert.match(RAW_SRC, /1\.1/, 'เพดานความยาว 110%');
  assert.match(RAW_SRC, /if \(!polished\.includes\(q\)\) return false|!polished\.includes\(q\)/, 'คำพูดทุกช่วงต้องรอดใน polished');
});

test('ด่านขัดเกลา (พฤติกรรมจริง): คำพูดปลอมที่ถูกเติมต้องตกด่าน (ผู้ตรวจ B1)', () => {
  const ok = raw._polishBlockOk;
  const orig = 'บี้ เปิดใจว่า “คำพูดจริงหนึ่ง” แล้วเล่าเหตุการณ์ต่อจากนั้นอีกยาวพอสมควรเพื่อให้ความยาวสมจริง';
  // เหมือนเดิมเป๊ะ = ผ่าน
  assert.equal(ok(orig, orig), true, 'ข้อความเดิมต้องผ่าน');
  // แก้คำเปรยแต่คำพูดชุดเดิม = ผ่าน
  assert.equal(ok(orig, orig.replace('เปิดใจว่า', 'เล่าว่า')), true, 'แก้คำเปรยโดยคำพูดชุดเดิมต้องผ่าน');
  // ⛔ เติมคำพูดใหม่ (เคสผู้ตรวจยิงทะลุด่านเก่า) = ต้องตก
  assert.equal(ok(orig, orig.replace('แล้วเล่าเหตุการณ์', 'แล้วพูดว่า “โกหก” และเล่าเหตุการณ์')), false, 'คำพูดปลอมที่เติมใหม่ต้องตกด่าน');
  // คำพูดเดิมหาย = ตก
  assert.equal(ok(orig, orig.replace('“คำพูดจริงหนึ่ง” ', '')), false, 'คำพูดเดิมหายต้องตกด่าน');
  // คำพูดถูกแก้ข้างใน = ตก
  assert.equal(ok(orig, orig.replace('คำพูดจริงหนึ่ง', 'คำพูดจริงสอง')), false, 'คำพูดถูกแก้ต้องตกด่าน');
  // สั้นเกิน 85% = ตก
  assert.equal(ok(orig, orig.slice(0, Math.floor(orig.length * 0.5))), false, 'หดเกินเกณฑ์ต้องตกด่าน');
  // อินพุตพัง = ตก ไม่ throw
  assert.equal(ok(orig, undefined), false);
  assert.equal(ok(orig, null), false);
  assert.equal(ok(orig, 123), false);
});

test('กติกากรอบเทาเงียบ + ตัวอย่างโครงสร้าง ห้ามหาย (บทเรียนจูน 4 รอบ)', () => {
  for (const mark of [
    'GRAY_DIRECT_RULES',
    'ภาษาเล่าตรง ไม่มีคำเปรยพิธีการ',
    'ห้ามประโยคประกาศหัวข้อ',                 // อารัมภบท
    'ห้ามตัดคำพูดจริงหรือข้อเท็จจริงเพื่อให้สั้น', // กันคำพูดหาย (บั๊กรอบ 3)
    'กติกาความดิบนี้ไม่ลดคำพูดจริง',
    'ตัวอย่างคลิปไม่มีเสียงพูด',               // ตัวอย่างโครงสร้าง = ตัวปลดล็อกรอบ 4
    'ชูภาพอัลตราซาวด์ประกาศข่าวตั้งครรภ์',
    'ดำเนินรายการโดย',                        // ★ 9 ส.ค.: แบนคำเปรยรายการ
    'subStories ทุกก้อนห้ามเอ่ยชื่อรายการ',     // กันตัวคูณเอ่ยรายการรายก้อน
    'เมื่อถูกถามว่า',                          // ทางแทนชื่อพิธีกร (ยกเว้นเมื่อพิธีกรเป็นสาระ=ระบุชื่อได้)
  ]) assert.ok(INS_SRC.includes(mark), `กติกา "${mark}" หายจากกรอบเทา`);
  for (const mark of [
    'ดำเนินรายการโดย',
    'ประเด็นย่อยทุกก้อนห้ามเอ่ยชื่อรายการ',
    'เมื่อถูกถามว่า',
  ]) assert.ok(RAW_SRC.includes(mark), `กติกา "${mark}" หายจากกรอบเขียว (STYLE_A)`);
  assert.match(INS_SRC, /swOn\('CLIP_STYLE_DIRECT'\)\s*\?\s*GRAY_DIRECT_RULES\s*:\s*''/,
    'GRAY_DIRECT_RULES ต้องอยู่หลังประตูเท่านั้น');
});

restore();
