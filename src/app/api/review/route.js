import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { cookies } from 'next/headers';
import { getSupabase, isSupabaseReady } from '@/lib/supabase';
import { randomUUID } from 'crypto';

/**
 * Content Review Queue
 * Primary: Supabase store_items
 * Fallback: In-memory store (ถ้า Supabase ไม่พร้อม — ไม่ crash อีกต่อไป)
 */

const STORE = 'review-queue';

// ─── In-memory fallback store ─────────────────────────────────────
// ใช้เมื่อ Supabase ไม่พร้อม — ข้อมูลหายเมื่อ restart server (ok สำหรับ dev/testing)
const memStore = [];

// ─── helpers ─────────────────────────────────────────────────────
async function getUser() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    const session = await getSession(token);
    if (session) return { id: session.memberId, name: session.displayName || session.username, avatar: session.avatar || '👤' };
  } catch {}
  return null;
}

function calcStats(items) {
  return {
    total:    items.length,
    pending:  items.filter(r => r.status === 'pending').length,
    approved: items.filter(r => r.status === 'approved').length,
    rejected: items.filter(r => r.status === 'rejected').length,
    revision: items.filter(r => r.status === 'revision').length,
  };
}

// ─── GET ─────────────────────────────────────────────────────────
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const status   = searchParams.get('status')  || 'all';
    const memberId = searchParams.get('member')   || '';
    const search   = searchParams.get('search')   || '';
    const page     = parseInt(searchParams.get('page')  || '1');
    const limit    = parseInt(searchParams.get('limit') || '50');

    // ─── Supabase path ────────────────────────────────────────────
    if (isSupabaseReady()) {
      const supabase = getSupabase();
      let query = supabase
        .from('store_items')
        .select('*')
        .eq('store_name', STORE)
        .order('created_at', { ascending: false });

      if (status && status !== 'all') query = query.eq('item_data->>status', status);
      if (memberId) query = query.eq('item_data->submittedBy->>id', memberId);
      if (search) query = query.ilike('item_data->>title', `%${search}%`);

      const offset = (page - 1) * limit;
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;

      const reviews = (data || []).map(r => ({ id: r.item_id, ...r.item_data, _dbId: r.id }));
      const { data: allData } = await supabase.from('store_items').select('item_data').eq('store_name', STORE);
      const stats = calcStats((allData || []).map(r => r.item_data));
      return NextResponse.json({ success: true, reviews, stats, source: 'supabase' });
    }

    // ─── Fallback: in-memory ──────────────────────────────────────
    console.log('[Review GET] ⚠️ Supabase ไม่พร้อม — ใช้ in-memory fallback');
    let items = [...memStore];

    if (status && status !== 'all') items = items.filter(i => i.status === status);
    if (memberId) items = items.filter(i => i.submittedBy?.id === memberId);
    if (search) items = items.filter(i => i.title?.toLowerCase().includes(search.toLowerCase()));

    const offset = (page - 1) * limit;
    const reviews = items.slice(offset, offset + limit);
    const stats = calcStats(memStore);

    return NextResponse.json({ success: true, reviews, stats, source: 'memory' });

  } catch (error) {
    console.error('[Review GET]', error.message);
    // ✅ ส่ง empty แทน 500 error — ไม่ crash หน้าที่เรียกใช้
    return NextResponse.json({
      success: true,
      reviews: [],
      stats: { total: 0, pending: 0, approved: 0, rejected: 0, revision: 0 },
      source: 'error-fallback',
      warning: error.message,
    });
  }
}

// ─── POST ─────────────────────────────────────────────────────────
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
      content, hook: hook || '', closing: closing || '',
      style: style || '', tone: tone || '', target: target || '',
      sourceType: sourceType || 'url', presetLabel: presetLabel || '',
      contentLength: contentLength || 'medium',
      wordCount: wordCount || content.split(/\s+/).length,
      angles: angles || [], newsTitle: newsTitle || title || '',
      newsSource: newsSource || '', sourceVersion: sourceVersion || 'classic',
      status: 'pending', submittedBy: user, note: '',
      engagement: null, reviewedAt: null, reviewedBy: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };

    if (isSupabaseReady()) {
      const supabase = getSupabase();
      const { error } = await supabase.from('store_items').insert({
        item_id: itemId, store_name: STORE, item_data: item,
        created_at: item.createdAt, updated_at: item.updatedAt,
      });
      if (error) throw error;
    } else {
      // fallback to memory
      memStore.unshift(item);
      console.log(`[Review POST] ⚠️ Supabase ไม่พร้อม — บันทึกใน memory`);
    }

    console.log(`[Review] ✅ Added: "${item.title.slice(0, 50)}" (${itemId.slice(0, 8)}) by ${user?.name || 'anon'}`);
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error('[Review POST]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ─── PATCH ────────────────────────────────────────────────────────
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, status, note, engagement } = body;
    if (!id) return NextResponse.json({ success: false, error: 'ไม่พบ ID' }, { status: 400 });

    if (isSupabaseReady()) {
      const supabase = getSupabase();
      const { data, error: fetchErr } = await supabase.from('store_items').select('*').eq('store_name', STORE).eq('item_id', id).single();
      if (fetchErr || !data) return NextResponse.json({ success: false, error: 'ไม่พบรายการ' }, { status: 404 });

      const user = await getUser();
      const updated = { ...data.item_data, updatedAt: new Date().toISOString() };
      if (status !== undefined) { updated.status = status; updated.reviewedAt = new Date().toISOString(); updated.reviewedBy = user; }
      if (note !== undefined) updated.note = note;
      if (engagement !== undefined) updated.engagement = { ...updated.engagement, ...engagement, recordedAt: new Date().toISOString() };

      const { error: updateErr } = await supabase.from('store_items').update({ item_data: updated, updated_at: updated.updatedAt }).eq('store_name', STORE).eq('item_id', id);
      if (updateErr) throw updateErr;
      return NextResponse.json({ success: true, item: updated });
    }

    // memory fallback
    const idx = memStore.findIndex(i => i.id === id);
    if (idx === -1) return NextResponse.json({ success: false, error: 'ไม่พบรายการ (memory)' }, { status: 404 });
    const user = await getUser();
    if (status !== undefined) { memStore[idx].status = status; memStore[idx].reviewedAt = new Date().toISOString(); memStore[idx].reviewedBy = user; }
    if (note !== undefined) memStore[idx].note = note;
    if (engagement !== undefined) memStore[idx].engagement = { ...memStore[idx].engagement, ...engagement, recordedAt: new Date().toISOString() };
    memStore[idx].updatedAt = new Date().toISOString();
    return NextResponse.json({ success: true, item: memStore[idx] });

  } catch (error) {
    console.error('[Review PATCH]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request) { return PATCH(request); }

// ─── DELETE ───────────────────────────────────────────────────────
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ไม่พบ ID' }, { status: 400 });

    if (isSupabaseReady()) {
      const supabase = getSupabase();
      const { error } = await supabase.from('store_items').delete().eq('store_name', STORE).eq('item_id', id);
      if (error) throw error;
    } else {
      const idx = memStore.findIndex(i => i.id === id);
      if (idx !== -1) memStore.splice(idx, 1);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Review DELETE]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
