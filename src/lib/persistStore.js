/**
 * Persistent Store — ใช้ Supabase (PostgreSQL) เป็นฐานข้อมูลหลัก
 * 
 * Table: store_items
 *   - id (text, PK)
 *   - store_name (text) — ชื่อ store เช่น 'viral-library', 'prompt-library'
 *   - data (jsonb) — ข้อมูลทั้งหมดของ item
 *   - created_at (timestamptz)
 *   - updated_at (timestamptz)
 * 
 * ถ้าไม่มี Supabase → fallback ไป file storage (local dev)
 */

import { getSupabase, isSupabaseReady } from '@/lib/supabase';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const TABLE = 'store_items';

// === File fallback (local dev only) ===
const _memCache = new Map();
const _locks = new Map();

function _decodeStr(str) {
  if (typeof str !== 'string') return str;
  if (str.includes('à¸') || str.includes('à¹') || str.includes('à¹‰') || str.includes('à¸µ')) {
    try {
      const buf = Buffer.from(str, 'binary');
      return buf.toString('utf8');
    } catch (e) {
      return str;
    }
  }
  return str;
}

function _decodeValue(val) {
  if (typeof val === 'string') {
    return _decodeStr(val);
  }
  if (Array.isArray(val)) {
    return val.map(_decodeValue);
  }
  if (val && typeof val === 'object') {
    const fixedObj = {};
    for (const [key, v] of Object.entries(val)) {
      fixedObj[key] = _decodeValue(v);
    }
    return fixedObj;
  }
  return val;
}

async function _fileFallbackLoad(name) {
  // Only use cache if it has real data (avoid caching empty arrays from failed loads)
  if (_memCache.has(name) && _memCache.get(name).length > 0) return _memCache.get(name);
  
  const filePath = join(process.cwd(), 'data', `${name}.json`);
  try {
    const data = JSON.parse(await readFile(filePath, 'utf-8'));
    if (Array.isArray(data) && data.length > 0) {
      const fixedData = data.map(_decodeValue);
      _memCache.set(name, fixedData);
      return fixedData;
    }
    return data || [];
  } catch {
    return [];
  }
}


// Serverless (Vercel/Lambda) filesystem is read-only — disk writes always fail there.
// ★ ห้ามเชื่อ env VERCEL ตรงๆ: `vercel env pull` เขียน VERCEL="1" ลง .env.local
//   ทำให้เครื่อง dev จริงถูกมองเป็น serverless แล้วหยุด sync ไฟล์ fallback (ผิดกฎ Database Fallback Sync)
// → ตัดสินจากผลเขียนจริง: เจอ error แนว read-only เมื่อไหร่ ค่อยปิดการเขียนถาวร + เตือนครั้งเดียว
let _diskReadOnly = false;
const _warnedWriteSkip = new Set();

function _warnWriteSkipOnce(name, message) {
  if (_warnedWriteSkip.has(name)) return;
  _warnedWriteSkip.add(name);
  console.warn(`[Store:${name}] ${message}`);
}

async function _fileFallbackSave(name, items) {
  _memCache.set(name, items);
  if (_diskReadOnly) {
    _warnWriteSkipOnce(name, 'Read-only filesystem detected — skipping local JSON cache write (in-memory cache only)');
    return;
  }
  try {
    const dir = join(process.cwd(), 'data');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.json`), JSON.stringify(items, null, 2), 'utf-8');
  } catch (e) {
    if (/EROFS|read-only|EPERM|EACCES/i.test(e.message || '')) {
      _diskReadOnly = true; // serverless จริง — เลิกพยายามทั้ง process กัน log spam
    }
    _warnWriteSkipOnce(name, `File write failed (further failures suppressed): ${e.message}`);
  }
}

async function _withLock(name, fn) {
  let retries = 0;
  while (_locks.get(name)) {
    if (retries >= 30) throw new Error(`Lock timeout: ${name}`);
    await new Promise(r => setTimeout(r, 50));
    retries++;
  }
  _locks.set(name, true);
  try { return await fn(); }
  finally { _locks.delete(name); }
}

// === Main Store Factory ===
export function createStore(name) {
  
  // ===== SUPABASE MODE =====
  if (isSupabaseReady()) {
    return {
      async getAll() {
        try {
          const sb = getSupabase();
          // ★ 26 มิ.ย.: ดึงครบทุกแถว (แบ่งหน้า 1000) — เดิม Supabase คืนแค่ 1000 แถวใหม่สุด → แถวเก่าเกินนั้น "กำพร้า"
          //   ระบบลบของเก่า (auto-purge) ใช้ getAll → มองไม่เห็นแถวกำพร้า → ตารางบวมจน egress พุ่ง (เคยโดน 21k)
          //   เลนเล็ก: จบหน้าเดียว (เร็วเท่าเดิม) · cap 20000 กัน loop ค้าง
          let data = [];
          let error = null;
          for (let from = 0; from < 20000; from += 1000) {
            const page = await sb
              .from(TABLE)
              .select('data')
              .eq('store_name', name)
              .order('created_at', { ascending: false })
              .range(from, from + 999);
            if (page.error) { if (from === 0) error = page.error; break; }
            if (!page.data || page.data.length === 0) break;
            data.push(...page.data);
            if (page.data.length < 1000) break;
          }

          if (error) {
            console.warn(`[Store:${name}] Supabase query error: ${error.message} — falling back to local file`);
            const localData = await _fileFallbackLoad(name);
            console.log(`[Store:${name}] 📁 Fallback: ${localData.length} items from local file`);
            return [...localData];
          }
          const items = (data || []).map(row => _decodeValue(row.data));
          
          // If Supabase returns 0 but local file has data, prefer local
          if (items.length === 0) {
            const localData = await _fileFallbackLoad(name);
            if (localData.length > 0) {
              console.log(`[Store:${name}] ⚠️ Supabase returned 0 but local has ${localData.length} — using local`);
              return [...localData];
            }
          }
          
          console.log(`[Store:${name}] ✅ Loaded ${items.length} items from Supabase`);
          // Sync to local file cache for offline use
          if (items.length > 0) {
            _fileFallbackSave(name, items).catch(() => {});
          }
          return items;
        } catch (fetchErr) {
          console.warn(`[Store:${name}] Supabase fetch failed: ${fetchErr.message} — falling back to local file`);
          const localData = await _fileFallbackLoad(name);
          console.log(`[Store:${name}] 📁 Fallback: ${localData.length} items from local file`);
          return [...localData];
        }
      },
      
      async add(item) {
        const sb = getSupabase();
        const { error } = await sb.from(TABLE).insert({
          id: item.id,
          store_name: name,
          data: item,
          created_at: item.createdAt || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (error) {
          console.error(`[Store:${name}] ADD error:`, error.message);
          throw new Error(`บันทึกไม่สำเร็จ: ${error.message}`);
        }
        
        // Sync to local file cache
        _fileFallbackLoad(name).then(items => {
          const filtered = items.filter(i => i.id !== item.id);
          filtered.unshift(item); // Put newest first
          _fileFallbackSave(name, filtered);
        }).catch(() => {});
        
        console.log(`[Store:${name}] ✅ Added: ${item.id}`);
        return item;
      },
      
      async addMany(newItems) {
        const sb = getSupabase();
        if (!newItems || newItems.length === 0) return newItems || [];
        // ★ 16 มิ.ย. (แก้บั๊ก duplicate key): กรอง id ที่มีอยู่แล้วออกก่อน insert (เช่นค้นกระแสซ้ำ url เดิม)
        let fresh = newItems;
        try {
          const { data: ex } = await sb.from(TABLE).select('id').eq('store_name', name).in('id', newItems.map(i => i.id));
          const exIds = new Set((ex || []).map(r => r.id));
          fresh = newItems.filter(i => !exIds.has(i.id));
        } catch { /* เช็คไม่ได้ = ลอง insert ตรง แล้วจัดการ error ด้านล่าง */ }
        if (fresh.length === 0) { console.log(`[Store:${name}] addMany: มีอยู่แล้วทั้งหมด ข้าม`); return newItems; }
        const rows = fresh.map(item => ({
          id: item.id,
          store_name: name,
          data: item,
          created_at: item.createdAt || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        const { error } = await sb.from(TABLE).insert(rows);
        if (error) {
          // ★ ชน id ซ้ำ (race กับ cron) = ไม่ใช่เรื่องร้าย — ข้ามได้ ไม่ throw (กันงานหนักพังทั้งรอบ)
          if (/duplicate key|_pkey|23505/i.test(error.message)) {
            console.warn(`[Store:${name}] addMany dup (ข้าม ไม่พังทั้งรอบ): ${error.message.slice(0, 70)}`);
            return newItems;
          }
          console.error(`[Store:${name}] ADD MANY error:`, error.message);
          throw new Error(`บันทึกไม่สำเร็จ: ${error.message}`);
        }

        // Sync to local file cache
        _fileFallbackLoad(name).then(items => {
          const newIds = new Set(fresh.map(i => i.id));
          const filtered = items.filter(i => !newIds.has(i.id));
          _fileFallbackSave(name, [...fresh, ...filtered]);
        }).catch(() => {});

        console.log(`[Store:${name}] ✅ Added ${fresh.length} items (ข้ามซ้ำ ${newItems.length - fresh.length})`);
        return fresh;
      },
      
      async update(id, updateFn) {
        const sb = getSupabase();
        // อ่านก่อน
        const { data: existing, error: readErr } = await sb
          .from(TABLE)
          .select('data')
          .eq('id', id)
          .eq('store_name', name)
          .single();
        
        if (readErr || !existing) {
          throw new Error(`ไม่พบ id: ${id}`);
        }
        
        let updated;
        if (typeof updateFn === 'function') {
          updated = updateFn(existing.data);
        } else {
          updated = { ...existing.data, ...updateFn };
        }
        updated.updatedAt = new Date().toISOString();
        
        const { error: writeErr } = await sb
          .from(TABLE)
          .update({ data: updated, updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('store_name', name);
        
        if (writeErr) {
          console.error(`[Store:${name}] UPDATE error:`, writeErr.message);
          throw new Error(`อัพเดทไม่สำเร็จ: ${writeErr.message}`);
        }
        console.log(`[Store:${name}] ✅ Updated: ${id}`);
        return updated;
      },
      
      async remove(id) {
        const sb = getSupabase();
        const { error } = await sb
          .from(TABLE)
          .delete()
          .eq('id', id)
          .eq('store_name', name);
        
        if (error) {
          console.error(`[Store:${name}] DELETE error:`, error.message);
          throw new Error(`ลบไม่สำเร็จ: ${error.message}`);
        }
        
        // ลบจาก local file ด้วย
        const localData = await _fileFallbackLoad(name);
        const filtered = localData.filter(i => i.id !== id);
        await _fileFallbackSave(name, filtered).catch(() => {});
        
        console.log(`[Store:${name}] ✅ Deleted: ${id}`);
        return { removed: true };
      },
      
      async removeAll() {
        const sb = getSupabase();
        const { error } = await sb
          .from(TABLE)
          .delete()
          .eq('store_name', name);
        
        if (error) {
          console.error(`[Store:${name}] DELETE ALL error:`, error.message);
          throw new Error(`ลบทั้งหมดไม่สำเร็จ: ${error.message}`);
        }
        
        // ต้อง clear local file ด้วย ไม่งั้น getAll() จะไปดึงของเก่ามาเพราะนึกว่าดึง db พลาด
        await _fileFallbackSave(name, []).catch(() => {});
        
        console.log(`[Store:${name}] ✅ Deleted ALL items`);
        return { removedAll: true };
      },
      
      async findById(id) {
        const sb = getSupabase();
        const { data, error } = await sb
          .from(TABLE)
          .select('data')
          .eq('id', id)
          .eq('store_name', name)
          .single();
        if (error) return null;
        return data?.data ? _decodeValue(data.data) : null;
      },
      
      async count() {
        const sb = getSupabase();
        const { count, error } = await sb
          .from(TABLE)
          .select('*', { count: 'exact', head: true })
          .eq('store_name', name);
        if (error) return 0;
        return count || 0;
      },
    };
  }
  
  // ===== FILE FALLBACK MODE (local dev) =====
  console.log(`[Store:${name}] ⚠️ No Supabase — using file fallback`);
  return {
    async getAll() {
      return [...(await _fileFallbackLoad(name))];
    },
    async add(item) {
      return _withLock(name, async () => {
        const items = await _fileFallbackLoad(name);
        items.push(item);
        await _fileFallbackSave(name, items);
        return item;
      });
    },
    async addMany(newItems) {
      return _withLock(name, async () => {
        const items = await _fileFallbackLoad(name);
        items.push(...newItems);
        await _fileFallbackSave(name, items);
        return newItems;
      });
    },
    async update(id, updateFn) {
      return _withLock(name, async () => {
        const items = await _fileFallbackLoad(name);
        const idx = items.findIndex(i => i.id === id);
        if (idx < 0) throw new Error(`ไม่พบ id: ${id}`);
        if (typeof updateFn === 'function') {
          items[idx] = updateFn(items[idx]);
        } else {
          Object.assign(items[idx], updateFn);
        }
        items[idx].updatedAt = new Date().toISOString();
        await _fileFallbackSave(name, items);
        return items[idx];
      });
    },
    async remove(id) {
      return _withLock(name, async () => {
        const items = await _fileFallbackLoad(name);
        const filtered = items.filter(i => i.id !== id);
        if (filtered.length === items.length) throw new Error(`ไม่พบ id: ${id}`);
        await _fileFallbackSave(name, filtered);
        return { removed: true, remaining: filtered.length };
      });
    },
    async removeAll() {
      return _withLock(name, async () => {
        await _fileFallbackSave(name, []);
        return { removedAll: true, remaining: 0 };
      });
    },
    async findById(id) {
      const items = await _fileFallbackLoad(name);
      return items.find(i => i.id === id) || null;
    },
    async count() {
      const items = await _fileFallbackLoad(name);
      return items.length;
    },
  };
}
