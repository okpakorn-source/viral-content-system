/**
 * =====================================================
 * Bannerbear Composer — ประกอบปกผ่าน template ตายตัว
 * =====================================================
 * แนวคิด (แยกระบบจาก composer หลัก): AI ของเราหาภาพ+คัด → โยนภาพ+ข้อความให้
 * Bannerbear render ตาม template ที่ออกแบบไว้เป๊ะๆ ในเว็บของเขา
 * - ครอปเกาะใบหน้า (smart crop) ทำให้ในตัว
 * - ข้อความ auto-fit + ฟอนต์ไทยอัปโหลดใน editor ได้
 * - ไม่มีปัญหา sharp/fontconfig/serverless
 *
 * ต้องมีใน .env:
 *   BANNERBEAR_API_KEY      — จาก Settings > API Key
 *   BANNERBEAR_TEMPLATE_UID — uid ของ template ที่สร้างใน editor
 *
 * ชื่อ layer ใน template ที่ต้องตั้งให้ตรง:
 *   photo_main, photo_top, photo_bottom, photo_circle (image layers)
 *   text_hook, text_main, text_punch (text layers)
 */

const BB_SYNC_URL = 'https://sync.api.bannerbear.com/v2/images';

export function isBannerbearAvailable() {
  return !!(process.env.BANNERBEAR_API_KEY && process.env.BANNERBEAR_TEMPLATE_UID);
}

/**
 * @param {object} params
 * @param {string[]} params.imageUrls - ภาพเรียงตามความสำคัญ [main, top, bottom, circle]
 * @param {object}   params.typography - { hook, main, punch }
 * @param {string}   [params.templateUid] - override template
 * @returns {Promise<{success: boolean, imageUrl?: string, error?: string}>}
 */
export async function composeCoverViaBannerbear({ imageUrls = [], typography = {}, templateUid = null }) {
  const apiKey = process.env.BANNERBEAR_API_KEY;
  const template = templateUid || process.env.BANNERBEAR_TEMPLATE_UID;
  if (!apiKey || !template) {
    return { success: false, error: 'BANNERBEAR_API_KEY / BANNERBEAR_TEMPLATE_UID ยังไม่ถูกตั้งใน .env' };
  }
  if (!imageUrls.length) {
    return { success: false, error: 'ไม่มีภาพสำหรับประกอบปก' };
  }

  const slotNames = ['photo_main', 'photo_top', 'photo_bottom', 'photo_circle'];
  const modifications = [];

  slotNames.forEach((name, i) => {
    if (imageUrls[i]) modifications.push({ name, image_url: imageUrls[i] });
  });
  if (typography.hook)  modifications.push({ name: 'text_hook',  text: String(typography.hook).slice(0, 18) });
  if (typography.main)  modifications.push({ name: 'text_main',  text: String(typography.main).slice(0, 40) });
  if (typography.punch) modifications.push({ name: 'text_punch', text: String(typography.punch).slice(0, 50) });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const res = await fetch(BB_SYNC_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ template, modifications }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: `Bannerbear HTTP ${res.status}: ${(data?.message || JSON.stringify(data)).slice(0, 150)}` };
    }
    if (data.status === 'completed' && (data.image_url_jpg || data.image_url)) {
      return { success: true, imageUrl: data.image_url_jpg || data.image_url, uid: data.uid };
    }
    return { success: false, error: `Bannerbear ตอบสถานะ ${data.status || 'unknown'} — ไม่มี image_url` };
  } catch (e) {
    return { success: false, error: `Bannerbear error: ${e.message?.slice(0, 120)}` };
  }
}
