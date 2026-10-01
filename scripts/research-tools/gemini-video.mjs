// 🎬 gemini-video — ให้ Gemini "ดูคลิป YouTube จริง" (ภาพ+เสียง) แล้วตอบเป็น JSON (ตัวเรียกเดียวกับท่อคลิป callClipGeminiVideo)
// ใช้: node tools/gemini-video.mjs --url <ลิงก์ YouTube> [--question "อยากรู้อะไรจากคลิป"] [--start 0 --end 180]
//      คำถามภาษาไทยยาว → --input out/gv.json ({"url":"...","question":"...","start":0,"end":180})
// คืน JSON: {ok, tool, model, data:{summary, spoken_quotes[], on_screen_text[], people[], places[], dates_or_time_clues[], numbers[], answer}, elapsedMs}
// เฉพาะ YouTube (ลิงก์ตรง ไม่ต้องดาวน์โหลด) · แพลตฟอร์มอื่นใช้ transcribe · มีค่า Gemini ตามความยาวคลิป (ใช้ --start/--end ดูเฉพาะช่วง)
import { ensureKeys, importFromRepo, intIn, isHttpUrl, parseArgs, quietConsole, repoRoot, runTool, UsageError } from './_common.mjs';

export const USAGE = 'ใช้: node tools/gemini-video.mjs --url <ลิงก์ YouTube> [--question "..."] [--start s --end s] | --input out/gv.json';

export function buildVideoPrompt(question) {
  const q = String(question || '').trim().slice(0, 800);
  return [
    'ดูคลิปนี้ทั้งภาพและเสียง แล้วตอบเป็น JSON object เดียว (ห้ามมีข้อความอื่น) โครง:',
    '{"summary":"สรุปเหตุการณ์ 2-4 ประโยค","spoken_quotes":[{"time":"mm:ss","speaker":"ใคร (ตามที่คลิปบอก)","text":"คำพูดตรงตัว"}],',
    '"on_screen_text":["ข้อความบนจอ/ป้าย/แคปชัน"],"people":["ชื่อ/บทบาทตามที่คลิปบอก"],"places":["สถานที่"],',
    '"dates_or_time_clues":["วันที่/เวลา/ฤดู/เหตุการณ์ที่บอกเวลาได้"],"numbers":["ตัวเลขสำคัญพร้อมบริบท"],"answer":"คำตอบของคำถามด้านล่าง หรือ ไม่พบในคลิป"}',
    'กติกา: ห้ามเดา ไม่เห็น/ไม่ได้ยินให้เว้นว่าง · ห้ามเดาเพศจากชื่อ · คำพูดคัดตรงตามที่ได้ยิน',
    `คำถาม: ${q || '(ไม่มี — สรุปข้อเท็จจริงที่ตรวจสอบได้จากคลิป)'}`,
  ].join('\n');
}

const isYouTube = (u) => { try { return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(new URL(u).hostname.toLowerCase()); } catch { return false; } };

export async function run(argv, { env = process.env, loadService = null } = {}) {
  const a = parseArgs(argv, { options: ['url', 'question', 'start', 'end'] });
  const url = String(a.url || a._[0] || '').trim();
  if (!isHttpUrl(url)) throw new UsageError('ต้องมี --url');
  if (!isYouTube(url)) return { ok: false, tool: 'gemini-video', errorType: 'UNSUPPORTED', error: 'รองรับเฉพาะ YouTube — แพลตฟอร์มอื่นใช้ tools/transcribe.mjs' };
  ensureKeys(['GEMINI_VIDEO_API_KEY', 'GEMINI_API_KEY'], { env });
  if (!env.GEMINI_VIDEO_API_KEY && !env.GEMINI_API_KEY) return { ok: false, tool: 'gemini-video', errorType: 'NO_KEY', error: 'ไม่มี GEMINI_API_KEY' };
  const start = a.start === undefined ? null : intIn(a.start, 0, 36000, 0);
  const end = a.end === undefined ? null : intIn(a.end, 1, 36000, 0);
  quietConsole();
  const mod = loadService ? await loadService('src/lib/services/clipBrain/clipGeminiVideo.js')
    : await importFromRepo('src/lib/services/clipBrain/clipGeminiVideo.js', repoRoot(env));
  const res = await mod.callClipGeminiVideo({
    prompt: buildVideoPrompt(a.question),
    youtubeUrl: url,
    feature: 'researchAgent',
    maxTokens: 8000,
    maxAttempts: 2,
    timeoutMs: 150_000,
    totalTimeoutMs: 200_000,
    ...(start !== null && end !== null && end > start ? { videoRange: [start, end] } : {}),
  });
  if (!res || !res.ok) return { ok: false, tool: 'gemini-video', errorType: (res && res.errorType) || 'GEMINI_FAILED', error: String((res && res.error) || 'ดูคลิปไม่สำเร็จ').slice(0, 300) };
  return { ok: true, tool: 'gemini-video', model: res.receipt && res.receipt.model, data: res.data, elapsedMs: res.receipt && res.receipt.elapsedMs };
}

await runTool(import.meta.url, (argv) => run(argv), USAGE);
