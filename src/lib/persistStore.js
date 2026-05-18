/**
 * Persistent JSON Store — ทำงานบน Vercel Serverless
 * 
 * ปัญหาเดิม: Vercel ใช้ /tmp ซึ่งหายทุก deploy + race condition ทำข้อมูลทับกัน
 * 
 * วิธีแก้:
 * 1. ใช้ global in-memory cache (อยู่ตราบ function instance warm)
 * 2. เขียน /tmp เป็น backup (ใช้ lock ป้องกัน race condition)
 * 3. Bundled file (data/) เป็น fallback สุดท้าย
 * 4. ทุกการเขียนจะ sync ทั้ง memory + file
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// === Global In-Memory Cache ===
// ใน Node.js module scope → persist ข้าม request ตราบ instance ยังอยู่
const _cache = new Map();
const _locks = new Map();

/**
 * สร้าง JSON store ที่ persist ได้
 * @param {string} name - ชื่อ store (เช่น 'viral-library', 'prompt-library')
 * @returns {object} store API
 */
export function createStore(name) {
  const IS_VERCEL = !!process.env.VERCEL;
  const DATA_DIR = IS_VERCEL ? '/tmp' : join(process.cwd(), 'data');
  const LIVE_FILE = join(DATA_DIR, `${name}.json`);
  const BUNDLED_FILE = join(process.cwd(), 'data', `${name}.json`);
  
  // === Internal: อ่านจาก cache → file → bundled → empty ===
  async function _load() {
    // 1. จาก memory cache (เร็วที่สุด)
    if (_cache.has(name)) {
      return _cache.get(name);
    }
    
    // 2. จาก /tmp file
    try {
      const data = JSON.parse(await readFile(LIVE_FILE, 'utf-8'));
      _cache.set(name, data);
      console.log(`[Store:${name}] ✅ Loaded from file: ${data.length} items`);
      return data;
    } catch {}
    
    // 3. จาก bundled file (data/ folder ใน repo)
    try {
      if (existsSync(BUNDLED_FILE)) {
        const data = JSON.parse(await readFile(BUNDLED_FILE, 'utf-8'));
        _cache.set(name, data);
        // Copy to /tmp for future reads
        try {
          await mkdir(DATA_DIR, { recursive: true });
          await writeFile(LIVE_FILE, JSON.stringify(data, null, 2), 'utf-8');
        } catch {}
        console.log(`[Store:${name}] ✅ Loaded from bundled: ${data.length} items`);
        return data;
      }
    } catch {}
    
    // 4. Empty
    console.log(`[Store:${name}] ⚠️ No data found — starting empty`);
    _cache.set(name, []);
    return [];
  }
  
  // === Internal: เขียนลง cache + file ===
  async function _save(items) {
    // 1. อัพเดท memory cache ทันที (สำคัญที่สุด!)
    _cache.set(name, items);
    
    // 2. เขียนลง /tmp file (backup)
    try {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(LIVE_FILE, JSON.stringify(items, null, 2), 'utf-8');
    } catch (e) {
      console.error(`[Store:${name}] ⚠️ File write failed: ${e.message}`);
    }
    
    // 3. เขียนลง bundled (local dev only — Vercel read-only)
    if (!IS_VERCEL) {
      try {
        await mkdir(join(process.cwd(), 'data'), { recursive: true });
        await writeFile(BUNDLED_FILE, JSON.stringify(items, null, 2), 'utf-8');
      } catch {}
    }
  }
  
  // === Lock mechanism ===
  async function _withLock(fn) {
    let retries = 0;
    while (_locks.get(name)) {
      if (retries >= 20) throw new Error(`Store lock timeout: ${name}`);
      await new Promise(r => setTimeout(r, 50));
      retries++;
    }
    _locks.set(name, true);
    try {
      return await fn();
    } finally {
      _locks.delete(name);
    }
  }
  
  // === Public API ===
  return {
    /** อ่านข้อมูลทั้งหมด */
    async getAll() {
      return [...(await _load())];
    },
    
    /** เพิ่มข้อมูลใหม่ (ป้องกัน race condition) */
    async add(item) {
      return _withLock(async () => {
        const items = await _load();
        items.push(item);
        await _save(items);
        console.log(`[Store:${name}] ✅ Added 1 item → total: ${items.length}`);
        return item;
      });
    },
    
    /** เพิ่มหลายรายการ */
    async addMany(newItems) {
      return _withLock(async () => {
        const items = await _load();
        items.push(...newItems);
        await _save(items);
        console.log(`[Store:${name}] ✅ Added ${newItems.length} items → total: ${items.length}`);
        return newItems;
      });
    },
    
    /** อัพเดทข้อมูลตาม id */
    async update(id, updateFn) {
      return _withLock(async () => {
        const items = await _load();
        const idx = items.findIndex(i => i.id === id);
        if (idx < 0) throw new Error(`ไม่พบ id: ${id}`);
        
        if (typeof updateFn === 'function') {
          items[idx] = updateFn(items[idx]);
        } else {
          // updateFn is actually update data object
          Object.assign(items[idx], updateFn);
        }
        items[idx].updatedAt = new Date().toISOString();
        
        await _save(items);
        console.log(`[Store:${name}] ✅ Updated id: ${id}`);
        return items[idx];
      });
    },
    
    /** ลบข้อมูลตาม id */
    async remove(id) {
      return _withLock(async () => {
        const items = await _load();
        const before = items.length;
        const filtered = items.filter(i => i.id !== id);
        if (filtered.length === before) throw new Error(`ไม่พบ id: ${id}`);
        await _save(filtered);
        console.log(`[Store:${name}] ✅ Deleted id: ${id} → remaining: ${filtered.length}`);
        return { removed: true, remaining: filtered.length };
      });
    },
    
    /** หาข้อมูลตาม id */
    async findById(id) {
      const items = await _load();
      return items.find(i => i.id === id) || null;
    },
    
    /** นับจำนวน */
    async count() {
      const items = await _load();
      return items.length;
    },
  };
}
