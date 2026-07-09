// ============================================================
// [ระบบทำปกออโต้] POST /api/images/search
// ------------------------------------------------------------
// body: { caseId, platform } (platform: google|facebook|youtube|tiktok)
// เอาคีย์เวิร์ดของเคส → ค้นภาพผ่าน SerpApi หลายคำค้น → ตัดซ้ำ
// → เก็บเข้าคลังรูปของเคส (mark ที่มา) → คืนสถิติแยกหมวด
// ============================================================

import { NextResponse } from 'next/server';
import { getCase } from '@/lib/caseStore';
import { searchImages, buildQueries, PLATFORMS } from '@/lib/imageSearch';
import { addImages, readImages } from '@/lib/imageStore';
import { isCatalogSource, isOwnPageSource, isMismatchedFbMedia } from '@/lib/junkSources';
import { vetImages } from '@/lib/libraryTriage';

export const runtime = 'nodejs';
export const maxDuration = 600; // ★ 7 ก.ค.: 300→600 — ค้น+vet (EyeScreen ทุกใบ) ต่อแหล่งแตะ 5+ นาทีได้ (กันตายถ้าย้ายขึ้น Vercel)

const MAX_QUERIES = parseInt(process.env.IMAGES_MAX_QUERIES || '3', 10);
const PER_SUBJECT = parseInt(process.env.IMAGES_PER_SUBJECT || '2', 10); // คำค้นขั้นต่ำต่อบุคคล
const MAX_QUERIES_CAP = parseInt(process.env.IMAGES_MAX_QUERIES_CAP || '8', 10);
const PER_QUERY = parseInt(process.env.IMAGES_PER_QUERY || '20', 10); // รูปต่อคำค้น — เอาเฉพาะผลบนสุดที่ตรงสุด (>20 เริ่มมั่ว/ไม่เกี่ยว)
const HARD_CAP = parseInt(process.env.IMAGES_HARD_CAP || '120', 10); // เพดานรวม/แหล่ง — น้อยลงแต่ตรงกว่า (ปรับที่ env ได้)
// ★ 8 ก.ค. แก้ 1 (เร่งค้นภาพ): ยิง SerpApi ขนานเป็นชุดละ N คำ (คำค้นแต่ละคำไม่เกี่ยวกัน)
//   ประมวลผลเรียงตามลำดับคำค้นเดิมเสมอ (การันตีหลักฐาน/โมเมนต์นำหน้าเหมือนเดิม) + หยุดระหว่างชุดเมื่อถึงเพดาน
//   kill-switch: IMG_QUERY_CONC=1 = กลับพฤติกรรมยิงทีละคำแบบเดิมเป๊ะ
const QUERY_CONC = Math.max(1, parseInt(process.env.IMG_QUERY_CONC || '4', 10));
// ★ เฟส 1.5 (9 ก.ค.): ด่านนำเข้า — ถ้า SerpApi ให้ขนาดมาและ shortSide < นี้ → ติดธง lowRes=true (ห้ามทิ้งภาพ)
//   ใช้ห้ามขึ้นช่องใหญ่/hero (จะยืดแตก) — หลัง rehost วัดจริง (1.2) จะ recompute lowRes จากไฟล์จริง
const LOWRES_MIN_SHORT = parseInt(process.env.IMAGES_LOWRES_MIN_SHORT || '500', 10);
// ★ 9 ก.ค. เฟส 4a: โควตาคำค้นต่อแหล่ง — ยกเป็น ≥12 (จากเดิม ~4-8 ไม่คงเส้นคงวา) ให้หมวดเรื่องราว/emotion ได้ยิงครบ
//   กระทบต้นทุน SerpApi (ยิงมากขึ้นเมื่อภาพหายาก) → ผู้ใช้ปรับได้ที่ env · เพดานภาพรวม/แหล่งยังคุมด้วย HARD_CAP เดิม
const QUERIES_PER_SOURCE = parseInt(process.env.IMG_QUERIES_PER_SOURCE || '12', 10);
// kill-switch: IMG_STORY_QUERIES=0 = โควตา/พฤติกรรมคำค้นเดิม (ตัดหมวดเรื่องราว/emotion + regex สถานที่ไทยล้วน) · unset/'1' = เปิด
const STORY_QUERIES_ON = process.env.IMG_STORY_QUERIES !== '0';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const caseId = (body.caseId || '').trim();
    const platform = (body.platform || 'google').trim();

    if (!PLATFORMS.includes(platform)) {
      return NextResponse.json(
        { success: false, error: 'แพลตฟอร์มไม่รองรับ: ' + platform, errorType: 'BAD_PLATFORM' },
        { status: 400 }
      );
    }

    const c = caseId ? await getCase(caseId) : null;
    if (!c) {
      return NextResponse.json(
        { success: false, error: 'ไม่พบเคส ' + caseId, errorType: 'CASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    let keywords = c.keywords;
    // ★ DEVIATION 6 ก.ค. (ผู้ใช้สั่ง): ติ๊กเลือกคีย์เวิร์ดได้ — UI ส่งรายการที่ "ไม่ติ๊ก" มา
    //   กรองออกจากทุกหมวดก่อนเข้า buildQueries (โควตา/round-robin/การันตีหลักฐานยังทำงานเหมือนเดิม)
    if (keywords && Array.isArray(body.excludeQueries) && body.excludeQueries.length) {
      const ex = new Set(body.excludeQueries.map((s) => String(s).trim()));
      const keep = (arr) => (arr || []).filter((q) => !ex.has(String(q).trim()));
      keywords = {
        ...keywords,
        queries_th: keep(keywords.queries_th),
        queries_en: keep(keywords.queries_en),
        object_queries: keep(keywords.object_queries),
        moment_action: keep(keywords.moment_action),
        scene_place: keep(keywords.scene_place),
        // ★ 9 ก.ค. เฟส 4a: หมวดเรื่องราว/emotion/source_show ก็ต้องกรองตามที่ผู้ใช้ติ๊กออกด้วย (คงพฤติกรรม tick-to-exclude ให้ครบ)
        emotion: keep(keywords.emotion),
        source_show: keep(keywords.source_show),
        relationship_archive: keep(keywords.relationship_archive),
        lifestyle_travel: keep(keywords.lifestyle_travel),
        family_album: keep(keywords.family_album),
        landmark_context: keep(keywords.landmark_context),
      };
    }
    if (!keywords || typeof keywords !== 'object') {
      return NextResponse.json(
        {
          success: false,
          error: 'ต้องสกัดคีย์เวิร์ดก่อนจึงจะค้นภาพได้',
          errorType: 'NO_KEYWORDS',
        },
        { status: 400 }
      );
    }

    // จำนวนคำค้น: ให้ทุกบุคคลได้อย่างน้อย PER_SUBJECT คำ (สมดุลต่อคน)
    const nSubjects = (keywords.subjects || []).length || 1;
    // ★ 9 ก.ค. เฟส 4a: เปิดหมวดเรื่องราว → โควตา ≥ QUERIES_PER_SOURCE (default 12); ปิด → เพดานเดิม (CAP 8)
    const maxQ = STORY_QUERIES_ON
      ? Math.max(QUERIES_PER_SOURCE, nSubjects * PER_SUBJECT)
      : Math.min(MAX_QUERIES_CAP, Math.max(MAX_QUERIES, nSubjects * PER_SUBJECT));
    const queries = buildQueries(keywords, maxQ);
    if (queries.length === 0) {
      return NextResponse.json(
        { success: false, error: 'ไม่มีคำค้นในคีย์เวิร์ด', errorType: 'NO_QUERIES' },
        { status: 400 }
      );
    }

    // เพดานรวม = ให้ทุกคำค้น (ทุกคน) ได้รันครบ ไม่ตัดคำค้นท้ายทิ้ง (กันเสียสมดุล)
    const cap = Math.min(HARD_CAP, queries.length * PER_QUERY);

    const collected = [];
    const seen = new Set();
    const errors = [];
    let blockedCatalog = 0; // 🚫 บ้านแคตตาล็อก/อสังหา/โฆษณา ที่บล็อกตั้งแต่ต้นทาง
    let blockedOwnPage = 0; // 🚫 ★ 8 ก.ค.: ภาพจากเพจของเราเอง (คอลลาจวนกลับ = กับดักผิดคน)
    let blockedMismatch = 0; // 🚫 ★ 8 ก.ค. ดึก: ภาพ FB ที่ Google จับคู่ผิดโพสต์ (media_id ≠ เลขภาพในลิงก์)

    // ★ แก้ 1: ยิงเป็น "ชุด" ชุดละ QUERY_CONC คำพร้อมกัน แล้วเก็บผล "เรียงตามลำดับคำค้นเดิม"
    //   (ลำดับ collected/ตัดซ้ำ/เพดาน เหมือนยิงทีละคำทุกประการ — QUERY_CONC=1 คือชุดละ 1 = โค้ดเดิม)
    for (let w = 0; w < queries.length && collected.length < cap; w += QUERY_CONC) {
      const wave = queries.slice(w, w + QUERY_CONC);
      const settled = await Promise.all(
        wave.map(async (q) => {
          try {
            return { imgs: await searchImages(platform, q, { num: PER_QUERY, caseId }) };
          } catch (err) {
            return { err };
          }
        })
      );
      for (let k = 0; k < wave.length; k++) {
        const q = wave[k];
        const { imgs, err } = settled[k];
        if (err) {
          // คีย์หาย = หยุดทันที (ทุกคำค้นจะล้มเหมือนกัน)
          if (err.errorType === 'NO_SERPAPI_KEY') {
            return NextResponse.json(
              { success: false, error: err.message, errorType: 'NO_SERPAPI_KEY' },
              { status: 400 }
            );
          }
          errors.push({ query: q, error: err.message });
          continue;
        }
        for (const im of imgs) {
          if (collected.length >= cap) break;
          if (!im.imageUrl || seen.has(im.imageUrl)) continue;
          // 🚫 ต้นทาง: กันบ้าน/โครงการจากเว็บอสังหา/รับสร้างบ้าน/วัสดุก่อสร้าง ไม่ให้เข้าคลัง
          //    (พวกนี้ไม่ใช่บ้านของคนในข่าว — แค่คีย์เวิร์ดตรง)
          if (isCatalogSource(im)) { blockedCatalog++; continue; }
          // 🚫 ★ 8 ก.ค.: กันภาพจากเพจเราเอง (บทเรียน AC-0043-61: คอลลาจ IG.dara → เดาผิดคน)
          if (isOwnPageSource(im)) { blockedOwnPage++; continue; }
          // 🚫 ★ 8 ก.ค. ดึก: กันภาพ FB ที่ Google จับคู่ผิดโพสต์ (ภาพไม่เคยอยู่ในโพสต์ที่ลิงก์อ้าง)
          if (isMismatchedFbMedia(im)) { blockedMismatch++; continue; }
          seen.add(im.imageUrl);
          // ★ 1.5: ติดธง lowRes จากขนาด SerpApi (มีค่าจริงเท่านั้น — ไม่รู้ขนาด = ไม่ตีตรา)
          const sw = Number(im.width) || 0, sh = Number(im.height) || 0;
          const lowRes = sw > 0 && sh > 0 ? Math.min(sw, sh) < LOWRES_MIN_SHORT : undefined;
          collected.push({ ...im, platform, query: q, ...(lowRes !== undefined ? { lowRes } : {}) });
        }
      }
    }

    if (collected.length === 0 && errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'ค้นภาพไม่สำเร็จทุกคำค้น',
          errorType: 'SEARCH_FAILED',
          errors,
        },
        { status: 502 }
      );
    }

    // ★ 8 ก.ค. แก้ 2 (เร่งค้นภาพ): ตัดรูปที่คลังเคสมีอยู่แล้วออก "ก่อน" ส่งตา Gemini
    //   เดิม: รูปซ้ำข้ามแหล่ง (Google/News/Yandex มักคืนใบเดียวกัน) ถูกส่งไปให้ตาตรวจเต็มราคา
    //   แล้วค่อยโดน addImages ตัดทิ้งเงียบๆ ตอนเก็บ = จ่ายเวลา+ค่า Gemini ฟรี
    //   ผลลัพธ์ในคลังเท่าเดิม 100% (รูปซ้ำไม่เคยถูกเก็บอยู่แล้ว) · kill-switch: PRE_VET_DEDUP=0
    let candidates = collected;
    let skippedDup = 0;
    if (process.env.PRE_VET_DEDUP !== '0' && collected.length) {
      try {
        const have = new Set((await readImages(caseId)).map((i) => i.imageUrl));
        candidates = collected.filter((im) => !have.has(im.imageUrl));
        skippedDup = collected.length - candidates.length;
      } catch {
        candidates = collected; // อ่านคลังไม่ได้ → ทำแบบเดิม (vet ทั้งหมด) ห้ามล้ม
      }
    }

    // 👁️ ตากรองตอนค้น: ให้ตาดูรูปที่ค้นได้ "ก่อนเก็บ" → เก็บเฉพาะที่เกี่ยวข้องจริง + ติดป้าย triage ในตัว
    //   (ปิดได้ด้วย body.vet=false หรือ env SEARCH_VET=0 ; ตาล้ม/ไม่มีคีย์ → เก็บทั้งหมด กันค้นแล้วได้ศูนย์)
    const VET = process.env.SEARCH_VET !== '0' && body.vet !== false;
    let toStore = candidates;
    let vetDropped = 0;
    let vetOn = false;
    if (VET && candidates.length) {
      const chars = c.analysis?.characters || [];
      const genderOf = (name) => {
        const n = (name || '').trim();
        const hit = chars.find((ch) => ch.name === n || (ch.name && (n.includes(ch.name) || ch.name.includes(n))));
        return hit?.gender || '';
      };
      const subjects = (c.keywords?.subjects || []).map((s) => ({ ...s, gender: s.gender || genderOf(s.name) }));
      const newsGist = (c.analysis?.summary || c.analysis?.content || c.newsSnippet || '').slice(0, 600);
      try {
        const { vetted } = await vetImages({ images: candidates, subjects, newsGist, caseId });
        // ★ DEVIATION โหมดตาเข้ม (ผู้ใช้สั่ง 6 ก.ค.): เก็บเฉพาะใบที่ตา "ยืนยันว่าเกี่ยว" เท่านั้น
        //   (ต้นฉบับเก็บใบที่ตาดูไม่ทัน/ไม่ติดป้ายด้วย → ขยะเล็ดได้) — ถ้าตาล้มทั้งชุดจนไม่มีป้ายเลย
        //   ค่อย fail-open เก็บแบบต้นฉบับ กัน "ค้นแล้วได้ศูนย์" ตอน Gemini ล่ม · ปิดกลับ: SEARCH_VET_STRICT=0
        const strict = process.env.SEARCH_VET_STRICT !== '0';
        const anyTag = vetted.some((x) => x.triage);
        toStore = strict && anyTag
          ? vetted.filter((x) => x.triage?.relevant === true)
          : vetted.filter((x) => x.triage?.relevant !== false);
        vetDropped = candidates.length - toStore.length;
        vetOn = true;
      } catch {
        toStore = candidates; // ตาล้ม/ไม่มีคีย์ → เก็บทั้งหมดไปก่อน
      }
    }

    const saved = await addImages(caseId, toStore);

    return NextResponse.json({
      success: true,
      caseId,
      platform,
      found: collected.length,
      added: saved.added,
      total: saved.total,
      blockedCatalog, // 🚫 กันบ้านแคตตาล็อก/อสังหาออกกี่ใบ (โปร่งใส)
      blockedOwnPage, // 🚫 ★ 8 ก.ค.: กันภาพจากเพจเราเองออกกี่ใบ
      blockedMismatch, // 🚫 ★ 8 ก.ค. ดึก: กันภาพ FB จับคู่ผิดโพสต์ออกกี่ใบ
      skippedDup, // ⚡ ตัดรูปที่คลังมีแล้วก่อนส่งตา (ไม่เสียเวลา/ค่า Gemini ซ้ำ)
      vetOn, // 👁️ ตากรองตอนค้นทำงานไหม
      vetDropped, // 👁️ ตากรองรูป "ไม่เกี่ยว" ออกกี่ใบ
      byPlatform: saved.byPlatform,
      images: saved.images,
      queriesUsed: queries,
      errors,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || 'เกิดข้อผิดพลาดไม่คาดคิด', errorType: 'UNEXPECTED' },
      { status: 500 }
    );
  }
}
