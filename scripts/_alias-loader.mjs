/**
 * ตัวแปลงเส้นทาง "@/..." ให้ Node ธรรมดาเข้าใจ (ปกติมีแต่ Next.js ที่รู้จัก)
 * ใช้กับข้อสอบที่ต้อง import ไฟล์จริงในระบบมารันตรงๆ
 *
 * ใช้:  node --import ./scripts/_alias-loader-register.mjs scripts/xxx.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const EXTS = ['', '.js', '.mjs', '.jsx', '/index.js', '/index.mjs'];

function tryFile(base) {
  for (const ext of EXTS) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return pathToFileURL(p).href;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  // 1) เส้นทางแบบ "@/lib/xxx" → src/lib/xxx
  if (specifier.startsWith('@/')) {
    const url = tryFile(path.resolve(ROOT, 'src', specifier.slice(2)));
    if (url) return { url, shortCircuit: true };
  }

  // 2) เส้นทางญาติที่ไม่ใส่นามสกุล เช่น "./usageLogger" (Next เติมให้เอง แต่ Node ไม่เติม)
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier)) {
    const from = context.parentURL ? path.dirname(new URL(context.parentURL).pathname.replace(/^\/([A-Za-z]:)/, '$1')) : ROOT;
    const url = tryFile(path.resolve(from, specifier));
    if (url) return { url, shortCircuit: true };
  }

  return next(specifier, context);
}
