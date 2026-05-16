import { NextResponse } from 'next/server';
import { getSession, getMembers, updateMember, deleteMember, register } from '@/lib/auth';
import { cookies } from 'next/headers';

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  const session = await getSession(token);
  if (!session || session.role !== 'admin') return null;
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ success: false, error: 'ไม่มีสิทธิ์' }, { status: 403 });
  const members = await getMembers();
  return NextResponse.json({ success: true, members });
}

export async function POST(request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ success: false, error: 'ไม่มีสิทธิ์' }, { status: 403 });

  const body = await request.json();

  if (body.action === 'create') {
    const result = await register({
      username: body.username,
      password: body.password,
      displayName: body.displayName,
      role: body.role || 'editor',
      avatar: body.avatar || '👤',
    });
    return NextResponse.json(result);
  }

  if (body.action === 'update') {
    const updates = {};
    if (body.displayName) updates.displayName = body.displayName;
    if (body.role) updates.role = body.role;
    if (body.avatar) updates.avatar = body.avatar;
    if (body.password) updates.password = body.password;
    const result = await updateMember(body.id, updates);
    return NextResponse.json(result);
  }

  if (body.action === 'delete') {
    const result = await deleteMember(body.id);
    return NextResponse.json(result);
  }

  return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
}
