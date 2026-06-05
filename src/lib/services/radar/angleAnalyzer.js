/**
 * angleAnalyzer.js — วิเคราะห์มุมมองข่าวสำหรับทำคอนเทนต์ไวรัล
 * [Radar-AngleAnalyzer]
 * ใช้ AI (gpt-4o-mini) วิเคราะห์และเสนอ angles + fallback rule-based
 */

import { callAI } from '@/lib/ai/openai';

// === คำสำคัญสำหรับ rule-based fallback ===
const ANGLE_KEYWORDS = {
  'ข่าวน้ำดี': ['ช่วยเหลือ', 'บริจาค', 'น้ำใจ', 'ประทับใจ', 'ดีใจ', 'สำเร็จ', 'กตัญญู', 'อบอุ่น', 'ชื่นชม'],
  'ข่าวดราม่า': ['ดราม่า', 'เดือด', 'โกรธ', 'สุดทน', 'ไม่ยอม', 'ทะเลาะ', 'ขัดแย้ง', 'แฉ'],
  'ข่าวครอบครัว': ['พ่อ', 'แม่', 'ลูก', 'ครอบครัว', 'ลูกชาย', 'ลูกสาว', 'สามี', 'ภรรยา'],
  'ข่าวเปิดใจ': ['เปิดใจ', 'สารภาพ', 'เล่า', 'เผย', 'ยอมรับ', 'หลังจาก', 'ครั้งแรก'],
  'ข่าวย้อนแย้ง': ['แต่', 'กลับ', 'พลิก', 'เหลือเชื่อ', 'ไม่คาดคิด', 'ทว่า', 'สวนทาง'],
  'ข่าวบริจาค': ['บริจาค', 'สมทบ', 'ช่วย', 'ทุน', 'มอบ', 'ให้'],
  'ข่าวสังคม': ['สังคม', 'ประเด็น', 'ถกเถียง', 'ความเห็น', 'ชาวเน็ต', 'แห่', 'วิจารณ์'],
};

/**
 * วิเคราะห์มุมมอง (angles) สำหรับทำคอนเทนต์ไวรัลจาก cluster
 * @param {object} cluster - cluster object จาก newsClusterer
 * @returns {Promise<{ angles: Array, riskLabels: Array<string> }>}
 */
export async function analyzeAngles(cluster) {
  try {
    if (!cluster || !cluster.mainTitle) {
      console.warn('[Radar-AngleAnalyzer] ไม่มีข้อมูล cluster ที่จะวิเคราะห์');
      return { angles: [], riskLabels: [] };
    }

    // พยายามใช้ AI ก่อน
    const aiResult = await analyzeWithAI(cluster);
    if (aiResult && aiResult.angles && aiResult.angles.length > 0) {
      console.log(`[Radar-AngleAnalyzer] วิเคราะห์ด้วย AI สำเร็จ: ${aiResult.angles.length} angles`);
      return aiResult;
    }

    // Fallback: ใช้ rule-based ถ้า AI ล้มเหลว
    console.log('[Radar-AngleAnalyzer] AI ล้มเหลว ใช้ rule-based fallback');
    return generateRuleBasedAngles(cluster);
  } catch (err) {
    console.error('[Radar-AngleAnalyzer] วิเคราะห์ angles ล้มเหลว:', err.message);
    return generateRuleBasedAngles(cluster);
  }
}

/**
 * วิเคราะห์ angles ด้วย AI (gpt-4o-mini)
 * @param {object} cluster
 * @returns {Promise<{ angles: Array, riskLabels: Array<string> } | null>}
 */
async function analyzeWithAI(cluster) {
  try {
    const sourcesText = (cluster.sources || [])
      .map(s => s.name || s.domain)
      .filter(Boolean)
      .join(', ') || 'ไม่ระบุ';

    const prompt = `คุณคือนักวิเคราะห์ข่าวไวรัลสำหรับ Facebook

=== ข่าว ===
หัวข้อ: ${cluster.mainTitle || 'ไม่ระบุ'}
สรุป: ${(cluster.summary || '').slice(0, 500)}
แหล่งข่าว: ${sourcesText}
=== จบข่าว ===

วิเคราะห์และเสนอ 3-5 angles ที่ควรทำเป็นคอนเทนต์ไวรัลบน Facebook

ตอบเป็น JSON เท่านั้น ห้ามมี text อื่น:
{
  "angles": [
    {
      "type": "ข่าวน้ำดี|ข่าวดราม่า|ข่าวครอบครัว|ข่าวเปิดใจ|ข่าวย้อนแย้ง|ข่าวบริจาค|ข่าวสังคม",
      "title": "หัวข้อที่แนะนำ",
      "hook": "ประโยคเปิดเรื่องที่แนะนำ",
      "whyGood": "เหตุผลว่าทำไม",
      "risk": "ความเสี่ยงถ้ามี",
      "needMoreInfo": "ข้อมูลที่ต้องหาเพิ่ม",
      "recommended": true
    }
  ],
  "riskLabels": ["เช็กข้อเท็จจริงก่อน", "อาจมีประเด็นลิขสิทธิ์"]
}`;

    const result = await callAI({
      prompt,
      model: 'gpt-4o-mini',
      temperature: 0.4,
      maxTokens: 2000,
    });

    if (!result) return null;

    // ดึง JSON จาก response — รองรับทั้งแบบ raw JSON และแบบมี markdown code block
    const responseText = typeof result === 'string' ? result : (result.text || result.content || '');
    const jsonMatch = responseText.match(/\{[\s\S]*"angles"[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Radar-AngleAnalyzer] AI ตอบมาไม่ใช่ JSON ที่ valid');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // ตรวจสอบโครงสร้าง
    if (!parsed.angles || !Array.isArray(parsed.angles)) {
      console.warn('[Radar-AngleAnalyzer] AI response ไม่มี angles array');
      return null;
    }

    // Validate แต่ละ angle
    const validAngles = parsed.angles.filter(a =>
      a && typeof a.type === 'string' && typeof a.title === 'string'
    ).map(a => ({
      type: a.type || 'ข่าวสังคม',
      title: a.title || '',
      hook: a.hook || '',
      whyGood: a.whyGood || '',
      risk: a.risk || 'ไม่มี',
      needMoreInfo: a.needMoreInfo || 'ไม่มี',
      recommended: a.recommended !== false,
    }));

    return {
      angles: validAngles,
      riskLabels: Array.isArray(parsed.riskLabels) ? parsed.riskLabels : [],
    };
  } catch (err) {
    console.error('[Radar-AngleAnalyzer] AI analysis ล้มเหลว:', err.message);
    return null;
  }
}

/**
 * สร้าง angles แบบ rule-based (fallback เมื่อ AI ล้มเหลว)
 * @param {object} cluster
 * @returns {{ angles: Array, riskLabels: Array<string> }}
 */
function generateRuleBasedAngles(cluster) {
  try {
    const title = cluster.mainTitle || '';
    const summary = cluster.summary || '';
    const fullText = `${title} ${summary}`;
    const angles = [];
    const riskLabels = [];

    // วิเคราะห์ว่าเข้า keyword กลุ่มไหนบ้าง
    for (const [type, keywords] of Object.entries(ANGLE_KEYWORDS)) {
      const matches = keywords.filter(k => fullText.includes(k));
      if (matches.length >= 1) {
        angles.push({
          type,
          title: `${type}: ${title.slice(0, 60)}`,
          hook: generateHook(type, title),
          whyGood: `พบคำสำคัญ: ${matches.slice(0, 3).join(', ')}`,
          risk: 'วิเคราะห์ด้วย rule-based — ควรตรวจสอบเพิ่มเติม',
          needMoreInfo: 'ต้องอ่านเนื้อหาฉบับเต็มก่อนเขียน',
          recommended: matches.length >= 2,
        });
      }
    }

    // ถ้าไม่ตรง keyword เลย ให้ใช้มุมทั่วไป
    if (angles.length === 0) {
      angles.push({
        type: 'ข่าวสังคม',
        title: title || 'ข่าวที่น่าสนใจ',
        hook: `เรื่องนี้กำลังเป็นที่พูดถึง...`,
        whyGood: 'เป็นข่าวที่ถูกรายงานจากหลายแหล่ง',
        risk: 'ต้องตรวจสอบข้อเท็จจริงก่อนเผยแพร่',
        needMoreInfo: 'ต้องหาแหล่งข่าวเพิ่มเติม',
        recommended: false,
      });
    }

    // เพิ่ม risk labels
    if (cluster.sourceCount <= 1) {
      riskLabels.push('มีแหล่งข่าวเดียว — ควรเช็กข้อเท็จจริง');
    }
    if (!cluster.newestPublishedAt) {
      riskLabels.push('ไม่มีวันที่เผยแพร่ — อาจเป็นข่าวเก่า');
    }

    return { angles, riskLabels };
  } catch (err) {
    console.error('[Radar-AngleAnalyzer] Rule-based fallback ล้มเหลว:', err.message);
    return { angles: [], riskLabels: ['วิเคราะห์ล้มเหลว'] };
  }
}

/**
 * สร้างประโยค hook ตามประเภทข่าว
 * @param {string} type - ประเภท angle
 * @param {string} title - หัวข้อข่าว
 * @returns {string}
 */
function generateHook(type, title) {
  const shortTitle = title.slice(0, 40);
  const hooks = {
    'ข่าวน้ำดี': `เรื่องดีๆ ที่ทำให้หัวใจอุ่น... ${shortTitle}`,
    'ข่าวดราม่า': `ดราม่าสะเทือนวงการ! ${shortTitle}`,
    'ข่าวครอบครัว': `เรื่องราวของครอบครัวที่ทำให้ทุกคนต้องหยุดดู... ${shortTitle}`,
    'ข่าวเปิดใจ': `เปิดใจครั้งแรก! ${shortTitle}`,
    'ข่าวย้อนแย้ง': `ไม่มีใครคาดคิด... ${shortTitle}`,
    'ข่าวบริจาค': `น้ำใจที่ทำให้สังคมดีขึ้น... ${shortTitle}`,
    'ข่าวสังคม': `ประเด็นที่ทุกคนกำลังพูดถึง... ${shortTitle}`,
  };
  return hooks[type] || `${shortTitle}...`;
}
