/**
 * 🧪 ข้อสอบ — ถอดกฎ "เขียนให้ยาว" ยุคแรกออกจากท่อข่าว (17 ส.ค. 69)
 *
 * ตรวจ "พฤติกรรมจริง" ไม่ใช่ค้นคำในไฟล์:
 *   · ยิง callAI/callClaude เข้าเซิร์ฟเวอร์ปลอมในเครื่อง แล้วดักอ่าน system message ที่ส่งออกไปจริง
 *   · เรียกฟังก์ชันสร้างพรอมป์ตัวจริง แล้วอ่านข้อความที่มันคายออกมา
 *
 * รัน:  node scripts/test-length-rules-removal.mjs
 *
 * 🔴 กติกา "ข้อสอบต้องกัดจริง": หลังเขียนเสร็จต้องลองทำโค้ดพังแล้วดูว่าข้อสอบแดง
 *    วิธีลอง: เอาคำว่า 250 กลับไปใส่ในบรรทัดกฎที่ 5 → ข้อ 1/2 ต้องแดงทันที
 *             ลบ + '\n' ท้าย legacyLengthRule('research') ออก → ข้อ 6 ต้องแดง
 *             คืน guard VIRAL_HITS_FORMULA ของสาย TEXT เป็นของเดิม → ชุด ฌ. ต้องแดงเฉพาะทางจริง
 */
import './_alias-loader-register.mjs'; // ให้คำสั่ง node ตรงๆ รู้จัก alias @/ และ import ที่ไม่ใส่นามสกุล
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`  ✅ ${name}`); }
  else { fail++; results.push(`  ❌ ${name}${detail ? '\n       → ' + detail : ''}`); }
}

// ─── เซิร์ฟเวอร์ปลอม: ดักอ่านสิ่งที่ SDK ส่งออกไปจริง ────────────────────
let captured = null;
// 🆕 เก็บ "ทุก" request ที่ยิงออกไป — เพราะ performSummarize มี AI หลายตัว
//    (ตัวคัดตัวอย่างครูยิงก่อนเขียน · ตัวกรองคำเสี่ยงยิงหลังเขียน)
//    ถ้าอ่านตัวแปรเดียวจะได้ตัวสุดท้าย ไม่ใช่ตัวเขียน — ต้องค้นด้วยเครื่องหมายเฉพาะโหมด
const capturedAll = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try { captured = JSON.parse(body); } catch { captured = { _raw: body }; }
    if (captured) capturedAll.push(captured);
    res.writeHead(200, { 'content-type': 'application/json' });
    // ตอบให้ผ่านทั้งรูปแบบ OpenAI และ Anthropic
    res.end(JSON.stringify({
      id: 'test', model: 'test', object: 'chat.completion',
      // ⚠️ เนื้อที่ตอบต้องเป็น JSON ที่ parse ได้ ไม่งั้น callAI จะโยน error แล้วไล่ลองรุ่นถัดไปจนหมดโซ่
      choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      content: [{ type: 'text', text: '{"ok":true}' }],
      role: 'assistant', type: 'message', stop_reason: 'end_turn',
    }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

process.env.OPENAI_API_KEY = 'sk-test-fake';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${PORT}/v1`;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-fake';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${PORT}`;
delete process.env.LEGACY_LENGTH_RULES;

const R = (p) => pathToFileURL(path.resolve('src/lib', p)).href;

/** ยิงจริงแล้วคืน system message ที่ถูกส่งออกไป */
async function grabSystemMsg(which) {
  captured = null;
  try {
    if (which === 'openai') {
      const { callAI } = await import(R('ai/openai.js'));
      await callAI({ prompt: 'เขียนข่าวสั้นๆ' });
      return captured?.messages?.find((m) => m.role === 'system')?.content ?? null;
    }
    const { callClaude } = await import(R('ai/claudeClient.js'));
    await callClaude({ prompt: 'เขียนข่าวสั้นๆ' });
    const s = captured?.system;
    return typeof s === 'string' ? s : Array.isArray(s) ? s.map((b) => b?.text ?? '').join('') : null;
  } catch (e) {
    return `__ERROR__ ${e.message}`;
  }
}

console.log('\n════════ ข้อสอบ: ถอดกฎ "เขียนให้ยาว" ยุคแรก ════════\n');

// ══════════════════════════════════════════════════════════════════
console.log('▸ ชุด ก. กฎเหล็กกลางที่ส่งถึง AI จริง (โหมดปกติ = ถอดแล้ว)');

for (const side of ['openai', 'claude']) {
  const sys = await grabSystemMsg(side);
  const got = typeof sys === 'string' && !sys.startsWith('__ERROR__');
  check(`[${side}] ดักอ่าน system message ที่ส่งออกไปได้`, got, String(sys).slice(0, 160));
  if (!got) continue;

  check(`[${side}] ไม่มีคำสั่ง "อย่างน้อย 250 คำ" แล้ว`, !/250 คำ/.test(sys));
  check(`[${side}] ไม่มีโควตา "3-5 ประโยค" แล้ว`, !/3-5 ประโยค/.test(sys));
  check(`[${side}] ไม่มี "ห้ามเขียนสั้น ห้ามสรุปรวบรัด" แล้ว`, !/ห้ามเขียนสั้น/.test(sys));
  check(`[${side}] มีกรอบใหม่ 146-269 คำ`, /146-269 คำ/.test(sys));
  check(`[${side}] ยังสั่งให้ประเมินจากเนื้อข่าวดิบ`, /ประเมินจาก "เนื้อข่าวดิบที่ได้รับ"/.test(sys));
  check(`[${side}] ยังสั่ง "พอดีแล้วต้องพอ ห้ามหาคำมาเติม"`, /ห้ามหาคำมาเติม/.test(sys));
  check(`[${side}] ยังกันไม่ให้ตัดข้อเท็จจริงทิ้งเพื่อให้สั้น`, /ห้ามตัดข้อเท็จจริงสำคัญทิ้งเพื่อให้สั้น/.test(sys));
  check(`[${side}] ยังบังคับ 3 ย่อหน้า (เจ้าของสั่งเก็บไว้)`, /แบ่งเป็น 3 ย่อหน้า/.test(sys));
  // ── ของดีที่ต้องไม่หายไปด้วย ──
  check(`[${side}] 🛡️ กฎ "ห้ามตั้งคำถามปิดท้าย" ยังอยู่`, /ห้ามตั้งคำถามปิดท้าย/.test(sys));
  check(`[${side}] 🛡️ โครงสร้าง hook→storytelling→ปิด ยังอยู่`, /เปิดแรง hook/.test(sys) && /ปิดด้วยประโยคบรรยายทรงพลัง/.test(sys));
  check(`[${side}] 🛡️ หัวข้อ "กฎที่ 5" ยังอยู่ครบ ไม่ได้ถูกลบทั้งก้อน`, /\[กฎที่ 5: โครงสร้างเนื้อหา Facebook\]/.test(sys));
  check(`[${side}] 🛡️ กฎข้ออื่นไม่ถูกลูกหลง (กฎที่ 4 และ 6 ยังอยู่)`, /\[กฎที่ 4/.test(sys) && /\[กฎที่ 6/.test(sys));
}

// ══════════════════════════════════════════════════════════════════
console.log('▸ ชุด ข. สวิตช์ถอย LEGACY_LENGTH_RULES=1 ต้องคืนของเดิม "ทุกตัวอักษร"');

// 🔴 ข้อความคาดหวังต้อง "เขียนตายตัวในข้อสอบ" ห้าม import มาจากไฟล์ที่กำลังตรวจ
//    (บทเรียน 17 ส.ค. 69: รุ่นแรกผมเทียบกับค่าที่ import มาจากไฟล์เดียวกัน = แก้ไฟล์เพี้ยนแล้วข้อสอบยังเขียว
//     เพราะสองฝั่งเปลี่ยนตามกันหมด — พิสูจน์ด้วยการลองทำโค้ดพังแล้วข้อสอบไม่แดง)
//    ค่าข้างล่างคัดมาจากโค้ดก่อนแก้ (89df00a) ด้วยมือ
const EXPECT_LEGACY = {
  // ฝั่ง openai เขียน \\n\\n ในซอร์ส ⇒ AI เห็นเป็นตัวอักษร \n\n
  openai: '- เนื้อหาต้องยาวอย่างน้อย 250 คำ หรือ 3 ย่อหน้าเต็ม (แต่ละย่อหน้า 3-5 ประโยค คั่นด้วย \\n\\n)',
  // ฝั่ง claude เขียน \n\n ในซอร์ส ⇒ กลายเป็นขึ้นบรรทัดใหม่จริงกลางประโยค (ของเดิมเป็นแบบนี้)
  claude: '- เนื้อหาต้องยาวอย่างน้อย 250 คำ หรือ 3 ย่อหน้าเต็ม (แต่ละย่อหน้า 3-5 ประโยค คั่นด้วย \n\n)',
  noShort: '- ห้ามเขียนสั้น ห้ามสรุปรวบรัด ต้องเล่าเรื่องเต็มที่เหมือนโพสต์ Facebook จริง',
};

process.env.LEGACY_LENGTH_RULES = '1';

for (const side of ['openai', 'claude']) {
  const sys = await grabSystemMsg(side);
  const got = typeof sys === 'string' && !sys.startsWith('__ERROR__');
  check(`[${side}] ถอยแล้วยังยิงได้`, got, String(sys).slice(0, 160));
  if (!got) continue;
  check(`[${side}] ถอยแล้วได้บรรทัด 250 คำ "เป๊ะทุกตัวอักษร"`, sys.includes(EXPECT_LEGACY[side]),
    `คาด: ${JSON.stringify(EXPECT_LEGACY[side])}`);
  check(`[${side}] ถอยแล้วได้ "ห้ามเขียนสั้น..." กลับมาเป๊ะ`, sys.includes(EXPECT_LEGACY.noShort),
    `คาด: ${JSON.stringify(EXPECT_LEGACY.noShort)}`);
  check(`[${side}] ถอยแล้วต้องไม่มีข้อความใหม่ปนอยู่`, !/146-269 คำ/.test(sys));
}
delete process.env.LEGACY_LENGTH_RULES;

// ══════════════════════════════════════════════════════════════════
console.log('▸ ชุด ค. คำสั่งเหล็กของ MasterAgent (เส้นหลักที่ใช้จริง)');
{
  const { MasterAgent } = await import(R('agents/masterAgent.js'));
  const build = async () => {
    const a = new MasterAgent('test-len-' + Math.floor(performance.now()));
    a.onExtractionComplete?.({ newsTitle: 'หัวข่าวทดสอบ', newsBody: 'เนื้อข่าวทดสอบสั้นๆ' });
    return a.compileContext();
  };
  const off = await build();
  check('[masterAgent] ปกติ: ไม่มี "เขียนยาวอย่างน้อย 250 คำ" แล้ว', !/250 คำ/.test(off), off.slice(-300));
  check('[masterAgent] 🛡️ ปกติ: "ห้ามแต่งเพิ่ม ห้ามตัดข้อมูลสำคัญ" ยังอยู่', /ห้ามแต่งเพิ่ม ห้ามตัดข้อมูลสำคัญ/.test(off));
  check('[masterAgent] 🛡️ ปกติ: "ห้ามตั้งคำถามปิดท้าย" ยังอยู่', /ห้ามตั้งคำถามปิดท้ายเด็ดขาด/.test(off));

  process.env.LEGACY_LENGTH_RULES = '1';
  const on = await build();
  check('[masterAgent] ถอย: ได้ประโยคเดิมกลับมาเป๊ะ',
    on.includes('ห้ามตัดข้อมูลสำคัญ เขียนยาวอย่างน้อย 250 คำ หรือ 3 ย่อหน้าเต็มสำหรับ Facebook\n'), on.slice(-300));
  delete process.env.LEGACY_LENGTH_RULES;
}

// ══════════════════════════════════════════════════════════════════
console.log('▸ ชุด ง. คำสั่งเหล็กเส้นสำรอง (workflowEngine)');
{
  const { buildFullContext } = await import(R('workflow/workflowEngine.js'));
  const args = {
    newsBody: 'เนื้อข่าวทดสอบ', newsTitle: 'หัวข่าวทดสอบ',
    breakdownData: { core_story: 'เรื่องหลัก', pain_points: ['จุดเจ็บ 1'] },
  };
  const off = buildFullContext(args);
  check('[workflowEngine] ปกติ: ไม่มี "250 คำ" แล้ว', !/250 คำ/.test(off), off.slice(-260));
  check('[workflowEngine] 🛡️ ปกติ: "ห้ามข้าม ห้ามซ้ำ ห้ามแต่งเรื่องใหม่" ยังอยู่', /ห้ามข้าม ห้ามซ้ำ ห้ามแต่งเรื่องใหม่/.test(off));

  process.env.LEGACY_LENGTH_RULES = '1';
  const on = buildFullContext(args);
  check('[workflowEngine] ถอย: ได้ข้อความเดิมกลับมาเป๊ะ',
    on.includes('ห้ามแต่งเรื่องใหม่ ต้องเขียนยาวอย่างน้อย 250 คำ หรือ 3 ย่อหน้าเต็มสำหรับ Facebook (แต่ละย่อหน้า 3-5 ประโยค คั่นด้วย \n\n)'),
    on.slice(-320));
  delete process.env.LEGACY_LENGTH_RULES;
}

// ══════════════════════════════════════════════════════════════════
console.log('▸ ชุด จ. บล็อกข้อมูลรีเสิร์ช — ทั้งสาย TEXT และสาย URL (ฝาแฝดต้องตรงกัน)');
for (const [name, mod] of [['สาย TEXT', 'input-engine/narrativePayloadText.js'], ['สาย URL', 'input-engine/narrativePayload.js']]) {
  const { buildNarrativePayload, formatNarrativePayload } = await import(R(mod));
  const mk = () => formatNarrativePayload(buildNarrativePayload(
    'หัวข่าวทดสอบ',
    { core_story: 'เรื่องหลัก', pain_points: ['จุดเจ็บ'] },
    { items: [{ type: 'fact', title: 'ข้อมูลเสริม', content: 'เนื้อข้อมูล', sourceName: 'แหล่ง' }] },
    null, 'เนื้อข่าวดิบทดสอบ',
  ));
  const off = mk();
  check(`[${name}] ปกติ: ไม่มี "กฎความยาว: เขียนเนื้อหาให้ยาว" แล้ว`, !/กฎความยาว/.test(off));
  check(`[${name}] 🛡️ ปกติ: บล็อกรีเสิร์ชยังอยู่ครบ (ไม่ได้ลบเกิน)`, /คำแนะนำการใช้ข้อมูล/.test(off));
  check(`[${name}] 🛡️ ปกติ: บรรทัดว่างคั่นหัวข้อยังอยู่ (ไม่ได้ลบ \\n ติดไปด้วย)`, /โดยเด็ดขาด[^\n]*\n\n/.test(off), JSON.stringify(off.slice(-200)));

  process.env.LEGACY_LENGTH_RULES = '1';
  const on = mk();
  check(`[${name}] ถอย: ได้บรรทัดเดิมกลับมาเป๊ะ`,
    on.includes('⚠️ กฎความยาว: เขียนเนื้อหาให้ยาว ลึกซึ้ง และมีรายละเอียดที่จับใจผู้อ่าน ห้ามเขียนสรุปรวบรัดสั้นๆ\n\n'),
    JSON.stringify(on.slice(-260)));
  delete process.env.LEGACY_LENGTH_RULES;
}

// ══════════════════════════════════════════════════════════════════
console.log('▸ ชุด ฉ. ฝาแฝดสองสายต้องได้กฎเดียวกัน (กันแก้ข้างเดียว)');
{
  const a = await grabSystemMsg('openai');
  const b = await grabSystemMsg('claude');
  const pick = (s) => (String(s).match(/\[กฎที่ 5[\s\S]*?(?=\n\[กฎที่ 6)/) || [''])[0];
  const ka = pick(a).replace(/\s+/g, ' ').trim();
  const kb = pick(b).replace(/\s+/g, ' ').trim();
  check('[ฝาแฝด] กฎที่ 5 ของสองฝั่งเหมือนกันแล้ว', ka === kb && ka.length > 50,
    `openai=${ka.slice(0, 120)}\n       claude=${kb.slice(0, 120)}`);
}

// ══════════════════════════════════════════════════════════════════
// ▸ ชุด ช. พรอมป์เขียนโหมด analyze/mix
//   🐛 จุดตาบอดที่ผู้ตรวจ gpt-5.6-sol จับได้ 17 ส.ค. 69: ชุด ก-ฉ ตรวจแค่ "กฎเหล็กกลาง" (system message)
//      แต่คำสั่งความยาวตัวจริงอยู่ใน "ใบสั่งงาน" (user message) ของท่อ analyze/mix ซึ่งไม่เคยถูกตรวจเลย
//      ⇒ ผ่าน 50/50 ได้ทั้งที่ "250 คำ" กับ "3-5 ประโยค" ยังอยู่ในท่อหลัก
//   วิธีที่ใช้ (ออกแบบโดยเอเจนท์ claude-opus-4-8 "โอปุส4.8" ในทีมพอดี):
//      ยิงผ่าน performSummarize ตัวจริง แล้วดักอ่าน user message ที่ส่งถึงตัวเขียน
//      · ส่ง presetPrompt เข้าไป = ข้ามตัววิเคราะห์ DNA/ตัวให้คะแนน/ตัวเลือกการ์ด → เหลือ AI ตัวเดียวคือตัวเขียน
//      · ไม่ส่ง workflowId = ไม่แตะฐานข้อมูล
console.log('▸ ชุด ช. ใบสั่งงานของตัวเขียน (โหมด analyze/mix) — จุดที่เคยตาบอด');

delete process.env.LEGACY_LENGTH_RULES;

/** ดึงข้อความฝั่ง user ออกจาก request (รองรับทั้งรูปแบบ OpenAI และ Anthropic) */
function userMsgText(body) {
  const msgs = body?.messages || [];
  let out = '';
  for (const m of msgs) {
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') out += m.content + '\n';
    else if (Array.isArray(m.content)) out += m.content.map((c) => c?.text || '').join('\n') + '\n';
  }
  return out;
}
/** ค้น request ที่เป็น "ตัวเขียน" ด้วยเครื่องหมายเฉพาะโหมด — ตรวจพฤติกรรม ไม่ได้ค้นไฟล์ */
function findWritePrompt(marker) {
  for (const body of capturedAll) {
    const t = userMsgText(body);
    if (t.includes(marker)) return t;
  }
  return null;
}

// อินพุตทดสอบ — จงใจไม่มีเลข 250 และไม่มีคำว่า "ประโยค" ในเนื้อ
// ⇒ ถ้าเจอในใบสั่งงาน แปลว่ามาจากกฎในโค้ด ไม่ใช่มาจากข่าว
const PRESET = {
  id: 'test-preset', promptName: 'ข้อสอบ-พรีเซ็ต', category: 'ทั่วไป',
  emotionalType: 'สาระ', viralScore: 70,
  promptText: 'เขียนแบบเล่าเรื่องอบอุ่น เคารพข้อเท็จจริง',
};
const BODY = 'ครูสมชายสอนหนังสือมาสามสิบปี วันสุดท้ายก่อนเกษียณ นักเรียนเก่ากลับมาหา บรรยากาศอบอุ่นทั้งโรงเรียน เขายิ้มทั้งน้ำตา';
const TITLE = 'ครูเกษียณ ศิษย์เก่ากลับมากอด';
const BREAKDOWN = {
  core_story: 'ครูเกษียณ ศิษย์กลับมาหา', pain_points: ['จากกันด้วยความรัก'],
  possible_angles: [{ angle_name: 'ความผูกพันครู-ศิษย์', facebook_viral_score: 9, description: 'ศิษย์เก่ากลับมา', target_emotion: 'ซึ้ง', share_trigger: 'อยากขอบคุณครู' }],
  key_points: [{ point: 'สอนมา 30 ปี', importance: 'สูง', emotional_value: 'ซึ้ง', detail: 'ทุ่มเททั้งชีวิต' }],
};
const MARK_ANALYZE = '=== คำสั่งสำคัญสำหรับการเขียน ===';
const MARK_MIX = '=== คำสั่ง: AI ผสมมุมข่าว (MIX MODE) ===';

function assertWritePrompt(tag, msg) {
  const found = typeof msg === 'string' && msg.length > 0;
  check(`[${tag}] ดักอ่านใบสั่งงานของตัวเขียนได้จริง`, found, found ? '' : 'ไม่พบ request ที่มีเครื่องหมายตัวเขียน');
  if (!found) return;
  check(`[${tag}] ไม่มีพื้นความยาว "250 คำ" แล้ว`, !/250/.test(msg), (msg.match(/.{0,15}250.{0,15}/) || [''])[0]);
  // ⚠️ ต้องจับเฉพาะ "โควตาประโยคต่อย่อหน้าของตัวข่าว" เท่านั้น
  //    ห้ามเหวี่ยงแหจับ \d-\d ประโยค ทั้งหมด เพราะยังมีของที่ถูกต้องอยู่และต้องไม่ลบ:
  //      · `news_reference: "สรุปข่าวต้นฉบับ 2-3 ประโยค"` = ช่องสรุปอ้างอิง ไม่ใช่ตัวข่าว
  //      · `BRIDGES — ประโยคเชื่อมระหว่างประเด็น (3-5 ประโยค)` = ขั้นแตกประเด็น งานวิเคราะห์ภายใน
  //    (รุ่นแรกของข้อสอบเหวี่ยงแหแล้วขึ้นแดงทั้งที่โค้ดถูก — เจอตอนรันจริง 17 ส.ค. 69)
  //      · `ทุกย่อหน้าต้องมี "ประโยคทุบ" ... อย่างน้อย 1 ประโยค` = กฎลายมือการเขียน (PROSE CRAFT)
  //        ⇒ นี่คือ "สำนวนสวย" ที่เจ้าของสั่งให้เก็บไว้ ไม่ใช่ตัวดันความยาว — ห้ามจับ
  //    ⇒ จับเฉพาะโควตาที่บังคับ "หลายประโยค" ต่อย่อหน้า (อย่างน้อย 2 ขึ้นไป หรือเป็นช่วง เช่น 3-5)
  const quotaRe = /(แต่ละย่อหน้า|ย่อหน้าต้องมี|ทุกย่อหน้า)[\s\S]{0,30}อย่างน้อย\s*(\d\s*-\s*\d|[2-9])\s*ประโยค/;
  check(`[${tag}] ไม่มีโควตา "แต่ละย่อหน้าอย่างน้อย x ประโยค" แล้ว`, !quotaRe.test(msg),
    (msg.match(new RegExp('.{0,40}' + quotaRe.source)) || [''])[0]);
  check(`[${tag}] ยังบังคับ "3 ย่อหน้า" อยู่ (เจ้าของสั่งเก็บ)`, /3 ย่อหน้า/.test(msg));
  // 🔴 เฟเบิ้ลจับได้ 17 ส.ค.: วรรคย้ำท้ายพรอมป์ "ความยาวตามที่กำหนด" เป็นคำสั่งลอย
  //    (ชี้ไปหาเลขที่ถอดออกไปแล้ว) และอยู่ตำแหน่งที่โมเดลให้น้ำหนักสูงสุด
  check(`[${tag}] ไม่มีคำสั่งลอย "ความยาวตามที่กำหนด" แล้ว`, !/ความยาวตามที่กำหนด/.test(msg),
    (msg.match(/.{0,50}ความยาวตามที่กำหนด/) || [''])[0]);
  check(`[${tag}] ยังกันไม่ให้ตัดข้อเท็จจริงทิ้งเพื่อให้สั้น`,
    /ห้ามตัด[\s\S]{0,25}ข้อเท็จจริง[\s\S]{0,60}สั้น/.test(msg),
    'ต้องมีวรรคทำนอง "ห้ามตัดข้อเท็จจริงสำคัญทิ้งเพื่อให้สั้น"');
}

for (const [tag, modPath, srcType] of [
  ['analyze/TEXT', 'services/summarizeServiceText.js', 'text'],
  ['analyze/URL', 'services/summarizeService.js', 'url'],
]) {
  capturedAll.length = 0;
  try {
    const { performSummarize } = await import(R(modPath));
    await performSummarize({ text: BODY, newsTitle: TITLE, breakdownData: BREAKDOWN, mode: 'analyze', sourceType: srcType, presetPrompt: PRESET, targetCount: 2 });
  } catch { /* ใบสั่งงานถูกดักไว้แล้วก่อน error ปลายทาง — ตรวจต่อได้ */ }
  assertWritePrompt(tag, findWritePrompt(MARK_ANALYZE));
}

for (const [tag, modPath, srcType] of [
  ['mix/TEXT', 'services/summarizeServiceText.js', 'text'],
  ['mix/URL', 'services/summarizeService.js', 'url'],
]) {
  capturedAll.length = 0;
  try {
    const { performSummarize } = await import(R(modPath));
    await performSummarize({ text: BODY, newsTitle: TITLE, breakdownData: BREAKDOWN, mode: 'mix', sourceType: srcType });
  } catch { /* เหมือนบน */ }
  assertWritePrompt(tag, findWritePrompt(MARK_MIX));
}

// ══════════════════════════════════════════════════════════════════
// ▸ ชุด ซ. สวิตช์ถอยเมื่อ "เปิดคู่กับสวิตช์อื่น"
//   🐛 ผู้ตรวจ gpt-5.6-sol จับได้ 17 ส.ค. 69 (มั่นใจ 97%): ชุด ก-ช ทดสอบสวิตช์ถอย "เดี่ยวๆ" เท่านั้น
//      ⇒ ผ่าน 74/74 ได้ทั้งที่ถอยพังจริงเมื่อเปิดคู่กับ THIN_SOURCE_2PARA / LENGTH_BY_CONTENT
//      บั๊กที่หลุด: ค่าข่าวบางถูกแก้ไว้นอกสวิตช์ ⇒ ถอยแล้วได้ประโยคพิการ
//      "- แต่ละย่อหน้าต้องมีอย่างน้อย  ประโยค" (ช่องประโยคว่าง) ส่งถึง AI จริง
//   🔴 กติกาใหม่: สวิตช์ถอยต้องทดสอบ "ทุกคู่" ไม่ใช่ทดสอบเดี่ยว
console.log('▸ ชุด ซ. สวิตช์ถอยเปิดคู่กับสวิตช์อื่น (จุดที่ sol จับได้)');

const { sentenceQuotaLine, lengthLineAnalyze, lengthLineMix, analyzeJsonContentHint } =
  await import(R('ai/legacyLengthRules.js'));

// ค่าที่ถูกต้องคัดมาจากโค้ดฐาน 89df00a ด้วยมือ — ห้าม import จากไฟล์ที่กำลังตรวจ
const CFG_NORMAL = { min: 165, max: 350, paragraphs: '3', paraDesc: '3 ย่อหน้า', sentences: '3-5' };

// 🗑️ 17 ส.ค. 69: ด่าน "ถอย/ปกติ + ข่าวบาง" (thinSourceLenCfg) ถูกถอด — เจ้าของสั่งลบสวิตช์
//    THIN_SOURCE_2PARA ทั้งก้อน ("ลบทิ้งเลยกันพลาด") · ด่านแทนอยู่ท้ายชุด ฌ.:
//    "ตั้งสวิตช์แล้วต้องไร้ผลจริง" · ของเดิมดูที่ *.bak-fb หรือ commit ก่อนลบ

// ── ถอย + LENGTH_BY_CONTENT (ของเดิมมีทางแยก 2 ขา ต้องคืนให้ครบทั้งคู่) ──
process.env.LEGACY_LENGTH_RULES = '1';
for (const [tag, byContent, expectAnalyze, expectMix, expectJson] of [
  ['ปิด', undefined,
    'ความยาวบังคับ 165-350 คำ',
    'ต้องยาวอย่างน้อย 165 คำ ถึง 350 คำ',
    'เนื้อหายาว 165-350 คำ'],
  ['เปิด', '1',
    'ความยาว: เล่าให้ครบทุกประเด็นสำคัญจากต้นฉบับเป็นหลัก สูงสุดไม่เกิน 350 คำ — เนื้อน้อยเขียนสั้นได้ ห้ามยืดความ/เติมสิ่งที่ต้นฉบับไม่มีเพื่อให้ยาวขึ้น',
    'ความยาวตามเนื้อจริง สูงสุดไม่เกิน 350 คำ — ครบทุกประเด็นสำคัญ ห้ามยืดความ',
    'เนื้อหาครบทุกประเด็นสำคัญ ไม่เกิน 350 คำ'],
]) {
  if (byContent) process.env.LENGTH_BY_CONTENT = byContent; else delete process.env.LENGTH_BY_CONTENT;
  check(`[ถอย+LENGTH_BY_CONTENT ${tag}] analyze คืนของเดิมเป๊ะ`, lengthLineAnalyze(CFG_NORMAL) === expectAnalyze,
    JSON.stringify(lengthLineAnalyze(CFG_NORMAL)));
  check(`[ถอย+LENGTH_BY_CONTENT ${tag}] mix คืนของเดิมเป๊ะ`, lengthLineMix(CFG_NORMAL) === expectMix,
    JSON.stringify(lengthLineMix(CFG_NORMAL)));
  check(`[ถอย+LENGTH_BY_CONTENT ${tag}] ตัวอย่าง JSON คืนของเดิมเป๊ะ`, analyzeJsonContentHint(CFG_NORMAL) === expectJson,
    JSON.stringify(analyzeJsonContentHint(CFG_NORMAL)));
}
delete process.env.LEGACY_LENGTH_RULES;
delete process.env.LENGTH_BY_CONTENT;

// ── โหมดปกติต้องไม่สนใจ LENGTH_BY_CONTENT (สวิตช์เก่าถูกยกเป็นค่าปกติแล้ว) ──
{
  const a1 = lengthLineAnalyze(CFG_NORMAL);
  process.env.LENGTH_BY_CONTENT = '1';
  const a2 = lengthLineAnalyze(CFG_NORMAL);
  delete process.env.LENGTH_BY_CONTENT;
  check('[ปกติ] LENGTH_BY_CONTENT ไม่มีผลแล้ว (ยกเป็นค่าปกติ)', a1 === a2 && /ประเมินจากเนื้อข่าวดิบ/.test(a1));
}

// ══════════════════════════════════════════════════════════════════
// ▸ ชุด ฌ. สวิตช์ทุกตัวต้องผ่าน performSummarize จริง
//   ชุด ซ. ด้านบนเก็บ unit test ของ helper ไว้เพื่อชี้ต้นเหตุเร็ว แต่ด่านนี้ตรวจ call site จริง
//   ถ้าวันหน้า TEXT/URL หลุดกลับไปใช้ค่า inline ข้อสอบต้องแดง แม้ helper จะยังตอบถูกก็ตาม
console.log('▸ ชุด ฌ. สวิตช์ผ่าน performSummarize จริง (กัน call site หลุดกลับ inline)');

const SWITCH_ENV_KEYS = [
  // THIN_SOURCE_2PARA ถูกลบจากโค้ดแล้ว (17 ส.ค. 69) — คงชื่อไว้ในลิสต์ล้าง env กันค่าค้างจาก shell
  'LEGACY_LENGTH_RULES', 'THIN_SOURCE_2PARA', 'LENGTH_BY_CONTENT',
  'ALLOW_SIMULATION', 'VIRAL_HITS_FORMULA', 'WORD_FLEX_V2',
  'WORD_FLOOR', 'WORD_CAP_BASE', 'WORD_CAP_RATIO', 'WORD_CAP_MAX',
];

function setSwitchEnv(values = {}) {
  for (const key of SWITCH_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) process.env[key] = String(value);
  }
}

const REAL_PIPELINES = [
  { tag: 'TEXT', modPath: 'services/summarizeServiceText.js', sourceType: 'text', legacyLongPara: '6-8 ย่อหน้า' },
  { tag: 'URL', modPath: 'services/summarizeService.js', sourceType: 'url', legacyLongPara: '3-5 ย่อหน้า' },
];

const RICH_BREAKDOWN = {
  ...BREAKDOWN,
  key_points: Array.from({ length: 6 }, (_, i) => ({
    point: `ข้อเท็จจริงทดสอบ ${i + 1}`,
    importance: 'สูง',
    emotional_value: 'ซึ้ง',
    detail: `รายละเอียดจริงลำดับ ${i + 1}`,
  })),
};
const LONG_BODY = `${BODY} `.repeat(6);

async function captureRealWritePrompt({
  pipe,
  mode = 'analyze',
  body = BODY,
  breakdownData = BREAKDOWN,
  contentLength = 'short',
}) {
  capturedAll.length = 0;
  const originalLog = console.log;
  console.log = () => {}; // ลด noise เท่านั้น — request จริงยังถูกเซิร์ฟเวอร์ปลอมดักครบ
  try {
    const { performSummarize } = await import(R(pipe.modPath));
    const args = {
      text: body,
      newsTitle: TITLE,
      breakdownData,
      mode,
      sourceType: pipe.sourceType,
      contentLength,
      targetCount: 2,
    };
    if (mode === 'analyze') args.presetPrompt = PRESET;
    try { await performSummarize(args); } catch { /* ดัก prompt ก่อน error ปลายทางแล้ว */ }
  } finally {
    console.log = originalLog;
  }
  return findWritePrompt(mode === 'mix' ? MARK_MIX : MARK_ANALYZE);
}

async function capturedOrEmpty(tag, args) {
  const msg = await captureRealWritePrompt(args);
  check(`[${tag}] ดักใบสั่งงานผ่าน performSummarize ได้`, typeof msg === 'string' && msg.length > 0);
  return msg || '';
}

// ── 🗑️ THIN_SOURCE_2PARA ถูกลบทั้งบล็อก 17 ส.ค. 69 (เจ้าของ: "ลบทิ้งเลยกันพลาด") ──
//    เหตุผล: ปัญหาข่าวบางพองแก้ที่รากแล้ว (ถอดกฎบังคับยาว — ข่าวดิบ 92 คำ → เขียน 211/236 คำ
//    เจ้าของอ่านแล้วว่า "กระชับดี") และเพดาน 160 ขัดกับผลที่เจ้าของเพิ่งรับ
//    ด่านนี้จึงกลับทิศ: ตั้งสวิตช์แล้ว "ต้องไร้ผลจริง" ทุกโหมด — ใบสั่งงานเหมือนไม่ตั้ง ไบต์ต่อไบต์
//    (ของเดิมก่อนลบ: commit 89df00a หรือ *.bak-fb)
for (const pipe of REAL_PIPELINES) {
  setSwitchEnv();
  const plain = await capturedOrEmpty(`จริง/ฐานไม่ตั้งสวิตช์/${pipe.tag}`, { pipe });
  setSwitchEnv({ THIN_SOURCE_2PARA: '1' });
  const flagged = await capturedOrEmpty(`จริง/THIN_SOURCE_2PARA=1 หลังลบ/${pipe.tag}`, { pipe });
  check(`[ลบสวิตช์ข่าวบาง/${pipe.tag}] ตั้งค่าแล้วใบสั่งงานเหมือนไม่ตั้ง (สวิตช์ตายจริง)`,
    plain.length > 0 && plain === flagged);
  check(`[ลบสวิตช์ข่าวบาง/${pipe.tag}] ไม่มีร่องรอยเพดาน 160 / 2 ย่อหน้า`,
    !flagged.includes('สูงสุดไม่เกิน 160 คำ') && !flagged.includes('แบ่ง 2 ย่อหน้า ตามนี้เท่านั้น'));

  setSwitchEnv({ LEGACY_LENGTH_RULES: '1' });
  const legacyPlain = await capturedOrEmpty(`จริง/ถอยล้วน/${pipe.tag}`, { pipe });
  setSwitchEnv({ LEGACY_LENGTH_RULES: '1', THIN_SOURCE_2PARA: '1' });
  const legacyFlagged = await capturedOrEmpty(`จริง/ถอย+THIN หลังลบ/${pipe.tag}`, { pipe });
  check(`[ลบสวิตช์ข่าวบาง/${pipe.tag}] โหมดถอยก็ไร้ผลเหมือนกัน (ไม่มีซากครึ่งทาง)`,
    legacyPlain.length > 0 && legacyPlain === legacyFlagged);
}

// ── LENGTH_BY_CONTENT: โหมดปกติใช้หลักใหม่ แต่โหมดถอยคืนทางแยกเดิม ──
for (const legacy of [false, true]) {
  setSwitchEnv({
    LENGTH_BY_CONTENT: '1',
    WORD_FLEX_V2: '0',
    ...(legacy ? { LEGACY_LENGTH_RULES: '1' } : {}),
  });
  for (const pipe of REAL_PIPELINES) {
    for (const mode of ['analyze', 'mix']) {
      const tag = `จริง/${legacy ? 'ถอย' : 'ปกติ'}+LENGTH_BY_CONTENT/${mode}/${pipe.tag}`;
      const msg = await capturedOrEmpty(tag, { pipe, mode });
      let expected;
      if (mode === 'analyze') {
        expected = legacy
          ? 'ความยาว: เล่าให้ครบทุกประเด็นสำคัญจากต้นฉบับเป็นหลัก สูงสุดไม่เกิน 300 คำ — เนื้อน้อยเขียนสั้นได้ ห้ามยืดความ/เติมสิ่งที่ต้นฉบับไม่มีเพื่อให้ยาวขึ้น'
          : 'ความยาว: ประเมินจากเนื้อข่าวดิบก่อนว่ามีสาระจริงมากแค่ไหน แล้วเขียนให้พอดีกับสาระที่มีจริง — สูงสุดไม่เกิน 300 คำ';
      } else {
        expected = legacy
          ? 'ความยาวตามเนื้อจริง สูงสุดไม่เกิน 300 คำ — ครบทุกประเด็นสำคัญ ห้ามยืดความ / 3 ย่อหน้า'
          : 'ความยาวตามเนื้อจริง สูงสุดไม่เกิน 300 คำ — ครบทุกประเด็นสำคัญ ห้ามยืดความ ห้ามเติมคำเพื่อให้ยาว · แต่ห้ามตัดข้อเท็จจริงสำคัญทิ้งเพื่อให้สั้น — ครบก่อน แล้วค่อยกระชับ / 3 ย่อหน้า';
      }
      check(`[${tag}] ใบสั่งงานใช้ทางแยกที่ถูกต้อง`, msg.includes(expected), expected);
    }
  }
}

// ── ALLOW_SIMULATION: TEXT ช่วยอธิบายได้แต่ห้ามแต่ง; URL ไม่มีสวิตช์แฝด ──
const SIMULATION_OLD = '✅ **อนุญาตให้ยกตัวอย่างสถานการณ์จำลอง (Simulation) ที่สอดคล้องกับบริบท เพื่อขยายความให้ครบ 250 คำได้ โดยเฉพาะกรณีที่เป็นนโยบายหรือข้อความเชิงวิชาการ**';
const SIMULATION_NEW = '✅ **สำหรับข่าวนโยบายหรือข้อความเชิงวิชาการ ให้อธิบายหลักการ ผลกระทบ และความสำคัญจากข้อเท็จจริงหรือบริบทที่ให้มาเพื่อให้เข้าใจง่ายขึ้น แต่ห้ามสร้างสถานการณ์จำลอง บุคคล คำพูด หรือรายละเอียดที่ข่าวไม่ได้ให้มา และพอดีแล้วต้องพอ ห้ามหาคำมาเติม**';

for (const legacy of [false, true]) {
  setSwitchEnv({ ALLOW_SIMULATION: '1', ...(legacy ? { LEGACY_LENGTH_RULES: '1' } : {}) });
  for (const pipe of REAL_PIPELINES) {
    const tag = `จริง/${legacy ? 'ถอย' : 'ปกติ'}+ALLOW_SIMULATION/${pipe.tag}`;
    const msg = await capturedOrEmpty(tag, { pipe });
    if (pipe.tag === 'TEXT') {
      check(`[${tag}] ได้ข้อความ ${legacy ? 'เดิม' : 'ใหม่'} ตรงจุด`,
        msg.includes(legacy ? SIMULATION_OLD : SIMULATION_NEW));
      check(`[${tag}] ไม่มีข้อความอีกขาปน`,
        !msg.includes(legacy ? SIMULATION_NEW : SIMULATION_OLD));
    } else {
      check(`[${tag}] สาย URL ไม่มีใบอนุญาตจำลองที่ไม่มีอยู่เดิม`,
        !msg.includes(SIMULATION_OLD) && !msg.includes(SIMULATION_NEW));
      check(`[${tag}] FACT SAFETY ของ URL ยังอยู่`,
        msg.includes('ถ้าข้อมูลไม่พอ ให้เขียนกว้าง ๆ แทนการแต่งรายละเอียด'));
    }
  }
}

// ── VIRAL_HITS_FORMULA=0: ปกติยัง 3 ย่อหน้า; ถอยคืน medium/long เดิม ──
for (const legacy of [false, true]) {
  setSwitchEnv({
    VIRAL_HITS_FORMULA: '0',
    WORD_FLEX_V2: '0',
    ...(legacy ? { LEGACY_LENGTH_RULES: '1' } : {}),
  });
  for (const pipe of REAL_PIPELINES) {
    for (const mode of ['analyze', 'mix']) {
      const expectedPara = legacy ? pipe.legacyLongPara : '3 ย่อหน้า';
      const conflictingPara = legacy ? '3 ย่อหน้า' : pipe.legacyLongPara;
      const expectedNeedle = mode === 'analyze'
        ? `แบ่ง ${expectedPara} ตามนี้เท่านั้น`
        : ` / ${expectedPara}\n`;
      const conflictNeedle = mode === 'analyze'
        ? `แบ่ง ${conflictingPara} ตามนี้เท่านั้น`
        : ` / ${conflictingPara}\n`;
      const tag = `จริง/${legacy ? 'ถอย' : 'ปกติ'}+VIRAL_HITS_FORMULA=0/${mode}/${pipe.tag}`;
      const msg = await capturedOrEmpty(tag, {
        pipe,
        mode,
        body: LONG_BODY,
        breakdownData: RICH_BREAKDOWN,
        contentLength: 'long',
      });
      check(`[${tag}] จำนวนย่อหน้าที่ call site ส่งจริงถูกต้อง`,
        msg.includes(expectedNeedle), expectedNeedle.trim());
      check(`[${tag}] ไม่มีคำสั่งย่อหน้าที่ขัดกันในใบสั่งงาน`,
        !msg.includes(conflictNeedle), conflictNeedle.trim());
    }
  }
}

setSwitchEnv();

console.log('\n' + results.join('\n'));
console.log(`\n════════ ผล: ผ่าน ${pass} · ตก ${fail} ════════\n`);

// 🐛 ผู้ตรวจ gpt-5.6-sol จับได้ 17 ส.ค. 69: ของเดิม server.close() แล้ว process.exit() ทันที
//    → libuv บน Windows ตายกลางทาง "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
//    ทำให้ exit code ไม่ใช่ 0 ทั้งที่ข้อสอบผ่าน 50/50 = เอาไปต่อ CI ไม่ได้
//    แก้: รอปิดเซิร์ฟเวอร์ให้เรียบร้อย + ปล่อยคิว event loop ก่อนค่อยจบ
await new Promise((r) => server.close(r));
await new Promise((r) => setTimeout(r, 50));
process.exitCode = fail ? 1 : 0;
