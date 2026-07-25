import { NextResponse } from 'next/server';
import { createWorkflow, getWorkflow } from '@/lib/workflow/workflowEngine';

// POST — สร้าง workflow ใหม่
export async function POST(request) {
  try {
    const { sourceType } = await request.json();
    const wf = await createWorkflow(sourceType || 'url');
    return NextResponse.json({ success: true, workflowId: wf.id });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'WORKFLOW_CREATE_FAILED' }, { status: 500 });
  }
}

// GET — โหลด workflow
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'Missing workflow id', errorType: 'MISSING_WORKFLOW_ID' }, { status: 400 });
    const wf = await getWorkflow(id);
    if (!wf) return NextResponse.json({ success: false, error: 'Workflow not found', errorType: 'WORKFLOW_NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, data: wf });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'WORKFLOW_FETCH_FAILED' }, { status: 500 });
  }
}
