import { NextResponse } from 'next/server';
import { composeImage } from '@/lib/imageComposer';
import { TEMPLATES } from '@/lib/imageTemplates';
import { createLogger } from '@/lib/logger';
import { runQualityChecks } from '@/lib/pixel-composer/qualityGuard';

const rlog = createLogger('IMAGE-COMPOSE');

/**
 * Image Compose Orchestrator — Phase 1 + Phase 2
 * Phase 1: Sharp.js (pixel-perfect layout)
 * Phase 2: FAL Flux Kontext (AI blend + enhance)
 * Phase 3: Ideogram (text overlay) [optional]
 */
export async function POST(request) {
  const startTime = Date.now();
  try {
    const body = await request.json();
    const { images, layout, newsTitle, generateText, customTextPrompt, enhanceMode } = body;
    // enhanceMode: 'none' (default) | 'fal' (opt-in only)
    const useFAL = enhanceMode === 'fal' && Boolean(process.env.FAL_KEY);

    if (!images?.length || !layout) {
      return NextResponse.json({ success: false, error: 'ต้องการ images และ layout' }, { status: 400 });
    }

    // Resolve zones (custom หรือ built-in)
    const layoutZones = (layout.zones && Array.isArray(layout.zones) && layout.zones.length > 0)
      ? layout.zones : null;
    const tmpl = TEMPLATES[layout.template] || TEMPLATES.accident;
    const colorScheme = layout.colorScheme || tmpl.colorScheme || {};

    rlog.start(`template: "${layout.template}" | zones: ${layoutZones ? layoutZones.length + ' custom' : 'built-in'} | images: ${images.length}`);

    // Map zone id → image base64
    const assignments = {};
    for (const [zoneId, imgIndex] of Object.entries(layout.assignments || {})) {
      if (images[imgIndex]) assignments[zoneId] = images[imgIndex];
    }
    if (!assignments.bg && images[0]) assignments.bg = images[0];
    if (!assignments.main && images[0]) assignments.main = images[0];

    rlog.step('sharp-phase1', `compositing ${Object.keys(assignments).length} assignments → Sharp.js`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Sharp.js compositor
    // ═══════════════════════════════════════════════════════════════
    const layoutBuf = await composeImage({
      templateId: layout.template,
      zones: layoutZones,
      assignments,
      colorOverride: layout.colorOverride,
    });
    const layoutB64 = `data:image/jpeg;base64,${layoutBuf.toString('base64')}`;
    const phase1Time = ((Date.now() - startTime) / 1000).toFixed(1);
    rlog.step('sharp-done', `✅ Phase 1 done in ${phase1Time}s | ${(layoutBuf.length / 1024).toFixed(0)}KB`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1.5: Quality Guard (runs before FAL/text)
    // ═══════════════════════════════════════════════════════════════
    rlog.step('quality-guard', 'running quality checks...');
    let qualityReport = null;
    try {
      qualityReport = await runQualityChecks({
        slots: layoutZones || (tmpl.zones ? tmpl.zones : []),
        canvas: tmpl.layout?.canvas || { width: 1080, height: 1080 },
        assignments,
        outputBuf: layoutBuf,
      });
      rlog.step(
        'quality-done',
        `grade: ${qualityReport.grade} (${qualityReport.score}/100) | ⚠️ ${qualityReport.warnings.length} | ❌ ${qualityReport.errors.length}`
      );
      if (qualityReport.warnings.length) rlog.warn('Quality warnings: ' + qualityReport.warnings.join(' | '));
      if (qualityReport.errors.length)   rlog.warn('Quality errors: '   + qualityReport.errors.join(' | '));
    } catch (qErr) {
      rlog.warn('Quality guard failed (non-blocking): ' + qErr.message);
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: FAL Enhancement — OPT-IN ONLY (enhanceMode:'fal')
    // Default = Sharp only (deterministic, layout-preserving)
    // ═══════════════════════════════════════════════════════════════
    let enhancedB64 = null;
    let enhanceError = null;

    if (useFAL) {
      try {
        rlog.step('fal-phase2', '⚡ FAL opt-in: calling /api/image-enhance...');
        const origin = new URL(request.url).origin;
        const enhRes = await fetch(`${origin}/api/image-enhance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layoutBase64: layoutB64, newsTitle: newsTitle || '' }),
        });
        const enhData = await enhRes.json();
        if (enhData.success) {
          enhancedB64 = enhData.imageBase64;
          rlog.step('fal-done', `✅ Phase 2 FAL done in ${enhData.durationSeconds}s`);
        } else {
          enhanceError = enhData.error;
          rlog.warn('Phase 2 FAL failed: ' + enhData.error);
        }
      } catch (e) {
        enhanceError = e.message;
        rlog.warn('Phase 2 FAL error: ' + e.message);
      }
    } else {
      rlog.step('sharp-only', '✅ Default mode: Sharp-only (deterministic). Pass enhanceMode:"fal" to enable FAL.');
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: Ideogram Text Overlay (optional)
    // ═══════════════════════════════════════════════════════════════
    let textB64 = null;
    let textError = null;

    // ใส่ text บน enhanced version (ถ้ามี) หรือ layout
    const baseForText = enhancedB64 || layoutB64;

    if (generateText && newsTitle && process.env.IDEOGRAM_API_KEY) {
      try {
        rlog.step('ideogram-phase3', 'adding text overlay via Ideogram /remix');
        const origin = new URL(request.url).origin;
        const textRes = await fetch(`${origin}/api/image-text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: baseForText,
            headline: newsTitle,
            template: layout.template,
            colorScheme,
            customPrompt: customTextPrompt || null,
          }),
        });
        const textData = await textRes.json();
        if (textData.success) {
          textB64 = textData.imageBase64;
          rlog.step('ideogram-done', `✅ Text overlay done`);
        } else {
          textError = textData.error;
        }
      } catch (e) {
        textError = e.message;
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    rlog.done('Total: ' + totalTime + 's | Phase1: ✅ | Phase2: ' + (enhancedB64 ? '✅ FAL' : useFAL ? '❌ FAL failed' : '⏭️ skipped') + ' | Text: ' + (textB64 ? '✅' : '-') + ' | Quality: ' + (qualityReport ? qualityReport.grade : 'skipped'));

    // Build debug info
    const debugInfo = {
      templateId: layout.template,
      templateName: layout.templateName || tmpl.name,
      slotMapping: layout.assignments || {},
      zonesUsed: (layoutZones || []).map(z => z.id),
      enhanceMode: useFAL ? 'fal' : 'sharp-only',
      renderTimeMs: Math.round(parseFloat(totalTime) * 1000),
      warnings: [
        ...(qualityReport?.warnings || []),
        ...(enhanceError ? ['FAL: ' + enhanceError] : []),
        ...(textError ? ['Text: ' + textError] : []),
      ],
      errors: qualityReport?.errors || [],
    };

    return NextResponse.json({
      success: true,
      versions: {
        layout:   { imageBase64: layoutB64,   label: '🖼️ Sharp.js (Pixel-Perfect)' },
        enhanced: enhancedB64 ? { imageBase64: enhancedB64, label: '✨ FAL Enhanced (opt-in)' } : null,
        text:     textB64 ? { imageBase64: textB64, label: '✏️ พร้อมข้อความ (Ideogram)' } : null,
      },
      enhanceError,
      textError,
      template: layout.template,
      templateName: layout.templateName || tmpl.name,
      durationSeconds: parseFloat(totalTime),
      qualityReport,
      debug: debugInfo,
    });

  } catch (error) {
    rlog.error(error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
