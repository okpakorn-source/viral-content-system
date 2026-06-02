import { NextResponse } from 'next/server';
import { analyzeImage } from '@/lib/services/imageAnalyzer';
import { enhancePipeline, sharpFallback } from '@/lib/services/replicateEnhancer';
import { validateEnhancement } from '@/lib/services/qualityValidator';

// === News Image Enhancement Pipeline ===
// Real-ESRGAN + GFPGAN via Replicate API
// Fallback: Sharp.js (lanczos + sharpen + denoise)
// News Safe Mode: upscale/sharpen/denoise ONLY — ห้ามแก้ไขเนื้อหาภาพ

export const maxDuration = 55; // Vercel Pro: up to 60s

export async function POST(request) {
  const startTime = Date.now();
  try {
    const body = await request.json();
    const { base64, mode = 'auto', upscale = 2, faceRestore = false, quality = 95 } = body;

    if (!base64) {
      return NextResponse.json({
        success: false,
        error: 'ไม่มีรูปภาพ',
        errorType: 'MISSING_IMAGE',
      }, { status: 400 });
    }

    // Step 1: Analyze input image
    const analysis = await analyzeImage(base64);
    console.log(`[Enhance] Input: ${analysis.resolution}, quality: ${analysis.qualityScore}, model: ${analysis.recommendedModel}`);

    // Determine scale
    const scale = upscale === 4 ? 4 
      : upscale === 2 ? 2 
      : analysis.recommendedScale;

    // Step 2: Enhance
    let result;
    const hasReplicateKey = !!process.env.REPLICATE_API_TOKEN;

    if (hasReplicateKey) {
      // Use Replicate API (Real-ESRGAN + optional GFPGAN)
      try {
        result = await enhancePipeline(base64, {
          mode,
          upscale: scale,
          faceRestore,
        });
      } catch (replicateErr) {
        console.warn('[Enhance] Replicate failed, falling back to Sharp:', replicateErr.message);
        result = await sharpFallback(base64, scale);
      }
    } else {
      // Fallback: Sharp.js only
      result = await sharpFallback(base64, scale);
    }

    // Step 3: Validate quality (similarity check)
    const validation = await validateEnhancement(base64, result.base64);
    
    // Similarity check: reject if < 95%
    if (!validation.passed) {
      console.warn(`[Enhance] REJECTED: similarity ${validation.similarityScore}% < 95%`);
      // Return original image instead
      return NextResponse.json({
        success: true,
        data: {
          base64: base64.replace(/^data:image\/\w+;base64,/, ''),
          enhancerUsed: 'rejected — returned original',
          originalResolution: analysis.resolution,
          enhancedResolution: analysis.resolution,
          sharpnessBefore: validation.sharpnessBefore,
          sharpnessAfter: validation.sharpnessBefore,
          similarityScore: validation.similarityScore,
          qualityGain: '0%',
          processingTime: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
          rejected: true,
          rejectReason: validation.verdict,
        },
      });
    }

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Enhance] ✅ Done: ${result.model} | ${validation.originalResolution} → ${validation.enhancedResolution} | similarity: ${validation.similarityScore}% | ${processingTime}s`);

    return NextResponse.json({
      success: true,
      data: {
        base64: result.base64,
        enhancerUsed: result.model,
        provider: result.provider,
        originalResolution: validation.originalResolution,
        enhancedResolution: validation.enhancedResolution,
        sharpnessBefore: validation.sharpnessBefore,
        sharpnessAfter: validation.sharpnessAfter,
        similarityScore: validation.similarityScore,
        qualityGain: validation.qualityGain,
        resolutionGain: validation.resolutionGain,
        processingTime: `${processingTime}s`,
        steps: result.steps,
        analysis,
      },
    });

  } catch (error) {
    console.error('[Enhance] Error:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message || 'Enhancement failed',
      errorType: 'ENHANCE_IMAGE_ERROR',
    }, { status: 500 });
  }
}
