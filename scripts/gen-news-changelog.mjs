/**
 * ========================================
 * NEWS CHANGELOG + SWITCH DOC GENERATOR — ★ 2 ก.ย. 69 (ข้อ 13)
 * ========================================
 * สร้าง 2 ไฟล์จากโค้ดจริง (อ่านอย่างเดียว — ไม่แตะ/ไม่ลบคอมเมนต์ในโค้ดเด็ดขาด):
 *   docs/NEWS-CHANGELOG.md  ← คอมเมนต์ที่มีวันที่ไทย ("★ 2 ก.ย. 69", "14 ส.ค. 69", "10 มิ.ย.") ในไฟล์ท่อข่าว
 *                              เรียงวันที่ใหม่→เก่า (วันที่ · ไฟล์:บรรทัด · ข้อความคอมเมนต์ย่อ)
 *   docs/NEWS-SWITCHES.md   ← ตารางจากทะเบียน src/lib/config/newsSwitches.js
 * ใช้: node scripts/gen-news-changelog.mjs           (เขียนไฟล์)
 *      node scripts/gen-news-changelog.mjs --check   (เทียบกับไฟล์ที่มีอยู่ ถ้าต่าง exit 1 — ใช้ใน CI/ก่อน commit)
 * ผลลัพธ์กำหนดตายตัว (ไม่มี timestamp) เพื่อไม่ให้ commit เปลี่ยนทุกครั้งที่รันโดยโค้ดไม่เปลี่ยน
 * ปีที่ไม่ระบุ ("10 มิ.ย.") ถือเป็น พ.ศ. 69 (ปีที่โปรเจกต์นี้เกิด) และติดป้าย (ปีไม่ระบุ)
 * ดึงคอมเมนต์ด้วย AST (@babel/parser) — ★ 2 ก.ย. 69 ผู้ตรวจไขว้ข้อ 6: เดิมตัดด้วย regex ไม่รู้จักสตริง ('/*' ในสตริงจะกลืนโค้ด)
 * ⚠️ ใครเพิ่มคอมเมนต์มีวันที่ในไฟล์ท่อข่าว ต้องรันสคริปต์นี้ใหม่คู่กันเสมอ ไม่งั้น --check แดง (ผู้ตรวจไขว้ข้อ 2)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { DYNAMIC_ENV_READERS, NEWS_SWITCHES, NEWS_SWITCH_FILES, SECRET_ENV_RE } from '../src/lib/config/newsSwitches.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const CHANGELOG_PATH = join(DOCS, 'NEWS-CHANGELOG.md');
const SWITCHES_PATH = join(DOCS, 'NEWS-SWITCHES.md');
const CHECK_ONLY = process.argv.includes('--check');

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTH_PATTERN = THAI_MONTHS.map(month => month.replace(/\./g, '\\.?')).join('|');
// วัน (1-31) + เดือนไทยย่อ (จุดท้ายเลือกได้) + ปี (2 หลัก พ.ศ. / 4 หลัก พ.ศ. หรือ ค.ศ.) เลือกได้
const THAI_DATE_RE = new RegExp(`(?<![\\d.])(\\d{1,2})\\s*(${MONTH_PATTERN})(?:\\s*(\\d{4}|\\d{2})(?!\\d))?`, 'gu');

/** ปี → ค.ศ. เต็ม (69→2026 · 2569→2026 · 2026→2026) */
function normalizeYear(rawYear) {
  if (!rawYear) return { year: 2026, assumed: true };
  const n = Number(rawYear);
  if (rawYear.length === 2) return { year: 2500 + n - 543, assumed: false };
  if (n >= 2400) return { year: n - 543, assumed: false };
  return { year: n, assumed: false };
}

// ดึงข้อความคอมเมนต์ทุกจุดด้วย AST แล้วแตกเป็นรายบรรทัด (บล็อกคอมเมนต์ข้ามบรรทัดได้ · บรรทัดเดียวมีหลายคอมเมนต์ต่อกันด้วยช่องว่าง)
// ตัด "*" นำหน้าบรรทัดใน JSDoc ออก — ผลลัพธ์รูปเดียวกับตัวตัดแบบ regex เดิม แต่ไม่หลง '/*' หรือ '//' ที่อยู่ในสตริง
function extractCommentLines(source) {
  const { comments } = parse(source.replace(/\r\n/g, '\n'), { sourceType: 'module', plugins: ['jsx'] });
  const byLine = new Map();
  for (const comment of comments) {
    comment.value.split('\n').forEach((raw, offset) => {
      const text = raw.replace(/^\s*\*+\s?/, '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const line = comment.loc.start.line + offset;
      byLine.set(line, byLine.has(line) ? `${byLine.get(line)} ${text}` : text);
    });
  }
  return [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([line, text]) => ({ line, text }));
}

function collectEntries() {
  const entries = [];
  for (const relative of NEWS_SWITCH_FILES) {
    const absolute = join(ROOT, relative);
    if (!existsSync(absolute)) continue;
    for (const { line, text } of extractCommentLines(readFileSync(absolute, 'utf8'))) {
      const seen = new Set();
      const lineEntries = [];
      THAI_DATE_RE.lastIndex = 0;
      let match;
      while ((match = THAI_DATE_RE.exec(text))) {
        const day = Number(match[1]);
        const monthIndex = THAI_MONTHS.findIndex(month => month.replace(/\./g, '') === match[2].replace(/\./g, ''));
        if (day < 1 || day > 31 || monthIndex < 0) continue;
        const { year, assumed } = normalizeYear(match[3]);
        const key = `${year}-${monthIndex}-${day}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const be = String(year + 543).slice(-2);
        lineEntries.push({
          sortKey: year * 10000 + (monthIndex + 1) * 100 + day,
          label: `${day} ${THAI_MONTHS[monthIndex]} ${be}${assumed ? ' (ปีไม่ระบุ)' : ''}`,
          iso: `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          file: relative,
          line,
          mention: match[0].trim(),
          text: text.length > 170 ? `${text.slice(0, 170)}…` : text,
        });
      }
      // บรรทัดเดียวเอ่ยหลายวันที่ (เช่น "★ 2 ก.ย. 69 … ตั้งแต่ 18 ส.ค.") → ติดป้ายว่ารายการนี้อ้างถึงวันไหน
      for (const entry of lineEntries) entries.push({ ...entry, multi: lineEntries.length > 1 });
    }
  }
  entries.sort((a, b) => b.sortKey - a.sortKey || a.file.localeCompare(b.file) || a.line - b.line);
  return entries;
}

function renderChangelog(entries) {
  const lines = [
    '# NEWS CHANGELOG — ประวัติการแก้ท่อข่าวจากคอมเมนต์ในโค้ด',
    '',
    '> สร้างอัตโนมัติด้วย `node scripts/gen-news-changelog.mjs` จากคอมเมนต์ที่มีวันที่ไทยในไฟล์ท่อข่าว',
    `> (${NEWS_SWITCH_FILES.length} ไฟล์ตาม \`NEWS_SWITCH_FILES\`) — **ห้ามแก้ไฟล์นี้ด้วยมือ** แก้ที่คอมเมนต์ในโค้ดแล้วรันสคริปต์ใหม่`,
    '> เรียงวันที่ใหม่ → เก่า · รูปแบบ: `ไฟล์:บรรทัด` — ข้อความคอมเมนต์ (ย่อ 170 ตัวอักษร) · ปีที่ไม่ระบุถือเป็น พ.ศ. 69',
    '',
    `รายการทั้งหมด: ${entries.length} จุด`,
    '',
  ];
  let currentDate = null;
  for (const entry of entries) {
    if (entry.iso !== currentDate) {
      currentDate = entry.iso;
      lines.push(`## ${entry.label.replace(' (ปีไม่ระบุ)', '')} (${entry.iso})`, '');
    }
    const flag = entry.label.endsWith('(ปีไม่ระบุ)') ? ' _(ปีไม่ระบุ)_' : '';
    const mention = entry.multi ? ` _(อ้างถึง "${entry.mention}")_` : '';
    lines.push(`- \`${entry.file}:${entry.line}\`${flag}${mention} — ${entry.text.replace(/\|/g, '\\|')}`);
    if (entries[entries.indexOf(entry) + 1]?.iso !== entry.iso) lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderSwitches() {
  const groups = new Map();
  for (const entry of NEWS_SWITCHES) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  const lines = [
    '# NEWS SWITCHES — ทะเบียนสวิตช์ env ของท่อข่าว',
    '',
    '> สร้างอัตโนมัติด้วย `node scripts/gen-news-changelog.mjs` จาก `src/lib/config/newsSwitches.js` — **ห้ามแก้ไฟล์นี้ด้วยมือ**',
    '> ด่านตรวจ: `node --test tests/news-switch-registry.test.mjs` (เพิ่ม `process.env.X` ในไฟล์ท่อข่าวโดยไม่ลงทะเบียน = แดง)',
    `> คีย์ลับ/ที่อยู่ (ชื่อเข้ารูป \`${SECRET_ENV_RE.source}\`) ไม่ใช่สวิตช์ ไม่อยู่ในทะเบียน`,
    '',
    `สวิตช์ทั้งหมด: ${NEWS_SWITCHES.length} ตัว · ไฟล์ที่สแกน: ${NEWS_SWITCH_FILES.length} ไฟล์`,
    '',
    '## วิธีอ่าน',
    '',
    '- **ค่าเริ่มต้น** = ค่าเมื่อไม่ตั้ง env (ว่าง = ไม่ตั้ง) · **ค่าที่รับ** = ค่าที่โค้ดรู้จัก (สวิตช์ 0/1 ส่วนใหญ่รับตรงตัว ยกเว้นที่ระบุว่าทน on/off)',
    '- **ถอยกลับ** = วิธีคืนพฤติกรรมเดิม · **ตั้งแต่** = วันที่จากคอมเมนต์ในโค้ด (ถ้าไม่มีใช้วันที่ commit แรกที่ปรากฏ)',
    '- ขอบเขตการสแกน = ไฟล์ใน `NEWS_SWITCH_FILES` (สาย TEXT + ด่านแก้ไข + คิว + ไคลเอนต์/ประตูที่มีแต่สวิตช์ข่าว) · ไฟล์ร่วมกับระบบคลิป (geminiClient.js) และสาย URL (promptStore.js/summarizeService.js) ไม่สแกน แต่ยังต้องปรากฏใน "อ่านโดย" ตามจริง (เทสตรวจว่าอ่านจริงทุกไฟล์ที่ระบุ)',
    `- helper ที่อ่าน env แบบตามชื่อไม่ได้ (\`process.env[ตัวแปร]\`) อนุญาตเฉพาะ: ${Object.entries(DYNAMIC_ENV_READERS).map(([file, functions]) => `\`${file}\` (${functions.join('/')})`).join(' · ')} — ที่อื่นเทสแดง`,
    '',
  ];
  for (const [group, entries] of groups) {
    lines.push(`## ${group}`, '', '| สวิตช์ | ค่าเริ่มต้น | ค่าที่รับ | ความหมาย | อ่านโดย | ตั้งแต่ | ถอยกลับ |', '|---|---|---|---|---|---|---|');
    for (const entry of entries) {
      lines.push(`| \`${entry.name}\` | \`${entry.default === '' ? '(ว่าง)' : entry.default}\` | ${escapeCell(entry.values.join(' · '))} | ${escapeCell(entry.meaning)} | ${entry.readBy.map(file => `\`${file}\``).join('<br>')} | ${escapeCell(entry.since)} | ${escapeCell(entry.rollback)} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function emit(path, content) {
  const relative = path.slice(ROOT.length + 1).replace(/\\/g, '/');
  if (CHECK_ONLY) {
    const current = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current !== content) {
      console.error(`❌ ${relative} ไม่ตรงกับโค้ดปัจจุบัน — รัน node scripts/gen-news-changelog.mjs แล้ว commit`);
      process.exitCode = 1;
    } else {
      console.log(`✅ ${relative} ตรงกับโค้ดปัจจุบัน`);
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log(`📝 เขียน ${relative} (${content.split('\n').length} บรรทัด)`);
}

const entries = collectEntries();
emit(CHANGELOG_PATH, renderChangelog(entries));
emit(SWITCHES_PATH, renderSwitches());
console.log(`สรุป: คอมเมนต์มีวันที่ ${entries.length} จุด · สวิตช์ในทะเบียน ${NEWS_SWITCHES.length} ตัว`);
