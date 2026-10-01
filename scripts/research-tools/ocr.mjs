// 🔤 ocr — อ่านตัวอักษรจากภาพ/สกรีนช็อตโพสต์ (performOcr เดิม: OpenAI vision → Gemini vision สำรอง)
// ใช้: node tools/ocr.mjs --image <ไฟล์ภาพในเครื่อง | URL ภาพ> [--image <ภาพที่ 2> …สูงสุด 4]
// คืน JSON: {ok, tool, title, text, chars, source} · เสียเงิน vision ต่อภาพ · ภาพละไม่เกิน 8MB
import fs from 'node:fs';
import path from 'node:path';
import { ensureKeys, importFromRepo, isHttpUrl, parseArgs, quietConsole, repoRoot, runTool, UsageError, useRepoRuntime } from './_common.mjs';

export const USAGE = 'ใช้: node tools/ocr.mjs --image <ไฟล์หรือ URL ภาพ> [--image ...]';
const MAX_BYTES = 8 * 1024 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/** ภาพ → data URL (ไฟล์ในเครื่องอ่านเทียบ cwd ตอนเรียก ก่อนเปลี่ยน cwd) */
export async function toDataUrl(src, { fetchImpl = globalThis.fetch, cwd = process.cwd(), readFile = fs.readFileSync } = {}) {
  if (isHttpUrl(src)) {
    const r = await fetchImpl(src, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`โหลดภาพไม่ได้ HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('ภาพใหญ่เกิน 8MB');
    const type = String(r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    return `data:${type.startsWith('image/') ? type : 'image/jpeg'};base64,${buf.toString('base64')}`;
  }
  const file = path.resolve(cwd, String(src));
  const buf = readFile(file);
  if (buf.length > MAX_BYTES) throw new Error('ภาพใหญ่เกิน 8MB');
  return `data:${MIME[path.extname(file).toLowerCase()] || 'image/jpeg'};base64,${Buffer.from(buf).toString('base64')}`;
}

export async function run(argv, { env = process.env, fetchImpl = globalThis.fetch, loadService = null, runtime = useRepoRuntime } = {}) {
  const a = parseArgs(argv, { multi: ['image'] });
  const imgs = [...(Array.isArray(a.image) ? a.image : a.image ? [a.image] : []), ...a._].slice(0, 4);
  if (!imgs.length) throw new UsageError('ต้องมี --image');
  const cwd = process.cwd();
  const dataUrls = [];
  for (const src of imgs) dataUrls.push(await toDataUrl(src, { fetchImpl, cwd })); // eslint-disable-line no-await-in-loop -- ทีละภาพ (≤4)
  ensureKeys(['OPENAI_API_KEY', 'GEMINI_API_KEY'], { env });
  quietConsole();
  let mod;
  if (loadService) mod = await loadService('src/lib/services/ocrService.js');
  else {
    const root = runtime(repoRoot(env)); // '@/lib/ai/...' ต้องมีตัวแปลง alias
    mod = await importFromRepo('src/lib/services/ocrService.js', root);
  }
  const res = await mod.performOcr({ dataUrls, mode: 'full' });
  const text = String((res && (res.text || res.result)) || '');
  if (!text) return { ok: false, tool: 'ocr', errorType: 'OCR_EMPTY', error: 'อ่านข้อความจากภาพไม่ได้' };
  return { ok: true, tool: 'ocr', title: String(res.title || '').slice(0, 200), text: text.slice(0, 12000), chars: text.length, source: res.source || 'openai-vision' };
}

await runTool(import.meta.url, (argv) => run(argv), USAGE);
