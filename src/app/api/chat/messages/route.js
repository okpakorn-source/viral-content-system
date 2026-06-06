/**
 * Chat Messages API Route
 * 
 * GET  /api/chat/messages?roomId=xxx&limit=50&before=timestamp
 *   - Requires auth
 *   - Employee can only access own room
 * 
 * POST /api/chat/messages
 *   body: { roomId, content, messageType?, attachments?, reviewResult? }
 *   - Requires auth
 *   - Employee can only post to own room
 *   - senderType is auto-detected from user role
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/services/chat/chatAuth';
import { getMessages, sendMessage } from '@/lib/services/chat/chatService';
import { getSupabase } from '@/lib/supabase';

/**
 * ตรวจสอบว่า user มีสิทธิ์เข้าถึงห้องนี้หรือไม่
 * - Manager/Admin: เข้าได้ทุกห้อง
 * - Employee: เข้าได้เฉพาะห้องของตัวเอง
 */
async function canAccessRoom(userId, userRole, roomId) {
  if (['manager', 'admin'].includes(userRole)) {
    return true;
  }

  try {
    const supabase = getSupabase();
    if (!supabase) return false;

    const { data, error } = await supabase
      .from('chat_rooms')
      .select('employee_id')
      .eq('id', roomId)
      .single();

    if (error || !data) return false;
    return data.employee_id === userId;
  } catch {
    return false;
  }
}

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
    const roomId = searchParams.get('roomId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const before = searchParams.get('before') || null;

    if (!roomId) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ roomId', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Room access check
    const hasAccess = await canAccessRoom(auth.user.id, auth.user.role, roomId);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'ไม่มีสิทธิ์เข้าถึงห้องนี้', errorType: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    const result = await getMessages(roomId, { limit, before });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, errorType: result.errorType },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      messages: result.messages,
    });
  } catch (error) {
    console.error('[ChatMessages API] GET error:', error.message);
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

    const body = await request.json();
    const { roomId, content, messageType = 'text', attachments = [], reviewResult = null } = body;

    if (!roomId || !content) {
      return NextResponse.json(
        { success: false, error: 'ต้องระบุ roomId และ content', errorType: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Room access check
    const hasAccess = await canAccessRoom(auth.user.id, auth.user.role, roomId);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'ไม่มีสิทธิ์ส่งข้อความในห้องนี้', errorType: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    // Auto-detect senderType from user role
    // Manager stays 'manager', employee stays 'employee'
    const senderType = auth.user.role === 'admin' ? 'manager' : auth.user.role;

    const result = await sendMessage({
      roomId,
      senderId: auth.user.id,
      senderType,
      content,
      messageType,
      attachments,
      reviewResult,
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
      message: result.message,
    }, { status: 201 });
  } catch (error) {
    console.error('[ChatMessages API] POST error:', error.message);
    return NextResponse.json(
      { success: false, error: 'เกิดข้อผิดพลาดภายใน', errorType: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
