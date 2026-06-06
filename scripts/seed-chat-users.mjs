/**
 * Seed Script — สร้าง user เริ่มต้น + ห้องแชท
 * Run: node scripts/seed-chat-users.mjs
 */
import { createHash, randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local'), override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL or SUPABASE_SERVICE_KEY not found in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Hash password (same as chatAuth.js)
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

// Users to create
const users = [
  // ผู้จัดการ
  { username: 'manager1', password: 'pass1234', display_name: 'ผู้จัดการ 1', role: 'manager', avatar_emoji: '👑' },
  { username: 'manager2', password: 'pass1234', display_name: 'ผู้จัดการ 2', role: 'manager', avatar_emoji: '👑' },
  // พนักงาน (ตัวอย่าง 5 คน)
  { username: 'emp01', password: 'pass1234', display_name: 'สมชาย', role: 'employee', avatar_emoji: '👤' },
  { username: 'emp02', password: 'pass1234', display_name: 'สมหญิง', role: 'employee', avatar_emoji: '👩' },
  { username: 'emp03', password: 'pass1234', display_name: 'สมศักดิ์', role: 'employee', avatar_emoji: '👨' },
  { username: 'emp04', password: 'pass1234', display_name: 'สมใจ', role: 'employee', avatar_emoji: '😊' },
  { username: 'emp05', password: 'pass1234', display_name: 'สมปอง', role: 'employee', avatar_emoji: '🙂' },
];

async function seed() {
  console.log('🌱 Seeding chat users + rooms...\n');

  const createdUsers = [];

  for (const u of users) {
    const passwordHash = hashPassword(u.password);
    
    // Check if user exists
    const { data: existing } = await supabase
      .from('chat_users')
      .select('id, username')
      .eq('username', u.username)
      .maybeSingle();

    if (existing) {
      console.log(`⏭️  ${u.username} (${u.display_name}) — already exists`);
      createdUsers.push({ ...u, id: existing.id });
      continue;
    }

    const { data, error } = await supabase
      .from('chat_users')
      .insert({
        username: u.username,
        password_hash: passwordHash,
        display_name: u.display_name,
        role: u.role,
        avatar_emoji: u.avatar_emoji,
      })
      .select()
      .single();

    if (error) {
      console.error(`❌ ${u.username}: ${error.message}`);
    } else {
      console.log(`✅ ${u.username} (${u.display_name}) — ${u.role} — password: ${u.password}`);
      createdUsers.push({ ...u, id: data.id });
    }
  }

  // Create rooms for employees
  console.log('\n🏠 Creating chat rooms...\n');

  const employees = createdUsers.filter(u => u.role === 'employee');
  for (const emp of employees) {
    const slug = emp.username;
    
    const { data: existing } = await supabase
      .from('chat_rooms')
      .select('id, room_slug')
      .eq('room_slug', slug)
      .maybeSingle();

    if (existing) {
      console.log(`⏭️  ห้อง ${emp.display_name} (${slug}) — already exists`);
      continue;
    }

    const { error } = await supabase
      .from('chat_rooms')
      .insert({
        employee_id: emp.id,
        room_name: `ห้อง ${emp.display_name}`,
        room_slug: slug,
        ai_instructions: '',
        status: 'active',
      });

    if (error) {
      console.error(`❌ Room ${slug}: ${error.message}`);
    } else {
      console.log(`✅ ห้อง ${emp.display_name} — slug: ${slug}`);
    }
  }

  console.log('\n════════════════════════════════════════');
  console.log('🎉 Seed complete!\n');
  console.log('📝 Login credentials:');
  console.log('────────────────────────────────────────');
  console.log('  ผู้จัดการ:');
  console.log('    username: manager1   password: pass1234');
  console.log('    username: manager2   password: pass1234');
  console.log('');
  console.log('  พนักงาน:');
  for (const emp of employees) {
    console.log(`    username: ${emp.username.padEnd(10)} password: ${emp.password}  (${emp.display_name})`);
  }
  console.log('════════════════════════════════════════');
}

seed().catch(console.error);
