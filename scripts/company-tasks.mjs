// ผู้จัดการเฝ้าคิวงานบริษัท — อ่าน/ปิดงานที่สั่งจากแชทออนไลน์ (store_items store_name=company_tasks)
// ใช้: node scripts/company-tasks.mjs list           → พิมพ์งาน pending (JSON)
//      node scripts/company-tasks.mjs claim <id>     → ตั้ง running
//      node scripts/company-tasks.mjs done <id> "ผล" → ปิดงาน + ผล
//      node scripts/company-tasks.mjs fail <id> "เหตุ"→ งานล้ม
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// โหลด .env.local เอง (ชื่อ/ค่าไม่พิมพ์ออก)
function loadEnv() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error('MISSING Supabase env (.env.local)'); process.exit(2); }
const sb = createClient(URL, KEY);
const TABLE = 'store_items', STORE = 'company_tasks';

async function list() {
  const { data, error } = await sb.from(TABLE).select('data').eq('store_name', STORE).order('created_at', { ascending: true }).limit(50);
  if (error) { console.error('ERR', error.message); process.exit(1); }
  const pending = (data || []).map(r => r.data).filter(t => t && t.status === 'pending');
  console.log(JSON.stringify(pending, null, 2));
}
async function setStatus(id, status, result) {
  const { data, error } = await sb.from(TABLE).select('data').eq('store_name', STORE).eq('id', id).single();
  if (error || !data) { console.error('ไม่พบงาน', id, error && error.message); process.exit(1); }
  const rec = Object.assign({}, data.data, { status, result: result || data.data.result || '', doneAt: new Date().toISOString() });
  const up = await sb.from(TABLE).update({ data: rec, updated_at: new Date().toISOString() }).eq('store_name', STORE).eq('id', id);
  if (up.error) { console.error('ERR', up.error.message); process.exit(1); }
  console.log('OK', id, '→', status);
}

const [cmd, id, ...rest] = process.argv.slice(2);
const text = rest.join(' ');
if (cmd === 'list') list();
else if (cmd === 'claim') setStatus(id, 'running', '');
else if (cmd === 'done') setStatus(id, 'done', text);
else if (cmd === 'fail') setStatus(id, 'failed', text);
else { console.error('ใช้: list | claim <id> | done <id> "ผล" | fail <id> "เหตุ"'); process.exit(2); }
