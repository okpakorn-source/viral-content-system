/**
 * Chat Auth Service — ระบบยืนยันตัวตนสำหรับ Chat
 * 
 * ใช้ SHA-256 + salt สำหรับ hash password
 * ใช้ base64 token (signed with HMAC-SHA256) แทน JWT
 * ไม่ต้องพึ่ง library ภายนอก — ใช้แค่ Node.js crypto
 */
import { getSupabase } from '@/lib/supabase';
import crypto from 'crypto';

const LOG_PREFIX = '[ChatAuth]';
const AUTH_SECRET = process.env.CHAT_AUTH_SECRET || 'chat-secret-key-2024';
const TOKEN_EXPIRY_HOURS = 24 * 7; // 7 days

// =====================================================
// Password Hashing
// =====================================================

/**
 * Hash password ด้วย SHA-256 + random salt
 * @param {string} password - รหัสผ่าน plaintext
 * @returns {Promise<string>} - hash ในรูปแบบ "salt:hash"
 */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .createHash('sha256')
    .update(salt + password)
    .digest('hex');
  return `${salt}:${hash}`;
}

/**
 * ตรวจสอบ password กับ hash
 * @param {string} password - รหัสผ่าน plaintext
 * @param {string} storedHash - hash ที่เก็บไว้ในรูปแบบ "salt:hash"
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, storedHash) {
  try {
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;

    const hash = crypto
      .createHash('sha256')
      .update(salt + password)
      .digest('hex');

    return hash === originalHash;
  } catch {
    return false;
  }
}

// =====================================================
// Token Management (HMAC-signed base64 token)
// =====================================================

/**
 * สร้าง signed token
 * @param {string} userId - UUID ผู้ใช้
 * @param {string} role - role ของผู้ใช้
 * @returns {string} - base64 token
 */
export function createSession(userId, role = 'employee') {
  const payload = {
    userId,
    role,
    exp: Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
    iat: Date.now(),
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

  // Sign with HMAC-SHA256
  const signature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payloadBase64)
    .digest('base64url');

  return `${payloadBase64}.${signature}`;
}

/**
 * ตรวจสอบ token ว่าถูกต้องและยังไม่หมดอายุ
 * @param {string} token - token ที่ได้รับ
 * @returns {{ valid: boolean, payload?: Object, error?: string }}
 */
export function verifySession(token) {
  try {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token is required' };
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid token format' };
    }

    const [payloadBase64, signature] = parts;

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', AUTH_SECRET)
      .update(payloadBase64)
      .digest('base64url');

    if (signature !== expectedSignature) {
      return { valid: false, error: 'Invalid token signature' };
    }

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString());

    // Check expiration
    if (payload.exp && Date.now() > payload.exp) {
      return { valid: false, error: 'Token expired' };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: 'Token decode error' };
  }
}

/**
 * ดึงข้อมูล user จาก token
 * @param {string} token - token
 * @returns {Promise<{ success: boolean, user?: Object, error?: string, errorType?: string }>}
 */
export async function getUserFromToken(token) {
  try {
    const result = verifySession(token);
    if (!result.valid) {
      return { success: false, error: result.error, errorType: 'INVALID_TOKEN' };
    }

    const userResult = await getUser(result.payload.userId);
    if (!userResult.success) {
      return userResult;
    }

    return { success: true, user: userResult.user };
  } catch (err) {
    console.error(`${LOG_PREFIX} getUserFromToken error:`, err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

// =====================================================
// User CRUD
// =====================================================

/**
 * สร้างผู้ใช้ใหม่
 * @param {Object} params
 * @param {string} params.username
 * @param {string} params.password
 * @param {string} params.displayName
 * @param {string} [params.role='employee']
 * @param {string} [params.avatarEmoji='👤']
 * @returns {Promise<{ success: boolean, user?: Object, error?: string, errorType?: string }>}
 */
export async function createUser({ username, password, displayName, role = 'employee', avatarEmoji = '👤' }) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' };
    }

    if (!username || !password || !displayName) {
      return { success: false, error: 'ต้องระบุ username, password, displayName', errorType: 'VALIDATION_ERROR' };
    }

    const validRoles = ['employee', 'manager', 'admin'];
    if (!validRoles.includes(role)) {
      return { success: false, error: `role ต้องเป็น: ${validRoles.join(', ')}`, errorType: 'VALIDATION_ERROR' };
    }

    if (password.length < 4) {
      return { success: false, error: 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร', errorType: 'VALIDATION_ERROR' };
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    const { data, error } = await supabase
      .from('chat_users')
      .insert({
        username: username.toLowerCase().trim(),
        password_hash: passwordHash,
        display_name: displayName.trim(),
        role,
        avatar_emoji: avatarEmoji,
        active: true,
      })
      .select('id, username, display_name, role, avatar_emoji, active, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'username นี้ถูกใช้งานแล้ว', errorType: 'DUPLICATE_USERNAME' };
      }
      console.error(`${LOG_PREFIX} createUser error:`, error.message);
      return { success: false, error: error.message, errorType: 'DB_INSERT_ERROR' };
    }

    return { success: true, user: data };
  } catch (err) {
    console.error(`${LOG_PREFIX} createUser exception:`, err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

/**
 * ดึงข้อมูล user จาก ID
 * @param {string} userId - UUID
 * @returns {Promise<{ success: boolean, user?: Object, error?: string, errorType?: string }>}
 */
export async function getUser(userId) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' };
    }

    const { data, error } = await supabase
      .from('chat_users')
      .select('id, username, display_name, role, avatar_emoji, active, created_at')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: 'ไม่พบผู้ใช้', errorType: 'USER_NOT_FOUND' };
      }
      console.error(`${LOG_PREFIX} getUser error:`, error.message);
      return { success: false, error: error.message, errorType: 'DB_QUERY_ERROR' };
    }

    return { success: true, user: data };
  } catch (err) {
    console.error(`${LOG_PREFIX} getUser exception:`, err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

/**
 * ดึงข้อมูล user จาก username
 * @param {string} username
 * @returns {Promise<{ success: boolean, user?: Object, error?: string, errorType?: string }>}
 */
export async function getUserByUsername(username) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' };
    }

    const { data, error } = await supabase
      .from('chat_users')
      .select('id, username, password_hash, display_name, role, avatar_emoji, active, created_at')
      .eq('username', username.toLowerCase().trim())
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { success: false, error: 'ไม่พบผู้ใช้', errorType: 'USER_NOT_FOUND' };
      }
      console.error(`${LOG_PREFIX} getUserByUsername error:`, error.message);
      return { success: false, error: error.message, errorType: 'DB_QUERY_ERROR' };
    }

    return { success: true, user: data };
  } catch (err) {
    console.error(`${LOG_PREFIX} getUserByUsername exception:`, err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

/**
 * ดึงรายการ users (กรองตาม role ได้)
 * @param {Object} options
 * @param {string} [options.role] - กรองตาม role
 * @returns {Promise<{ success: boolean, users?: Array, error?: string, errorType?: string }>}
 */
export async function listUsers({ role } = {}) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Supabase not configured', errorType: 'SUPABASE_NOT_READY' };
    }

    let query = supabase
      .from('chat_users')
      .select('id, username, display_name, role, avatar_emoji, active, created_at')
      .order('created_at', { ascending: false });

    if (role) {
      query = query.eq('role', role);
    }

    const { data, error } = await query;

    if (error) {
      console.error(`${LOG_PREFIX} listUsers error:`, error.message);
      return { success: false, error: error.message, errorType: 'DB_QUERY_ERROR' };
    }

    return { success: true, users: data || [] };
  } catch (err) {
    console.error(`${LOG_PREFIX} listUsers exception:`, err.message);
    return { success: false, error: err.message, errorType: 'INTERNAL_ERROR' };
  }
}

// =====================================================
// Helper: Extract token from request
// =====================================================

/**
 * ดึง token จาก Authorization header
 * @param {Request} request - Next.js request
 * @returns {string|null}
 */
export function extractTokenFromRequest(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

/**
 * Middleware helper: ตรวจสอบ auth และ return user
 * @param {Request} request
 * @returns {Promise<{ success: boolean, user?: Object, error?: string, errorType?: string, status?: number }>}
 */
export async function requireAuth(request) {
  const token = extractTokenFromRequest(request);
  if (!token) {
    return { success: false, error: 'กรุณาเข้าสู่ระบบ', errorType: 'AUTH_REQUIRED', status: 401 };
  }

  const result = await getUserFromToken(token);
  if (!result.success) {
    return { success: false, error: result.error || 'Token ไม่ถูกต้อง', errorType: 'INVALID_TOKEN', status: 401 };
  }

  if (!result.user.active) {
    return { success: false, error: 'บัญชีถูกระงับ', errorType: 'ACCOUNT_DISABLED', status: 403 };
  }

  return { success: true, user: result.user };
}
