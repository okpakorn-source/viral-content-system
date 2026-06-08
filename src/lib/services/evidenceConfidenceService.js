/**
 * Evidence Confidence Service
 * ใช้ Gemini Vision ตรวจว่าภาพใน relationship slots มีบุคคลที่ถูกต้องจริงไหม
 * เรียกเฉพาะ relationship/circle slots เท่านั้น (ไม่ใช้กับทุกภาพ — ประหยัด API cost)
 */

const CONFIDENCE_THRESHOLD = 0.75;
const VISION_TIMEOUT_MS = 5000;

/**
 * scoreEvidenceConfidence — ตรวจภาพด้วย Gemini Vision
 * @param {string} imageUrl — URL ของภาพที่ต้องการตรวจ
 * @param {string} expectedRole — role ที่คาดหวัง เช่น 'mother', 'spouse', 'hero'
 * @param {string} heroName — ชื่อตัวละครหลัก (context)
 * @returns {{ isTargetPerson: boolean, confidence: number, reason: string }}
 */
export async function scoreEvidenceConfidence(imageUrl, expectedRole, heroName) {
  // Fallback safe defaults — ไม่ block ถ้า error
  const SAFE_DEFAULT = { isTargetPerson: false, confidence: 0.5, reason: 'ไม่สามารถตรวจสอบได้' };

  if (!imageUrl || !process.env.GEMINI_API_KEY) {
    return SAFE_DEFAULT;
  }

  // Skip data: URIs (YouTube frames) — ไม่ตรวจ YouTube storyboard
  if (imageUrl.startsWith('data:')) {
    return { isTargetPerson: true, confidence: 0.6, reason: 'YouTube frame — ข้ามการตรวจ' };
  }

  try {
    // ดาวน์โหลดภาพ
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) });
    if (!imgRes.ok) return SAFE_DEFAULT;

    const arrayBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const roleLabel = {
      hero: `ตัวละครหลัก "${heroName}"`,
      mother: `แม่ของ "${heroName}"`,
      father: `พ่อของ "${heroName}"`,
      spouse: `คู่สมรสของ "${heroName}"`,
      partner: `แฟนของ "${heroName}"`,
      child: `ลูกของ "${heroName}"`,
      sibling: `พี่/น้องของ "${heroName}"`,
      friend: `เพื่อนของ "${heroName}"`,
      colleague: `เพื่อนร่วมงานของ "${heroName}"`,
    }[expectedRole] || `${expectedRole} ของ "${heroName}"`;

    const prompt = `ดูภาพนี้แล้วบอกว่า: ภาพนี้มี ${roleLabel} ปรากฏอยู่ไหม?
ตอบ JSON เท่านั้น ห้าม markdown:
{"isTargetPerson": true/false, "confidence": 0.0-1.0, "reason": "เหตุผลสั้นๆ ภาษาไทย"}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

    let result;
    try {
      result = await model.generateContent([
        prompt,
        { inlineData: { data: base64, mimeType } },
      ]);
    } finally {
      clearTimeout(timer);
    }

    const text = result.response.text().trim();
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{[\s\S]*?\})/);
    if (!jsonMatch) return SAFE_DEFAULT;

    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
    const isTargetPerson = parsed.isTargetPerson === true;

    console.log(`[EvidenceConfidence] ${expectedRole} → ${isTargetPerson ? '✅' : '❌'} confidence: ${confidence.toFixed(2)} — ${parsed.reason || ''}`);

    return { isTargetPerson, confidence, reason: parsed.reason || '' };
  } catch (e) {
    console.warn(`[EvidenceConfidence] Error (${e.message?.slice(0, 60)}) → safe default`);
    return SAFE_DEFAULT;
  }
}

/**
 * filterRelationshipImages — กรองภาพ relationship ที่ confidence ต่ำออก
 * @param {Array} images — [{imageUrl, category, ...}]
 * @param {string} heroName — ชื่อตัวละครหลัก
 * @returns {Promise<Array>} — images ที่ผ่าน confidence check เท่านั้น
 */
export async function filterRelationshipImages(images, heroName) {
  if (!images || images.length === 0) return [];

  const RELATIONSHIP_CATS = ['mother', 'father', 'spouse', 'partner', 'child', 'sibling', 'friend'];

  const results = await Promise.allSettled(
    images.map(async img => {
      // ตรวจเฉพาะ relationship categories
      if (!RELATIONSHIP_CATS.includes(img.category || img.evidenceCat)) {
        return img; // ไม่ใช่ relationship → ผ่านโดยไม่ตรวจ
      }
      const check = await scoreEvidenceConfidence(img.imageUrl || img.url, img.category || img.evidenceCat, heroName);
      if (check.confidence >= CONFIDENCE_THRESHOLD) return img;
      console.log(`[EvidenceConfidence] ❌ Filtered out low-confidence image (${check.confidence.toFixed(2)}): ${(img.imageUrl || img.url)?.slice(0, 60)}`);
      return null; // ไม่ผ่าน → กรองออก
    })
  );

  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
}
