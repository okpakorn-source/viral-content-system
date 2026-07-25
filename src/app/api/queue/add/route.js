import { NextResponse } from 'next/server';
import { enqueueJob } from '@/lib/services/queueService';
import { createStore } from '@/lib/persistStore';
import { createLogger } from '@/lib/logger';

const logger = createLogger('QUEUE_ADD');

export const runtime = 'nodejs'; // Use Node.js runtime for API
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req) {
  try {
    // 1. Verify API Key
    const authHeader = req.headers.get('authorization') || '';
    const apiKeyHeader = req.headers.get('x-api-key') || '';
    const expectedKey = process.env.API_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-key';
    const discordKey = process.env.DISCORD_API_SECRET;
    
    // Auth: allow same-origin web requests (no auth header needed)
    // Only enforce auth for external callers (Discord, etc)
    if (authHeader || apiKeyHeader) {
      const isAuthorized = 
        (authHeader === `Bearer ${expectedKey}` || apiKeyHeader === expectedKey) ||
        (discordKey && apiKeyHeader === discordKey);
        
      if (!isAuthorized) {
        return NextResponse.json({ success: false, error: 'Unauthorized', errorType: 'UNAUTHORIZED' }, { status: 401 });
      }
    }
    // No auth header = same-origin web request = allowed
    
    // 2. Parse payload
    let payload;
    try {
      payload = await req.json();
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    
    // ★ Cover job (jobType: 'cover') — งานสร้างปกใช้ newsTitle/content แทน input/url/text
    //   worker จะส่งต่อไป /api/auto-cover (ข่าวปกติยังไป /api/auto/process เหมือนเดิม)
    const isCoverJob = payload.jobType === 'cover';
    if (isCoverJob) {
      if (!payload.newsTitle && !payload.content) {
        return NextResponse.json({
          success: false,
          error: 'Cover job ต้องระบุ newsTitle หรือ content',
          errorType: 'VALIDATION_ERROR',
        }, { status: 400 });
      }
      // สร้าง dedupe key รูปแบบเดียวกับ input ของข่าว — ให้ queueService กันงานปกซ้ำได้
      if (!payload.input) {
        payload.input = `[cover] ${(payload.newsTitle || payload.content).substring(0, 120)} | ${payload.templateId || 'auto'}`;
      }
    } else if (!payload.input && !payload.url && !payload.text) {
      return NextResponse.json({ success: false, error: 'Missing input/url/text in payload' }, { status: 400 });
    }

    // ★ Garbage-input guard: input ที่ encoding พัง (เต็มไปด้วย "?") จะทำให้ AI แต่งข่าวมั่วทั้งเรื่อง
    const _rawInput = String(payload.input || payload.text || '');
    if (_rawInput.length > 30) {
      const _qMarks = (_rawInput.match(/\?/g) || []).length;
      if (_qMarks / _rawInput.length > 0.3) {
        return NextResponse.json({
          success: false,
          error: 'ข้อความที่ส่งมามีตัวอักษรเสียหาย (encoding) จำนวนมาก — กรุณาวางข้อความใหม่อีกครั้ง',
          errorType: 'GARBLED_INPUT',
        }, { status: 400 });
      }
    }

    // ★ 16 ก.ค. 69: TEXT-ONLY MODE — ปิดรับเจนข่าวจากลิงก์/รูปทุกชนิด (คำสั่งเจ้าของระบบ:
    //   เวิร์กโฟลว์จริงสรุปเนื้อข่าวเป็นข้อความก่อนเสมอ · สาย URL/คลิป/รูปคุณภาพไม่ถึง จึงปิดสวิตช์ลดปัญหา)
    //   ครอบเฉพาะงานเจนข่าว — งานปก (cover) และงานถอดคลิป (mineclip) ใช้คิวเดียวกันแต่ไม่ถูกบล็อก
    //   เปิดคืนชั่วคราว: ตั้ง env TEXT_ONLY_MODE=0 · ห้ามลบโค้ดสาย URL (กฎห้ามลบ fallback)
    const _textOnly = process.env.TEXT_ONLY_MODE !== '0';
    const _isNewsGenJob = !isCoverJob && payload.jobType !== 'mineclip';
    if (_textOnly && _isNewsGenJob) {
      const _hasUrl = !!payload.url || /https?:\/\//i.test(_rawInput);
      const _hasImages = Array.isArray(payload.images) && payload.images.length > 0;
      if (_hasUrl || _hasImages) {
        return NextResponse.json({
          success: false,
          error: 'โหมดข้อความเท่านั้น: ระบบปิดรับการเจนข่าวจากลิงก์/รูปชั่วคราว — กรุณาสรุปเนื้อข่าวเป็นข้อความล้วน (ไม่มีลิงก์) แล้วส่งใหม่',
          errorType: 'TEXT_ONLY_MODE',
        }, { status: 400 });
      }
    }
    
    // ★ 25 มิ.ย. (สืบบอทซ้ำ): บันทึก ping — ใคร (instance) ยิงข้อความไหน (msgId) เข้าคิว · เก็บ 30 ล่าสุด
    //   query store 'bot-pings' → instance ต่างกัน 2 ตัว = 2 บอท · msgId เดียวจาก 2 instance = 2 บอทจริง
    if (payload._botInstance || payload._msgId) {
      try {
        const pingStore = createStore('bot-pings');
        await pingStore.add({
          id: `ping_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          instance: payload._botInstance || 'unknown',
          msgId: payload._msgId || '',
          content: String(payload.input || payload.url || '').slice(0, 40),
          at: new Date().toISOString(),
        });
        const all = await pingStore.getAll();
        if (all.length > 30) {
          const old = all.sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, all.length - 30);
          for (const o of old) await pingStore.remove(o.id).catch(() => {});
        }
      } catch { /* ping ล้มเหลว = ไม่เป็นไร ไม่กระทบการเข้าคิว */ }
    }

    // ★ 27 มิ.ย. (แก้ Discord เบิ้ลถาวร): ATOMIC CLAIM ตาม msgId — กันแน่นกว่า content-hash
    //   Discord 1 ข้อความ = msgId เดียว · 2 instance เห็นข้อความเดียวกัน → claim id `mc_<msgId>` ตัวเดียวกัน
    //   Postgres PK (id ซ้ำ insert ไม่ได้) = คนแรกชนะ คนหลัง insert ชน 23505 → คืน duplicate:true → บอทตัวซ้ำเงียบ+ลบ ack
    //   ★ จับ race ที่ content-hash dedup พลาด (2 job ลำดับ 1+2) — เพราะ msgId ล็อกก่อน enqueue เลย
    if (payload._msgId) {
      try {
        const claimStore = createStore('msg-claims');
        await claimStore.add({ id: `mc_${payload._msgId}`, msgId: String(payload._msgId), instance: payload._botInstance || '', at: new Date().toISOString() });
        // prune เบา ๆ (นาน ๆ ที) กันตารางบวม — เก็บล่าสุด ~1000
        if (Math.random() < 0.03) {
          const all = await claimStore.getAll();
          if (all.length > 1000) {
            const old = all.sort((a, b) => new Date(a.at) - new Date(b.at)).slice(0, all.length - 1000);
            for (const o of old) await claimStore.remove(o.id).catch(() => {});
          }
        }
      } catch (e) {
        if (/duplicate key|23505|_pkey|already exists/i.test(String(e?.message || ''))) {
          logger.info(`[Queue] ⏭️ msgId ${payload._msgId} ถูก claim แล้ว (อีก instance) → duplicate เงียบ`);
          return NextResponse.json({ success: true, duplicate: true, jobId: `mc_${payload._msgId}`, position: 0, message: 'duplicate message — already claimed by another instance' });
        }
        // error อื่น (Supabase สะดุด) → ไม่บล็อก ปล่อยเข้าคิวปกติ (ยอมเสี่ยงเบิ้ลดีกว่าค้างทั้งระบบ)
        logger.warn(`[Queue] msg-claim error (ปล่อยผ่าน): ${String(e?.message || '').slice(0, 60)}`);
      }
    }

    // ★ 10 ก.ค. (ผู้ใช้ขอเทสผลลัพธ์ซ้ำ): พิมพ์ "ทำใหม่" นำหน้าข่าว = ตั้งใจสั่งเจนซ้ำ → ข้ามด่าน near-dup 45 นาทีด้านล่าง
    //   ตัดคำนำหน้าออกก่อนเข้าท่อ เนื้อที่เจนจึงสะอาดเท่าส่งปกติ · ด่าน msg-claim ด้านบนยังทำงาน (กันบอทเบิ้ล event เดิม)
    let _forceRegen = false;
    for (const _k of ['input', 'text']) {
      const _v = String(payload[_k] || '');
      // ★ ทนเครื่องหมายคำพูด/วงเล็บที่คนก๊อบติดมา เช่น «"ทำใหม่ " เนื้อข่าว» (เคสจริง 10 ก.ค. ผู้ใช้ก๊อบจากข้อความ ⚠️)
      const _m = _v.match(/^\s*["'“”‘’(\[]*\s*(?:ทำใหม่|!again)\s*["'“”‘’)\]]*\s*[:：]?\s*/);
      if (_m && _v.length > _m[0].length) {
        _forceRegen = true;
        payload[_k] = _v.slice(_m[0].length);
      }
    }
    if (_forceRegen) logger.info('[Queue] 🔁 force-regen: ผู้ใช้พิมพ์ "ทำใหม่" นำหน้า — ข้ามด่าน near-dup ตามสั่ง');

    // ★ 4 ก.ค. (ผู้ใช้: "Discord ประมวลผลเบิ้ล ให้เหลืออันเดียว"): ด่านกัน "ข่าวเนื้อเดิม/เกือบเดิมส่งซ้ำ" ใน 45 นาที
    //   หลักฐาน 3 ก.ค.: "บอย ปกรณ์" ถูกส่ง 2 ข้อความห่าง 10 นาที (แก้คำนิดเดียว) → เจน 2 เคส (20:48/20:58)
    //   ช่องโหว่เดิม: dedup เทียบ hash เป๊ะ + งาน "เสร็จแล้ว" ส่งซ้ำ=เจนใหม่ได้เสมอ (ทีมขอ 17 มิ.ย.) → เนื้อเดิมวางซ้ำ = เบิ้ล
    //   ประนีประนอม: บล็อกเฉพาะ "คล้าย ≥62% ภายใน 45 นาที" + งานล้ม/ยกเลิกส่งซ้ำได้เสมอ + เกิน 45 นาทีเจนใหม่ได้ตามเดิม
    //   ★ เฉพาะงานข่าว (ไม่แตะ cover — เทสปกซ้ำโดยตั้งใจ) · ล้มเงียบ = ปล่อยผ่าน (ห้ามบล็อกทั้งระบบเพราะด่านตัวเอง)
    if (payload.jobType !== 'cover' && !_forceRegen) {
      try {
        const _norm = (s) => String(s || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/\s+/g, '');
        const _grams = (s) => { const g = new Set(); const t = _norm(s); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
        const _jac = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
        const _inpNow = String(payload.input || payload.url || payload.text || '');
        if (_inpNow.length >= 60) { // ข้อความสั้น/URL เดี่ยว ไม่เช็ค (URL มี dedup ฝั่งบอทอยู่แล้ว)
          const qStore = createStore('job_queue');
          const _all = await qStore.getAll();
          const _cut = Date.now() - 45 * 60 * 1000;
          const _gNow = _grams(_inpNow);
          for (const j of _all) {
            if (!j || j.status === 'failed' || j.status === 'cancelled' || j.status === 'superseded') continue; // ล้มแล้วส่งซ้ำ = ต้องผ่าน
            if (new Date(j.createdAt || 0).getTime() < _cut) continue;
            const _inpOld = String(j.payload?.input || j.payload?.url || j.payload?.text || '');
            if (_inpOld.length < 60) continue;
            const _sim = _jac(_gNow, _grams(_inpOld));
            // ★ เกณฑ์ 0.62 จากเทสจริง: เนื้อเดิมแก้คำ=0.745 / ส่งซ้ำเป๊ะ=1.0 / คนเดิมคนละข่าว=0.138 / คนละข่าว=0.083 — ช่องว่างกว้าง ปลอดภัยทั้งสองทาง
            if (_sim >= 0.62) {
              const _mins = Math.max(1, Math.round((Date.now() - new Date(j.createdAt).getTime()) / 60000));
              logger.info(`[Queue] ⏭️ near-duplicate (คล้าย ${Math.round(_sim * 100)}%) กับ job ${String(j.id).slice(0, 10)} เมื่อ ${_mins} นาทีก่อน — บล็อกกันเบิ้ล`);
              return NextResponse.json({
                success: false,
                error: `ข่าวนี้เพิ่งถูกส่งทำไปแล้วเมื่อ ${_mins} นาทีก่อน (เนื้อหาเหมือนเดิม ~${Math.round(_sim * 100)}% · สถานะ: ${j.status === 'completed' ? 'เสร็จแล้ว — เลื่อนดูผลด้านบนได้เลย' : 'กำลังทำอยู่ รอผลได้เลย'}) — ถ้าต้องการทำใหม่จริงๆ ให้รอเกิน 45 นาที หรือพิมพ์ "ทำใหม่" นำหน้าเนื้อข่าวเพื่อสั่งเจนซ้ำทันที`,
                errorType: 'NEAR_DUPLICATE',
              }, { status: 409 });
            }
          }
        }
      } catch (e) { logger.warn(`[Queue] near-dup check skipped (non-fatal): ${String(e?.message || '').slice(0, 60)}`); }
    }

    // 3. Add to Queue
    const sourceUserId = payload.userId || 'discord-bot';
    const queueData = await enqueueJob(payload, sourceUserId);
    
    logger.info(`[Queue] Job added: ${queueData.jobId} (Position: ${queueData.position})`);
    
    // 4. Trigger the worker — Use waitUntil pattern to prevent Vercel kill
    // We don't await the full response (worker takes 5 min), just initiate it
    const baseUrl = req.nextUrl.origin;
    const workerPromise = fetch(`${baseUrl}/api/queue/worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': expectedKey
      },
      body: JSON.stringify({ trigger: 'new_job' })
    }).then(() => {
      logger.info(`[Queue] Worker triggered successfully`);
    }).catch(err => {
      logger.error(`[Queue] Worker trigger failed: ${err.message}`);
    });
    
    // 5. Return response immediately — include workerTriggerUrl for client fallback
    const response = NextResponse.json({
      success: true,
      jobId: queueData.jobId,
      position: queueData.position,
      queuesAhead: queueData.queuesAhead,
      status: queueData.status,
      duplicate: queueData.duplicate || false, // ★ 25 มิ.ย.: บอกบอทว่าเป็นงานซ้ำ → ตัวที่ยิงทีหลังเงียบ ไม่ทำซ้ำ
      message: `Job queued at position ${queueData.position}`,
      _workerUrl: `${baseUrl}/api/queue/worker`,
    });
    
    // Wait for worker trigger before sending response (max 3s)
    await Promise.race([
      workerPromise,
      new Promise(r => setTimeout(r, 3000))
    ]);
    
    return response;
    
  } catch (error) {
    // Duplicate check — ไม่ใช่ error จริง แค่ข่าวซ้ำ
    const isDuplicate = error.message?.includes('กำลังประมวลผลอยู่') || error.message?.includes('อยู่ในคิวแล้ว');
    if (isDuplicate) {
      logger.info(`[Queue] Duplicate rejected: ${error.message}`);
      return NextResponse.json({
        success: false,
        error: error.message,
        errorType: 'DUPLICATE_JOB'
      }, { status: 409 });
    }
    
    logger.error(`[Queue Add Error] ${error.message}`);
    return NextResponse.json({
      success: false,
      error: `Failed to add job to queue: ${error.message}`,
      errorType: 'QUEUE_ADD_ERROR'
    }, { status: 500 });
  }
}
