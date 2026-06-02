/**
 * Replicate Enhancer — Real-ESRGAN + GFPGAN via Replicate API
 * News Safe Mode: upscale/sharpen/denoise/face-restore ONLY
 * ห้าม: generate ภาพใหม่, เปลี่ยนใบหน้า, เปลี่ยนฉาก, เติม/ลบวัตถุ
 */
import sharp from 'sharp';

const REPLICATE_API = 'https://api.replicate.com/v1/predictions';

// Model versions (stable, well-tested)
const MODELS = {
  'real-esrgan': 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa',
  'gfpgan': 'tencentarc/gfpgan:9283608cc6b7be6b65a8e44983db012355fde4132009bf99d976b2f0896856a3',
};

/**
 * Call Replicate API and wait for result
 */
async function callReplicate(modelVersion, input) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN not configured');

  // Create prediction with Prefer: wait (sync mode, up to 60s)
  const [owner_model, version] = modelVersion.split(':');
  
  const createRes = await fetch(REPLICATE_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait=55', // wait up to 55s for result
    },
    body: JSON.stringify({ version, input }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Replicate API error (${createRes.status}): ${err}`);
  }

  let prediction = await createRes.json();

  // If sync mode returned completed result
  if (prediction.status === 'succeeded') {
    return prediction.output;
  }

  // If still processing, poll (shouldn't happen with Prefer: wait)
  if (prediction.status === 'processing' || prediction.status === 'starting') {
    const pollUrl = prediction.urls?.get || `${REPLICATE_API}/${prediction.id}`;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      prediction = await pollRes.json();
      if (prediction.status === 'succeeded') return prediction.output;
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw new Error(`Replicate prediction failed: ${prediction.error || 'unknown'}`);
      }
    }
    throw new Error('Replicate prediction timeout');
  }

  if (prediction.status === 'failed') {
    throw new Error(`Replicate prediction failed: ${prediction.error || 'unknown'}`);
  }

  return prediction.output;
}

/**
 * Convert base64 to data URI for Replicate
 */
function toDataUri(base64) {
  const raw = base64.replace(/^data:image\/\w+;base64,/, '');
  // Detect format from first bytes
  const buf = Buffer.from(raw.slice(0, 16), 'base64');
  let mime = 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
  else if (buf[0] === 0x52 && buf[1] === 0x49) mime = 'image/webp';
  return `data:${mime};base64,${raw}`;
}

/**
 * Download URL to base64
 */
async function urlToBase64(url) {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  // Optimize: resize down if > 4096px to save bandwidth
  const metadata = await sharp(buffer).metadata();
  const longest = Math.max(metadata.width, metadata.height);
  let finalBuffer = buffer;
  if (longest > 4096) {
    finalBuffer = await sharp(buffer)
      .resize({ width: 4096, height: 4096, fit: 'inside' })
      .jpeg({ quality: 95 })
      .toBuffer();
  }
  return finalBuffer.toString('base64');
}

/**
 * Upscale image using Real-ESRGAN
 * @param {string} base64 - input image base64
 * @param {number} scale - 2 or 4
 * @returns {Promise<{base64: string, model: string}>}
 */
export async function upscaleImage(base64, scale = 4) {
  const dataUri = toDataUri(base64);
  
  const output = await callReplicate(MODELS['real-esrgan'], {
    image: dataUri,
    scale: scale,
    face_enhance: false, // pure upscale, no face changes
  });

  // output is a URL string
  const resultUrl = typeof output === 'string' ? output : output?.[0] || output;
  const resultBase64 = await urlToBase64(resultUrl);

  return { base64: resultBase64, model: 'real-esrgan' };
}

/**
 * Restore face using GFPGAN
 * @param {string} base64 - input image base64
 * @returns {Promise<{base64: string, model: string}>}
 */
export async function restoreFace(base64) {
  const dataUri = toDataUri(base64);

  const output = await callReplicate(MODELS['gfpgan'], {
    img: dataUri,
    version: 'v1.4',
    scale: 2,
  });

  const resultUrl = typeof output === 'string' ? output : output?.[0] || output;
  const resultBase64 = await urlToBase64(resultUrl);

  return { base64: resultBase64, model: 'gfpgan' };
}

/**
 * Full enhancement pipeline
 * @param {string} base64 - input image
 * @param {Object} options - { mode, upscale, faceRestore }
 * @returns {Promise<{base64, model, steps}>}
 */
export async function enhancePipeline(base64, options = {}) {
  const { mode = 'auto', upscale = 2, faceRestore = false } = options;
  const steps = [];
  let currentBase64 = base64.replace(/^data:image\/\w+;base64,/, '');
  let modelsUsed = [];

  try {
    if (mode === 'auto' || mode === 'upscale') {
      // Step 1: Upscale with Real-ESRGAN
      const upResult = await upscaleImage(currentBase64, upscale);
      currentBase64 = upResult.base64;
      modelsUsed.push(`Real-ESRGAN ×${upscale}`);
      steps.push({ step: 'upscale', model: 'real-esrgan', scale: upscale });
    }

    if (faceRestore && (mode === 'auto' || mode === 'face')) {
      // Step 2: Face restoration with GFPGAN
      const faceResult = await restoreFace(currentBase64);
      currentBase64 = faceResult.base64;
      modelsUsed.push('GFPGAN');
      steps.push({ step: 'face_restore', model: 'gfpgan' });
    }

    // Step 3: Post-processing with Sharp.js — sharpen + light denoise
    const buffer = Buffer.from(currentBase64, 'base64');
    const sharpened = await sharp(buffer)
      .sharpen({ sigma: 0.8, m1: 0.5, m2: 0.3 }) // subtle sharpening
      .median(1) // very light denoise (preserves detail)
      .jpeg({ quality: 95 })
      .toBuffer();
    currentBase64 = sharpened.toString('base64');
    steps.push({ step: 'sharpen_denoise', model: 'sharp.js' });

    return {
      base64: currentBase64,
      model: modelsUsed.join(' + '),
      steps,
      provider: 'replicate',
    };
  } catch (err) {
    console.error('[ReplicateEnhancer] Pipeline error:', err.message);
    throw err;
  }
}

/**
 * Sharp.js ONLY fallback (no API needed)
 */
export async function sharpFallback(base64, scale = 2) {
  const rawBase64 = base64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(rawBase64, 'base64');
  const metadata = await sharp(buffer).metadata();

  const targetWidth = Math.min(metadata.width * scale, 4096);
  const targetHeight = Math.min(metadata.height * scale, 4096);

  const enhanced = await sharp(buffer)
    .resize(targetWidth, targetHeight, {
      kernel: 'lanczos3',
      fit: 'inside',
    })
    .sharpen({ sigma: 1.0, m1: 0.7, m2: 0.5 })
    .median(1)
    .jpeg({ quality: 95 })
    .toBuffer();

  return {
    base64: enhanced.toString('base64'),
    model: `Sharp.js Lanczos3 ×${scale}`,
    steps: [{ step: 'upscale_sharpen', model: 'sharp.js', scale }],
    provider: 'sharp-fallback',
  };
}
