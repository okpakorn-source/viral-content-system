// 📰 rss-news — ค้นหัวข่าวล่าสุดจาก RSS สำนักข่าวไทย 11 แห่ง (radar/rssSource.js เดิม · ฟรี ไม่มีคีย์)
// ใช้: node tools/rss-news.mjs "คีย์เวิร์ด" [--max-per-feed 5]      (คำไทย → --input out/r.json {"q":"..."})
// คืน JSON: {ok, tool, keyword, count, articles:[{title, url, publishedAt, source, summary}]}
// ได้แค่หัวข้อ/สรุปสั้นของข่าวช่วงล่าสุด (ตาม feed) — ใช้หาความคืบหน้า/สื่อที่เล่นข่าวเดียวกัน แล้วค่อย fetch-page ยืนยัน
import { importFromRepo, intIn, parseArgs, quietConsole, repoRoot, runTool, UsageError } from './_common.mjs';

export const USAGE = 'ใช้: node tools/rss-news.mjs "คีย์เวิร์ด" [--max-per-feed 5] | --input out/r.json ({"q":"..."})';

export async function run(argv, { env = process.env, loadService = null } = {}) {
  const a = parseArgs(argv, { options: ['max-per-feed', 'q'] });
  const keyword = String(a.q || a._.join(' ')).trim().slice(0, 100);
  if (!keyword) throw new UsageError('ต้องมีคีย์เวิร์ด');
  const maxPerFeed = intIn(a['max-per-feed'], 1, 20, 5);
  quietConsole();
  const mod = loadService ? await loadService('src/lib/services/radar/rssSource.js')
    : await importFromRepo('src/lib/services/radar/rssSource.js', repoRoot(env));
  const list = await mod.searchRSS(keyword, { maxPerFeed });
  const articles = (Array.isArray(list) ? list : []).slice(0, 40).map((x) => ({
    title: String(x.title || '').slice(0, 300), url: x.url || '', publishedAt: x.publishedAt || '',
    source: x.source || x.sourceDomain || '', summary: String(x.summary || '').slice(0, 400),
  }));
  return { ok: true, tool: 'rss-news', keyword, count: articles.length, articles };
}

await runTool(import.meta.url, (argv) => run(argv), USAGE);
