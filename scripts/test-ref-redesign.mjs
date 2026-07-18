// ============================================================
// 🧪 test-ref-redesign — เทส logic ref-redesign เฟส 1 (structure-only, Supabase-backed store)
// ------------------------------------------------------------
// ไม่ยิง Supabase/network จริง: ใช้ fake in-memory store (getAll/add/remove) แทน createStore()
//   จาก persistStore.js แล้ว replicate ตรรกะของ src/lib/refCoverLibrary.js (listRefCovers/addRefCover/
//   deleteRefCover/updateRefCover/clearAllRefCovers) ทับ fake store นั้น — พิสูจน์ invariant สำคัญ:
//   1) entry ที่เกิดจาก addRefCover ต้องไม่มี key imagePath (ref = โครงล้วน)
//   2) listRefCovers คืนใหม่สุดก่อน (sort ตาม uploadedAt desc) + เคารพ limit
//   3) deleteRefCover: id ไม่พบ → คืน 0 (ไม่ throw) · id พบ → ลบจริงคืน 1
//   4) updateRefCover: id ไม่พบ → คืน null (ไม่ throw) · id พบ → merge patch คงฟิลด์เดิมที่ไม่ถูกแตะ
//   5) clearAllRefCovers: ล้างคลังหมด คืนจำนวนที่ลบ
// รัน: node scripts/test-ref-redesign.mjs
// ============================================================

let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name} — ${e.message}`);
  }
}

// ---- fake store: mimics createStore(name) contract — in-memory only, no I/O ----
//   ตรงพฤติกรรมจริงของ persistStore.js:
//     getAll() → array · add(item) · remove(id)
//     update(id, fnOrObj) → merge {...existing,...obj} (หรือเรียก fn) + set updatedAt แล้วเขียนตรง;
//       **throw Error("ไม่พบ id: ...")** เมื่อไม่พบ id (atomic ไม่ remove→add)
//     removeAll() → ลบทุก item ของ store นี้
function makeFakeStore() {
  let arr = [];
  return {
    async getAll() {
      return [...arr];
    },
    async add(item) {
      arr.push(item);
      return item;
    },
    async remove(id) {
      arr = arr.filter((x) => x.id !== id);
      return { removed: true };
    },
    async update(id, updateFn) {
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) throw new Error(`ไม่พบ id: ${id}`);
      const updated =
        typeof updateFn === 'function' ? updateFn(arr[idx]) : { ...arr[idx], ...updateFn };
      updated.updatedAt = new Date().toISOString();
      arr[idx] = updated;
      return updated;
    },
    async removeAll() {
      arr = [];
      return { removedAll: true };
    },
    _dump() {
      return arr;
    },
  };
}

// ---- replicate refCoverLibrary.js logic verbatim (against the fake store, not the real one) ----
function makeLib(store) {
  return {
    async listRefCovers(limit = 500) {
      const all = await store.getAll();
      return all
        .slice()
        .sort((a, b) => String(b?.uploadedAt || '').localeCompare(String(a?.uploadedAt || '')))
        .slice(0, limit);
    },
    async addRefCover(rec = {}) {
      const entry = {
        id: rec.id || `REF-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        uploadedAt: new Date().toISOString(),
        styleName: rec.styleName || '',
        dna: rec.dna || null,
        dnaError: rec.dnaError || null,
      };
      await store.add(entry);
      return entry;
    },
    async deleteRefCover(id) {
      const all = await store.getAll();
      const exists = all.some((x) => x.id === id);
      if (exists) await store.remove(id);
      return exists ? 1 : 0;
    },
    async updateRefCover(id, patch = {}) {
      try {
        return await store.update(id, patch);
      } catch {
        return null;
      }
    },
    async clearAllRefCovers() {
      const all = await store.getAll();
      const n = all.length;
      await store.removeAll();
      return n;
    },
  };
}

// ============================================================
// 1) addRefCover — ไม่มี key imagePath + id/defaults ถูกต้อง
// ============================================================

await test('addRefCover: entry ไม่มี key imagePath เลย', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  const entry = await lib.addRefCover({ styleName: 'ดราม่า', dna: { slots: [] } });
  assert(!('imagePath' in entry), 'ห้ามมี key imagePath ในระเบียนใหม่');
});

await test('addRefCover: auto id ขึ้นต้น REF- + มี uploadedAt เป็น ISO string', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  const entry = await lib.addRefCover({ styleName: 'x' });
  assert(/^REF-/.test(entry.id), `id ต้องขึ้นต้นด้วย REF- (ได้ ${entry.id})`);
  assert(!Number.isNaN(Date.parse(entry.uploadedAt)), 'uploadedAt ต้อง parse เป็นวันที่ได้');
});

await test('addRefCover: id ที่ส่งมาเอง ต้องถูกใช้ตรงๆ ไม่สุ่มทับ', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  const entry = await lib.addRefCover({ id: 'REF-fixed-001', styleName: 'x' });
  assert(entry.id === 'REF-fixed-001', `id ต้องเป็นค่าที่ส่งมา (ได้ ${entry.id})`);
});

await test('addRefCover: dna/dnaError default เป็น null เมื่อไม่ส่งมา, styleName default เป็น ""', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  const entry = await lib.addRefCover({});
  assert(entry.dna === null, 'dna default ต้อง null');
  assert(entry.dnaError === null, 'dnaError default ต้อง null');
  assert(entry.styleName === '', 'styleName default ต้องเป็นสตริงว่าง');
});

await test('addRefCover: สอง entry ที่ไม่ส่ง id ต้องได้ id ต่างกัน (กันชนคลัง)', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  const a = await lib.addRefCover({});
  const b = await lib.addRefCover({});
  assert(a.id !== b.id, `id ต้องไม่ซ้ำกัน (ได้ ${a.id} กับ ${b.id})`);
});

// ============================================================
// 2) listRefCovers — ใหม่สุดก่อน + เคารพ limit
// ============================================================

await test('listRefCovers: เรียงใหม่สุดก่อน (uploadedAt desc)', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  // seed ตรงๆ ผ่าน store (บายพาส addRefCover) กัน flaky จาก Date.now() ความละเอียด ms
  await store.add({ id: 'A', uploadedAt: '2026-07-01T00:00:00.000Z' });
  await store.add({ id: 'B', uploadedAt: '2026-07-15T00:00:00.000Z' });
  await store.add({ id: 'C', uploadedAt: '2026-07-10T00:00:00.000Z' });
  const list = await lib.listRefCovers();
  const ids = list.map((x) => x.id);
  assert(JSON.stringify(ids) === JSON.stringify(['B', 'C', 'A']), `ต้องเรียง B,C,A (ได้ ${ids.join(',')})`);
});

await test('listRefCovers: จำกัดจำนวนด้วย limit', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  await store.add({ id: 'A', uploadedAt: '2026-07-01T00:00:00.000Z' });
  await store.add({ id: 'B', uploadedAt: '2026-07-15T00:00:00.000Z' });
  await store.add({ id: 'C', uploadedAt: '2026-07-10T00:00:00.000Z' });
  const list = await lib.listRefCovers(2);
  assert(list.length === 2, `limit=2 ต้องได้ 2 รายการ (ได้ ${list.length})`);
  assert(list[0].id === 'B' && list[1].id === 'C', `ต้องได้ใหม่สุด 2 อันดับแรก B,C (ได้ ${list.map((x) => x.id).join(',')})`);
});

await test('listRefCovers: คลังว่าง → คืน array ว่าง ไม่ throw', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  const list = await lib.listRefCovers();
  assert(Array.isArray(list) && list.length === 0, 'คลังว่างต้องคืน [] ');
});

// ============================================================
// 3) deleteRefCover — missing→0, พบ→ลบจริงคืน 1
// ============================================================

await test('deleteRefCover: id ไม่พบ → คืน 0 (ไม่ throw)', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  await lib.addRefCover({ id: 'REF-1' });
  const n = await lib.deleteRefCover('REF-ไม่มีจริง');
  assert(n === 0, `id ไม่พบต้องคืน 0 (ได้ ${n})`);
  const remaining = await store.getAll();
  assert(remaining.length === 1, 'ของเดิมต้องยังอยู่ครบ ไม่ถูกลบผิดตัว');
});

await test('deleteRefCover: id พบ → ลบจริง คืน 1', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  await lib.addRefCover({ id: 'REF-1' });
  await lib.addRefCover({ id: 'REF-2' });
  const n = await lib.deleteRefCover('REF-1');
  assert(n === 1, `id พบต้องคืน 1 (ได้ ${n})`);
  const remaining = await store.getAll();
  assert(remaining.length === 1 && remaining[0].id === 'REF-2', 'ต้องเหลือแค่ REF-2');
});

// ============================================================
// 4) updateRefCover — missing→null, พบ→merge patch คงฟิลด์เดิม
// ============================================================

await test('updateRefCover: id ไม่พบ → คืน null (ไม่ throw)', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  const updated = await lib.updateRefCover('REF-ไม่มีจริง', { styleName: 'x' });
  assert(updated === null, `id ไม่พบต้องคืน null (ได้ ${JSON.stringify(updated)})`);
});

await test('updateRefCover: id พบ → merge patch (atomic), คงฟิลด์เดิมที่ patch ไม่แตะ', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  const entry = await lib.addRefCover({ id: 'REF-1', styleName: 'เดิม', dna: { a: 1 } });
  const updated = await lib.updateRefCover('REF-1', { styleName: 'ใหม่' });
  assert(updated.styleName === 'ใหม่', 'styleName ต้องถูกแทนที่');
  assert(updated.id === entry.id, 'id ต้องคงเดิม');
  assert(JSON.stringify(updated.dna) === JSON.stringify({ a: 1 }), 'dna ที่ patch ไม่แตะต้องคงเดิม');
  assert(typeof updated.updatedAt === 'string', 'store.update ต้อง set updatedAt');
  const all = await store.getAll();
  assert(all.length === 1, 'ต้องไม่มี entry ซ้ำหลัง update (atomic UPDATE ตรง ไม่ remove→add)');
});

// ============================================================
// 5) clearAllRefCovers — ล้างหมด คืนจำนวนที่ลบ
// ============================================================

await test('clearAllRefCovers: ล้างคลังทั้งหมด คืนจำนวนที่ลบ', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  await lib.addRefCover({ id: 'REF-1' });
  await lib.addRefCover({ id: 'REF-2' });
  await lib.addRefCover({ id: 'REF-3' });
  const n = await lib.clearAllRefCovers();
  assert(n === 3, `ต้องคืนจำนวนที่ลบ = 3 (ได้ ${n})`);
  const remaining = await store.getAll();
  assert(remaining.length === 0, 'คลังต้องว่างหลัง clear');
});

await test('clearAllRefCovers: คลังว่างอยู่แล้ว → คืน 0 ไม่ throw', async () => {
  const store = makeFakeStore();
  const lib = makeLib(store);
  const n = await lib.clearAllRefCovers();
  assert(n === 0, `คลังว่างต้องคืน 0 (ได้ ${n})`);
});

// ---------- สรุป ----------

console.log('------------------------------------------------------------');
console.log(`สรุป: PASS ${pass} / FAIL ${fail} (รวม ${pass + fail} เทส)`);
process.exitCode = fail > 0 ? 1 : 0;
