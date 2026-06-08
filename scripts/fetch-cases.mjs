import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { writeFileSync } from 'fs';
dotenv.config({ path: '.env.local' });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ดึง job_queue ที่ completed ล่าสุด 3 งาน — ดู content ทุก version เต็มๆ
const { data: jobs } = await sb.from('store_items')
  .select('data')
  .eq('store_name', 'job_queue')
  .order('created_at', { ascending: false })
  .limit(5);

let totalVersions = [];

for (const job of (jobs || [])) {
  const d = job.data;
  if (d.status !== 'completed' || !d.result) continue;
  
  const r = d.result;
  const versions = r.analysisResult?.versions || r.data?.analysisResult?.versions || r.versions || [];
  if (versions.length === 0) continue;
  
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`JOB: ${d.id} | Status: ${d.status} | ${d.createdAt}`);
  console.log(`News Title: ${r.newsData?.newsTitle || r.data?.newsData?.newsTitle || '-'}`);
  console.log(`Versions: ${versions.length}`);
  
  versions.forEach((v, i) => {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`VERSION ${i+1} | Style: ${v.style} | Tone: ${v.tone} | Source: ${v._source || '-'}`);
    console.log(`Title: ${v.title}`);
    console.log(`\nHOOK:\n${v.hook || '(no hook)'}`);
    console.log(`\nCONTENT:\n${v.content}`);
    console.log(`\nCLOSING:\n${v.closing || '(no closing)'}`);
    totalVersions.push(v);
  });
}

writeFileSync('data/latest-versions.json', JSON.stringify(totalVersions, null, 2), 'utf-8');
console.log(`\n\n✅ Total: ${totalVersions.length} versions saved`);
