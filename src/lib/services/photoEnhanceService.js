/**
 * ★ Photo Enhance Service (16 มิ.ย. 69) — เพิ่มความชัดภาพข่าว (เครื่องมือแยก, public)
 * เครื่องยนต์: Replicate Real-ESRGAN (super-resolution)
 *
 * 🔴 กฎเหล็ก: "เพิ่มความละเอียด/ความชัด" เท่านั้น — ห้ามเจนภาพใหม่ ห้ามแตะหน้า/บริบท/รูปลักษณ์คน
 *   → face_enhance = false เสมอ (GFPGAN ที่แต่งหน้าใหม่ = ปิดตาย) | ไม่มี img2img/generative
 *   Real-ESRGAN ขยายพิกเซลเดิมให้คมขึ้น คงอัตลักษณ์ใบหน้า/องค์ประกอบ 100%
 */
const REAL_ESRGAN_VERSION = 'b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8';

// ระดับความชัด (tier) → scale + ราคาประมาณ (Replicate T4 ~$0.0002/วิ — ขึ้นกับขนาดภาพ)
export const ENHANCE_TIERS = {
  standard: { scale: 2, label: 'ชัดมาตรฐาน', detail: 'ขยาย 2 เท่า — เร็ว ประหยัด', approxBaht: 0.05 },
  high: { scale: 4, label: 'ชัดสูงสุด', detail: 'ขยาย 4 เท่า — คมสุด ละเอียดสุด', approxBaht: 0.12 },
};

export async function createEnhanceJob({ image, tier = 'standard' }) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('ระบบยังไม่ได้ตั้งค่า REPLICATE_API_TOKEN');
  const scale = ENHANCE_TIERS[tier]?.scale || 2;
  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: REAL_ESRGAN_VERSION,
      input: { image, scale, face_enhance: false }, // ★ face_enhance ปิดตาย — คงหน้าคนเดิม 100%
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || data?.title || `Replicate ${res.status}`);
  return { id: data.id, status: data.status || 'starting' };
}

export async function getEnhanceJob(id) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('ระบบยังไม่ได้ตั้งค่า REPLICATE_API_TOKEN');
  const res = await fetch('https://api.replicate.com/v1/predictions/' + encodeURIComponent(id), {
    headers: { Authorization: 'Bearer ' + token },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || `Replicate ${res.status}`);
  const output = typeof data.output === 'string' ? data.output : (Array.isArray(data.output) ? data.output[0] : null);
  return { id, status: data.status, output, error: data.error || null };
}
