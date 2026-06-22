/**
 * Clip Queue (22 มิ.ย. 69) — คิว + ตัวคุมโหลด เฉพาะ "เครื่องมือถอดคลิป" (clip-transcript / clip-insight)
 * ─────────────────────────────────────────────────────────────────────────────
 * จุดประสงค์ (ตามที่ผู้ใช้สั่ง):
 *   • ไม่ยิงงานหนัก (Gemini ดูคลิป / Whisper ถอดเสียง) ซ้อนกันจนล่ม → ปล่อยทีละจำกัด (FIFO)
 *   • ถ้า API แน่น (เจอ 503 / overload) → "เว้นช่วง" ก่อนปล่อยงานถัดไป แทนที่จะกระหน่ำซ้ำ
 *   • งานที่เข้ามาตอนคิวเต็ม = รอคิว ไม่ใช่ยิงทันที → แต่ละครั้งเสถียร ไม่ชนกันเอง
 *
 * 🔴 แยกอิสระ 100% — ไม่ผูก/ไม่แตะ aiRouter, openai, geminiClient หรือเวิร์กโฟลว์ข่าวอัตโนมัติ
 *    เป็นแค่ "ประตูคิว" ที่ route ของเครื่องมือถอดคลิปเรียกใช้เองเท่านั้น
 *
 * หมายเหตุ: เป็นคิวระดับ process (in-memory) — บนเครื่องทีม (Node รันยาว) คุมได้ทั้งเครื่อง
 *           บน Vercel จะคุมต่อ instance (ก็ยังกันการยิงซ้อนภายใน request เดียวได้)
 */

class ClipQueue {
  constructor({ maxConcurrent = 2, label = 'clip', cooldownSec = 8 } = {}) {
    this.max = Math.max(1, maxConcurrent);
    this.label = label;
    this.cooldownSec = cooldownSec;
    this.active = 0;
    this.q = [];
    this.cooldownUntil = 0;
  }

  // เรียกเมื่อเจอ API แน่น (503/overload) → ตั้งช่วงพักก่อนปล่อยงานถัดไป
  noteOverload(seconds = this.cooldownSec) {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + seconds * 1000);
  }

  /** ส่งงานเข้าคิว — คืน Promise ที่ resolve เมื่องานได้คิวและทำเสร็จ */
  run(fn, { label = '' } = {}) {
    return new Promise((resolve, reject) => {
      this.q.push({ fn, label, resolve, reject, enqueuedAt: Date.now() });
      this._drain();
    });
  }

  _drain() {
    const now = Date.now();
    if (now < this.cooldownUntil) {
      // ยังอยู่ในช่วงพัก (API เพิ่งแน่น) → รอจนพ้น cooldown แล้วลองปล่อยใหม่
      const wait = this.cooldownUntil - now + 50;
      if (!this._cooldownTimer) {
        this._cooldownTimer = setTimeout(() => { this._cooldownTimer = null; this._drain(); }, wait);
      }
      return;
    }
    while (this.active < this.max && this.q.length > 0) {
      const job = this.q.shift();
      this.active++;
      this._exec(job);
    }
  }

  async _exec(job) {
    const waited = Date.now() - job.enqueuedAt;
    if (waited > 500) console.log(`[ClipQueue:${this.label}] ▶ เริ่มงาน${job.label ? ' ' + job.label : ''} (รอคิว ${(waited / 1000).toFixed(1)}s · ค้างคิวอีก ${this.q.length})`);
    try {
      const result = await job.fn();
      job.resolve(result);
    } catch (e) {
      const msg = String(e?.message || '');
      const status = Number(e?.status) || 0;
      if ([429, 500, 502, 503, 504].includes(status) || /high demand|overload|unavailable|temporar|503|429|parse ไม่ได้|deadline|timed out/i.test(msg)) {
        this.noteOverload();
        console.warn(`[ClipQueue:${this.label}] API แน่น (${status || ''}) → เว้นช่วง ${this.cooldownSec}s ก่อนงานถัดไป`);
      }
      job.reject(e);
    } finally {
      this.active--;
      this._drain();
    }
  }

  stats() {
    return { active: this.active, queued: this.q.length, cooldownMs: Math.max(0, this.cooldownUntil - Date.now()) };
  }
}

// ── ลานคิว "งานหนัก" ของเครื่องมือถอดคลิป (Gemini ดูคลิป / Whisper) ──
//    ปล่อยทีละ 2 (พอเร็ว แต่ไม่ยิงรัว) + เว้นช่วง 8s อัตโนมัติเมื่อ API แน่น
let _videoQueue = null;
export function getClipVideoQueue() {
  if (!_videoQueue) {
    const max = Number(process.env.CLIP_QUEUE_CONCURRENCY) || 2;
    _videoQueue = new ClipQueue({ maxConcurrent: max, label: 'video', cooldownSec: 8 });
  }
  return _videoQueue;
}

export { ClipQueue };
