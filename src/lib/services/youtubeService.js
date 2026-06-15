import { YoutubeTranscript } from 'youtube-transcript';
import OpenAI from 'openai';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createReadStream, existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ★ 15 มิ.ย.: ถอด "เสียงพูดจริง" ด้วย yt-dlp(โหลดเสียง)+Whisper — ใช้เมื่อคลิปไม่มีซับไตเติล
//   yt-dlp.exe รันได้แค่ Windows (เครื่องทีม) — บน Vercel จะ throw แล้ว caller จัดการ error เอง
async function whisperFromAudio(url) {
  if (process.platform !== 'win32') throw new Error('ถอดเสียง (Whisper) ได้เฉพาะเครื่องทีม (Windows) — คลิปนี้ไม่มีซับไตเติล');
  const exe = join(process.cwd(), 'bin', 'yt-dlp.exe');
  if (!existsSync(exe)) throw new Error('ไม่พบ bin/yt-dlp.exe — ถอดเสียงคลิปไม่มีซับได้เฉพาะเครื่องทีม');
  const audioPath = join(tmpdir(), `yt_${Date.now()}.m4a`);
  try {
    // โหลดเฉพาะเสียง m4a (เล็ก + Whisper รับได้ตรง)
    await execFileAsync(exe, ['-f', 'ba[ext=m4a]/ba/b', '-o', audioPath, '--no-warnings', '--no-playlist', url], { maxBuffer: 1024 * 1024 * 20, timeout: 180_000 });
    if (!existsSync(audioPath)) throw new Error('ดาวน์โหลดเสียงไม่สำเร็จ');
    const tr = await getOpenai().audio.transcriptions.create({
      file: createReadStream(audioPath), model: 'whisper-1', language: 'th',
      response_format: 'verbose_json', prompt: 'ถอดเสียงภาษาไทยจากคลิป YouTube ข่าว รายการ สัมภาษณ์',
    });
    const text = String(tr.text || '').trim();
    if (text.length < 10) throw new Error('ถอดเสียงไม่สำเร็จ — อาจไม่มีเสียงพูด');
    return { text, duration: Math.round(tr.duration || 0) };
  } finally {
    try { await unlink(audioPath); } catch {}
  }
}

// ★ lazy-init: ห้าม new OpenAI() ระดับ module — SDK throw ตอน build ถ้า env ไม่มี key (เช่น Vercel Preview)
let _openai = null;
const getOpenai = () => {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
};

// ดึง Video ID จาก YouTube URL
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match) return match[1];
  }
  return null;
}

export async function transcribeYoutube({ url, videoBuffer, mimeType }) {
  let tempPath = null;
  try {
    if (videoBuffer) {
      // === Mode: Video upload (Whisper) ===
      tempPath = join(tmpdir(), `youtube_${Date.now()}.mp4`);
      await writeFile(tempPath, videoBuffer);

      console.log(`[YouTube-Service] Starting Whisper transcription...`);
      const transcription = await getOpenai().audio.transcriptions.create({
        file: createReadStream(tempPath),
        model: 'whisper-1',
        language: 'th',
        response_format: 'verbose_json',
        prompt: 'ถอดเสียงภาษาไทยจากคลิป YouTube ข่าว รายการ สัมภาษณ์',
      });

      const text = transcription.text || '';
      if (!text || text.length < 10) {
        return { success: false, error: 'ถอดเสียงไม่สำเร็จ' };
      }

      const duration = transcription.duration || 0;
      return {
        success: true,
        text: `=== ถอดเสียงจากคลิป YouTube ===\nความยาว: ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')} นาที\n\n${text}\n\n=== จบถอดเสียง ===`,
        title: text.substring(0, 80) + '...',
        duration: Math.round(duration),
        method: 'whisper',
      };
    }

    // === Mode: YouTube URL ===
    if (!url) {
      throw new Error('ไม่พบ URL');
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      throw new Error('URL YouTube ไม่ถูกต้อง');
    }

    console.log(`[YouTube-Service] URL mode: ${videoId}`);

    const langPriority = ['th', 'en', 'auto'];
    let transcript = null;
    let usedLang = '';

    for (const lang of langPriority) {
      try {
        if (lang === 'auto') {
          transcript = await YoutubeTranscript.fetchTranscript(videoId);
        } else {
          transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang });
        }
        usedLang = lang;
        console.log(`[YouTube-Service] ✅ Got transcript (${lang}): ${transcript.length} segments`);
        break;
      } catch (e) {
        console.log(`[YouTube-Service] ❌ No ${lang} transcript: ${e.message}`);
      }
    }

    if (!transcript || transcript.length === 0) {
      if (process.env.SUPADATA_API_KEY) {
        try {
          console.log(`[YouTube-Service] Trying Supadata fallback...`);
          // mode=auto → ถ้าไม่มีซับ supadata จะถอดเสียงด้วย AI ให้ (ถอดเสียงจริง บนคลาวด์)
          const res = await fetch(`https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&lang=th&mode=auto`, {
            headers: {
              'x-api-key': process.env.SUPADATA_API_KEY,
              'Accept': 'application/json',
            }
          });
          if (res.ok) {
            const data = await res.json();
            const segments = data.content || [];
            const text = segments.map(s => s.text).join(' ').trim();
            if (text) {
              console.log(`[YouTube-Service] ✅ Got Supadata transcript: ${text.length} chars`);
              return {
                success: true,
                text: `=== Transcript จาก YouTube (Supadata) ===\n\n${text}\n\n=== จบถอดเสียง ===`,
                rawText: text,
                title: text.substring(0, 80) + '...',
                duration: 0,
                method: 'supadata',
              };
            }
          }
        } catch (e) {
          console.log(`[YouTube-Service] ❌ Supadata fallback failed: ${e.message}`);
        }
      }

      // ★ 15 มิ.ย.: ไม่มีซับ → ถอด "เสียงพูดจริง" ด้วย yt-dlp+Whisper (เครื่องทีม) — ไม่ใช่จบที่ error
      try {
        console.log(`[YouTube-Service] ไม่มีซับ → ลองถอดเสียงด้วย Whisper...`);
        const { text, duration } = await whisperFromAudio(url);
        return {
          success: true,
          text: `=== ถอดเสียงจากคลิป YouTube (Whisper) ===\nความยาว: ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')} นาที\n\n${text}\n\n=== จบถอดเสียง ===`,
          rawText: text,
          title: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
          duration,
          method: 'whisper',
        };
      } catch (we) {
        console.log(`[YouTube-Service] Whisper fallback: ${we.message?.slice(0, 80)}`);
        return {
          success: false,
          error: `คลิปนี้ไม่มีซับไตเติล — ${we.message || 'ถอดเสียงด้วย AI ไม่สำเร็จ'}`,
          needUpload: true,
        };
      }
    }

    const fullText = transcript.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    const duration = transcript.length > 0
      ? Math.round((transcript[transcript.length - 1].offset + (transcript[transcript.length - 1].duration || 0)) / 1000)
      : 0;

    let formatted = `=== Transcript จาก YouTube (${usedLang === 'th' ? 'ไทย' : usedLang === 'en' ? 'อังกฤษ' : 'อัตโนมัติ'}) ===\n`;
    formatted += `ความยาว: ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')} นาที | ${transcript.length} segments\n\n`;

    let currentParagraph = [];
    let lastBreak = 0;

    for (const seg of transcript) {
      const offsetSec = seg.offset / 1000;
      if (offsetSec - lastBreak > 30 && currentParagraph.length > 0) {
        formatted += currentParagraph.join(' ').trim() + '\n\n';
        currentParagraph = [];
        lastBreak = offsetSec;
      }
      currentParagraph.push(seg.text);
    }
    if (currentParagraph.length > 0) {
      formatted += currentParagraph.join(' ').trim();
    }

    formatted += `\n\n=== จบ Transcript ===`;

    console.log(`[YouTube-Service] ✅ Done: ${fullText.length}ch, ${duration}s`);

    return {
      success: true,
      text: formatted,
      rawText: fullText,
      title: fullText.substring(0, 80) + (fullText.length > 80 ? '...' : ''),
      duration,
      segments: transcript.length,
      language: usedLang,
      method: 'subtitle',
    };

  } finally {
    if (tempPath) {
      try { await unlink(tempPath); } catch {}
    }
  }
}
