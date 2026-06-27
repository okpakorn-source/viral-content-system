# 🧠 Project Knowledge Base — Viral Content System
# อัพเดทล่าสุด: 27 มิ.ย. 2026

> **ไฟล์นี้ = ภาพรวมโปรเจกต์ให้คนอ่านเข้าใจเร็ว (resume point)**
> 🔑 **เซฟพอยต์จริงที่ทันสมัยเสมอคือ "Memory ของ AI (โหลดอัตโนมัติทุกแชทใหม่)" + "Git history (ทุก commit มีเหตุผลไทยละเอียด)"**
> ไฟล์นี้อัปเดต **ทุกครั้งที่จบงานใหญ่** (ไม่ auto — ต้องสั่ง/ทำเป็นรอบ) · ถ้าค้าง ให้ยึด git log + memory เป็นหลัก

---

## 📋 ระบบคืออะไร
AI Pipeline สร้างข่าวไวรัลด้านบวกสำหรับ Facebook/IG
- **Stack**: Next.js **16.2.6** (App Router) + React **19.2.4**
- **DB**: Supabase (PostgreSQL) → fallback SQLite (Prisma) → in-memory Map (`persistStore.js`)
- **AI**: Claude Sonnet (เขียน) · GPT-4o/5.5 (วิเคราะห์) · Gemini Flash (สกัด/ดูคลิป)
- **Deploy**: **Railway (บอท/worker หลัก) + Vercel (เว็บ)** — auto-deploy ทั้งคู่จาก `git push origin HEAD:main`
- **Bot**: Discord Bot (โฟลเดอร์ `discord-bot/` แยก package.json) รันบน Railway service `viral-content-system`
- **Repo**: github.com/okpakorn-source/viral-content-system · **working branch `ai/post-selection-quality`** · deploy branch `main`

---

## 🔴 IRON RULE — ระบบ "ทำข่าวอัตโนมัติ" ห้ามแตะเด็ดขาด
ระบบเขียนข่าวคือหัวใจที่ผู้ใช้ห้ามแก้ 100% (เว้นแต่สั่งชัดเจน) — ไฟล์ต้องห้าม:
`autoFlowService.js` · `autoFlowServiceText.js` · `summarizeService*.js` · `aiRouter.js` · `openai.js` ·
`promptStore*.js` · `api/auto/*` · `api/extract` · `api/summarize` · `api/research-search` · `validate-workflow.mjs`

**Pipeline (ห้ามแก้):**
```
Input (URL/Text/คลิป) → /api/auto/process (router) → autoFlow(Service|ServiceText)
  1 Scrape/Transcribe  2 Extract(Gemini)  3 Breakdown(GPT)  4 Blueprint
  5 Smart Research(6 agent/Serper)  6 Pre-select prompts(Library ไม่ซ้ำ)
  7 Parallel Generate(Claude/GPT) → หลายเวอร์ชัน  8 Correction → final
```
ก่อน push ระบบข่าว: `node scripts/validate-workflow.mjs` ต้องผ่าน 100% (68/68) + `npx next build`

---

## 🧩 ระบบย่อย "แก้ได้" (แยกขาดจาก iron-rule)

### 🎨 ระบบทำปก (Cover Lab v3 — AI Vision Director)
- เครื่องมือ: `auto-cover-v3/route.js` → `multiAgentImageScraper.js` (หาภาพ) → `coverDirectorService.js` (AI เห็นภาพจริง→สั่งครอป) → `coverExecutorService.js` (sharp ครอป/ประกอบ)
- **เทมเพลต** (`V3_TEMPLATES`): 8 โครง · **กฎปัจจุบัน: ปก "4+1 เสมอ"** (5 ช่อง: hero + 3-4 + วงกลม) — บล็อก `v3_grid3` (3 ภาพ) เว้นภาพ <4 · Director สลับโครงเองตามเรื่อง (ไม่ล็อก)
- **ครอป**: ทุกช่องเน้นหน้า "อกขึ้นไป" · คนกลางกรอบ · ⛔ห้ามเต็มตัว/ครึ่งตัว/หน้าตัดครึ่ง (rule 0a, 0a-2)
- **เฟรมจริงจากคลิป**: ใส่ลิงก์วิดีโอ → `metaFrameExtractor` (yt-dlp + ffmpeg) แตกเฟรมจริง → `geminiFrameCurator` (Gemini คัดฮีโร่/บริบท) — **เครื่องทีม (win32) เท่านั้น** · Vercel คืน [] · งานปกวิดีโอ route เด้งเครื่องทีมผ่าน `queueService.isMetaVideoJob`
- โหมด: "เฉพาะภาพในลิงก์" vs "ผสมรีเสิร์ช" (`sourceOnly`)

### 🗞️ โต๊ะข่าวกลาง (News Desk)
- `src/app/news-desk/` + `src/lib/services/newsDesk/*` · สมอง 4 ชั้น + harvester หลายเลน + เมนูเช้า Discord
- **สมองคัด "remakeable"**: บังคับทุกแหล่งว่ากระแสเก่าทำใหม่ได้/ไม่ได้ (`deskBrain.classifyBatch`)
- 2 โซน (คลิป/ลิงก์) + 6 คลัง + การ์ดพรีวิวภาพ (`taxonomy.js`)

### 🎬 ถอดประเด็นคลิป (clip-insight / clip-transcript)
- `api/clip-transcript/insight/route.js` · **Gemini gemini-3.5-flash ตัวเดียว** (ปิด fallback ที่ hallucinate) · คีย์แยก `GEMINI_VIDEO_API_KEY`
- 503 = Google โหลดเต็ม (จ่ายเงินไม่ช่วย เว้น Provisioned Throughput) → **คิวอัจฉริยะ รอหาย→รันเอง** + ไฟสัญญาณเขียว/เหลือง/แดง
- YouTube/TikTok รัน Vercel ได้ · **Facebook → เครื่องทีม** (yt-dlp) · `scripts/clip-worker.mjs` (ตัวเลี้ยง restart เอง)

### 🖼️ photo-enhance · 🤖 Discord bot
- photo-enhance: Replicate Real-ESRGAN, `face_enhance=false` (ห้ามแตะหน้า)
- Discord bot: **single-message ถาวร** — เคลม atomic (`mc_<msgId>` Postgres PK) "ก่อนโพสต์ ack" → instance ที่แพ้เงียบสนิท · เลิกคิวภายในบอท ใช้คิวเซิร์ฟเวอร์ · marker `BOT_BUILD` ใน Railway logs ยืนยันโค้ดใหม่

---

## 🚀 Deploy & Infra
- **Deploy**: `git push origin HEAD:main` → Railway + Vercel auto · (มี direct-to-main authorization 10 มิ.ย. — verify validate+build ก่อน)
- **เครื่องทีม (win32)**: `viralflow-team-autostart.cmd` รัน 3 ตัว auto-restart →
  `server-forever.cmd` (production `npm start` พอร์ต 3000, เก็บ log `_prodserver.log`) · `clip-worker-forever.cmd` · `team-queue-poller.cmd` (คว้างานปก/คลิปวิดีโอที่ Vercel เด้งมา)
- **ทำไม production mode**: `npm run dev` (turbopack) รันยาวป่วย "Cannot find module @supabase" → worker 500 → คิวตาย
- **Queue cross-process dedup**: Railway+Vercel แย่งคิว Supabase เดียว → deterministic job id + atomic claim (kill-switch `QUEUE_ATOMIC_CLAIM=0`)

---

## 🐞 บัคใหญ่ที่แก้แล้ว (ห้ามแก้กลับ)
1. **Discord เบิ้ล** → atomic msgId claim ก่อน ack (เหลือ 1 ตอบ/ข้อความ แม้ deploy overlap)
2. **Queue race / ข่าวเจนซ้ำ 2 instance** → deterministic id + atomic claim
3. **persistStore getAll cap 1000** → paginate (cap 20000) กัน orphan บวม
4. **clip-insight hallucinate** (2.5-pro แต่งเอง) → 3.5-flash ตัวเดียว, ปิด fallback
5. **Cover เต็มตัว/3 ภาพ** → กฎครอปหน้า-ไหล่ทุกช่อง + บังคับ 4+1
6. (เดิม 25 พ.ค.) prompt skip ไม่ crash · Discord เข้าคลังข่าว · ไม่ใช้ default prompt

---

## ⚙️ กฎ/ความชอบ User
1. 🔴 **ห้ามแตะระบบทำข่าวอัตโนมัติ** (iron rule ข้างบน)
2. **แยกโค้ดต่อส่วนย่อย + mark ชัด · แก้ทีละจุด → เทส → ยืนยัน ก่อนไปต่อ · แก้แล้วแย่ลง = revert ทันที**
3. ห้ามแก้ทันที — วิเคราะห์ให้เห็นก่อน · ห้าม rewrite ไฟล์ใหญ่ทั้งไฟล์ (แก้ incremental)
4. สำรองไฟล์ก่อนแก้ (`.bak`) แต่ **commit ห้าม include .bak** · ไม่ `git add -A` (มีโฟลเดอร์สำรองชื่อไทยยาว)
5. สื่อสารภาษาไทย · ทดสอบปกต้องใช้เนื้อข่าวเต็ม (ห้ามตัดสั้น)
6. ทำงานแบบผู้จัดการ: รับโจทย์ใหญ่ → สร้าง+เทสเอง → ส่งของที่ใช้ได้จริง

---

## 🚧 งานค้าง
1. โต๊ะข่าว เฟส C — harvester หาคลิปเยอะขึ้นต่อคลัง
2. Cover: ถ้าข่าวภาพหายาก (พูล <5) ยังได้โครง 4 ช่อง — หาวิธีดันเป็น 5 อย่างมีคุณภาพ (เคยลอง Tier REAL แต่ revert เพราะภาพหลุดเรื่อง)

---

## 🔑 Environment Variables สำคัญ
```
OPENAI_API_KEY · ANTHROPIC_API_KEY · GEMINI_API_KEY (ข่าว/text)
GEMINI_VIDEO_API_KEY (แยกเฉพาะถอดคลิป) · SERPER_API_KEY (research)
DISCORD_BOT_TOKEN + API_URL (บอท) · SUPABASE_URL/SERVICE_KEY/ANON_KEY
FIRECRAWL_API_KEY · REPLICATE (photo-enhance) · YOUTUBE_API_KEY (optional)
```

---

## 🗂️ โปรเจกต์แยก (คนละ repo/โฟลเดอร์ — ห้ามปนกัน)
- **ไทยนิวส์** `C:\Users\User\ไทยนิวส์` (พอร์ต 3300) — แปลไทยไวรัล→อังกฤษ transcreation
- **โปรเจกต์ทรู** `C:\Users\User\โปรเจกต์ทรู` (3100) — แคปเฟรมสินค้า RedNote → Postiz
- **ปกคอลลาจ** `C:\Users\User\โปรเจกต์ปกคอลลาจ` (3200) · **ClipForge** `C:\Users\User\ClipForge` (3400) — ตัดคลิปยาว→สั้น
- เครื่องถอดบทสัมภาษณ์ `/clip-transcript` · reframe `/reframe-cases` (แยกจากระบบทำข่าว 100%)
