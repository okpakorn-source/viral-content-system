import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { randomBytes, createHash } from 'crypto';

// Vercel uses /tmp for writable storage; local uses ./data
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = IS_VERCEL ? '/tmp' : join(process.cwd(), 'data');
const MEMBERS_FILE = join(DATA_DIR, 'members.json');
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json');

// Bundled default members from repo (for Vercel cold starts)
const BUNDLED_MEMBERS_FILE = join(process.cwd(), 'data', 'members.json');

// === Helpers ===
function hashPassword(password) {
  return createHash('sha256').update(password + 'viralflow_salt_2024').digest('hex');
}

function generateToken() {
  return randomBytes(32).toString('hex');
}

async function ensureDir() {
  try { await mkdir(DATA_DIR, { recursive: true }); } catch {}
}

// === Members CRUD ===
async function readMembers() {
  await ensureDir();
  try {
    const raw = await readFile(MEMBERS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    // Try loading bundled file (for Vercel cold start)
    try {
      if (existsSync(BUNDLED_MEMBERS_FILE)) {
        const raw = await readFile(BUNDLED_MEMBERS_FILE, 'utf8');
        const members = JSON.parse(raw);
        // Copy to writable location
        await writeFile(MEMBERS_FILE, JSON.stringify(members, null, 2), 'utf8');
        return members;
      }
    } catch {}

    // Create default admin
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
}

async function saveMembers(members) {
  await ensureDir();
  await writeFile(MEMBERS_FILE, JSON.stringify(members, null, 2), 'utf8');
  // Also save to repo data dir if local
  if (!IS_VERCEL) {
    try {
      await mkdir(join(process.cwd(), 'data'), { recursive: true });
      await writeFile(BUNDLED_MEMBERS_FILE, JSON.stringify(members, null, 2), 'utf8');
    } catch {}
  }
}

// === Sessions ===
async function readSessions() {
  await ensureDir();
  try {
    const raw = await readFile(SESSIONS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    await writeFile(SESSIONS_FILE, '{}', 'utf8');
    return {};
  }
}

async function saveSessions(sessions) {
  await ensureDir();
  await writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
}

// === Auth Functions ===
export async function login(username, password) {
  const members = await readMembers();
  const member = members.find(m => m.username === username);
  if (!member) return { success: false, error: 'ไม่พบชื่อผู้ใช้' };
  if (member.password !== hashPassword(password)) return { success: false, error: 'รหัสผ่านไม่ถูกต้อง' };

  const token = generateToken();
  const sessions = await readSessions();
  sessions[token] = {
    memberId: member.id,
    username: member.username,
    displayName: member.displayName,
    role: member.role,
    avatar: member.avatar,
    loginAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  await saveSessions(sessions);

  member.lastLogin = new Date().toISOString();
  await saveMembers(members);

  return {
    success: true,
    token,
    member: { id: member.id, username: member.username, displayName: member.displayName, role: member.role, avatar: member.avatar },
  };
}

export async function logout(token) {
  const sessions = await readSessions();
  delete sessions[token];
  await saveSessions(sessions);
  return { success: true };
}

export async function getSession(token) {
  if (!token) return null;
  const sessions = await readSessions();
  const session = sessions[token];
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    delete sessions[token];
    await saveSessions(sessions);
    return null;
  }
  return session;
}

export async function register(data) {
  const members = await readMembers();
  if (members.find(m => m.username === data.username)) {
    return { success: false, error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' };
  }

  const newMember = {
    id: `member_${Date.now()}`,
    username: data.username,
    password: hashPassword(data.password),
    displayName: data.displayName || data.username,
    role: data.role || 'editor',
    avatar: data.avatar || '👤',
    createdAt: new Date().toISOString(),
    stats: { totalCreated: 0, totalApproved: 0, totalRejected: 0, totalRevision: 0 },
    lastLogin: null,
  };

  members.push(newMember);
  await saveMembers(members);
  return { success: true, member: { ...newMember, password: undefined } };
}

export async function getMembers() {
  const members = await readMembers();
  return members.map(m => ({ ...m, password: undefined }));
}

export async function updateMember(id, updates) {
  const members = await readMembers();
  const idx = members.findIndex(m => m.id === id);
  if (idx < 0) return { success: false, error: 'ไม่พบสมาชิก' };

  if (updates.password) updates.password = hashPassword(updates.password);
  members[idx] = { ...members[idx], ...updates };
  await saveMembers(members);
  return { success: true, member: { ...members[idx], password: undefined } };
}

export async function deleteMember(id) {
  const members = await readMembers();
  const idx = members.findIndex(m => m.id === id);
  if (idx < 0) return { success: false, error: 'ไม่พบสมาชิก' };
  if (members[idx].role === 'admin' && members.filter(m => m.role === 'admin').length <= 1) {
    return { success: false, error: 'ไม่สามารถลบ admin คนสุดท้าย' };
  }
  members.splice(idx, 1);
  await saveMembers(members);
  return { success: true };
}

export async function updateMemberStats(memberId, field) {
  const members = await readMembers();
  const member = members.find(m => m.id === memberId);
  if (member && member.stats) {
    member.stats[field] = (member.stats[field] || 0) + 1;
    await saveMembers(members);
  }
}

export const PERMISSIONS = {
  admin: ['create', 'submit', 'review', 'approve', 'reject', 'manage_members', 'manage_prompts', 'settings'],
  editor: ['create', 'submit'],
  viewer: ['view'],
};

export function hasPermission(role, action) {
  return PERMISSIONS[role]?.includes(action) || false;
}
