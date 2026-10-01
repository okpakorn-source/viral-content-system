// 📚 wiki — สรุปจาก Wikipedia (ไทยก่อน ไม่พบถอยอังกฤษ) ผ่าน REST สาธารณะ (ฟรี ไม่มีคีย์)
// ใช้: node tools/wiki.mjs "ชื่อบุคคล/หน่วยงาน/สถานที่" [--lang th|en]      (คำไทย → --input out/w.json {"q":"..."})
// คืน JSON: {ok, tool, lang, title, description, extract, url, candidates[]}
import { fetchJson, parseArgs, runTool, UsageError } from './_common.mjs';

export const USAGE = 'ใช้: node tools/wiki.mjs "คำค้น" [--lang th|en] | --input out/w.json ({"q":"..."})';
const UA = 'ViralFlowResearchAgent/1.0 (newsroom research tool; contact via project owner)';

async function lookup(fetchImpl, lang, q) {
  const s = await fetchJson(fetchImpl,
    `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=5&namespace=0&format=json`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeoutMs: 8_000 });
  const titles = s.ok && Array.isArray(s.data) && Array.isArray(s.data[1]) ? s.data[1] : [];
  if (!titles.length) return null;
  const sum = await fetchJson(fetchImpl, `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titles[0].replace(/ /g, '_'))}`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeoutMs: 8_000 });
  if (!sum.ok || !sum.data || !sum.data.extract) return null;
  const d = sum.data;
  return {
    ok: true, tool: 'wiki', lang, title: d.title || titles[0], description: d.description || '', extract: String(d.extract).slice(0, 2500),
    url: (d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page) || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(titles[0])}`,
    candidates: titles,
  };
}

export async function run(argv, { fetchImpl = globalThis.fetch } = {}) {
  const a = parseArgs(argv, { options: ['lang', 'q'] });
  const q = String(a.q || a._.join(' ')).trim().slice(0, 200);
  if (!q) throw new UsageError('ต้องมีคำค้น');
  const langs = a.lang ? [String(a.lang) === 'en' ? 'en' : 'th'] : ['th', 'en'];
  for (const lang of langs) {
    const res = await lookup(fetchImpl, lang, q); // eslint-disable-line no-await-in-loop -- ไทยก่อน ไม่พบค่อยอังกฤษ
    if (res) return res;
  }
  return { ok: false, tool: 'wiki', errorType: 'NOT_FOUND', error: `ไม่พบบทความ Wikipedia สำหรับ "${q}"` };
}

await runTool(import.meta.url, (argv) => run(argv), USAGE);
