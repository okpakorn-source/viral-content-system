/**
 * Cover History API Route — /api/cover-history
 * 
 * GET: List cover history (paginated) or get single cover by id
 *   ?limit=20&offset=0  — paginated list (truncated base64)
 *   ?id=xxx             — single cover (full base64)
 * 
 * DELETE: Remove a cover from history
 *   Body: { id: 'uuid' }
 */
import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function GET(request) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    // ★ Single cover detail — return full base64
    if (id) {
      const { data, error } = await supabase
        .from('cover_history')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        return NextResponse.json(
          { success: false, error: 'Cover not found', errorType: 'NOT_FOUND' },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, cover: data });
    }

    // ★ Paginated list — truncated base64
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Get total count
    const { count, error: countError } = await supabase
      .from('cover_history')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      return NextResponse.json(
        { success: false, error: countError.message, errorType: 'DB_ERROR' },
        { status: 500 }
      );
    }

    // Get paginated data
    const { data: covers, error: listError } = await supabase
      .from('cover_history')
      .select('id, session_id, created_at, news_title, source_url, template_id, ai_score, cover_base64, identity, metadata')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (listError) {
      return NextResponse.json(
        { success: false, error: listError.message, errorType: 'DB_ERROR' },
        { status: 500 }
      );
    }

    // Truncate base64 for listing — return only first 200 chars as thumbnail preview
    const truncatedCovers = (covers || []).map(c => ({
      ...c,
      cover_base64_preview: c.cover_base64 ? c.cover_base64.substring(0, 200) : '',
      has_full_image: !!(c.cover_base64 && c.cover_base64.length > 200),
      cover_base64: undefined, // Don't send full base64 in list
    }));

    return NextResponse.json({
      success: true,
      covers: truncatedCovers,
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[CoverHistory] GET error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing id', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('cover_history')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message, errorType: 'DB_ERROR' },
        { status: 500 }
      );
    }

    console.log(`[CoverHistory] ★ Deleted cover: ${id}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[CoverHistory] DELETE error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message, errorType: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
