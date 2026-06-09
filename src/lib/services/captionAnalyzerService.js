// GPT-4o-mini replaces Gemini for caption analysis (text-only)

/**
 * Caption Analyzer Service
 * วิเคราะห์ title + snippet ของภาพจาก Serper → ตรวจว่าภาพตรงกับ expectedRole ไหม
 * ใช้ Gemini Flash (text-only, ไม่ใช่ Vision → เบากว่า + เร็วกว่ามาก)
 * เรียกก่อน evidenceConfidenceService เพื่อ pre-filter ก่อนส่ง Vision
 */

const CAPTION_TIMEOUT_MS = 3000;

/**
 * analyzeCaptionContext — ตรวจ caption ของภาพ
 * @param {Object} image — {imageUrl, title, snippet, ...}
 * @param {string} expectedRole — role ที่คาดหวัง เช่น 'mother', 'hero'
 * @param {string} heroName — ชื่อตัวละครหลัก
 * @returns {{ match: 'yes'|'no'|'unclear', score: number, reason: string }}
 */
export async function analyzeCaptionContext(image, expectedRole, heroName) {
  const SAFE_DEFAULT = { match: 'unclear', score: 0.5, reason: 'ไม่มี caption' };
  const caption = [image.title, image.snippet].filter(Boolean).join(' ').trim();

  if (!caption || caption.length < 5) return SAFE_DEFAULT;
  if (!process.env.OPENAI_API_KEY) return SAFE_DEFAULT;

  const roleLabel = {
    hero: `ตัวละครหลัก "${heroName}"`,
    mother: `แม่ของ "${heroName}"`,
    father: `พ่อของ "${heroName}"`,
    spouse: `คู่สมรสของ "${heroName}"`,
    partner: `แฟนของ "${heroName}"`,
    child: `ลูก of "${heroName}"`,
    sibling: `พี่/น้องของ "${heroName}"`,
    caregiving: `กิจกรรมดูแลในข่าว "${heroName}"`,
    activity: `กิจกรรมหลักในข่าว "${heroName}"`,
    interview: `การสัมภาษณ์ "${heroName}"`,
    event: `เหตุการณ์ในข่าว "${heroName}"`,
  }[expectedRole] || `${expectedRole} ของ "${heroName}"`;

  // ★ GPT-4o-mini — replace Gemini (text-only, no vision needed)
  try {
    const prompt = `Caption ของภาพข่าว: "${caption}"

ภาพนี้น่าจะเป็น ${roleLabel} ไหม?

- "yes" (score 0.75-1.0): caption บ่งชี้ชัดว่าเกี่ยวข้องกับ ${expectedRole}
- "unclear" (score 0.4-0.74): caption ไม่ได้บอกชัด อาจใช่หรือไม่ใช่
- "no" (score 0.0-0.39): caption บ่งชี้ว่าไม่ใช่ ${expectedRole} เลย

ตอบ JSON เท่านั้น ห้าม markdown:
{"match": "yes"|"no"|"unclear", "score": 0.0-1.0, "reason": "เหตุผลสั้นๆ"}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CAPTION_TIMEOUT_MS);

    let gptRes;
    try {
      gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 150,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!gptRes.ok) {
      const errBody = await gptRes.text().catch(() => '');
      throw new Error(`OpenAI API ${gptRes.status}: ${errBody.slice(0, 100)}`);
    }

    const gptData = await gptRes.json();
    const text = (gptData.choices?.[0]?.message?.content || '').trim();
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{[\s\S]*?\})/);
    if (!jsonMatch) return SAFE_DEFAULT;

    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    const match = ['yes', 'no', 'unclear'].includes(parsed.match) ? parsed.match : 'unclear';
    const score = Math.max(0, Math.min(1, Number(parsed.score) || 0.5));

    return { match, score, reason: parsed.reason || '' };
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.warn(`[CaptionAnalyzer] GPT-4o-mini error (${e.message?.slice(0, 50)}) → unclear`);
    }
    return SAFE_DEFAULT;
  }
}

/**
 * sortAndFilterByCaptions — เพิ่ม captionScore + เรียงก่อนส่ง Vision
 * @param {Array} images — images ใน category เดียวกัน
 * @param {string} expectedRole — role ที่คาดหวัง
 * @param {string} heroName — ชื่อตัวละครหลัก
 * @returns {Promise<Array>} — images พร้อม captionScore, เรียงตามคะแนน
 */
export async function sortAndFilterByCaptions(images, expectedRole, heroName) {
  if (!images || images.length === 0) return [];

  const results = [];
  const batchSize = 3;
  for (let i = 0; i < images.length; i += batchSize) {
    if (i > 0) {
      await new Promise(r => setTimeout(r, 400)); // sleep 400ms between batches
    }
    const batch = images.slice(i, i + batchSize);
    const promises = batch.map(async img => {
      const caption = await analyzeCaptionContext(img, expectedRole, heroName);
      return {
        ...img,
        captionScore: caption.score,
        captionMatch: caption.match,
        captionReason: caption.reason,
      };
    });
    const batchResults = await Promise.allSettled(promises);
    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      }
    }
  }

  return results
    .filter(r => r.captionMatch !== 'no')
    .sort((a, b) => (b.captionScore || 0) - (a.captionScore || 0));
}
