// ============================================================
// ★ DEVIATION จากระบบทำปกออโต้ (ผู้ใช้สั่ง 6 ก.ค. 2026)
// POST /api/images/clip-radar { caseId }
// ------------------------------------------------------------
// 🎯 เรดาร์คลิป — ยาเฉพาะทางของ "ข่าวชาวบ้าน" (เว็บไม่มีรูปเดี่ยวแบบดารา):
// หลังค้นภาพจบ นับว่าคลังมี "หน้าชัด" พอไหม — ถ้าขาด:
//   1) ค้นคลิป YouTube ด้วย ชื่อคน+ชื่อรายการ → คืนลิสต์ให้แคปเฟรม (หน้าชัดอยู่ในคลิป)
//   2) บอกว่าค้นย้อนกลับ (Lens) จากหน้าที่มีได้ไหม
//   3) สกัด "ชื่อเพจ" จากเนื้อข่าว → เสนอดูดโปรไฟล์เพจต้นทาง
// ============================================================

import { NextResponse } from 'next/server';
import { getCase } from '@/lib/caseStore';
import { readImages } from '@/lib/imageStore';
import { searchYouTubeClips } from '@/lib/imageSearch';

export const runtime = 'nodejs';
export const maxDuration = 120;

// ★ 8 ก.ค. (ผู้ใช้สั่ง): 10→40 — "12 ใบพอแล้ว" น้อยเกินใช้งานจริง ต้องหลายสิบ + เรดาร์ห้ามเป็นตัวจำกัดการหา
const FACE_MIN = parseInt(process.env.CLIP_RADAR_FACE_MIN || '40', 10);
// ★ 8 ก.ค.: เกณฑ์ใหม่ "อารมณ์ต้องหลากหลาย" — หน้าชัดเยอะแต่โทนเดียว (เช่น serious ล้วน) ก็ยังทำปกไม่ได้
//   ต้องมีอารมณ์ต่างกันอย่างน้อย N แบบ (happy/warm/sad/shock/...) ไม่งั้นถือว่ายังขาด → ล่าคลิป/Lens ต่อ
const EMO_MIN = parseInt(process.env.CLIP_RADAR_EMO_MIN || '3', 10);
// ★ 8 ก.ค. เฟส B (ผู้ใช้อนุมัติ): เกณฑ์ "รายคน" — ดาราหน้าเยอะท่วมโควตารวม ทำให้คนธรรมดาในข่าว
//   (ตัวที่คนแชร์!) เหลือ 2-3 ใบแล้วเรดาร์เคยคิดว่าพอ → นับแยกต่อคน ใครขาดล่าคลิปของคนนั้นเจาะจง
const PER_MIN = parseInt(process.env.CLIP_RADAR_FACE_MIN_PER || '10', 10);
// subject ที่เป็น "วัตถุ/กลุ่มนิรนาม" ไม่ต้องนับรายคน (บ้าน/รถ/ถ้วยรางวัล · "หลานๆของ..." ตายืนยันหน้าไม่ได้)
const NON_PERSON_RX = /บ้าน|รถ|โครงการ|ที่ดิน|ทรัพย์|เงิน|ถ้วย|รางวัล|เอกสาร|จดหมาย|เช็ค|ของ|และ|กลุ่ม|ทีม|ชาว|แฟนคลับ/;

// สกัดชื่อเพจ/ช่องจากเนื้อข่าว (เช่น เพจ "ฅนจริงใจไม่ท้อ", เพจดังเพชรบุรี)
function extractPageNames(text) {
  const names = new Set();
  const t = String(text || '');
  const patterns = [
    /เพจ\s*["“'']([^"”'']{3,45})["”'']/g,
    /เพจ\s+([ก-๙A-Za-z0-9.\-_ ]{3,40}?)(?:\s+(?:ได้|ที่|ซึ่ง|โพสต์|เผย|ระบุ)|[,.!?\n])/g,
    /รายการ\s*["“'']([^"”'']{3,45})["”'']/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(t)) !== null) {
      const n = m[1].trim();
      if (n && n.length >= 3) names.add(n);
    }
  }
  return [...names].slice(0, 4);
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const caseId = (body.caseId || '').trim();
    const c = caseId ? await getCase(caseId) : null;
    if (!c) {
      return NextResponse.json({ success: false, error: 'ไม่พบเคส ' + caseId, errorType: 'CASE_NOT_FOUND' }, { status: 404 });
    }

    const imgs = await readImages(caseId);
    const faces = imgs.filter((i) => String(i?.triage?.category || '').startsWith('face'));
    const faceCount = faces.length;
    // ★ 8 ก.ค.: นับ "ความหลากหลายอารมณ์" ของหน้าชัดในคลัง (ไม่นับ none/ว่าง)
    const emotions = [...new Set(faces.map((i) => i?.triage?.emotion).filter((e) => e && e !== 'none'))];
    // ★ 8 ก.ค. เฟส B: นับหน้าชัด "รายคน" (เฉพาะ subject ที่เป็นบุคคลยืนยันหน้าได้)
    const personSubjects = (c.keywords?.subjects || [])
      .map((s) => s.name)
      .filter((n) => n && !NON_PERSON_RX.test(n));
    const perPerson = personSubjects.map((name) => ({
      name,
      faces: faces.filter((i) => {
        const t = i?.triage || {};
        return t.person === name || (Array.isArray(t.persons) && t.persons.includes(name));
      }).length,
    }));
    const missingPersons = perPerson.filter((p) => p.faces < PER_MIN).map((p) => p.name);
    const needMore = faceCount < FACE_MIN || emotions.length < EMO_MIN || missingPersons.length > 0;

    // หน้าชัดที่ใช้เป็นเมล็ด Lens ได้ (URL สาธารณะ)
    const canLens = faces.some((i) => /^https?:/.test(i.imageUrl || ''));

    // ชื่อเพจ/รายการจากเนื้อข่าว
    const newsText = [c.newsText, c.analysis?.content, c.analysis?.summary].filter(Boolean).join('\n');
    const pageNames = extractPageNames(newsText);

    // ค้นคลิปเฉพาะเมื่อหน้าขาด (ประหยัด SerpApi)
    let clips = [];
    if (needMore) {
      const subjects = (c.keywords?.subjects || []).map((s) => s.name).filter(Boolean);
      const shows = c.keywords?.source_show || [];
      // ★ 8 ก.ค. เฟส B: ถ้ามี "คนที่หน้าขาด" → ล่าคลิปด้วยชื่อคนนั้นเจาะจงก่อนเสมอ
      //   (คู่กับชื่อตัวหลัก/ชื่อรายการ — คลิปข่าวเรื่องนี้มักมีทั้งคู่ในเฟรม)
      let queries;
      if (missingPersons.length) {
        const main = subjects[0] || '';
        queries = missingPersons.slice(0, 2).flatMap((p) => [
          shows[0] ? `${p} ${shows[0]}` : null,
          main && main !== p ? `${p} ${main}` : p,
        ]).filter(Boolean).slice(0, 3);
      } else {
        queries = [
          subjects[0] && shows[0] ? `${subjects[0]} ${shows[0]}` : null,
          subjects[0] || null,
          subjects[1] ? `${subjects[1]} ${subjects[0] || ''}`.trim() : null,
        ].filter(Boolean).slice(0, 2);
      }

      const seen = new Set();
      for (const q of queries) {
        try {
          const found = await searchYouTubeClips(q);
          for (const v of found) {
            if (!v.link || seen.has(v.link)) continue;
            seen.add(v.link);
            clips.push(v);
          }
        } catch {
          /* แหล่งล้ม → ข้าม */
        }
      }
      // เรียง "ตรงประเด็น": ชื่อคนในไตเติล = สำคัญสุด (กันได้ตอนของคนอื่นในรายการเดียวกัน)
      const showTerms = shows.map((s) => String(s).toLowerCase());
      // ★ 8 ก.ค. เฟส B: มีคนหน้าขาด → คัด/เรียงคลิปด้วยชื่อ "คนที่ขาด" ก่อน (ไม่ใช่ตัวหลักที่มีพอแล้ว)
      const nameTerms = (missingPersons.length ? missingPersons : subjects).map((s) => String(s).toLowerCase());
      const rel = (v) => {
        const t = (v.title || '').toLowerCase();
        let sc = 0;
        for (const n of nameTerms) if (n && t.includes(n)) sc += 10; // ชื่อคน = ตัวชี้ขาด
        for (const s of showTerms) if (s && t.includes(s)) sc += 3;
        return sc;
      };
      // มีคลิปที่ไตเติลมีชื่อคน → โชว์เฉพาะกลุ่มนั้น (ตอนอื่นของรายการเดียวกัน = คนละคน ไม่เอา)
      const withName = clips.filter((v) => nameTerms.some((n) => n && (v.title || '').toLowerCase().includes(n)));
      if (withName.length) clips = withName;
      clips.sort((a, b) => rel(b) - rel(a) || (b.views || 0) - (a.views || 0));
      clips = clips.slice(0, 6).map((v) => ({
        link: v.link,
        title: v.title || '',
        channel: v.channel || '',
        length: v.lengthText || v.length || '',
      }));
    }

    return NextResponse.json({
      success: true,
      caseId,
      faceCount,
      faceMin: FACE_MIN,
      emotionCount: emotions.length, // ★ 8 ก.ค.: อารมณ์หน้าชัดที่มีในคลัง (กี่แบบ)
      emotions,
      emoMin: EMO_MIN,
      perPerson, // ★ 8 ก.ค. เฟส B: หน้าชัดรายคน [{name, faces}]
      missingPersons, // คนที่หน้ายังขาด (< perMin) — เป้าล่าคลิป
      perMin: PER_MIN,
      totalImages: imgs.length,
      needMore,
      canLens,
      clips,
      pageNames,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message, errorType: 'UNEXPECTED' }, { status: 500 });
  }
}
