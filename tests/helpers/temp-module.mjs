// ============================================================
// 🧰 tests/helpers/temp-module.mjs — โหลด "ซอร์สจริงที่ patch แล้ว" โดยไม่เขียนไฟล์ลง src/
// ★ 23 ก.ย. 69 (แคมเปญแก้บั๊ก ข้อ 1 · เจ้าของอนุมัติ) — CFG-14
// ------------------------------------------------------------
// ปัญหาเดิม: เทส 6 ไฟล์ (card-picker-sonnet5 · l3b-contract · medical-term-whitelist · semantic-seam-guard ·
//   extract-claude-switch · writer-fable-switch) เขียน src/lib/ai/_*-under-test.tmp.mjs หรือ src/lib/correction/…
//   เพื่อให้ import สัมพัทธ์ ('./legacyLengthRules.js', '../utils/pipelineDeadline.js') resolve ได้ · 4 ไฟล์ไม่มี finally
//   (import ล้ม = ไฟล์ค้างใน src ให้ next dev/build/lint หยิบไป) · รันขนาน = ชื่อชนกัน
// วิธีใหม่: เขียนใต้ mkdtemp(os.tmpdir()) · แปลง specifier สัมพัทธ์เป็น file:// เต็มของตำแหน่งจริง (originalUrl) ·
//   แปลง bare specifier (แพ็กเกจ) เป็น URL ที่ resolve จาก repo นี้ · ลบโฟลเดอร์ชั่วคราวใน finally เสมอ
// ข้อจำกัด (โยน error ชัดๆ แทนการพังเงียบ): ซอร์สที่ใช้ import.meta (อ้างไฟล์ข้างตัว) ย้ายที่แล้วจะชี้ผิดที่
// ============================================================
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// from '…' · import '…' · import('…') · export … from '…' — เฉพาะ specifier ที่เป็นสตริงตรงตัว
const SPECIFIER_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\2/g;
const BARE_PACKAGE_RE = /^(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w./-]*)?$/;

/** แปลง specifier ในซอร์สให้ใช้ได้จากโฟลเดอร์ชั่วคราว (สัมพัทธ์ → file:// ของตำแหน่งจริง · แพ็กเกจ → URL ที่ resolve แล้ว) */
export function absolutizeImports(source, originalUrl) {
  const base = originalUrl instanceof URL ? originalUrl : new URL(String(originalUrl));
  return source.replace(SPECIFIER_RE, (match, lead, quote, spec) => {
    if (spec.startsWith('./') || spec.startsWith('../')) {
      return `${lead}${quote}${new URL(spec, base).href}${quote}`;
    }
    if (spec.startsWith('node:') || /^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith('@/') || !BARE_PACKAGE_RE.test(spec)) {
      return match; // builtin / URL เต็มแล้ว / alias ของ Next (เทส stub เอง) / ไม่ใช่ specifier
    }
    try {
      return `${lead}${quote}${import.meta.resolve(spec)}${quote}`;
    } catch {
      return match; // resolve ไม่ได้ = ปล่อยให้ import ล้มดังๆ เหมือนเดิม
    }
  });
}

/**
 * import ซอร์สที่ patch แล้วจากโฟลเดอร์ชั่วคราวใต้ os.tmpdir() แล้วลบทิ้งใน finally
 * @param {string} source      ซอร์สที่ stub/patch แล้ว
 * @param {URL|string} originalUrl  ตำแหน่งไฟล์จริง (ใช้ resolve import สัมพัทธ์) เช่น new URL('../src/lib/ai/claudeClient.js', import.meta.url)
 * @param {string} [name]      ชื่อไฟล์ชั่วคราว (ไว้อ่าน stack trace)
 */
export async function importPatchedModule(source, originalUrl, name = 'module-under-test') {
  if (/\bimport\.meta\b/.test(source)) {
    throw new Error(`importPatchedModule(${name}): ซอร์สใช้ import.meta — ย้ายไปโฟลเดอร์ชั่วคราวแล้วจะอ้างไฟล์ผิดที่ ต้องจัดการเฉพาะกรณี`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'news-test-'));
  try {
    const file = join(dir, `${String(name).replace(/[^\w.-]+/g, '-')}.mjs`);
    writeFileSync(file, absolutizeImports(source, originalUrl));
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
