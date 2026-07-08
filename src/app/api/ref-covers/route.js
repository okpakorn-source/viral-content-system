// ============================================================
// 🎯 /api/ref-covers — คลังปก reference + สกัด DNA
//   POST   : อัพโหลดปก 1 ใบ {image: dataUrl, styleName?} → เซฟ public/ref-covers/ → สกัด DNA → เก็บคลัง
//   GET    : รายการปก ref ทั้งหมด (+DNA)
//   DELETE : ?id=... ลบปก ref
//   PATCH  : {id, styleName?} หรือ {id, reanalyze:true} → อัปเดต/วิเคราะห์ DNA ใหม่
// ทั้งหมดแยกจากท่อทำข่าว/ปกอัตโนมัติ 100%
// ============================================================

import { NextResponse } from 'next/server';
import { listRefCovers, addRefCover, deleteRefCover, updateRefCover } from '@/lib/refCoverLibrary';
import { extractCoverDNA } from '@/lib/refCoverBrain';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET() {
  try {
    const items = await listRefCovers(500);
    return NextResponse.json({ success: true, count: items.length, items });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, items: [] }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const image = String(body.image || '');
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(image);
    if (!m) {
      return NextResponse.json({ success: false, error: 'ต้องส่งภาพเป็น data URL (base64)', errorType: 'NO_IMAGE' }, { status: 400 });
    }
    // เซฟไฟล์ภาพ
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const dir = path.join(process.cwd(), 'public', 'ref-covers');
    await fs.mkdir(dir, { recursive: true });
    const fname = `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${m[1] === 'png' ? 'png' : 'jpg'}`;
    await fs.writeFile(path.join(dir, fname), Buffer.from(m[2], 'base64'));
    const imagePath = `/ref-covers/${fname}`;

    // สกัด DNA (ล้มก็ยังเก็บภาพ + ธง error ให้ re-analyze ทีหลังได้)
    let dna = null, dnaError = null;
    try {
      dna = await extractCoverDNA(image);
    } catch (e) {
      dnaError = e.message?.slice(0, 200) || 'สกัด DNA ล้ม';
    }

    const entry = await addRefCover({ styleName: String(body.styleName || '').slice(0, 80), imagePath, dna, dnaError });
    return NextResponse.json({ success: true, item: entry });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message || 'ผิดพลาดไม่คาดคิด', errorType: 'UNEXPECTED' }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '');
    if (!id) return NextResponse.json({ success: false, error: 'ต้องระบุ id' }, { status: 400 });
    const patch = {};
    if (typeof body.styleName === 'string') patch.styleName = body.styleName.slice(0, 80);
    // 🛠 เฟส 2 (8 ก.ค. ผู้ใช้เคาะ): ตาคนแก้เทมเพลตเอง + ยืนยัน — ทางแก้ถาวรของ "ตา AI วัดโครงผิด" (733630294 วัดซ้ำก็ผิดเดิม)
    //   บันทึก template ที่คนแก้ + ธง _humanVerified → ระบบ match ให้แต้มใบยืนยันก่อน · panelCount อัปตามช่องจริง
    if (Array.isArray(body.template?.slots) || typeof body.verified === 'boolean') {
      const items0 = await listRefCovers(1000);
      const cur0 = items0.find((x) => x.id === id);
      if (!cur0) return NextResponse.json({ success: false, error: 'ไม่พบ id' }, { status: 404 });
      const dna = { ...(cur0.dna || {}) };
      if (Array.isArray(body.template?.slots)) {
        const slots = body.template.slots
          .filter((s) => Number.isFinite(+s.xPct) && Number.isFinite(+s.yPct) && Number.isFinite(+s.wPct) && Number.isFinite(+s.hPct))
          .slice(0, 8)
          .map((s) => ({
            role: String(s.role || 'context').slice(0, 20),
            shape: s.shape === 'circle' ? 'circle' : 'rect',
            xPct: Math.max(0, Math.min(100, Math.round(+s.xPct))),
            yPct: Math.max(0, Math.min(100, Math.round(+s.yPct))),
            wPct: Math.max(5, Math.min(100, Math.round(+s.wPct))),
            hPct: Math.max(5, Math.min(100, Math.round(+s.hPct))),
            zIndex: s.shape === 'circle' ? 1 : 0,
            border: !!s.border,
            borderColor: s.border ? (s.borderColor || '#FFFFFF') : '-',
            borderWidthPct: s.border ? 1.5 : 0,
          }));
        if (slots.length < 3) return NextResponse.json({ success: false, error: 'ต้องมี ≥3 ช่อง' }, { status: 400 });
        dna.template = { ...(dna.template || {}), slots, seamStyle: dna.template?.seamStyle || 'edge-to-edge' };
        dna.panelCount = slots.length;
        dna._humanVerified = true; // แก้มือ = ยืนยันในตัว
        delete dna._geometryMismatch;
      }
      if (typeof body.verified === 'boolean') dna._humanVerified = body.verified;
      patch.dna = dna;
    }
    if (body.reanalyze) {
      // re-analyze DNA จากไฟล์เดิม
      const items = await listRefCovers(1000);
      const cur = items.find((x) => x.id === id);
      if (cur?.imagePath) {
        try {
          const { promises: fs } = await import('fs');
          const path = await import('path');
          const buf = await fs.readFile(path.join(process.cwd(), 'public', cur.imagePath.replace(/^\//, '')));
          const ext = cur.imagePath.endsWith('.png') ? 'png' : 'jpeg';
          patch.dna = await extractCoverDNA(`data:image/${ext};base64,${buf.toString('base64')}`);
          patch.dnaError = null;
        } catch (e) { patch.dnaError = e.message?.slice(0, 200); }
      }
    }
    const updated = await updateRefCover(id, patch);
    if (!updated) return NextResponse.json({ success: false, error: 'ไม่พบ id' }, { status: 404 });
    return NextResponse.json({ success: true, item: updated });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ต้องระบุ id' }, { status: 400 });
    const n = await deleteRefCover(id);
    return NextResponse.json({ success: true, deleted: n });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
