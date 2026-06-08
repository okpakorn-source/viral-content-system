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

const LOG = '[FaceDetector]';

/**
 * ตรวจจับหน้าคนด้วย Gemini Vision API
 * @param {Buffer} imageBuffer - ภาพที่จะตรวจ
 * @returns {{ faces: Array<{x,y,width,height,confidence}>, hasFaces: boolean }}
 */
export async function detectFaces(imageBuffer) {
  const MAX_RETRIES = 3;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      // Resize ภาพให้เล็กลงก่อนส่ง (ลด cost)
      const metadata = await sharp(imageBuffer).metadata();
      const maxDim = 800;
      let resized = imageBuffer;
      if (metadata.width > maxDim || metadata.height > maxDim) {
        resized = await sharp(imageBuffer)
          .resize(maxDim, maxDim, { fit: 'inside' })
          .jpeg({ quality: 70 })
          .toBuffer();
      }

      const base64 = resized.toString('base64');

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64,
          },
        },
        {
          text: `Analyze this image for face detection. Return JSON only, no markdown.

If there are people/faces visible, return their approximate bounding box as percentage of image dimensions (0-100).

Format:
{
  "faces": [
    { "x_pct": 30, "y_pct": 10, "w_pct": 40, "h_pct": 50, "description": "main person" }
  ],
  "main_subject_region": { "x_pct": 20, "y_pct": 5, "w_pct": 60, "h_pct": 90 },
  "has_faces": true,
  "face_count": 1,
  "best_crop_focus": "center-top"
}

If no faces: has_faces=false, faces=[], and provide main_subject_region for the most interesting area.
best_crop_focus options: "center", "center-top", "center-bottom", "left", "right", "top-left", "top-right"`,
        },
      ]);

      const text = result.response.text();
      // Clean JSON from markdown code blocks
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      // Convert percentage to pixel coordinates
      const faces = (parsed.faces || []).map(f => ({
        x: Math.round((f.x_pct / 100) * metadata.width),
        y: Math.round((f.y_pct / 100) * metadata.height),
        width: Math.round((f.w_pct / 100) * metadata.width),
        height: Math.round((f.h_pct / 100) * metadata.height),
        description: f.description || '',
      }));

      const subject = parsed.main_subject_region || { x_pct: 25, y_pct: 10, w_pct: 50, h_pct: 80 };

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
        imageWidth: metadata.width,
        imageHeight: metadata.height,
      };
    } catch (err) {
      const is503 = err.message?.includes('503') || err.message?.includes('high demand');
      if (is503 && attempt < MAX_RETRIES) {
        const delay = (attempt + 1) * 2000; // 2s, 4s, 6s
        console.warn(`${LOG} 503 retry ${attempt + 1}/${MAX_RETRIES} (wait ${delay}ms)...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.error(`${LOG} detectFaces error:`, err.message);
      return {
        faces: [],
        hasFaces: false,
        faceCount: 0,
        mainSubject: null,
        bestCropFocus: 'center',
        imageWidth: 0,
        imageHeight: 0,
      };
    }
  }
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
  
  // Process ทีละ 3 ภาพ (ไม่ให้ Gemini overload)
  const batchSize = 3;
  for (let i = 0; i < images.length; i += batchSize) {
    const batch = images.slice(i, i + batchSize);
    const promises = batch.map(async (img) => {
      const data = await detectFaces(img.buffer);
      results.set(img.id, data);
    });
    await Promise.all(promises);
  }
  
  return results;
}
