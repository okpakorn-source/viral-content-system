import { NextResponse } from 'next/server';
import { getPrompts, savePrompt, resetPrompt, resetAllPrompts } from '@/lib/ai/promptStore';

export async function GET() {
  return NextResponse.json({ success: true, data: getPrompts() });
}

export async function POST(request) {
  try {
    const { key, system, user } = await request.json();
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
    const { key } = await request.json();
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
