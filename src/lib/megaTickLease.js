// ============================================================
// 🏭 MEGA — Tick Lease (ล็อกกัน tick ซ้อน แบบมี "เจ้าของ")
// ------------------------------------------------------------
// ★ 10 ก.ค. Wave1-D (ก): แยกตรรกะ acquire/release ออกจาก route เพื่อ
//   1) ปิดหน้าต่าง race หลัก — เขียน owner แล้ว "อ่านกลับมายืนยัน" (read-after-write)
//      แทนของเดิมที่ อ่าน→เช็ค→เขียน คนละ round-trip (2 tick อ่านพร้อมกันก่อนใครเขียน = ผ่านทั้งคู่)
//   2) release เคลียร์เฉพาะ lease ที่ "เราถือ" (owner token ตรง) — tick เก่าค้าง >10 นาที
//      กลับมาต้องไม่ล้าง lease ของ tick ใหม่
//   3) รับ { getFlags, setFlags } เป็น dependency → mock เทสได้
// kill switch: env MEGA_TICK_LEASE='0' → พฤติกรรมเดิมเป๊ะ (ล็อกด้วย tickLockAt ล้วน ไม่มี owner/ยืนยัน)
// หมายเหตุ: ไม่ใช่ CAS จริงของ store — เป็นการปิด race window หลัก (UI+worker/cron ยิงพร้อมกัน) แบบ best-effort
// ============================================================

import crypto from 'crypto';

export const TICK_LEASE_TTL_MS = 10 * 60 * 1000; // lease เก่ากว่านี้ = ถือว่า tick นั้นตาย → ยึดต่อได้

export function leaseEnabledFromEnv() {
  return process.env.MEGA_TICK_LEASE !== '0';
}

// ยึด lease — คืน { ok, token, busy }
//   deps: { getFlags, setFlags, newToken?, now?, ttlMs?, leaseOn? }  (ตัวหลัง override ได้เพื่อเทส)
export async function acquireTickLease(deps) {
  const {
    getFlags,
    setFlags,
    newToken = () => crypto.randomUUID(),
    now = Date.now(),
    ttlMs = TICK_LEASE_TTL_MS,
    leaseOn = leaseEnabledFromEnv(),
  } = deps;

  const flags = await getFlags();
  const lockAt = flags.tickLockAt ? new Date(flags.tickLockAt).getTime() : 0;
  const fresh = lockAt > 0 && now - lockAt < ttlMs;

  // kill switch: path เดิมเป๊ะ — lock สด → busy · ว่าง/stale → เขียน tickLockAt (ไม่มี owner, ไม่ยืนยัน)
  if (!leaseOn) {
    if (fresh) return { ok: false, busy: true };
    await setFlags({ tickLockAt: new Date(now).toISOString() });
    return { ok: true, token: null };
  }

  // lock สดของคนอื่น (รอบนี้เรายังไม่เคยเขียน owner) → busy เหมือนเดิม
  if (fresh) return { ok: false, busy: true };

  // ว่าง/stale → เขียน owner แล้ว "อ่านกลับมายืนยัน" (ปิดหน้าต่าง race หลัก)
  const token = newToken();
  await setFlags({ tickLockAt: new Date(now).toISOString(), tickLockOwner: token });
  const confirm = await getFlags();
  if (confirm.tickLockOwner !== token) return { ok: false, busy: true }; // แพ้ race — มีคนเขียนทับหลังเรา
  return { ok: true, token };
}

// ปล่อย lease — เคลียร์เฉพาะเมื่อ owner === token เรา
export async function releaseTickLease(deps, token) {
  const { getFlags, setFlags, leaseOn = leaseEnabledFromEnv() } = deps;

  // kill switch: path เดิม — เคลียร์ tickLockAt ไม่เช็คเจ้าของ
  if (!leaseOn) {
    await setFlags({ tickLockAt: null });
    return { released: true, legacy: true };
  }

  const flags = await getFlags();
  if (flags.tickLockOwner === token) {
    await setFlags({ tickLockAt: null, tickLockOwner: null });
    return { released: true };
  }
  // owner เป็นคนอื่น (มีคนยึด lease ใหม่แล้ว) หรือถูกเคลียร์ไปแล้ว → ห้ามแตะ
  return { released: false };
}
