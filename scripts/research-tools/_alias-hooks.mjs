/**
 * 🪝 scripts/research-tools/_alias-hooks.mjs — ตัวแปลง import "@/..." + import สัมพัทธ์ไม่มีนามสกุล ให้ Node ล้วน
 * ─────────────────────────────────────────────────────────────────────────────
 * ตรรกะเดียวกับ scripts/_alias-loader.mjs แต่ (1) รับรากโปรเจกต์ผ่าน initialize({root}) ไม่พึ่ง cwd ของเธรด loader
 * (2) แปลง parentURL ด้วย fileURLToPath (ของเดิมใช้ URL.pathname ที่เข้ารหัส % — โฟลเดอร์ชื่อไทยจะหาไฟล์ไม่เจอ)
 * ใช้ผ่าน useRepoRuntime() ใน _common.mjs เท่านั้น (ไม่แตะ scripts/_alias-loader.mjs เดิม)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let ROOT = process.cwd();
const EXTS = ['', '.js', '.mjs', '.jsx', '/index.js', '/index.mjs'];

export async function initialize(data) {
  if (data && typeof data.root === 'string' && data.root) ROOT = data.root;
}

function tryFile(base) {
  for (const ext of EXTS) {
    const p = base + ext;
    try { if (fs.statSync(p).isFile()) return pathToFileURL(p).href; } catch { /* ลองนามสกุลถัดไป */ }
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const url = tryFile(path.resolve(ROOT, 'src', specifier.slice(2)));
    if (url) return { url, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier)
    && context.parentURL && context.parentURL.startsWith('file:')) {
    const url = tryFile(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    if (url) return { url, shortCircuit: true };
  }
  return next(specifier, context);
}
