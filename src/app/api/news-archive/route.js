import { NextResponse } from 'next/server';
import { createStore } from '@/lib/persistStore';
import { callAI } from '@/lib/ai/openai';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';

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
    const { title, newsBody, sourceUrl, sourceType, breakdownData, workflowId, archivedBy } = body;

    if (!title && !newsBody) {
      return NextResponse.json({ success: false, error: 'ต้องมี title หรือ newsBody' }, { status: 400 });
    }

    // === AI ตรวจจับ category อัตโนมัติ ===
    let category = 'ทั่วไป';
    let summary = '';
    let tags = [];
    try {
      const aiResult = await callAI({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        maxTokens: 400,
        prompt: `วิเคราะห์ข่าวนี้แล้วตอบเป็น JSON

หัวข้อ: ${title || ''}
เนื้อหา: ${(newsBody || '').slice(0, 1500)}

ตอบ JSON:
{
  "category": "หมวดหมู่ข่าว (เลือก 1: การเมือง|สังคม|อาชญากรรม|อุบัติเหตุ|บันเทิง|กีฬา|เศรษฐกิจ|สุขภาพ|ต่างประเทศ|เทคโนโลยี|สิ่งแวดล้อม|ศาสนา|ทั่วไป)",
  "summary": "สรุปข่าว 1-2 ประโยค (ไม่เกิน 100 คำ)",
  "tags": ["tag1", "tag2", "tag3"]
}`,
      });
      if (aiResult?.category) category = aiResult.category;
      if (aiResult?.summary) summary = aiResult.summary;
      if (aiResult?.tags) tags = aiResult.tags;
    } catch (e) {
      console.warn('[Archive] AI classify failed:', e.message);
    }

    // สกัดข้อมูลจาก breakdown
    const keyPeople = breakdownData?.key_facts?.people || [];
    const keyPlaces = breakdownData?.key_facts?.places || [];
    const viralScore = breakdownData?.possible_angles?.[0]?.facebook_viral_score || null;
    const wordCount = (newsBody || '').split(/\s+/).filter(Boolean).length;
    const sourceDomain = sourceUrl ? (new URL(sourceUrl).hostname.replace('www.', '')) : '';

    const id = `archive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const item = {
      id,
      title: title || newsBody?.slice(0, 100) || 'ไม่มีหัวข้อ',
      body: newsBody || '',
      source_url: sourceUrl || '',
      source_type: sourceType || 'web',
      source_name: sourceDomain,
      category,
      tags,
      summary,
      key_people: keyPeople,
      key_places: keyPlaces,
      viral_score: viralScore,
      word_count: wordCount,
      used_count: 0,
      last_used_at: null,
      archived_by: archivedBy || 'system',
      archived_at: now,
      workflow_id: workflowId || null,
      createdAt: now,
      updatedAt: now,
    };

    const store = createStore(STORE);
    await store.add(item);

    console.log(`[Archive] ✅ Saved: "${item.title.slice(0, 50)}" [${category}]`);
    return NextResponse.json({ success: true, data: item });

  } catch (err) {
    console.error('[Archive] POST error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
