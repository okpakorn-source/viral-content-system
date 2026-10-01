// 🕷️ apify — เรียก Apify actor แบบรอผล (โพสต์/คอมเมนต์/ค้นเฟซบุ๊ก · TikTok · crawl เว็บ) ช้า 20–90 วิ มีค่าใช้จ่าย ใช้เมื่อจำเป็น
// ใช้: node tools/apify.mjs --preset facebook-posts --url <โพสต์/เพจ> [--limit 5]
//      node tools/apify.mjs --preset facebook-comments --url <โพสต์> [--limit 20]
//      node tools/apify.mjs --preset facebook-search --q "คำค้นสั้นๆ"      (คำไทยให้ใช้ --input)
//      node tools/apify.mjs --preset tiktok --url <คลิป TikTok>
//      node tools/apify.mjs --preset crawl --url <หน้าเว็บ>
//      node tools/apify.mjs --input out/apify.json   ({"preset":"facebook-search","q":"ขาเทียม ราชบุรี"} หรือ {"actor":"apify~facebook-posts-scraper","input":{...},"limit":5,"timeout":90})
// คืน JSON: {ok, tool, actor, count, items:[...ตัดฟิลด์ยาว]} · โทเคนส่งทาง header (ไม่อยู่ใน URL)
import { ensureKeys, intIn, isHttpUrl, parseArgs, runTool, trimDeep, UsageError } from './_common.mjs';

export const USAGE = 'ใช้: node tools/apify.mjs --preset facebook-posts|facebook-comments|facebook-search|tiktok|crawl (--url <u> | --q "คำค้น") [--limit 5] | --input out/apify.json';
const ACTOR_RE = /^[A-Za-z0-9_.-]{1,64}[~/][A-Za-z0-9_.-]{1,64}$/;

export const PRESETS = Object.freeze({
  'facebook-posts': { actor: 'apify~facebook-posts-scraper', needs: 'url', input: (a, n) => ({ startUrls: [{ url: a.url }], resultsLimit: n }) },
  'facebook-comments': { actor: 'apify~facebook-comments-scraper', needs: 'url', input: (a, n) => ({ startUrls: [{ url: a.url }], resultsLimit: n }) },
  'facebook-search': { actor: 'apify~facebook-search-scraper', needs: 'q', input: (a, n) => ({ searchQueries: [a.q], resultsLimit: n }) },
  tiktok: { actor: 'clockworks~tiktok-scraper', needs: 'url', input: (a) => ({ postURLs: [a.url], resultsPerPage: 1 }) },
  crawl: { actor: 'apify~website-content-crawler', needs: 'url', input: (a) => ({ startUrls: [{ url: a.url }], maxCrawlPages: 1 }) },
});

/** แปลงอาร์กิวเมนต์เป็น {actor, input, limit, timeout} (โยน UsageError ถ้าไม่ครบ) */
export function resolveRequest(a) {
  const limit = intIn(a.limit, 1, 50, 10);
  const timeout = intIn(a.timeout, 20, 240, 90);
  if (a.preset) {
    const p = PRESETS[String(a.preset)];
    if (!p) throw new UsageError(`preset ไม่รู้จัก: ${String(a.preset).slice(0, 40)}`);
    if (p.needs === 'url' && !isHttpUrl(a.url)) throw new UsageError(`preset ${a.preset} ต้องมี --url http(s)`);
    if (p.needs === 'q' && !String(a.q || '').trim()) throw new UsageError(`preset ${a.preset} ต้องมี --q`);
    return { actor: p.actor, input: p.input({ url: a.url, q: String(a.q || '').trim() }, limit), limit, timeout };
  }
  const actor = String(a.actor || a._[0] || '').trim().replace('/', '~');
  if (!ACTOR_RE.test(actor)) throw new UsageError('ต้องมี --preset หรือ actor (เช่น apify~facebook-posts-scraper)');
  let input = a.input && typeof a.input === 'object' ? a.input : null;
  if (!input && a._[1]) {
    try { input = JSON.parse(a._[1]); } catch { throw new UsageError('inputJSON อ่านไม่ได้ — ใช้ --input out/apify.json แทน'); }
  }
  if (!input || typeof input !== 'object') throw new UsageError('ต้องมี input ของ actor (แนะนำ --input out/apify.json)');
  return { actor, input, limit, timeout };
}

export async function run(argv, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const a = parseArgs(argv, { options: ['preset', 'url', 'q', 'limit', 'timeout', 'actor'] });
  const req = resolveRequest(a);
  if (!env.APIFY_API_TOKEN && !env.APIFY_API_KEY) ensureKeys(['APIFY_API_TOKEN', 'APIFY_API_KEY'], { env });
  const token = env.APIFY_API_TOKEN || env.APIFY_API_KEY;
  if (!token) return { ok: false, tool: 'apify', errorType: 'NO_KEY', error: 'ไม่มี APIFY_API_TOKEN' };
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(req.actor)}/run-sync-get-dataset-items?timeout=${req.timeout}&clean=true&limit=${req.limit}`;
  const r = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(req.input),
    signal: AbortSignal.timeout((req.timeout + 15) * 1000),
  });
  const text = await r.text();
  let items = null;
  try { items = JSON.parse(text); } catch { items = null; }
  if (!r.ok) return { ok: false, tool: 'apify', actor: req.actor, errorType: 'HTTP', error: `apify http ${r.status}: ${text.slice(0, 200)}` };
  if (!Array.isArray(items)) return { ok: false, tool: 'apify', actor: req.actor, errorType: 'BAD_RESPONSE', error: 'ผล actor ไม่ใช่ array' };
  const errored = items.length && items.every((x) => x && (x.error || x.errorDescription));
  return {
    ok: true, tool: 'apify', actor: req.actor, count: items.length,
    note: errored ? 'actor คืนเฉพาะรายการ error (เช่น no_items = ไม่พบ/ข้อมูลส่วนตัว)' : undefined,
    items: trimDeep(items.slice(0, req.limit), 1500),
  };
}

await runTool(import.meta.url, (argv) => run(argv), USAGE);
