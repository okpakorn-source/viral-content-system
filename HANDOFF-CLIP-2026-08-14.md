# 📦 กล่องส่งมอบงาน — ระบบถอดคลิป: ย้อนยุคนิ่ง + ศึกสองโมเดล (14 ส.ค. 69)

> **สำหรับเซสชั่น Claude บนเครื่องทีม (Windows):** อ่านไฟล์นี้จบแล้วทำต่อได้ทันที
> งานถูกส่งมอบจากเซสชั่นคลาวด์ (เจ้าของเปิดจากมือถือ) — โค้ดทั้งหมดอยู่บน `main` แล้ว
> เหลือภารกิจเดียว: **ยิงศึกสองโมเดลผ่านคิวเครื่องนี้ แล้วส่งรายงาน vs ให้เจ้าของเรียกเอเจนท์โหวต**

---

## 1. งานที่จบแล้ววันนี้ (อยู่บน main ครบ — ห้ามทำซ้ำ)

| กลุ่มงาน | คอมมิตหลัก | สาระ |
|---|---|---|
| ย้อนยุคนิ่ง | `499df17` | กู้ 3 ไฟล์ (สมอง/route/หน้าเว็บ) กลับสภาพ 16 ก.ค. 69 แบบ byte-identical จาก commit `860b282` — กรอบเทา+ประเด็นย่อย คำพูดอยู่ช่อง quotes แยก โควตาความยาว 600/1,500/2,500 |
| ลบของที่หยุดใช้ | `06190ca` `7bbb117` | โมดูลกรอบเขียว/ม่วง/QC/แบบการเล่า 5 ตัว + เทส 13 ไฟล์ + แผง "คลังบทถอด" ในหน้าเว็บ |
| โมเดล | `a5344ee` `ba31a73` | เป้าหมายเจ้าของ "3.7 flash high" → พิสูจน์ด้วย ListModels จากคีย์จริง: ชื่อ `-high` **ไม่มีใน API** ชื่อจริงคือ **`gemini-3.7-flash`** (ตั้งเป็นค่าหลักแล้ว · ถอยกลับ: env `GEMINI_VIDEO_MODEL=gemini-3.6-flash`) |
| เครื่องมือเทส | `cc2a304` `8f4b35e` `3222600` + ชุดคิว | `scripts/clip-before-after.mjs` (ก่อน/หลัง · ศึกสองโมเดล direct/queue/collect) · workflow `clip-ai-test.yml` + `clip-model-probe.yml` · `gemini-health?list=`/`?probe=` (ถามรายชื่อรุ่น/ยิงทดสอบรุ่น error เต็ม) |
| ท่อโมเดลรายคำขอ | `9a0fc7c` + ชุดคิว | `/insight` และใบงานคิวรับ `model` (allowlist 3.5/3.6/3.7-flash) → worker ส่งต่อ + `force` · ใบผลติด `modelUsed` + user มาร์ค |
| เครื่องมือเครื่องทีม | `841d108` | `scripts\clip-sync-restart.cmd` — pull+install+build+รีสตาร์ทพอร์ต 3000+worker คลิกเดียว |

**สถานะ ณ ส่งมอบ:** local sandbox = branch `claude/clip-transcript-system-o7ybdw` = `main` = Vercel (deploy อัตโนมัติ) ตรงกันทุกจุดที่ `841d108` · เครื่องทีมยังไม่ pull

## 2. บันทึกอุปสรรค (เรียงเวลา — สำคัญต่อการตัดสินใจ)

1. `gemini-3.7-flash-high` → error ทันที = **ชื่อรุ่นไม่มีจริง** (แก้แล้ว)
2. `gemini-3.7-flash` (ชื่อถูก) → **503 high demand** — โมเดลเพิ่งเปิดตัว คนทั้งโลกแห่ใช้ (พิสูจน์จาก `?probe=` error เต็ม)
3. 13:36Z ยิงศึกบนคลาวด์ → **403 Forbidden ทั้ง 3.6 และ 3.7 เฉพาะสายอัปโหลดไฟล์วิดีโอ** (text probe ยังได้ 503 ปกติ = คีย์ไม่ตาย) — สรุปเป็นความปั่นป่วนฝั่ง Google วันโมเดลใหม่เปิดตัว/คีย์โดนจำกัดชั่วคราว **ไม่ใช่บั๊กโค้ดเรา**
4. เจ้าของเคาะ: **"ยิงผ่านเครื่องฉัน — คิวแทบไม่เคยล่ม"** → ต่อท่อ model เข้าคิวเสร็จแล้ว รอรันที่เครื่องนี้

## 3. ภารกิจของเซสชั่นนี้ — ทำตามลำดับ

```
① scripts\clip-sync-restart.cmd          ← pull+install+build+รีสตาร์ท 3000+worker (3900 เปิดตามวิธีทีม)
② curl "http://localhost:3000/api/clip-transcript/gemini-health?list=3.7"
   ต้องได้ {"success":true,...,"models":["gemini-3.7-flash"]}  ← ยืนยันโค้ดใหม่
③ ยิงศึกเข้าคิวเครื่องนี้ (คลิปปักไว้: ชมพู่ อารยา — ใบเดิมในคลังมีให้เทียบ):
   set CLIP_BA_BASE=http://localhost:3000
   set CLIP_BA_VIA=queue
   set CLIP_BA_MODELS=gemini-3.6-flash,gemini-3.7-flash
   set CLIP_BA_USER=เอไอทดสอบ
   set CLIP_BA_URL=https://www.tiktok.com/@thairath_ent/video/7607336962885799189
   node scripts/clip-before-after.mjs
   → ใบงาน 2 ใบเข้าคิว clip-worker เครื่องนี้หยิบไปถอดเอง (retry ทุก ~3 นาทีจน Gemini ว่าง สูงสุด ~4 ชม.)
④ รอเสร็จ (ดูแผงคิวหน้า /clip-transcript หรือหน้าต่าง clip-worker) แล้วเก็บรายงาน:
   set CLIP_BA_COLLECT=https://www.tiktok.com/@thairath_ent/video/7607336962885799189
   node scripts/clip-before-after.mjs
   → ได้ scratch/clip-model-vs-queue-*.md = เนื้อเต็มทุกตัวอักษรทั้งสองรุ่น + ตารางตัววัด
⑤ ส่งไฟล์รายงานให้เจ้าของ (จะเรียกเอเจนท์มาโหวตเลือกโมเดล) — ห้ามสรุปแทนกรรมการ
```

ถ้า 3.7 ยังโดน 503 นาน: คิวจะ retry ให้เอง ไม่ต้องทำอะไร · ถ้าเกิน ~4 ชม. งานถูกตัด ให้ยิง ③ ซ้ำช่วงคนน้อย (เช้ามืด)

## 4. กฎที่เซสชั่นนี้ต้องถือ (บทเรียนจริงวันนี้)

- อ่าน `SYSTEM_SAFETY_RULES.md` ก่อนแก้ไฟล์ใดๆ — ≤3 ไฟล์/งาน · backup ก่อนแก้ · ทุกการแก้ revert ได้
- `main` ร้อนมาก (ทีม push แทรกทั้งวัน) — **rebase ก่อน push เสมอ** และห้ามพ่วงงานคนอื่น
- ห้ามคอมมิต `package-lock.json` ที่เพี้ยนจาก `npm install` (คืนด้วย `git checkout -- package-lock.json`)
- เทสคลิป 13 ไฟล์ถูกลบโดยตั้งใจ (ของฟีเจอร์ที่ลบ) — เทสที่เหลือต้องผ่าน: `tests/source-clip-rx-expand.test.mjs` + `node scripts/validate-workflow.mjs` + `npx next build`
- ประวัติก่อน 1 ส.ค. ไม่อยู่ในโคลน (shallow) — ดูจาก GitHub · คอมมิตยุคนิ่งอ้างอิง: `860b282`
- ผลเทสต้องมาจากการรันจริงเท่านั้น — **ห้ามมโนผลแทน Gemini เด็ดขาด**

## 5. แผนที่ไฟล์สำคัญ

- สมองถอด: `src/lib/services/clipInsightService.js` (325 บรรทัด ยุคนิ่ง + ท่อ model)
- Route: `src/app/api/clip-transcript/insight/route.js` · คิว: `submit` `worker` · วินิจฉัย: `gemini-health` (`?list=` `?probe=`)
- โมเดล: `src/lib/ai/geminiClient.js` (`VIDEO_MODEL`)
- เทส/ปฏิบัติการ: `scripts/clip-before-after.mjs` · `scripts/clip-worker.mjs` · `scripts/clip-sync-restart.cmd`
- Workflow (รันจาก GitHub Actions ได้): `.github/workflows/clip-ai-test.yml` · `clip-model-probe.yml`
