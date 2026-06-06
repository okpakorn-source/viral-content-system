/**
 * Chat Service — จัดการห้องแชทและข้อความ
 * 
 * ใช้ Supabase เป็น database หลัก
 * ทุก function มี try/catch และ return error gracefully
 */
import { getSupabase } from '@/lib/supabase';

const LOG_PREFIX = '[ChatService]';

// =====================================================
// Room Functions
// =====================================================

/**
 * ดึงรายการห้องแชททั้งหมด พร้อมข้อมูล employee
 * @param {Object} options - ตัวเลือก
 * @param {string} options.status - กรองตาม status ('active','archived','closed')
 * @param {string} options.employeeId - กรองตาม employee (สำหรับ employee ดูแค่ห้องตัวเอง)
 * @returns {{ success: boolean, rooms?: Array, error?: string, errorType?: string }}
 */
export async function getRooms({ status = 'active', employeeId = null } = {}) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' };
    }

    let query = supabase
      .from('chat_rooms')
      .select(`
        *,
        employee:chat_users!employee_id (
          id, username, display_name, role, avatar_emoji, active
        )
      `)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }

    const { data, error } = await query;

    if (error) {
      console.error(`${LOG_PREFIX} getRooms error:`, error.message);
      return { success: false, error: error.message, errorType: 'DB_QUERY_ERROR' };
    }

    return { success: true, rooms: data || [] };
  } catch (err) {
    console.error(`${LOG_PREFIX} getRooms exception:`, err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

/**
 * ดึงห้องแชทเดียวจาก slug
 * @param {string} slug - room_slug
 * @returns {{ success: boolean, room?: Object, error?: string, errorType?: string }}
 */
export async function getRoom(slug) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' };
    }

    const { data, error } = await supabase
      .from('chat_rooms')
      .select(`
        *,
        employee:chat_users!employee_id (
          id, username, display_name, role, avatar_emoji, active
        )
      `)
      .eq('room_slug', slug)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: 'ไม่พบห้องแชท', errorType: 'ROOM_NOT_FOUND' };
      }
      console.error(`${LOG_PREFIX} getRoom error:`, error.message);
      return { success: false, error: error.message, errorType: 'DB_QUERY_ERROR' };
    }

    return { success: true, room: data };
  } catch (err) {
    console.error(`${LOG_PREFIX} getRoom exception:`, err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

/**
 * สร้างห้องแชทใหม่
 * @param {Object} params
 * @param {string} params.employeeId - UUID ของ employee
 * @param {string} params.roomName - ชื่อห้อง
 * @param {string} params.roomSlug - slug (unique)
 * @param {string} [params.aiInstructions] - คำสั่ง AI เฉพาะห้อง
 * @returns {{ success: boolean, room?: Object, error?: string, errorType?: string }}
 */
export async function createRoom({ employeeId, roomName, roomSlug, aiInstructions = '' }) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' };
    }

    if (!employeeId || !roomName || !roomSlug) {
      return { success: false, error: 'ต้องระบุ employeeId, roomName, roomSlug', errorType: 'VALIDATION_ERROR' };
    }

    // Sanitize slug
    const sanitizedSlug = roomSlug
      .toLowerCase()
      .replace(/[^a-z0-9\u0E00-\u0E7F-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const { data, error } = await supabase
      .from('chat_rooms')
      .insert({
        employee_id: employeeId,
        room_name: roomName,
        room_slug: sanitizedSlug,
        ai_instructions: aiInstructions,
        status: 'active',
      })
      .select(`
        *,
        employee:chat_users!employee_id (
          id, username, display_name, role, avatar_emoji, active
        )
      `)
      .single();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'slug นี้ถูกใช้งานแล้ว', errorType: 'DUPLICATE_SLUG' };
      }
      console.error(`${LOG_PREFIX} createRoom error:`, error.message);
      return { success: false, error: error.message, errorType: 'DB_INSERT_ERROR' };
    }

    return { success: true, room: data };
  } catch (err) {
    console.error(`${LOG_PREFIX} createRoom exception:`, err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

// =====================================================
// Message Functions
// =====================================================

/**
 * ดึงข้อความจากห้องแชท (pagination ด้วย cursor)
 * @param {string} roomId - UUID ของห้อง
 * @param {Object} options
 * @param {number} [options.limit=50] - จำนวนข้อความ
 * @param {string} [options.before=null] - ISO timestamp สำหรับ pagination
 * @returns {{ success: boolean, messages?: Array, error?: string, errorType?: string }}
 */
export async function getMessages(roomId, { limit = 50, before = null } = {}) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' };
    }

    if (!roomId) {
      return { success: false, error: 'ต้องระบุ roomId', errorType: 'VALIDATION_ERROR' };
    }

    let query = supabase
      .from('chat_messages')
      .select(`
        *,
        sender:chat_users!sender_id (
          id, username, display_name, role, avatar_emoji
        )
      `)
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(Math.min(limit, 200));

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data, error } = await query;

    if (error) {
      console.error(`${LOG_PREFIX} getMessages error:`, error.message);
      return { success: false, error: error.message, errorType: 'DB_QUERY_ERROR' };
    }

    return { success: true, messages: data || [] };
  } catch (err) {
    console.error(`${LOG_PREFIX} getMessages exception:`, err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

/**
 * ส่งข้อความใหม่
 * @param {Object} params
 * @param {string} params.roomId - UUID ของห้อง
 * @param {string|null} params.senderId - UUID ผู้ส่ง (null สำหรับ AI)
 * @param {string} params.senderType - 'employee' | 'manager' | 'ai'
 * @param {string} params.content - เนื้อหาข้อความ
 * @param {string} [params.messageType='text'] - ประเภทข้อความ
 * @param {Array} [params.attachments=[]] - ไฟล์แนบ
 * @param {Object} [params.reviewResult=null] - ผลตรวจจาก AI
 * @returns {{ success: boolean, message?: Object, error?: string, errorType?: string }}
 */
export async function sendMessage({
  roomId,
  senderId = null,
  senderType,
  content,
  messageType = 'text',
  attachments = [],
  reviewResult = null,
}) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' };
    }

    if (!roomId || !senderType || !content) {
      return { success: false, error: 'ต้องระบุ roomId, senderType, content', errorType: 'VALIDATION_ERROR' };
    }

    const validSenderTypes = ['employee', 'manager', 'ai'];
    if (!validSenderTypes.includes(senderType)) {
      return { success: false, error: `senderType ต้องเป็น: ${validSenderTypes.join(', ')}`, errorType: 'VALIDATION_ERROR' };
    }

    const validMessageTypes = ['text', 'news_submit', 'caption_submit', 'image_submit', 'ai_review', 'system'];
    if (!validMessageTypes.includes(messageType)) {
      return { success: false, error: `messageType ต้องเป็น: ${validMessageTypes.join(', ')}`, errorType: 'VALIDATION_ERROR' };
    }

    const insertData = {
      room_id: roomId,
      sender_id: senderId,
      sender_type: senderType,
      content,
      message_type: messageType,
      attachments: attachments || [],
    };

    if (reviewResult) {
      insertData.review_result = reviewResult;
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .insert(insertData)
      .select(`
        *,
        sender:chat_users!sender_id (
          id, username, display_name, role, avatar_emoji
        )
      `)
      .single();

    if (error) {
      console.error(`${LOG_PREFIX} sendMessage error:`, error.message);
      return { success: false, error: error.message, errorType: 'DB_INSERT_ERROR' };
    }

    return { success: true, message: data };
  } catch (err) {
    console.error(`${LOG_PREFIX} sendMessage exception:`, err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

/**
 * นับจำนวนข้อความในห้อง
 * @param {string} roomId - UUID ของห้อง
 * @returns {{ success: boolean, count?: number, error?: string, errorType?: string }}
 */
export async function getMessageCount(roomId) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' };
    }

    if (!roomId) {
      return { success: false, error: 'ต้องระบุ roomId', errorType: 'VALIDATION_ERROR' };
    }

    const { count, error } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', roomId);

    if (error) {
      console.error(`${LOG_PREFIX} getMessageCount error:`, error.message);
      return { success: false, error: error.message, errorType: 'DB_QUERY_ERROR' };
    }

    return { success: true, count: count || 0 };
  } catch (err) {
    console.error(`${LOG_PREFIX} getMessageCount exception:`, err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}
