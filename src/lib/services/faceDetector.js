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
// ★ 9 ก.ค. 2026: ตาหาหน้า 2 ชั้น — gpt-4o-mini (callAI) เป็นตัวแรกเสมอ → ถ้าล้ม (เช่น OpenAI 429 quota หมด)
//   ตกไป Gemini vision fallback (REST v1beta) ท้ายไฟล์ · kill-switch: FACE_GEMINI_FALLBACK=0 = ปิด fallback

const LOG = '[FaceDetector]';

// ★ 9 ก.ค. 2026 เฟส 6B.1: normalize "ท่าหน้า" (pose) จากคำตอบโมเดล → enum ปลอดภัย 4 ค่า
//   frontal (หน้าตรง) · three_quarter (เฉียง 3/4) · profile (มุมข้าง) · back (หันหลัง)
//   ค่าแปลก/ว่าง → 'frontal' (default ปลอดภัยสุด — ไม่โดนหักคะแนน hero) · additive ล้วน ไม่กระทบ consumer เดิม
function normalizePose(v) {
  const t = String(v || '').toLowerCase().trim();
  if (!t) return 'frontal';
  if (/back|behind|rear|turned away|facing away|away from/.test(t)) return 'back';
  if (/profile|side[-\s]?view|side face|sideways|side profile/.test(t)) return 'profile';
  if (/three|3\/?4|3-4|quarter|angled|angle|turn/.test(t)) return 'three_quarter';
  if (/front|frontal|straight|facing|camera/.test(t)) return 'frontal';
  return 'frontal';
}

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
    { "x_pct": 30, "y_pct": 10, "w_pct": 40, "h_pct": 50, "description": "main person", "pose": "frontal | three_quarter | profile | back" }
  ],
  "main_subject_region": { "x_pct": 20, "y_pct": 5, "w_pct": 60, "h_pct": 90 },
  "has_faces": true,
  "face_count": 1,
  "best_crop_focus": "center-top",
  "has_big_text": false,
  "text_region": null,
  "watermark_region": null,
  "face_emotion": "smiling | laughing | crying | sad | angry | shocked | serious | neutral | unknown",
  "emotion_intensity": "strong | mild | none"
}
If no faces: has_faces=false, faces=[], and provide main_subject_region for the most interesting area.
★ "faces" = REAL HUMAN faces in the photograph ONLY. Do NOT count as faces: royal emblems/crests/insignia, logos, ornaments, patterns on fabric/curtains, statues, dolls, paintings, drawings, cartoons, posters or photos-of-photos in the background. If a human stands in front of decorated fabric/backdrop, the face box must be on the HUMAN's head — double-check the box actually contains eyes+nose+mouth of a person. (Real bug: a gold royal emblem on a purple curtain was returned as the face while the actual person stood beside it.)
face_emotion = the ACTUAL facial expression of the MAIN face — read the mouth/eyes/brows directly, do NOT guess from the scene/background/mood. Use "unknown" if there is no clear face.
emotion_intensity = how strong that expression is (strong = very clear & dominant / mild = somewhat visible / none = flat or neutral).
pose = head orientation of EACH face relative to the camera: "frontal" = looking toward camera, both eyes visible, face fully readable / "three_quarter" = angled ~45°, one side of face turned away but both eyes still visible / "profile" = strict side view, only one eye/ear, the far side of the face hidden / "back" = back of the head, face NOT visible. Judge by which facial features are visible, not by the mood. Use "frontal" when unsure.
has_big_text = true if the image is a social-media post screenshot, chat screenshot, news graphic with headline, OR has ANY burned-in text/captions/subtitles/dialogue-overlay/quote-overlay that would be visible on a cover — INCLUDING TV-drama subtitles, interview lower-third captions, quoted-speech overlays, and lyric/quote text. Only a tiny corner watermark or small channel logo = false. When in doubt, set true (a clean cover should not show burned-in sentences).
text_region: when has_big_text=true, give the bounding box of the main burned-in text block as { "x_pct": 0, "y_pct": 75, "w_pct": 100, "h_pct": 25 } (e.g. TV lower-third captions are usually the bottom strip) — so the system can crop the person while avoiding the text zone. null if has_big_text=false.
watermark_region: SEPARATE from has_big_text — if the photo has a press/agency watermark or channel logo ANYWHERE (even small, faint, semi-transparent, or in a corner — e.g. "ผู้จัดการ", "ไทยรัฐ", channel logos), give its bounding box e.g. { "x_pct": 55, "y_pct": 88, "w_pct": 45, "h_pct": 12 } — ★ numbers MUST be 0-100 percent of image (NOT 0-1 fractions). null if none. This field does NOT change has_big_text (keep its rule unchanged) — it is only used to crop AROUND the watermark.`;

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
      maxTokens: 700, // ★ rev.S4: 500→700 — เพิ่ม watermark_region แล้ว output เดิม ~460-640ch เสี่ยง JSON โดนตัด
    });

    const faces = (parsed.faces || []).map(f => ({
      x: Math.round((f.x_pct / 100) * metadata.width),
      y: Math.round((f.y_pct / 100) * metadata.height),
      width: Math.round((f.w_pct / 100) * metadata.width),
      height: Math.round((f.h_pct / 100) * metadata.height),
      description: f.description || '',
      pose: normalizePose(f.pose), // ★ เฟส 6B.1: ท่าหน้า (frontal/three_quarter/profile/back) — additive
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
      // ★ Emotion Gate (เฟส 1, 2 ก.ค.): อารมณ์สีหน้า — ใช้กรองภาพอารมณ์ขัดข่าวก่อนทำฮีโร่/ประกอบปก (ฟรี ขอจาก call เดิม)
      faceEmotion: parsed.face_emotion || 'unknown',
      emotionIntensity: parsed.emotion_intensity || 'none',
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
      // ★ rev.S4 (2 ก.ค.): โซนลายน้ำ/โลโก้สำนักข่าว (แยกจาก has_big_text) — ใช้ครอปหลบ ไม่ใช้ตัดสิน reject
      //   ★ S4b: โมเดลบางทีตอบ "เศษส่วน 0-1" แทนเปอร์เซ็นต์ (เจอจริง: y_pct 0.8 แทน 80) → เดา scale จากค่าที่ได้
      watermarkRegion: (() => {
        const r = parsed.watermark_region;
        if (!r || !Number.isFinite(Number(r.x_pct))) return null;
        const x = Number(r.x_pct), y = Number(r.y_pct), w = Number(r.w_pct || 0), h = Number(r.h_pct || 0);
        const scale = (x <= 1.5 && y <= 1.5 && w <= 1.5 && h <= 1.5) ? 1 : 100; // 0-1 fraction หรือ 0-100 percent
        const box = {
          x1: Math.max(0, x / scale), y1: Math.max(0, y / scale),
          x2: Math.min(1, (x + w) / scale), y2: Math.min(1, (y + h) / scale),
        };
        return (box.x2 > box.x1 && box.y2 > box.y1) ? box : null;
      })(),
      imageWidth: metadata.width,
      imageHeight: metadata.height,
    };
  } catch (gptErr) {
    console.warn(`${LOG} ⚠️ gpt-4o-mini ล้ม — ตกไป Gemini fallback:`, gptErr.message);
  }

  // ★ 9 ก.ค. 2026: กู้ Gemini fallback ที่เคยถูกถอดทิ้ง (ขัดกฎ AGENTS.md ห้ามลบ fallback)
  //   เหตุ: OpenAI ตอบ 429 quota หมดทั้งบัญชี → gpt-4o-mini ล้ม → เดิมคืนว่างทันที ท่อประกอบปกทั้งระบบหยุด
  //   Gemini = fallback เท่านั้น (gpt-4o-mini ยังเป็นตัวแรกเสมอ) · ปิดด้วย FACE_GEMINI_FALLBACK=0
  if (process.env.FACE_GEMINI_FALLBACK !== '0') {
    try {
      const gem = await detectFacesGemini(base64, metadata);
      if (gem) {
        console.log(`${LOG} ✅ Gemini fallback สำเร็จ: พบ ${gem.faces.length} หน้า`);
        return gem;
      }
      console.warn(`${LOG} ⚠️ Gemini fallback อ่านผลไม่ได้ (JSON ว่าง/พัง)`);
    } catch (gemErr) {
      console.warn(`${LOG} ⚠️ Gemini fallback ล้ม:`, gemErr.message);
    }
  }

  // ★ ทั้ง GPT และ Gemini ล้ม (หรือ fallback ถูกปิด) → คืนผลว่าง (โครงเดิมเป๊ะ)
  console.warn(`${LOG} ❌ ทั้ง GPT และ Gemini ล้ม — คืนผลว่าง`);
  return {
    faces: [],
    hasFaces: false,
    faceCount: 0,
    mainSubject: null,
    bestCropFocus: 'center',
    faceEmotion: 'unknown',
    emotionIntensity: 'none',
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

// ============================================================
// ★ 9 ก.ค. 2026: Gemini vision fallback ของตาหาหน้า (กู้ที่เคยถูกถอด)
// ------------------------------------------------------------
//   ใช้เมื่อ gpt-4o-mini ล้ม (เช่น OpenAI 429 quota หมด) — Gemini เป็น "ตัวสำรอง" เท่านั้น
//   pattern ยึดตาม imageSearchVision.js: REST v1beta generateContent + inline_data(base64)
//   + responseMimeType application/json + retry 1 ครั้งสำหรับ 429/5xx (mini-retry ในไฟล์ กัน
//   coupling ท่อประกอบปกเข้ากับ imageSearchBrain ที่แยกเดี่ยว 100%)
//   คีย์: GEMINI_API_KEY หรือ GOOGLE_API_KEY (ตัวเดียวกับตาคัด triage ที่ใช้ทุกวัน) — ห้าม log คีย์
// ============================================================

const GEMINI_TIMEOUT_MS = 30000; // ~30s ต่อภาพ (ตามสเปค)

// clamp กล่องสัดส่วน 0-1 + ตรวจ x2>x1, y2>y1 (กฎเดียวกับ validate ผล GPT) → {x1,y1,x2,y2} หรือ null
function _clampBox01(b) {
  if (!b) return null;
  const x1 = Number(b.x1), y1 = Number(b.y1), x2 = Number(b.x2), y2 = Number(b.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const cx1 = Math.max(0, Math.min(1, x1)), cy1 = Math.max(0, Math.min(1, y1));
  const cx2 = Math.max(0, Math.min(1, x2)), cy2 = Math.max(0, Math.min(1, y2));
  return (cx2 > cx1 && cy2 > cy1) ? { x1: cx1, y1: cy1, x2: cx2, y2: cy2 } : null;
}

// parse JSON จาก Gemini (เผื่อโดน ```json fence หรือมีข้อความหุ้ม) — แบบเดียวกับ imageSearchVision.safeParse
function _parseGeminiJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch {
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; } }
    return null;
  }
}

// เรียก Gemini REST ครั้งเดียว + timeout 30s (โยน error พร้อม .status เมื่อ 429/5xx) — ไม่ log คีย์
async function _geminiGenerateOnce(base64, prompt, model) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    const e = new Error('ไม่พบ GEMINI_API_KEY / GOOGLE_API_KEY');
    e.errorType = 'NO_GEMINI_KEY';
    throw e; // ไม่ retryable
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents: [{ role: 'user', parts: [
      { text: prompt },
      { inline_data: { mime_type: 'image/jpeg', data: base64 } },
    ] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      // ★ ตัด error message ให้สั้น + ไม่แนบ url/คีย์ ลง log
      const e = new Error(`Gemini error ${res.status}: ${JSON.stringify(d.error || d).slice(0, 160)}`);
      e.status = res.status;
      throw e;
    }
    return d;
  } finally {
    clearTimeout(timer);
  }
}

// retry 1 ครั้งสำหรับ 429/5xx/network (รวม 2 attempts) — ยึดแบบ withRetry ของ imageSearchVision
async function _geminiWithRetry(base64, prompt, model) {
  const retryable = (err) => {
    const s = Number(err?.status);
    if (s === 429 || (s >= 500 && s <= 599)) return true;
    return /abort|timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(String(err?.message || ''));
  };
  try {
    return await _geminiGenerateOnce(base64, prompt, model);
  } catch (err) {
    if (!retryable(err)) throw err;
    console.warn(`${LOG} ⏳ Gemini ${err.status || 'net'} — ลองใหม่อีก 1 ครั้ง`);
    await new Promise((r) => setTimeout(r, 1500));
    return _geminiGenerateOnce(base64, prompt, model);
  }
}

// prompt ตาหาหน้า (Gemini) — ขอกล่องเป็นสัดส่วน 0-1 + isMain + ฟิลด์เสริมให้ตรง schema เดิมของ detectFaces
const _GEMINI_FACE_PROMPT = `You are a precise face-detection vision model. Return ONLY JSON (no prose, no markdown code fences).
ALL coordinates are FRACTIONS of the image in range 0.0-1.0 — (x1,y1) = top-left corner of the box, (x2,y2) = bottom-right corner. x2 MUST be > x1 and y2 MUST be > y1.
Return this EXACT shape:
{
  "faces": [ { "box": { "x1": 0.30, "y1": 0.10, "x2": 0.70, "y2": 0.60 }, "confidence": 0.9, "isMain": true, "description": "main person", "pose": "frontal | three_quarter | profile | back" } ],
  "main_subject_region": { "x1": 0.20, "y1": 0.05, "x2": 0.80, "y2": 0.95 },
  "has_faces": true,
  "face_count": 1,
  "best_crop_focus": "center-top",
  "has_big_text": false,
  "text_region": null,
  "watermark_region": null,
  "face_emotion": "smiling | laughing | crying | sad | angry | shocked | serious | neutral | unknown",
  "emotion_intensity": "strong | mild | none"
}
Rules:
- "faces" = REAL HUMAN faces in the photograph ONLY. Do NOT count royal emblems/crests/insignia, logos, ornaments, patterns on fabric/curtains, statues, dolls, paintings, drawings, cartoons, posters, or photos-of-photos in the background. Each face box must actually contain the eyes+nose+mouth of a real person (a real past bug: a gold royal emblem on a purple curtain was returned as the face while the actual person stood beside it).
- Exactly ONE face has "isMain": true — the most prominent/largest human face. If there are NO faces: has_faces=false, faces=[], but STILL give main_subject_region for the most interesting area.
- face_emotion = the ACTUAL expression of the MAIN face — read mouth/eyes/brows directly, do NOT guess from the scene/background. Use "unknown" if there is no clear face. emotion_intensity = strong/mild/none.
- pose = head orientation of EACH face vs the camera: "frontal" = looking at camera, both eyes visible / "three_quarter" = angled ~45°, both eyes still visible but face partly turned / "profile" = strict side view, only one eye/ear visible / "back" = back of head, face not visible. Decide by which features are visible, not by mood. Use "frontal" when unsure.
- has_big_text = true if the image is a social-media/chat screenshot, a news graphic with a headline, OR has ANY burned-in text/caption/subtitle/quote-overlay visible on a cover (incl. TV-drama subtitles, interview lower-third captions). Only a tiny corner watermark or small channel logo = false. When in doubt, true.
- text_region = box {x1,y1,x2,y2} (0-1) of the main burned-in text block when has_big_text=true, else null.
- watermark_region = box {x1,y1,x2,y2} (0-1) of any press/agency watermark or channel logo ANYWHERE (even small/faint/corner), else null. This field does NOT change has_big_text.`;

// ตาหาหน้า via Gemini vision → คืน object schema เดียวกับ detectFaces เป๊ะ (หรือ null ถ้าอ่านผล JSON ไม่ได้)
async function detectFacesGemini(base64, metadata) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const data = await _geminiWithRetry(base64, _GEMINI_FACE_PROMPT, model);
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  const parsed = _parseGeminiJSON(text);
  if (!parsed) return null;

  const W = metadata.width || 0;
  const H = metadata.height || 0;

  // faces: box 0-1 → validate/clamp → พิกเซล (เหมือน map ของ GPT) ; ทิ้งกล่องพัง
  const raw = Array.isArray(parsed.faces) ? parsed.faces : [];
  const norm = [];
  for (const f of raw) {
    const box = _clampBox01(f?.box);
    if (!box) continue;
    norm.push({
      x: Math.round(box.x1 * W),
      y: Math.round(box.y1 * H),
      width: Math.round((box.x2 - box.x1) * W),
      height: Math.round((box.y2 - box.y1) * H),
      description: f.description || '',
      pose: normalizePose(f.pose), // ★ เฟส 6B.1: ท่าหน้า (fallback Gemini ก็ตอบ pose) — additive
      _isMain: !!f.isMain,
      _conf: Number.isFinite(Number(f.confidence)) ? Number(f.confidence) : 0,
    });
  }
  // เรียง "หน้าหลัก" ไว้ต้น (smartCrop ใช้ faces[0] เป็นหน้าใหญ่สุด): isMain → confidence → พื้นที่
  norm.sort((a, b) => (Number(b._isMain) - Number(a._isMain)) || (b._conf - a._conf) || ((b.width * b.height) - (a.width * a.height)));
  const faces = norm.map(({ _isMain, _conf, ...f }) => f);

  // mainSubject: จาก main_subject_region (0-1) → พิกเซล ; ไม่มีก็ใช้หน้าหลัก ; ไม่มีเลย = null
  let mainSubject = null;
  const ms = _clampBox01(parsed.main_subject_region);
  if (ms) {
    mainSubject = {
      x: Math.round(ms.x1 * W), y: Math.round(ms.y1 * H),
      width: Math.round((ms.x2 - ms.x1) * W), height: Math.round((ms.y2 - ms.y1) * H),
    };
  } else if (faces.length > 0) {
    mainSubject = { x: faces[0].x, y: faces[0].y, width: faces[0].width, height: faces[0].height };
  }

  return {
    faces,
    hasFaces: faces.length > 0 || !!parsed.has_faces,
    faceCount: faces.length || Number(parsed.face_count) || 0,
    mainSubject,
    bestCropFocus: parsed.best_crop_focus || 'center',
    // ★ ให้ตรง schema เดิม: Emotion Gate + หลบข้อความ/ลายน้ำ ทำงานต่อได้แม้อยู่โหมด fallback
    faceEmotion: parsed.face_emotion || 'unknown',
    emotionIntensity: parsed.emotion_intensity || 'none',
    hasBigText: !!parsed.has_big_text,
    textRegion: _clampBox01(parsed.text_region),      // Gemini ตอบ {x1,y1,x2,y2} 0-1 อยู่แล้ว
    watermarkRegion: _clampBox01(parsed.watermark_region),
    imageWidth: W,
    imageHeight: H,
  };
}
