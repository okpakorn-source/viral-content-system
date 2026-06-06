/**
 * Image Bank API — /api/auto-cover/image-bank
 * 
 * GET:   Load image bank for a session (query: ?sessionId=xxx)
 * PATCH: Toggle image selection or batch update
 */
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

// GET: Load image bank for a session
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    
    if (!sessionId) {
      return NextResponse.json({ success: false, error: 'sessionId required', errorType: 'MISSING_PARAM' }, { status: 400 });
    }
    
    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Database not available', errorType: 'DB_ERROR' }, { status: 503 });
    }
    
    const { data, error } = await supabase
      .from('cover_images')
      .select('*')
      .eq('session_id', sessionId)
      .order('ai_score', { ascending: false });
    
    if (error) throw error;
    
    return NextResponse.json({
      success: true,
      sessionId,
      images: data || [],
      summary: {
        total: (data || []).length,
        selected: (data || []).filter(i => i.is_selected).length,
        rejected: (data || []).filter(i => !i.is_selected).length,
      }
    });
  } catch (err) {
    console.error('[ImageBank] GET error:', err.message);
    return NextResponse.json({ success: false, error: err.message, errorType: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// PATCH: Toggle image selection
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { imageId, isSelected, sessionId } = body;
    
    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Database not available', errorType: 'DB_ERROR' }, { status: 503 });
    }
    
    if (imageId) {
      // Toggle single image — validate isSelected type
      if (typeof isSelected !== 'boolean') {
        return NextResponse.json({ success: false, error: 'isSelected must be a boolean', errorType: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const { error } = await supabase
        .from('cover_images')
        .update({ is_selected: isSelected })
        .eq('id', imageId);
      if (error) throw error;
    } else if (sessionId && body.selectedIds) {
      // Batch update: set selected for specific IDs, deselect others
      const { error: deselectError } = await supabase
        .from('cover_images')
        .update({ is_selected: false })
        .eq('session_id', sessionId);
      if (deselectError) throw deselectError;
      
      if (body.selectedIds.length > 0) {
        const { error: selectError } = await supabase
          .from('cover_images')
          .update({ is_selected: true })
          .in('id', body.selectedIds);
        if (selectError) throw selectError;
      }
    } else {
      return NextResponse.json({ success: false, error: 'imageId or sessionId+selectedIds required', errorType: 'MISSING_PARAM' }, { status: 400 });
    }
    
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[ImageBank] PATCH error:', err.message);
    return NextResponse.json({ success: false, error: err.message, errorType: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
