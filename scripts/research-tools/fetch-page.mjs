// 📄 fetch-page — ดึงเนื้อเต็ม + วันที่เผยแพร่ของหน้าเว็บ: Firecrawl → Jina Reader → fetch ตรง (ถอดแท็ก)
// ใช้: node tools/fetch-page.mjs <url> [--max 6000] [--via auto|firecrawl|jina|direct]
// คืน JSON: {ok, tool, url, title, published, text, chars, via, tried[]}
// ใช้ยืนยันก่อนเชื่อ snippet · หน้าที่ต้องล็อกอิน (เฟซบุ๊กส่วนใหญ่) มักได้หน้าล็อกอิน → ใช้ apify/เบราว์เซอร์แทน
import { ensureKeys, fetchJson, intIn, isHttpUrl, parseArgs, runTool, UsageError } from './_common.mjs';

export const USAGE = 'ใช้: node tools/fetch-page.mjs <url> [--max 6000] [--via auto|firecrawl|jina|direct]';
const VIAS = new Set(['auto', 'firecrawl', 'jina', 'direct']);

const decodeEntities = (s) => String(s)
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ''; } });

/** วันที่เผยแพร่จาก meta/JSON-LD/time */
export function publishedFromHtml(html) {
  const pats = [
    /property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /name=["'](?:pubdate|publishdate|date|DC\.date\.issued)["'][^>]*content=["']([^"']+)["']/i,
    /itemprop=["']datePublished["'][^>]*content=["']([^"']+)["']/i,
    /<time[^>]*datetime=["']([^"']+)["']/i,
  ];
  for (const re of pats) { const m = re.exec(html); if (m) return m[1]; }
  return '';
}

/** ถอด HTML เป็นข้อความ */
export function htmlToText(html) {
  return decodeEntities(String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

async function viaFirecrawl(fetchImpl, env, url) {
  if (!env.FIRECRAWL_API_KEY) return { skip: 'ไม่มีคีย์ Firecrawl' };
  const r = await fetchJson(fetchImpl, 'https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, timeout: 20000 }),
    timeoutMs: 25_000,
  });
  const d = r.data && r.data.data;
  if (!r.ok || !d || !d.markdown) return { fail: `firecrawl ${r.status}` };
  const md = d.metadata || {};
  return { title: md.title || md.ogTitle || '', published: md.publishedTime || md['article:published_time'] || md.datePublished || '', text: d.markdown };
}

async function viaJina(fetchImpl, env, url) {
  const headers = { Accept: 'application/json', 'X-Return-Format': 'text' };
  if (env.JINA_API_KEY) headers.Authorization = `Bearer ${env.JINA_API_KEY}`;
  const r = await fetchJson(fetchImpl, `https://r.jina.ai/${url}`, { headers, timeoutMs: 20_000 });
  const d = r.data && r.data.data;
  if (!r.ok || !d || !(d.text || d.content)) return { fail: `jina ${r.status}` };
  return { title: d.title || '', published: d.publishedTime || '', text: d.text || d.content || '' };
}

async function viaDirect(fetchImpl, _env, url) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 (research-agent)' }, signal: AbortSignal.timeout(15_000) });
  const html = await r.text();
  if (!r.ok) return { fail: `direct ${r.status}` };
  return {
    title: decodeEntities(((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '').trim()),
    published: publishedFromHtml(html),
    text: htmlToText(html),
  };
}

export async function run(argv, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const a = parseArgs(argv, { options: ['max', 'via', 'url'] });
  const url = String(a.url || a._.find((x) => isHttpUrl(x)) || '').trim();
  if (!isHttpUrl(url)) throw new UsageError('ต้องมี URL http(s)');
  const via = String(a.via || 'auto');
  if (!VIAS.has(via)) throw new UsageError('via ต้องเป็น auto|firecrawl|jina|direct');
  const max = intIn(a.max, 500, 30000, 6000);
  ensureKeys(['FIRECRAWL_API_KEY', 'JINA_API_KEY'], { env });
  const chain = via === 'auto' ? [['firecrawl', viaFirecrawl], ['jina', viaJina], ['direct', viaDirect]]
    : [[via, { firecrawl: viaFirecrawl, jina: viaJina, direct: viaDirect }[via]]];
  const tried = [];
  for (const [name, fn] of chain) {
    let res;
    try { res = await fn(fetchImpl, env, url); } catch (e) { res = { fail: `${name}: ${String((e && e.message) || e).slice(0, 120)}` }; } // eslint-disable-line no-await-in-loop -- ลองทีละชั้นตามลำดับ
    if (res && res.text && String(res.text).trim().length > 50) {
      const text = String(res.text).trim();
      return { ok: true, tool: 'fetch-page', url, title: String(res.title || '').trim().slice(0, 300), published: String(res.published || ''), text: text.slice(0, max), chars: text.length, via: name, tried };
    }
    tried.push(res && (res.fail || res.skip) ? (res.fail || res.skip) : `${name}: เนื้อว่าง`);
  }
  return { ok: false, tool: 'fetch-page', url, errorType: 'FETCH_FAILED', error: 'ดึงเนื้อไม่ได้ทุกชั้น', tried };
}

await runTool(import.meta.url, (argv) => run(argv), USAGE);
