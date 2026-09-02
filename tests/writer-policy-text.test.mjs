// ★ เฟส 2 "พรอมต์นักเขียน" (2 ก.ย. 69) — ข้อสอบบล็อกกฎ 3 สวิตช์ + ตัวอ่านกฎจากไฟล์ (src/lib/services/writerPolicyText.js)
// รัน: node --test tests/writer-policy-text.test.mjs (ไม่ยิง AI · ไม่แตะเน็ต/DB · อ่านไฟล์ data/writer-viral-rules.json จริง 1 เคส)
// สัญญา: ปิดทุกสวิตช์ = ไม่มีข้อความเลย ('') · เปิดแต่ละสวิตช์ = กฎครบตามสเปก · กฎจากโพสต์ปังอ่านจากไฟล์ · ไฟล์หาย/พัง = ไม่พัง ไม่ใส่บล็อก
// ผลทุบ (2 ก.ย. 69 — ทุบไฟล์จริงแล้วคืนโค้ดเดิมทุกไบต์ · เช็ก md5 ก่อน/หลัง):
//   M1 ลบบรรทัด "🔒 ห้ามตัด: ชื่อ ตัวเลข วันที่…" ใน WRITER_LENGTH_TARGET_BLOCK        ⇒ แดง "WRITER_LENGTH_TARGET_V2=1 …" (ห้ามตัด)
//   M2 เปลี่ยน isWriterLengthTargetV2On เป็น !== '0' (ค่าเริ่มต้นกลายเป็นเปิด)            ⇒ แดง "ปิดทุกสวิตช์…" + "สวิตช์รับเฉพาะ '1'…"
//   M3 ให้ loadWriterViralRules throw เมื่ออ่านไฟล์ไม่ได้ (ลบ try/catch)                 ⇒ แดง "ไฟล์หาย/พัง…" (บล็อกต้องไม่พัง)
//   M4 สลับลำดับ parts ใน buildWriterPolicyBlock (viral ก่อน length)                     ⇒ แดง "ลำดับบล็อก…"
//   M5 ตัด "เจ้าตัว" ออกจากบล็อก FIDELITY                                                ⇒ แดง "WRITER_FIDELITY_RULES_V2=1 …"
//   (oracle ในไฟล์นี้ยังทุบสำเนา data: URL ของโมดูลจริงซ้ำอีก 2 ท่า — ดู test "mutation oracle")
// ★ แก้ตามผู้ตรวจไขว้ 2 ก.ย. 69 (low): หัวบล็อกกฎจากโพสต์ปังคำนวณจาก data/writer-viral-rules.json จริง (version/จำนวนข้อ) —
//   เติมข้อ/ขยับ version ในไฟล์แล้วเทสต้องไม่แดง (พิสูจน์: แก้ไฟล์เป็น v2 · 2 ข้อชั่วคราว → ยังเขียว · ทุบหัวบล็อกในโมดูล → แดง · คืนไฟล์ทุกไบต์)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as policy from '../src/lib/services/writerPolicyText.js';
import { findSwitch } from '../src/lib/config/newsSwitches.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const POLICY_PATH = join(ROOT, 'src', 'lib', 'services', 'writerPolicyText.js');
const RULES_PATH = join(ROOT, 'data', 'writer-viral-rules.json');
const SWITCHES = ['WRITER_LENGTH_TARGET_V2', 'WRITER_FIDELITY_RULES_V2', 'WRITER_VIRAL_RULES_V2', 'WRITER_PROMPT_CACHE_V2'];

/** ตั้ง env เฉพาะช่วง fn — คืนค่าเดิมทุกตัวเสมอ (ไม่ตั้ง = ลบออก) */
function withEnv(values, fn) {
  const saved = Object.fromEntries(SWITCHES.map((name) => [name, process.env[name]]));
  for (const name of SWITCHES) delete process.env[name];
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
  try {
    return fn();
  } finally {
    for (const name of SWITCHES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

/** โหลดสำเนาโมดูลจริง (แก้ซอร์สได้) ผ่าน data: URL — ใช้ทุบ oracle */
async function loadModule(mutate = (source) => source) {
  const source = mutate(readFileSync(POLICY_PATH, 'utf8').replace(/\r\n/g, '\n'));
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

// ── oracle: บล็อกความยาว ──
function assertLengthBlock(text) {
  assert.match(text, /=== 📏 ความยาวเป้าหมาย/u, 'ต้องมีหัวบล็อกความยาว');
  assert.match(text, /150–190 คำ/u, 'เป้า 150–190 คำ');
  assert.match(text, /220 คำเฉพาะข่าวที่มีหลายเหตุการณ์\/ไทม์ไลน์จริง/u, 'ยืดถึง 220 เฉพาะหลายเหตุการณ์/ไทม์ไลน์จริง');
  assert.match(text, /นับคำไทย/u);
  assert.match(text, /15,605 ไลก์/u, 'ต้องอ้างหลักฐานจากเพจจริง');
  const order = ['ประโยคบรรยายอารมณ์/ความเห็นของผู้เขียน', 'รายละเอียดตัวละครรอง', 'ตัวอย่าง 3 ข้อเหลือ 2 ข้อที่แรงสุด', 'เบื้องหลังที่ตัดแล้วความหมายไม่เปลี่ยน'];
  const positions = order.map((needle) => text.indexOf(needle));
  assert.ok(positions.every((p) => p >= 0), `ลำดับการตัดต้องครบ 4 ขั้น (${positions.join(',')})`);
  for (let i = 1; i < positions.length; i += 1) assert.ok(positions[i - 1] < positions[i], `ลำดับการตัดต้องเรียง: ${order[i - 1]} → ${order[i]}`);
  assert.match(text, /🔒 ห้ามตัด: ชื่อ ตัวเลข วันที่ คำพูดจริง จุดหักของเรื่อง และผลลัพธ์/u, 'ของห้ามตัดต้องครบ');
  assert.match(text, /"เล่าให้แน่นขึ้น ไม่ใช่สรุปให้สั้น"/u);
  assert.match(text, /พื้น 146 คำยังคงเดิม/u, 'ต้องบอกว่าพื้น 146 ไม่เปลี่ยน');
  assert.match(text, /=== จบความยาวเป้าหมาย ===/u);
}

// ── oracle: บล็อกความซื่อตรง ──
function assertFidelityBlock(text) {
  assert.match(text, /=== 🧷 ความซื่อตรงต่อต้นฉบับ \(FIDELITY/u);
  for (const forbidden of ['"ไม่ได้ดุ"', '"นั่งลงคุย"', '"ไม่ใช่เพื่อซื้อของเล่น"', '"ไม่ได้ถูกเก็บไว้ในตู้เซฟ แต่…"']) {
    assert.ok(text.includes(forbidden), `ตัวอย่างต้องห้ามต้องมี ${forbidden}`);
  }
  assert.match(text, /ห้ามแต่งการกระทำ ความคิด ท่าทาง หรือ "ความต่าง\/การปฏิเสธ" ที่ต้นฉบับไม่ได้บอก/u);
  assert.match(text, /ห้ามเดาเพศ บทบาท หรือความสัมพันธ์/u);
  assert.match(text, /"เจ้าตัว"/u, 'ต้องเสนอคำกลาง "เจ้าตัว"');
  assert.match(text, /ไม่เกิน 1 ประโยคต่อย่อหน้า/u, 'ตีความอารมณ์ได้ไม่เกิน 1 ประโยคต่อย่อหน้า');
  assert.match(text, /อนุมานตรงจากเหตุการณ์ในต้นฉบับ/u);
  assert.match(text, /=== จบ FIDELITY ===/u);
}

test('ปิดทุกสวิตช์ (ไม่ตั้ง env) = ไม่มีข้อความเลย และค่าที่ไม่ใช่ "1" ตรงตัวก็ถือว่าปิด', () => {
  withEnv({}, () => {
    assert.equal(policy.buildWriterPolicyBlock(), '');
    assert.equal(policy.buildLengthTargetBlock(), '');
    assert.equal(policy.buildFidelityRulesBlock(), '');
    assert.equal(policy.buildViralRulesBlock(), '');
    assert.equal(policy.isWriterLengthTargetV2On(), false);
    assert.equal(policy.isWriterFidelityRulesV2On(), false);
    assert.equal(policy.isWriterViralRulesV2On(), false);
    assert.equal(policy.isWriterPromptCacheV2On(), false);
  });
  for (const junk of ['true', 'on', 'yes', ' 1', '1 ', '"1"', '0', '', 'TRUE']) {
    withEnv(Object.fromEntries(SWITCHES.map((name) => [name, junk])), () => {
      assert.equal(policy.buildWriterPolicyBlock(), '', `ค่า ${JSON.stringify(junk)} ต้องถือว่าปิด`);
      assert.equal(policy.isWriterPromptCacheV2On(), false, `ค่า ${JSON.stringify(junk)} ต้องถือว่าปิด (cache)`);
    });
  }
});

test('WRITER_LENGTH_TARGET_V2=1 = บล็อกความยาวครบ (เป้า/ยืด/ลำดับตัด/ห้ามตัด/สโลแกน) และไม่ปนบล็อกอื่น', () => {
  withEnv({ WRITER_LENGTH_TARGET_V2: '1' }, () => {
    const block = policy.buildWriterPolicyBlock();
    assertLengthBlock(block);
    assert.equal(block, `${policy.WRITER_LENGTH_TARGET_BLOCK}\n\n`, 'บล็อกเดี่ยวต้องลงท้ายด้วยบรรทัดว่างเหมือนหมวดกฎอื่น');
    assert.doesNotMatch(block, /FIDELITY|กฎจากโพสต์ปังจริง/u);
    assert.equal(policy.isWriterLengthTargetV2On(), true);
    assert.equal(policy.isWriterFidelityRulesV2On(), false);
  });
});

test('WRITER_FIDELITY_RULES_V2=1 = บล็อกความซื่อตรงครบ (ตัวอย่างต้องห้าม 4 ข้อ / ห้ามเดาเพศ / อารมณ์ ≤ 1 ประโยค)', () => {
  withEnv({ WRITER_FIDELITY_RULES_V2: '1' }, () => {
    const block = policy.buildWriterPolicyBlock();
    assertFidelityBlock(block);
    assert.equal(block, `${policy.WRITER_FIDELITY_RULES_BLOCK}\n\n`);
    assert.doesNotMatch(block, /150–190|กฎจากโพสต์ปังจริง/u);
  });
});

test('WRITER_VIRAL_RULES_V2=1 = อ่านกฎจาก data/writer-viral-rules.json จริง ครบทุกข้อพร้อมหลักฐาน', () => {
  const doc = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  assert.ok(Array.isArray(doc.rules) && doc.rules.length >= 1, 'ไฟล์ต้องมีตัวอย่างอย่างน้อย 1 ข้อ');
  for (const rule of doc.rules) {
    assert.ok(rule.id && rule.text && rule.evidence, `ทุกข้อในไฟล์ต้องมี id/text/evidence (${rule.id || '?'})`);
  }
  withEnv({ WRITER_VIRAL_RULES_V2: '1' }, () => {
    const block = policy.buildWriterPolicyBlock();
    // หัวบล็อกคำนวณจากไฟล์จริง (version + จำนวนข้อที่ text ไม่ว่าง) — เติมกฎ/ขยับ version ในไฟล์ได้โดยไม่ต้องแก้เทส (ผู้ตรวจไขว้ 2 ก.ย. 69)
    const versionTag = doc.version === null || doc.version === undefined ? '' : ` v${doc.version}`;
    const ruleCount = doc.rules.filter((rule) => typeof rule.text === 'string' && rule.text.trim()).length;
    const expectedHead = `=== 🏆 กฎจากโพสต์ปังจริง (writer-viral-rules${versionTag} · ${ruleCount} ข้อ — ยึดตามนี้เหนือความเคยชินของผู้เขียน) ===`;
    assert.ok(block.startsWith(expectedHead), `หัวบล็อกต้องตรงกับไฟล์จริง — ได้: ${block.split('\n')[0]}`);
    doc.rules.forEach((rule, index) => {
      assert.ok(block.includes(`${index + 1}. ${rule.text}`), `กฎข้อ ${rule.id} ต้องอยู่ในบล็อกพร้อมเลขข้อ`);
      assert.ok(block.includes(`หลักฐาน: ${rule.evidence}`), `หลักฐานของ ${rule.id} ต้องอยู่ในบล็อก`);
    });
    assert.match(block, /=== จบกฎจากโพสต์ปังจริง ===\n\n$/u);
    assert.doesNotMatch(block, /150–190|FIDELITY/u);
  });
  // โครงไฟล์ตามสเปก: { version, rules:[{id,text,evidence}] } — เติมข้อใหม่ได้โดยไม่แตะโค้ด
  const loaded = policy.loadWriterViralRules();
  assert.equal(loaded.version, doc.version);
  assert.deepEqual(loaded.rules.map((r) => r.id), doc.rules.map((r) => r.id));
});

test('ไฟล์หาย/JSON พัง/โครงผิด/ไม่มีข้อ = ไม่ใส่บล็อก ไม่ล้ม และบล็อกอื่นยังอยู่ครบ', () => {
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    withEnv({ WRITER_VIRAL_RULES_V2: '1' }, () => {
      const throwing = () => { throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }); };
      assert.equal(policy.buildViralRulesBlock({ readFile: throwing }), '', 'ไฟล์หาย = ไม่ใส่บล็อก');
      assert.equal(policy.buildViralRulesBlock({ readFile: () => '{ not json' }), '', 'JSON พัง = ไม่ใส่บล็อก');
      assert.equal(policy.buildViralRulesBlock({ readFile: () => '{"version":2}' }), '', 'ไม่มี rules[] = ไม่ใส่บล็อก');
      assert.equal(policy.buildViralRulesBlock({ readFile: () => '{"version":2,"rules":[]}' }), '', 'rules ว่าง = ไม่ใส่บล็อก');
      assert.equal(policy.buildViralRulesBlock({ readFile: () => '{"version":2,"rules":[{"id":"x","text":"   "},{"text":5}]}' }), '', 'ข้อที่ text ว่าง/ไม่ใช่สตริงถูกข้าม');
      assert.equal(policy.loadWriterViralRules({ readFile: throwing }), null);
      assert.equal(policy.formatViralRulesBlock(null), '');
      // id หาย → ออกให้อัตโนมัติ · evidence หาย → ไม่พิมพ์ "หลักฐาน:"
      const loose = policy.loadWriterViralRules({ readFile: () => '{"rules":[{"text":"กฎไม่มีไอดี"}]}' });
      assert.deepEqual(loose, { version: null, rules: [{ id: 'VR-001', text: 'กฎไม่มีไอดี', evidence: '' }] });
      const block = policy.formatViralRulesBlock(loose);
      assert.match(block, /writer-viral-rules · 1 ข้อ/u);
      assert.ok(block.includes('1. กฎไม่มีไอดี\n'));
      assert.doesNotMatch(block, /หลักฐาน:/u);
    });
    withEnv({ WRITER_LENGTH_TARGET_V2: '1', WRITER_FIDELITY_RULES_V2: '1', WRITER_VIRAL_RULES_V2: '1' }, () => {
      const block = policy.buildWriterPolicyBlock({ readFile: () => { throw new Error('ENOENT'); } });
      assertLengthBlock(block);
      assertFidelityBlock(block);
      assert.doesNotMatch(block, /กฎจากโพสต์ปังจริง/u, 'ไฟล์หายต้องไม่มีบล็อกกฎจากโพสต์ปัง แต่บล็อกอื่นอยู่ครบ');
    });
  } finally {
    console.warn = origWarn;
  }
  assert.ok(warnings.some((w) => /writer-viral-rules\.json/u.test(w)), 'ต้องเตือนใน log ว่าอ่านไฟล์ไม่ได้ (ห้ามเงียบ)');
});

test('ลำดับบล็อก: ความยาว → ความซื่อตรง → กฎจากโพสต์ปัง คั่นด้วยบรรทัดว่าง และลงท้ายด้วยบรรทัดว่าง', () => {
  withEnv({ WRITER_LENGTH_TARGET_V2: '1', WRITER_FIDELITY_RULES_V2: '1', WRITER_VIRAL_RULES_V2: '1' }, () => {
    const block = policy.buildWriterPolicyBlock({ readFile: () => '{"version":9,"rules":[{"id":"T-1","text":"กฎทดสอบ X","evidence":"หลักฐานทดสอบ Y"}]}' });
    const positions = ['=== 📏 ความยาวเป้าหมาย', '=== 🧷 ความซื่อตรงต่อต้นฉบับ', '=== 🏆 กฎจากโพสต์ปังจริง (writer-viral-rules v9 · 1 ข้อ'].map((n) => block.indexOf(n));
    assert.ok(positions.every((p) => p >= 0), `ทั้ง 3 บล็อกต้องอยู่ (${positions.join(',')})`);
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2], 'ลำดับต้องเป็น ความยาว → ความซื่อตรง → กฎจากโพสต์ปัง');
    assert.equal(block, `${policy.WRITER_LENGTH_TARGET_BLOCK}\n\n${policy.WRITER_FIDELITY_RULES_BLOCK}\n\n=== 🏆 กฎจากโพสต์ปังจริง (writer-viral-rules v9 · 1 ข้อ — ยึดตามนี้เหนือความเคยชินของผู้เขียน) ===\n1. กฎทดสอบ X — หลักฐาน: หลักฐานทดสอบ Y\n=== จบกฎจากโพสต์ปังจริง ===\n\n`);
  });
});

test('สวิตช์รับเฉพาะ "1" ตรงตัว และทั้ง 5 ตัวลงทะเบียนค่าเริ่มต้น "0" ใน newsSwitches.js ชี้ไฟล์ที่อ่านจริง', () => {
  for (const name of SWITCHES) {
    const reader = {
      WRITER_LENGTH_TARGET_V2: policy.isWriterLengthTargetV2On,
      WRITER_FIDELITY_RULES_V2: policy.isWriterFidelityRulesV2On,
      WRITER_VIRAL_RULES_V2: policy.isWriterViralRulesV2On,
      WRITER_PROMPT_CACHE_V2: policy.isWriterPromptCacheV2On,
    }[name];
    withEnv({ [name]: '1' }, () => assert.equal(reader(), true, `${name}=1 ต้องเปิด`));
    for (const junk of ['true', 'on', '0', '', ' 1']) withEnv({ [name]: junk }, () => assert.equal(reader(), false, `${name}=${JSON.stringify(junk)} ต้องปิด`));
    const entry = findSwitch(name);
    assert.ok(entry, `${name} ต้องอยู่ในทะเบียน`);
    assert.equal(entry.default, '0', `${name} ค่าเริ่มต้นต้องปิด`);
    assert.deepEqual(entry.readBy, ['src/lib/services/writerPolicyText.js']);
    assert.equal(entry.kind, 'switch');
  }
  const trim = findSwitch('WRITER_TRIM_PASS');
  assert.ok(trim && trim.default === '0' && trim.readBy.includes('src/lib/services/autoFlowServiceText.js'), 'WRITER_TRIM_PASS ต้องลงทะเบียนปิดเป็นค่าเริ่มต้น อ่านที่ autoFlowServiceText');
});

test('splitWriterPromptForCache: ก้อนคงที่ไม่มีบรรทัดว่างนำ ลงท้ายบรรทัดว่าง · ก้อนผันแปรครอบ RAW-first เมื่อมีเนื้อดิบ · prompt = ก้อนต่อกัน', () => {
  const finalizer = (raw, supporting) => `<RAW>${raw}</RAW>${supporting}<FINAL>`;
  const withRaw = policy.splitWriterPromptForCache({ constant: '\n\nกฎ A\nกฎ B}', variable: 'การ์ด\nครู\n', rawSourceText: 'เนื้อดิบ', finalizeRawFirst: finalizer });
  assert.deepEqual(withRaw.blocks, [{ text: 'กฎ A\nกฎ B}\n\n', cache: true }, { text: '<RAW>เนื้อดิบ</RAW>การ์ด\nครู\n<FINAL>' }]);
  assert.equal(withRaw.prompt, withRaw.blocks[0].text + withRaw.blocks[1].text);
  assert.equal(withRaw.constantChars, withRaw.blocks[0].text.length);
  assert.equal(withRaw.variableChars, withRaw.blocks[1].text.length);
  const noRaw = policy.splitWriterPromptForCache({ constant: 'กฎ', variable: 'การ์ด', rawSourceText: '', finalizeRawFirst: finalizer });
  assert.deepEqual(noRaw.blocks, [{ text: 'กฎ\n\n', cache: true }, { text: 'การ์ด' }], 'ไม่มีเนื้อดิบ (สาย URL) = ไม่ครอบ RAW');
  assert.equal(policy.splitWriterPromptForCache({ constant: 'กฎ', variable: 'การ์ด', rawSourceText: 'ดิบ' }).blocks[1].text, 'การ์ด', 'ไม่ส่ง finalizer = ไม่ครอบ');
});

test('★ ข้อแก้ ①: กฎเปิดเรื่องอยู่ในไฟล์จริง (VR-010) — loadWriterViralRules() อ่านจาก cwd ของ repo ได้ · version ≥ 3', () => {
  const doc = policy.loadWriterViralRules(); // อ่าน data/writer-viral-rules.json จริง
  assert.ok(doc && Array.isArray(doc.rules) && doc.rules.length >= 10, 'ไฟล์จริงต้องอ่านได้และมี ≥ 10 ข้อ');
  assert.ok(Number(doc.version) >= 3, `version ต้อง ≥ 3 (ได้ ${doc.version})`);
  const opening = doc.rules.find((rule) => /กติกาเปิดเรื่อง/u.test(rule.text) && /สองประโยคแรก/u.test(rule.text));
  assert.ok(opening, 'ต้องมีข้อที่พูดถึงกติกาเปิดเรื่อง (สองประโยคแรก)');
  assert.match(opening.text, /ห้ามเปิดด้วยเบื้องหลัง/u, 'ต้องห้ามเปิดด้วยเบื้องหลัง/ฉาก/ย้อนอดีต');
  assert.match(opening.text, /มีเวลาไม่มาก/u);
  assert.match(opening.text, /จากไป|เสียชีวิต/u, 'ต้องสั่งบอกการจากไปก่อนฉาก');
  assert.match(opening.text, /ผลลัพธ์ปัจจุบัน/u, '"ผลก่อนแล้วย้อน" ต้องนิยามเป็นผลลัพธ์ปัจจุบัน ไม่ใช่เปิดด้วยที่มา');
  assert.match(opening.evidence, /6\.7 vs 7\.5/u, 'ต้องอ้างผล A/B (opening แขนใหม่แพ้)');
  assert.match(opening.evidence, /30\.5\/40/u, 'ต้องอ้างศึกโมเดล E2');
  const vr4 = doc.rules.find((rule) => rule.id === 'VR-004');
  assert.ok(vr4 && vr4.text.includes(opening.id), `VR-004 ("ผลก่อนแล้วย้อน") ต้องชี้กลับไปกติกาเปิดเรื่อง ${opening.id}`);
  withEnv({ WRITER_VIRAL_RULES_V2: '1' }, () => {
    assert.ok(policy.buildWriterPolicyBlock().includes(opening.text), 'เปิดสวิตช์แล้วกฎเปิดเรื่องต้องเข้าบล็อกจริง');
  });
});

test('★ ข้อแก้ ①: เตือนซื่อตรงติดเนื้อดิบ — ว่างเมื่อสวิตช์ปิด · เมื่อเปิด ≤ 5 บรรทัด (ห้ามเดาเพศ/เจ้าตัว/ความต่าง) + ข้อตรวจ FINAL CHECK บรรทัดเดียว', () => {
  withEnv({}, () => {
    assert.equal(policy.buildFidelityRawReminder(), '', 'สวิตช์ปิด = reminder ว่าง');
    assert.equal(policy.buildFidelityFinalCheckLine(), '', 'สวิตช์ปิด = ข้อตรวจว่าง');
  });
  for (const junk of ['0', 'true', 'on', ' 1', '']) {
    withEnv({ WRITER_FIDELITY_RULES_V2: junk }, () => {
      assert.equal(policy.buildFidelityRawReminder(), '', `ค่า ${JSON.stringify(junk)} ต้องถือว่าปิด`);
      assert.equal(policy.buildFidelityFinalCheckLine(), '');
    });
  }
  withEnv({ WRITER_FIDELITY_RULES_V2: '1' }, () => {
    const reminder = policy.buildFidelityRawReminder();
    assert.equal(reminder, policy.WRITER_FIDELITY_RAW_REMINDER);
    assert.ok(reminder.split('\n').length <= 5, `เตือนซื่อตรงต้อง ≤ 5 บรรทัด (ได้ ${reminder.split('\n').length})`);
    assert.match(reminder, /ห้ามเดาเพศ\/บทบาท\/ความสัมพันธ์/u);
    assert.match(reminder, /"เจ้าตัว"/u, 'ต้องเสนอคำกลาง "เจ้าตัว"');
    assert.match(reminder, /ความต่าง\/การปฏิเสธ/u, 'ต้องห้ามแต่งการกระทำ/ความต่าง');
    assert.match(reminder, /ชี้กลับได้ว่าอยู่ตรงไหนของต้นฉบับ/u);
    const line = policy.buildFidelityFinalCheckLine();
    assert.equal(line, policy.WRITER_FIDELITY_FINAL_CHECK_LINE);
    assert.ok(line.startsWith('- ') && !line.includes('\n'), 'ข้อตรวจต้องเป็นรายการข้อเดียวบรรทัดเดียว (แทรกใน FINAL RAW AUTHORITY CHECK ได้)');
    assert.match(line, /เจ้าตัว/u);
    assert.match(line, /เพศ\/บทบาท/u);
    // reminder ฉบับสั้นเป็นคนละก้อนกับบล็อก FIDELITY เต็ม (บล็อกเต็มยังอยู่โซนกฎคงที่ตามเดิม)
    assert.notEqual(reminder, policy.WRITER_FIDELITY_RULES_BLOCK);
    assert.ok(!policy.buildWriterPolicyBlock().includes(reminder), 'reminder ไม่ปนเข้า buildWriterPolicyBlock (โซนกฎคงที่)');
  });
});

test('mutation oracle: ทุบสำเนาโมดูลจริงแล้วข้อสอบต้องแดง (ห้ามตัดหาย · ค่าเริ่มต้นกลายเป็นเปิด)', async () => {
  const intact = await loadModule();
  withEnv({ WRITER_LENGTH_TARGET_V2: '1' }, () => assertLengthBlock(intact.buildWriterPolicyBlock()));

  const noForbidden = await loadModule((source) => {
    const mutated = source.replace(/\n\s*'- 🔒 ห้ามตัด: ชื่อ ตัวเลข วันที่ คำพูดจริง จุดหักของเรื่อง และผลลัพธ์',/u, '');
    assert.notEqual(mutated, source, 'mutation M1 ต้องเกิดจริง');
    return mutated;
  });
  withEnv({ WRITER_LENGTH_TARGET_V2: '1' }, () => assert.throws(() => assertLengthBlock(noForbidden.buildWriterPolicyBlock())));

  const defaultOn = await loadModule((source) => {
    const mutated = source.replace("process.env.WRITER_LENGTH_TARGET_V2 === '1'", "process.env.WRITER_LENGTH_TARGET_V2 !== '0'");
    assert.notEqual(mutated, source, 'mutation M2 ต้องเกิดจริง');
    return mutated;
  });
  withEnv({}, () => assert.throws(() => assert.equal(defaultOn.buildWriterPolicyBlock(), ''), 'ค่าเริ่มต้นกลายเป็นเปิดต้องถูกจับ'));
});
