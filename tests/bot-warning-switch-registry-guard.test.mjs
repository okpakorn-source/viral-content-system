// ★ 3 ก.ย. 69 — ยามทะเบียนสวิตช์ของงาน "ปิดปุ่ม 👍👎📌 แต่คงบรรทัดเตือน" (แก้ตามข้อติงผู้ตรวจไขว้ ข้อ 2)
//   ช่องโหว่: ตัวสแกน "สวิตช์ไม่ลงทะเบียน" ใน tests/news-switch-registry.test.mjs ไม่ครอบ discord-bot
//   (ไฟล์บอทอยู่นอกชุดสแกน — เทียบเฉพาะชื่อที่อยู่ในทะเบียนแล้ว ดูคอมเมนต์หัว newsSwitches.js) →
//   ถ้าสายทะเบียนแก้ default ของ BOT_REVIEW_REACTIONS เป็น '0' แล้วลืมเพิ่มรายการ BOT_RESULT_WARNINGS
//   จะไม่มีเทสตัวไหนจับได้เลย — ไฟล์นี้ปิดช่องนั้น
//
//   ออกแบบให้ "เขียววันนี้" (3 ก.ย. 69 ทะเบียนยังรุ่นก่อนปิดปุ่ม): ตัวบังคับให้สายทะเบียนต้องอัปเดตมีอยู่แล้ว
//   คือเทสทะเบียนเดิมที่แดงเรื่อง "ค่าเริ่มต้นในทะเบียนต้องตรงโค้ด" (ทะเบียน '1' vs โค้ด '0') — ไม่ซ้ำที่นี่
//   และ "แดง" เฉพาะกรณีที่ไม่มีใครจับ:
//     · ลบรายการ BOT_REVIEW_REACTIONS ทิ้ง (ทำให้ default mismatch เงียบ เพราะบอทนอกชุดสแกน) → แดงที่นี่
//     · แก้ default ฝั่งปุ่มเป็น '0' แล้ว แต่ BOT_RESULT_WARNINGS ไม่ลงทะเบียน / ลงผิดสเปก → แดงที่นี่
//   เทสนี้ตรวจเฉพาะช่องกลไก (default/values/readBy/kind/group/rollback มีวิธีปิด) — ข้อความ meaning/docs
//   (docs/NEWS-ROLLBACK.md:20 · docs/NEWS-SWITCHES.md:185) เป็นงานสายทะเบียนตามเช็คลิสต์ในรายงานมือเขียน
//
//   สเปกที่สายทะเบียนต้องลง (มือเขียนส่ง 3 ก.ย. 69 — ตรงกับโค้ด discord-bot/index.js:20 envFlag('BOT_RESULT_WARNINGS', true)):
//     { name: 'BOT_RESULT_WARNINGS', default: '1', values: ['0','1'], readBy: ['discord-bot/index.js'],
//       group: 'บอทดิสคอร์ด (discord-bot)', kind: 'switch', since: 3 ก.ย. 69, rollback: 'BOT_RESULT_WARNINGS=0 → …' }
//   ห้ามแก้เทสนี้ให้ผ่าน — ให้ลงทะเบียนตามสเปก
//   รัน: node --test tests/bot-warning-switch-registry-guard.test.mjs
//
// พิสูจน์ว่ากัด: ทุบผ่านอาร์เรย์สังเคราะห์ในเทสแรก (ไฟล์ทะเบียนจริงเป็นของสายทะเบียน — สายบอทห้ามแตะแม้ชั่วคราว)
//   ครอบทุกทางพัง: ลืมเพิ่ม · default ผิด · values ผิด · readBy ไม่มีไฟล์บอท · kind/group ผิด · rollback ไม่บอกวิธีปิด ·
//   ลบรายการปุ่ม · readBy ฝั่งปุ่มหลุด — ทุกตัวต้องเจอปัญหา · ลงครบตามสเปกต้องผ่าน
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEWS_SWITCHES } from '../src/lib/config/newsSwitches.js';

const BOT_FILE = 'discord-bot/index.js';
const SPEC = Object.freeze({
  name: 'BOT_RESULT_WARNINGS',
  default: '1',
  values: Object.freeze(['0', '1']),
  kind: 'switch',
  group: 'บอทดิสคอร์ด (discord-bot)',
});

/** ตรวจรายการสวิตช์หมวดบอทของงานนี้ → คืนรายการปัญหา ([] = ผ่าน) — ฟังก์ชันล้วน เพื่อทุบพิสูจน์ด้วยอาร์เรย์สังเคราะห์ได้ */
function checkBotSwitchRows(rows) {
  const problems = [];
  const buttons = rows.find((r) => r && r.name === 'BOT_REVIEW_REACTIONS');
  if (!buttons) {
    problems.push("BOT_REVIEW_REACTIONS หายจากทะเบียน — ห้ามลบรายการ (ไฟล์บอทอยู่นอกชุดสแกน ลบแล้วเทสเทียบ default กับโค้ดจะเงียบ) ให้แก้ default เป็น '0' ตามสเปกแทน");
    return problems;
  }
  if (!Array.isArray(buttons.readBy) || !buttons.readBy.includes(BOT_FILE)) {
    problems.push(`BOT_REVIEW_REACTIONS.readBy ต้องมี ${BOT_FILE} (หลุดแล้วเทสทะเบียนเลิกเทียบ default กับโค้ดบอท)`);
  }
  // ทะเบียนยังรุ่นก่อนปิดปุ่ม (default != '0') → ยังไม่ตรวจครึ่งหลัง — ตัวบังคับให้อัปเดตคือเทสทะเบียนเดิม (default ไม่ตรงโค้ด = แดงอยู่แล้ว)
  if (buttons.default !== '0') return problems;
  const warn = rows.find((r) => r && r.name === SPEC.name);
  if (!warn) {
    problems.push(`ทะเบียนแก้ BOT_REVIEW_REACTIONS เป็น default '0' แล้ว แต่ยังไม่มีรายการ ${SPEC.name} — สองอย่างนี้ต้องลงคู่กัน (เจ้าของต้องมีสวิตช์ปิดบรรทัดเตือนคืน · สเปก: ${JSON.stringify({ ...SPEC, values: [...SPEC.values], readBy: [BOT_FILE] })})`);
    return problems;
  }
  if (warn.default !== SPEC.default) {
    problems.push(`${SPEC.name}.default ต้องเป็น '${SPEC.default}' ให้ตรงโค้ด envFlag('BOT_RESULT_WARNINGS', true) ใน ${BOT_FILE} — ทะเบียนให้ '${warn.default}'`);
  }
  if (JSON.stringify(warn.values) !== JSON.stringify([...SPEC.values])) {
    problems.push(`${SPEC.name}.values ต้องเป็น ['0','1'] (envFlag รับเฉพาะ '0'/'1' ตรงตัว) — ทะเบียนให้ ${JSON.stringify(warn.values)}`);
  }
  if (!Array.isArray(warn.readBy) || !warn.readBy.includes(BOT_FILE)) {
    problems.push(`${SPEC.name}.readBy ต้องมี ${BOT_FILE} (ไฟล์เดียวที่อ่านสวิตช์นี้)`);
  }
  if (warn.kind !== SPEC.kind) problems.push(`${SPEC.name}.kind ต้องเป็น '${SPEC.kind}' — ทะเบียนให้ '${warn.kind}'`);
  if (warn.group !== SPEC.group) problems.push(`${SPEC.name}.group ต้องเป็น '${SPEC.group}' (หมวดเดียวกับสวิตช์บอทตัวอื่น) — ทะเบียนให้ '${warn.group}'`);
  if (typeof warn.meaning !== 'string' || warn.meaning.trim() === '') problems.push(`${SPEC.name}.meaning ต้องไม่ว่าง`);
  if (typeof warn.rollback !== 'string' || !warn.rollback.includes('BOT_RESULT_WARNINGS=0')) {
    problems.push(`${SPEC.name}.rollback ต้องบอกวิธีปิดคืน 'BOT_RESULT_WARNINGS=0' — ทะเบียนให้ '${String(warn.rollback)}'`);
  }
  if (typeof warn.since !== 'string' || warn.since.trim() === '') problems.push(`${SPEC.name}.since ต้องไม่ว่าง`);
  return problems;
}

// รายการสังเคราะห์สำหรับทุบพิสูจน์ (โครงเดียวกับรายการจริงใน newsSwitches.js หมวดบอท)
const goodButtons = () => ({
  name: 'BOT_REVIEW_REACTIONS', default: '0', values: ['0', '1'], readBy: [BOT_FILE],
  group: SPEC.group, kind: 'switch', meaning: 'ปุ่มพนักงาน — คุมเฉพาะปุ่ม', since: '3 ก.ย. 69', rollback: 'BOT_REVIEW_REACTIONS=1 = ปุ่มกลับมา',
});
const goodWarn = () => ({
  name: 'BOT_RESULT_WARNINGS', default: '1', values: ['0', '1'], readBy: [BOT_FILE],
  group: SPEC.group, kind: 'switch', meaning: 'บรรทัดเตือนใต้เนื้อข่าวใน embed ผล', since: '3 ก.ย. 69', rollback: 'BOT_RESULT_WARNINGS=0 = เนื้อล้วนทุกไบต์',
});

test('ตัวตรวจกัดจริง (ทุบด้วยอาร์เรย์สังเคราะห์): ทุกทางพังต้องเจอปัญหา · ลงครบตามสเปกต้องผ่าน', () => {
  // ลงครบตามสเปก → ไม่มีปัญหา (พิสูจน์ว่าเงื่อนไขผ่านได้จริง ไม่ใช่ยามที่แดงตลอดกาล)
  assert.deepEqual(checkBotSwitchRows([goodButtons(), goodWarn()]), []);
  // สภาพทะเบียนรุ่นก่อนปิดปุ่ม (default '1' ยังไม่มี warnings) → ยามนี้ยังเงียบ (ตัวบังคับคือเทสทะเบียนเดิม)
  assert.deepEqual(checkBotSwitchRows([{ ...goodButtons(), default: '1' }]), []);
  // ครึ่งเดียว: ปุ่มเป็น '0' แล้วแต่ลืมเพิ่ม warnings → ต้องเจอ (นี่คือช่องที่ไม่มีเทสอื่นจับ)
  const half = checkBotSwitchRows([goodButtons()]);
  assert.equal(half.length, 1);
  assert.match(half[0], /ยังไม่มีรายการ BOT_RESULT_WARNINGS/u);
  // ลงแล้วแต่ผิดสเปกทีละช่อง → ต้องเจอทุกช่อง
  for (const [patch, expectRe] of [
    [{ default: '0' }, /default ต้องเป็น '1'/u],
    [{ values: ['1'] }, /values ต้องเป็น \['0','1'\]/u],
    [{ readBy: ['src/lib/other.js'] }, /readBy ต้องมี discord-bot\/index\.js/u],
    [{ kind: 'cap' }, /kind ต้องเป็น 'switch'/u],
    [{ group: 'ท่อข่าว' }, /group ต้องเป็น/u],
    [{ meaning: '  ' }, /meaning ต้องไม่ว่าง/u],
    [{ rollback: 'ปิดได้' }, /rollback ต้องบอกวิธีปิดคืน/u],
    [{ since: '' }, /since ต้องไม่ว่าง/u],
  ]) {
    const problems = checkBotSwitchRows([goodButtons(), { ...goodWarn(), ...patch }]);
    assert.equal(problems.length, 1, `patch ${JSON.stringify(patch)} ต้องเจอปัญหาเดียว: ${problems.join(' | ')}`);
    assert.match(problems[0], expectRe);
  }
  // ลบรายการปุ่มทิ้ง (ทำให้ default mismatch ในเทสทะเบียนเงียบ) → ต้องเจอ
  const gone = checkBotSwitchRows([goodWarn()]);
  assert.equal(gone.length, 1);
  assert.match(gone[0], /BOT_REVIEW_REACTIONS หายจากทะเบียน/u);
  // readBy ฝั่งปุ่มหลุด → ต้องเจอ (แม้ default ยัง '1')
  const noRead = checkBotSwitchRows([{ ...goodButtons(), default: '1', readBy: [] }]);
  assert.equal(noRead.length, 1);
  assert.match(noRead[0], /BOT_REVIEW_REACTIONS\.readBy/u);
});

test("ทะเบียนจริง: รายการปุ่มต้องไม่หาย · ทันทีที่ฝั่งปุ่มเป็น default '0' — BOT_RESULT_WARNINGS ต้องลงครบตามสเปก", () => {
  const buttons = NEWS_SWITCHES.find((r) => r && r.name === 'BOT_REVIEW_REACTIONS');
  if (buttons && buttons.default !== '0') {
    console.log(`[ยามสวิตช์บอท] ทะเบียนยังรุ่นก่อนปิดปุ่ม (BOT_REVIEW_REACTIONS default '${buttons.default}') — ตัวบังคับให้อัปเดตคือ tests/news-switch-registry.test.mjs (แดงเรื่อง default ไม่ตรงโค้ดอยู่แล้ว) · ยามไฟล์นี้จะเริ่มตรวจรายการ BOT_RESULT_WARNINGS ทันทีที่ default เป็น '0'`);
  }
  const problems = checkBotSwitchRows(NEWS_SWITCHES);
  assert.deepEqual(problems, [], `สายทะเบียนอัปเดตไม่ครบ — ห้ามแก้เทสนี้ให้ผ่าน ให้ลงทะเบียนตามสเปกในหัวไฟล์นี้/รายงานมือเขียน 3 ก.ย. 69:\n  ${problems.join('\n  ')}`);
});
