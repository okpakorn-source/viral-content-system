#!/usr/bin/env node
// 🔒 GOLDEN-LOCK checker — ตรวจว่าไฟล์ "ระบบเขียนข่าวยุคปัง" ยังตรงลายนิ้วมือ (manifest.json) ทุกไฟล์หรือไม่
// ใช้:  node scripts/golden-lock/check-golden-lock.mjs            → ตรวจ working tree ปัจจุบัน
//       node scripts/golden-lock/check-golden-lock.mjs <commit>   → ตรวจเนื้อไฟล์ใน commit นั้น (เช่น HEAD, origin/main)
// ผล:  exit 0 = ยุคปังครบทุกไฟล์ · exit 1 = มีไฟล์เปลี่ยน (พิมพ์รายการ) · exit 2 = ใช้งานผิด
// หมายเหตุ: เทียบแบบ LF (ตัด CR ออกก่อน hash) — ไฟล์ที่ถูก checkout เป็น CRLF บน Windows จะไม่แจ้งเท็จ
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const ref = process.argv[2] || null;
const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const sha = (buf) => crypto.createHash('sha256').update(Buffer.from(String(buf).replace(/\r\n/g, '\n'), 'utf8')).digest('hex');

let changed = [], missing = [], ok = 0, skipped = [];
for (const [file, want] of Object.entries(manifest.files)) {
  // ไฟล์ data/*.json เป็นไฟล์สำรองที่เซิร์ฟเวอร์เขียนทับเองตอนรัน (sync จาก Supabase) → ตรวจเฉพาะใน commit ไม่ตรวจ working tree
  if (!ref && file.startsWith('data/')) { skipped.push(file); continue; }
  let content = null;
  try {
    if (ref) content = execSync(`git show ${ref}:${file}`, { encoding: 'utf8', maxBuffer: 1e8, cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] });
    else { const p = path.join(repoRoot, file); content = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }
  } catch { content = null; }
  if (content === null) { missing.push(file); continue; }
  if (sha(content) === want) ok++; else changed.push(file);
}
const where = ref ? `commit ${ref}` : 'working tree';
console.log(`🔒 GOLDEN-LOCK ตรวจ ${where} — ยุคปัง (${manifest.golden_commit.slice(0, 7)}) · ไฟล์ในรายการ ${Object.keys(manifest.files).length}`);
console.log(`   ✅ ตรง ${ok} · ✗ เปลี่ยน ${changed.length} · ❌ หาย ${missing.length}${skipped.length ? ` · ⏭ ข้าม (ไฟล์ runtime) ${skipped.length}` : ''}`);
for (const f of changed) console.log(`   ✗ เปลี่ยน: ${f}`);
for (const f of missing) console.log(`   ❌ หาย:    ${f}`);
if (changed.length || missing.length) {
  console.log('\n🔴 ระบบข่าวไม่ใช่ยุคปังครบทุกไฟล์แล้ว — ถ้าไม่ได้ตั้งใจ ให้กู้ด้วย: git checkout news-golden-era-23aug69 -- <ไฟล์>');
  console.log('   ถ้าตั้งใจแก้ (เจ้าของอนุมัติ) ให้ใส่ [NEWS-LOCK-APPROVED ...] ในข้อความ commit ตามกติกา SYSTEM_LOCKED_FILES.md');
  process.exit(1);
}
console.log('🏆 ยุคปังครบทุกไฟล์');
