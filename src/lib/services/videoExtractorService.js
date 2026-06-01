// Dynamic imports for ffmpeg (not available on Vercel serverless)
// Computed strings prevent Turbopack from tracing these imports at build time
let _ffmpeg = null;
let _ffmpegPath = null;
async function getFfmpeg() {
  if (!_ffmpeg) {
    const fluentPkg = 'fluent' + '-ffmpeg';
    const mod = await import(fluentPkg);
    _ffmpeg = mod.default || mod;
    try {
      const staticPkg = 'ffmpeg' + '-static';
      const pathMod = await import(staticPkg);
      _ffmpegPath = pathMod.default || pathMod;
      _ffmpeg.setFfmpegPath(_ffmpegPath);
    } catch (e) {
      console.warn('[VIDEO-EXTRACTOR] ffmpeg-static not available, using system ffmpeg');
    }
  }
  return _ffmpeg;
}
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { getSupabase } from '@/lib/supabase';
import crypto from 'crypto';
import { createLogger } from '@/lib/logger';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const vlog = createLogger('VIDEO-EXTRACTOR');

const ffmpegExePath = null; // resolved dynamically via getFfmpeg()

async function getYouTubeInfo(videoUrl) {
  const ytdlpPath = path.join(process.cwd(), 'bin', 'yt-dlp.exe');
  const cookiesFile = path.join(process.cwd(), 'bin', 'cookies.txt');
  
  // Strategy 1: Use cookies.txt file (most reliable)
  if (existsSync(cookiesFile)) {
    vlog.info('Using cookies.txt for YouTube auth');
    try {
      const { stdout } = await execFileAsync(ytdlpPath, [
        '--dump-json', '--no-warnings',
        '--cookies', cookiesFile,
        videoUrl
      ], { maxBuffer: 1024 * 1024 * 10 });
      return JSON.parse(stdout.trim());
    } catch (err) {
      vlog.warn(`cookies.txt failed: ${err.message?.slice(0, 100)}`);
    }
  }
  
  // Strategy 2: Try without cookies (may work for some videos)
  vlog.info('Trying yt-dlp without cookies...');
  const { stdout } = await execFileAsync(ytdlpPath, [
    '--dump-json', '--no-warnings',
    videoUrl
  ], { maxBuffer: 1024 * 1024 * 10 });
  return JSON.parse(stdout.trim());
}

export async function extractFramesFromYouTube(videoUrl, numFrames = 5, searchContext = '') {
  vlog.info(`Extracting ${numFrames} frames from ${videoUrl} [context: ${searchContext.slice(0, 50)}]`);
  
  const info = await getYouTubeInfo(videoUrl);
  const duration = parseInt(info.duration);
  if (!duration) throw new Error("Could not determine video length");

  const directUrl = info.url;
  if (!directUrl) throw new Error("Could not find video stream URL");

  const safeDuration = Math.max(duration - 10, 10);
  const interval = safeDuration / numFrames;
  const timestamps = [];
  for (let i = 0; i < numFrames; i++) {
    timestamps.push(5 + i * interval);
  }

  const tmpDir = path.join(process.cwd(), 'tmp', 'hunter-frames');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const batchId = crypto.randomUUID();
  const title = info.title;
  
  vlog.info(`Timestamps to extract: ${timestamps.join(', ')}`);

  return new Promise(async (resolve, reject) => {
    const ffmpeg = await getFfmpeg();
    ffmpeg(directUrl)
      .on('start', (cmd) => vlog.info(`FFmpeg started`))
      .on('end', async () => {
         vlog.info(`FFmpeg extraction finished for ${batchId}`);
         try {
           const supabase = getSupabase();
           if (!supabase) throw new Error("Supabase client not initialized");
           
           // Auto-create bucket if missing
           await supabase.storage.createBucket('cover-images', { public: true }).catch(() => {});
           
           const files = await fs.readdir(tmpDir);
           const batchFiles = files.filter(f => f.startsWith(batchId));
           
           // Sort them by index to keep order
           batchFiles.sort((a, b) => {
             const numA = parseInt(a.split('-').pop().split('.')[0]);
             const numB = parseInt(b.split('-').pop().split('.')[0]);
             return numA - numB;
           });

           // Load images for Gemini
           const imageContents = [];
           for (const file of batchFiles) {
             const filePath = path.join(tmpDir, file);
             const buffer = await fs.readFile(filePath);
             imageContents.push({
               data: buffer.toString('base64'),
               mimeType: 'image/jpeg',
               filename: file
             });
           }

           // Call Gemini Vision to filter — with smart context-aware prompt
           let selectedFiles = batchFiles;
           try {
             const contextInfo = searchContext ? `\nข้อมูลข่าว: "${searchContext}"` : '';
             const prompt = `คุณเป็น AI คัดเลือกภาพข่าว มีภาพ ${imageContents.length} ภาพจากวิดีโอชื่อ "${title}"${contextInfo}

**ภารกิจ**: คัดเลือก **ทุกภาพ** ที่ตรงตามเงื่อนไขต่อไปนี้:

✅ ต้องเลือก:
- ภาพที่เห็น **ใบหน้าคนชัดเจน** (ตัวละครหลักในข่าว, ผู้ถูกสัมภาษณ์, ผู้ประสบเหตุ)
- ภาพ **เหตุการณ์สำคัญ** (การช่วยเหลือ, สถานที่เกิดเหตุ, การปฏิบัติการ)
- ภาพ **เจ้าหน้าที่ลงพื้นที่** (ตำรวจ, ทหาร, กู้ภัย, อาสา)
- ภาพ **สภาพแวดล้อม** ที่เกี่ยวข้อง (สถานที่, บรรยากาศ)
- ภาพ **อารมณ์ความรู้สึก** (ร้องไห้, ดีใจ, ซาบซึ้ง)

❌ ต้องทิ้ง:
- ภาพ **ผู้ประกาศข่าวในสตูดิโอ** (นั่งอ่านข่าวในห้องส่ง)
- ภาพ **กราฟิก, ตัวหนังสือ, โลโก้สถานีข่าว** เป็นหลัก
- ภาพ **เบลอ** หรือมืดมากจนเห็นอะไรไม่ชัด
- ภาพ **ซ้ำกัน** (ถ้าเหมือนกันให้เก็บแค่ 1)

ตอบเป็น JSON object: {"selected": ["filename1.jpg", "filename2.jpg"]}
รายชื่อไฟล์ที่เลือกได้: ${batchFiles.join(', ')}`;

             const { callGeminiVision } = await import('@/lib/ai/geminiClient.js');
             
             const response = await callGeminiVision({
               prompt,
               images: imageContents,
               temperature: 0.1
             });
             
             // Parse response — could be {selected: [...]} or plain array
             let picked = [];
             if (response && response.selected && Array.isArray(response.selected)) {
               picked = response.selected;
             } else if (Array.isArray(response)) {
               picked = response;
             }
             
             if (picked.length > 0) {
               selectedFiles = picked.filter(f => batchFiles.includes(f));
               vlog.info(`Gemini selected ${selectedFiles.length} frames out of ${batchFiles.length}`);
               if (selectedFiles.length === 0) throw new Error("Gemini selected 0 valid frames");
             }
           } catch(err) {
             vlog.warn(`Gemini Vision filtering failed, falling back to 5 random frames: ${err.message}`);
             selectedFiles = batchFiles.sort(() => 0.5 - Math.random()).slice(0, 5);
           }
           
           const uploadedUrls = [];
           for (const file of batchFiles) {
             const filePath = path.join(tmpDir, file);
             
             if (selectedFiles.includes(file)) {
               const buffer = await fs.readFile(filePath);
               const fileName = `hunter/${crypto.randomUUID()}.jpg`;
               const { data, error } = await supabase.storage
                 .from('cover-images') // using existing bucket
                 .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });
                 
               if (error) {
                  vlog.warn(`Supabase upload error: ${error.message}. Falling back to local storage.`);
                  const publicHunterDir = path.join(process.cwd(), 'public', 'hunter');
                  if (!existsSync(publicHunterDir)) mkdirSync(publicHunterDir, { recursive: true });
                  const localFileName = `${crypto.randomUUID()}.jpg`;
                  await fs.copyFile(filePath, path.join(publicHunterDir, localFileName));
                  uploadedUrls.push({ 
                    url: `/hunter/${localFileName}`, 
                    title: title, 
                    source: 'YouTube Capture (Local)',
                    width: 1280,
                    height: 720
                  });
                } else {
                  const urlData = supabase.storage.from('cover-images').getPublicUrl(data.path);
                  uploadedUrls.push({ 
                    url: urlData.data.publicUrl, 
                    title: title, 
                    source: 'YouTube Capture',
                    width: 1280,
                    height: 720
                  });
                }
             }
             // Cleanup ALL files
             await fs.unlink(filePath).catch(() => {});
           }
           resolve(uploadedUrls);
         } catch (e) {
           reject(e);
         }
      })
      .on('error', (err) => {
         vlog.error(`FFmpeg error: ${err.message}`);
         reject(err);
      })
      .screenshots({
        timestamps: timestamps,
        filename: `${batchId}-%i.jpg`,
        folder: tmpDir,
        size: '1280x?'
      });
  });
}
