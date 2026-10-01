// 🔎 serper — ค้น Google (organic) / ข่าว / วิดีโอ / ภาพ ผ่าน Serper (ถูก เร็ว ~1 วิ · ภาษาไทยได้)
// ใช้: node tools/serper.mjs "คำค้น" [--news|--videos|--images] [--num 8] [--tbs qdr:d|qdr:w|qdr:m|qdr:y] [--gl th] [--hl th]
//      node tools/serper.mjs --input out/q.json   ({"q":"...","type":"news","num":8,"tbs":"qdr:m"})
// คืน JSON: {ok, tool, type, q, count, results:[{title, snippet, link, source, date}]}
import { ensureKeys, fetchJson, intIn, parseArgs, runTool, UsageError } from './_common.mjs';

export const USAGE = 'ใช้: node tools/serper.mjs "คำค้น" [--news|--videos|--images] [--num 8] [--tbs qdr:m] | --input out/q.json';
const TYPES = new Set(['search', 'news', 'videos', 'images']);
const TBS_RE = /^(qdr:[hdwmy]\d*|cdr:1,cd_min:[\d/]+,cd_max:[\d/]+)$/;

export async function run(argv, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const a = parseArgs(argv, { flags: ['news', 'videos', 'images'], options: ['num', 'tbs', 'gl', 'hl', 'q', 'type'] });
  const q = String(a.q || a._.join(' ')).trim();
  if (!q) throw new UsageError('ต้องมีคำค้น');
  const type = a.type ? String(a.type) : (a.news ? 'news' : a.videos ? 'videos' : a.images ? 'images' : 'search');
  if (!TYPES.has(type)) throw new UsageError(`type ต้องเป็น ${[...TYPES].join('|')}`);
  if (a.tbs && !TBS_RE.test(String(a.tbs))) throw new UsageError('tbs ผิดรูป (เช่น qdr:d qdr:w qdr:m qdr:y)');
  const num = intIn(a.num, 1, 20, 8);
  if (ensureKeys(['SERPER_API_KEY'], { env }).length) return { ok: false, tool: 'serper', errorType: 'NO_KEY', error: 'ไม่มี SERPER_API_KEY' };
  const body = { q, gl: String(a.gl || 'th'), hl: String(a.hl || 'th'), num };
  if (a.tbs) body.tbs = String(a.tbs);
  const r = await fetchJson(fetchImpl, `https://google.serper.dev/${type}`, {
    method: 'POST', headers: { 'X-API-KEY': env.SERPER_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeoutMs: 12_000,
  });
  if (!r.ok || !r.data) return { ok: false, tool: 'serper', errorType: 'HTTP', error: `serper http ${r.status}` };
  const key = type === 'search' ? 'organic' : type;
  const items = Array.isArray(r.data[key]) ? r.data[key] : [];
  const results = items.slice(0, num).map((x) => ({
    title: x.title || '', snippet: x.snippet || '', link: x.link || x.imageUrl || '', source: x.source || x.displayLink || x.channel || '', date: x.date || '',
  }));
  return { ok: true, tool: 'serper', type, q, count: results.length, results };
}

await runTool(import.meta.url, (argv) => run(argv), USAGE);
