import OpenAI from 'openai';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createReadStream } from 'fs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ดาวน์โหลดวิดีโอ TikTok ผ่าน free API
async function downloadTikTok(url) {
  const apis = [
    { name: 'tikwm', fn: async (u) => {
      const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(u)}&hd=1`);
      const data = await res.json();
      if (data.code === 0 && data.data?.play) return data.data.play;
      throw new Error('tikwm failed');
    }},
    { name: 'tikcdn', fn: async (u) => {
      const res = await fetch('https://www.tikcdn.io/api/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `url=${encodeURIComponent(u)}`
      });
      const data = await res.json();
      if (data.video) return data.video;
      throw new Error('tikcdn failed');
    }},
  ];

  for (const api of apis) {
    try {
      console.log(`[TikTok-Service] Trying ${api.name}...`);
      const videoUrl = await api.fn(url);
      console.log(`[TikTok-Service] ✅ ${api.name} success`);
      return videoUrl;
    } catch (e) {
      console.log(`[TikTok-Service] ❌ ${api.name}: ${e.message}`);
    }
  }
  return null;
}

export async function transcribeTiktok({ url, videoBuffer, mimeType }) {
  let tempPath = null;
  try {
    let finalBuffer = videoBuffer;

    if (!finalBuffer && url) {
      if (!url.includes('tiktok')) {
        throw new Error('URL TikTok ไม่ถูกต้อง');
      }

      console.log(`[TikTok-Service] URL mode: ${url}`);
      const videoUrl = await downloadTikTok(url);
      if (!videoUrl) {
        return {
          success: false,
          error: 'ดาวน์โหลดวิดีโอไม่สำเร็จ — ลองอัปโหลดไฟล์วิดีโอแทน',
          needUpload: true,
        };
      }

      console.log(`[TikTok-Service] Downloading video...`);
      const videoRes = await fetch(videoUrl);
      finalBuffer = Buffer.from(await videoRes.arrayBuffer());
    }

    if (!finalBuffer || finalBuffer.length < 10000) {
      return {
        success: false,
        error: 'ไฟล์วิดีโอเล็กเกินไป ดาวน์โหลดหรืออัปโหลดอาจล้มเหลว',
        needUpload: true,
      };
    }

    tempPath = join(tmpdir(), `tiktok_${Date.now()}.mp4`);
    await writeFile(tempPath, finalBuffer);
    const audioSource = createReadStream(tempPath);

    console.log(`[TikTok-Service] Starting Whisper transcription...`);

    const transcription = await openai.audio.transcriptions.create({
      file: audioSource,
      model: 'whisper-1',
      language: 'th',
      response_format: 'verbose_json',
      prompt: 'ถอดเสียงภาษาไทยจากคลิป TikTok ข่าว เนื้อหา รายงาน',
    });

    const text = transcription.text || '';
    const duration = transcription.duration || 0;
    const segments = transcription.segments || [];

    if (!text || text.length < 10) {
      return {
        success: false,
        error: 'ถอดเสียงไม่สำเร็จ — อาจเป็นคลิปที่ไม่มีเสียงพูด',
      };
    }

    const formattedText = `=== ถอดเสียงจากคลิป TikTok ===\n` +
      `ความยาว: ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')} นาที\n\n` +
      text + '\n\n' +
      `=== จบถอดเสียง ===`;

    console.log(`[TikTok-Service] ✅ Transcribed: ${text.length}ch, ${duration.toFixed(0)}s, ${segments.length} segments`);

    return {
      success: true,
      text: formattedText,
      rawText: text,
      title: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
      duration: Math.round(duration),
      segments: segments.length,
      chars: text.length,
    };

  } finally {
    if (tempPath) {
      try { await unlink(tempPath); } catch {}
    }
  }
}
