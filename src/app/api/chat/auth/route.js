/**
 * Chat Auth API Route
 * 
 * POST /api/chat/auth — Login
 *   body: { username, password }
 *   returns: { success, token, user }
 * 
 * GET /api/chat/auth — Verify session
 *   header: Authorization: Bearer <token>
 *   returns: { success, user }
 */
import { NextResponse } from 'next/server';
import {
  getUserByUsername,
  verifyPassword,
  createSession,
  requireAuth,
  createUser,
} from '@/lib/services/chat/chatAuth';

export async function POST(request) {
  try {
    const body = await request.json();
    const { action, username, password, displayName, role, avatarEmoji } = body;

    // =====================================================
    // Action: register (requires manager/admin auth)
    // =====================================================
    if (action === 'register') {
      const auth = await requireAuth(request);
      if (!auth.success) {
        return NextResponse.json(
          { success: false, error: auth.error, errorType: auth.errorType },
          { status: auth.status || 401 }
        );
      }

      // Only manager and admin can create users
      if (!['manager', 'admin'].includes(auth.user.role)) {
        return NextResponse.json(
          { success: false, error: 'ไม่มีสิทธิ์สร้างผู้ใช้', errorType: 'FORBIDDEN' },
          { status: 403 }
        );
      }

      const result = await createUser({
        username,
        password,
        displayName: displayName || username,
        role: role || 'employee',
        avatarEmoji: avatarEmoji || '👤',
      });

      if (!result.success) {
        const status = result.errorType === 'VALIDATION_ERROR' ? 400 : 500;
        return NextResponse.json(
          { success: false, error: result.error, errorType: result.errorType },
          { status }
        );
      }

      return NextResponse.json({
        success: true,
        user: result.user,
      });
    }

    // =====================================================
    // Default action: login
    // =====================================================
    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'กรุณาระบุ username และ password', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Find user
    const userResult = await getUserByUsername(username);
    if (!userResult.success) {
      return NextResponse.json(
        { success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', errorType: 'INVALID_CREDENTIALS' },
        { status: 401 }
      );
    }

    const user = userResult.user;

    // Check if account is active
    if (!user.active) {
      return NextResponse.json(
        { success: false, error: 'บัญชีถูกระงับ', errorType: 'ACCOUNT_DISABLED' },
        { status: 403 }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', errorType: 'INVALID_CREDENTIALS' },
        { status: 401 }
      );
    }

    // Create token
    const token = createSession(user.id, user.role);

    // For employees, find their room slug for auto-redirect
    let roomSlug = null;
    if (user.role === 'employee') {
      try {
        const { getSupabase } = await import('@/lib/supabase');
        const supabase = getSupabase();
        if (supabase) {
          const { data: room } = await supabase
            .from('chat_rooms')
            .select('room_slug')
            .eq('employee_id', user.id)
            .eq('status', 'active')
            .limit(1)
            .single();
          if (room) roomSlug = room.room_slug;
        }
      } catch {}
    }

    return NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        avatarEmoji: user.avatar_emoji,
        roomSlug,
      },
    });
  } catch (error) {
    console.error('[ChatAuth API] POST error:', error.message);
    return NextResponse.json(
      { success: false, error: 'เกิดข้อผิดพลาดภายใน', errorType: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, error: auth.error, errorType: auth.errorType },
        { status: auth.status || 401 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: auth.user.id,
        username: auth.user.username,
        displayName: auth.user.display_name,
        role: auth.user.role,
        avatarEmoji: auth.user.avatar_emoji,
      },
    });
  } catch (error) {
    console.error('[ChatAuth API] GET error:', error.message);
    return NextResponse.json(
      { success: false, error: 'เกิดข้อผิดพลาดภายใน', errorType: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
