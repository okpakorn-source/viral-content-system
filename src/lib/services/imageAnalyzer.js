/**
 * Image Analyzer — Sharp.js based image quality analysis
 * ใช้สำหรับตรวจสอบภาพก่อน enhance
 */
import sharp from 'sharp';

/**
 * วิเคราะห์คุณภาพภาพจาก base64
 * @param {string} base64 - base64 encoded image (with or without data URI prefix)
 * @returns {Object} analysis results
 */
export async function analyzeImage(base64) {
  try {
    // Strip data URI prefix if present
    const rawBase64 = base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(rawBase64, 'base64');
    
    const image = sharp(buffer);
    const metadata = await image.metadata();
    const stats = await image.stats();
    
    const { width, height, format } = metadata;
    const megapixels = (width * height) / 1_000_000;
    const longestSide = Math.max(width, height);

    // Blur detection: low variance in channels = blurry
    // Using standard deviation of luminance channel
    const avgStdDev = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0) / stats.channels.length;
    const blurScore = Math.min(100, Math.max(0, Math.round(avgStdDev * 1.5)));
    // Lower stddev = more blur → invert for "sharpness"
    const sharpnessScore = blurScore;

    // Noise estimation: high mean with low stdev suggests noise
    const avgMean = stats.channels.reduce((sum, ch) => sum + ch.mean, 0) / stats.channels.length;
    const noiseScore = Math.max(0, Math.min(100, Math.round(100 - avgStdDev * 0.8)));

    // Quality score: composite
    const resolutionScore = Math.min(100, Math.round((longestSide / 2048) * 100));
    const qualityScore = Math.round(
      resolutionScore * 0.4 + sharpnessScore * 0.4 + (100 - noiseScore) * 0.2
    );

    // Determine needs
    const needsUpscale = longestSide < 1080;
    const needsDeblur = sharpnessScore < 40;
    const needsDenoise = noiseScore > 60;

    // Recommend scale
    let recommendedScale = 1;
    if (longestSide < 512) recommendedScale = 4;
    else if (longestSide < 1080) recommendedScale = 4;
    else if (longestSide < 2048) recommendedScale = 2;

    // Recommend model
    let recommendedModel = 'real-esrgan';
    if (needsDeblur && longestSide < 800) {
      recommendedModel = 'gfpgan'; // face restoration for small/blurry
    }

    return {
      width,
      height,
      format: format || 'unknown',
      resolution: `${width}×${height}`,
      megapixels: Math.round(megapixels * 100) / 100,
      longestSide,
      sharpnessScore,
      blurScore: 100 - sharpnessScore,
      noiseScore,
      qualityScore,
      needsUpscale,
      needsDeblur,
      needsDenoise,
      recommendedModel,
      recommendedScale,
    };
  } catch (err) {
    console.error('[ImageAnalyzer] Error:', err.message);
    return {
      width: 0, height: 0, format: 'unknown',
      resolution: '0×0', megapixels: 0, longestSide: 0,
      sharpnessScore: 0, blurScore: 100, noiseScore: 50,
      qualityScore: 0, needsUpscale: true, needsDeblur: true,
      needsDenoise: false, recommendedModel: 'real-esrgan',
      recommendedScale: 4,
    };
  }
}
