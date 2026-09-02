# 🔙 วิธีย้อนกลับระบบข่าว (NEWS ROLLBACK) — อัปเดต 3 ก.ย. 2569

> ใช้เมื่อปล่อยของแล้วเจอปัญหา · เลือก "ระดับเบาสุดที่พอ" · ทุกระดับทดสอบแบบแห้ง (dry-run) มาแล้ว
> สคริปต์: `bash scripts/news-rollback.sh status|dry-run|code|verify` (รันจาก Git Bash ในโฟลเดอร์โปรเจกต์)

## จุดกู้ (แท็ก git · สร้างทุกครั้งที่ปล่อยของ)
| แท็ก | commit | คืออะไร |
|---|---|---|
| `news-prod-736adca3-2sep69` | 736adca3 | production **ก่อน**งานยกระดับ 13 ข้อ (2 ก.ย. 69) · สำเนาเต็ม + ดัมพ์ DB อยู่ `Desktop\ระบบข่าว-จุดกู้ก่อนยกระดับ13ข้อ-2-9-69` และ OneDrive |
| `news-prod-566cbc3d-3sep69` | 566cbc3d | ปล่อยเฟส 1–3 + เปิดกฎนักเขียนชุดใหม่ (5b4b6064) + ชุดย้อนกลับ (3 ก.ย. 69 · push 17:00Z) |

## ระดับ 1 — ปิดสวิตช์ (ไม่แตะโค้ด · ไม่ต้อง push · ใช้เวลา 2 นาที)
ทุกฟีเจอร์ใหม่มีสวิตช์ (ทะเบียนเต็ม `docs/NEWS-SWITCHES.md`) — ตั้งใน Vercel → Settings → Environment Variables แล้วกด **Redeploy**
| อาการ | ตั้งค่า | ได้อะไรกลับ |
|---|---|---|
| ข่าวสั้นไป/ข้อเท็จจริงหาย/ภาษาแปลกจากกฎนักเขียนใหม่ | `WRITER_LENGTH_TARGET_V2=0` `WRITER_FIDELITY_RULES_V2=0` `WRITER_VIRAL_RULES_V2=0` | ใบสั่งเขียนเดิม **ไบต์ต่อไบต์** (พิสูจน์ด้วยเทสสแนปช็อต) |
| มุม 2 แปลก/ประเด็นซ้ำ | `ANGLE2_DISTINCT_V2=0` | การจัดสรรประเด็นแบบเดิม |
| คำเตือนข้อเท็จจริงหายรบกวน | `MISSING_FACTS_GATE=0` | ไม่มี `_missingFacts` |
| ครูตัวอย่างถูกหยิบแปลก | `TEACHER_RANK_V2=0` (และ/หรือ `LIB_CLASSIFIER_V2=0`) | กติกาหยิบครู/จำแนกหมวดเดิม |
| ปุ่ม 👍👎📌 ในดิสคอร์ดมีปัญหา | `BOT_REVIEW_REACTIONS=0` (ฝั่ง Railway) | ข้อความผลเหมือนเดิม ไม่มีปุ่ม |
| บอทจำงานข้ามรีสตาร์ตทำงานผิด | `BOT_RESUME_TRACKING=0` (ฝั่ง Railway) | บอทแบบเดิม (ไม่กู้งานตอนบูต) |
ค่าเริ่มต้นเดิมของสวิตช์ที่ **ปิดอยู่แล้ว** (ไม่ต้องทำอะไร): `WRITER_TRIM_PASS` · `WRITER_PROMPT_CACHE_V2` · `VIRAL_SCORE_ANNOTATE`

## ระดับ 2 — ถอย commit แบบเก็บประวัติ (push ธรรมดา · บอท Railway รีสตาร์ต)
```bash
cd /c/tmp/news-r233 && git fetch origin && git revert --no-edit 5b4b6064 && git push origin HEAD:main
```
ถอยหลายก้อน: `git revert --no-edit <sha ล่าสุด>^..<sha แรก>` แล้ว push · ใช้เมื่ออยากให้ประวัติบอกว่า "เคยเปิดแล้วถอย"

## ระดับ 3 — สะอาด 100% (โค้ดกลับเป็น production เดิมทุกไบต์)
```bash
cd /c/tmp/news-r233
bash scripts/news-rollback.sh status                              # ดูว่าตอนนี้ชี้ไหน แท็กครบไหม
bash scripts/news-rollback.sh dry-run news-prod-736adca3-2sep69   # ดูคำสั่ง + commit ที่จะหาย (ยังไม่ทำอะไร)
bash scripts/news-rollback.sh code    news-prod-736adca3-2sep69   # ⚠️ ย้อนจริง (force-with-lease · มี 5 วินาทีให้ยกเลิก)
bash scripts/news-rollback.sh verify  news-prod-736adca3-2sep69   # origin/main = แท็ก + deploy ล่าสุด
```
- Vercel deploy ตัวเดิมเองจากกิ่ง main · บอท Railway ก็ deploy จากกิ่งเดียวกัน (โค้ดบอทกลับด้วย)
- `--force-with-lease=main:<sha ปัจจุบัน>` = ถ้ามีคน push ทับระหว่างนั้น คำสั่งจะไม่ทำงาน (กันทับงานคนอื่น)
- commit ที่ถอยยังอยู่ในเครื่อง (แท็ก `news-prod-566cbc3d-3sep69`) — จะกลับมาปล่อยใหม่เมื่อไหร่ก็ได้: `git push origin news-prod-566cbc3d-3sep69^{commit}:main`

## ข้อมูล (DB/ไฟล์) ต้องกู้ไหม?
- **ไม่มี migration** · โค้ดใหม่ **ไม่แก้** ตารางเดิม (การ์ด/ครู/คิว/generation logs ใช้โครงเดิม)
- ของใหม่ที่อาจถูกเขียนระหว่างเปิดใช้: store `bot-tracking` (บอทจำงาน) · `post-metrics` (เฉพาะถ้าเคยรัน `scripts/import-fb-metrics.mjs`) — โค้ดเดิม**ไม่อ่าน** store เหล่านี้ → ทิ้งไว้ได้ ไม่มีผล · อยากลบให้สะอาด: ลบแถว `store_items` ที่ `store_name` = ชื่อนั้น
- ถ้าการ์ด/ครูใน DB ถูกแก้เพี้ยน (ไม่เกี่ยวโค้ดชุดนี้): เทียบ/เขียนกลับจากดัมพ์ `Desktop\ระบบข่าว-จุดกู้ก่อนยกระดับ13ข้อ-2-9-69\db` (ดู `00-อ่านก่อน-วิธีกู้.md` ข้อ 4)
- `.env.local`/Vercel env: ฟีเจอร์ใหม่ **ไม่ต้องตั้ง env เพิ่ม** (ค่าเริ่มต้นในโค้ด) — ถ้าเคยตั้ง `VIRAL_SCORE_ANNOTATE=1`/`DISCORD_API_SECRET` ไว้ ลบได้ตอนย้อนระดับ 3 (โค้ดเดิมไม่รู้จัก ทิ้งไว้ก็ไม่มีผล)

## หลังย้อน — ตรวจให้แน่ใจ
1. `bash scripts/news-rollback.sh verify <TAG>` → origin/main ตรงแท็ก + deploy ล่าสุด state = success
2. เปิดเว็บสร้างข่าว 1 ใบ หรือรอข่าวจริงใบถัดไป: `node C:\tmp\news-r233-run\watch-news.mjs <ISO เวลาที่ย้อน>`
3. บอทดิสคอร์ด: พิมพ์คำสั่งสร้างข่าว 1 ครั้ง ดูว่าตอบและส่งผลปกติ
