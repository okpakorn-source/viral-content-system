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

import { getSupabase, isSupabaseReady } from './supabase.js';
import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
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
    } catch {
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

async function _fileFallbackLoad(name, { authoritative = false } = {}) {
  // มี key แปลว่าเป็น snapshot ที่อ่าน/เขียนสำเร็จแล้ว แม้ snapshot นั้นจะว่างจริง
  // failed reads ไม่เคยสร้าง key จึงแยกจาก true-empty ได้ด้วย _memCache.has(name)
  // authoritative ต้องอ่านไฟล์หลักจริง เพื่อไม่ให้ cache เก่าบังไฟล์ที่เสียหรือถูกแก้ภายนอก
  if (!authoritative && _memCache.has(name)) return _memCache.get(name);
  
  const filePath = join(process.cwd(), 'data', `${name}.json`);
  try {
    const data = JSON.parse(await readFile(filePath, 'utf-8'));
    if (!Array.isArray(data)) {
      if (authoritative) throw new Error(`Invalid store file format (${name}): expected JSON array`);
      return [];
    }
    const fixedData = data.map(_decodeValue);
    if (authoritative || fixedData.length > 0) _memCache.set(name, fixedData);
    return fixedData;
  } catch (error) {
    if (authoritative && error?.code === 'ENOENT') {
      _memCache.set(name, []);
      return [];
    }
    if (authoritative) {
      if (error?.code === 'STORE_PRIMARY_READ_FAILED') throw error;
      throw _primaryReadError(name, error);
    }
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

async function _fileFallbackSave(name, items, { durable = false } = {}) {
  // Supabase mirror เป็น best-effort จึงอัปเดต memory ได้แม้ดิสก์ใช้ไม่ได้
  // แต่เมื่อ file fallback เป็นฐานหลัก ต้องเขียนดิสก์สำเร็จก่อนจึงอ้างว่าบันทึกแล้ว
  if (!durable) _memCache.set(name, items);
  if (_diskReadOnly) {
    _warnWriteSkipOnce(name, 'Read-only filesystem detected — skipping local JSON cache write (in-memory cache only)');
    if (durable) throw new Error(`File fallback durable write failed: read-only filesystem (${name})`);
    return false;
  }
  const dir = join(process.cwd(), 'data');
  const filePath = join(dir, `${name}.json`);
  const tempPath = `${filePath}.${process.pid || 'process'}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    // เขียนให้ครบในไฟล์ข้างเคียงก่อน แล้วค่อยสลับชื่อครั้งเดียว
    // disk เต็ม/เขียนขาดกลางทางจึงไม่ทำลาย primary เดิม
    await writeFile(tempPath, JSON.stringify(items, null, 2), 'utf-8');
    await rename(tempPath, filePath);
    if (durable) _memCache.set(name, items);
    _warnedWriteSkip.delete(name); // เขียนสำเร็จ = รีเซ็ตตัวกดเงียบ — ถ้าพังใหม่ภายหลังต้องเห็นใน log อีก
    return true;
  } catch (e) {
    try {
      await unlink(tempPath);
    } catch {
      // temp อาจยังไม่ถูกสร้าง หรือ rename สำเร็จไปแล้ว — ไม่มี primary ให้ rollback
    }
    if (/EROFS|read-only/i.test(e.message || '')) {
      _diskReadOnly = true; // serverless จริง — เลิกพยายามทั้ง process กัน log spam
    }
    _warnWriteSkipOnce(name, `File write failed (further failures suppressed): ${e.message}`);
    if (durable) throw new Error(`File fallback durable write failed (${name}): ${e.message}`);
    return false;
  }
}

async function _withLock(name, fn) {
  const previous = _locks.get(name) || Promise.resolve();
  let releaseCurrent;
  const currentGate = new Promise(resolve => { releaseCurrent = resolve; });
  const currentTail = previous.catch(() => {}).then(() => currentGate);
  _locks.set(name, currentTail);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    releaseCurrent();
    if (_locks.get(name) === currentTail) _locks.delete(name);
  }
}

function _primaryReadError(name, error) {
  const failure = new Error(`Primary store read failed (${name}): ${error?.message || 'unknown error'}`);
  failure.code = 'STORE_PRIMARY_READ_FAILED';
  failure.cause = error;
  return failure;
}

// === Card-Library Lab Overlay (F2 — 3 ก.ย. 69) ===
// CARD_LIBRARY_LAB === '1' (default ไม่ตั้ง = ปิด = ทุกเส้นทางเดิมไบต์ต่อไบต์) — เปิดเฉพาะ store 'prompt-library':
//   ทุก op อ่านจากไฟล์ CARD_LIBRARY_OVERLAY_FILE (คลังทั้งชุดของแขนทดลอง) แบบ short-circuit
//   "ก่อน" ถึงสาย Supabase — เพราะ getAll ฝั่ง Supabase sync ทับ data/<name>.json ทุกครั้งที่อ่านสำเร็จ
//   (ดู _fileFallbackSave ใน getAll ด้านล่าง) hook หลัง fetch ไม่ได้ mirror จะถูกทับด้วยคลังแขนทดลอง
//   ทุก op เขียน = no-op ที่คืนค่าเหมือนสำเร็จ + console.warn ครั้งแรก (กัน usage/track ของแล็บปนเปื้อน store จริง)
//   ห้องแล็บต้องไม่เงียบ: ไม่ตั้งพาธ/ไฟล์หาย/JSON พัง/ไม่ใช่ array = throw ทันที ห้าม fallback เงียบๆ
//   ★ ผู้ตรวจไขว้ 3 ก.ย.: ผู้เรียกหลักสายสรุปข่าว (ไฟล์ล็อก) ครอบ getAll ด้วย try/catch — บางจุด catch ว่างเปล่า
//     (`catch (e) { }` ใน getTopPrompts ทั้งสองไฟล์) แล้ว fallback อ่าน data/prompt-library.json ตรง
//     → throw ของแล็บถูกกลืนไร้ร่องรอย แขนทดลองวิ่งด้วยการ์ด prod ทั้งรอบโดยระบบดูปกติ
//     แล็บจึงส่งเสียงเอง ไม่พึ่งผู้เรียก: (ก) ประกาศตัวครั้งเดียวตอนสร้าง store (console.warn + พาธไฟล์แขน)
//     (ข) อ่านพัง = console.error เองทุกครั้งก่อน throw (_labFail) — เสียงรอดแม้ catch ว่าง
//     runbook ทุกรอบแล็บ: grep "CardLibraryLab" ใน log เซิร์ฟ — ไม่มีบรรทัดประกาศตัว = แล็บไม่ได้ทำงาน (เช่น env
//     ไม่ถึงเซิร์ฟ) · เจอบรรทัด "อ่านไฟล์ overlay"/"CARD_LIBRARY_OVERLAY_FILE" ฝั่ง error = ทิ้งผลรอบนั้นทันที
//     (พรีเช็คต่อแขนก่อนเชื่อผล Gate เป็นงานสาย F: เทียบจำนวน+ชุด id ผ่าน GET /api/prompt-library กับไฟล์แขน)
//   กันพลาดบน production: ตรวจพบ VERCEL/VERCEL_ENV = เพิกเฉยสวิตช์ + console.error แล้วใช้เส้นทางเดิม
//   (หมายเหตุ: `vercel env pull` อาจติด VERCEL=1 มาใน .env.local ของเครื่อง dev — ด่านนี้ตั้งใจ fail-closed
//    ถ้าแล็บไม่ยอมทำงานทั้งที่อยู่บนเครื่อง dev ให้ลบตัวแปรนั้นออกจาก env ของรอบรันแล็บ)
const LAB_STORE_NAME = 'prompt-library';
const _labWarnedOnce = new Set();

function _labLogOnce(key, log) {
  if (_labWarnedOnce.has(key)) return;
  _labWarnedOnce.add(key);
  log();
}

// อ่าน overlay พัง = ความผิดปกติที่ทำให้ผล A/B ทั้งรอบใช้ไม่ได้ — ส่งเสียงทุกครั้ง (ไม่กดเงียบแบบ no-op warn)
// เพราะผู้เรียกบางจุดกลืน throw ด้วย catch ว่าง แต่ละบรรทัด error คือหลักฐานหนึ่ง op ที่ไถลไปใช้การ์ด prod
function _labFail(message) {
  console.error(message);
  return new Error(message);
}

async function _labOverlayLoad(name) {
  const overlayPath = process.env.CARD_LIBRARY_OVERLAY_FILE;
  if (!overlayPath) {
    throw _labFail(`[CardLibraryLab:${name}] CARD_LIBRARY_LAB=1 แต่ไม่ได้ตั้ง CARD_LIBRARY_OVERLAY_FILE — ห้องแล็บไม่เดาไฟล์เอง`);
  }
  let raw;
  try {
    raw = await readFile(overlayPath, 'utf-8');
  } catch (error) {
    throw _labFail(`[CardLibraryLab:${name}] อ่านไฟล์ overlay ไม่ได้ (${overlayPath}): ${error?.message || 'unknown error'}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw _labFail(`[CardLibraryLab:${name}] ไฟล์ overlay ไม่ใช่ JSON ที่อ่านได้ (${overlayPath}): ${error?.message || 'unknown error'}`);
  }
  if (!Array.isArray(data)) {
    throw _labFail(`[CardLibraryLab:${name}] ไฟล์ overlay ต้องเป็น JSON array (${overlayPath})`);
  }
  return data.map(_decodeValue);
}

function _createLabOverlayStore(name) {
  const noopWrite = (method, result) => {
    _labLogOnce(`${name}:noop:${method}`, () =>
      console.warn(`[CardLibraryLab:${name}] ${method}() เป็น no-op ในโหมดแล็บ — ไม่เขียน Supabase/ไฟล์ overlay/ไฟล์ mirror`));
    return result;
  };
  return {
    async getAll() {
      return [...(await _labOverlayLoad(name))];
    },
    async findById(id) {
      const items = await _labOverlayLoad(name);
      return items.find(i => i.id === id) || null;
    },
    async count() {
      return (await _labOverlayLoad(name)).length;
    },
    async add(item) {
      return noopWrite('add', item);
    },
    async addMany(newItems) {
      return noopWrite('addMany', newItems || []);
    },
    async update(id, updateFn) {
      // อ่านจาก overlay เพื่อคืนค่ารูปเดียวกับ store จริง (สัญญาแบบ Supabase mode) — แต่ไม่เขียนอะไรทั้งสิ้น
      const items = await _labOverlayLoad(name);
      const existing = items.find(i => i.id === id);
      if (!existing) throw new Error(`ไม่พบ id: ${id}`);
      let updated;
      if (typeof updateFn === 'function') {
        updated = updateFn(existing);
      } else {
        updated = { ...existing, ...updateFn };
      }
      updated.updatedAt = new Date().toISOString();
      return noopWrite('update', updated);
    },
    async remove(_id) {
      return noopWrite('remove', { removed: true });
    },
    async removeAll() {
      return noopWrite('removeAll', { removedAll: true });
    },
  };
}

// === Main Store Factory ===
export function createStore(name) {

  // ===== CARD-LIBRARY LAB OVERLAY (F2) — ต้องมาก่อนสาย Supabase เสมอ =====
  if (process.env.CARD_LIBRARY_LAB === '1' && name === LAB_STORE_NAME) {
    if (process.env.VERCEL || process.env.VERCEL_ENV) {
      _labLogOnce(`${name}:vercel`, () =>
        console.error(`[CardLibraryLab:${name}] CARD_LIBRARY_LAB=1 ถูกเพิกเฉย — ตรวจพบ Vercel env (VERCEL/VERCEL_ENV) ห้องแล็บใช้ได้เฉพาะนอก production`));
    } else {
      // ประกาศตัวครั้งเดียวต่อ process: runbook grep "CardLibraryLab" ใช้บรรทัดนี้ยืนยันว่าแล็บทำงานจริง
      // และตรวจว่าใช้ไฟล์แขนถูกตัว — ไม่มีบรรทัดนี้ในรอบที่ตั้งใจเปิดแล็บ = env ไม่ถึงเซิร์ฟ ทิ้งผลรอบนั้น
      // อ่านใส่ตัวแปรก่อนค่อยเติมข้อความ "ยังไม่ตั้ง" — กันตัวสแกนทะเบียนสวิตช์ตีความสตริงนี้เป็น default ของ env
      const overlayPathShown = process.env.CARD_LIBRARY_OVERLAY_FILE;
      _labLogOnce(`${name}:active`, () =>
        console.warn(`[CardLibraryLab:${name}] โหมดแล็บทำงาน — อ่านทุก op จากไฟล์ overlay: ${overlayPathShown || '<CARD_LIBRARY_OVERLAY_FILE ยังไม่ตั้ง — ทุกการอ่านจะ throw>'} · ทุกการเขียนไม่แตะ Supabase/mirror`));
      return _createLabOverlayStore(name);
    }
  }

  // ===== SUPABASE MODE =====
  if (isSupabaseReady()) {
    return {
      async getAll({ authoritative = false } = {}) {
        return _withLock(name, async () => {
          try {
            const sb = getSupabase();
            // ★ 26 มิ.ย.: ดึงครบทุกแถว (แบ่งหน้า 1000) — เดิม Supabase คืนแค่ 1000 แถวใหม่สุด → แถวเก่าเกินนั้น "กำพร้า"
            //   ระบบลบของเก่า (auto-purge) ใช้ getAll → มองไม่เห็นแถวกำพร้า → ตารางบวมจน egress พุ่ง (เคยโดน 21k)
            //   เลนเล็ก: จบหน้าเดียว (เร็วเท่าเดิม) · cap 20000 กัน loop ค้าง
            const data = [];
            let error = null;
            let partialError = null; // ★ หน้า 2+ พัง = ข้อมูลไม่ครบ — ห้ามนับเป็นสำเร็จเต็ม (กัน cache ถูกทับด้วยชุดตัดครึ่ง)
            for (let from = 0; from < 20000; from += 1000) {
              // eslint-disable-next-line no-await-in-loop -- each page determines whether another page is required
              const page = await sb
                .from(TABLE)
                .select('data')
                .eq('store_name', name)
                .order('created_at', { ascending: false })
                .range(from, from + 999);
              if (page.error) {
                if (from === 0) error = page.error;
                else partialError = page.error;
                break;
              }
              if (!page.data || page.data.length === 0) break;
              data.push(...page.data);
              if (page.data.length < 1000) break;
            }

            if (error) {
              if (authoritative) throw _primaryReadError(name, error);
              console.warn(`[Store:${name}] Supabase query error: ${error.message} — falling back to local file`);
              const localData = await _fileFallbackLoad(name);
              console.log(`[Store:${name}] 📁 Fallback: ${localData.length} items from local file`);
              return [...localData];
            }
            const items = data.map(row => _decodeValue(row.data));

            // ครบ 20,000 แถวพอดียังสรุปไม่ได้ว่าข้อมูลครบ — authoritative ต้อง probe แถวถัดไป
            if (authoritative && data.length === 20000) {
              const overflow = await sb
                .from(TABLE)
                .select('data')
                .eq('store_name', name)
                .order('created_at', { ascending: false })
                .range(20000, 20000);
              if (overflow.error) throw _primaryReadError(name, overflow.error);
              if (overflow.data?.length > 0) {
                throw _primaryReadError(name, new Error('Authoritative read exceeds 20,000-row safety limit'));
              }
            }

            // ถ้าต้องใช้ข้อมูลครบเพื่อคุม revision ห้ามแทนผลว่างจากฐานหลักด้วย local cache
            if (items.length === 0 && !authoritative) {
              const localData = await _fileFallbackLoad(name);
              if (localData.length > 0) {
                console.log(`[Store:${name}] ⚠️ Supabase returned 0 but local has ${localData.length} — using local`);
                return [...localData];
              }
            }

            if (partialError) {
              if (authoritative) throw _primaryReadError(name, partialError);
              // ได้มาบางส่วน: ใช้งานต่อได้ แต่ห้าม sync ทับไฟล์ fallback — ไฟล์เดิมอาจครบกว่า
              console.warn(`[Store:${name}] ⚠️ Loaded ${items.length} items แต่หน้าถัดไปพัง (${partialError.message}) — ข้อมูลอาจไม่ครบ ไม่เขียนทับ local cache`);
              return items;
            }
            console.log(`[Store:${name}] ✅ Loaded ${items.length} items from Supabase`);
            // Sync to local file cache for offline use
            if (authoritative || items.length > 0) await _fileFallbackSave(name, items);
            return items;
          } catch (fetchErr) {
            if (authoritative) {
              if (fetchErr?.code === 'STORE_PRIMARY_READ_FAILED') throw fetchErr;
              throw _primaryReadError(name, fetchErr);
            }
            console.warn(`[Store:${name}] Supabase fetch failed: ${fetchErr.message} — falling back to local file`);
            const localData = await _fileFallbackLoad(name);
            console.log(`[Store:${name}] 📁 Fallback: ${localData.length} items from local file`);
            return [...localData];
          }
        });
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
        _withLock(name, async () => {
          const items = await _fileFallbackLoad(name);
          const filtered = items.filter(i => i.id !== item.id);
          filtered.unshift(item); // Put newest first
          await _fileFallbackSave(name, filtered);
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
        _withLock(name, async () => {
          const items = await _fileFallbackLoad(name);
          const newIds = new Set(fresh.map(i => i.id));
          const filtered = items.filter(i => !newIds.has(i.id));
          await _fileFallbackSave(name, [...fresh, ...filtered]);
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

        // ★ 1 ส.ค. 69 (ออดิต): sync local cache ตามกฎ AGENTS.md ข้อ 10 — เดิม update() ตกหล่นตัวเดียว ไฟล์ค้างตั้งแต่ 1 ก.ค.
        //   ★ Sol ตรวจจับ: read-modify-write ต้อง serialize ผ่าน _withLock กันชนกับตัวเขียนแคชอื่น (ตัว fire-and-forget คงไว้ ไม่บล็อกเส้นร้อน)
        _withLock(name, async () => {
          const items = await _fileFallbackLoad(name);
          if (!items.length) return; // ไฟล์อ่านพลาด/แคชว่าง — ห้ามเซฟทับจนเหลือรายการเดียว (getAll รอบถัดไป sync เต็มชุดเอง)
          const idx = items.findIndex(i => i.id === id);
          if (idx >= 0) items[idx] = updated; else items.unshift(updated);
          await _fileFallbackSave(name, items);
        }).catch(() => {});

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
        await _withLock(name, async () => {
          const localData = await _fileFallbackLoad(name);
          const filtered = localData.filter(i => i.id !== id);
          await _fileFallbackSave(name, filtered);
        }).catch(() => {});
        
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
        await _withLock(name, () => _fileFallbackSave(name, [])).catch(() => {});
        
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
    async getAll({ authoritative = false } = {}) {
      return [...(await _fileFallbackLoad(name, { authoritative }))];
    },
    async add(item) {
      return _withLock(name, async () => {
        const items = (await _fileFallbackLoad(name, { authoritative: true })).map(_decodeValue);
        if (items.some(existing => existing.id === item.id)) {
          throw new Error(`duplicate key value violates unique constraint: ${item.id}`);
        }
        items.push(item);
        await _fileFallbackSave(name, items, { durable: true });
        return item;
      });
    },
    async addMany(newItems) {
      return _withLock(name, async () => {
        const items = (await _fileFallbackLoad(name, { authoritative: true })).map(_decodeValue);
        items.push(...newItems);
        await _fileFallbackSave(name, items, { durable: true });
        return newItems;
      });
    },
    async update(id, updateFn) {
      return _withLock(name, async () => {
        const items = (await _fileFallbackLoad(name, { authoritative: true })).map(_decodeValue);
        const idx = items.findIndex(i => i.id === id);
        if (idx < 0) throw new Error(`ไม่พบ id: ${id}`);
        if (typeof updateFn === 'function') {
          items[idx] = updateFn(items[idx]);
        } else {
          Object.assign(items[idx], updateFn);
        }
        items[idx].updatedAt = new Date().toISOString();
        await _fileFallbackSave(name, items, { durable: true });
        return items[idx];
      });
    },
    async remove(id) {
      return _withLock(name, async () => {
        const items = await _fileFallbackLoad(name, { authoritative: true });
        const filtered = items.filter(i => i.id !== id);
        if (filtered.length === items.length) throw new Error(`ไม่พบ id: ${id}`);
        await _fileFallbackSave(name, filtered, { durable: true });
        return { removed: true, remaining: filtered.length };
      });
    },
    async removeAll() {
      return _withLock(name, async () => {
        await _fileFallbackLoad(name, { authoritative: true });
        await _fileFallbackSave(name, [], { durable: true });
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
