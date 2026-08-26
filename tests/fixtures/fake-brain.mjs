#!/usr/bin/env node
// 🧪 fake-brain.mjs — ตัวปลอมสมอง CLI สำหรับข้อสอบ brainRunner (ไม่ยิง AI จริง ไม่เผาโควตา)
// ใช้: ตั้ง CLIP_BRAIN_CLAUDE_BIN / CLIP_BRAIN_CODEX_BIN = `node <path>/fake-brain.mjs`
// เลือกพฤติกรรมผ่าน env FAKE_MODE:
//   claude-ok   ซองแบบ `claude -p --output-format json` (result เป็น JSON string + modelUsage.costUSD)
//   claude-err  ซอง error (is_error=true)
//   codex-ok    เอาต์พุตแบบ codex exec: แบนเนอร์ + JSON + "tokens used" + JSON ซ้ำท้าย
//   garbage     ข้อความไม่มี JSON
//   empty       ไม่พิมพ์อะไรเลย
//   exit2       ออกด้วยโค้ด 2 พร้อม stderr
//   hang        ค้างไม่จบ (ให้ตัวจับเวลาฆ่า)
//   quota       พ่นข้อความ "โควตาหมด" แล้วออกโค้ด 0 (ทดสอบสวิตช์สลับบัญชี)
//   by-account  ดูโฟลเดอร์บัญชีที่ได้รับ (CLAUDE_CONFIG_DIR/CODEX_HOME): ตัวที่ลงท้าย -full = โควตาหมด,
//               ตัวอื่น = ตอบสำเร็จพร้อมบอกว่าใช้บัญชีไหน (ทดสอบว่าสลับแล้วสำเร็จจริง)
// รับพรอมต์ทาง stdin แล้วสะท้อนกลับ (echo) เพื่อพิสูจน์ไทย UTF-8 ไป-กลับครบ
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  const input = Buffer.concat(chunks).toString('utf8');
  const mode = process.env.FAKE_MODE || 'claude-ok';
  if (mode === 'claude-ok') {
    const inner = JSON.stringify({ verdict: 'ok', echo: input.slice(0, 300) });
    process.stdout.write(JSON.stringify({
      type: 'result', subtype: 'success', result: inner,
      modelUsage: {
        'claude-haiku-4-5': { costUSD: 0.001 },
        'claude-sonnet-5': { costUSD: 0.0123 },
      },
      duration_ms: 42,
    }));
    process.exit(0);
  }
  if (mode === 'claude-err') {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' }));
    process.exit(0);
  }
  if (mode === 'codex-ok') {
    const j = JSON.stringify({ verdict: 'pass', echo: input.slice(0, 200) });
    process.stdout.write(`user\n${input.slice(0, 80)}\n\ncodex\n${j}\ntokens used\n6,262\n${j}\n`);
    process.exit(0);
  }
  if (mode === 'quota') {
    process.stderr.write('Claude usage limit reached. Your limit will reset at 3pm.');
    process.exit(0);
  }
  if (mode === 'by-account') {
    const dir = process.env.CLAUDE_CONFIG_DIR || process.env.CODEX_HOME || '(ไม่ได้รับโฟลเดอร์บัญชี)';
    if (/-full$/.test(dir)) {
      process.stderr.write(`Claude usage limit reached for ${dir}`);
      process.exit(0);
    }
    process.stdout.write(JSON.stringify({
      type: 'result', subtype: 'success',
      result: JSON.stringify({ verdict: 'ok', accountDir: dir }),
    }));
    process.exit(0);
  }
  if (mode === 'garbage') { process.stdout.write('ไม่มีเจสันที่นี่ 555 {พัง'); process.exit(0); }
  if (mode === 'empty') { process.exit(0); }
  if (mode === 'exit2') { process.stderr.write('boom-stderr'); process.exit(2); }
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  process.exit(0);
});
