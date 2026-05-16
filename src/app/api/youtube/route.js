import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import OpenAI from 'openai';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createReadStream } from 'fs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

export async function POST(request) {
  let tempPath = null;

  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // === Mode: Upload video file → Whisper ===
      const formData = await request.formData();
      const videoFile = formData.get('video');

      if (!videoFile) {
        return NextResponse.json({ success: false, error: 'ไม่พบไฟล์วิดีโอ' }, { status: 400 });
      }

      console.log(`[YouTube] Upload mode: ${videoFile.name}, ${(videoFile.size / 1024 / 1024).toFixed(1)}MB`);

      const bytes = await videoFile.arrayBuffer();
      const buffer = Buffer.from(bytes);
      tempPath = join(tmpdir(), `youtube_${Date.now()}.mp4`);
      await writeFile(tempPath, buffer);

      // Whisper transcription
      const transcription = await openai.audio.transcriptions.create({
        file: createReadStream(tempPath),
        model: 'whisper-1',
        language: 'th',
        response_format: 'verbose_json',
        prompt: 'ถอดเสียงภาษาไทยจากคลิป YouTube ข่าว รายการ สัมภาษณ์',
      });

      const text = transcription.text || '';
      if (!text || text.length < 10) {
        return NextResponse.json({ success: false, error: 'ถอดเสียงไม่สำเร็จ' });
      }

      const duration = transcription.duration || 0;
      return NextResponse.json({
        success: true,
        text: `=== ถอดเสียงจากคลิป YouTube ===\nความยาว: ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')} นาที\n\n${text}\n\n=== จบถอดเสียง ===`,
        title: text.substring(0, 80) + '...',
        duration: Math.round(duration),
        method: 'whisper',
      });
    }

    // === Mode: YouTube URL → ดึง Subtitle ===
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ success: false, error: 'ไม่พบ URL' }, { status: 400 });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json({ success: false, error: 'URL YouTube ไม่ถูกต้อง' }, { status: 400 });
    }

    console.log(`[YouTube] URL mode: ${videoId}`);

    // ลองดึง subtitle — ลองหลายภาษา
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
        console.log(`[YouTube] ✅ Got transcript (${lang}): ${transcript.length} segments`);
        break;
      } catch (e) {
        console.log(`[YouTube] ❌ No ${lang} transcript: ${e.message}`);
      }
    }

    if (!transcript || transcript.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'คลิปนี้ไม่มี subtitle — ลองอัปโหลดไฟล์วิดีโอเพื่อถอดเสียงด้วย AI แทน',
        needUpload: true,
      });
    }

    // รวมข้อความจาก transcript segments
    const fullText = transcript.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    const duration = transcript.length > 0
      ? Math.round((transcript[transcript.length - 1].offset + (transcript[transcript.length - 1].duration || 0)) / 1000)
      : 0;

    // จัดรูปแบบ — แบ่งย่อหน้าตามช่วงเวลา
    let formatted = `=== Transcript จาก YouTube (${usedLang === 'th' ? 'ไทย' : usedLang === 'en' ? 'อังกฤษ' : 'อัตโนมัติ'}) ===\n`;
    formatted += `ความยาว: ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')} นาที | ${transcript.length} segments\n\n`;

    // จัดกลุ่มทุก 30 วินาที
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

    console.log(`[YouTube] ✅ Done: ${fullText.length}ch, ${duration}s`);

    return NextResponse.json({
      success: true,
      text: formatted,
      rawText: fullText,
      title: fullText.substring(0, 80) + (fullText.length > 80 ? '...' : ''),
      duration,
      segments: transcript.length,
      language: usedLang,
      method: 'subtitle',
    });

  } catch (error) {
    console.error('[YouTube] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'ดึง transcript ไม่สำเร็จ: ' + (error.message || 'Unknown error'),
      needUpload: true,
    }, { status: 500 });
  } finally {
    if (tempPath) {
      try { await unlink(tempPath); } catch {}
    }
  }
}
