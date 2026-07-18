// ============================================================
// 🎯 /api/ref-covers — คลังปก reference + สกัด DNA
//   POST   : อัพโหลดปก 1 ใบ {image: dataUrl, styleName?} → สกัด DNA → dnaToTemplateSpec → วัด fidelity → คำนวณเกรด → เก็บคลัง
//            ★ redesign 18 ก.ค.: structure-only — ไม่เซฟไฟล์ภาพ/ไม่เก็บ imagePath อีกต่อไป (ทุกด่านต้องผ่านจึงเก็บ record)
//   GET    : รายการปก ref ทั้งหมด (+DNA)
//   DELETE : ?id=... ลบปก ref
//   PATCH  : {id, styleName?} หรือ {id, reanalyze:true} → อัปเดต/วิเคราะห์ DNA ใหม่ (reanalyze ใช้ได้เฉพาะ legacy record ที่มี imagePath)
// ทั้งหมดแยกจากท่อทำข่าว/ปกอัตโนมัติ 100%
// ============================================================

import { NextResponse } from 'next/server';
import { listRefCovers, addRefCover, deleteRefCover, updateRefCover, syncDnaSlotsToTemplate } from '@/lib/refCoverLibrary';
import { extractCoverDNA } from '@/lib/refCoverBrain';
import { computeTemplateGrade } from '@/lib/refCoverGrade';
import { measureTemplateFidelity } from '@/lib/refTemplateFidelity';
import { dnaToTemplateSpec } from '@/lib/refTemplate';

export const runtime = 'nodejs';
export const maxDuration = 120;

// ★ 18 ก.ค. (คำสั่ง sol — precision): ปัดพิกัด slot เป็นทศนิยม 0.1% (ไม่ใช่จำนวนเต็ม) — เก็บความแม่นตะเข็บ
//   ค่าไม่ใช่ตัวเลข → 0 (กัน NaN เข้าคลัง) · 0.1% ≈ 1px บน canvas 1080 = ระดับพิกเซลพอดี (compose ปัดพิกเซลตอนท้าย)
const _round1 = (v) => (Number.isFinite(+v) ? Math.round(+v * 10) / 10 : 0);

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

// ★ redesign 18 ก.ค. (คำสั่ง sol — structure-only): เลิกเซฟไฟล์ภาพ/imagePath ทั้งหมด
//   ปก ref = โครง (DNA + template geometry + fidelity + grade) ล้วน ไม่เก็บภาพต้นฉบับในคลัง
//   ทุกด่านต้องผ่านจึงเก็บ record; ด่านไหนล้ม = ไม่เรียก addRefCover (กัน record ครึ่งสำเร็จ)
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const image = String(body.image || '');
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(image);
    if (!m) {
      return NextResponse.json({ success: false, error: 'ต้องส่งภาพเป็น data URL (base64)', errorType: 'NO_IMAGE' }, { status: 400 });
    }

    let buffer;
    try {
      buffer = Buffer.from(m[2], 'base64');
    } catch {
      return NextResponse.json({ success: false, error: 'ถอดรหัสภาพ base64 ไม่ได้', errorType: 'INVALID_IMAGE_DATA' }, { status: 400 });
    }
    if (!buffer || buffer.length === 0) {
      return NextResponse.json({ success: false, error: 'ถอดรหัสภาพ base64 ไม่ได้', errorType: 'INVALID_IMAGE_DATA' }, { status: 400 });
    }

    // ① สกัด DNA — ล้ม = ไม่เก็บ record
    let dna;
    try {
      dna = await extractCoverDNA(image);
    } catch (e) {
      return NextResponse.json({ success: false, error: e?.message || 'สกัด DNA ล้ม', errorType: 'DNA_EXTRACTION_FAILED' }, { status: 422 });
    }
    if (!dna) {
      return NextResponse.json({ success: false, error: 'สกัด DNA ล้ม', errorType: 'DNA_EXTRACTION_FAILED' }, { status: 422 });
    }

    // ② แปลง DNA → templateSpec (โครงคอลลาจ) — ไม่ sane = ไม่เก็บ record
    let spec = null;
    try { spec = dnaToTemplateSpec(dna); } catch { spec = null; }
    if (!spec) {
      return NextResponse.json({ success: false, error: 'โครงคอลลาจจาก DNA ใช้ไม่ได้ (dnaToTemplateSpec ไม่ผ่าน)', errorType: 'INVALID_TEMPLATE_STRUCTURE' }, { status: 422 });
    }

    // ③ วัดความเที่ยงเชิงพิกเซล (template ตรงกับภาพจริงแค่ไหน) — ล้ม = ไม่เก็บ record
    let fid;
    try {
      fid = await measureTemplateFidelity({ imageBuffer: buffer, templateSpec: spec });
    } catch (e) {
      return NextResponse.json({ success: false, error: e?.message || 'วัดความเที่ยงล้ม', errorType: 'FIDELITY_MEASUREMENT_FAILED' }, { status: 422 });
    }

    // ④ ประกบเกรด (deterministic) แล้วเก็บ record — ไม่มี imagePath
    const dnaWithFid = { ...dna, _fidelity: fid };
    const grade = computeTemplateGrade({ dna: dnaWithFid });
    const finalDna = { ...dnaWithFid, _templateGrade: grade };

    let entry;
    try {
      entry = await addRefCover({ styleName: String(body.styleName || '').slice(0, 80), dna: finalDna, dnaError: null });
    } catch (e) {
      return NextResponse.json({ success: false, error: e?.message || 'บันทึกคลังไม่สำเร็จ', errorType: 'REF_COVER_PERSIST_FAILED' }, { status: 500 });
    }

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
            // ★ 18 ก.ค. (คำสั่ง sol — precision): เดิม Math.round() ปัดพิกัดเป็นจำนวนเต็ม % → เพี้ยน ~3-5px
            //   บน canvas 1080 (compose แปลง Math.round((x/100)*W) ตอนท้าย รักษาทศนิยมอยู่แล้ว).
            //   เก็บทศนิยม 0.1% (≈1px) ให้ human-verified geometry ตรงตะเข็บจริง (worstOffsetPx ↓ = เกรดขึ้น).
            xPct: Math.max(0, Math.min(100, _round1(+s.xPct))),
            yPct: Math.max(0, Math.min(100, _round1(+s.yPct))),
            wPct: Math.max(5, Math.min(100, _round1(+s.wPct))),
            hPct: Math.max(5, Math.min(100, _round1(+s.hPct))),
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
      // re-analyze DNA จากไฟล์เดิม — เฉพาะ legacy record ที่ยังมี imagePath (ref ใหม่หลัง redesign = โครงล้วน ไม่มีภาพให้ reanalyze)
      const items = await listRefCovers(1000);
      const cur = items.find((x) => x.id === id);
      if (cur && !cur.imagePath) {
        return NextResponse.json({ success: false, error: 'ปกนี้ไม่มีภาพต้นฉบับเก็บไว้ (โครงล้วน) — re-analyze ใหม่ไม่ได้', errorType: 'REANALYZE_IMAGE_UNAVAILABLE' }, { status: 422 });
      }
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
