import { NextResponse } from 'next/server';
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
      console.log(`[TikTok] Trying ${api.name}...`);
      const videoUrl = await api.fn(url);
      console.log(`[TikTok] ✅ ${api.name} success`);
      return videoUrl;
    } catch (e) {
      console.log(`[TikTok] ❌ ${api.name}: ${e.message}`);
    }
  }
  return null;
}

export async function POST(request) {
  let tempPath = null;

  try {
    const contentType = request.headers.get('content-type') || '';

    let audioSource; // ReadStream or File for Whisper

    if (contentType.includes('multipart/form-data')) {
      // === Mode: Upload video file ===
      const formData = await request.formData();
      const videoFile = formData.get('video');

      if (!videoFile) {
        return NextResponse.json({ success: false, error: 'ไม่พบไฟล์วิดีโอ' }, { status: 400 });
      }

      console.log(`[TikTok] Upload mode: ${videoFile.name}, ${(videoFile.size / 1024 / 1024).toFixed(1)}MB`);

      // Save temp file for Whisper
      const bytes = await videoFile.arrayBuffer();
      const buffer = Buffer.from(bytes);
      tempPath = join(tmpdir(), `tiktok_${Date.now()}.mp4`);
      await writeFile(tempPath, buffer);
      audioSource = createReadStream(tempPath);

    } else {
      // === Mode: TikTok URL ===
      const { url } = await request.json();

      if (!url || !url.includes('tiktok')) {
        return NextResponse.json({ success: false, error: 'URL TikTok ไม่ถูกต้อง' }, { status: 400 });
      }

      console.log(`[TikTok] URL mode: ${url}`);

      // ดาวน์โหลดวิดีโอ
      const videoUrl = await downloadTikTok(url);

      if (!videoUrl) {
        return NextResponse.json({
          success: false,
          error: 'ดาวน์โหลดวิดีโอไม่สำเร็จ — ลองอัปโหลดไฟล์วิดีโอแทน',
          needUpload: true,
        });
      }

      // ดาวน์โหลดไฟล์วิดีโอ
      console.log(`[TikTok] Downloading video...`);
      const videoRes = await fetch(videoUrl);
      const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

      if (videoBuffer.length < 10000) {
        return NextResponse.json({
          success: false,
          error: 'ไฟล์วิดีโอเล็กเกินไป ดาวน์โหลดอาจล้มเหลว',
          needUpload: true,
        });
      }

      tempPath = join(tmpdir(), `tiktok_${Date.now()}.mp4`);
      await writeFile(tempPath, videoBuffer);
      audioSource = createReadStream(tempPath);

      console.log(`[TikTok] Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    }

    // === Whisper Transcription ===
    console.log(`[TikTok] Starting Whisper transcription...`);

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
      return NextResponse.json({
        success: false,
        error: 'ถอดเสียงไม่สำเร็จ — อาจเป็นคลิปที่ไม่มีเสียงพูด',
      });
    }

    // สร้างข้อความที่จัดรูปแบบแล้ว
    const formattedText = `=== ถอดเสียงจากคลิป TikTok ===\n` +
      `ความยาว: ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')} นาที\n\n` +
      text + '\n\n' +
      `=== จบถอดเสียง ===`;

    console.log(`[TikTok] ✅ Transcribed: ${text.length}ch, ${duration.toFixed(0)}s, ${segments.length} segments`);

    return NextResponse.json({
      success: true,
      text: formattedText,
      rawText: text,
      title: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
      duration: Math.round(duration),
      segments: segments.length,
      chars: text.length,
    });

  } catch (error) {
    console.error('[TikTok] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'ถอดเสียงไม่สำเร็จ: ' + (error.message || 'Unknown error'),
      needUpload: error.message?.includes('download') || false,
    }, { status: 500 });
  } finally {
    // Cleanup temp file
    if (tempPath) {
      try { await unlink(tempPath); } catch {}
    }
  }
}
