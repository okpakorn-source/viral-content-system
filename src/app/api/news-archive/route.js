import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';
import { saveNewsArchive } from '@/lib/services/newsArchiveService';

const STORE = 'news-archive';
const TABLE = 'store_items';

// =====================
// GET /api/news-archive
// =====================
// Query params: search, category, source_type, date_from, date_to, sort, page, limit
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const category = searchParams.get('category') || '';
    const source_type = searchParams.get('source_type') || '';
    const date_from = searchParams.get('date_from') || '';
    const date_to = searchParams.get('date_to') || '';
    const sort = searchParams.get('sort') || 'newest'; // newest | most_used | viral_score
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (isSupabaseReady()) {
      const sb = getSupabase();
      let query = sb
        .from(TABLE)
        .select('id, data, created_at', { count: 'exact' })
        .eq('store_name', STORE);

      // Date filter
      if (date_from) query = query.gte('created_at', date_from);
      if (date_to) query = query.lte('created_at', date_to + 'T23:59:59Z');

      // Sort
      query = query.order('created_at', { ascending: sort === 'oldest' });

      // Pagination
      const from = (page - 1) * limit;
      query = query.range(from, from + limit - 1);

      const { data, error, count } = await query;
      if (error) throw new Error(error.message);

      let items = (data || []).map(row => ({ ...row.data, _id: row.id, _createdAt: row.created_at }));

      // Client-side filter (Supabase jsonb filter ซับซ้อน)
      if (search) {
        const q = search.toLowerCase();
        items = items.filter(item =>
          (item.title || '').toLowerCase().includes(q) ||
          (item.body || '').toLowerCase().includes(q) ||
          (item.summary || '').toLowerCase().includes(q)
        );
      }
      if (category) items = items.filter(item => item.category === category);
      if (source_type) items = items.filter(item => item.source_type === source_type);

      // Sort client-side for special sorts
      if (sort === 'most_used') items.sort((a, b) => (b.used_count || 0) - (a.used_count || 0));
      if (sort === 'viral_score') items.sort((a, b) => (b.viral_score || 0) - (a.viral_score || 0));

      return NextResponse.json({
        success: true,
        data: { items, total: count || items.length, page, limit, totalPages: Math.ceil((count || items.length) / limit) },
      });
    }

    // Fallback
    const store = createStore(STORE);
    const all = await store.getAll();
    return NextResponse.json({ success: true, data: { items: all, total: all.length, page: 1, limit: all.length, totalPages: 1 } });

  } catch (err) {
    console.error('[Archive] GET error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ======================
// POST /api/news-archive
// ======================
export async function POST(request) {
  try {
    const body = await request.json();
    const { title, newsBody, sourceUrl, sourceType, breakdownData, workflowId, archivedBy, coverImage } = body;

    if (!title && !newsBody) {
      return NextResponse.json({ success: false, error: 'ต้องมี title หรือ newsBody' }, { status: 400 });
    }

    const result = await saveNewsArchive({
      title,
      newsBody,
      sourceUrl,
      sourceType,
      breakdownData,
      workflowId,
      archivedBy,
      coverImage,
    });
    if (result.deduped) {
      console.log(`[Archive] ⏭️ Exact duplicate — reuse: "${result.item.title.slice(0, 50)}"`);
    } else {
      console.log(`[Archive] ✅ Saved: "${result.item.title.slice(0, 50)}" [${result.item.category}]`);
    }
    return NextResponse.json({ success: true, data: result.item, ...(result.deduped ? { deduped: true } : {}) });

  } catch (err) {
    console.error('[Archive] POST error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
