/** @type {import('next').NextConfig} */
const nextConfig = {
  // ★ 7 ก.ค.: distDir แบบ env-gated — ปกติ '.next' เท่าเดิม (prod :3000 ไม่ขยับ)
  //   ตั้ง NEXT_DISTDIR=.next-dev เพื่อรัน dev แยกโฟลเดอร์ build (เทสโค้ดใหม่โดยไม่ทับ build ของ prod)
  distDir: process.env.NEXT_DISTDIR || '.next',
  serverExternalPackages: ['better-sqlite3', '@prisma/adapter-better-sqlite3', 'playwright-core', 'ffmpeg-static', 'fluent-ffmpeg'],
  // ★ 10 มิ.ย.: ฟอนต์ไทยถูกอ่านด้วย fs.readFileSync (path คำนวณ runtime) — Vercel ไม่ trace อัตโนมัติ
  //   ถ้าไม่ include ฟอนต์จะหายจาก bundle → ข้อความบนปกเป็นกล่อง □□□ บน production
  outputFileTracingIncludes: {
    '/api/auto-cover': ['./src/assets/fonts/**'],
    '/api/cover-tester': ['./src/assets/fonts/**'],
    // ★ audit 9 ก.ค.: ตาเทียบ ref อ่าน public/ref-covers ผ่าน fs (fetchOne path ขึ้นต้น '/') + คลัง ref อ่านไฟล์ data
    //   ไม่ trace = บน Vercel ตาเทียบเงียบหาย + listRefCovers ว่าง — ครอบ route ที่ประกอบปกบนคลาวด์ได้จริง
    '/api/mega/compose-test': ['./public/ref-covers/**', './data/ref-cover-library.json'],
    '/api/mega/compose': ['./public/ref-covers/**', './data/ref-cover-library.json'],
    // ★ 15 ก.ค. (แบตช์ 4 — บัค #10): /api/cover-ref-test ประกอบปก in-process (composeAndVerify) เหมือน compose-test
    //   ต้องได้ ref-covers + คลัง ref + ฟอนต์ไทย — ไม่ trace = ตาเทียบ ref เงียบหาย + ข้อความปกเป็น □□□ บนโฮสต์
    '/api/cover-ref-test': ['./public/ref-covers/**', './data/ref-cover-library.json', './src/assets/fonts/**'],
    // ★ 1 ส.ค. 69 (Opus P1 — กับดักเดิมรอบ 3): ป้ายสาระสารบัญการ์ดอ่านด้วย fs.readFileSync (path runtime)
    //   ไม่ trace = บน Vercel ไฟล์หาย → สารบัญเหลือชื่อการ์ดล้วนแบบเงียบๆ (คนละตัวกับที่ผ่านการประเมิน blind)
    // ★ 8 ส.ค. 69 (กับดักเดิมรอบ 4 — ผู้ตรวจจับก่อนพัง): บัตรลักษณะคลังไวรัล viral-essences.json ก็อ่านด้วย fs
    //   ไม่ trace = โหมดจับคู่ (VIRAL_MATCH_MODE) บน Vercel ตาบอดเงียบๆ — ต้องแนบทุก route ที่เข้าท่อเขียน
    // ★ 14 ส.ค. 69 (กับดักเดิมรอบ 5 — กันไว้ก่อนพัง): viral-likes-real.json (สูตรแสนไลก์) ก็อ่านด้วย fs
    //   ไม่ trace = เปิด VIRAL_HITS_FORMULA บน Vercel แล้วไลก์จริงเงียบหาย (โค้ดข้ามไม่พังท่อ แต่ผลเทสไม่ตรงจริง)
    '/api/auto': ['./data/card-essences.json', './data/viral-essences.json', './data/viral-likes-real.json', './data/writer-viral-rules.json'],
    '/api/auto/process': ['./data/card-essences.json', './data/viral-essences.json', './data/viral-likes-real.json', './data/writer-viral-rules.json'],
    '/api/queue/worker': ['./data/card-essences.json', './data/viral-essences.json', './data/viral-likes-real.json', './data/writer-viral-rules.json'],
    // ★ ผู้ตรวจอิสระ S2 (14 ส.ค.): หน้าเว็บยิง /api/summarize ตรง (content/new) — ต้องได้ไฟล์ชุดเดียวกัน
    //   ไม่งั้นข่าวผ่านคิวได้ไลก์จริง แต่ผ่านหน้าเว็บไม่ได้ แบบเงียบๆ (ช่องนี้ viral-essences ก็เคยขาด)
    '/api/summarize': ['./data/card-essences.json', './data/viral-essences.json', './data/viral-likes-real.json', './data/writer-viral-rules.json'],
  },
};

export default nextConfig;
