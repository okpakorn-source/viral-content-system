/**
 * ★ News Hunt Service (8 ก.ค. 69) — สมอง "วิจัยลิงก์ข่าว → หาข่าวเสริม"
 * ─────────────────────────────────────────────────────────────────────────────
 * คู่ขนานกับ topicHuntService (คลิป) แต่รับ "ลิงก์ข่าวเว็บ" แทนคลิป:
 *  1) analyzeArticle(article) — วิจัย "เชิงลึก": แก่นข่าว + ข้อเท็จจริงสำคัญ + ทำไมยูสเซอร์เลือก/กินใจ
 *     → คีย์ค้น 2 กลุ่ม (follow=ตามต่อเรื่องนี้ · theme=ธีมเดียวกันเรื่องใหม่)
 *  2) reuse searchSimilar + judgeResults จาก topicHuntService (ไม่ทำซ้ำ)
 * ผลลัพธ์ทรงเดียวกับ runTopicHunt (คลัง user-topic-hunts ใช้ร่วม) แต่ sourceType='article'
 * 🔴 แยกเดี่ยว — ไม่แตะโต๊ะข่าวกลาง/เวิร์กโฟลว์ข่าว
 */
import { callAI } from '@/lib/ai/openai';
import { MODEL_NEWS_ANALYSIS } from '@/lib/ai/modelConfig';
import { searchSimilar, judgeResults } from '@/lib/services/topicHuntService';

// ── 1) วิจัยข่าวเชิงลึก → โปรไฟล์สไตล์ + คีย์ค้น ──
export async function analyzeArticle({ title, text, url }) {
  const body = String(text || '').trim();
  if (body.length < 120) throw new Error('เนื้อข่าวสั้นเกินไป — เว็บอาจโหลดไม่ครบ ลองก๊อบเนื้อข่าวมาวางแทน');
  const prompt = `คุณเป็นบรรณาธิการเพจข่าวไวรัลไทยน้ำดี (ถนัด: คนตัวเล็ก น้ำใจ สู้ชีวิต กตัญญู ดราม่ากินใจ เรื่องที่คนแชร์)
ทีมเจอ "ข่าวนี้ดี" เลยเอาลิงก์มาให้วิจัยเชิงลึก + หาข่าวแนวเดียวกันมาเสริม

หัวข้อ: ${String(title || '').slice(0, 200)}
=== เนื้อข่าว ===
${body.slice(0, 8000)}
=== จบ ===

หน้าที่ (วิจัย "อย่างละเอียด"):
1. สรุปแก่นข่าว: ใคร ทำอะไร ที่ไหน เมื่อไหร่ ผลเป็นอย่างไร (ข้อเท็จจริงล้วน 3-6 บรรทัด)
2. ข้อเท็จจริงสำคัญ (keyFacts) 3-6 ข้อ — ตัวเลข/ชื่อ/เหตุการณ์เด่นที่หยิบไปเขียนต่อได้
3. ทำไมข่าวนี้ "ดี/น่าเอามาทำ" (whyGood) — จุดกินใจ/แง่มุมที่คนแชร์ 1-2 ประโยค
4. วิเคราะห์สไตล์: ธีมหลัก (สั้น เจาะจง) + อารมณ์เด่น + ทำไมไวรัล
5. คีย์ค้น 2 กลุ่ม:
   • followKeys (2-4) = ตามต่อ "เรื่องนี้เหตุการณ์นี้" (ชื่อคน/ฉายา + เหตุการณ์)
   • themeKeys (4-6) = หา "เรื่องใหม่ธีมเดียวกัน" — ⛔ ห้ามคำลอยๆ ต้องเจาะ อาชีพ/สถานการณ์/บุคคล+อารมณ์
   • คีย์ภาษาไทย สั้น 2-6 คำ ค้น Google ได้จริง

ตอบ JSON เท่านั้น:
{"summary":"แก่นข่าว 3-6 บรรทัด","keyFacts":["..."],"whyGood":"ทำไมข่าวนี้ดี/น่าทำ",
"category":"หมวด: บันเทิง/ดารา|กีฬา|สังคม/ชีวิตคน|น้ำใจ/ทำดี|ไลฟ์สไตล์/ไวรัล|การเมือง|อาชญากรรม/คดี|เศรษฐกิจ/ธุรกิจ|อื่นๆ",
"theme":"ธีมหลัก","emotion":"อารมณ์เด่น","whyViral":"ทำไมคนแชร์ 1 ประโยค",
"entities":["ชื่อคน/สถานที่สำคัญ"],"followKeys":["..."],"themeKeys":["..."]}`;
  const r = await callAI({ prompt, model: MODEL_NEWS_ANALYSIS, temperature: 0.3, maxTokens: 2500 });
  const p = typeof r === 'object' ? r : JSON.parse(String(r).match(/\{[\s\S]*\}/)?.[0] || '{}');
  const arr = (a, n) => Array.isArray(a) ? a.slice(0, n).map(x => String(x).slice(0, 200)).filter(Boolean) : [];
  const profile = {
    theme: String(p.theme || '').slice(0, 100),
    emotion: String(p.emotion || '').slice(0, 60),
    whyViral: String(p.whyViral || '').slice(0, 200),
    entities: arr(p.entities, 6).map(x => x.slice(0, 60)),
    followKeys: arr(p.followKeys, 4).map(x => x.slice(0, 60)),
    themeKeys: arr(p.themeKeys, 6).map(x => x.slice(0, 60)),
  };
  if (!profile.followKeys.length && !profile.themeKeys.length) throw new Error('สมองวิจัยข่าวสร้างคีย์ค้นไม่สำเร็จ — ลองใหม่อีกครั้ง');
  // ★ ประกอบ "ผลวิจัยเชิงลึก" เป็นข้อความเดียว — เก็บใน insight.rawData เพื่อให้การ์ดคลัง (renderHuntCase) แสดงร่วมได้
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

/** ★ เดินเรื่องครบวงจร: article (ดึงมาแล้ว) → วิจัย → ค้น → คัด — ทรงเดียวกับ runTopicHunt */
export async function runNewsHunt({ url, article, user = '' }) {
  console.log(`[NewsHunt] 📰 เริ่ม: ${String(article.title || url).slice(0, 60)}`);
  const { profile, insight } = await analyzeArticle({ ...article, url });
  console.log(`[NewsHunt] คีย์: follow=${profile.followKeys.length} theme=${profile.themeKeys.length} — เริ่มค้น`);
  const { results, queriesUsed } = await searchSimilar(profile);
  const norm = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  const srcKey = norm(url);
  const candidates = results.filter(r => norm(r.url) !== srcKey);
  console.log(`[NewsHunt] ค้นได้ ${candidates.length} เรื่อง (จาก ${queriesUsed} คิวรี) — ส่งกรรมการคัด`);
  const kept = await judgeResults(candidates, profile, insight.headline || '');
  console.log(`[NewsHunt] ✅ ผ่านคัด ${kept.length} เรื่อง`);
  return {
    sourceUrl: url,
    sourceType: 'article',            // ★ แยกจากคลิป (คลังร่วม — ป้ายในการ์ดใช้ค่านี้)
    title: String(article.title || url).slice(0, 140),
    insight,
    styleProfile: profile,
    searchKeys: [...profile.followKeys, ...profile.themeKeys],
    results: kept,
    stats: { queriesUsed, found: candidates.length, kept: kept.length },
    user: String(user || '').slice(0, 40),
  };
}
