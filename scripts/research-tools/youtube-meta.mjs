// 📺 youtube-meta — ข้อมูลคลิป YouTube: ชื่อ ช่อง วันที่อัปโหลด ยอดวิว/ไลก์/คอมเมนต์ ความยาว คำอธิบาย (ใช้ตัดสินข่าวเก่า/ต้นทาง)
// ใช้: node tools/youtube-meta.mjs --url <ลิงก์ YouTube | video id>
// คืน JSON: {ok, tool, videoId, title, channel, publishedAt, views, likes, comments, duration, description, tags, via}
// YouTube Data API (คีย์ส่งทาง header x-goog-api-key) → ไม่มีคีย์/ล้ม = oEmbed (ได้แค่ชื่อ+ช่อง ไม่มีวันที่)
import { ensureKeys, fetchJson, parseArgs, runTool, UsageError } from './_common.mjs';

export const USAGE = 'ใช้: node tools/youtube-meta.mjs --url <ลิงก์ YouTube>';

/** ดึง video id 11 ตัว */
export function youtubeId(input) {
  const s = String(input || '').trim();
  const pats = [
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const re of pats) { const m = re.exec(s); if (m) return m[1]; }
  return null;
}

export async function run(argv, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const a = parseArgs(argv, { options: ['url'] });
  const id = youtubeId(a.url || a._[0]);
  if (!id) throw new UsageError('ต้องมีลิงก์ YouTube หรือ video id');
  ensureKeys(['YOUTUBE_API_KEY'], { env });
  if (env.YOUTUBE_API_KEY) {
    const r = await fetchJson(fetchImpl, `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${id}`, {
      headers: { 'x-goog-api-key': env.YOUTUBE_API_KEY }, timeoutMs: 12_000,
    });
    const v = r.ok && r.data && Array.isArray(r.data.items) ? r.data.items[0] : null;
    if (v) {
      const sn = v.snippet || {}; const st = v.statistics || {};
      return {
        ok: true, tool: 'youtube-meta', videoId: id, title: sn.title || '', channel: sn.channelTitle || '', publishedAt: sn.publishedAt || '',
        views: st.viewCount ? Number(st.viewCount) : null, likes: st.likeCount ? Number(st.likeCount) : null,
        comments: st.commentCount ? Number(st.commentCount) : null, duration: (v.contentDetails || {}).duration || '',
        description: String(sn.description || '').slice(0, 1500), tags: Array.isArray(sn.tags) ? sn.tags.slice(0, 20) : [], via: 'data-api',
      };
    }
    if (r.ok && r.data && Array.isArray(r.data.items) && !r.data.items.length) {
      return { ok: false, tool: 'youtube-meta', videoId: id, errorType: 'NOT_FOUND', error: 'ไม่พบคลิป (ถูกลบ/ส่วนตัว)' };
    }
  }
  const o = await fetchJson(fetchImpl, `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`, { timeoutMs: 8_000 });
  if (!o.ok || !o.data) return { ok: false, tool: 'youtube-meta', videoId: id, errorType: 'HTTP', error: `oembed ${o.status}` };
  return { ok: true, tool: 'youtube-meta', videoId: id, title: o.data.title || '', channel: o.data.author_name || '', publishedAt: '', via: 'oembed', note: 'ไม่มีคีย์ YouTube Data API — ไม่มีวันที่/ยอดวิว' };
}

await runTool(import.meta.url, (argv) => run(argv), USAGE);
