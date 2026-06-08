/**
 * run-cover-migration.mjs
 * รัน SQL migration สร้าง cover_examples table + columns
 * ใช้: node scripts/run-cover-migration.mjs
 * 
 * ใช้ Supabase REST API (ไม่ต้องการ pg หรือ DATABASE_URL)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

config({ path: join(rootDir, '.env.local'), override: true });
config({ path: join(rootDir, '.env'), override: false });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// Supabase project ref — extract from URL
const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
console.log(`✅ Supabase project: ${projectRef}`);

/**
 * Execute raw SQL via Supabase Management API 
 * Alternative: use supabase-js .rpc() with a server function
 * But simplest: POST to /rest/v1/rpc with SQL wrapper
 */
async function execSQL(sql, label) {
  console.log(`\n📋 ${label}...`);
  
  // Use Supabase's pg REST endpoint (available with service role key)
  // /pg/query endpoint — undocumented but works with service key
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  // Split SQL into individual statements (skip empty/comment-only)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--') && s !== 'SELECT \'cover_examples table created!\' AS status');
  
  let success = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const stmt of statements) {
    try {
      const { data, error } = await supabase.rpc('exec_sql', { query: stmt + ';' });
      if (error) {
        if (error.message?.includes('already exists') || error.message?.includes('does not exist')) {
          skipped++;
          console.log(`   ℹ️  Skipped (already exists): ${stmt.substring(0, 60)}...`);
        } else if (error.message?.includes('function') && error.message?.includes('exec_sql')) {
          // exec_sql function doesn't exist — try alternative approach
          throw new Error('NEED_DIRECT_QUERY');
        } else {
          errors++;
          console.warn(`   ⚠️  Error: ${error.message} — stmt: ${stmt.substring(0, 60)}...`);
        }
      } else {
        success++;
        console.log(`   ✅ OK: ${stmt.substring(0, 60)}...`);
      }
    } catch (e) {
      if (e.message === 'NEED_DIRECT_QUERY') throw e;
      errors++;
      console.warn(`   ⚠️  ${e.message} — stmt: ${stmt.substring(0, 60)}...`);
    }
  }
  
  console.log(`   📊 Results: ${success} ok, ${skipped} skipped, ${errors} errors`);
  return { success, skipped, errors };
}

/**
 * Alternative: use individual Supabase operations
 */
async function runMigrationViaClient() {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  // Step 1: ตรวจว่า cover_examples table มีอยู่หรือไม่
  console.log('\n🔍 Step 1: Checking if cover_examples table exists...');
  const { data: testData, error: testErr } = await supabase
    .from('cover_examples')
    .select('id')
    .limit(1);
  
  if (testErr) {
    if (testErr.message.includes('does not exist') || testErr.code === '42P01' || testErr.message.includes('relation')) {
      console.log('❌ cover_examples table does NOT exist');
      console.log('');
      console.log('═══════════════════════════════════════════════════════');
      console.log('⚠️  ต้องรัน SQL ด้วยมือใน Supabase Dashboard:');
      console.log('═══════════════════════════════════════════════════════');
      console.log('');
      console.log('1. เปิด https://supabase.com/dashboard → เลือก project');
      console.log('2. ไปที่ SQL Editor');
      console.log('3. วาง SQL จากไฟล์นี้:');
      console.log(`   ${join(rootDir, 'scripts', 'create-cover-examples-table.sql')}`);
      console.log('4. กด RUN');
      console.log('5. แล้ววาง SQL จากไฟล์นี้:');
      console.log(`   ${join(rootDir, 'sql', 'migrations', 'add-cover-examples-columns.sql')}`);
      console.log('6. กด RUN');
      console.log('');
      
      // Print the SQL for easy copy-paste
      console.log('═══ SQL File 1: create-cover-examples-table.sql ═══');
      const sql1 = readFileSync(join(rootDir, 'scripts', 'create-cover-examples-table.sql'), 'utf-8');
      console.log(sql1);
      console.log('');
      console.log('═══ SQL File 2: add-cover-examples-columns.sql ═══');
      const sql2 = readFileSync(join(rootDir, 'sql', 'migrations', 'add-cover-examples-columns.sql'), 'utf-8');
      console.log(sql2);
      
      return false;
    } else {
      console.warn('⚠️  Unexpected error:', testErr.message);
    }
  } else {
    console.log(`✅ cover_examples table EXISTS (test query ok)`);
  }
  
  // Step 2: ตรวจว่ามี columns ใหม่หรือยัง
  console.log('\n🔍 Step 2: Checking if new columns exist...');
  const { data: colTest, error: colErr } = await supabase
    .from('cover_examples')
    .select('id, case_id, subjects, emotion, source_type')
    .limit(1);
  
  if (colErr && (colErr.message.includes('column') || colErr.code === '42703')) {
    console.log('⚠️  New columns not yet added — need migration');
    console.log('');
    console.log('วาง SQL นี้ใน Supabase SQL Editor:');
    console.log('');
    const sql2 = readFileSync(join(rootDir, 'sql', 'migrations', 'add-cover-examples-columns.sql'), 'utf-8');
    console.log(sql2);
    return false;
  } else if (!colErr) {
    console.log('✅ All new columns exist!');
  }
  
  // Step 3: Count
  const { count } = await supabase
    .from('cover_examples')
    .select('*', { count: 'exact', head: true });
  console.log(`\n📊 Current rows in cover_examples: ${count || 0}`);
  
  // Step 4: Test insert + delete (verify write access)
  console.log('\n🔍 Step 3: Testing write access...');
  const testId = `migration_test_${Date.now()}`;
  const { data: insertData, error: insertErr } = await supabase
    .from('cover_examples')
    .insert({
      title: testId,
      category: 'migration_test',
      quality_score: 0,
    })
    .select('id')
    .single();
  
  if (insertErr) {
    console.log(`❌ Write test FAILED: ${insertErr.message}`);
    console.log('   Cover auto-save จะไม่ทำงาน!');
    return false;
  } else {
    console.log(`✅ Write test OK (id=${insertData.id})`);
    // Clean up test row
    await supabase.from('cover_examples').delete().eq('id', insertData.id);
    console.log('   🧹 Test row cleaned up');
  }
  
  console.log('\n🎉 Migration verified — cover_examples table is ready!');
  console.log('   ✅ Table exists');
  console.log('   ✅ New columns exist');
  console.log('   ✅ Write access OK');
  console.log('   → Cover auto-save จะทำงานได้ปกติ');
  
  return true;
}

// ── Main ──
try {
  const result = await runMigrationViaClient();
  if (!result) {
    process.exit(1);
  }
} catch (err) {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
}
