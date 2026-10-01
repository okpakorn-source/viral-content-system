// 🖼️ reverse-image — ค้นย้อนภาพ (Google Lens ผ่าน SerpApi · reverseImageMulti เดิม) หาที่มาของภาพ/ภาพเก่าที่ถูกนำมาใช้ใหม่
// ใช้: node tools/reverse-image.mjs --image-url <https://...ภาพ> [--num 20]
// คืน JSON: {ok, tool, count, matches:[{title, source, link, imageUrl}]} · ~$0.015/ครั้ง · ต้องเป็น URL ภาพสาธารณะ
import { ensureKeys, importFromRepo, intIn, isHttpUrl, parseArgs, quietConsole, repoRoot, runTool, UsageError } from './_common.mjs';

export const USAGE = 'ใช้: node tools/reverse-image.mjs --image-url <URL ภาพ> [--num 20]';

export async function run(argv, { env = process.env, loadService = null } = {}) {
  const a = parseArgs(argv, { options: ['image-url', 'num'] });
  const url = String(a['image-url'] || a._[0] || '').trim();
  if (!isHttpUrl(url)) throw new UsageError('ต้องมี --image-url http(s)');
  const num = intIn(a.num, 1, 40, 20);
  if (ensureKeys(['SERPAPI_KEY'], { env }).length) return { ok: false, tool: 'reverse-image', errorType: 'NO_KEY', error: 'ไม่มี SERPAPI_KEY' };
  quietConsole();
  const mod = loadService ? await loadService('src/lib/services/imageSearchMulti.js')
    : await importFromRepo('src/lib/services/imageSearchMulti.js', repoRoot(env));
  const list = await mod.reverseImageMulti(url, { num });
  const matches = (Array.isArray(list) ? list : []).slice(0, num).map((x) => ({
    title: String(x.title || '').slice(0, 200), source: x.source || '', link: x.sourceLink || x.link || '', imageUrl: x.imageUrl || x.thumbnailUrl || '',
  }));
  return { ok: true, tool: 'reverse-image', count: matches.length, matches };
}

await runTool(import.meta.url, (argv) => run(argv), USAGE);
