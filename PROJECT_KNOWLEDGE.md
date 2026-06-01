# 🧠 Project Knowledge Base — Viral Content System
# อัพเดทล่าสุด: 25 พ.ค. 2026

> **ไฟล์นี้คือ "สมอง" ของโปรเจกต์**
> ถ้าเปิดแชทใหม่ ให้ AI อ่านไฟล์นี้ก่อนทำงาน
> จะได้เข้าใจ context ทั้งหมดโดยไม่ต้องอธิบายใหม่

---

## 📋 ระบบคืออะไร
AI Pipeline สร้างข่าวไวรัลสำหรับ Facebook
- **Stack**: Next.js 15+ (App Router) + React 19
- **DB**: Supabase (PostgreSQL) → fallback SQLite/file
- **AI**: Claude Sonnet (เขียน) + GPT-4o (วิเคราะห์) + Gemini Flash (สกัด)
- **Deploy**: Vercel
- **Bot**: Discord Bot ส่งข่าวเข้าระบบผ่าน Queue API

---

## 🏗️ Architecture Flow
```
Input (URL/Text/Image/TikTok/YouTube)
  → /api/auto/process (Universal Router)
    → detectInputType() → routePipeline()
    → Delegate to:
      - processAutoFlow() [URL] — src/lib/services/autoFlowService.js
      - processAutoFlowText() [Text] — src/lib/services/autoFlowServiceText.js
    
    Inside autoFlow:
      Step 1: Scrape/Transcribe → rawText
      Step 2: Extract (Gemini Flash) → newsData {newsTitle, newsBody}
      Step 3: Breakdown (GPT-4o) → breakdownData {angles, emotions, key_facts}
      Step 4: Blueprint (emotional structure)
      Step 5: Smart Research (6-agent fact pool via Serper)
      Step 6: Pre-select prompts from Library (ไม่ซ้ำกัน)
      Step 7: Parallel Generate (Claude/GPT) → 7 versions per 4 angles
      Step 8: Correction Pipeline → final versions
```

---

## 🔧 บัคสำคัญที่แก้แล้ว (ห้ามแก้กลับ)

### 1. Prompt Skip ไม่ Crash (25 พ.ค.)
- **ไฟล์**: autoFlowService.js + autoFlowServiceText.js
- **ปัญหา**: ถ้า angle ไม่มี prompt match → `throw` → ทุก angle ตาย
- **แก้**: return `{success:false, error:'NO_MATCHING_PROMPT'}` แทน throw
- **ผล**: angle ที่ไม่มี prompt ถูกข้าม, angle อื่นยังทำงานต่อ

### 2. Queue Race Condition (25 พ.ค.)
- **ไฟล์**: src/lib/services/queueService.js
- **ปัญหา**: 2 คนส่งพร้อมกัน ได้คิวที่ 1 ทั้งคู่
- **แก้**: serialized lock + คำนวณ position ก่อน add + worker ทำ 1 job/รอบ
- **ผล**: คิวทำงานถูกต้อง ไม่ซ้ำ

### 3. Discord ไม่เข้าคลังข่าว (25 พ.ค.)
- **ไฟล์**: src/app/api/auto/process/route.js
- **ปัญหา**: เนื้อหาจาก Discord/queue ไม่ถูก save เข้า news-archive
- **แก้**: เพิ่ม saveToArchiveServerSide() เรียกเมื่อ isFromQueue=true
- **ผล**: Discord content เข้าคลังเหมือนเว็บ

### 4. Default Prompt ถูกปิด (25 พ.ค.)
- **ปัญหา**: user ไม่ต้องการ default prompt (fallback prompt ทั่วไป)
- **แก้**: ถ้าไม่มี prompt match → ข้าม angle นั้น (ไม่ใช้ default)
- **นโยบาย**: user จะเติม prompt เองใน library เพื่อครอบคลุมมากขึ้น

---

## 📁 ไฟล์สำคัญ (ห้ามแก้โดยไม่เข้าใจ)

| ไฟล์ | หน้าที่ | หมายเหตุ |
|---|---|---|
| `src/lib/services/autoFlowServiceText.js` | Pipeline หลัก (Text input) | 397 บรรทัด |
| `src/lib/services/autoFlowService.js` | Pipeline หลัก (URL input) | 398 บรรทัด |
| `src/lib/services/summarizeServiceText.js` | AI Prompt + Generate | 1819 บรรทัด, ไฟล์ใหญ่สุด |
| `src/lib/services/queueService.js` | ระบบคิว (มี lock) | แก้ race condition แล้ว |
| `src/app/api/auto/process/route.js` | Universal Router | จุดเข้าหลักทุก flow |
| `src/app/content/new/page.js` | หน้า UI สร้างเนื้อหา | 1055 บรรทัด |
| `src/components/content/ResultVersions.js` | แสดงผลบทความ | รวม research อ้างอิง |
| `data/prompt-library.json` | คลัง Prompt DNA | 1.3MB, 50+ prompts |
| `src/lib/ai/promptStoreText.js` | Built-in prompts | extraction, breakdown, presets |
| `src/lib/ai/aiRouter.js` | AI Model routing | ห้ามแก้โดยไม่ได้รับอนุญาต |

---

## ⚙️ ความชอบของ User (กฎพิเศษ)

1. **ห้ามแก้ทันที** — วิเคราะห์ปัญหาให้เห็นก่อนเสมอ
2. **ไม่เอา default prompt** — ให้แสดงผลตาม prompt ที่มี ถ้าไม่มี match ให้ข้าม
3. **สำรองไฟล์ก่อนแก้** — cp file file.bak
4. **ภาษาไทย** — User สื่อสารภาษาไทย
5. **Build ก่อน push เสมอ** — `npx next build` + `node scripts/validate-workflow.mjs`
6. **ห้าม rewrite ไฟล์ใหญ่ทั้งหมด** — แก้ incremental เท่านั้น
7. **Git push เฉพาะไฟล์ที่แก้** — ไม่ใช้ `git add -A` (มี backup folder ชื่อไทยยาว)

---

## 📦 สำรองล่าสุด

| ชื่อ | ที่อยู่ |
|---|---|
| ชุด 1 | `C:\Users\User\viral-content-system\สำรองล่าสุดเกือบสมบูรณ์25-5-14.16_ชุด1\` |
| ชุด 2 | `C:\Users\User\Desktop\สำรองล่าสุดเกือบสมบูรณ์25-5-14.16_ชุด2\` |

---

## 🚧 งานค้าง (ยังไม่ทำ)

1. **Discord notifications** — แจ้งเตือนถ้า flow ติดขัด
2. **5 templates ปกข่าว** — สร้างแทมเพลตลงระบบภาพปก
3. **UI แหล่งอ้างอิง** — แสดงว่า research เจออะไรมาในแต่ละบทความ
4. **รองรับ input สำนวนดีอยู่แล้ว** — ปัจจุบัน Extract ตัดสำนวนออก ทำให้เสียคุณภาพ

---

## 🔑 Environment Variables สำคัญ
```
OPENAI_API_KEY          — GPT-4o
ANTHROPIC_API_KEY       — Claude Sonnet
GEMINI_API_KEY          — Gemini Flash
SERPER_API_KEY          — Google Search (research)
DISCORD_API_SECRET      — Discord bot auth
SUPABASE_URL            — Database
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_ANON_KEY
FIRECRAWL_API_KEY       — Web scraping
```
