/**
 * =====================================================
 * Playwright Video Frame Capture Service v2
 * =====================================================
 * Strategy: Extract YouTube storyboard sprite sheets
 * (the thumbnail strips used for seek bar preview)
 * No need to play video — just parse page config + download images
 */
// playwright-core is loaded dynamically to avoid bundling Chromium binary on Vercel
// Computed string prevents Turbopack from tracing this import at build time
let _chromium = null;
async function getChromium() {
  if (!_chromium) {
    try {
      const pkg = 'playwright' + '-core';
      const pw = await import(pkg);
      _chromium = pw.chromium;
    } catch (e) {
      throw new Error('playwright-core ไม่พร้อมใช้งานในสภาพแวดล้อมนี้: ' + e.message);
    }
  }
  return _chromium;
}
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getSupabase } from '../supabase.js';
import { createLogger } from '@/lib/logger';

const plog = createLogger('PLAYWRIGHT-CAPTURE');

function findChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.CHROME_PATH,
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Capture frames from YouTube video using storyboard extraction
 * @param {string} videoUrl - YouTube URL
 * @param {number} numFrames - จำนวนช็อตที่ต้องการ (will get more from storyboards)
 * @param {string} searchContext - คำอธิบายข่าวสำหรับ Gemini Vision
 */
export async function captureVideoFrames(videoUrl, numFrames = 15, searchContext = '') {
  const chromePath = findChromePath();
  if (!chromePath) throw new Error('Chrome not found');
  
  let videoId;
  try { videoId = new URL(videoUrl).searchParams.get('v'); } catch (_) {}
  if (!videoId) throw new Error(`Invalid YouTube URL: ${videoUrl}`);
  
  plog.info(`Capturing frames from ${videoId} via storyboard extraction`);
  
  let browser;
  try {
    const chromium = await getChromium();
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        '--headless=new',
        '--no-sandbox', '--disable-setuid-sandbox',
        '--window-position=-10000,-10000', '--window-size=1,1',
      ]
    });
    
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    
    // Set consent cookies
    await page.context().addCookies([{
      name: 'SOCS', value: 'CAISHAgCEhJnd3NfMjAyNDA4MjgtMF9SQzIaAmVuIAEaBgiA_cmzBg',
      domain: '.youtube.com', path: '/',
    }]);
    
    // Load YouTube watch page (not embed — to get player config)
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: 'domcontentloaded', timeout: 20000
    });
    
    // Extract storyboard URLs from ytInitialPlayerResponse
    const storyboardData = await page.evaluate(() => {
      try {
        // Method 1: ytInitialPlayerResponse
        if (window.ytInitialPlayerResponse) {
          const sb = window.ytInitialPlayerResponse?.storyboards?.playerStoryboardSpecRenderer?.spec;
          const title = window.ytInitialPlayerResponse?.videoDetails?.title;
          if (sb) return { spec: sb, title };
        }
        
        // Method 2: Parse from page source
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const text = script.textContent || '';
          const match = text.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
          if (match) {
            const data = JSON.parse(match[1]);
            const sb = data?.storyboards?.playerStoryboardSpecRenderer?.spec;
            const title = data?.videoDetails?.title;
            if (sb) return { spec: sb, title };
          }
        }
        return null;
      } catch (e) {
        return null;
      }
    });
    
    await browser.close();
    browser = null;
    
    if (!storyboardData || !storyboardData.spec) {
      throw new Error('Could not extract storyboard data from YouTube page');
    }
    
    plog.info(`Got storyboard spec for "${storyboardData.title?.slice(0, 50)}"`);
    
    // Parse storyboard spec — format:
    // baseUrl | w#h#count#cols#rows#interval#namePattern#sigh | w#h#... | ...
    // | = top-level separator (base URL + levels)
    // # = field separator within each level
    // baseUrl contains $L (level index) and $N (sheet filename)
    const fullSpec = storyboardData.spec;
    plog.info(`Storyboard spec (first 300ch): ${fullSpec.slice(0, 300)}`);
    
    const pipeSegments = fullSpec.split('|');
    const baseUrl = pipeSegments[0]; // URL template with $L and $N
    
    // Each subsequent pipe segment is a quality level: w#h#count#cols#rows#interval#namePattern#sigh
    const levels = pipeSegments.slice(1).map(seg => {
      const fields = seg.split('#');
      return {
        width: parseInt(fields[0]) || 160,
        height: parseInt(fields[1]) || 90,
        count: parseInt(fields[2]) || 100,
        cols: parseInt(fields[3]) || 5,
        rows: parseInt(fields[4]) || 5,
        interval: parseInt(fields[5]) || 0,
        namePattern: fields[6] || 'M$M',
        sigh: fields[7] || '',
      };
    });
    
    if (levels.length === 0) throw new Error('No storyboard levels found');
    
    // Use the highest quality level (last one)
    const levelIndex = levels.length - 1;
    const best = levels[levelIndex];
    
    const framesPerSheet = best.cols * best.rows;
    const totalSheets = Math.ceil(best.count / framesPerSheet);
    
    plog.info(`Storyboard L${levelIndex}: ${best.count} frames, ${best.cols}x${best.rows} per sheet, ${totalSheets} sheets, ${best.width}x${best.height}px`);
    
    // Download storyboard sprite sheets and split into individual frames
    const tmpDir = path.join(process.cwd(), 'tmp', 'pw-frames');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    
    const batchId = crypto.randomUUID();
    const capturedFiles = [];
    
    // Sample evenly across all sheets
    const sheetsToDownload = Math.min(totalSheets, 5);
    const sheetIndices = [];
    for (let i = 0; i < sheetsToDownload; i++) {
      sheetIndices.push(Math.floor(i * totalSheets / sheetsToDownload));
    }
    
    // Use Playwright to split sprite sheets via Canvas (reuses chromium from above)
    const chromium2 = await getChromium();
    const splitBrowser = await chromium2.launch({
      executablePath: chromePath, headless: true,
      args: ['--headless=new', '--no-sandbox', '--window-position=-10000,-10000', '--window-size=1,1']
    });
    const splitPage = await splitBrowser.newPage();
    
    for (const sheetIdx of sheetIndices) {
      try {
        // Build storyboard URL: replace $L with level index, $N with sheet filename
        // namePattern is like "M$M" where $M = sheet index, or "default" for level 0
        const sheetName = best.namePattern.replace('$M', String(sheetIdx));
        let sheetUrl = baseUrl
          .replace('$L', String(levelIndex))
          .replace('$N', sheetName);
        
        // Add sigh parameter for authentication
        if (best.sigh && !sheetUrl.includes('sigh=')) {
          sheetUrl += (sheetUrl.includes('?') ? '&' : '?') + `sigh=${best.sigh}`;
        }
        
        plog.info(`Sheet ${sheetIdx} URL: ${sheetUrl.slice(0, 120)}...`);
        
        // Download image SERVER-SIDE to bypass CORS
        const imgRes = await fetch(sheetUrl);
        if (!imgRes.ok) {
          plog.warn(`Sheet ${sheetIdx} HTTP ${imgRes.status}`);
          continue;
        }
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        const imgBase64 = imgBuffer.toString('base64');
        
        // Split sprite sheet using Canvas in browser (base64 = no CORS!)
        const frames = await splitPage.evaluate(async ({ base64Data, cols, rows, thumbWidth, thumbHeight }) => {
          return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const results = [];
              const canvas = document.createElement('canvas');
              canvas.width = thumbWidth;
              canvas.height = thumbHeight;
              const ctx = canvas.getContext('2d');
              
              for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                  ctx.clearRect(0, 0, thumbWidth, thumbHeight);
                  ctx.drawImage(img, 
                    col * thumbWidth, row * thumbHeight, thumbWidth, thumbHeight,
                    0, 0, thumbWidth, thumbHeight
                  );
                  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                  const base64 = dataUrl.split(',')[1];
                  if (base64 && base64.length > 500) {
                    results.push(base64);
                  }
                }
              }
              resolve(results);
            };
            img.onerror = () => resolve([]);
            img.src = `data:image/jpeg;base64,${base64Data}`;
          });
        }, { base64Data: imgBase64, cols: best.cols, rows: best.rows, thumbWidth: best.width, thumbHeight: best.height });
        
        // Save individual frames
        for (let i = 0; i < frames.length; i++) {
          const filename = `${batchId}-s${sheetIdx}-f${i + 1}.jpg`;
          const filePath = path.join(tmpDir, filename);
          await fs.writeFile(filePath, Buffer.from(frames[i], 'base64'));
          capturedFiles.push(filename);
        }
        
        plog.info(`Sheet ${sheetIdx}: extracted ${frames.length} frames`);
      } catch (err) {
        plog.warn(`Sheet ${sheetIdx} failed: ${err.message?.slice(0, 60)}`);
      }
    }
    
    await splitBrowser.close();
    
    plog.info(`Total captured: ${capturedFiles.length} frames from storyboards`);
    
    if (capturedFiles.length === 0) throw new Error('No frames from storyboards');
    
    // === Gemini Vision Filtering ===
    const videoTitle = storyboardData.title || searchContext || `YouTube ${videoId}`;
    let selectedFiles = capturedFiles;
    
    // Sample max 20 frames for Gemini (to save tokens)
    const sampled = capturedFiles.length > 20 
      ? capturedFiles.filter((_, i) => i % Math.ceil(capturedFiles.length / 20) === 0).slice(0, 20)
      : capturedFiles;
    
    try {
      const imageContents = [];
      for (const file of sampled) {
        const buffer = await fs.readFile(path.join(tmpDir, file));
        imageContents.push({ data: buffer.toString('base64'), mimeType: 'image/jpeg', filename: file });
      }
      
      const contextInfo = searchContext ? `\nข้อมูลข่าว: "${searchContext}"` : '';
      const prompt = `คุณเป็น AI คัดเลือกภาพข่าว มีภาพ ${imageContents.length} ภาพจากวิดีโอ "${videoTitle}"${contextInfo}

✅ เลือก: ใบหน้าคนชัด, เหตุการณ์สำคัญ, เจ้าหน้าที่, สภาพแวดล้อม, อารมณ์ความรู้สึก
❌ ทิ้ง: ผู้ประกาศข่าวในสตูดิโอ, กราฟิก/ตัวหนังสือ/โลโก้, ภาพเบลอ, ภาพซ้ำ

ตอบ JSON: {"selected": ["filename1.jpg", "filename2.jpg"]}
ไฟล์: ${sampled.join(', ')}`;

      const { callGeminiVision } = await import('@/lib/ai/geminiClient.js');
      const response = await callGeminiVision({ prompt, images: imageContents, temperature: 0.1 });
      
      let picked = [];
      if (response?.selected && Array.isArray(response.selected)) picked = response.selected;
      else if (Array.isArray(response)) picked = response;
      
      if (picked.length > 0) {
        selectedFiles = picked.filter(f => sampled.includes(f));
        plog.info(`Gemini selected ${selectedFiles.length} of ${sampled.length} frames`);
        if (selectedFiles.length === 0) selectedFiles = sampled;
      } else {
        selectedFiles = sampled; // Use all sampled if Gemini returns nothing
      }
    } catch (err) {
      plog.warn(`Gemini Vision failed: ${err.message?.slice(0, 80)}`);
      selectedFiles = sampled;
    }
    
    // === Upload selected frames ===
    const supabase = getSupabase();
    const uploadedUrls = [];
    
    for (const file of selectedFiles) {
      const filePath = path.join(tmpDir, file);
      try {
        const buffer = await fs.readFile(filePath);
        
        if (supabase) {
          await supabase.storage.createBucket('cover-images', { public: true }).catch(() => {});
          const fileName = `hunter/${crypto.randomUUID()}.jpg`;
          const { data, error } = await supabase.storage
            .from('cover-images')
            .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });
          
          if (!error && data) {
            const urlData = supabase.storage.from('cover-images').getPublicUrl(data.path);
            uploadedUrls.push({
              url: urlData.data.publicUrl, title: videoTitle,
              source: 'YouTube Frame Capture', width: best.width, height: best.height
            });
          } else {
            const publicDir = path.join(process.cwd(), 'public', 'hunter');
            if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });
            const localName = `${crypto.randomUUID()}.jpg`;
            await fs.copyFile(filePath, path.join(publicDir, localName));
            uploadedUrls.push({
              url: `/hunter/${localName}`, title: videoTitle,
              source: 'YouTube Frame Capture (Local)', width: best.width, height: best.height
            });
          }
        } else {
          const publicDir = path.join(process.cwd(), 'public', 'hunter');
          if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });
          const localName = `${crypto.randomUUID()}.jpg`;
          await fs.copyFile(filePath, path.join(publicDir, localName));
          uploadedUrls.push({
            url: `/hunter/${localName}`, title: videoTitle,
            source: 'YouTube Frame Capture (Local)', width: best.width, height: best.height
          });
        }
      } catch (_) {}
    }
    
    // Cleanup ALL temp files
    for (const file of capturedFiles) {
      await fs.unlink(path.join(tmpDir, file)).catch(() => {});
    }
    
    plog.info(`✅ Uploaded ${uploadedUrls.length} curated frames from storyboards`);
    return uploadedUrls;
    
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}
