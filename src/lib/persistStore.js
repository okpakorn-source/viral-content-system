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

async function _fileFallbackLoad(name) {
  if (_memCache.has(name)) return _memCache.get(name);
  
  const filePath = join(process.cwd(), 'data', `${name}.json`);
  try {
    const data = JSON.parse(await readFile(filePath, 'utf-8'));
    _memCache.set(name, data);
    return data;
  } catch {
    _memCache.set(name, []);
    return [];
  }
}

async function _fileFallbackSave(name, items) {
  _memCache.set(name, items);
  try {
    const dir = join(process.cwd(), 'data');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.json`), JSON.stringify(items, null, 2), 'utf-8');
  } catch (e) {
    console.error(`[Store:${name}] File write failed:`, e.message);
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
        const sb = getSupabase();
        const { data, error } = await sb
          .from(TABLE)
          .select('data')
          .eq('store_name', name)
          .order('created_at', { ascending: false });
        
        if (error) {
          console.error(`[Store:${name}] GET error:`, error.message);
          throw new Error(error.message);
        }
        const items = (data || []).map(row => row.data);
        console.log(`[Store:${name}] ✅ Loaded ${items.length} items from Supabase`);
        return items;
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
        console.log(`[Store:${name}] ✅ Added: ${item.id}`);
        return item;
      },
      
      async addMany(newItems) {
        const sb = getSupabase();
        const rows = newItems.map(item => ({
          id: item.id,
          store_name: name,
          data: item,
          created_at: item.createdAt || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        const { error } = await sb.from(TABLE).insert(rows);
        if (error) {
          console.error(`[Store:${name}] ADD MANY error:`, error.message);
          throw new Error(`บันทึกไม่สำเร็จ: ${error.message}`);
        }
        console.log(`[Store:${name}] ✅ Added ${newItems.length} items`);
        return newItems;
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
        console.log(`[Store:${name}] ✅ Deleted: ${id}`);
        return { removed: true };
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
        return data?.data || null;
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
