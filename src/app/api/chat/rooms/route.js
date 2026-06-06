/**
 * Chat Rooms API Route
 * 
 * GET  /api/chat/rooms — List rooms
 *   - Manager/Admin: sees all rooms
 *   - Employee: sees only own rooms
 *   - Query: ?status=active
 * 
 * POST /api/chat/rooms — Create room (manager/admin only)
 *   body: { employeeId, roomName, roomSlug, aiInstructions? }
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/services/chat/chatAuth';
import { getRooms, createRoom } from '@/lib/services/chat/chatService';

export async function GET(request) {
  try {
    // Auth check
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, error: auth.error, errorType: auth.errorType },
        { status: auth.status || 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug');
    const status = searchParams.get('status') || 'active';

    // === Single room by slug ===
    if (slug) {
      const { getSupabase } = await import('@/lib/supabase');
      const supabase = getSupabase();
      if (!supabase) {
        return NextResponse.json({ success: false, error: 'DB not ready', errorType: 'DB_ERROR' }, { status: 503 });
      }

      const { data: room, error } = await supabase
        .from('chat_rooms')
        .select('id, employee_id, room_name, room_slug, ai_instructions, status, created_at')
        .eq('room_slug', slug)
        .single();

      if (error || !room) {
        return NextResponse.json({ success: false, error: 'ไม่พบห้อง', errorType: 'NOT_FOUND' }, { status: 404 });
      }

      // Get employee name
      const { data: emp } = await supabase
        .from('chat_users')
        .select('display_name, avatar_emoji')
        .eq('id', room.employee_id)
        .single();

      return NextResponse.json({
        success: true,
        room: {
          ...room,
          employee_name: emp?.display_name || 'ไม่ทราบ',
          employee_avatar: emp?.avatar_emoji || '👤',
        },
      });
    }

    // === List all rooms ===
    // Employee sees only their own rooms
    const options = { status };
    if (auth.user.role === 'employee') {
      options.employeeId = auth.user.id;
    }

    const result = await getRooms(options);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, errorType: result.errorType },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      rooms: result.rooms,
    });
  } catch (error) {
    console.error('[ChatRooms API] GET error:', error.message);
    return NextResponse.json(
      { success: false, error: 'เกิดข้อผิดพลาดภายใน', errorType: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    // Auth check
    const auth = await requireAuth(request);
    if (!auth.success) {
      return NextResponse.json(
        { success: false, error: auth.error, errorType: auth.errorType },
        { status: auth.status || 401 }
      );
    }

    // Only manager and admin can create rooms
    if (!['manager', 'admin'].includes(auth.user.role)) {
      return NextResponse.json(
        { success: false, error: 'เฉพาะ manager/admin เท่านั้นที่สร้างห้องได้', errorType: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { employeeId, roomName, roomSlug, aiInstructions } = body;

    if (!employeeId || !roomName || !roomSlug) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ employeeId, roomName, roomSlug', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const result = await createRoom({
      employeeId,
      roomName,
      roomSlug,
      aiInstructions: aiInstructions || '',
    });

    if (!result.success) {
      const status = result.errorType === 'VALIDATION_ERROR' ? 400
        : result.errorType === 'DUPLICATE_SLUG' ? 409
        : 500;
      return NextResponse.json(
        { success: false, error: result.error, errorType: result.errorType },
        { status }
      );
    }

    return NextResponse.json({
      success: true,
      room: result.room,
    }, { status: 201 });
  } catch (error) {
    console.error('[ChatRooms API] POST error:', error.message);
    return NextResponse.json(
      { success: false, error: 'เกิดข้อผิดพลาดภายใน', errorType: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
