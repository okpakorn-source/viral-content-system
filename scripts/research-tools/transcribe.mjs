// 🎙️ transcribe — ถอดเสียงคลิปด้วยตัวถอดของท่อคลิป (ข้อ 10 ของเจ้าของ) · ห่อบางๆ ไม่แก้ service เดิม
//   YouTube: ซับ → Supadata → yt-dlp+Whisper (src/lib/services/youtubeService.js)
//   TikTok : tikwm/tikcdn → Whisper (src/lib/services/tiktokService.js)
//   Facebook/Instagram Reels: yt-dlp แคปชัน+เสียง → Whisper (src/lib/services/metaReelsService.js · Windows เท่านั้น)
// ใช้: node tools/transcribe.mjs --url <ลิงก์คลิป> [--max 12000]
// คืน JSON: {ok, tool, platform, method, title, duration, chars, text} · ช้า (โหลด+ถอด 30 วิ–3 นาที) · Whisper เสียเงินต่อนาที
// รันที่ cwd = ราก repo เอง (service หา bin/yt-dlp.exe จาก cwd) · log ของ service ไป stderr
import { ensureKeys, importFromRepo, intIn, isHttpUrl, parseArgs, quietConsole, repoRoot, runTool, UsageError } from './_common.mjs';

export const USAGE = 'ใช้: node tools/transcribe.mjs --url <ลิงก์คลิป YouTube/TikTok/Facebook/Instagram> [--max 12000]';

/** แยกแพลตฟอร์มจาก URL */
export function detectPlatform(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) return 'youtube';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(^|\.)facebook\.com$|(^|\.)fb\.watch$|(^|\.)fb\.com$|(^|\.)instagram\.com$/.test(host)) return 'meta';
  return null;
}

const SERVICES = {
  youtube: ['src/lib/services/youtubeService.js', 'transcribeYoutube'],
  tiktok: ['src/lib/services/tiktokService.js', 'transcribeTiktok'],
  meta: ['src/lib/services/metaReelsService.js', 'transcribeMetaReel'],
};

export async function run(argv, { env = process.env, loadService = null, chdir = (d) => process.chdir(d) } = {}) {
  const a = parseArgs(argv, { options: ['url', 'max'] });
  const url = String(a.url || a._[0] || '').trim();
  if (!isHttpUrl(url)) throw new UsageError('ต้องมี --url ของคลิป');
  const platform = detectPlatform(url);
  if (!platform) return { ok: false, tool: 'transcribe', errorType: 'UNSUPPORTED', error: 'รองรับเฉพาะ YouTube/TikTok/Facebook/Instagram' };
  const max = intIn(a.max, 1000, 60000, 12000);
  ensureKeys(['OPENAI_API_KEY', 'SUPADATA_API_KEY'], { env });
  const root = repoRoot(env);
  chdir(root);
  quietConsole();
  const [rel, fnName] = SERVICES[platform];
  const mod = loadService ? await loadService(rel) : await importFromRepo(rel, root);
  const res = await mod[fnName]({ url });
  if (!res || !res.success) {
    return { ok: false, tool: 'transcribe', platform, errorType: 'TRANSCRIBE_FAILED', error: String((res && res.error) || 'ถอดไม่สำเร็จ').slice(0, 300) };
  }
  const text = String(res.text || res.rawText || '');
  return {
    ok: true, tool: 'transcribe', platform, method: res.method || (platform === 'youtube' ? 'unknown' : 'whisper'),
    title: String(res.title || '').slice(0, 300), duration: Number(res.duration) || null, chars: text.length, text: text.slice(0, max),
  };
}

await runTool(import.meta.url, (argv) => run(argv), USAGE);
