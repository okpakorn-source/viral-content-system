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
import { addImages } from '@/lib/imageStore';
import { isCatalogSource } from '@/lib/junkSources';

export const runtime = 'nodejs';

const MAX_QUERIES = parseInt(process.env.IMAGES_MAX_QUERIES || '3', 10);
const PER_SUBJECT = parseInt(process.env.IMAGES_PER_SUBJECT || '2', 10); // คำค้นขั้นต่ำต่อบุคคล
const MAX_QUERIES_CAP = parseInt(process.env.IMAGES_MAX_QUERIES_CAP || '8', 10);
const PER_QUERY = parseInt(process.env.IMAGES_PER_QUERY || '60', 10); // รูปต่อคำค้น (เพิ่มเป็น 60)
const HARD_CAP = parseInt(process.env.IMAGES_HARD_CAP || '250', 10); // เพดานรวมสูงสุด

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

    const keywords = c.keywords;
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
    const maxQ = Math.min(MAX_QUERIES_CAP, Math.max(MAX_QUERIES, nSubjects * PER_SUBJECT));
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

    for (const q of queries) {
      if (collected.length >= cap) break;
      try {
        const imgs = await searchImages(platform, q, { num: PER_QUERY, caseId });
        for (const im of imgs) {
          if (collected.length >= cap) break;
          if (!im.imageUrl || seen.has(im.imageUrl)) continue;
          // 🚫 ต้นทาง: กันบ้าน/โครงการจากเว็บอสังหา/รับสร้างบ้าน/วัสดุก่อสร้าง ไม่ให้เข้าคลัง
          //    (พวกนี้ไม่ใช่บ้านของคนในข่าว — แค่คีย์เวิร์ดตรง)
          if (isCatalogSource(im)) { blockedCatalog++; continue; }
          seen.add(im.imageUrl);
          collected.push({ ...im, platform, query: q });
        }
      } catch (err) {
        // คีย์หาย = หยุดทันที (ทุกคำค้นจะล้มเหมือนกัน)
        if (err.errorType === 'NO_SERPAPI_KEY') {
          return NextResponse.json(
            { success: false, error: err.message, errorType: 'NO_SERPAPI_KEY' },
            { status: 400 }
          );
        }
        errors.push({ query: q, error: err.message });
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

    const saved = await addImages(caseId, collected);

    return NextResponse.json({
      success: true,
      caseId,
      platform,
      found: collected.length,
      added: saved.added,
      total: saved.total,
      blockedCatalog, // 🚫 กันบ้านแคตตาล็อก/อสังหาออกกี่ใบ (โปร่งใส)
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
