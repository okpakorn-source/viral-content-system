import { NextResponse } from 'next/server';
import { getPrompts, savePrompt, resetPrompt, resetAllPrompts, getAnalysisPresets, saveAnalysisPreset, deleteAnalysisPreset, resetAnalysisPresets } from '@/lib/ai/promptStore';

export async function GET() {
  return NextResponse.json({
    success: true,
    data: getPrompts(),
    analysisPresets: getAnalysisPresets(),
  });
}

export async function POST(request) {
  try {
    const body = await request.json();

    // Save analysis preset
    if (body.type === 'analysisPreset') {
      saveAnalysisPreset(body.preset);
      return NextResponse.json({ success: true, analysisPresets: getAnalysisPresets() });
    }

    // Save standard prompt
    const { key, system, user } = body;
    if (!key) {
      return NextResponse.json({ success: false, error: 'Invalid prompt key' }, { status: 400 });
    }
    savePrompt(key, system, user);
    return NextResponse.json({ success: true, data: getPrompts()[key] });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();

    // Delete analysis preset
    if (body.type === 'analysisPreset' && body.id) {
      deleteAnalysisPreset(body.id);
      return NextResponse.json({ success: true, analysisPresets: getAnalysisPresets() });
    }

    // Reset analysis presets
    if (body.type === 'resetAnalysisPresets') {
      resetAnalysisPresets();
      return NextResponse.json({ success: true, analysisPresets: getAnalysisPresets() });
    }

    // Reset standard prompt
    const { key } = body;
    if (key) {
      resetPrompt(key);
    } else {
      resetAllPrompts();
    }
    return NextResponse.json({ success: true, data: getPrompts() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
