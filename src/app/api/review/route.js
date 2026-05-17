import { NextResponse } from 'next/server';
import { getSession, updateMemberStats } from '@/lib/auth';
import { cookies } from 'next/headers';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DATA_DIR = join(process.cwd(), 'data');
const REVIEW_FILE = join(DATA_DIR, 'reviews.json');

async function loadReviews() {
  try {
    const data = await readFile(REVIEW_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveReviews(reviews) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(REVIEW_FILE, JSON.stringify(reviews, null, 2), 'utf-8');
}

// GET — ดึงรายการทั้งหมด (filter by status)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // pending, approved, rejected, revision
    const memberId = searchParams.get('member'); // filter by member
    let reviews = await loadReviews();

    // Sort by newest first
    reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Filter by member if specified
    if (memberId) {
      reviews = reviews.filter(r => r.submittedBy?.id === memberId);
    }

    // Stats (from filtered data)
    const stats = {
      total: reviews.length,
      pending: reviews.filter(r => r.status === 'pending').length,
      approved: reviews.filter(r => r.status === 'approved').length,
      rejected: reviews.filter(r => r.status === 'rejected').length,
      revision: reviews.filter(r => r.status === 'revision').length,
    };

    // Filter after stats
    if (status && status !== 'all') {
      reviews = reviews.filter(r => r.status === status);
    }

    return NextResponse.json({ success: true, reviews, stats });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST — ส่งเข้าคลังรอตรวจ
export async function POST(request) {
  try {
    const body = await request.json();
    const { title, content, sourceType, preset, presetLabel, contentLength, wordCount, angles } = body;

    if (!content || content.length < 20) {
      return NextResponse.json({ success: false, error: 'เนื้อหาสั้นเกินไป' }, { status: 400 });
    }

    const reviews = await loadReviews();

    const newItem = {
      id: randomUUID(),
      title: title || 'ไม่มีหัวข้อ',
      content,
      sourceType: sourceType || 'url',
      preset: preset || '',
      presetLabel: presetLabel || '',
      contentLength: contentLength || 'short',
      wordCount: wordCount || content.split(/\s+/).length,
      angles: angles || [],
      status: 'pending',
      submittedBy: null, // will be set below
      note: '',
      reviewedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Add member info
    try {
      const cookieStore = await cookies();
      const token = cookieStore.get('auth_token')?.value;
      const session = await getSession(token);
      if (session) {
        newItem.submittedBy = { id: session.memberId, name: session.displayName, avatar: session.avatar };
        await updateMemberStats(session.memberId, 'totalCreated');
      }
    } catch {}

    reviews.push(newItem);
    await saveReviews(reviews);

    console.log(`[Review] ✅ Added: "${newItem.title.slice(0, 50)}" (${newItem.id.slice(0, 8)})`);

    return NextResponse.json({ success: true, item: newItem });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// PUT — อัปเดตสถานะ (ผ่าน/ไม่ผ่าน/รอแก้ไข) + หมายเหตุ
export async function PUT(request) {
  try {
    const { id, status, note } = await request.json();

    if (!id) {
      return NextResponse.json({ success: false, error: 'ไม่พบ ID' }, { status: 400 });
    }

    const reviews = await loadReviews();
    const idx = reviews.findIndex(r => r.id === id);

    if (idx === -1) {
      return NextResponse.json({ success: false, error: 'ไม่พบรายการ' }, { status: 404 });
    }

    if (status) reviews[idx].status = status;
    if (note !== undefined) reviews[idx].note = note;
    reviews[idx].reviewedAt = new Date().toISOString();
    reviews[idx].updatedAt = new Date().toISOString();

    await saveReviews(reviews);

    const statusLabels = { approved: 'ผ่าน', rejected: 'ไม่ผ่าน', revision: 'รอแก้ไข', pending: 'รอตรวจ' };
    console.log(`[Review] Updated ${id.slice(0, 8)}: ${statusLabels[status] || status}`);

    return NextResponse.json({ success: true, item: reviews[idx] });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE — ลบรายการ
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'ไม่พบ ID' }, { status: 400 });
    }

    let reviews = await loadReviews();
    reviews = reviews.filter(r => r.id !== id);
    await saveReviews(reviews);
    // Update member stats
    const submitter = reviews[idx]?.submittedBy?.id;
    if (submitter) {
      const statsMap = { approved: 'totalApproved', rejected: 'totalRejected', revision: 'totalRevision' };
      if (statsMap[status]) {
        await updateMemberStats(submitter, statsMap[status]).catch(() => {});
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
