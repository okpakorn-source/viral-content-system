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
  },
};

export default nextConfig;
