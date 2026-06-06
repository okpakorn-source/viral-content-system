/**
 * Import Viral Library → Chat System viral_examples table
 * 
 * ดึงเนื้อหาไวรัล 171 ชิ้นจาก data/viral-library.json
 * จัดหมวด + ติดป้ายกำกับชัดเจน → ใส่ viral_examples table
 * เพื่อให้ AI Chat ใช้อ้างอิงเปรียบเทียบกับข่าวที่พนักงานส่งมา
 * 
 * Run: node scripts/import-viral-to-chat.mjs
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.local'), override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// =============================================
// สร้าง label ภาษาไทยที่ชัดเจนจาก analysis
// =============================================
function createLabel(item) {
  const analysis = item.analysis || {};
  const prompt = item.generatedPrompt || {};
  
  const category = analysis.category || analysis.dna_type || prompt.category || 'ทั่วไป';
  const subType = analysis.sub_type || '';
  const archetype = prompt.narrativeArchetype || analysis.stop_scrolling_hook?.hook_type || '';
  
  // สร้างป้ายกำกับที่ใช้งานง่าย
  let label = category;
  if (subType) label += ` — ${subType}`;
  if (archetype && !label.includes(archetype)) label += ` (${archetype})`;
  
  return label;
}

// =============================================
// สรุปจุดเด่นของเนื้อหา (ทำไมถึง viral)
// =============================================
function createWritingNotes(item) {
  const analysis = item.analysis || {};
  const prompt = item.generatedPrompt || {};
  
  const parts = [];
  
  // ทำไมถึง viral
  if (analysis.why_viral) {
    parts.push(`🔥 ทำไมถึง viral: ${analysis.why_viral}`);
  }
  
  // Hook
  const hook = analysis.stop_scrolling_hook;
  if (hook) {
    if (hook.hook_sentence) parts.push(`🎣 Hook: "${hook.hook_sentence}"`);
    if (hook.hook_technique) parts.push(`📌 เทคนิค hook: ${hook.hook_technique}`);
  }
  
  // อารมณ์หลัก
  const emotion = analysis.emotional_core;
  if (emotion) {
    if (emotion.primary_emotion) parts.push(`💗 อารมณ์หลัก: ${emotion.primary_emotion}`);
    if (emotion.why_this_emotion) parts.push(`💡 ทำไมใช้อารมณ์นี้: ${emotion.why_this_emotion}`);
  }
  
  // Share trigger
  const share = analysis.share_triggers;
  if (share) {
    if (share.main_reason) parts.push(`🔄 ทำไมคนแชร์: ${share.main_reason}`);
  }
  
  // โครงสร้างเรื่อง
  const structure = analysis.story_structure;
  if (structure) {
    if (structure.opening) parts.push(`📖 เปิดเรื่อง: ${structure.opening}`);
    if (structure.peak_moment) parts.push(`⚡ จุดพีค: ${structure.peak_moment}`);
    if (structure.ending) parts.push(`🔚 ปิดเรื่อง: ${structure.ending}`);
  }
  
  // สิ่งที่ต้องทำ / ห้ามทำ
  if (prompt.doNot && prompt.doNot.length > 0) {
    parts.push(`⛔ ห้ามทำ: ${prompt.doNot.slice(0, 3).join(' | ')}`);
  }
  
  // Key takeaways
  if (analysis.key_takeaways && analysis.key_takeaways.length > 0) {
    parts.push(`✅ บทเรียน: ${analysis.key_takeaways.slice(0, 3).join(' | ')}`);
  }
  
  // ภาษา
  const lang = analysis.language_analysis;
  if (lang) {
    if (lang.language_style) parts.push(`🗣️ สไตล์ภาษา: ${lang.language_style}`);
  }
  
  return parts.join('\n');
}

// =============================================
// Main import
// =============================================
async function main() {
  console.log('📥 Loading viral-library.json...');
  
  const raw = readFileSync(resolve(__dirname, '../data/viral-library.json'), 'utf-8');
  const viralData = JSON.parse(raw);
  
  // viral-library.json อาจเป็น { items: [...] } หรือ array ตรง
  let items = Array.isArray(viralData) ? viralData : (viralData.items || viralData.data || []);
  
  console.log(`📊 Total items: ${items.length}`);
  
  // กรองเฉพาะที่ analyzed แล้ว
  const analyzedItems = items.filter(item => 
    item.status === 'prompted' || item.status === 'analyzed'
  );
  
  console.log(`✅ Analyzed/Prompted: ${analyzedItems.length}`);
  console.log(`⏭️  Raw (skip): ${items.length - analyzedItems.length}`);
  
  // ลบข้อมูลเก่า (ถ้ามี)
  console.log('\n🗑️  Clearing old viral_examples...');
  await supabase.from('viral_examples').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  
  // Import ทีละ batch (10 ชิ้น)
  let imported = 0;
  let failed = 0;
  const batchSize = 10;
  const categoryCounts = {};
  
  for (let i = 0; i < analyzedItems.length; i += batchSize) {
    const batch = analyzedItems.slice(i, i + batchSize);
    
    const records = batch.map((item, idx) => {
      const analysis = item.analysis || {};
      const prompt = item.generatedPrompt || {};
      const globalIndex = i + idx + 1;
      
      const category = analysis.category || analysis.dna_type || prompt.category || 'ทั่วไป';
      const label = createLabel(item);
      const writingNotes = createWritingNotes(item);
      
      // นับหมวด
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      
      // ตัดเนื้อหาให้ไม่ยาวเกิน (เก็บ 3000 ตัวอักษรแรก)
      const contentText = (item.content || '').substring(0, 3000);
      
      // สร้าง title ที่ชัดเจน
      const titlePrefix = `#${String(globalIndex).padStart(3, '0')}`;
      const shortTitle = (item.title || contentText.substring(0, 50)).replace(/\n/g, ' ').trim();
      const fullTitle = `${titlePrefix} [${label}] ${shortTitle}`;
      
      // Tags JSONB
      const tags = {
        index: globalIndex,
        originalId: item.id,
        label: label,
        category: category,
        dna_type: analysis.dna_type || '',
        sub_type: analysis.sub_type || '',
        narrative_archetype: prompt.narrativeArchetype || '',
        emotional_tags: prompt.emotionalTags || analysis.emotional_core?.emotional_patterns || [],
        conflict_tags: prompt.conflictTags || [],
        hook_style: prompt.hookStyle || analysis.stop_scrolling_hook?.hook_type || '',
        tone: prompt.tone || '',
        viral_score: analysis.viral_score || prompt.viralScore || 0,
        writing_style: prompt.writingStyle || '',
        target_categories: prompt.targetCategories || [category],
        primary_emotion: analysis.emotional_core?.primary_emotion || '',
        share_reason: analysis.share_triggers?.main_reason || '',
        example_hooks: prompt.exampleHooks || [],
      };
      
      return {
        category: category,
        title: fullTitle.substring(0, 500),
        content: contentText,
        source_url: null,
        engagement_likes: analysis.viral_scores?.overall ? Math.round(analysis.viral_scores.overall * 100) : 0,
        engagement_shares: analysis.viral_scores?.share_potential ? Math.round(analysis.viral_scores.share_potential * 100) : 0,
        engagement_comments: analysis.viral_scores?.comment_potential ? Math.round(analysis.viral_scores.comment_potential * 100) : 0,
        tags: tags,
        writing_notes: writingNotes,
      };
    });
    
    const { error } = await supabase.from('viral_examples').insert(records);
    
    if (error) {
      console.error(`❌ Batch ${Math.floor(i/batchSize) + 1} error:`, error.message);
      failed += batch.length;
    } else {
      imported += batch.length;
      const pct = Math.round((imported / analyzedItems.length) * 100);
      process.stdout.write(`\r📦 Imported: ${imported}/${analyzedItems.length} (${pct}%)`);
    }
  }
  
  console.log('\n');
  console.log('════════════════════════════════════════');
  console.log(`🎉 Import complete!`);
  console.log(`✅ Imported: ${imported}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('');
  console.log('📊 Categories breakdown:');
  console.log('────────────────────────────────────────');
  
  // Sort by count
  const sorted = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sorted) {
    console.log(`  ${cat.padEnd(25)} ${count} ชิ้น`);
  }
  
  console.log('════════════════════════════════════════');
  
  // Verify
  const { count } = await supabase
    .from('viral_examples')
    .select('*', { count: 'exact', head: true });
  
  console.log(`\n📊 Verify: ${count} records in viral_examples table`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
