/**
 * File Lock — ป้องกัน Race Condition ในการอ่าน/เขียนไฟล์ JSON
 * ใช้ in-memory lock + retry เพื่อให้หลาย request ไม่ทับกัน
 */

const locks = new Map();

/**
 * ทำงานกับ JSON file แบบ atomic (ล็อก → อ่าน → แก้ → เขียน → ปลดล็อก)
 * @param {string} filePath - path ของไฟล์
 * @param {function} callback - function ที่รับ data แล้ว return data ใหม่
 * @param {object} opts - options
 * @returns {any} ผลลัพธ์จาก callback
 */
export async function withFileLock(filePath, callback, opts = {}) {
  const { maxRetries = 10, retryDelay = 100 } = opts;
  
  // รอจนกว่า lock จะว่าง
  let retries = 0;
  while (locks.get(filePath)) {
    if (retries >= maxRetries) {
      throw new Error(`File lock timeout: ${filePath} (waited ${retries * retryDelay}ms)`);
    }
    await new Promise(r => setTimeout(r, retryDelay));
    retries++;
  }
  
  // ล็อก
  locks.set(filePath, true);
  
  try {
    const result = await callback();
    return result;
  } finally {
    // ปลดล็อกเสมอ
    locks.delete(filePath);
  }
}
