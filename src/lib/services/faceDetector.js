/**
 * Face Detector + Smart Crop Service
 * 
 * ตรวจจับหน้าคนในภาพ → return coordinates สำหรับ smart crop
 * ใช้ Gemini Vision สำหรับ face detection (ไม่ต้อง install face-api.js)
 * + smartcrop สำหรับ content-aware crop fallback
 * 
 * ห้ามแก้ไฟล์ core AI (openai.js, aiRouter.js)
 */
import sharp from 'sharp';
// GPT-4o-mini via callAI is the sole face detection provider (Gemini removed)

const LOG = '[FaceDetector]';

/**
 * ตรวจจับหน้าคนด้วย Gemini Vision API
 * @param {Buffer} imageBuffer - ภาพที่จะตรวจ
 * @returns {{ faces: Array<{x,y,width,height,confidence}>, hasFaces: boolean }}
 */
export async function detectFaces(imageBuffer, opts = {}) {
  // ★ 30 มิ.ย.: รับ maxDim/detail — เรียกซ้ำ "คมชัดสูง" ได้เมื่อรอบแรกตรวจหน้าไม่เจอ (หน้าเล็ก/เบลอจากเฟรมวิดีโอ)
  const maxDim = opts.maxDim || 800;
  const detail = opts.detail || 'low';

  let metadata = { width: 0, height: 0 };
  try {
    metadata = await sharp(imageBuffer).metadata();
  } catch (e) {
    console.error(`${LOG} Failed to read image metadata:`, e.message);
  }

  // Resize ภาพให้เล็กลงก่อนส่ง (ลด cost) — รอบ "คมชัดสูง" ใช้ภาพใหญ่+คุณภาพสูงกว่า เพื่อจับหน้าเล็ก/เบลอ
  let resized = imageBuffer;
  if (metadata.width > maxDim || metadata.height > maxDim) {
    try {
      resized = await sharp(imageBuffer)
        .resize(maxDim, maxDim, { fit: 'inside' })
        .jpeg({ quality: detail === 'high' ? 85 : 70 })
        .toBuffer();
    } catch (e) {
      console.error(`${LOG} Failed to resize image:`, e.message);
    }
  }

  const base64 = resized.toString('base64');

  // Try gpt-4o-mini first (vision model) as it is extremely fast and reliable
  try {
    const { callAI } = await import('@/lib/ai/openai');
    const gptPrompt = `Analyze this image for face detection. Return JSON only.
If there are people/faces visible, return their approximate bounding box as percentage of image dimensions (0-100).
Format:
{
  "faces": [
    { "x_pct": 30, "y_pct": 10, "w_pct": 40, "h_pct": 50, "description": "main person" }
  ],
  "main_subject_region": { "x_pct": 20, "y_pct": 5, "w_pct": 60, "h_pct": 90 },
  "has_faces": true,
  "face_count": 1,
  "best_crop_focus": "center-top",
  "has_big_text": false,
  "text_region": null
}
If no faces: has_faces=false, faces=[], and provide main_subject_region for the most interesting area.
has_big_text = true if the image is a social-media post screenshot, chat screenshot, news graphic with headline, OR has ANY burned-in text/captions/subtitles/dialogue-overlay/quote-overlay that would be visible on a cover — INCLUDING TV-drama subtitles, interview lower-third captions, quoted-speech overlays, and lyric/quote text. Only a tiny corner watermark or small channel logo = false. When in doubt, set true (a clean cover should not show burned-in sentences).
text_region: when has_big_text=true, give the bounding box of the main burned-in text block as { "x_pct": 0, "y_pct": 75, "w_pct": 100, "h_pct": 25 } (e.g. TV lower-third captions are usually the bottom strip) — so the system can crop the person while avoiding the text zone. null if has_big_text=false.`;

    const parsed = await callAI({
      prompt: gptPrompt,
      imageContents: [
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${base64}`, detail }
        }
      ],
      model: 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 500,
    });

    const faces = (parsed.faces || []).map(f => ({
      x: Math.round((f.x_pct / 100) * metadata.width),
      y: Math.round((f.y_pct / 100) * metadata.height),
      width: Math.round((f.w_pct / 100) * metadata.width),
      height: Math.round((f.h_pct / 100) * metadata.height),
      description: f.description || '',
    }));

    const subject = parsed.main_subject_region || { x_pct: 25, y_pct: 10, w_pct: 50, h_pct: 80 };

    console.log(`${LOG} ✅ gpt-4o-mini success: found ${faces.length} faces`);

    return {
      faces,
      hasFaces: parsed.has_faces || false,
      faceCount: parsed.face_count || 0,
      mainSubject: {
        x: Math.round((subject.x_pct / 100) * metadata.width),
        y: Math.round((subject.y_pct / 100) * metadata.height),
        width: Math.round((subject.w_pct / 100) * metadata.width),
        height: Math.round((subject.h_pct / 100) * metadata.height),
      },
      bestCropFocus: parsed.best_crop_focus || 'center',
      hasBigText: !!parsed.has_big_text, // ★ สกรีนช็อต/กราฟิกข่าว/ซับฝังใหญ่ — cover v3 ใช้ระวังภาพพวกนี้ในช่องคน
      // ★ โซนข้อความ (สัดส่วน 0-1) — ครอปคนหลบโซนนี้ได้ = ใช้เฟรมรายการทีวีได้โดยไม่ติดซับ
      textRegion: parsed.text_region && Number.isFinite(Number(parsed.text_region.x_pct))
        ? {
            x1: Math.max(0, Number(parsed.text_region.x_pct) / 100),
            y1: Math.max(0, Number(parsed.text_region.y_pct) / 100),
            x2: Math.min(1, (Number(parsed.text_region.x_pct) + Number(parsed.text_region.w_pct || 0)) / 100),
            y2: Math.min(1, (Number(parsed.text_region.y_pct) + Number(parsed.text_region.h_pct || 0)) / 100),
          }
        : null,
      imageWidth: metadata.width,
      imageHeight: metadata.height,
    };
  } catch (gptErr) {
    console.warn(`${LOG} ⚠️ gpt-4o-mini failed, trying Gemini fallback:`, gptErr.message);
  }

  // Gemini fallback removed — GPT-4o-mini is primary (above)
  console.warn(`${LOG} GPT-4o-mini was the only attempt — returning empty result`);
  return {
    faces: [],
    hasFaces: false,
    faceCount: 0,
    mainSubject: null,
    bestCropFocus: 'center',
    imageWidth: metadata.width || 0,
    imageHeight: metadata.height || 0,
  };
}

/**
 * Smart Crop — crop ภาพให้หน้าคนอยู่กึ่งกลาง
 * @param {Buffer} imageBuffer - ภาพต้นฉบับ
 * @param {number} targetWidth - ความกว้าง slot
 * @param {number} targetHeight - ความสูง slot
 * @param {Object} faceData - ผล detectFaces() (optional, จะ detect ใหม่ถ้าไม่ส่ง)
 * @returns {Buffer} ภาพที่ crop แล้ว
 */
export async function smartCrop(imageBuffer, targetWidth, targetHeight, faceData = null) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const srcW = metadata.width;
    const srcH = metadata.height;

    if (!srcW || !srcH) {
      return sharp(imageBuffer).resize(targetWidth, targetHeight, { fit: 'cover' }).toBuffer();
    }

    // Detect faces if not provided
    if (!faceData) {
      faceData = await detectFaces(imageBuffer);
    }

    // คำนวณ crop region
    const targetRatio = targetWidth / targetHeight;
    const srcRatio = srcW / srcH;

    let cropX = 0, cropY = 0, cropW = srcW, cropH = srcH;

    if (srcRatio > targetRatio) {
      // ภาพกว้างกว่า target → crop ซ้าย-ขวา
      cropW = Math.round(srcH * targetRatio);
      cropH = srcH;
    } else {
      // ภาพสูงกว่า target → crop บน-ล่าง
      cropW = srcW;
      cropH = Math.round(srcW / targetRatio);
    }

    if (faceData.hasFaces && faceData.faces.length > 0) {
      // ★ มีหน้าคน → center crop รอบหน้า
      const face = faceData.faces[0]; // ใช้หน้าแรก (ใหญ่สุด)
      const faceCenterX = face.x + face.width / 2;
      const faceCenterY = face.y + face.height / 2;

      // จัดให้หน้าอยู่ ~40% จากบน (ไม่ตรงกลางพอดี เพราะจะดูดีกว่า)
      cropX = Math.round(faceCenterX - cropW / 2);
      cropY = Math.round(faceCenterY - cropH * 0.4);
    } else if (faceData.mainSubject) {
      // ★ ไม่มีหน้า → center บน main subject
      const subj = faceData.mainSubject;
      const subjCenterX = subj.x + subj.width / 2;
      const subjCenterY = subj.y + subj.height / 2;

      cropX = Math.round(subjCenterX - cropW / 2);
      cropY = Math.round(subjCenterY - cropH / 2);
    } else {
      // ★ Fallback → center crop
      cropX = Math.round((srcW - cropW) / 2);
      cropY = Math.round((srcH - cropH) / 2);
    }

    // Clamp ไม่ให้เกินขอบภาพ
    cropX = Math.max(0, Math.min(cropX, srcW - cropW));
    cropY = Math.max(0, Math.min(cropY, srcH - cropH));
    cropW = Math.min(cropW, srcW - cropX);
    cropH = Math.min(cropH, srcH - cropY);

    // Crop + Resize
    return sharp(imageBuffer)
      .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
      .resize(targetWidth, targetHeight, { fit: 'fill' })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch (err) {
    console.error(`${LOG} smartCrop error:`, err.message);
    // Fallback: simple center crop
    return sharp(imageBuffer)
      .resize(targetWidth, targetHeight, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 90 })
      .toBuffer();
  }
}

/**
 * วิเคราะห์ภาพหลายรูป พร้อมกัน → return face data ทุกรูป
 * @param {Array<{id: string, buffer: Buffer}>} images
 * @returns {Map<string, Object>} faceDataMap
 */
export async function batchDetectFaces(images) {
  const results = new Map();
  
  // Process ทีละ 2 ภาพ (ไม่ให้ Gemini overload)
  const batchSize = 2;
  for (let i = 0; i < images.length; i += batchSize) {
    if (i > 0) {
      await new Promise(r => setTimeout(r, 600)); // sleep 600ms between batches
    }
    const batch = images.slice(i, i + batchSize);
    const promises = batch.map(async (img) => {
      const data = await detectFaces(img.buffer);
      results.set(img.id, data);
    });
    await Promise.all(promises);
  }
  
  return results;
}
