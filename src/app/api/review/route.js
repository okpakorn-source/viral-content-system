import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { cookies } from 'next/headers';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';
import { randomUUID } from 'crypto';

/**
 * Content Review Queue — ใช้ Supabase store_items แทน /tmp
 * store_name: 'review-queue'
 */

const STORE = 'review-queue';

// ─── helpers ────────────────────────────────────────────────
async function getUser() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    const session = await getSession(token);
    if (session) return { id: session.memberId, name: session.displayName || session.username, avatar: session.avatar || '👤' };
  } catch {}
  return null;
}

async function db() {
  if (!isSupabaseReady()) throw new Error('Supabase ยังไม่พร้อม');
  return getSupabase();
}

// ─── GET — โหลดรายการ ────────────────────────────────────────
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const status   = searchParams.get('status')  || 'all';
    const memberId = searchParams.get('member')   || '';
    const search   = searchParams.get('search')   || '';
    const page     = parseInt(searchParams.get('page')  || '1');
    const limit    = parseInt(searchParams.get('limit') || '50');

    const supabase = await db();

    let query = supabase
      .from('store_items')
      .select('*')
      .eq('store_name', STORE)
      .order('created_at', { ascending: false });

    // Status filter — stored in item_data->status
    if (status && status !== 'all') {
      query = query.eq('item_data->>status', status);
    }
    // Member filter
    if (memberId) {
      query = query.eq('item_data->submittedBy->>id', memberId);
    }
    // Full-text search on title
    if (search) {
      query = query.ilike('item_data->>title', `%${search}%`);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw error;

    const reviews = (data || []).map(r => ({ id: r.item_id, ...r.item_data, _dbId: r.id }));

    // Stats — counts per status
    const { data: allData } = await supabase
      .from('store_items')
      .select('item_data')
      .eq('store_name', STORE);

    const allItems = (allData || []).map(r => r.item_data);
    const stats = {
      total: allItems.length,
      pending:  allItems.filter(r => r.status === 'pending').length,
      approved: allItems.filter(r => r.status === 'approved').length,
      rejected: allItems.filter(r => r.status === 'rejected').length,
      revision: allItems.filter(r => r.status === 'revision').length,
    };

    return NextResponse.json({ success: true, reviews, stats });
  } catch (error) {
    console.error('[Review GET]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ─── POST — ส่งเข้าคลัง ──────────────────────────────────────
export async function POST(request) {
  try {
    const body = await request.json();
    const { title, content, hook, closing, style, tone, target, sourceType, presetLabel, contentLength, wordCount, angles, newsTitle, newsSource, sourceVersion } = body;

    if (!content || content.length < 10) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    const user = await getUser();
    const itemId = randomUUID();

    const item = {
      id: itemId,
      title: title || newsTitle || 'ไม่มีหัวข้อ',
      content,
      hook: hook || '',
      closing: closing || '',
      style: style || '',
      tone: tone || '',
      target: target || '',
      sourceType: sourceType || 'url',
      presetLabel: presetLabel || '',
      contentLength: contentLength || 'medium',
      wordCount: wordCount || content.split(/\s+/).length,
      angles: angles || [],
      newsTitle: newsTitle || title || '',
      newsSource: newsSource || '',
      sourceVersion: sourceVersion || 'classic', // 'classic' | 'enhanced'
      status: 'pending',
      submittedBy: user,
      note: '',
      engagement: null,
      reviewedAt: null,
      reviewedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const supabase = await db();
    const { error } = await supabase.from('store_items').insert({
      item_id: itemId,
      store_name: STORE,
      item_data: item,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    });

    if (error) throw error;

    console.log(`[Review] ✅ Added: "${item.title.slice(0, 50)}" (${itemId.slice(0, 8)}) by ${user?.name || 'anon'}`);
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error('[Review POST]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ─── PATCH — อัปเดต status / note / engagement ───────────────
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, status, note, engagement } = body;

    if (!id) return NextResponse.json({ success: false, error: 'ไม่พบ ID' }, { status: 400 });

    const supabase = await db();
    const { data, error: fetchErr } = await supabase
      .from('store_items')
      .select('*')
      .eq('store_name', STORE)
      .eq('item_id', id)
      .single();

    if (fetchErr || !data) return NextResponse.json({ success: false, error: 'ไม่พบรายการ' }, { status: 404 });

    const user = await getUser();
    const updated = {
      ...data.item_data,
      updatedAt: new Date().toISOString(),
    };
    if (status !== undefined) { updated.status = status; updated.reviewedAt = new Date().toISOString(); updated.reviewedBy = user; }
    if (note  !== undefined) updated.note = note;
    if (engagement !== undefined) updated.engagement = { ...updated.engagement, ...engagement, recordedAt: new Date().toISOString() };

    const { error: updateErr } = await supabase
      .from('store_items')
      .update({ item_data: updated, updated_at: updated.updatedAt })
      .eq('store_name', STORE)
      .eq('item_id', id);

    if (updateErr) throw updateErr;

    return NextResponse.json({ success: true, item: updated });
  } catch (error) {
    console.error('[Review PATCH]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ─── PUT — backward compat → redirect to PATCH ───────────────
export async function PUT(request) {
  return PATCH(request);
}

// ─── DELETE ───────────────────────────────────────────────────
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ไม่พบ ID' }, { status: 400 });

    const supabase = await db();
    const { error } = await supabase
      .from('store_items')
      .delete()
      .eq('store_name', STORE)
      .eq('item_id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Review DELETE]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
