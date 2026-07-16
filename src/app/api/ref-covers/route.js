// ============================================================
// 🎯 /api/ref-covers — คลังปก reference + สกัด DNA
//   POST   : อัพโหลดปก 1 ใบ {image: dataUrl, styleName?} → เซฟ public/ref-covers/ → สกัด DNA → เก็บคลัง
//   GET    : รายการปก ref ทั้งหมด (+DNA)
//   DELETE : ?id=... ลบปก ref
//   PATCH  : {id, styleName?} หรือ {id, reanalyze:true} → อัปเดต/วิเคราะห์ DNA ใหม่
// ทั้งหมดแยกจากท่อทำข่าว/ปกอัตโนมัติ 100%
// ============================================================

import { NextResponse } from 'next/server';
import { listRefCovers, addRefCover, deleteRefCover, updateRefCover, syncDnaSlotsToTemplate } from '@/lib/refCoverLibrary';
import { extractCoverDNA } from '@/lib/refCoverBrain';
import { computeTemplateGrade } from '@/lib/refCoverGrade';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET() {
  try {
    const items = await listRefCovers(500);
    // ★ R3 (16 ก.ค.): แนบเกรดเทมเพลตต่อใบ (passive — แสดงเสมอ ไม่ขึ้นสวิตช์) ให้หน้า /ref-covers ติดป้ายได้
    //   คิดสด (computeTemplateGrade PURE) เมื่อยังไม่มี dna._templateGrade → ป้ายขึ้นทันทีแม้ยังไม่รันสคริปต์
    //   _fidelity/_duplicateOf ส่งใน dna เต็มอยู่แล้ว ป้ายอ่านตรงได้
    const withGrade = items.map((it) => ({
      ...it,
      _templateGrade: it?.dna?._templateGrade || computeTemplateGrade(it),
    }));
    return NextResponse.json({ success: true, count: withGrade.length, items: withGrade });
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
            // ★ 9 ก.ค.: เก็บ zIndex ที่ส่งมา (inset ลอยทับต้อง z สูง) — เดิมบังคับ 0 ทำ inset จมใต้ช่องข้างเคียง
            zIndex: Number.isFinite(+s.zIndex) ? Math.max(0, Math.min(9, Math.round(+s.zIndex))) : (s.shape === 'circle' ? 1 : 0),
            border: !!s.border,
            borderColor: s.border ? (s.borderColor || '#FFFFFF') : '-',
            borderWidthPct: s.border ? (Number.isFinite(+s.borderWidthPct) ? Math.max(0.5, Math.min(4, +s.borderWidthPct)) : 1.5) : 0,
            // ★ 9 ก.ค.: เก็บข้อมูลจัดวางของ ref (pos/subject/shot/emotion) — refTemplate ใช้ทำโน้ตต่อช่องให้ S6
            ...(s.pos ? { pos: String(s.pos).slice(0, 40) } : {}),
            ...(s.subject ? { subject: String(s.subject).slice(0, 60) } : {}),
            ...(s.shot ? { shot: String(s.shot).slice(0, 20) } : {}),
            ...(s.emotion ? { emotion: String(s.emotion).slice(0, 20) } : {}),
          }));
        if (slots.length < 3) return NextResponse.json({ success: false, error: 'ต้องมี ≥3 ช่อง' }, { status: 400 });
        // ★ R2 (16 ก.ค.): sync dna.slots (semantic) ให้ align กับ template.slots ใหม่ทันที —
        //   ต้นตอบัคเดิม: อัป template.slots แต่ dna.slots ค้าง → dangling/unmatched ทั้งคลัง.
        //   คง role เดิมที่ยัง match (เนื้อหาเดิม) · ตัด role ที่หาย · เพิ่ม role ใหม่แบบ minimal {role,pos} เท่านั้น.
        const syncedSlots = syncDnaSlotsToTemplate(cur0.dna?.slots, slots);
        dna.template = { ...(dna.template || {}), slots, seamStyle: dna.template?.seamStyle || 'edge-to-edge' };
        dna.slots = syncedSlots;
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
