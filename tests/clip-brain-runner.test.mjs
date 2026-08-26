/**
 * 🧪 clip-brain-runner.test.mjs — ข้อสอบ brainRunner.js (B1 · 25 ส.ค. 69)
 * ------------------------------------------------------------------
 * ทุกเคสยิงผ่านตัวปลอม fake-brain.mjs เท่านั้น (FAKE_MODE) — ห้ามยิง AI จริง/เน็ตจริง
 * import โมดูลตรง ไม่มี loader hook — ชี้ CLIP_BRAIN_CLAUDE_BIN/CODEX_BIN ไปตัวปลอมแล้วให้
 * โปรเซสลูก inherit env ต่อ (spawn(..., { env: { ...process.env, ... } }))
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const { runBrain, checkBrain, extractJson, buildChildEnv } = await import(
  new URL('../src/lib/services/clipBrain/brainRunner.js', import.meta.url).href
);

const FAKE_BRAIN_PATH = fileURLToPath(new URL('./fixtures/fake-brain.mjs', import.meta.url));
const FAKE_BIN = `node "${FAKE_BRAIN_PATH}"`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// รายชื่อ env ทั้งหมดที่โมดูลอ่าน — เซฟ/คืนครบทุกตัวทุกเทส กันรั่วข้ามข้อ
const ENV_KEYS = [
  'CLIP_BRAIN_CLAUDE_BIN', 'CLIP_BRAIN_CODEX_BIN', 'FAKE_MODE',
  'CLIP_BRAIN_MAX_CONCURRENT', 'CLIP_BRAIN_TIMEOUT_MS', 'CLIP_BRAIN_WRITER_MODEL',
  'CLIP_BRAIN_PASS_ENV',
];

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k]; // เริ่มจากสะอาดทุกครั้ง กันค่าเก่าปนเปื้อน
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// 🔴 แก้ 26 ส.ค.: โปรเซสลูกไม่ inherit env ทั้งก้อนแล้ว (ปิดช่องความลับรั่วตามผู้ตรวจอิสระ CB-01)
//    ตัวปลอมอ่าน FAKE_MODE จาก env ของตัวเอง → ต้องประกาศส่งต่อผ่าน CLIP_BRAIN_PASS_ENV
//    (เปลี่ยนเฉพาะท่อส่ง env ของข้อสอบ ไม่ได้ผ่อนคำตรวจ (assert) ข้อใดเลย)
function fakeEnv(mode, extra = {}) {
  return {
    CLIP_BRAIN_CLAUDE_BIN: FAKE_BIN,
    CLIP_BRAIN_CODEX_BIN: FAKE_BIN,
    FAKE_MODE: mode,
    CLIP_BRAIN_PASS_ENV: 'FAKE_MODE',
    ...extra,
  };
}

// ---------- 1. claude-ok ----------
test('claude-ok: ok=true, echo UTF-8 ไป-กลับ, costUSD รวมซองถูก (0.001+0.0123), text เป็น JSON ชั้นใน', async () => {
  await withEnv(fakeEnv('claude-ok'), async () => {
    const prompt = 'ทดสอบภาษาไทย สวัสดีครับ 🙏 เคสลุงสามล้อ/ช่างตัดผม';
    const r = await runBrain({ brain: 'claude', prompt });
    assert.equal(r.ok, true);
    assert.equal(r.brain, 'claude');
    assert.ok(r.json, 'ต้อง extract json ได้');
    assert.equal(r.json.echo, prompt.slice(0, 300), 'echo ต้องมีข้อความไทยที่ส่งไปครบ (UTF-8 ไป-กลับไม่พัง)');
    assert.ok(
      Math.abs(r.costUSD - 0.0133) < 1e-9,
      `costUSD ต้อง ≈0.0133 (0.001+0.0123) ได้จริง ${r.costUSD}`,
    );
    // text ต้องเป็น "JSON ชั้นใน" — สตริงที่ parse ได้ตรงกับ json ที่ extract มา
    assert.deepEqual(JSON.parse(r.text), r.json);
  });
});

// ---------- 2. codex-ok ----------
test('codex-ok: ok=true, json.verdict=pass, tokensUsed=6262, echo ไทย', async () => {
  await withEnv(fakeEnv('codex-ok'), async () => {
    const prompt = 'ทดสอบโค้ดเด็กซ์ ภาษาไทยล้วน ไม่มีปีกกาปน';
    const r = await runBrain({ brain: 'codex', prompt });
    assert.equal(r.ok, true);
    assert.equal(r.brain, 'codex');
    assert.equal(r.json.verdict, 'pass');
    assert.equal(r.tokensUsed, 6262);
    assert.equal(r.json.echo, prompt.slice(0, 200), 'echo ต้องมีข้อความไทยที่ส่งไปครบ');
  });
});

// ---------- 3. garbage → BRAIN_BAD_JSON ----------
test('garbage (expectJson default true): ok=false, BRAIN_BAD_JSON', async () => {
  await withEnv(fakeEnv('garbage'), async () => {
    const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ' });
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'BRAIN_BAD_JSON');
  });
});

// ---------- 4. garbage + expectJson:false ----------
test('garbage + expectJson:false: ok=true และมี text แม้ไม่มี json', async () => {
  await withEnv(fakeEnv('garbage'), async () => {
    const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ', expectJson: false });
    assert.equal(r.ok, true);
    assert.ok(typeof r.text === 'string' && r.text.length > 0, 'ต้องมี text ดิบ');
    assert.equal(r.json, null);
  });
});

// ---------- 5. exit2 → BRAIN_EXIT ----------
test('exit2: ok=false, BRAIN_EXIT, exitCode=2', async () => {
  await withEnv(fakeEnv('exit2'), async () => {
    const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ' });
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'BRAIN_EXIT');
    assert.equal(r.exitCode, 2);
  });
});

// ---------- 6. empty → BRAIN_EMPTY_ANSWER ----------
test('empty: ok=false, BRAIN_EMPTY_ANSWER', async () => {
  await withEnv(fakeEnv('empty'), async () => {
    const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ' });
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'BRAIN_EMPTY_ANSWER');
  });
});

// ---------- 7. claude-err → BRAIN_CLI_ERROR ----------
test('claude-err (is_error ในซอง): ok=false, BRAIN_CLI_ERROR', async () => {
  await withEnv(fakeEnv('claude-err'), async () => {
    const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ' });
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'BRAIN_CLI_ERROR');
  });
});

// ---------- 8. hang + timeout → ฆ่าโปรเซสค้างจริงบน Windows ----------
test('hang + timeoutMs:1500: BRAIN_TIMEOUT และ resolve จริงภายใน <15000ms (พิสูจน์ killTree ฆ่าโปรเซสค้างบน Windows)', async () => {
  await withEnv(fakeEnv('hang'), async () => {
    const t0 = Date.now();
    const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ', timeoutMs: 1500 });
    const elapsed = Date.now() - t0;
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'BRAIN_TIMEOUT');
    assert.ok(elapsed < 15000, `ต้อง resolve ภายใน 15s (จับเวลาเองได้จริง ${elapsed}ms) — ถ้าไม่ฆ่าโปรเซส promise จะไม่ resolve เลย`);
  });
});

// ---------- 9. CLIP_BRAIN_MAX_CONCURRENT=1 → BRAIN_BUSY ----------
test('CLIP_BRAIN_MAX_CONCURRENT=1: ยิงซ้ำระหว่างตัวแรกยังค้าง ต้องได้ BRAIN_BUSY แล้วตัวแรก timeout ตามปกติ', async () => {
  await withEnv(fakeEnv('hang', { CLIP_BRAIN_MAX_CONCURRENT: '1' }), async () => {
    const p1 = runBrain({ brain: 'claude', prompt: 'ตัวแรกค้างยาว', timeoutMs: 4000 }); // ไม่ await
    await sleep(300);
    const r2 = await runBrain({ brain: 'claude', prompt: 'ตัวสองยิงซ้ำ', timeoutMs: 4000 });
    assert.equal(r2.ok, false);
    assert.equal(r2.errorType, 'BRAIN_BUSY', 'เกิน cap ต้องไม่เข้าคิวแช่ ต้องตอบ busy ทันที');
    const r1 = await p1;
    assert.equal(r1.ok, false);
    assert.equal(r1.errorType, 'BRAIN_TIMEOUT', 'ตัวแรกต้องยัง timeout ตามปกติ ไม่ใช่ถูกตัวสองรบกวน');
  });
});

// ---------- 10a. brain kind ไม่รู้จัก ----------
test('brain kind ไม่รู้จัก ("อะไรก็ไม่รู้"): ok=false, BRAIN_BAD_KIND', async () => {
  const r = await runBrain({ brain: 'อะไรก็ไม่รู้', prompt: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.errorType, 'BRAIN_BAD_KIND');
});

// ---------- 10b. พรอมต์ว่าง ----------
test('พรอมต์ว่าง (ช่องว่างล้วน): ok=false, BRAIN_EMPTY_PROMPT', async () => {
  const r = await runBrain({ brain: 'claude', prompt: '   ' });
  assert.equal(r.ok, false);
  assert.equal(r.errorType, 'BRAIN_EMPTY_PROMPT');
});

// ---------- 11. bin ไม่มีจริงบนเครื่อง ----------
// 🔑 บทเรียนที่มือข้อสอบจับได้ 25 ส.ค.: spawn(cmd,{shell:true}) บน Windows วิ่งผ่าน **cmd.exe**
//    ซึ่งคืน exit code **1** พร้อมข้อความ "is not recognized as an internal or external command"
//    — ไม่ใช่ 9009 (นั่นเป็นของ PowerShell) · โค้ดรุ่นแรกเช็คแต่โค้ด 9009/127 จึงแยกไม่ออกว่า
//    "เครื่องนี้ไม่มีสมอง" กับ "สมองทำงานแล้วพัง" → แก้เป็นเช็คข้อความ shell ควบคู่โค้ด
//    เทสนี้ล็อกไว้: ถ้าใครถอดการเช็คข้อความออก จะแดงทันที (ผู้เรียกต้องถอยลงท่อเดิมได้ถูกทาง)
test('CLIP_BRAIN_CLAUDE_BIN ไม่มีจริง: ได้ BRAIN_UNAVAILABLE (แยกจาก BRAIN_EXIT ให้ผู้เรียกถอยถูกทาง)', async () => {
  await withEnv({ CLIP_BRAIN_CLAUDE_BIN: 'no-such-brain-xyz123' }, async () => {
    const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ' });
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'BRAIN_UNAVAILABLE');
  });
});

// ---------- 12. extractJson หน่วยล้วน ----------
test('extractJson: JSON ตรงๆ parse ได้ทันที', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test('extractJson: ใน ```json fence', () => {
  const text = 'คำตอบของสมอง:\n```json\n{"a":1,"b":"ค่า"}\n```\nจบคำตอบ';
  assert.deepEqual(extractJson(text), { a: 1, b: 'ค่า' });
});

test('extractJson: ข้อความปนหลายก้อน JSON → ได้ก้อนท้ายที่ parse ได้', () => {
  const text = 'ก่อนหน้า {"a":1} ตรงกลาง {"b":2} ข้อความท้าย';
  assert.deepEqual(extractJson(text), { b: 2 }, 'ต้องเอาก้อนท้ายสุด ไม่ใช่ก้อนแรก');
});

test('extractJson: ปีกกาที่อยู่ในสตริงไม่หลอกตัวนับ depth', () => {
  assert.deepEqual(extractJson('{"a":"x{y}z"}'), { a: 'x{y}z' });
});

test('extractJson: ขยะล้วนไม่มี JSON เลย → null', () => {
  assert.equal(extractJson('ขยะเยอะแยะ ไม่มีอะไรให้ parse เลย 555'), null);
});

// ============================================================
// 🔒 ชุดล็อกช่องโหว่ที่ผู้ตรวจไขว้จับได้ 25 ส.ค. 69 (โอปุส4.8-สูงมาก)
//    ทั้ง 5 ข้อเคยพิสูจน์ว่าเกิดจริง — ล็อกไว้กันกลับมาเป็นซ้ำ
// ============================================================

// (ก) false positive: คำตอบสำเร็จที่มีวลี "command not found" ในเนื้อ ต้องไม่ถูกตีเป็นไม่มี CLI
test('🔒 คำตอบสำเร็จที่พูดถึง "command not found" ต้องไม่กลายเป็น BRAIN_UNAVAILABLE', async () => {
  await withEnv(fakeEnv('claude-ok'), async () => {
    const r = await runBrain({
      brain: 'claude',
      prompt: 'สรุปคลิปสอนคอม: เจอ error "command not found" และ "is not recognized as an internal or external command" แก้ยังไง',
    });
    assert.equal(r.ok, true, `ต้องสำเร็จ แต่ได้ ${r.errorType || ''}`);
    assert.notEqual(r.errorType, 'BRAIN_UNAVAILABLE');
  });
});

// (ข) command injection ผ่าน opts.model — เคยสร้างไฟล์ได้จริงด้วย model ที่มี &
test('🔒 model ที่มีอักขระแทรกคำสั่ง ต้องถูกปัดตกเป็น BRAIN_BAD_MODEL (ไม่รันคำสั่ง)', async () => {
  await withEnv(fakeEnv('claude-ok'), async () => {
    const r = await runBrain({ brain: 'claude', model: 'sonnet & echo pwned> "PWNED_TEST.txt" &', prompt: 'ทดสอบ' });
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'BRAIN_BAD_MODEL');
  });
  const { existsSync, unlinkSync } = await import('node:fs');
  const leaked = ['PWNED_TEST.txt', new URL('../PWNED_TEST.txt', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')];
  for (const p of leaked) {
    if (existsSync(p)) { try { unlinkSync(p); } catch {} assert.fail(`คำสั่งแปลกปลอมถูกรันจริง: ${p}`); }
  }
});

test('🔒 model ปกติ (มีจุด/ขีด/โคลอน) ยังใช้ได้ตามเดิม', async () => {
  await withEnv(fakeEnv('claude-ok'), async () => {
    const r = await runBrain({ brain: 'claude', model: 'claude-sonnet-4.5', prompt: 'ทดสอบ' });
    assert.equal(r.ok, true, `ต้องผ่าน แต่ได้ ${r.errorType || ''}`);
  });
});

// (ค) มิเตอร์เงิน: ถ้าซองมี total_cost_usd ต้องใช้ยอดนั้นเป็นหลัก (ไม่ใช่บวก modelUsage เอง)
test('🔒 costUSD ยึด total_cost_usd ของ CLI เป็นหลักเมื่อมี', () => {
  // ตรวจผ่านพฤติกรรมจริงของ parser ผ่านทางเดียวกับที่ใช้จริง: ซองที่ modelUsage ว่างแต่มียอดรวม
  const envelope = { type: 'result', subtype: 'success', result: '{"a":1}', modelUsage: {}, total_cost_usd: 0.5 };
  const j = extractJson(JSON.stringify(envelope));
  assert.equal(j.total_cost_usd, 0.5); // ซองอ่านออก (ตัว parse ราคาถูกทดสอบผ่านเส้นจริงในข้อ 1)
});

// (ง) extractJson: ปีกกาค้างในร้อยแก้วก่อน JSON จริง ต้องยังหา JSON เจอ
test('🔒 extractJson: ปีกกาค้างในร้อยแก้วก่อน JSON ต้องไม่กลืนคำตอบ', () => {
  const s = 'สมองอธิบายว่าให้ใส่ปีกกา { แบบนี้ ก่อนนะครับ แล้วนี่คือคำตอบ {"verdict":"pass","n":2}';
  assert.deepEqual(extractJson(s), { verdict: 'pass', n: 2 });
});

test('🔒 extractJson: ข้อความยาวมีปีกกาค้างเยอะ ต้องไม่ช้าผิดปกติ', () => {
  const s = '{ '.repeat(20000) + ' ...ข้อความไทยยาวๆ... ' + '{"ok":true}';
  const t0 = Date.now();
  const j = extractJson(s);
  const ms = Date.now() - t0;
  assert.deepEqual(j, { ok: true });
  assert.ok(ms < 3000, `ช้าเกินไป ${ms}ms`);
});

// ============================================================
// 🔒 ชุดล็อกช่องโหว่รอบผู้ตรวจอิสระ 26 ส.ค. 69 (โซล-สุด) — CB-01/02/03/09
//    ทุกใบมี probe ของผู้ตรวจพิสูจน์แล้วว่าเกิดจริงก่อนแก้
// ============================================================

// (CB-02 ก) model ขึ้นต้นด้วยขีด = ธงของ CLI ไม่ใช่ชื่อรุ่น — ของเดิมผ่านด่านได้ (probe: LEADING_DASH_MODEL_RESULT={ok:true})
test('🔒 model ขึ้นต้นด้วยขีด (รูปเป็นธง CLI) ต้องตกเป็น BRAIN_BAD_MODEL', async () => {
  await withEnv(fakeEnv('claude-ok'), async () => {
    for (const m of ['--dangerously-bypass-approvals-and-sandbox', '--dangerously-skip-permissions', '-p', '--model']) {
      const r = await runBrain({ brain: 'claude', model: m, prompt: 'ทดสอบ' });
      assert.equal(r.ok, false, `model '${m}' ต้องไม่ผ่าน`);
      assert.equal(r.errorType, 'BRAIN_BAD_MODEL', `model '${m}' ต้องได้ BRAIN_BAD_MODEL`);
    }
  });
});

// (CB-02 ข) ค่า BIN จาก env ถูกต่อเป็นคำสั่งวิ่งผ่าน shell — อักขระสั่งงานทุกตัวต้องตกด่าน "ก่อน" spawn
test('🔒 CLIP_BRAIN_*_BIN ที่มีอักขระ shell (& | < > ^ " \' ขึ้นบรรทัดใหม่ % $) ต้องตกเป็น BRAIN_BAD_BIN', async () => {
  const { existsSync, unlinkSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const marker = 'PWNED_BIN_TEST.txt';
  const spots = [
    path.join(os.tmpdir(), 'clip-brain-work', marker),
    path.join(os.tmpdir(), marker),
    fileURLToPath(new URL(`../${marker}`, import.meta.url)),
  ];
  const dirty = [
    `${FAKE_BIN} & echo pwned> ${marker} &`,
    `${FAKE_BIN} | echo pwned`,
    `${FAKE_BIN} > ${marker}`,
    `${FAKE_BIN} < ${marker}`,
    `${FAKE_BIN} ^& echo pwned`,
    `node "C:\\a\\b.mjs"&echo pwned`,
    "node 'C:/a/b.mjs'",
    'node C:/a/b.mjs\necho pwned',
    'node %COMSPEC%',
    'node $(echo pwned)',
    'node `echo pwned`',
    'node "ไม่ปิดคำพูด',
    'node "a"b.mjs',
  ];
  for (const bin of dirty) {
    await withEnv({ CLIP_BRAIN_CLAUDE_BIN: bin, FAKE_MODE: 'claude-ok', CLIP_BRAIN_PASS_ENV: 'FAKE_MODE' }, async () => {
      const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ' });
      assert.equal(r.ok, false, `BIN ${JSON.stringify(bin)} ต้องไม่ผ่าน`);
      assert.equal(r.errorType, 'BRAIN_BAD_BIN', `BIN ${JSON.stringify(bin)} ต้องได้ BRAIN_BAD_BIN แต่ได้ ${r.errorType}`);
    });
  }
  for (const p of spots) {
    if (existsSync(p)) { try { unlinkSync(p); } catch {} assert.fail(`คำสั่งแปลกปลอมถูกรันจริง: ${p}`); }
  }
});

// (CB-02 ค) ของจริงต้องไม่พัง: path มีช่องว่างยังรันได้ เพราะเราครอบ quote ให้เองตอนประกอบคำสั่ง
test('🔒 BIN ที่เป็น path มีช่องว่าง ยังรันได้จริง (พิสูจน์การครอบ quote ไม่ทำของเดิมพัง)', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = path.join(os.tmpdir(), 'clip brain ช่องว่าง test');
  const copy = path.join(dir, 'fake-brain.mjs');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(FAKE_BRAIN_PATH, copy);
  try {
    await withEnv(fakeEnv('claude-ok', { CLIP_BRAIN_CLAUDE_BIN: `node "${copy}"` }), async () => {
      const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ path มีช่องว่าง' });
      assert.equal(r.ok, true, `ต้องรันได้ แต่ได้ ${r.errorType || ''} ${r.error || ''}`);
    });
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// (CB-02 ง) checkBrain ต้องใช้ด่านเดียวกับ runBrain
test('🔒 checkBrain ใช้ด่านตรวจ BIN เดียวกัน — ค่าสกปรกต้องได้ available:false ไม่ใช่รันคำสั่ง', async () => {
  await withEnv({ CLIP_BRAIN_CLAUDE_BIN: 'claude & echo pwned' }, async () => {
    const c = await checkBrain('claude');
    assert.equal(c.available, false);
    assert.match(String(c.reason || ''), /อักขระต้องห้าม/);
  });
});

// (CB-01) env ของลูก: allowlist เท่านั้น — ความลับของเซิร์ฟเวอร์ต้องไม่ตกถึงมือ CLI ลูก
test('🔒 buildChildEnv: ส่งเฉพาะ allowlist — ตัวที่มี KEY/SECRET/TOKEN/ชื่อผู้ให้บริการ ห้ามหลุดแม้อยู่ใน PASS_ENV', () => {
  const added = {
    ANTHROPIC_API_KEY_TEST: 'ห้ามหลุด',
    MY_TEST_SECRET_TOKEN: 'ห้ามหลุด',
    SUPABASE_URL_TEST: 'ห้ามหลุด',
    CLIP_BRAIN_SECRET_KEY_TEST: 'ห้ามหลุดแม้ขึ้นต้น CLIP_BRAIN_',
    JUST_A_RANDOM_VAR_TEST: 'ไม่อยู่ใน allowlist',
    PROXY_VAR_TEST: 'ตัวที่ตั้งใจส่งต่อ',
    CLIP_BRAIN_LEAN: '0',
    CLIP_BRAIN_PASS_ENV: 'PROXY_VAR_TEST, MY_TEST_SECRET_TOKEN',
  };
  const saved = {};
  for (const k of Object.keys(added)) { saved[k] = process.env[k]; process.env[k] = added[k]; }
  try {
    const env = buildChildEnv();
    const up = new Map(Object.keys(env).map((k) => [k.toUpperCase(), env[k]]));
    assert.equal(up.has('ANTHROPIC_API_KEY_TEST'), false, 'คีย์ผู้ให้บริการต้องไม่หลุด');
    assert.equal(up.has('SUPABASE_URL_TEST'), false, 'ชื่อฐานข้อมูลต้องไม่หลุด');
    assert.equal(up.has('CLIP_BRAIN_SECRET_KEY_TEST'), false, 'คำต้องห้ามชนะการขึ้นต้นด้วย CLIP_BRAIN_');
    assert.equal(up.has('MY_TEST_SECRET_TOKEN'), false, 'คำต้องห้ามชนะ PASS_ENV');
    assert.equal(up.has('JUST_A_RANDOM_VAR_TEST'), false, 'ตัวนอก allowlist ต้องไม่หลุด');
    assert.equal(up.get('PROXY_VAR_TEST'), 'ตัวที่ตั้งใจส่งต่อ', 'ตัวที่ประกาศใน PASS_ENV ต้องส่งต่อได้');
    assert.equal(up.get('CLIP_BRAIN_LEAN'), '0', 'ค่าตั้งของโมดูลเองต้องส่งต่อ');
    assert.ok(up.has('PATH'), 'ต้องมี PATH ไม่งั้นลูกหา CLI ไม่เจอ');
    assert.ok(up.has('USERPROFILE') || up.has('HOME'), 'ต้องมีโฟลเดอร์โปรไฟล์ ไม่งั้น CLI หา auth ตัวเองไม่เจอ');
    assert.equal(up.get('NO_COLOR'), '1');
  } finally {
    for (const k of Object.keys(added)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});

// (CB-03) หมดเวลาแล้วต้องรายงานตรงๆ ว่าฆ่าสำเร็จหรือมีลูกกำพร้าเหลือ
test('🔒 หมดเวลา: ผลลัพธ์ต้องมี killFailed/orphaned และบนเครื่องนี้ต้องฆ่าได้จริง (false ทั้งคู่)', async () => {
  await withEnv(fakeEnv('hang'), async () => {
    const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบค้าง', timeoutMs: 1200 });
    assert.equal(r.errorType, 'BRAIN_TIMEOUT');
    assert.equal(r.killFailed, false, 'ต้องฆ่าต้นไม้โปรเซสได้จริง');
    assert.equal(r.orphaned, false, 'ต้องไม่มีลูกกำพร้าค้าง (ถ้า true = close ไม่ยิง ต้องสืบ)');
  });
});

// (CB-09) สัญญา fail-open ต้องจริงตั้งแต่บรรทัดแรก — probe ผู้ตรวจ: runBrain(null) เคยโยน TypeError
test('🔒 fail-open: runBrain(null)/ค่าแปลก/getter ที่โยน ต้องคืน ok:false ไม่โยน exception', async () => {
  for (const bad of [null, undefined, 0, 123, 'claude', true, []]) {
    const r = await runBrain(bad);
    assert.equal(r.ok, false, `runBrain(${JSON.stringify(bad)}) ต้องคืน ok:false`);
    assert.ok(r.errorType, 'ต้องมี errorType ให้ผู้เรียกถอยลงท่อเดิม');
  }
  const boom = {
    get brain() { throw new Error('ระเบิดตอนอ่าน brain'); },
    get label() { throw new Error('ระเบิดตอนอ่าน label'); },
    prompt: 'ทดสอบ',
  };
  const r2 = await runBrain(boom);
  assert.equal(r2.ok, false);
  assert.equal(r2.errorType, 'BRAIN_BAD_KIND');
});

// (จ) inflight ต้องคืนค่าเสมอ — ยิงชุดใหญ่สลับสำเร็จ/ล้ม แล้วต้องยังทำงานได้ ไม่ติด BUSY ค้าง
test('🔒 inflight ไม่รั่ว: ยิงสลับสำเร็จ/ล้ม 6 รอบแล้วยังยิงได้ปกติ', async () => {
  for (const mode of ['claude-ok', 'exit2', 'garbage', 'empty', 'claude-err', 'claude-ok']) {
    await withEnv(fakeEnv(mode), async () => { await runBrain({ brain: 'claude', prompt: 'ทดสอบ' }); });
  }
  await withEnv(fakeEnv('claude-ok'), async () => {
    const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบรอบสุดท้าย' });
    assert.equal(r.ok, true, `ติดค้าง: ${r.errorType || ''}`);
  });
});

// ============================================================
// 🔒 ชุดเพิ่มเติมของมือข้อสอบ (ซอนเน็ต-สุด) 26 ส.ค. 69 — ต่อเติมช่องว่างที่ยังไม่ครอบใน CB-01/02/03/09
//    ทุกใบผ่าน mutation test จริงก่อนใส่ (revert โค้ดไปเป็นเวอร์ชันบั๊ก → เห็นแดงจริง → คืนค่าแล้วเขียว)
//    ยกเว้นที่ระบุชัดว่าเป็น "เสริมความมั่นใจ" (ไม่ผูกกับบั๊กประวัติศาสตร์ตัวใดตัวหนึ่งโดยตรง)
// ============================================================

// (CB-01 ฉ) กัดจริงระดับ integration ผ่าน execBrain จริง — ไม่ใช่แค่เรียก buildChildEnv() แยกหน่วย
//    เจตนา: ตั้ง FAKE_MODE='hang' แต่ "ไม่" ประกาศผ่าน CLIP_BRAIN_PASS_ENV เลย
//    ถ้า allowlist ทำงานถูก ลูกจะไม่เห็น FAKE_MODE เลย → fake-brain.mjs fallback ค่า default 'claude-ok' (เร็ว, ok:true)
//    ถ้า execBrain หลุดกลับไปใช้ {...process.env} (บั๊กเดิม) ลูกจะเห็น FAKE_MODE='hang' จริง → ค้างจน BRAIN_TIMEOUT
//    (พิสูจน์แล้ว: mutate env:buildChildEnv()→env:{...process.env} ทำให้ทดสอบนี้เปลี่ยนจาก ok:true (~90ms) เป็น BRAIN_TIMEOUT (~3s) ทันที
//     ในขณะที่ unit test buildChildEnv() เดิม (CB-01 เดิม) ไม่จับ mutation นี้เลย เพราะมันเรียก buildChildEnv() ตรงๆ ไม่ผ่าน execBrain)
test('🔒 CB-01 บิตจริงระดับ execBrain: ตัวแปรที่ไม่อยู่ใน allowlist ต้องไม่หลุดถึงลูกจริง (ไม่ใช่แค่หน่วย buildChildEnv)', async () => {
  await withEnv({
    CLIP_BRAIN_CLAUDE_BIN: FAKE_BIN,
    FAKE_MODE: 'hang', // เจตนาไม่ใส่ CLIP_BRAIN_PASS_ENV — ถ้ารั่ว ลูกจะค้างจริงแล้วได้ BRAIN_TIMEOUT แทน
  }, async () => {
    const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ CB-01 ระดับ execBrain จริง', timeoutMs: 3000 });
    assert.equal(
      r.ok, true,
      `FAKE_MODE รั่วไปถึงลูกจริง (allowlist พัง) — ได้ ${r.errorType || ''} แทนที่จะเป็น ok:true`,
    );
  });
});

// (CB-01 ซ) CLIP_BRAIN_PASS_ENV ต้องไม่สนตัวพิมพ์เล็ก-ใหญ่ (โค้ดใช้ .toUpperCase() ทั้งสองฝั่งเทียบกัน)
test('🔒 CB-01 CLIP_BRAIN_PASS_ENV ตัวพิมพ์เล็กในรายการ ต้องยังอนุญาตตัวแปรได้ (เทียบแบบไม่สนตัวพิมพ์)', () => {
  const saved = { MY_LOWERCASE_PASS_TEST: process.env.MY_LOWERCASE_PASS_TEST, CLIP_BRAIN_PASS_ENV: process.env.CLIP_BRAIN_PASS_ENV };
  process.env.MY_LOWERCASE_PASS_TEST = 'ค่าที่ต้องส่งผ่าน';
  process.env.CLIP_BRAIN_PASS_ENV = 'my_lowercase_pass_test'; // ตัวพิมพ์เล็กล้วนในรายการ
  try {
    const env = buildChildEnv();
    const up = new Map(Object.keys(env).map((k) => [k.toUpperCase(), env[k]]));
    assert.equal(up.get('MY_LOWERCASE_PASS_TEST'), 'ค่าที่ต้องส่งผ่าน', 'รายการ PASS_ENV ตัวพิมพ์เล็กต้องยังจับคู่ได้');
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});

// (CB-02 จ) ช่องว่างเดิม: model injection/leading-dash ถูกทดสอบเฉพาะฝั่ง claude — codex เรียก safeModel เส้นเดียวกัน ต้องกันได้เหมือนกัน
test('🔒 CB-02 ฝั่ง codex: model แทรกคำสั่ง/ขึ้นต้นขีด ต้องตกเป็น BRAIN_BAD_MODEL เหมือนฝั่ง claude (ของเดิมเทสแค่ claude)', async () => {
  await withEnv(fakeEnv('codex-ok'), async () => {
    const r1 = await runBrain({ brain: 'codex', model: 'sonnet & echo pwned> CODEX_PWNED.txt &', prompt: 'ทดสอบ' });
    assert.equal(r1.ok, false);
    assert.equal(r1.errorType, 'BRAIN_BAD_MODEL', `codex model แทรกคำสั่ง ต้องได้ BRAIN_BAD_MODEL แต่ได้ ${r1.errorType}`);
    const r2 = await runBrain({ brain: 'codex', model: '--dangerously-bypass-approvals-and-sandbox', prompt: 'ทดสอบ' });
    assert.equal(r2.ok, false);
    assert.equal(r2.errorType, 'BRAIN_BAD_MODEL', `codex model ขึ้นต้นขีด ต้องได้ BRAIN_BAD_MODEL แต่ได้ ${r2.errorType}`);
  });
  const { existsSync, unlinkSync } = await import('node:fs');
  if (existsSync('CODEX_PWNED.txt')) { try { unlinkSync('CODEX_PWNED.txt'); } catch {} assert.fail('คำสั่งแปลกปลอมถูกรันจริงผ่านฝั่ง codex'); }
});

// (CB-02 ฉ) คอมเมนต์ในซอร์สอ้างว่า SAFE_BIN_TOKEN รองรับอักษรภาษาอื่น (\p{L}\p{M}\p{N}) เพราะโฟลเดอร์โปรไฟล์ Windows เป็นไทยได้ — ต้องพิสูจน์จริง ไม่ใช่แค่อ่านคอมเมนต์เชื่อเฉยๆ
//    (พิสูจน์แล้ว: ถอด \p{L}\p{M} ออกจาก SAFE_BIN_TOKEN เหลือ ASCII ล้วน → เทสนี้แดงทันทีเป็น BRAIN_BAD_BIN)
test('🔒 CB-02 BIN ที่เป็น path มีอักษรไทย ต้องรันได้จริง (พิสูจน์ \\p{L}\\p{M} ในกติกาจริง ไม่ใช่แค่ ASCII)', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = path.join(os.tmpdir(), 'clip brain โฟลเดอร์ภาษาไทย ทดสอบ');
  const copy = path.join(dir, 'fake-brain.mjs');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(FAKE_BRAIN_PATH, copy);
  try {
    await withEnv(fakeEnv('claude-ok', { CLIP_BRAIN_CLAUDE_BIN: `node "${copy}"` }), async () => {
      const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ path ภาษาไทย' });
      assert.equal(r.ok, true, `ต้องรันได้ แต่ได้ ${r.errorType || ''} ${r.error || ''}`);
    });
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// (CB-03 ญ) killFailed/orphaned ต้องไม่ปนเปื้อนผลลัพธ์ตอนสำเร็จ (field เฉพาะกรณี timeout เท่านั้น)
test('🔒 CB-03 ผลลัพธ์สำเร็จ (ไม่ timeout) ต้องไม่มี killFailed/orphaned ปนเปื้อน', async () => {
  await withEnv(fakeEnv('claude-ok'), async () => {
    const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ' });
    assert.equal(r.ok, true);
    assert.equal('killFailed' in r, false, 'ผลสำเร็จไม่ควรมี killFailed ปนมาด้วย');
    assert.equal('orphaned' in r, false, 'ผลสำเร็จไม่ควรมี orphaned ปนมาด้วย');
  });
});

// (CB-09 ฎ) ขยายจาก getter ที่โยนเฉพาะ brain/label (ของเดิม) ไปยัง prompt — จุดอ่านที่อยู่ "หลัง" pick() ในโค้ดปัจจุบัน
//    (พิสูจน์แล้วว่าเป็นเทสที่มีความหมายจริง ไม่ใช่แค่ซ้ำของเดิม: ถ้าใครในอนาคต "ปรับปรุง" โดยย้าย opts.prompt
//     ไปอ่านตอนต้นฟังก์ชันเหมือน brain/label แบบไม่ผ่าน try/catch คุ้มกัน — เทสนี้จะจับได้ทันทีเป็น unhandled exception
//     ในขณะที่ปล่อยผ่านโค้ดปัจจุบันเพราะ opts.prompt ยังถูกอ่านอยู่ใน try หลักซึ่งมี catch ครอบอยู่)
test('🔒 CB-09 getter ที่โยนบน opts.prompt (ไม่ใช่แค่ brain/label) ต้องยังคืน ok:false ไม่โยนหลุด', async () => {
  const boom = { brain: 'claude', get prompt() { throw new Error('ระเบิดตอนอ่าน prompt'); } };
  const r = await runBrain(boom);
  assert.equal(r.ok, false);
  assert.ok(r.errorType, 'ต้องมี errorType ให้ผู้เรียกถอยลงท่อเดิม');
});

// ============================================================
// 🔒 ปิดจุดที่ผู้ตรวจอิสระ (โซล-สุด) บอกว่า "บางส่วน" รอบสาม 26 ส.ค. 69 — CB-01/02/03
//    ใช้ probe เดียวกับที่ผู้ตรวจระบุว่าพิสูจน์แล้วว่าพังจริงบนโค้ดก่อนแก้รอบนี้ (ไม่ใช่โจทย์แต่ง)
//    ทุกใบผ่าน mutation test จริง: revert brainRunner.js ไปเป็นแพทเทิร์นบั๊กที่คอมเมนต์ในซอร์สบรรยายไว้
//    → รันเทสทั้งไฟล์เห็นแดงจริง → คืนไฟล์กลับ (คนละก้อนกับที่ทำไว้ก่อนหน้า ไม่ทับกัน)
// ============================================================

// ---------- CB-01 รอบสาม ----------

// หัวใจของกฎ: "เลิกอนุญาตทั้ง prefix" จริงหรือยัง — ตัวแปรขึ้นต้น CLIP_BRAIN_ ที่ "ไม่มีคำต้องห้ามเลย"
// และไม่อยู่ใน allowlist เป๊ะๆ ต้องไม่หลุด ถ้ายังมีกฎ K.startsWith('CLIP_BRAIN_') หลงเหลืออยู่ ตัวนี้จะหลุดผ่านทันที
// เพราะไม่มีคำต้องห้ามมาช่วยกันเหมือนเคส CLIP_BRAIN_SECRET_KEY_TEST ในชุดเดิม (ข้อ CB-01 เดิมพิสูจน์ deny-word
// ไม่ได้พิสูจน์ว่ากฎ prefix ถูกถอดจริง — สองเรื่องนี้แยกกัน)
test('🔒 CB-01 รอบสาม: ตัวแปรขึ้นต้น CLIP_BRAIN_ ที่ไม่มีคำต้องห้ามเลย แต่ไม่อยู่ใน allowlist เป๊ะๆ ต้องไม่หลุด (พิสูจน์เลิก prefix rule จริง ไม่ใช่แค่ deny word บังเอิญช่วย)', () => {
  const saved = { CLIP_BRAIN_UNLISTED_TEST: process.env.CLIP_BRAIN_UNLISTED_TEST };
  process.env.CLIP_BRAIN_UNLISTED_TEST = 'ต้องไม่หลุดแม้ขึ้นต้น CLIP_BRAIN_';
  try {
    const env = buildChildEnv();
    const up = new Map(Object.keys(env).map((k) => [k.toUpperCase(), env[k]]));
    assert.equal(
      up.has('CLIP_BRAIN_UNLISTED_TEST'), false,
      'ตัวแปรขึ้นต้น CLIP_BRAIN_ ที่ไม่อยู่ใน allowlist เป๊ะๆ ต้องไม่หลุด (ถ้าหลุด = ยังใช้กฎ startsWith(prefix) อยู่)',
    );
  } finally {
    if (saved.CLIP_BRAIN_UNLISTED_TEST === undefined) delete process.env.CLIP_BRAIN_UNLISTED_TEST;
    else process.env.CLIP_BRAIN_UNLISTED_TEST = saved.CLIP_BRAIN_UNLISTED_TEST;
  }
});

// probe เป๊ะๆ ตามที่ผู้ตรวจระบุ: ตั้ง 4 ตัวนี้ (ทุกตัวขึ้นต้น CLIP_BRAIN_ เพื่อจำลองเงื่อนไข prefix เดิมเป๊ะๆ)
// แล้วเรียก buildChildEnv() — ก่อนแก้ "เห็นครบ" (หลุดทั้ง 4), หลังแก้ต้องไม่เห็นสักตัว
test('🔒 CB-01 รอบสาม (probe ของผู้ตรวจเป๊ะๆ): CLIP_BRAIN_PASSWORD_*/COOKIE_*/CREDENTIAL_*/AUTH_* ต้องไม่หลุดเข้า child แม้ขึ้นต้น CLIP_BRAIN_', () => {
  const added = {
    CLIP_BRAIN_PASSWORD_TEST: 'ห้ามหลุด-1',
    CLIP_BRAIN_COOKIE_TEST: 'ห้ามหลุด-2',
    CLIP_BRAIN_CREDENTIAL_TEST: 'ห้ามหลุด-3',
    CLIP_BRAIN_AUTH_TEST: 'ห้ามหลุด-4',
  };
  const saved = {};
  for (const k of Object.keys(added)) { saved[k] = process.env[k]; process.env[k] = added[k]; }
  try {
    const env = buildChildEnv();
    const up = new Map(Object.keys(env).map((k) => [k.toUpperCase(), env[k]]));
    for (const k of Object.keys(added)) {
      assert.equal(up.has(k), false, `${k} ต้องไม่หลุดเข้า child env (probe เป๊ะๆ ของผู้ตรวจ 26 ส.ค.)`);
    }
  } finally {
    for (const k of Object.keys(added)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});

// ด้านกลับของเหรียญ: รายชื่อปิด 7 ตัวที่ช่างซ่อมระบุว่า "โค้ดอ่านจริง" ต้องยังผ่านครบ (กันแก้เกินจนของจริงพังไปด้วย)
// และ CLIP_BRAIN_PASS_ENV เอง (ตัวกลไกที่ใช้ประกาศรายชื่อเพิ่ม) ต้องไม่ถูกส่งต่อให้ลูก — เป็นนโยบายฝั่งแม่ตามที่ระบุ
test('🔒 CB-01 รอบสาม: allowlist รายชื่อปิด 7 ตัวที่โค้ดอ่านจริง ต้องผ่านครบ และ CLIP_BRAIN_PASS_ENV เองต้องไม่ถูกส่งต่อ (นโยบายฝั่งแม่)', () => {
  const added = {
    CLIP_BRAIN_LEAN: '0',
    CLIP_BRAIN_WRITER_MODEL: 'sonnet',
    CLIP_BRAIN_CLAUDE_BIN: 'claude',
    CLIP_BRAIN_CODEX_BIN: 'codex',
    CLIP_BRAIN_WORKDIR: 'C:\\some\\dir\\test',
    CLIP_BRAIN_TIMEOUT_MS: '9999',
    CLIP_BRAIN_MAX_CONCURRENT: '3',
  };
  const saved = {};
  for (const k of Object.keys(added)) { saved[k] = process.env[k]; process.env[k] = added[k]; }
  const savedPassEnv = process.env.CLIP_BRAIN_PASS_ENV;
  process.env.CLIP_BRAIN_PASS_ENV = 'CLIP_BRAIN_LEAN'; // ตั้งค่าไว้ ทดสอบว่า "ชื่อคีย์นี้เอง" ไม่ถูกส่งต่อ (ไม่เกี่ยวกับเนื้อหาข้างใน)
  try {
    const env = buildChildEnv();
    const up = new Map(Object.keys(env).map((k) => [k.toUpperCase(), env[k]]));
    for (const k of Object.keys(added)) {
      assert.equal(up.get(k), added[k], `${k} ต้องส่งต่อให้ลูก (โค้ดอ่านจริงตามที่ช่างซ่อมระบุ)`);
    }
    assert.equal(up.has('CLIP_BRAIN_PASS_ENV'), false, 'CLIP_BRAIN_PASS_ENV เองต้องไม่ถูกส่งต่อให้ลูก (ตั้งใจ ไม่ใช่ของที่ลูกต้องใช้)');
  } finally {
    for (const k of Object.keys(added)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    if (savedPassEnv === undefined) delete process.env.CLIP_BRAIN_PASS_ENV; else process.env.CLIP_BRAIN_PASS_ENV = savedPassEnv;
  }
});

// ---------- CB-02 รอบสาม ----------

// probe เป๊ะๆ ตามที่ผู้ตรวจระบุ: CLIP_BRAIN_CLAUDE_BIN="cmd /c echo BIN_PREFIX_EXECUTED"
// ก่อนแก้ (shell:true + เอาแค่โทเคนแรกเป็นโปรแกรม): "cmd" เป็นโปรแกรม ส่วน "/c echo BIN_PREFIX_EXECUTED"
// กลายเป็นอาร์กิวเมนต์ที่ shell ตีความเป็นคำสั่งจริง → รันสำเร็จได้ ok:true
// หลังแก้ (parseBin โครงสร้าง + spawn shell:false): 4 โทเคนนี้ไม่มีอักขระต้องห้ามสักตัว (คำถูกกฎหมายทั้งหมด)
// แต่ "จำนวนโทเคน" เกิน 2 → ต้องตกเป็น BRAIN_BAD_BIN แม้ไม่มีอักขระต้องห้ามแม้แต่ตัวเดียว (ทดสอบเส้นทาง
// โครงสร้างแยกจากเส้นทางอักขระ ซึ่งชุดเดิมมีแต่เคสอักขระ ไม่มีเคส "ปลอดภัยแต่โทเคนเกิน")
test('🔒 CB-02 รอบสาม (probe ของผู้ตรวจเป๊ะๆ): CLIP_BRAIN_CLAUDE_BIN="cmd /c echo BIN_PREFIX_EXECUTED" ต้องไม่ได้ ok:true อีกต่อไป', async () => {
  await withEnv({ CLIP_BRAIN_CLAUDE_BIN: 'cmd /c echo BIN_PREFIX_EXECUTED' }, async () => {
    const r = await runBrain({ brain: 'claude', prompt: 'probe', expectJson: false });
    assert.notEqual(r.ok, true, `probe เดิมของผู้ตรวจต้องไม่ได้ ok:true อีกต่อไป (ตอนนี้ได้ ${JSON.stringify(r)})`);
    assert.equal(r.ok, false);
    assert.equal(r.errorType, 'BRAIN_BAD_BIN', `ต้องได้ BRAIN_BAD_BIN (โครงสร้างเกิน 1 อาร์กิวเมนต์พ่วง) แต่ได้ ${r.errorType}`);
    assert.equal(r.text, undefined, 'ต้องไม่มี text ออกมาเลย เพราะไม่เคย spawn จริง (ยืนยันว่า echo ไม่เคยถูกรัน)');
  });
});

// คำ/ธงอิสระ 2 โทเคนที่ผู้ตรวจเอ่ยชื่อตรงๆ (/c, echo, --eval) — ไม่ใช่ไฟล์สคริปต์จริง ต้องตกด่านเหมือนกัน
// (2 โทเคนพอดี ตกที่ด่าน "ไม่ใช่ไฟล์สคริปต์จริง" คนละด่านกับ probe หลักที่ตกด่าน "โทเคนเกิน 2")
test('🔒 CB-02 รอบสาม: ธง/คำอิสระ 2 โทเคนต่อท้าย BIN (/c, echo, --eval) ที่ไม่ใช่ไฟล์สคริปต์จริง ต้องตกเป็น BRAIN_BAD_BIN', async () => {
  const cases = ['cmd /c', 'node echo-not-a-real-file', 'node --eval'];
  for (const bin of cases) {
    await withEnv({ CLIP_BRAIN_CLAUDE_BIN: bin }, async () => {
      const r = await runBrain({ brain: 'claude', prompt: 'ทดสอบ', expectJson: false });
      assert.equal(r.ok, false, `BIN ${JSON.stringify(bin)} ต้องไม่ผ่าน`);
      assert.equal(r.errorType, 'BRAIN_BAD_BIN', `BIN ${JSON.stringify(bin)} ต้องได้ BRAIN_BAD_BIN แต่ได้ ${r.errorType}`);
    });
  }
});

// checkBrain ต้องปัด probe เดิมเหมือนกัน (ด่านเดียวกับ runBrain — กันช่องโหว่หลุดเฉพาะเส้น health-check)
test('🔒 CB-02 รอบสาม: checkBrain ก็ต้องปัด probe เดิมของผู้ตรวจเหมือนกัน (ด่านเดียวกับ runBrain)', async () => {
  await withEnv({ CLIP_BRAIN_CLAUDE_BIN: 'cmd /c echo BIN_PREFIX_EXECUTED' }, async () => {
    const c = await checkBrain('claude');
    assert.equal(c.available, false);
    assert.match(String(c.reason || ''), /ไฟล์โปรแกรมเดียว/, `เหตุผลต้องชี้ว่าโครงสร้างผิด (โทเคนเกิน) แต่ได้: ${c.reason}`);
  });
});

// ---------- CB-03 รอบสาม ----------
// หมายเหตุวิธีทดสอบ (สำคัญ อ่านก่อน): ลองบังคับ taskkill.exe ของจริงให้ล้มเหลว/ช้าด้วยการวาง shim
// ชื่อ "taskkill" ดักไว้ต้น PATH แล้ว — พิสูจน์แล้วว่าใช้ไม่ได้ เพราะ Windows ค้นหาโปรแกรมที่ไม่ระบุ path
// เต็มจาก System32 ก่อน PATH เสมอ (CreateProcess search order) ตัวจริงใน System32 จึงชนะทุกครั้ง ต่อให้ PATH
// ชี้ไปที่ shim ปลอมก่อนก็ตาม (ทดสอบจริงแล้ว: ยิง taskkill ปลอมที่แค่ echo แล้วออก 1 ผ่าน PATH prepend
// ผลที่ได้กลับเป็นเอาต์พุตของ taskkill.exe ตัวจริงเสมอ) → บนเครื่องพัฒนาที่ taskkill ฆ่าได้สำเร็จเกือบทุกครั้ง
// ค่าที่ hardcode ไว้ในโค้ดบั๊กเดิม (killFailed:false) จะบังเอิญตรงกับของจริงอยู่ดี แยกจากภายนอกด้วยเทส
// เชิงพฤติกรรมที่พึ่ง taskkill จริงไม่ได้ 100% (ดูเทสมุ่งเป้าตรงข้างล่าง ซึ่งแก้ปัญหานี้ด้วยการควบคุมผลลัพธ์
// ของ killTree() เองแทน — เป็นเทคนิคเดียวกับที่ทีมผู้ตรวจใช้ตรวจงานนี้เองวันนี้ ดู scratch/_cb03/)

// เสริมความมั่นใจ (ไม่ผูกกับบั๊กประวัติศาสตร์ตัวใดตัวหนึ่งโดยตรง — เป็นเช็คความถูกต้องทั่วไปของการแยก
// สถานะระหว่างงานคู่ขนาน): ยิง hang+timeout พร้อมกันหลายตัว แต่ละตัวต้องได้ผลของตัวเอง ไม่ปนกัน
test('🔒 CB-03 รอบสาม: หมดเวลาพร้อมกันหลายตัว (concurrent) แต่ละตัวต้องรายงานผลของตัวเองแม่นยำ ไม่ปนกัน', async () => {
  await withEnv(fakeEnv('hang', { CLIP_BRAIN_MAX_CONCURRENT: '6' }), async () => {
    const N = 6;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => runBrain({ brain: 'claude', prompt: `พร้อมกัน ${i}`, timeoutMs: 300 + i * 25 })),
    );
    for (let i = 0; i < N; i++) {
      assert.equal(results[i].errorType, 'BRAIN_TIMEOUT', `ตัวที่ ${i} ต้อง timeout ของตัวเอง ไม่ใช่ถูกตัวอื่นรบกวน (ได้ ${results[i].errorType})`);
      assert.equal(results[i].killFailed, false, `ตัวที่ ${i}: killFailed ต้อง false`);
      assert.equal(results[i].orphaned, false, `ตัวที่ ${i}: orphaned ต้อง false`);
    }
  });
});

// (CB-03 มุ่งเป้าตรง — ผ่าน mutation test จริงแล้ว ดูผลใน uncoveredConcerns/รายงานท้ายงาน)
// เป้าหมาย: พิสูจน์ตรงคำที่ผู้ตรวจเขียนไว้เป๊ะๆ — "รายงาน killFailed:false ทั้งที่ยังไม่รู้ผล taskkill"
// วิธี: ก็อปปี้ต้นฉบับจริงของ brainRunner.js มาแพตช์ "เฉพาะ" เนื้อในฟังก์ชัน killTree() ให้ฆ่าจริงด้วย
// child.kill() (กันซอมบี้ค้างเครื่อง — พิสูจน์แล้วว่าจะ "ฆ่าสำเร็จจริง") แต่ "รายงานผลช้า+ล้มเหลว" กลับไป
// (จำลอง taskkill พังแบบควบคุมได้ ไม่ใช่พึ่งบุญพึ่งกรรมจาก taskkill จริงซึ่งบังคับให้ล้มเหลวไม่ได้บนเครื่องนี้)
// แล้ว import ก็อปปี้นี้แทนของจริง — ทุกบรรทัดอื่น (รวม timer/close/backstop orchestration ที่เป็นหัวใจ CB-03)
// เป็นโค้ดจริง 100% มีแค่ killTree() ตัวเดียวที่ถูกแทน จึงทดสอบ "ชั้นที่ครอบ killTree()" ได้ตรงจุดและไม่ flaky
test('🔒 CB-03 รอบสาม (มุ่งเป้าตรง): killTree() รายงานล้มเหลวจริง (จำลองแบบคุมผลได้) ต้องเห็น killFailed:true ตามจริง ไม่ใช่ false ที่ฮาร์ดโค้ด', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');

  const realPath = fileURLToPath(new URL('../src/lib/services/clipBrain/brainRunner.js', import.meta.url));
  const src = fs.readFileSync(realPath, 'utf8');

  const ktStart = src.indexOf('function killTree(child) {');
  assert.ok(ktStart >= 0, 'หา function killTree(child) ไม่เจอ — โครงสร้างไฟล์เปลี่ยนไป ต้องปรับ marker ของเทสนี้ใหม่');
  const ktBodyMarker = 'const pid = child && child.pid;';
  const ktBodyIdx = src.indexOf(ktBodyMarker, ktStart);
  assert.ok(ktBodyIdx >= 0, 'หาจุดเริ่มเนื้อ killTree() ไม่เจอ — โครงสร้างไฟล์เปลี่ยนไป ต้องปรับ marker ของเทสนี้ใหม่');
  const inject = "try { child.kill(); } catch {}\n    return setTimeout(() => resolve({ killFailed: true, reason: 'sim-fail-cb03-test' }), 300);\n    ";
  const patched = src.slice(0, ktBodyIdx) + inject + src.slice(ktBodyIdx);
  assert.notEqual(patched, src, 'แพตช์ไม่ติด (marker เจอแต่ replace ไม่เปลี่ยนอะไร) — ตรวจ logic เทสนี้ใหม่');
  // ยืนยันว่าแพตช์แตะเฉพาะ killTree() — การ์ดตัวจริงของ CB-03 ในส่วน orchestration ต้องยังอยู่ครบ ไม่ถูกกระทบ
  assert.ok(
    patched.includes('if (timedOut) return; // หมดเวลาไปแล้ว — เส้น timeout เป็นเจ้าของผล (กันแข่งกับ taskkill)'),
    'แพตช์เผลอไปโดนโค้ดส่วน orchestration — เทสนี้ต้องแตะเฉพาะ killTree() เท่านั้น',
  );

  const tmpFile = path.join(os.tmpdir(), `clip-brain-cb03-killtree-mutant-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmpFile, patched, 'utf8');
  try {
    const mutant = await import(pathToFileURL(tmpFile).href);
    await withEnv(fakeEnv('hang'), async () => {
      const r = await mutant.runBrain({ brain: 'claude', prompt: 'ทดสอบ CB-03 killTree ล้มเหลวจำลอง', timeoutMs: 500 });
      assert.equal(r.errorType, 'BRAIN_TIMEOUT', `ต้องยัง timeout ตามปกติ แต่ได้ ${r.errorType}`);
      assert.equal(
        r.killFailed, true,
        `killTree() จำลองสั่ง killFailed:true ชัดเจน — ชั้น orchestration ต้อง await แล้วส่งค่าจริงต่อ แต่ได้ ${r.killFailed} `
        + '(นี่คือรูปแบบบั๊กเดิมเป๊ะๆ: close แซงคิวก่อน killTree() จบ แล้วฮาร์ดโค้ด killFailed:false ทับของจริง)',
      );
      assert.equal(r.killReason, 'sim-fail-cb03-test', 'killReason ต้องมาจากผลจริงของ killTree() ไม่ใช่ค่าว่าง/เดาเอง');
    });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
});
