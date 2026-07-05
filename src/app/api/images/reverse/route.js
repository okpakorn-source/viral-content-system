// ============================================================
// [ระบบทำปกออโต้] POST /api/images/reverse
// ------------------------------------------------------------
// ค้นภาพย้อนกลับ (Google Lens) จากภาพที่ยืนยัน → เจอภาพคนคนนั้นจากทุกที่
// body: { caseId, seedImageUrl? }
//  - ถ้าให้ seedImageUrl (URL สาธารณะ) → ใช้ใบนั้น
//  - ถ้าไม่ให้ → หยิบภาพ Google ในคลัง (URL สาธารณะ) มาเป็นเมล็ด 1-3 ใบ
// ⚠️ ต้องเป็น URL สาธารณะเท่านั้น (เฟรม YouTube เป็นไฟล์ local ใช้เป็นเมล็ดไม่ได้)
// ============================================================

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getCase } from '@/lib/caseStore';
import { reverseImage } from '@/lib/imageSearch';
import { addImages, readImages } from '@/lib/imageStore';
import { hostImagePublic } from '@/lib/publicHost';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_SEEDS = parseInt(process.env.REVERSE_MAX_SEEDS || '3', 10);
const HARD_CAP = parseInt(process.env.REVERSE_HARD_CAP || '40', 10);

// แปลง seed → URL สาธารณะ (http ใช้ตรง / local อ่านไฟล์แล้วฝากขึ้น catbox)
async function resolveSeed(url) {
  if (!url) return null;
  if (/^https?:/.test(url)) return url;
  if (url.startsWith('/')) {
    try {
      const buf = await fs.readFile(path.join(process.cwd(), 'public', url.replace(/^\//, '')));
      return await hostImagePublic(buf);
    } catch {
      return null;
    }
  }
  return null;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const caseId = (body.caseId || '').trim();
    const c = caseId ? await getCase(caseId) : null;
    if (!c) {
      return NextResponse.json(
        { success: false, error: 'ไม่พบเคส ' + caseId, errorType: 'CASE_NOT_FOUND' },
        { status: 404 }
      );
    }

    // รวบรวมเมล็ดดิบ (อาจเป็น local — จะฝากขึ้นโฮสต์สาธารณะก่อน)
    const subjects = (c.keywords?.subjects || []).map((s) => s.name).filter(Boolean);
    let maxSeeds = MAX_SEEDS;
    let rawSeeds = [];
    if (body.seedImageUrl) {
      rawSeeds = [body.seedImageUrl];
    } else {
      const imgs = await readImages(caseId);
      const uploads = imgs.filter((i) => i.platform === 'upload' && i.imageUrl).map((i) => i.imageUrl);
      const publics = imgs.filter((i) => i.imageUrl && /^https?:/.test(i.imageUrl));

      if (subjects.length > 1) {
        // สมดุลต่อบุคคล: seed จากรูปของแต่ละคน (ดูจาก query ที่ค้นมา) แบบ round-robin
        maxSeeds = Math.min(6, Math.max(MAX_SEEDS, subjects.length * 2));
        const perSubj = subjects.map((name) => {
          const nl = name.toLowerCase();
          return publics.filter((i) => String(i.query || '').toLowerCase().includes(nl)).map((i) => i.imageUrl);
        });
        rawSeeds = [...uploads];
        let k = 0;
        while (rawSeeds.length < maxSeeds && perSubj.some((a) => a[k])) {
          for (const a of perSubj) if (a[k]) rawSeeds.push(a[k]);
          k++;
        }
        rawSeeds.push(...publics.map((i) => i.imageUrl)); // เติมที่เหลือ
      } else {
        rawSeeds = [...uploads, ...publics.map((i) => i.imageUrl)];
      }
    }

    // แปลงเป็น URL สาธารณะ (รูป local → ฝากขึ้น catbox) — ตัดซ้ำ
    const seeds = [];
    const seedSeen = new Set();
    for (const rs of rawSeeds) {
      if (seeds.length >= maxSeeds) break;
      if (seedSeen.has(rs)) continue;
      seedSeen.add(rs);
      const pub = await resolveSeed(rs);
      if (pub) seeds.push(pub);
    }
    if (seeds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'ไม่มีภาพให้ค้นย้อนกลับ (ค้น Google/อัปโหลดรูปก่อน) หรือฝากรูปสาธารณะไม่สำเร็จ',
          errorType: 'NO_SEED',
        },
        { status: 400 }
      );
    }

    // เพดานรวมให้ทุก seed (ทุกคน) ได้ผลครบ ไม่ตัดทิ้ง
    const revCap = Math.min(150, Math.max(HARD_CAP, seeds.length * 25));

    const collected = [];
    const seen = new Set();
    const errors = [];
    for (const seed of seeds) {
      if (collected.length >= revCap) break;
      try {
        const found = await reverseImage(seed);
        for (const im of found) {
          if (collected.length >= revCap) break;
          if (!im.imageUrl || seen.has(im.imageUrl)) continue;
          seen.add(im.imageUrl);
          collected.push({ ...im, platform: 'reverse', query: 'reverse' });
        }
      } catch (err) {
        if (err.errorType === 'NO_SERPAPI_KEY') {
          return NextResponse.json({ success: false, error: err.message, errorType: 'NO_SERPAPI_KEY' }, { status: 400 });
        }
        errors.push({ seed, error: err.message });
      }
    }

    if (collected.length === 0) {
      return NextResponse.json(
        { success: false, error: 'ค้นย้อนกลับไม่พบภาพ', errorType: 'NO_RESULTS', errors },
        { status: 200 }
      );
    }

    // ★ DEVIATION ตากรองตอนค้นย้อนกลับ (ผู้ใช้สั่ง 6 ก.ค.): Lens อาจดริฟท์ไปคนหน้าคล้าย/สินค้า
    //   → ให้ตาดูก่อนเก็บแบบเดียวกับ /api/images/search (ตาล้มทั้งชุด → เก็บทั้งหมดแบบต้นฉบับ)
    let toStore = collected;
    let vetDropped = 0;
    if (process.env.SEARCH_VET !== '0' && body.vet !== false) {
      try {
        const { vetImages } = await import('@/lib/libraryTriage');
        const subjects = c.keywords?.subjects || [];
        const newsGist = (c.analysis?.summary || c.analysis?.content || c.newsSnippet || '').slice(0, 600);
        const { vetted } = await vetImages({ images: collected, subjects, newsGist, caseId });
        const anyTag = vetted.some((x) => x.triage);
        if (anyTag) {
          toStore = process.env.SEARCH_VET_STRICT !== '0'
            ? vetted.filter((x) => x.triage?.relevant === true)
            : vetted.filter((x) => x.triage?.relevant !== false);
          vetDropped = collected.length - toStore.length;
        }
      } catch {
        /* ตาล้ม → เก็บทั้งหมดแบบต้นฉบับ */
      }
    }

    const saved = await addImages(caseId, toStore);
    return NextResponse.json({
      success: true,
      caseId,
      platform: 'reverse',
      vetDropped,
      seedsUsed: seeds.length,
      found: collected.length,
      added: saved.added,
      total: saved.total,
      byPlatform: saved.byPlatform,
      images: saved.images,
      errors,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || 'เกิดข้อผิดพลาด', errorType: 'UNEXPECTED' },
      { status: 500 }
    );
  }
}
