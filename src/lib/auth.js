import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { randomBytes, createHash, createHmac } from 'crypto';

// Vercel uses /tmp for writable storage; local uses ./data
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = IS_VERCEL ? '/tmp' : join(process.cwd(), 'data');
const MEMBERS_FILE = join(DATA_DIR, 'members.json');

// Bundled default members from repo (for Vercel cold starts)
const BUNDLED_MEMBERS_FILE = join(process.cwd(), 'data', 'members.json');

// JWT-like stateless token secret
const TOKEN_SECRET = process.env.AUTH_SECRET || 'viralflow_jwt_secret_2024_prod';

// === Helpers ===
function hashPassword(password) {
  return createHash('sha256').update(password + 'viralflow_salt_2024').digest('hex');
}

// === Stateless Token (JWT-like) ===
// Encodes user info into the token itself — no server-side session storage needed
function createStatelessToken(member) {
  const payload = {
    id: member.id,
    username: member.username,
    displayName: member.displayName,
    role: member.role,
    avatar: member.avatar,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', TOKEN_SECRET).update(payloadStr).digest('base64url');
  return `${payloadStr}.${sig}`;
}

function verifyStatelessToken(token) {
  if (!token || !token.includes('.')) return null;
  try {
    const [payloadStr, sig] = token.split('.');
    const expectedSig = createHmac('sha256', TOKEN_SECRET).update(payloadStr).digest('base64url');
    if (sig !== expectedSig) return null; // tampered
    const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString());
    if (payload.exp < Date.now()) return null; // expired
    return payload;
  } catch {
    return null;
  }
}

async function ensureDir() {
  try { await mkdir(DATA_DIR, { recursive: true }); } catch {}
}

// === Simple file-level mutex to prevent race conditions ===
const locks = {};
async function withLock(key, fn) {
  while (locks[key]) {
    await new Promise(r => setTimeout(r, 50));
  }
  locks[key] = true;
  try {
    return await fn();
  } finally {
    locks[key] = false;
  }
}

// === Members CRUD ===
async function readMembers() {
  await ensureDir();
  // Try primary location first
  try {
    const raw = await readFile(MEMBERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}

  // Try bundled file (for Vercel cold start or if primary is empty)
  try {
    if (existsSync(BUNDLED_MEMBERS_FILE)) {
      const raw = await readFile(BUNDLED_MEMBERS_FILE, 'utf8');
      const members = JSON.parse(raw);
      if (Array.isArray(members) && members.length > 0) {
        await writeFile(MEMBERS_FILE, JSON.stringify(members, null, 2), 'utf8');
        return members;
      }
    }
  } catch {}

  // Last resort: Create default admin
  const defaultMembers = [{
    id: 'admin',
    username: 'admin',
    password: hashPassword('Huasaii123'),
    displayName: 'Admin',
    role: 'admin',
    avatar: '👑',
    createdAt: new Date().toISOString(),
    stats: { totalCreated: 0, totalApproved: 0, totalRejected: 0, totalRevision: 0 },
    lastLogin: null,
  }];
  await writeFile(MEMBERS_FILE, JSON.stringify(defaultMembers, null, 2), 'utf8');
  return defaultMembers;
}

async function saveMembers(members) {
  await ensureDir();
  const data = JSON.stringify(members, null, 2);
  await writeFile(MEMBERS_FILE, data, 'utf8');
  try {
    await mkdir(join(process.cwd(), 'data'), { recursive: true });
    await writeFile(BUNDLED_MEMBERS_FILE, data, 'utf8');
  } catch {}
}

// === Auth Functions ===
export async function login(username, password) {
  return withLock('members', async () => {
    const members = await readMembers();
    const member = members.find(m => m.username === username);
    if (!member) return { success: false, error: 'ไม่พบชื่อผู้ใช้' };
    if (member.password !== hashPassword(password)) return { success: false, error: 'รหัสผ่านไม่ถูกต้อง' };

    // Create stateless JWT token — no file storage needed!
    const token = createStatelessToken(member);

    // Update lastLogin
    member.lastLogin = new Date().toISOString();
    await saveMembers(members);

    console.log(`[Auth] ✅ Login: ${username} (${member.role})`);

    return {
      success: true,
      token,
      member: { id: member.id, username: member.username, displayName: member.displayName, role: member.role, avatar: member.avatar },
    };
  });
}

export async function logout(token) {
  // Stateless — nothing to clear on server side
  // Token will just be removed from cookie by the route handler
  return { success: true };
}

export async function getSession(token) {
  // Stateless verification — no file I/O!
  if (!token) return null;
  const payload = verifyStatelessToken(token);
  if (!payload) return null;
  return {
    memberId: payload.id,
    username: payload.username,
    displayName: payload.displayName,
    role: payload.role,
    avatar: payload.avatar,
  };
}

export async function register(data) {
  return withLock('members', async () => {
    const members = await readMembers();
    if (members.find(m => m.username === data.username)) {
      return { success: false, error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' };
    }

    const newMember = {
      id: `member_${Date.now()}`,
      username: data.username,
      password: hashPassword(data.password),
      displayName: data.displayName || data.username,
      nickname: data.nickname || '',
      role: data.role || 'editor',
      avatar: data.avatar || '👤',
      createdAt: new Date().toISOString(),
      stats: { totalCreated: 0, totalApproved: 0, totalRejected: 0, totalRevision: 0 },
      lastLogin: null,
    };

    members.push(newMember);
    await saveMembers(members);
    console.log(`[Auth] ✅ Registered: ${data.username} (${newMember.id}) — Total: ${members.length}`);
    return { success: true, member: { ...newMember, password: undefined } };
  });
}

export async function getMembers() {
  const members = await readMembers();
  return members.map(m => ({ ...m, password: undefined, nickname: m.nickname || '' }));
}

export async function updateMember(id, updates) {
  return withLock('members', async () => {
    const members = await readMembers();
    const idx = members.findIndex(m => m.id === id);
    if (idx < 0) return { success: false, error: 'ไม่พบสมาชิก' };

    if (updates.password) updates.password = hashPassword(updates.password);
    members[idx] = { ...members[idx], ...updates };
    await saveMembers(members);
    return { success: true, member: { ...members[idx], password: undefined } };
  });
}

export async function deleteMember(id) {
  return withLock('members', async () => {
    const members = await readMembers();
    const idx = members.findIndex(m => m.id === id);
    if (idx < 0) return { success: false, error: 'ไม่พบสมาชิก' };
    if (members[idx].role === 'admin' && members.filter(m => m.role === 'admin').length <= 1) {
      return { success: false, error: 'ไม่สามารถลบ admin คนสุดท้าย' };
    }
    const removed = members.splice(idx, 1);
    await saveMembers(members);
    console.log(`[Auth] 🗑️ Deleted: ${removed[0].username} — Remaining: ${members.length}`);
    return { success: true };
  });
}

export async function updateMemberStats(memberId, field) {
  return withLock('members', async () => {
    const members = await readMembers();
    const member = members.find(m => m.id === memberId);
    if (member && member.stats) {
      member.stats[field] = (member.stats[field] || 0) + 1;
      await saveMembers(members);
    }
  });
}

export const PERMISSIONS = {
  admin: ['create', 'submit', 'review', 'approve', 'reject', 'manage_members', 'manage_prompts', 'settings'],
  editor: ['create', 'submit'],
  viewer: ['view'],
};

export function hasPermission(role, action) {
  return PERMISSIONS[role]?.includes(action) || false;
}
