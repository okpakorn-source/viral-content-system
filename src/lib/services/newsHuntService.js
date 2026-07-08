/**
 * ★ News Hunt Service (8 ก.ค. 69 · rev.2 "DNA discovery") — สมอง "วิจัยลิงก์ข่าว → หาข่าวแนวเดียวกันคนละคน"
 * ─────────────────────────────────────────────────────────────────────────────
 * คู่ขนานกับ topicHuntService (คลิป) แต่รับ "ลิงก์ข่าวเว็บ":
 *  1) analyzeArticle(article) — วิจัยเชิงลึก (แก่น+ข้อเท็จจริง+ทำไมดี) + สกัด DNA แนวข่าว
 *     → คีย์ค้น 3 ระดับ (ใกล้/กลาง/กว้าง) คนละคน + รายชื่อคนต้นทาง (กันคนเดิม)
 *  2) reuse searchSimilar + judgeResults จาก topicHuntService (ตรรกะ DNA เดียวกัน)
 * ผลลัพธ์ทรงเดียวกับ runTopicHunt (คลัง user-topic-hunts ใช้ร่วม) แต่ sourceType='article'
 * 🔴 แยกเดี่ยว — ไม่แตะโต๊ะข่าวกลาง/เวิร์กโฟลว์ข่าว
 */
import { callAI } from '@/lib/ai/openai';
import { MODEL_NEWS_ANALYSIS } from '@/lib/ai/modelConfig';
import { searchSimilar, judgeResults, normalizeProfile } from '@/lib/services/topicHuntService';

// ── 1) วิจัยข่าวเชิงลึก + สกัด DNA → โปรไฟล์ค้น (ทรงเดียวกับ topicHuntService) ──
export async function analyzeArticle({ title, text, url }) {
  const body = String(text || '').trim();
  if (body.length < 120) throw new Error('เนื้อข่าวสั้นเกินไป — เว็บอาจโหลดไม่ครบ ลองก๊อบเนื้อข่าวมาวางแทน');
  const prompt = `คุณเป็นบรรณาธิการเพจข่าวไวรัลไทยน้ำดี ทีมเจอ "ข่าวนี้ดี" เลยเอาลิงก์มาให้วิจัยเชิงลึก
🎯 เป้าหมาย: วิจัย DNA แนวข่าว แล้วเอาไปหา "ข่าวแนวเดียวกันแต่คนละคน/คนละเคส" (⛔ ไม่ใช่หาข่าวคนเดิม)

หัวข้อ: ${String(title || '').slice(0, 200)}
=== เนื้อข่าว ===
${body.slice(0, 8000)}
=== จบ ===

หน้าที่:
A) วิจัยเชิงลึก:
   1. สรุปแก่นข่าว: ใคร ทำอะไร ที่ไหน เมื่อไหร่ ผลอย่างไร (ข้อเท็จจริงล้วน 3-6 บรรทัด)
   2. keyFacts 3-6 ข้อ — ตัวเลข/ชื่อ/เหตุการณ์เด่นที่หยิบไปเขียนต่อได้
   3. whyGood — ทำไมข่าวนี้ดี/กินใจ/คนแชร์ 1-2 ประโยค
B) สกัด DNA แนวข่าว 4 มิติ (สั้น): who=ประเภทตัวละคร · what=การกระทำ/แก่น · core=แกน/กลุ่มเป้าหมาย/สิ่งของ · emotion=อารมณ์
C) sourceEntities = ชื่อคน/ฉายา/เพจหลัก "ในข่าวนี้" (กันไม่ให้ระบบเอาข่าวคนเดิมมา)
D) คีย์ค้น 3 ระดับ — ทุกคีย์ "คนละคน" ⛔ ห้ามใส่ชื่อคนต้นทาง:
   • keysL1 (ใกล้สุด 4-5 คีย์): who+what+core เดียวกัน คนละคน
   • keysL2 (กลาง 5-6 คีย์): who+what เดียวกัน core อื่น
   • keysL3 (กว้าง 5-6 คีย์): who+emotion เดียวกัน
   • ⭐ แต่ละคีย์ในระดับเดียวกัน "มุมต่างกัน" (คนละคำ/สำนวน/แง่) ให้เจอเรื่องหลากหลาย ไม่ซ้ำ
   • คีย์ไทย สั้น 2-6 คำ ค้น Google ได้จริง

ตอบ JSON เท่านั้น:
{"summary":"แก่นข่าว","keyFacts":["..."],"whyGood":"...",
"category":"บันเทิง/ดารา|กีฬา|สังคม/ชีวิตคน|น้ำใจ/ทำดี|ไลฟ์สไตล์/ไวรัล|การเมือง|อาชญากรรม/คดี|เศรษฐกิจ/ธุรกิจ|อื่นๆ",
"dna":{"who":"","what":"","core":"","emotion":""},"theme":"แนวข่าว 1 วลี","whyViral":"ทำไมคนแชร์",
"sourceEntities":["ชื่อคน/ฉายา/เพจในข่าวนี้"],"keysL1":["..."],"keysL2":["..."],"keysL3":["..."]}`;
  const r = await callAI({ prompt, model: MODEL_NEWS_ANALYSIS, temperature: 0.35, maxTokens: 3200 });
  const p = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
  const profile = normalizeProfile(p); // ★ ใช้ตัวประกอบโปรไฟล์ร่วมกับสมองคลิป (ทรง DNA เดียวกัน)
  const research = [
    String(p.summary || '').trim(),
    Array.isArray(p.keyFacts) && p.keyFacts.length ? '\nข้อเท็จจริงสำคัญ:\n' + p.keyFacts.slice(0, 6).map(f => `• ${String(f).slice(0, 300)}`).join('\n') : '',
    p.whyGood ? `\nทำไมข่าวนี้ดี/น่าทำ: ${String(p.whyGood).slice(0, 400)}` : '',
  ].filter(Boolean).join('\n');
  return {
    profile,
    insight: { rawData: research.slice(0, 6000), category: String(p.category || 'อื่นๆ').replace(/^หมวด\s*[:：]\s*/, '').slice(0, 30), headline: String(title || '').slice(0, 200) },
  };
}

/** ★ เดินเรื่องครบวงจร: article (ดึงมาแล้ว) → วิจัย+DNA → ค้น → คัด — ทรงเดียวกับ runTopicHunt */
export async function runNewsHunt({ url, article, user = '' }) {
  console.log(`[NewsHunt] 📰 เริ่ม: ${String(article.title || url).slice(0, 60)}`);
  const { profile, insight } = await analyzeArticle({ ...article, url });
  console.log(`[NewsHunt] DNA: ${profile.dna.who}/${profile.dna.what}/${profile.dna.core} · คีย์ L1=${profile.keysL1.length} L2=${profile.keysL2.length} L3=${profile.keysL3.length}`);
  const { results, queriesUsed } = await searchSimilar(profile);
  const norm = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  const srcKey = norm(url);
  const candidates = results.filter(r => norm(r.url) !== srcKey);
  console.log(`[NewsHunt] ค้นได้ ${candidates.length} เรื่อง (จาก ${queriesUsed} คิวรี) — ส่งกรรมการคัด`);
  const kept = await judgeResults(candidates, profile, insight.headline || '');
  const nDiff = kept.filter(k => k.tag === 'dna').length;
  console.log(`[NewsHunt] ✅ ผ่านคัด ${kept.length} (คนละคน ${nDiff} · คนเดิม ${kept.length - nDiff})`);
  return {
    sourceUrl: url,
    sourceType: 'article',
    title: String(article.title || url).slice(0, 140),
    insight,
    styleProfile: profile,
    searchKeys: [...profile.keysL1, ...profile.keysL2, ...profile.keysL3],
    results: kept,
    stats: { queriesUsed, found: candidates.length, kept: kept.length, diff: nDiff },
    user: String(user || '').slice(0, 40),
  };
}
