/**
 * ★ Trend Tracker (16 มิ.ย. 69) — ระบบ "ติดตามกระแส"
 * ทีมใส่กระแสวันนี้ (เช่น "ตินติน ฟรีด้า") → AI วิเคราะห์ตัวละคร/คนเกี่ยวข้อง + สร้างคีย์เวิร์ดทุกแง่มุม
 * → harvester ค้นทุกแหล่ง (ข่าว/เว็บ/ยูทูป/เพจ/รีลส์) มารวมในเลน 'trend-track'
 */
import { callAI } from '@/lib/ai/openai';
import { MODEL_FAST } from '@/lib/ai/modelConfig';

/**
 * วิเคราะห์กระแส → ตัวละคร + คีย์เวิร์ดค้นหา
 * @param {string} topic - กระแสที่ทีมใส่
 * @returns {Promise<{keywords:string[], people:string[]}>}
 */
export async function analyzeTrendKeywords(topic) {
  const t = String(topic || '').trim().slice(0, 120);
  const fallback = { keywords: [t, `${t} ล่าสุด`, `${t} ดราม่า`, `${t} คลิป ไวรัล`].filter(x => x.length >= 3), people: [] };
  if (!t) return { keywords: [], people: [] };

  const prompt = `วันนี้มีกระแส/ข่าวดังในไทย: "${t}"
หน้าที่: วิเคราะห์ว่ามี "ตัวละคร/บุคคล" ใครเกี่ยวข้องในกระแสนี้บ้าง แล้วสร้าง "คีย์เวิร์ดค้นหาภาษาไทย" ที่จะไปเจอข่าว/คลิป/โพสต์เกี่ยวกับกระแสนี้ทุกแง่มุม

กติกา:
- รวม: ชื่อบุคคลหลัก + คู่กรณี/คนที่เอี่ยว + ประเด็นที่พูดถึง + คำที่ชาวเน็ตใช้เรียกกระแสนี้
- คีย์เวิร์ดละ 2-5 คำ กระชับ ค้นแล้วเจอจริง (อย่ายาวเกิน อย่าใส่เครื่องหมาย)
- ถ้าชื่อสะกดได้หลายแบบ ใส่แบบที่นิยมสุด
- เน้นภาษาไทย (เพจ/สื่อไทยใช้)

ตอบ JSON เท่านั้น: {"people":["ชื่อคนที่เกี่ยวข้อง"],"keywords":["คำค้น1","คำค้น2",...]} รวมคีย์เวิร์ด 6-8 คำ`;

  try {
    const res = await callAI({ model: MODEL_FAST, temperature: 0.4, maxTokens: 800, prompt });
    const parsed = typeof res === 'object' ? res : JSON.parse(String(res).match(/\{[\s\S]*\}/)?.[0] || '{}');
    let keywords = (parsed.keywords || []).map(k => String(k).replace(/["“”']/g, '').trim()).filter(k => k.length >= 3 && k.length <= 45);
    const people = (parsed.people || []).map(p => String(p).trim()).filter(Boolean).slice(0, 8);
    // เติมหัวข้อต้นเป็นคีย์เวิร์ดเสมอ (กัน AI หลุดประเด็น) + ตัดซ้ำ
    keywords = [...new Set([t, ...keywords])].slice(0, 8);
    if (keywords.length < 2) return fallback;
    return { keywords, people };
  } catch (e) {
    console.log('[TrendTracker] วิเคราะห์ล่ม ใช้ fallback:', e.message?.slice(0, 50));
    return fallback;
  }
}
