import { callAI } from '@/lib/ai/openai';
import { createLogger } from '@/lib/logger';
import { MODEL_VISION } from '@/lib/ai/modelConfig';

const hlog = createLogger('IMAGE-HUNTER');
const SERPER_API_KEY = process.env.SERPER_API_KEY;

export async function huntImages(userPrompt, mode = 'images') {
  hlog.info(`Hunting images for: ${userPrompt} [Mode: ${mode}]`);
  
  if (!SERPER_API_KEY) throw new Error('SERPER_API_KEY is missing');

  // 1. Query Expansion (Using GPT-4o to generate optimized search queries)
  const systemPrompt = `คุณคือ AI ผู้เชี่ยวชาญการค้นหารูปภาพ/วิดีโอข่าวไวรัล
งานของคุณคือสร้างคำค้นหา (Search Query) จำนวน 3 คำ เพื่อหาข้อมูลเกี่ยวกับ: "${userPrompt}"
โดยแบ่งเป็น 3 มุมมองดังนี้:
1. มุมมองหาตัวละครหลัก (Main Subject) (เช่น "สัมภาษณ์ [ชื่อคน/สถานที่]")
2. มุมมองเหตุการณ์ (The Action) (เช่น "วินาทีช่วยเหลือ [เหตุการณ์]")
3. มุมมองสภาพแวดล้อม (Context) (เช่น "เจ้าหน้าที่ กู้ภัย [สถานที่]")
- แพลตฟอร์ม: Google ${mode === 'youtube' ? 'Video' : 'Images'}
${mode === 'youtube' ? '- ข้อกำหนด: ห้ามใส่ชื่อสำนักข่าวท้ายคำค้นหา เพื่อให้ได้คลิปต้นฉบับที่หลากหลาย' : ''}
- การตอบกลับ: ให้ตอบกลับมาเป็น JSON object ในรูปแบบ {"queries": ["คำค้นหา1", "คำค้นหา2", "คำค้นหา3"]}
ตัวอย่าง: {"queries": ["สัมภาษณ์ ปอน จักรกฤษ ถ้ำลาว", "วินาทีช่วยเหลือ ถ้ำ ลาว", "เจ้าหน้าที่ กู้ภัย ถ้ำลาว"]}`;

  let queries = [userPrompt];
  try {
    const aiResponse = await callAI({
      systemPrompt: systemPrompt,
      userPrompt: userPrompt,
      model: MODEL_VISION,
      temperature: 0.7,
    });
    
    // callAI returns parsed JSON object — extract queries array
    if (aiResponse && aiResponse.queries && Array.isArray(aiResponse.queries)) {
      queries = aiResponse.queries;
    } else if (Array.isArray(aiResponse) && aiResponse.length > 0) {
      queries = aiResponse;
    } else {
      // Try to find any array value in the response object
      const vals = Object.values(aiResponse || {});
      const arrVal = vals.find(v => Array.isArray(v) && v.length > 0);
      if (arrVal) queries = arrVal;
    }
  } catch (err) {
    hlog.warn('AI Query Expansion failed, using raw user prompt', err);
  }

  hlog.info(`Generated queries: ${queries.join(', ')}`);

  const headers = { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' };
  const allImages = [];
  const seenUrls = new Set();

  if (mode === 'youtube') {
    hlog.info('Running Smart Frame Extraction Pipeline...');
    
    // === PHASE 1: Search YouTube videos via Serper ===
    let topVideos = [];
    for (const q of queries) {
      try {
        const body = JSON.stringify({ q, gl: 'th', hl: 'th', num: 10 });
        const res = await fetch('https://google.serper.dev/videos', { method: 'POST', headers, body });
        if (!res.ok) continue;
        const data = await res.json();
        const ytVideos = (data.videos || []).filter(v => v.link.includes('youtube.com/watch'));
        let addedCount = 0;
        for (const v of ytVideos) {
          if (!seenUrls.has(v.link) && addedCount < 4) {
            seenUrls.add(v.link);
            topVideos.push(v);
            addedCount++;
          }
        }
      } catch (e) {
        hlog.warn(`Serper Video failed for query: ${q}`, e);
      }
    }

    hlog.info(`Found ${topVideos.length} YouTube videos`);

    // Phase 2 (Playwright frame capture) disabled — requires local Chrome binary
    // Using YouTube thumbnails + Google Images instead (works on all environments)

    // === PHASE 3: Always add YouTube Thumbnails + Google Images as supplements ===
    // Thumbnails (public, no auth needed)
    for (const video of topVideos) {
      try {
        const videoId = new URL(video.link).searchParams.get('v');
        if (!videoId) continue;
        const thumbUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
        if (!seenUrls.has(thumbUrl)) {
          seenUrls.add(thumbUrl);
          allImages.push({
            url: thumbUrl,
            title: video.title || 'YouTube Video',
            source: `YouTube Thumbnail: ${video.channel || 'Unknown'}`,
            width: 1280,
            height: 720
          });
        }
      } catch (_) {}
    }

    // Google Images (same queries)
    for (const q of queries) {
      try {
        const body = JSON.stringify({ q, gl: 'th', hl: 'th', num: 20 });
        const res = await fetch('https://google.serper.dev/images', { method: 'POST', headers, body });
        if (!res.ok) continue;
        const data = await res.json();
        for (const img of (data.images || [])) {
          if (!seenUrls.has(img.imageUrl)) {
            seenUrls.add(img.imageUrl);
            allImages.push({
              url: img.imageUrl,
              title: img.title,
              source: img.source,
              width: img.imageWidth,
              height: img.imageHeight
            });
          }
        }
      } catch (e) {
        hlog.warn(`Serper Images failed for query: ${q}`, e);
      }
    }

    hlog.info(`Total images found: ${allImages.length}`);
    return allImages.slice(0, 80);


  }

  // mode === 'images'
  for (const q of queries) {
    try {
      const body = JSON.stringify({ q, gl: 'th', hl: 'th', num: 20 });
      const res = await fetch('https://google.serper.dev/images', { method: 'POST', headers, body });
      if (!res.ok) continue;
      const data = await res.json();
      const images = data.images || [];
      
      for (const img of images) {
        if (!seenUrls.has(img.imageUrl)) {
          seenUrls.add(img.imageUrl);
          allImages.push({
            url: img.imageUrl,
            title: img.title,
            source: img.source,
            width: img.imageWidth,
            height: img.imageHeight
          });
        }
      }
    } catch (e) {
      hlog.warn(`Serper failed for query: ${q}`, e);
    }
  }
  
  // Return up to 40 unique images, prioritized by relevance from the first query
  return allImages.slice(0, 40); 
}
