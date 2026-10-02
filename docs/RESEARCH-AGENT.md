# เอเจนต์รีเสิร์ช v2 — คู่มือติดตั้ง ใช้งาน แผนสำรอง และวิธีถอย

> **สถานะ:** เฟส 1 (shadow) · สเปกล็อกตามคำตอบเจ้าของ 25 ข้อ วันที่ 1 ต.ค. 69 · **ปิดเป็นค่าเริ่มต้น**
> ใบสเปกเต็มอยู่นอก repo: `C:\tmp\research-agent-lab\SPEC-v2.md` (สเปกข้อ 0 = คำตอบเจ้าของ · สเปกข้อ 2 = สัญญาข้อมูล)
> **🔗 = ชื่อไฟล์/ธง/route/คำสั่งที่ขึ้นกับโค้ดเลนอื่น** (ตามสเปก หรือตามโค้ดเลน A–C ก่อนรวม — รอบแก้ r2 เทียบโค้ดเลน A แล้วเรื่องไฟล์ธงหยุด · `--stop`/`--resume`/`--check` · คำ `browser` ใน `RESEARCH_AGENT_TOOLS` · `RESEARCH_AGENT_WORKER_ID`) — ผู้ตรวจหลังรวมต้องเทียบกับโค้ดจริงอีกรอบ (เช็กลิสต์ส่วน 14)
> อ้างอิงในคู่มือ: **เจ้าของ#N** = คำตอบเจ้าของข้อ N (สเปกข้อ 0) · **สเปกข้อ N** = ส่วน N ของ SPEC-v2 · **ส่วน N** = หัวข้อในคู่มือนี้
> **รอบ r3 (1 ต.ค. 69):** ปรับตามข้อตัดสินผู้คุมงานหลังตรวจสัญญาข้ามเลน (`C:\tmp\research-agent-lab\contract-check.json`) — env ครบ + ป้ายที่ตั้ง (ส่วน 3) · Railway ใช้ `API_KEY` = `DISCORD_API_SECRET` และห้ามตั้ง secret ของ worker · เส้นตายใบขอ `RESEARCH_AGENT_DEADLINE_MIN` · งานขนาน `RESEARCH_AGENT_CONCURRENCY` · เกณฑ์ข่าวเก่า `RESEARCH_AGENT_STALE_DAYS` · row id `bposted_` (ส่วน 2) · เวลาท่อรอ = `waitedMs` (ส่วน 10)

---

## 1. สรุปใน 1 นาที

- **ทำอะไร:** พนักงานส่งข่าวใน Discord ตามปกติ (มีลิงก์ต้นทางก็วางไว้ในข้อความเดียวกันได้ บอทแยกเอง) → worker บนเครื่องเจ้าของสั่ง Codex CLI รุ่น `gpt-6-astra` ระดับ `low` ให้อ่านข่าวแล้ว**ตัดสินใจเอง**ว่าจะค้นอะไร (หาต้นทาง · เช็คชื่อ/ตัวเลขกับต้นทาง · ข่าวเก่าไหม · ข้อเท็จจริงที่เพิ่มมิติ) → ส่ง "🧾 บัตรข้อเท็จจริง" reply ใต้ข้อความพนักงาน → พนักงาน/เจ้าของกด 👍/👎
- **ปิดเป็นค่าเริ่มต้น:** ไม่ตั้ง `RESEARCH_AGENT=1` = ระบบข่าวทำงานเหมือนก่อนมีฟีเจอร์นี้ทุกไบต์ (ผู้ตรวจอิสระต่อเลนตรวจข้อนี้ก่อนรวม)
- **ระบบอื่นไม่ล่มเพราะขั้นนี้ (เจ้าของ#4):** worker ดับ/ช้า/โควตาหมด → ข่าวเดินต่อ · โหมด shadow ท่อข่าวไม่รอเลย · โหมด assist รอไม่เกิน `RESEARCH_AGENT_WAIT_MS` แล้วไปต่อ (fail-open) · ไม่กินงบเวลาของขั้นเขียนข่าว
- **โหมด shadow ไม่แตะเนื้อข่าว:** การ์ดโชว์ให้พนักงานดูอย่างเดียว นักเขียนและด่านตรวจไม่ได้รับ (เข้าเนื้อข่าวได้เฉพาะโหมด write = เฟส 4 หลังผ่าน shadow/assist และเจ้าของอนุมัติไฟล์ล็อก — เจ้าของ#24)
- **ไม่ใช่รีเสิร์ช v1:** ห้ามตั้ง `NEWS_RESEARCH=1` (ระบบเก่าปิดถาวรตั้งแต่ 24 ส.ค. 69 · คนละสวิตช์กัน)

## 2. ภาพการไหล

```
Discord (พนักงานส่งข้อความ [+ลิงก์]) → บอท (Railway) แยกลิงก์ → POST /api/queue/add {input, sourceUrls[]}
   → enqueueJob → jobId · workflowId = unify_<jobId>
   → store 'research-requests' {id: jobId, rawText, sourceUrls, status:'queued', deadlineAt}
Vercel cron → /api/auto/process → autoFlowServiceText (extract → breakdown → PRE-GENERATE → generate → …)
   → PRE-GENERATE อ่าน 'research-cards'[jobId] (shadow: ไม่รอ · assist: รอ ≤ RESEARCH_AGENT_WAIT_MS · fail-open)
เครื่องเจ้าของ: scripts/research-agent-worker.mjs 🔗 → POST /api/research/lease (x-research-secret)
   → รัน Codex (gpt-6-astra low) ในโฟลเดอร์งานชั่วคราว → ด่านเชิงกล → POST /api/research/report → store 'research-cards'
บอท: poll /api/research/cards?jobId → reply การ์ดใต้ข้อความพนักงาน · รีแอ็กชัน 👍/👎 → /api/research/feedback
```

ข้อมูลทั้งหมดอยู่ใน Supabase ตาราง `store_items` (store ใหม่ 4 ตัว: `research-requests` · `research-cards` · `bot-posted` · `research-workers` = ชีพจร/โควตา/เวอร์ชันของ worker ต่อเครื่อง) — ไม่แก้ schema · worker ไม่ถือคีย์ Supabase เขียนผ่าน route ที่ตรวจ secret เท่านั้น

**row id มีคำนำหน้าต่อ store** (`rreq_<jobId>` · `rcard_<jobId>` · `bposted_<jobId>` · `rworker_<workerId>`): `store_items.id` เป็น PK เดียวข้ามทุก store และ jobId ถูกแถวคิว `job_queue` ใช้เป็น id อยู่แล้ว — ใช้ jobId ตรงๆ = insert ชน 23505 · ส่วน `data.id` = jobId ตามสัญญา 2.x ทุกตัว
- **`bot-posted` ต่างจากสเปกข้อ 2.3** (ที่เขียน `id: jobId`) เฉพาะระดับ row id = `bposted_<jobId>` (`data.id` = jobId · มี `revision` เขียนแบบ cas) · นิยามเดียวอยู่ที่ `saveBotPosted`/`getBotPosted` ใน `src/lib/research-agent/store.js` (เลน B) — route `/api/bot/posted` ของเลน C ต้องเรียกผ่านสองฟังก์ชันนี้ ห้ามเขียน persistStore ตรง · `caseId` เป็นข้อความ (ไม่บังคับตัวเลข) · `postedAt` = เวลาที่บอทโพสต์ผล (บัตรขึ้นก่อนผล = `null` ไปก่อน)

## 3. ตั้งค่า (env) — ตัวไหนตั้งที่ไหน

ตัวอย่างพร้อมคอมเมนต์อยู่ใน `.env.example` (หมวด "เอเจนต์รีเสิร์ช v2" · ป้าย `[Vercel]` / `[Railway]` / `[เครื่อง]` บอกครบทุกที่ที่โค้ดอ่าน) · **ทุกตัวไม่ตั้ง = ปิด/ค่าเริ่มต้น** · "เครื่อง worker" = `.env.local` ของเครื่องที่รัน `scripts/research-agent-worker.mjs`

| ตัวแปร | ตั้งที่ | ไม่ตั้ง = | ใช้ทำอะไร |
|---|---|---|---|
| `RESEARCH_AGENT` | Vercel **และ** Railway | ปิดทั้งระบบ | `1` = เปิด (รับเฉพาะ `1`) · Vercel = ใบขอ/ท่อ/route · Railway = บอทแยกลิงก์ ตามการ์ด 👍👎 เตือนโควตา — ต้องเปิดทั้งสองที่ |
| `RESEARCH_AGENT_MODE` | Vercel | shadow | `shadow` → `assist` → `write` (สเปกข้อ 3) · ค่าอื่น = shadow · `write` (เฟส 2 · SPEC-v3 · ส่วน 16) = รอการ์ดหลังขั้นสกัด → บรรณาธิการเรียบเรียงฉบับเสริม → ใช้แทนต้นฉบับในทุกขั้นถัดไป (สายข้อความเท่านั้น · สาย URL/คลิปทำแบบ assist) |
| `RESEARCH_AGENT_SECRET` | Vercel **และ** เครื่อง worker (ค่าเดียวกัน) · ⛔ **ห้ามตั้งบน Railway** | route ของ worker ตอบ 503 (ปิดประตู) | ความลับของ header `x-research-secret` (lease/heartbeat/report) · บอทไม่ใช้ค่านี้ |
| `RESEARCH_AGENT_WAIT_MS` | Vercel | shadow = 0 เสมอ · assist = 90000 · write = 300000 | assist: ท่อรอการ์ดที่ PRE-GENERATE ได้นานสุด (ms) · เพดาน 180000 · write: รอหลังขั้นสกัด นับจากเริ่มท่อ · เพดาน 300000 · ทั้งสองโหมดเลิกรอเมื่อเส้นตายรวมเหลือ < 480 วิ · fail-open |
| `RESEARCH_AGENT_HOLD_MS` | Vercel | โหมด write = WAIT_MS ของ write + 60000 (= 360000) · โหมดอื่นไม่มีผล | โหมด write: **คิวชะลอหยิบงาน** ข่าวที่ใบขอรีเสิร์ชยัง `queued`/`leased` จนเสร็จหรืออายุใบขอครบค่านี้ (ms นับจากสร้างใบขอ · เพดาน 600000 · `0` = ปิด) · ตัวหยิบงานข้ามไปหยิบงานถัดไป (ไม่บล็อกคิว) · fail-open (อ่านไม่ได้/เกิน 3 วิ = หยิบตามปกติ) · ส่วน 16 |
| `QUEUE_NEWS_CONCURRENCY` | Vercel | 1 (ทีละข่าว = เดิมทุกไบต์) | (2 ต.ค. 69 · W6 · SPEC-v3 ส่วน 11 · ไม่ใช่สวิตช์รีเสิร์ช — `.env.example` หมวด "คิวข่าว") **ท่อข่าวขนาน:** จำนวนข่าวที่เขียนพร้อมกันได้บน Vercel (ตัวหยิบงานคิว + self-heal ของ `/api/queue/status`) · อ่านไม่ได้/< 1 = 1 · เพดาน 10 · เวลาต่อข่าวเท่าเดิม แต่ข่าวที่ส่งซ้อนกันไม่ต้องรอข่าวก่อนหน้า · งานปก/คลิปคงทีละ 1 · ค่าแผน production = 8 · ส่วน 16 |
| `RESEARCH_AGENT_DEADLINE_MIN` | Vercel | 15 | เส้นตายใบขอ = เวลาเข้าคิว + นาทีนี้ (1–120) · ใบที่ worker ยังไม่หยิบเมื่อเลยเวลา = `expired` (ข่าวเดินต่อปกติ) · worker ที่หยิบแล้วใช้เส้นตายนี้คุมเวลางาน (ไม่เกิน MAX_MINUTES+1) · ข้อตัดสิน 1 ต.ค. 69 แทนสูตรเดิม "MAX_MINUTES + 60 วิ" |
| `RESEARCH_AGENT_MAX_CALLS` | เครื่อง worker | 24 | เพดานเรียกเครื่องมือต่องาน (เจ้าของ#18) |
| `RESEARCH_AGENT_MAX_MINUTES` | เครื่อง worker | 6 | เพดานเวลาต่องาน (Codex ถูกตัดที่นาทีนี้ + 1 แต่ไม่เกินเส้นตายใบขอ) · ฝั่งเว็บไม่อ่านแล้ว |
| `RESEARCH_AGENT_EFFORT` | เครื่อง worker | low | ระดับความคิดของ Codex (เจ้าของ#17) |
| `RESEARCH_AGENT_ALLOW_MEDIUM` | เครื่อง worker | เปิด | ยก medium อัตโนมัติเฉพาะข่าวยาก (บันทึก `brain.effort` ทุกครั้ง) · `0` = ห้ามยก |
| `RESEARCH_AGENT_TOOLS` | เครื่อง worker | ทุกตัว + เบราว์เซอร์ | รายชื่อเครื่องมือที่อนุญาต คั่นด้วยจุลภาค (ชื่อตามตารางส่วน 11) + คำพิเศษ `browser` = อนุญาตเบราว์เซอร์ Edge 🔗 · ⚠️ **ตั้งตัวแปรนี้เมื่อไร ต้องใส่ `browser` ในรายชื่อด้วยถ้ายังต้องการเบราว์เซอร์** — ไม่ใส่ = เบราว์เซอร์ (เพจ "เล่าเรื่อง ดารา" เจ้าของ#9) ปิดเงียบๆ · ตรวจด้วย `node scripts\research-agent-worker.mjs --check` บรรทัด "เบราว์เซอร์" |
| `RESEARCH_AGENT_BRAIN` | เครื่อง worker | codex | `api` = OpenAI Responses API (เสียเงินต่อครั้ง · ไม่มีเบราว์เซอร์) · งบเดือนถึงเพดาน = หยุด (ธง `TOOL_BUDGET_MONTH`) |
| `RESEARCH_AGENT_API_FALLBACK` | เครื่อง worker | ปิด | (1 ต.ค. 69 · ออดิตก่อน push) `1` = เปิด**ทางสำรอง OpenAI API** เมื่อ Codex ใช้ไม่ได้ (โควตาหมดทุกบัญชี · หลุดล็อกอิน · ล้ม/ผลผิดสัญญา) — เสียเงินจริง `gpt-6-astra` $10/$50 ต่อ 1M โทเคน + web search $10/1,000 · **ไม่ตั้ง = ปิด**: งานนั้นล้ม + ธง `BRAIN_UNAVAILABLE` (+ `CODEX_AUTH`/`QUOTA_LOW` ตามเหตุ) + บอท mention เจ้าของวันละครั้ง · เปิดเมื่อเจ้าของยอมจ่ายเท่านั้น · งบเดือนถึงเพดาน = ทาง API หยุดเอง |
| `RESEARCH_AGENT_CONCURRENCY` | เครื่อง worker | 2 | งานพร้อมกันต่อเครื่อง (1–4) · **เบราว์เซอร์ใช้ได้ทีละงาน** (ไฟล์ล็อก) — งานที่ไม่ได้ล็อกรันโดยตัด `browser` ออกจากเครื่องมือของงานนั้น + บันทึกใน `tool_log` · ค่าสูง = โควตา Codex หมดเร็วขึ้น |
| `RESEARCH_AGENT_STALE_DAYS` | เครื่อง worker | 7 | เรื่องเก่ากว่าวันส่งเกินกี่วัน = ธง `STALE_NEWS` — ธงอย่างเดียวทุกอายุ ไม่หยุดข่าว (เจ้าของ#14) |
| `RESEARCH_AGENT_QUOTA_ALERT_PCT` | เครื่อง worker + Vercel + Railway (ค่าเดียวกัน) | 15 | เตือนเมื่อโควตา Codex **คงเหลือ** ≤ ค่านี้ (เจ้าของ#16) · เครื่อง = ธง `QUOTA_LOW` · Vercel = `/api/research/status` ขึ้น `low` · Railway = บอท mention เจ้าของวันละครั้ง |
| `RESEARCH_AGENT_OWNER_DISCORD_ID` | Railway | เจ้าของเซิร์ฟเวอร์ (guild owner) | Discord user id ที่บอท mention ตอนเตือนโควตา + ธงระบบ `BRAIN_UNAVAILABLE` · `CODEX_AUTH` · `API_FALLBACK` · `TOOL_BUDGET_MONTH` (วันละครั้งต่อธง) |
| `RESEARCH_DIGEST` | Railway | เปิด (เมื่อบอทเปิดรีเสิร์ช) | (2 ต.ค. 69 · W7 · SPEC-v3 ส่วน 12) `0` = ปิด**สรุปรายวัน**อย่างเดียว (ตัวเฝ้า worker / แจ้งล้มติดกันยังทำงาน) · ค่าอื่น/ไม่ตั้ง = ส่งวันละครั้งตามเวลาด้านล่าง · ส่วน 17 |
| `RESEARCH_DIGEST_HOUR` | Railway | 7 | (W7) ชั่วโมงที่ส่งสรุปรายวัน เวลาไทย 0–23 · ค่าผิดรูป = 7 · ส่วน 17 |
| `RESEARCH_DIGEST_MINUTE` | Railway | 30 | (W7) นาทีที่ส่งสรุปรายวัน 0–59 · ค่าผิดรูป = 30 · ส่วน 17 |
| `ADMIN_LOG_CHANNEL_ID` | Railway | ไม่มี (= log บอทอย่างเดียว) | (W7) channel id ของห้องสำรองเมื่อ DM เจ้าของไม่ได้ (เจ้าของปิด DM) หรือไม่ได้ตั้ง owner id — บอทโพสต์ที่นี่พร้อม mention เจ้าของ · ส่วน 17 |
| `RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH` | เครื่อง worker (+ เครื่องที่รันรายงาน) | 10 | เพดานค่าเครื่องมือต่อเดือน เตือนเมื่อถึง (เจ้าของ#18 — Codex ทำต่อ) · ทาง OpenAI API (ทางสำรอง/`BRAIN=api`) **หยุดจริง**เมื่อถึง (ธง `TOOL_BUDGET_MONTH`) |
| `RESEARCH_AGENT_API_BASE` | เครื่อง worker | — | โดเมน production เช่น `https://<โดเมน>` = ค่า `API_URL` ของบอทบน Railway ตัด `/api/auto/process` ท้ายออก |
| `CODEX_ACCOUNT` | เครื่อง worker | main | บัญชี Codex ที่ใช้ (`main` = `~\.codex` · `b`/`c`… = `~\.codex-b`…) |
| `RESEARCH_AGENT_CODEX_ACCOUNTS` | เครื่อง worker | บัญชีเดียว | ลำดับบัญชีที่สลับไปเมื่อคงเหลือ ≤5% เช่น `main,b,c` |
| `RESEARCH_AGENT_CODEX_BIN` | เครื่อง worker | `codex` ใน PATH | พาธโปรแกรม codex ไฟล์เดียว — ใช้เมื่อเปิดผ่าน Task Scheduler แล้ว PATH ไม่เห็น codex · ห้ามใส่อาร์กิวเมนต์/อักขระสั่งงาน (`--check` ฟ้อง) |
| `RESEARCH_AGENT_IDLE_MS` | เครื่อง worker | 10000 | ช่วงถามงานตอนว่าง (ms · 1000–120000) — ทุกครั้ง = 1 การเรียก Vercel |
| `RESEARCH_AGENT_WORKDIR` | เครื่อง worker | ค่าเริ่มต้นของ worker 🔗 | โฟลเดอร์ทำงานต่องาน `<WORKDIR>\<jobId>\` |
| `RESEARCH_AGENT_WORKER_ID` | เครื่อง worker | ชื่อเครื่อง 🔗 | ชื่อ worker ที่ส่งตอนรับงาน (lease) · สองเครื่องได้ชื่อต่างกันเองอยู่แล้ว ตั้งเมื่ออยากให้อ่านง่าย (ส่วน 6 ชั้น 2) |

**ปริมาณงาน (เจ้าของแจ้ง 1 ต.ค. 69):** 30–40 ข่าว/วัน ช่วง 08:00–22:00 มาเป็นจังหวะไม่ตายตัว → worker หนึ่งเครื่องรับขนาน `RESEARCH_AGENT_CONCURRENCY` งาน (2) · ใบขอรอ worker ว่างได้ถึง `RESEARCH_AGENT_DEADLINE_MIN` (15 นาที) · บอทถามการ์ดต่อหลังโพสต์ผลได้ถึง 15 นาที · ใบที่ไม่ถูกหยิบทัน = `expired` ข่าวออกปกติ (ดูส่วน 13 ถ้า expired บ่อย)

คีย์เครื่องมือเดิมที่ worker ส่งต่อให้เอเจนต์ (สเปกข้อ 4: env ของโปรเซสลูกเป็นรายชื่ออนุญาต ตัวอื่นไม่ผ่าน): `SERPER_API_KEY` · `JINA_API_KEY` · `FIRECRAWL_API_KEY` · `APIFY_API_TOKEN` · `OPENAI_API_KEY` · `TAVILY_API_KEY` · `YOUTUBE_API_KEY` · `SUPADATA_API_KEY` · `GEMINI_API_KEY` · `SERPAPI_KEY` — ตรวจชื่อใน `.env.local` ของเครื่องเจ้าของ 1 ต.ค. 69: มีครบ **ยกเว้น `SUPADATA_API_KEY`** (ไม่ตั้ง = ตัวถอดคลิปข้าม Supadata ไปใช้ซับ YouTube / yt-dlp + Whisper แทน) (⚠️ ไม่ส่ง OPENAI_API_KEY ให้ Codex โดยตั้งใจ — กัน Codex คิดเงินแบบ API · เครื่องมือ web-agent อ่านคีย์จาก .env.local ของ repo เอง)

**Railway (บอท Discord):**

- `RESEARCH_AGENT=1` — สวิตช์ฝั่งบอท (รับเฉพาะ `1`): แยกลิงก์ในข้อความพนักงานเป็น `sourceUrls` · ถามการ์ดทุก 20 วิระหว่างรอข่าว และต่ออีกไม่เกิน 15 นาทีหลังโพสต์ผล · reply การ์ดใต้ข้อความพนักงาน · รับ 👍/👎 · เตือนโควตา · ไม่ตั้ง = บอทเหมือนเดิมทุกอย่าง
- ไม่มีความลับใหม่: บอทใช้ `API_URL` + `API_KEY` เดิม — **`API_KEY` บน Railway ต้องเท่ากับ `DISCORD_API_SECRET` บน Vercel** (route `/api/research/cards` · `/api/research/feedback` · `/api/bot/posted` ตรวจ header `x-api-key`/`x-bot-secret` ด้วยค่านี้ · ไม่ตรง = 401 · Vercel ไม่ตั้ง `DISCORD_API_SECRET` = 403 ปิดประตู)
- `RESEARCH_AGENT_QUOTA_ALERT_PCT` (ไม่ตั้ง = 15) · `RESEARCH_AGENT_OWNER_DISCORD_ID` (ไม่ตั้ง = เจ้าของเซิร์ฟเวอร์)
- ⛔ **ห้ามตั้ง `RESEARCH_AGENT_SECRET` บน Railway** — เป็นความลับของ worker เท่านั้น บอทไม่ส่ง/ไม่ใช้ (ตั้งไว้ = บอทเตือนใน log ตอนเปิด ไม่พิมพ์ค่า) · ความลับยิ่งวางหลายที่ยิ่งเสี่ยงรั่ว
- ปิด `RESEARCH_AGENT` บน Vercel แล้ว บอทได้คำตอบ `enabled:false` จาก `/api/research/cards` → เลิกถามงานนั้นเอง
- (2 ต.ค. 69 · W7) **แจ้งเตือนเจ้าของ + สรุปรายวัน** เปิดพร้อมสวิตช์รีเสิร์ชของบอท — ตั้ง `RESEARCH_AGENT_OWNER_DISCORD_ID` (ส่ง DM) · ห้องสำรอง `ADMIN_LOG_CHANNEL_ID` · เวลาสรุป `RESEARCH_DIGEST_HOUR`/`RESEARCH_DIGEST_MINUTE` (07:30) · ปิดเฉพาะสรุป `RESEARCH_DIGEST=0` (ส่วน 17)

**สร้าง secret ใหม่** (พิมพ์ค่าออกจอให้เจ้าของคัดลอกเอง — ห้ามวางในแชท/Discord/ไฟล์ที่ commit):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 4. ติดตั้ง worker บนเครื่องเจ้าของ (ครั้งแรก)

**เตรียม (เช็คทีละข้อ):**

1. โฟลเดอร์ที่จะรัน worker เป็นโค้ด `main` ล่าสุด มี `.env.local` และ `bin\yt-dlp.exe` (ตัวถอดคลิปหา yt-dlp ที่ `<โฟลเดอร์ปัจจุบัน>\bin`)
2. Node ≥ 22 → `node -v`
3. Codex CLI ≥ 0.153 (รุ่นเก่ากว่านี้ใช้ `gpt-6-astra` ไม่ได้ — ขึ้น "requires a newer version of Codex") → `codex --version` · อัปเกรด `npm i -g @openai/codex@latest`
4. ล็อกอิน Codex แล้ว → `codex login status` (บัญชีอื่นดูส่วน 7)
5. Edge โปรไฟล์ "Profile 1" ล็อกอินเฟซบุ๊กเป็นเพจ **"เล่าเรื่อง ดารา"** (เจ้าของ#9 · ใช้อ่านอย่างเดียว ห้ามโพสต์/ไลก์/แชท) — ถ้าเอเจนต์เห็นบัญชีอื่นจะหยุดใช้เบราว์เซอร์แล้วติดธง `BROWSER_WRONG_ACCOUNT`
6. ใส่ค่าฝั่ง worker ใน `.env.local`: `RESEARCH_AGENT_SECRET` · `RESEARCH_AGENT_API_BASE` · `CODEX_ACCOUNT` (และตัวอื่นในส่วน 3 ถ้าไม่ใช้ค่าเริ่มต้น)

**ทดสอบแล้วค่อยรันยาว:**

1. เปิด `<API_BASE>/api/research/status` ในเบราว์เซอร์ → ต้องได้ JSON สถานะ (route นี้ไม่ต้องใช้คีย์และไม่คืนค่าลับ) 🔗
2. เช็คค่าตั้ง `node scripts/research-agent-worker.mjs --check` 🔗 (ไม่แสดงความลับ · ต้องเห็น "เบราว์เซอร์: เปิด" · บัญชี/โควตา · "ธงหยุด: ไม่มี") → รันหน้าต่างเดียวก่อน: `node scripts/research-agent-worker.mjs` 🔗 (หยุดด้วย Ctrl+C) → ส่งข่าวทดสอบ 1 ข่าวใน Discord → ภายในไม่กี่นาทีต้องมีการ์ด "🧾 บัตรข้อเท็จจริง" หัว "🧪 ทดลอง" ใต้ข้อความ
3. รันแบบล้มแล้วลุกเอง: `scripts\research-agent-worker-forever.cmd` 🔗
4. ตั้งเปิดอัตโนมัติ (ส่วน 6 ชั้น 1)
5. วันรุ่งขึ้นดูผล: `node scripts/research-agent-report.mjs --days 1` (ส่วน 10)

## 5. ลำดับเปิดใช้บน production

| ขั้น | ทำอะไร | ตรวจว่าผ่าน |
|---|---|---|
| 0 | รวมโค้ด + deploy โดย**ยังไม่ตั้ง env ใหม่** | ข่าวออกปกติเหมือนเดิม (สวิตช์ปิด = ทุกไบต์เดิม) |
| 1 | สร้าง secret · ใส่ฝั่ง worker (ส่วน 3) | — |
| 2 | Vercel → Settings → Environment Variables (Production): `RESEARCH_AGENT=1` · `RESEARCH_AGENT_MODE=shadow` · `RESEARCH_AGENT_SECRET=<ค่าเดียวกับ worker>` (shadow ไม่ต้องตั้ง `WAIT_MS`) → **Redeploy** (env ใหม่มีผลเฉพาะ deployment ใหม่) | `/api/research/status` ตอบ |
| 3 | Railway: `RESEARCH_AGENT=1` (+ `RESEARCH_AGENT_OWNER_DISCORD_ID` ถ้าจะให้ mention คนอื่นที่ไม่ใช่เจ้าของเซิร์ฟเวอร์) · เช็คว่า `API_KEY` = `DISCORD_API_SECRET` ของ Vercel · **ไม่ตั้ง `RESEARCH_AGENT_SECRET`** → restart service | บอทออนไลน์ · log ไม่มีคำเตือนเรื่อง secret |
| 4 | เปิด worker (ส่วน 4) + autostart (ส่วน 6) | status = online / มี heartbeat 🔗 |
| 5 | ส่งข่าวจริง 1 ข่าว (ใส่ลิงก์ต้นทางถ้ามี) | ข่าวออกเหมือนเดิม + การ์ด 🧪 ใต้ข้อความ |
| 6 | shadow 3–5 วัน (เจ้าของ#23) → ดูรายงาน → เจ้าของตัดสินใจขยับ assist | ส่วน 10 |

## 6. แผนสำรอง 3 ชั้น (เจ้าของ#19)

### ชั้น 1 — เปิดเองอัตโนมัติบนเครื่องเจ้าของ: `scripts/research-agent-autostart.cmd`

ตัวเฝ้า (guard) ที่รันซ้ำได้ไม่จำกัด:

- มีไฟล์ธงหยุด `logs\research-agent\research-agent.stop` → ไม่ทำอะไร (ตั้งใจหยุดไว้) — ไฟล์เดียวกับที่ `node scripts\research-agent-worker.mjs --stop` วางและ `--resume` ลบ และที่ forever.cmd รอ 🔗
- มีโปรเซส `node.exe`/`cmd.exe` ที่ command line มีคำว่า `research-agent-worker` อยู่แล้ว → ไม่ทำอะไร (ไม่เปิดตัวที่สอง)
- นอกนั้น → เปิด `scripts\research-agent-worker-forever.cmd` แบบซ่อนหน้าต่าง + จดหนึ่งบรรทัดใน `logs\research-agent-autostart.log` (โฟลเดอร์ `logs\` ไม่เข้า git)
- ไม่อ่าน/ไม่พิมพ์คีย์ใดๆ · ไม่มี path ฝังตายตัว (หารากโปรเจกต์จากตำแหน่งไฟล์เอง ใช้กับชื่อโฟลเดอร์ภาษาไทยได้) · ตัวไฟล์เป็น ASCII ล้วน
- ใส่ `%SystemRoot%\System32` ไว้หน้า PATH ก่อนเปิด forever: ถ้าเรียก guard จาก Git Bash (PATH แบบ MSYS) คำสั่ง `timeout` ใน forever.cmd จะเป็นของ GNU ที่ออกทันที → วนเปิด worker รัวๆ (รอบแก้ r2 เจอ ~200 รอบใน 30 วิ ก่อนใส่บรรทัดนี้) · Task Scheduler ใช้ PATH ปกติของเครื่อง (`timeout` = `C:\Windows\system32\timeout.exe`) ไม่โดนอยู่แล้ว
- ทดสอบซ้ำ 1 ต.ค. 69 (รอบแก้ r2) ในโฟลเดอร์จำลองนอก repo ที่ชื่อมีภาษาไทย ด้วย `research-agent-worker-forever.cmd` + `research-agent-worker.mjs` ตัวจริงของเลน A (ไม่มี `.env.local` = worker ออก exit 3 ไม่ยิงเน็ต · รอบพัก/ปลุกใช้ `.env.local` ปลอมชี้ `http://127.0.0.1:9`): ธงจาก `--stop` → ไม่เปิด · ธงตำแหน่งเก่าที่รากโปรเจกต์ → ไม่มีผลแล้ว (เปิดตามปกติ) · รันซ้ำ → "already running" · `--stop` ระหว่างรัน → worker ออกใน ~15 วิ (บรรทัด `worker หยุด: stopped`) forever รอ guard ไม่เปิดซ้ำ · `--resume` → worker กลับมาใน ~20 วิ · คำสั่งหยุดทันที → ปิดทั้งคู่ แล้ว guard เปิดใหม่ได้ · ไม่มี forever → exit 1 + log · เรียกด้วย path เต็มจาก PowerShell (PATH จริงของเครื่อง) ได้ · **ยังไม่ได้ลง Task Scheduler บนเครื่องจริง**

**ลง Task Scheduler (เจ้าของทำครั้งเดียว ใน PowerShell ที่รากโปรเจกต์):**

```powershell
$guard = (Resolve-Path .\scripts\research-agent-autostart.cmd).Path
schtasks /Create /TN ViralFlow-ResearchAgent /SC MINUTE /MO 5 /TR $guard /F
```

(path ของโฟลเดอร์โปรเจกต์ต้องไม่มีช่องว่าง — โฟลเดอร์ปัจจุบันไม่มี · ถ้าย้ายไปโฟลเดอร์ที่มีช่องว่างให้ลงงานผ่าน Task Scheduler หน้าจอปกติหรือ `Register-ScheduledTask` แทน)

| อยากทำ | คำสั่ง |
|---|---|
| ดูสถานะงานใน Task Scheduler | `schtasks /Query /TN ViralFlow-ResearchAgent` |
| ปิดตัวเฝ้าชั่วคราว (worker ที่รันอยู่ยังรันต่อ — จะพัก worker ใช้ `--stop` ในตารางถัดไป) | `schtasks /Change /TN ViralFlow-ResearchAgent /DISABLE` (เปิดคืน `/ENABLE`) |
| ถอนทิ้ง (worker ที่รันอยู่ยังรันต่อ) | `schtasks /Delete /TN ViralFlow-ResearchAgent /F` |
| ดูว่า guard เปิด worker เมื่อไร | `Get-Content .\logs\research-agent-autostart.log -Tail 20` |

ข้อควรรู้: งานแบบนี้รันเฉพาะตอนผู้ใช้ล็อกอินอยู่ (เหมือน `ViralFlow-EnsureServices` ของเครื่องทีม) · ถ้าเครื่องรีบูตแล้วล็อกอิน worker จะขึ้นภายใน 5 นาที · ทุก 5 นาทีอาจเห็นหน้าต่างดำกะพริบสั้นๆ (ถ้ารำคาญ ลองตั้ง action เป็น `conhost.exe --headless "<path ของ guard>"` — วิธีนี้ยังไม่ได้ทดสอบบนเครื่องนี้) · ทางเลือกง่ายกว่าแต่หย่อนกว่า: วางทางลัดของ guard ใน `shell:startup` (เปิดตอนล็อกอินอย่างเดียว · worker ล้มเอง forever.cmd ยังเปิดให้ใหม่ แต่ถ้าโปรเซส forever ถูกปิดทีหลังจะไม่ฟื้นจนล็อกอินครั้งหน้า)

**พัก / ปลุก / หยุด / รีสตาร์ต worker** 🔗 — guard เปิด worker แบบซ่อนหน้าต่าง **ไม่มีหน้าต่างให้ปิด** · ใช้คำสั่งเหล่านี้ใน PowerShell ที่รากโปรเจกต์ (worker · forever.cmd · guard ใช้ไฟล์ธงหยุดตัวเดียวกัน `logs\research-agent\research-agent.stop`):

| อยากทำ | คำสั่ง | ผล |
|---|---|---|
| พัก worker | `node scripts\research-agent-worker.mjs --stop` | วางไฟล์ธง → worker ทำงานที่ค้างให้จบแล้วออก (ไม่มีงานค้าง = ไม่ถึง 2 นาที) · forever.cmd รอ · guard ไม่เปิดใหม่ · ธงอยู่ข้ามรีบูต จึงไม่ต้อง `/DISABLE` งานใน Task Scheduler |
| ให้กลับมารับงาน | `node scripts\research-agent-worker.mjs --resume` | ลบไฟล์ธง → forever.cmd ที่รออยู่เปิด worker ภายใน ~30 วิ · ถ้า forever ไม่ได้รันอยู่ guard (ที่ลงใน Task Scheduler) เปิดให้ภายใน 5 นาที หรือรัน `scripts\research-agent-autostart.cmd` เองทันที |
| ดู log / ดูว่าหยุดแล้วหรือยัง | `Get-Content .\logs\research-agent\worker.log -Tail 20` | หยุดแล้วจะมีบรรทัด `worker หยุด: stopped` |
| เช็คค่าตั้ง (ไม่แสดงความลับ) | `node scripts\research-agent-worker.mjs --check` | เครื่องมือ · เบราว์เซอร์เปิด/ปิด · บัญชี + โควตา · ธงหยุดมี/ไม่มี |
| รีสตาร์ต (ให้อ่าน `.env.local` ใหม่) | `--stop` → รอ log ขึ้น `worker หยุด: stopped` → `--resume` | worker ตัวใหม่อ่าน `.env.local` ตอนเริ่ม · อย่า `--resume` ก่อน worker หยุดจริง ไม่งั้นตัวเดิมรันต่อด้วยค่าเก่า |
| หยุดทันที (ไม่รองานค้าง) | คำสั่งปิดโปรเซสด้านล่าง | ปิดทั้ง forever.cmd (`cmd.exe`) และ worker (`node.exe`) · งานที่ค้างไม่ได้ส่งผล (ข่าวเดินต่อตามปกติ — fail-open) · ไม่มีธง = guard (ที่ลงใน Task Scheduler) เปิดกลับภายใน 5 นาที → อยากให้หยุดค้าง ให้ `--stop` ก่อนแล้วค่อยปิด |

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe'" | Where-Object { $_.CommandLine -like '*research-agent-worker*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

### ชั้น 2 — worker ตัวที่ 2 บนเครื่องทีม

- ใช้โค้ด `main` ชุดเดียวกัน + `.env.local` ที่มี `RESEARCH_AGENT_SECRET` และ `RESEARCH_AGENT_API_BASE` ค่าเดียวกับเครื่องเจ้าของ
- ล็อกอิน Codex บนเครื่องนั้นเอง (ห้ามคัดลอก `auth.json` ข้ามเครื่อง/ข้ามช่อง — refresh token ชนกัน) และควรใช้คนละบัญชีกับเครื่องเจ้าของ ไม่งั้นกินโควตาถังเดียวกัน
- workerId ต้องต่างกัน (lease กันงานซ้ำ — สเปกข้อ 8) · ตั้งด้วย `RESEARCH_AGENT_WORKER_ID` — ไม่ตั้ง = ชื่อเครื่อง จึงต่างกันเองอยู่แล้ว (ตั้งเมื่ออยากให้ชื่ออ่านง่าย เช่น `team-pc`) 🔗
- เครื่องทีมไม่มี Edge ที่ล็อกอินเพจ → เอเจนต์ทำงานแบบไม่มีเบราว์เซอร์ได้ (ค้น/ดึงหน้าเว็บ/Apify/ถอดคลิปยังใช้ได้) · ปิดเบราว์เซอร์บนเครื่องนั้นด้วยรายชื่อเครื่องมือครบ 12 ตัว**ที่ไม่มี `browser`**: `RESEARCH_AGENT_TOOLS=serper,fetch-page,apify,web-agent,transcribe,gemini-video,youtube-meta,ocr,reverse-image,wiki,rss-news,quota` 🔗 · ถ้าจะให้มีเบราว์เซอร์ ต้องเป็นโปรไฟล์ที่ล็อกอินเพจ "เล่าเรื่อง ดารา" เท่านั้น (แล้วเติม `,browser` ท้ายรายชื่อ)
- ลง autostart แบบชั้น 1 บนเครื่องทีมด้วย · สองเครื่องเปิดพร้อมกัน = ช่วยกันรับงาน (เร็วขึ้น แต่กินโควตา 2 บัญชี) · งานพร้อมกันรวม = ผลรวม `RESEARCH_AGENT_CONCURRENCY` ของทุกเครื่อง (ค่าเริ่มต้นเครื่องละ 2 · เบราว์เซอร์ทีละงานต่อเครื่อง)

### ชั้น 3 — ไม่มี worker / โควตาหมด = ข่าวเดินต่อ

- โควตาคงเหลือ ≤ 15% → บอทเตือนเจ้าของวันละครั้งในห้องเดิม (mention `RESEARCH_AGENT_OWNER_DISCORD_ID` · ไม่ตั้ง = เจ้าของเซิร์ฟเวอร์) → สลับบัญชีตามส่วน 7 · worker ส่งโควตามากับ heartbeat ระหว่างทำงานด้วย จึงเตือนได้ก่อนงานจบ
- โควตาคงเหลือ ≤ 5% → worker สลับไปบัญชีถัดไปใน `RESEARCH_AGENT_CODEX_ACCOUNTS` เอง · ไม่มีบัญชีเหลือ → ใช้สมองสำรอง API 🔗 (เสียเงินต่อครั้ง ดูส่วน 11) **เฉพาะเมื่อตั้ง `RESEARCH_AGENT_API_FALLBACK=1`** (ออดิต 1 ต.ค. 69 · ค่าเริ่มต้นปิด) — ไม่ตั้ง = งานนั้นล้ม + ธง `BRAIN_UNAVAILABLE` + `QUOTA_LOW` (Codex หลุดล็อกอิน = + `CODEX_AUTH`) แล้วบอท mention เจ้าของวันละครั้ง · ข่าวเดินต่อตามปกติ
- สั่งใช้สมอง API เอง: ตั้ง `RESEARCH_AGENT_BRAIN=api` ที่ worker (ต้องมี `OPENAI_API_KEY`) — **ใช้ชั่วคราวเท่านั้น** ค่าใช้จ่ายต่องานสูงกว่างบเครื่องมือมาก
- ไม่มี heartbeat เกิน 10 นาที → `/api/research/status` = `offline` → ท่อไม่รอ · บอทติดป้าย "รีเสิร์ชออฟไลน์" 🔗 → **ข่าวออกปกติ** พนักงานไม่ต้องทำอะไรเพิ่ม

## 7. บัญชี Codex: ดูโควตา · สลับ · เพิ่ม (เจ้าของ#16)

- **ดูโควตา (ฟรี ไม่กินโทเคน):** `node "$env:USERPROFILE\.claude\skills\auto-account\scripts\quota.mjs" --codex-only` — ตารางแสดง **% ที่ใช้ไป** ต่อรอบ · การ์ด/รายงาน/คำเตือนของระบบนี้ใช้ **% คงเหลือ** (= 100 − ที่ใช้ไป)
- **ช่องบัญชี:** `main` = `%USERPROFILE%\.codex` · `b`, `c`, … = `%USERPROFILE%\.codex-b`, `.codex-c`, … · เลือกด้วย `CODEX_ACCOUNT` · ลำดับสำรองด้วย `RESEARCH_AGENT_CODEX_ACCOUNTS`
- **ทางที่ง่ายที่สุด** (ตัวช่วยของเลน A 🔗):

  ```powershell
  .\scripts\research-agent-account.cmd add c   # เปิดเบราว์เซอร์ให้เจ้าของล็อกอินบัญชีใหม่เข้าช่อง c (AI ล็อกอินแทนไม่ได้)
  .\scripts\research-agent-account.cmd use c   # เขียน RESEARCH_AGENT_CODEX_ACCOUNTS ใน .env.local + แสดงตารางโควตา
  ```

- **ทางมือ (ถ้าไม่มีตัวช่วย):**

  ```powershell
  & "$env:USERPROFILE\.claude\skills\auto-account\scripts\add-codex-account.ps1" c
  ```

  แล้วแก้ `.env.local` เช่น `CODEX_ACCOUNT=c` หรือ `RESEARCH_AGENT_CODEX_ACCOUNTS=main,b,c` → รีสตาร์ต worker ตามตาราง "พัก / ปลุก / หยุด / รีสตาร์ต worker" ในส่วน 6 (`node scripts\research-agent-worker.mjs --stop` → รอ log ขึ้น `worker หยุด: stopped` → `--resume`) — worker เปิดแบบซ่อนหน้าต่าง ไม่มีหน้าต่างให้ปิด · ทางที่ง่ายที่สุดด้านบน (`use`) ก็ต้องรีสตาร์ตแบบเดียวกัน
- **ล็อกอินหลุด:** ช่อง main → `codex login` · ช่องอื่น → รัน `add-codex-account.ps1 <ตัวอักษร>` ซ้ำ (ใช้ล็อกอินใหม่ได้)
- **กับดัก:** เมลเดียวกันสองช่อง = ถังโควตาเดียวกัน ไม่ช่วย · ห้ามคัดลอกไฟล์ล็อกอินข้ามช่อง · Codex ในโหมด exec ต้องตั้ง `approvals_reviewer="auto_review"` + `approval_policy="on-request"` ไม่งั้นทุกคำสั่งถูกปัด (worker ใส่ให้ตามสเปกข้อ 4 🔗)

## 8. วิธีถอย (ทุกสวิตช์)

| อยากทำ | ทำที่ | วิธี | มีผลเมื่อ |
|---|---|---|---|
| **ปิดทั้งระบบ** (กลับเป็นแบบก่อนมีฟีเจอร์ทุกไบต์) | Vercel | ลบ `RESEARCH_AGENT` หรือตั้งค่าอื่นที่ไม่ใช่ `1` → Redeploy | deployment ใหม่ขึ้น |
| ให้ท่อเลิกรอการ์ด | Vercel | `RESEARCH_AGENT_WAIT_MS=0` หรือถอยเป็น `RESEARCH_AGENT_MODE=shadow` → Redeploy | deployment ใหม่ขึ้น |
| ให้คิวเลิกชะลอหยิบงาน (คงโหมด write) | Vercel | `RESEARCH_AGENT_HOLD_MS=0` → Redeploy (ท่อยังรอการ์ดหลังสกัดเองได้ ≤ `WAIT_MS` ตามเดิม) | deployment ใหม่ขึ้น |
| ถอยโหมดทีละขั้น | Vercel | `write` → `assist` → `shadow` → Redeploy | deployment ใหม่ขึ้น |
| กลับไปเขียนข่าวทีละงาน (เลิกท่อข่าวขนาน · W6) | Vercel | ลบ `QUEUE_NEWS_CONCURRENCY` หรือตั้ง `QUEUE_NEWS_CONCURRENCY=1` → Redeploy (ตัวหยิบงาน + self-heal กลับเป็นเดิมทุกไบต์ · ข่าวที่กำลังเขียนอยู่เขียนต่อจนจบ) | deployment ใหม่ขึ้น |
| หยุด worker ชั่วคราว | เครื่อง worker | `node scripts\research-agent-worker.mjs --stop` 🔗 (วางธง `logs\research-agent\research-agent.stop` — worker ทำงานที่ค้างให้จบแล้วออก · forever.cmd รอ · guard ไม่เปิดใหม่ · ธงอยู่ข้ามรีบูต ไม่ต้อง `/DISABLE` งานใน Task Scheduler) · กลับมารับงาน: `node scripts\research-agent-worker.mjs --resume` · ต้องหยุดทันที: ปิดโปรเซสด้วยคำสั่งในส่วน 6 (ไม่มีหน้าต่างให้ปิด) | หลังงานที่ค้างเสร็จ (ไม่มีงานค้าง = ไม่ถึง 2 นาที) |
| ถอน autostart | เครื่อง worker | `schtasks /Delete /TN ViralFlow-ResearchAgent /F` (worker ที่รันอยู่ยังรันต่อ — หยุดด้วยแถวบน) | ทันที |
| ห้ามยก medium | เครื่อง worker | `RESEARCH_AGENT_ALLOW_MEDIUM=0` → รีสตาร์ต worker 🔗 | งานถัดไป |
| สลับสมอง codex ↔ api | เครื่อง worker | `RESEARCH_AGENT_BRAIN=codex` หรือ `api` → รีสตาร์ต worker | งานถัดไป |
| ปิด/เปิดทางสำรอง OpenAI API (กันเงินรั่ว) | เครื่อง worker | ลบ `RESEARCH_AGENT_API_FALLBACK` (= ปิด · ค่าเริ่มต้น) หรือ `=1` (เปิด · เสียเงินจริง) → รีสตาร์ต worker · ตรวจด้วย `--check` บรรทัด "ทางสำรอง OpenAI API" | งานถัดไป |
| จำกัดเครื่องมือ/ลดค่าใช้จ่าย | เครื่อง worker | เช่น `RESEARCH_AGENT_TOOLS=serper,fetch-page,wiki,rss-news,youtube-meta,transcribe,browser` (ตัด web-agent/apify/gemini-video/reverse-image/ocr/quota) → รีสตาร์ต · ⚠️ **ต้องใส่ `browser` ไว้ในรายชื่อด้วยถ้ายังต้องการเบราว์เซอร์** — ตั้งตัวแปรนี้โดยไม่มี `browser` = เบราว์เซอร์ Edge ปิดเงียบๆ (เช็คด้วย `--check`) 🔗 | งานถัดไป |
| ลดงบต่องาน | เครื่อง worker | `RESEARCH_AGENT_MAX_CALLS` · `RESEARCH_AGENT_MAX_MINUTES` (ฝั่งเว็บไม่อ่านแล้ว) → รีสตาร์ต worker | งานถัดไป |
| ลดงานพร้อมกัน / ประหยัดโควตา | เครื่อง worker | `RESEARCH_AGENT_CONCURRENCY=1` → รีสตาร์ต worker | งานถัดไป |
| ให้ใบขอรอ worker นานขึ้น/สั้นลง | Vercel | `RESEARCH_AGENT_DEADLINE_MIN` (ค่าเริ่มต้น 15 · 1–120) → Redeploy | ใบขอใหม่หลัง deployment ใหม่ขึ้น |
| บอทหยุดโพสต์การ์ด | Railway / Vercel | Railway: ลบ `RESEARCH_AGENT` (หรือค่าอื่นที่ไม่ใช่ `1`) → restart · หรือปิด `RESEARCH_AGENT` บน Vercel → บอทได้ `enabled:false` แล้วเลิกถามเอง | restart / redeploy |
| ถอยโค้ดทั้งก้อน | Vercel / git | Vercel → Deployments → deployment ก่อนรวม → Instant Rollback/Promote (เร็วสุด) · หรือ `git revert` คอมมิตที่รวม (แตะไฟล์ล็อก → ต้องมีรหัส NEWS-LOCK และเจ้าของอนุมัติ) | ทันที / deploy ใหม่ |
| ล้างข้อมูล | Supabase | แถว `store_items` ที่ `store_name` เป็น `research-requests` · `research-cards` · `bot-posted` · `research-workers` · `research-editor` (row id ขึ้นต้น `rreq_` · `rcard_` · `bposted_` · `rworker_` · `redit_`) — **ไม่ต้องลบเพื่อถอย** (ตอนปิดสวิตช์ไม่มีใครอ่าน) ลบเฉพาะเมื่อเจ้าของต้องการ | — |
| เลิกใช้ฉบับเสริม (คงการ์ดให้พนักงาน) | Vercel | `RESEARCH_AGENT_MODE=assist` → Redeploy (ข่าวกลับไปเขียนจากต้นฉบับพนักงานทุกไบต์ · ระเบียน `research-editor` เดิมไม่มีใครอ่านต่อ) | deployment ใหม่ขึ้น |
| ปิดสรุปรายวัน (คงตัวเฝ้า worker + แจ้งล้มติดกัน · W7) | Railway | `RESEARCH_DIGEST=0` → restart service | restart |
| ปิดแจ้งเตือนเจ้าของทั้งหมด (W7) | Railway | ไม่มีสวิตช์แยก — ปิดสวิตช์รีเสิร์ชของบอท (บัตรข้อเท็จจริงหยุดด้วย) หรือถอยโค้ด · อยากเงียบชั่วคราวแต่คงบัตร = ลบ `RESEARCH_AGENT_OWNER_DISCORD_ID` + `ADMIN_LOG_CHANNEL_ID` (แจ้งลง log บอทอย่างเดียว) → restart | restart |

env บน Vercel มีผลกับ deployment ใหม่เท่านั้น (ต้อง Redeploy) · env ฝั่ง worker มีผลเมื่อรีสตาร์ต worker

## 9. อ่านการ์ดและให้คะแนน (เจ้าของ#12–15 · #21 · #23)

**หน้าตาการ์ด** (reply ใต้ข้อความพนักงาน · โหมด shadow มีหัว "🧪 ทดลอง") 🔗:

- **แผนของเอเจนต์** 1 บรรทัดต่อข้อ: คำถามที่คิดจะค้น · ค้น/ไม่ค้น · เหตุผล (เห็นว่าเอเจนต์ตัดสินใจอะไรและทำไม)
- **การ์ดแต่ละใบ:** ข้อความข้อเท็จจริง (claim) · แหล่ง (ลิงก์) + วันที่ของแหล่ง · ความมั่นใจ
- **ธง:**
  - ⚠️ **ข่าวเก่า** (`STALE_NEWS`) — ติดธงอย่างเดียวทุกอายุ ไม่หยุดข่าว (เจ้าของ#14) · เกณฑ์ = เรื่องเก่ากว่าวันส่งเกิน `RESEARCH_AGENT_STALE_DAYS` วัน (ค่าเริ่มต้น 7 · ตั้งที่เครื่อง worker)
  - ❗ **ขัดต้นฉบับ:** ค่าในข้อความพนักงาน → ค่าตามต้นทาง (`RAW_CONTRADICTION` + `raw_corrections`) — ต้นทางที่ยืนยันได้ชนะ ให้แก้ตามต้นทาง (เจ้าของ#13)
  - 🔍 **ยืนยันต้นทางไม่ได้** (`ORIGIN_NOT_FOUND`) — ทำข่าวตามปกติได้ (เจ้าของ#15)
  - 🧭 **ต้นทาง:** ลิงก์โพสต์/ข่าวต้นทางที่เอเจนต์เชื่อว่าเป็นที่มา (เพจเราเอง IG.dara ไม่นับเป็นต้นทาง)
- **ระดับการ์ดจากด่านเชิงกล (สเปกข้อ 6):** `pass` = หลักฐานครบ (เฟส write จะส่งเข้านักเขียน) · `staff_only` = หลักฐานอ่อน/ความมั่นใจ < 0.6 ให้คนดูอย่างเดียว · `dropped` = โดนคำต้องห้าม
- แหล่งข่าว**ไม่เอ่ยในเนื้อข่าว** (เหมือนเดิม) แต่โชว์ให้พนักงานในการ์ด (เจ้าของ#12)

**ให้คะแนน:** กด 👍 หรือ 👎 ที่ข้อความการ์ด 🔗 · นับคนละเสียงต่อการ์ด เปลี่ยนใจได้ (รายงานนับเสียงล่าสุดของแต่ละคน) · ช่วง shadow 3–5 วัน **เจ้าของให้คะแนน 15 ใบแรก ที่เหลือพนักงาน** (เจ้าของ#23)

แนวให้คะแนน (ข้อเสนอ — เจ้าของปรับได้):

- 👍 เมื่อ: ชี้ต้นทางถูก **หรือ** มีอย่างน้อย 1 ใบที่เพิ่มข้อเท็จจริงมีค่าและตรวจได้จริง (เช่น บทบาท/อาชีพที่ทำให้เรื่องมีน้ำหนัก เจ้าของ#7 · ตัวเลข · ลำดับเหตุการณ์) พร้อมลิงก์ + วันที่ที่เปิดดูแล้วตรง · ใช้ตัวอย่างรสนิยมเพจจากคลังข่าวไวรัล 202 ใบเป็นเกณฑ์ "มีค่า" (เจ้าของ#11)
- 👎 เมื่อ: claim ไม่มีในหน้าแหล่งจริง · วันที่/ต้นทางผิด · เอาเพจเราเองเป็นต้นทาง · ขุดข้อมูลส่วนตัวเกินขอบเขต (ที่อยู่/สุขภาพ/ครอบครัวลึก — เจ้าของ#7) · แตะหัวข้อที่ให้เลี่ยงแบบไม่จำเป็น (เจ้าของ#6) · ไม่เกี่ยวกับข่าว

**สำหรับพนักงาน:** ไม่ต้องตอบโต้บอท (เจ้าของ#2) · โหมด shadow การ์ดเป็นข้อมูลประกอบ ไม่แก้ข่าวที่ระบบเขียนให้ · **มีลิงก์ต้นทางให้วางในข้อความเดียวกับเนื้อข่าว** — ผลทดลองจริงทั้ง 2 รอบในแล็บขอสิ่งนี้มากที่สุด

## 10. รายงานผล: `scripts/research-agent-report.mjs`

อ่านอย่างเดียวจาก Supabase REST (GET เท่านั้น) — `store_items` ที่ `store_name='research-cards'` + `pipeline_logs` ที่ `step='research-agent'` · ไม่พิมพ์ค่า URL/คีย์ใดๆ แม้ตอน error

```powershell
node scripts/research-agent-report.mjs                 # 7 วันปฏิทินเวลาไทยล่าสุด (รวมวันนี้)
node scripts/research-agent-report.mjs --days 3        # 1–90 วัน
node scripts/research-agent-report.mjs --json          # JSON ทั้งก้อน (ต่อแดชบอร์ด/สคริปต์อื่น)
node scripts/research-agent-report.mjs --env D:\อื่น\.env.local   # ใช้ไฟล์ env อื่น (ค่าเริ่มต้น <ราก repo>\.env.local)
```

- ใช้ env: `NEXT_PUBLIC_SUPABASE_URL`|`SUPABASE_URL` + `SUPABASE_SERVICE_KEY`|`SUPABASE_SERVICE_ROLE_KEY`|`NEXT_PUBLIC_SUPABASE_ANON_KEY` (คีย์ anon อาจโดน RLS กั้นจนผลว่าง — รายงานจะบอก) · `RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH` · `RESEARCH_AGENT_QUOTA_ALERT_PCT`
- exit: `0` สำเร็จ (ไม่มีข้อมูลก็ 0) · `1` อ่านฐานข้อมูลไม่สำเร็จ (ยังพิมพ์ส่วนที่อ่านได้ + ⚠️) · `2` อาร์กิวเมนต์/env ไม่ครบ
- ⚠️ ธงชื่อ `--env` ไม่ใช่ `--env-file`: Node 24 สแกน `--env-file` แม้อยู่หลังชื่อสคริปต์ — ไฟล์ไม่มีจริง node จะตาย exit 9 ก่อนสคริปต์ได้รัน (ทดสอบจริง 1 ต.ค. 69)
- ทดสอบอ่านฐานจริงแล้ว 1 ต.ค. 69 (ยังไม่มีข้อมูล = ตัวเลขว่าง exit 0) · เทส `tests/research-agent-report.test.mjs` ใช้ fetch ปลอมทั้งหมด

**นิยามตัวเลข:**

| ตัวเลข | นิยาม |
|---|---|
| วัน | ปฏิทิน Asia/Bangkok (UTC+7) จาก `createdAt` ของการ์ด / `created_at` ของ log |
| งาน/วัน | แถว `research-cards` (id = jobId) แยก done / failed / skipped |
| พบต้นทาง % | `origin_post.url` เป็น http(s) · ไม่ใช่เพจเราเอง (facebook.com/IG.dara) · ไม่มีธง `ORIGIN_NOT_FOUND` — คิดจากงาน done |
| การ์ด/งาน | จำนวน `cards[]` เฉลี่ยต่องาน done แยก pass / staff_only / dropped |
| 👍/👎 | `feedback[]` หลังตัดซ้ำ (คนเดิม + การ์ดเดิม เอาโหวตล่าสุด) · ยังไม่แยกคะแนนของเจ้าของ |
| เวลาเอเจนต์ p50/p90 | `usage.minutes` (nearest-rank) |
| ท่อข่าว | แถว `pipeline_logs` ขั้น research-agent: "การ์ดพร้อมตอน PRE-GENERATE" = สถานะ `done` · "มีการ์ดในฐาน" = jobId (จาก `unify_<jobId>`) มีแถวการ์ด |
| เวลาท่อรอ | **เวลาที่ท่อข่าวรอเพิ่มจริง** ที่ PRE-GENERATE หลัง Blueprint จบ = `metadata.waitedMs` (shadow ปกติ 0 · `0` คือ "ไม่ได้รอ" ไม่ใช่ค่าหาย) · แถวที่ไม่มี `waitedMs` ใช้ `metadata.ms` · ไม่มี metadata ใช้คอลัมน์ `duration_ms` — ⚠️ `metadata.ms` = เวลาตั้งแต่เริ่ม poll ซึ่งวิ่ง**ขนาน**กับ Blueprint จึงสูงกว่าเวลาที่ท่อรอจริง (แก้ตาม contract-check #5 · 1 ต.ค. 69) |
| โควตาใช้/วัน | ผลรวมส่วนที่ลดลงของ `brain.quotaPctAfter` (**% คงเหลือหลังงาน**) ระหว่างงานติดกันของบัญชีเดียวกัน · ค่าที่เพิ่มขึ้น = รอบโควตารีเซ็ต ไม่นับ (ค่าประมาณ) |
| ค่าเครื่องมือ | ผลรวม `usage.costUsd` ช่วงนี้ + เดือนนี้ (ตั้งแต่วันที่ 1 เวลาไทย) เทียบเพดาน → ⚠️ เมื่อถึง |

**คำถามที่รายงานช่วยตอบตอนตัดสินใจขยับ shadow → assist** (เกณฑ์เป็นของเจ้าของ ยังไม่ได้ตั้ง): พบต้นทางกี่ % · 👍 กี่ % ของ 15 ใบแรก · การ์ดพร้อมทันท่อกี่ % ที่ WAIT_MS ต่างๆ (ดู p90 เวลาเอเจนต์) · ค่าเครื่องมือต่อเดือนอยู่ในเพดานไหม · ธงขัดต้นฉบับ/ข่าวเก่าโผล่บ่อยแค่ไหน

## 11. ตารางราคาเครื่องมือ

ราคาอ้างอิงตรวจจากหน้าราคาทางการวันที่ **1 ต.ค. 69** (OpenAI · Google Gemini · SerpApi · Firecrawl · Supadata · Apify · Jina · YouTube) ยกเว้นราคาแพ็กของ Serper/Jina ที่หน้าเว็บสาธารณะไม่แสดง · คอลัมน์ "ประมาณต่อครั้ง" เป็น**การประเมิน**จากราคานั้น ไม่ใช่บิลจริง · ตัวเลขที่ worker ใช้คิด `usage.costUsd` อยู่ที่ `scripts/research-agent/pricing.mjs` 🔗 — ราคาเปลี่ยนให้แก้ที่นั่นแล้วอัปเดตตารางนี้

| เครื่องมือ | บริการ / หน่วยคิดเงิน | ราคาอ้างอิง | ประมาณต่อครั้ง |
|---|---|---|---|
| สมองหลัก Codex CLI `gpt-6-astra` low | subscription ChatGPT/Codex | ไม่คิดเงินต่อครั้ง — กิน % โควตา | $0 (ดู % โควตา) |
| เบราว์เซอร์ Edge (ผ่าน Codex) | โควตา Codex | — | $0 |
| `serper` | Serper.dev ต่อคำค้น | 2,500 ครั้งแรกฟรี · ที่เหลือเติมแพ็กเครดิต (ราคาแพ็กดูในแดชบอร์ด serper.dev) | 1 เครดิต/คำค้น |
| `fetch-page` | Jina Reader → Firecrawl → ดึงตรง | Jina: คีย์ใหม่ได้ 10M โทเคนฟรี (คิดตามโทเคน) · Firecrawl: 1 เครดิต/หน้า · ฟรี 1,000/เดือน · Hobby $16 = 5,000 · Standard $83 = 100,000 (ราคาจ่ายรายปี) · ดึงตรงฟรี | ส่วนใหญ่ $0 · Firecrawl ≈ $0.001–0.003/หน้า |
| `apify` | Apify ต่อผลลัพธ์/อีเวนต์ | facebook-posts-scraper "from $2.00 / 1,000 posts" · actor อื่นราคาต่างกัน (ดูหน้า actor) · แพลนบัญชีเรา STARTER $29/เดือน (บันทึก ก.ค. 69) | ≈ $0.01–0.05/ครั้ง |
| `web-agent` | OpenAI Responses API `gpt-6-astra` + web_search | astra: $10 input · $1 cached · $50 output ต่อ 1M โทเคน (context สั้น) · web search $10/1,000 ครั้ง + โทเคนเนื้อหาค้นคิดราคาโมเดล | ≈ $0.05–0.30/ครั้ง — แพงสุดในเข็มขัด (README จำกัด ≤2 ครั้ง/งาน) |
| `transcribe` | youtube-transcript (ฟรี) → Supadata → yt-dlp + Whisper | Whisper $0.006/นาที · Supadata ฟรี 100 เครดิต/เดือน · Basic $5 = 300 · Pro $17 = 3,000 (ซับมีอยู่ 1 เครดิต/คลิป · ถอดด้วย AI 2 เครดิต/นาที) | คลิป 5 นาทีผ่าน Whisper ≈ $0.03 |
| `gemini-video` | Gemini Flash (ค่าเริ่มต้นของตัวเรียกวิดีโอในท่อคลิป = `gemini-3.7-flash`) | $0.75 input / $3.75 output ต่อ 1M โทเคน ถึง 31 ธ.ค. 69 → **ตั้งแต่ 1 ม.ค. 70 เป็น $1.50 / $7.50** · วิดีโอ ≈100 โทเคน/วินาที (ความละเอียดต่ำ) ≈300 (สูง) | คลิป 5 นาที ≈ $0.02–0.07 + ค่าคำตอบ |
| `youtube-meta` | YouTube Data API | ฟรีตามโควตา 10,000 หน่วย/วัน (อ่านรายการ ≈1 หน่วย) | $0 |
| `ocr` | vision ของ `MODEL_VISION` (gpt-5.6-sol) | ตามโทเคนภาพ × ราคาใน `MODEL_COSTS` (`src/lib/ai/modelConfig.js`) | ต่อภาพ ตามขนาดภาพ |
| `reverse-image` | SerpApi ต่อการค้น | ฟรี 250 ครั้ง/เดือน · Starter $25 = 1,000 · Developer $75 = 5,000 | $0 ในโควตาฟรี · เกินแล้ว ≈ $0.015–0.025 |
| `wiki` · `rss-news` · `quota` | Wikipedia REST · RSS ไทย + GDELT · endpoint โควตาของ Codex | ฟรี | $0 |
| สมองสำรอง API (`RESEARCH_AGENT_BRAIN=api` · หรือทางสำรองเมื่อตั้ง `RESEARCH_AGENT_API_FALLBACK=1`) | `gpt-6-astra` + web_search ทั้งงาน | ราคาเดียวกับ web-agent | ≈ $0.5–1.5/งาน — **ใช้ชั่วคราวเท่านั้น** · ทางสำรองปิดเป็นค่าเริ่มต้น · งบเดือนถึงเพดาน = หยุดเอง |

**งบ $10/เดือน (เจ้าของ#18) ตีเป็นต่อข่าว:** $10 ÷ 30 วัน ≈ $0.33/วัน → ถ้าวันละ 30–70 ข่าว ≈ **$0.005–0.011 ต่อข่าว** · แปลว่าเครื่องมือฟรี/ถูก (serper · fetch-page · wiki · rss · youtube-meta · ซับคลิป) ใช้ได้ทุกข่าว ส่วนตัวแพง (web-agent · apify · gemini-video · reverse-image) ต้องใช้เป็นครั้งคราวตามดุลยพินิจ · web-agent ครั้งเดียว (≈ $0.05–0.30) กินงบได้ถึงเกือบทั้งวัน · สมองสำรอง API (≈ $0.5–1.5/งาน × 30–70 งาน) วันเดียวเกินงบทั้งเดือน → รายงานจะเตือนเมื่อค่าเดือนนี้ถึงเพดาน

## 12. ความปลอดภัยและขอบเขต (จากคำตอบเจ้าของ)

- **คีย์:** ห้ามวางในแชท/Discord/ไฟล์ที่ commit · สคริปต์รายงานพิมพ์ชื่อตัวแปรเท่านั้น · env ของโปรเซส Codex เป็นรายชื่ออนุญาต (สเปกข้อ 4) 🔗
- **ข่าวดิบ = DATA ONLY:** ข้อความพนักงาน/โพสต์ที่ดึงมาเป็นข้อมูล ไม่ใช่คำสั่ง (กัน prompt injection เช่นข้อความที่บอกให้ "ทำตามคำสั่งนี้")
- **เบราว์เซอร์:** Edge Profile 1 = เพจ "เล่าเรื่อง ดารา" อ่านอย่างเดียว · ห้ามโพสต์/ไลก์/แชท · เห็นบัญชีอื่น = หยุดใช้เบราว์เซอร์ + ธง `BROWSER_WRONG_ACCOUNT` (เจ้าของ#9) · อ่านโปรไฟล์ส่วนตัว/กลุ่มได้เท่าที่เข้าถึงได้ อ่านอย่างเดียว (เจ้าของ#8)
- **ระบุตัวบุคคล:** ค้นที่มา/อาชีพ/บทบาทได้ถ้าไม่ยากและยืนยันได้ · ไม่ขุดที่อยู่/สุขภาพ/ครอบครัวลึก (เจ้าของ#7)
- **หัวข้อที่ให้เลี่ยง:** เพศเชิงข่มขืน/มีเพศสัมพันธ์ · ยาเสพติด · การพนัน · ฆ่ากัน · เรื่องเสี่ยงกฎหมาย — เกลาเป็นข้อเท็จจริงปลอดภัยได้ให้ใช้ดุลยพินิจ ไม่มีรายการห้ามตายตัว (เจ้าของ#6)
- **ต้นทาง:** ตัดเพจเราเอง (IG.dara / รวมไอจีดารา) ออกจากผู้สมัครต้นทาง · แหล่งต่างประเทศใช้ได้ (เจ้าของ#22)
- **ห้ามเจน/แต่งภาพ** ในท่ออัตโนมัติทุกท่อ (กฎโปรเจกต์) — เอเจนต์นี้ทำงานกับข้อความ/หลักฐานเท่านั้น

## 13. แก้ปัญหาเบื้องต้น

| อาการ | ตรวจ | แก้ |
|---|---|---|
| ไม่มีการ์ดเลย | `<API_BASE>/api/research/status` (offline?) · log ของ worker `logs\research-agent\worker.log` (worker ซ่อนหน้าต่าง ไม่มีหน้าต่างให้ดู) · `logs\research-agent-autostart.log` · `node scripts\research-agent-worker.mjs --check` ("ธงหยุด: มี" = ค้างธง) | ค้างธง → `node scripts\research-agent-worker.mjs --resume` · ไม่มีโปรเซส worker → รัน `scripts\research-agent-autostart.cmd` · `codex login status` · ดูโควตา (ส่วน 7) |
| การ์ดมาช้ากว่าข่าว | ปกติของ shadow (ท่อไม่รอ) · บอทตามโพสต์การ์ดต่ออีกสูงสุด 15 นาทีหลังโพสต์ผล · p90 เวลาเอเจนต์ในรายงาน | ลด `RESEARCH_AGENT_MAX_MINUTES` / `MAX_CALLS` ถ้าช้าเกิน |
| ใบขอ `expired` บ่อย (ข่าวกระจุก worker หยิบไม่ทัน) | `<API_BASE>/api/research/status` ช่อง `queue.queued` ค้างสูง · รายงานส่วน "งาน" น้อยกว่าข่าวจริง | เพิ่ม `RESEARCH_AGENT_CONCURRENCY` (≤4 · กินโควตาเร็วขึ้น) · เปิด worker ตัวที่ 2 (ส่วน 6 ชั้น 2) · หรือขยาย `RESEARCH_AGENT_DEADLINE_MIN` บน Vercel |
| โหมด write: บอทขึ้น "⏳ กำลังค้นคว้าก่อนเขียน" นานจนครบ 6 นาทีทุกข่าว | `/api/research/status` (worker หยิบงานไหม · ช่อง `queue.queued`) · log Vercel บรรทัด `[QueueService] ⏳ hold …` | worker ช้า/ค้าง → ดูแถว "ไม่มีการ์ดเลย" · ชั่วคราว: `RESEARCH_AGENT_HOLD_MS` ต่ำลง หรือ `0` = ปิดการชะลอ (ส่วน 8) |
| บอทเตือนใน log ว่าตั้ง `RESEARCH_AGENT_SECRET` บน Railway | Railway → Variables | ลบ `RESEARCH_AGENT_SECRET` ออกจาก Railway (บอทไม่ใช้ · ส่วน 3) → restart |
| ธง `BROWSER_WRONG_ACCOUNT` | Edge โปรไฟล์ไหนเปิดอยู่ · ล็อกอินเฟซบุ๊กเป็นใคร | สลับกลับ Profile 1 = เพจ "เล่าเรื่อง ดารา" |
| บัตรขึ้น "⚠️ ไฟล์ผลเอเจนต์เข้ารหัสผิด — รีเสิร์ชรอบนี้ใช้ไม่ได้" (ธง `ENCODING_BROKEN` · ระเบียน `failed`) | `logs\research-agent\worker.log` บรรทัด `ไฟล์ผลเข้ารหัสผิด (ไทย 0 ตัว · อักษรเสีย …)` · โฟลเดอร์งาน `out\round-encoding-result.json` / `out\result.json` · `node tools\check-result.mjs out\result.json` ในโฟลเดอร์งาน | ข่าวเดินต่อจากต้นฉบับเอง (ไม่ต้องทำอะไรกับข่าวนั้น) · เกิดซ้ำบ่อย → ดูหัวข้อย่อยด้านล่าง |
| ธง `QUOTA_LOW` / บอทเตือนโควตา | `quota.mjs --codex-only` | สลับ/เพิ่มบัญชี (ส่วน 7) |
| ⚠️ ค่าเครื่องมือถึงเพดาน / ธง `TOOL_BUDGET_MONTH` | รายงานส่วน "ค่าเครื่องมือ" · `--check` บรรทัด "งบเดือนนี้" | จำกัด `RESEARCH_AGENT_TOOLS` (ส่วน 8) หรือเจ้าของขยับเพดาน `RESEARCH_AGENT_TOOL_BUDGET_USD_MONTH` · ถึงเพดานแล้ว ทาง OpenAI API หยุดเอง (งานที่ต้องใช้ API = ล้ม) · Codex ทำต่อ |
| ธง `BRAIN_UNAVAILABLE` (+ `CODEX_AUTH` / `QUOTA_LOW`) / บอท mention "🧠 ใช้สมอง Codex ไม่ได้" | `node scripts\research-agent-worker.mjs --check` · `codex login status` · log worker บรรทัด `ส่งผลงาน … ธง …` · `tool_log` รายการ `api-path` ในระเบียนการ์ด (เหตุผล) | `CODEX_AUTH` → ล็อกอินใหม่ (ส่วน 7) · `QUOTA_LOW` → สลับ/เพิ่มบัญชี · ยอมจ่ายเงินแทน → `RESEARCH_AGENT_API_FALLBACK=1` (ส่วน 3) |
| ธง `API_FALLBACK` / บอท mention "💸 ใช้ทางสำรอง OpenAI API" | ใบแจ้งค่าใช้จ่าย OpenAI · รายงานส่วน "ค่าเครื่องมือ" | ตั้งใจเปิดไว้ = ปกติ · ไม่ตั้งใจ → ลบ `RESEARCH_AGENT_API_FALLBACK` แล้วรีสตาร์ต worker |
| Codex "requires a newer version" | `codex --version` | `npm i -g @openai/codex@latest` (≥ 0.153) |
| Codex บอก "execution policy blocked" | worker ส่ง `approvals_reviewer="auto_review"` ไหม 🔗 | ดูส่วน 7 กับดัก |
| รายงาน HTTP 401/403 | ใช้คีย์ตัวไหน (รายงานบอกชื่อ) | ใช้ `SUPABASE_SERVICE_KEY` |
| `node … --env-file x` ตาย exit 9 | — | ใช้ `--env` (ส่วน 10) |

### 13.1 ไฟล์ผลเอเจนต์เข้ารหัสผิด — ภาษาไทยกลายเป็น `?` (W4 · SPEC-v3 ส่วน 10 · 1 ต.ค. 69)

- **อาการที่เจอจริง:** batch 8 ข่าว 1 ต.ค. 69 20:30 — 2/8 งาน (`q_d764ba79bf9f9c4e` · `q_6c9c302018601b41`) `out/result.json` ที่ Codex เขียนเองบน Windows เป็นไฟล์ CRLF ไม่มี BOM ที่ไทยทุกตัวเป็น `?` (ตัวเลข/URL/อังกฤษครบ) · ไฟล์ input ในงานเดียวกันที่เขียนด้วย `-Encoding UTF8` ยังไทยครบ → ต้นเหตุน่าจะเป็นการสร้างผลผ่าน pipe ของ PowerShell 5.1 (`… | python -` — `$OutputEncoding` = ASCII) หรือ `Set-Content`/`Out-File` แบบ ANSI · ด่านเดิมปล่อยการ์ด `?` ผ่าน 4 ใบ (มั่นใจ 0.94–0.99) · บรรณาธิการอ่านไม่ออกเลยไม่ใช้ แต่เสียงานรีเสิร์ชทั้งรอบ
- **กันไว้ 3 ชั้น (กฎเดียวกันทุกชั้น — `scripts/research-agent/encodingCheck.mjs`):**
  1. **ใบงาน** (สมอง codex ทุกโหมด · ช่วงท้ายใบงาน ไม่แตะ prefix แคช): สร้าง/แก้ `out/result.json` ด้วย apply_patch เท่านั้น · ห้าม `Set-Content` / `Out-File` / `echo` / `>` · ห้ามส่งข้อความ/สคริปต์ไทยผ่าน pipe ของ PowerShell · รัน `node tools/check-result.mjs out/result.json` ก่อนจบ (README-TOOLS.md ในโฟลเดอร์งานบอกแบบเดียวกัน)
  2. **เครื่องมือ `scripts/research-tools/check-result.mjs`** (เอเจนต์รันเอง · อ่านอย่างเดียว ไม่ใช้เน็ต): JSON ถูกรูป · ไทย ≥ 1 ตัว และอักษรเสีย (`?` · U+FFFD · mojibake `à¸`) ≤ 5% ของอักษรในช่องข้อความ (ไม่นับช่องว่าง/ตัวเลข/URL) · คีย์บังคับครบ → พิมพ์ JSON ASCII `{ok, reason, thaiChars, questionMarks, fields_bad[], missing_keys[], hint, …}` · `exit 0` ผ่าน / `1` ไม่ผ่าน / `2` ใช้ผิด
  3. **worker** (`scripts/research-agent-worker.mjs` · `codexRunner.readAgentResult` ติดผลตรวจมาให้): ผลเสีย + เวลาถึงเส้นตายใบขอเหลือ ≥ 6 นาที → ย้ายไฟล์เสียไป `out/round-encoding-result.json` แล้ว **รัน Codex ซ้ำ 1 รอบในโฟลเดอร์งานเดิม** (ใบงาน `TASK-encoding-retry.txt` มีย่อหน้า "⚠️ รอบก่อนไฟล์ผลเข้ารหัสผิด …") · เวลาไม่พอ/รันซ้ำแล้วยังเสีย → ระเบียน `status: failed` + ธง `ENCODING_BROKEN` · การ์ดทุกใบ `gate=dropped` (`gate_reason` ขึ้นต้น `ENCODING_BROKEN`) · ไม่มีแผน/ต้นทาง/ข้อแก้จากเนื้อที่เสีย · ไม่ยก medium · ไม่สำรอง API
  - **รายใบ** (`gate.mjs`): การ์ดที่ `claim` หรือ `evidence_quote` มีอักษรเสีย ≥ 50% (≥ 3 ตัว) → `dropped` เหตุผล `ENCODING_BROKEN` (กันกรณีเสียบางใบ) · `quote.text` เสีย → ตัด quote ทิ้ง การ์ดคงเดิม
- **ผลต่อข่าว/พนักงาน:** ข่าวเดินต่อจากต้นฉบับ (โหมด write: ระเบียนการ์ด `failed` → ใบที่สองขึ้น "ℹ️ ไม่มีข้อมูลผ่านเกณฑ์ — ใช้ต้นฉบับ" + ธงเป็นคำไทย) · บัตรใบแรกขึ้น "⚠️ รีเสิร์ชข่าวนี้ไม่สำเร็จ …" + "⚠️ ไฟล์ผลเอเจนต์เข้ารหัสผิด — รีเสิร์ชรอบนี้ใช้ไม่ได้" (บอทรู้จักธงนี้แบบ additive)
- **ตรวจเอง:** เปิดโฟลเดอร์งาน (`RESEARCH_AGENT_WORKDIR` ไม่ตั้ง = `%TEMP%\research-agent-work\<jobId>`) แล้วรัน `node tools\check-result.mjs out\result.json` หรือ `node tools\check-result.mjs out\round-encoding-result.json` · tool_log ของระเบียนมีบรรทัด `worker / encoding` บอกตัวเลข (ไทยกี่ตัว · อักษรเสียกี่ % · ช่องเสียกี่ช่อง) และผลรอบซ้ำ
- **ถ้าเกิดซ้ำบ่อยหลังมีใบงานใหม่:** ดู `TASK.txt`/`TASK-encoding-retry.txt` ว่ามีย่อหน้า "เขียนไฟล์ผล out/result.json" · ดู tool_log ของงานว่าเอเจนต์เขียนไฟล์ด้วยคำสั่งอะไร · `codex --version` (apply_patch ต้องใช้ได้บน Windows) · รอบซ้ำกินเวลาเพิ่ม 3–5 นาที (โหมด write: การชะลอคิว `RESEARCH_AGENT_HOLD_MS` 6 นาทีอาจหมดก่อน → ข่าวเขียนจากต้นฉบับ บัตรตามมาทีหลัง)
- **ไม่มีสวิตช์แยก:** ผลไทยปกติ = เส้นทางเดิมทุกอย่าง (ไม่รันซ้ำ ระเบียนเดิม) · ตัวตรวจพังเอง = ถือว่าไม่เสีย (fail-open) · ปิดทั้งระบบ = `RESEARCH_AGENT` (ส่วน 8)

## 14. เช็กลิสต์ตรวจสัญญาหลังรวมเลน (ผู้ตรวจ · สเปกข้อ 2 · หน้าที่เลน D)

- [ ] ชื่อ store ตรงตัว: `research-requests` · `research-cards` · `bot-posted`
- [ ] `research-requests` ครบช่องตาม 2.1 · `workflowId = 'unify_' + jobId` · `deadlineAt = createdAt + RESEARCH_AGENT_DEADLINE_MIN นาที` (ค่าเริ่มต้น 15 · ข้อตัดสิน 1 ต.ค. 69 แทนสูตรเดิม MAX_MINUTES×60 วิ + 60 วิ)
- [ ] `research-cards` ครบช่องตาม 2.2: `revision` · `status` ∈ done/failed/skipped · `mode` ∈ shadow/assist/write · `brain{kind, model, effort, account, quotaPctAfter}` · `plan[]` · `origin_post` · `cards[]` (มี `gate` ∈ pass/staff_only/dropped) · `raw_corrections[]` · `flags[]` · `skipped` · `tool_log[]` · `usage{tool_calls, minutes, costUsd}` · `feedback[{userId, cardId|'all', vote: up|down, at}]` · `createdAt` · `updatedAt`
- [ ] `brain.quotaPctAfter` = **% คงเหลือ** (รายงานนี้และคำเตือนตามสเปกข้อ 8 ยึดความหมายนี้) · `usage.minutes` เป็นนาที · `usage.costUsd` คิดจาก pricing.mjs
- [ ] `bot-posted` ครบช่องตาม 2.3 · row id = `bposted_<jobId>` (**ต่างจากสเปก 2.3** ที่เขียน `id: jobId` — เพราะ PK ข้าม store · `data.id` = jobId) · `/api/bot/posted` ของเลน C เรียก `saveBotPosted`/`getBotPosted` ของเลน B (นิยามเดียว · ไม่มีแถว `bp_` ซ้อน) · `caseId` เป็นข้อความ
- [ ] route ครบ 6 ตัวตาม 2.4 · ตรวจ `x-research-secret` (ไม่ตั้ง `RESEARCH_AGENT_SECRET` = ปฏิเสธทุกคำขอ ไม่ยอมรับค่าว่าง · เทียบแบบ timing-safe) · `/cards` ใช้ x-api-key เดิมของบอท · `/status` ไม่ต้องใช้คีย์และไม่คืนค่าลับ · ทุก route มี try/catch + `{success:false, error, errorType}`
- [ ] ชื่อ env ตรง `.env.example` ทุกตัว (เทส `tests/research-agent-ops.test.mjs` สแกนโค้ดเลน A–D ที่อ่าน env แล้วเทียบให้หลังรวม) · ป้าย `[Vercel]`/`[Railway]`/`[เครื่อง]` ตรงที่ที่โค้ดอ่าน · ไม่ตั้ง env = byte-parity
- [ ] heartbeat/lease: worker ส่ง `{jobId, workerId, version, account, quota: {remainingPct}}` / `{workerId, version}` · route รับทั้ง `quota.remainingPct` และ `quotaPct` (worker รุ่นแรก) + `version` ใน body (สำรอง header `x-research-worker-version`) · lease ไม่ส่ง `limits` (ค่างานอยู่ฝั่ง worker ในเฟส 1)
- [ ] `pipeline_logs` ขั้น `research-agent`: `workflow_id = unify_<jobId>` + `metadata {status, mode, cards, pass, flags, ms, waitedMs, brain}` (สถานะ `done` = การ์ดพร้อม · เวลาท่อรอ = `waitedMs` · แนะนำใส่ `jobId` ด้วย) — สิ่งที่สคริปต์รายงานอ่าน
- [ ] `generation_logs.pipeline_info.researchAgent` ผ่าน allowlist ของ generationLogger
- [ ] ชื่อไฟล์ worker: `scripts/research-agent-worker.mjs` · `scripts/research-agent-worker-forever.cmd` · `scripts/research-agent-account.cmd` · ไฟล์ธงหยุด `logs\research-agent\research-agent.stop` (worker `--stop`/`--resume` วาง/ลบ · forever.cmd และ guard ส่วน 6 ยึดตำแหน่งนี้ — ถ้าเลน A ย้าย ต้องแก้ `RA_STOP` ใน guard ตาม · เทส `tests/research-agent-ops.test.mjs` เทียบให้เมื่อมีไฟล์ worker) · guard จับโปรเซสจากคำว่า `research-agent-worker` ใน command line
- [ ] `RESEARCH_AGENT_TOOLS`: ไม่ตั้ง = 12 เครื่องมือ + เบราว์เซอร์ · ตั้ง = เฉพาะที่ระบุ และเบราว์เซอร์เปิดเฉพาะเมื่อมีคำ `browser` (ตัวอย่างใน `.env.example` และส่วน 8 ใส่ `browser` แล้ว · เทสเดียวกันเทียบกับ `loadConfig` ตัวจริงเมื่อมีไฟล์ worker)
- [ ] workerId ต่างกันต่อเครื่อง: `RESEARCH_AGENT_WORKER_ID` (ไม่ตั้ง = ชื่อเครื่อง) ใส่ใน `.env.example` แล้ว — เทียบชื่อ/ค่าเริ่มต้นกับโค้ดหลังรวม
- [ ] ราคาใน pricing.mjs และ usageLogger (gpt-6-*) ตรงตารางส่วน 11: `gpt-6-astra` = $10 input / $50 output ต่อ 1M (ราคาทางการ 1 ต.ค. 69 · ค่าเดียวกันทั้งสองไฟล์) · `gpt-6-sol`/`gpt-6-luna` ยังเป็นค่าประมาณ + TODO ยืนยัน

## 15. ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | เลน | หน้าที่ |
|---|---|---|
| `docs/RESEARCH-AGENT.md` | D | คู่มือนี้ |
| `scripts/research-agent-report.mjs` + `tests/research-agent-report.test.mjs` | D | รายงานอ่านอย่างเดียว + เทส (fetch ปลอม · mutation 12 แบบ) |
| `scripts/research-agent-autostart.cmd` | D | guard เปิด worker อัตโนมัติ (ชั้น 1) |
| `tests/research-agent-ops.test.mjs` | D | ตรวจไฟล์ ops: ธงหยุดของ guard = ของ worker · ตัวอย่าง `RESEARCH_AGENT_TOOLS` มี `browser` · คู่มือไม่อ้างตำแหน่งธงเก่า/ไม่สั่งปิดหน้าต่าง · env ครบ + ป้ายที่ตั้ง + ตาราง env ในคู่มือครบ + คู่มือห้ามตั้ง secret บน Railway (หลังรวมเทียบ `loadConfig` ตัวจริง และสแกนชื่อ env ที่โค้ดทุกเลนอ่าน) |
| `.env.example` | D | ชื่อ env ทั้งหมด + คอมเมนต์ |
| `scripts/research-agent-worker.mjs` · `scripts/research-agent-worker-forever.cmd` · `scripts/research-agent-account.cmd` · `scripts/research-agent/*` · `scripts/research-tools/*` 🔗 | A | worker · ตัวรัน Codex · ด่านเชิงกล · ราคา · เข็มขัดเครื่องมือ |
| `src/lib/research-agent/*` · `src/app/api/research/*` · `src/app/api/queue/add/route.js` · `src/lib/services/autoFlowServiceText.js` · `src/lib/services/generationLogger.js` · `src/lib/ai/usageLogger.js` 🔗 | B | store · route · จุดเสียบท่อ PRE-GENERATE · log |
| `discord-bot/researchCard.js` · `src/app/api/bot/posted/route.js` 🔗 | C | การ์ด Discord · รีแอ็กชัน · เตือนโควตา |
| `src/lib/research-agent/editorBrief.js` · `src/lib/research-agent/writeStage.js` · `tests/research-editor-brief.test.mjs` · `tests/research-write-pipeline.test.mjs` | W1 | โหมด write: บรรณาธิการเรียบเรียง + ด่านเชิงกล · ขั้นรอการ์ดหลังสกัด · store `research-editor` (ส่วน 16) |
| `src/lib/research-agent/queueHold.js` · จุดเสียบใน `src/lib/services/queueService.js` (getNextPendingJobs) · `src/app/api/queue/status/route.js` (ช่อง `researchHold`) · `discord-bot/index.js` (ข้อความรอ) · `tests/research-queue-hold.test.mjs` | W3 | โหมด write: คิวชะลอหยิบงานจนรีเสิร์ชเสร็จ (ส่วน 16) |
| `scripts/research-agent/encodingCheck.mjs` (กฎกลาง) · `scripts/research-tools/check-result.mjs` · ย่อหน้า "เขียนไฟล์ผล" ใน `taskBuilder.mjs` · รันซ้ำ/`ENCODING_BROKEN` ใน `scripts/research-agent-worker.mjs` · การ์ดเสียรายใบใน `gate.mjs` · บรรทัดเตือนใน `discord-bot/researchCard.js` · `tests/research-encoding-check.test.mjs` (fixture จริง `tests/fixtures/research-agent/encoding-*-result.json`) | W4 | กันไฟล์ผลเอเจนต์เข้ารหัสผิด — ไทยกลายเป็น `?` (ส่วน 13.1) |
| `src/lib/services/queueConcurrency.js` (ตัวช่วยอ่าน `QUEUE_NEWS_CONCURRENCY`) · เพดานใน `src/lib/services/queueService.js` (getNextPendingJobs) · self-heal ใน `src/app/api/queue/status/route.js` · `tests/queue-parallel.test.mjs` | W6 | ท่อข่าวขนาน — เขียนข่าวพร้อมกันหลายงานบน Vercel (ส่วน 16) |
| `createResearchWatchdog` · `renderDigestMessage` · hub ผลบัตร ใน `discord-bot/researchCard.js` · จุด start/stop ใน `discord-bot/index.js` · `src/app/api/research/digest/route.js` + `src/lib/research-agent/digest.js` · `src/app/api/research/bot-state/route.js` + `getBotState`/`saveBotState` ใน `src/lib/research-agent/store.js` · `tests/research-watchdog-digest.test.mjs` · `tests/research-web-digest.test.mjs` | W7 | แจ้งเตือนเจ้าของ (worker ออฟไลน์ · ล้มติดกัน · ติดต่อ Vercel ไม่ได้) + สรุปรายวัน DM (ส่วน 17) |

## 16. โหมด write (เฟส 2 · SPEC-v3 · เจ้าของเคาะ 1 ต.ค. 69 "เปิดเลยได้ write พนักงานจะตรวจก่อนโพสต์")

- **เปิด:** `RESEARCH_AGENT=1` + `RESEARCH_AGENT_MODE=write` (Vercel) · ถอย = `assist` (ส่วน 8) · ปิดสวิตช์/โหมดอื่น = ท่อเดิมทุกไบต์ (เทส `tests/research-write-pipeline.test.mjs` เทียบซอร์สที่ถอด hook)
- **ไหลอย่างไร (สายข้อความเท่านั้น):** สกัดข่าวเสร็จ → **รอการ์ด ≤ `RESEARCH_AGENT_WAIT_MS` (ค่าเริ่มต้น 300000) นับจากเริ่มท่อ** · เลิกรอเมื่อเส้นตายรวมเหลือ < 480 วิ (ไม่กินงบนักเขียน) → การ์ด `gate=pass` ที่มั่นใจ ≥ 0.85 (สื่อ/รายการหลัก ≥ 0.75) + รายการแก้ที่ผ่านเกณฑ์ → **บรรณาธิการเรียบเรียง** (`claude-opus-5-5` effort `medium` ≤ 60 วิ · ไม่เรียกเมื่อเวลาเหลือ < 435 วิ) → **ด่านเชิงกล** (ไม่ใช้ AI): ประโยคใหม่ที่มีตัวเลข/ชื่อคน-สถานที่หลังคำนำหน้า/คำอังกฤษ/ข้อความในอัญประกาศที่หาที่มาในต้นฉบับหรือการ์ดที่ใช้ไม่ได้ · มี URL · มี "ตามรายงาน/อ้างอิงจาก/ที่มา:" = ตัดทิ้งทั้งประโยค · ตัดเกิน 30% ของส่วนที่เพิ่ม หรือยาว > 2 เท่า / < 0.6 เท่าของต้นฉบับ = ใช้ต้นฉบับ
- **ผ่าน = ฉบับเสริมเป็นความจริงหลักของทุกขั้นถัดไป:** แตกประเด็น (RAW + เนื้อ + "มุมเสนอ (ตัวเลือก ไม่บังคับ)") · blueprint · เลือกการ์ด · รีเสิร์ชต่อมุม · นักเขียน (RAW-FIRST) · correction (+ ข้อเท็จจริงการ์ดที่ใช้) · ด่าน RAW · `sourceText` ของ generation log · ต้นฉบับเดิม = `analysisResult.researchAgent.original_preview` (≤ 400) + `research-requests[jobId].rawText` (เต็ม)
- **ฉบับเสริมลง workflow DB (ออดิตก่อน push 1 ต.ค. 69 · W5):** ขั้นแตกประเด็น/นักเขียน/เลือกการ์ดโหลด `newsBody` จาก workflow DB ทับข้อความที่ท่อส่ง (แตกประเด็น = เมื่อ DB ยาวกว่า · นักเขียน/การ์ด = ทุกครั้ง) → `writeStage` เขียนฉบับเสริมทับ `newsBody` ด้วยตัวบันทึกเดียวกับขั้นสกัด (`saveExtraction` · ช่องอื่นค่าเดิม · ≤ 4 วิ) ก่อนแตกประเด็น — ทุกขั้นเห็นฉบับเสริมชุดเดียวกัน · บันทึกล้ม = ข่าวเดินต่อ + log ⚠️ ใน `ResearchWrite`
- **ไม่ทัน/ล้ม/ไม่มีการ์ดผ่านเกณฑ์ = ข่าวเขียนจากต้นฉบับ** (อินพุตทุกขั้นเท่าปิดสวิตช์) · บอทแจ้งพนักงานจากช่อง `editor`
- **ผลบรรณาธิการ (สัญญา 8.1):** store `research-editor` row `redit_<jobId>` (ทุกสถานะ `done`/`not_ready`/`failed`/`skipped` · ไม่เก็บฉบับเสริมเต็ม มีแค่ `enriched_preview` ≤ 400) · อ่านได้ที่ `GET /api/research/cards?jobId=` ช่อง `editor` · `analysisResult.researchAgent.editor` · `pipeline_info.researchAgent.editor` (ตัวเลขย่อ) · `pipeline_logs` step `research-editor`
- **ข้อจำกัด:** ชื่อคนไทยที่ไม่มีคำนำหน้า/อัญประกาศตรวจเชิงกลไม่ได้ (พึ่งกติกาในพรอมต์ + พนักงานตรวจก่อนโพสต์) · เวลาที่รอ/บรรณาธิการนับรวมใน `stepTimings.extract` · สาย URL/คลิปยังไม่เข้าโหมด write
- **คิวชะลอหยิบงาน (W3 · SPEC-v3 ส่วน 9):** เอเจนต์ใช้ 3.3–4.5 นาทีนับจากสร้างใบขอ แต่ท่อรอได้จริง ~3 นาทีหลังสกัด → ย้ายการรอออกนอกงบท่อ: ตัวหยิบงานคิว (`getNextPendingJobs`) **ข้ามงานข่าวที่ใบขอยัง `queued`/`leased`** จนเสร็จหรืออายุใบขอครบ `RESEARCH_AGENT_HOLD_MS` (ค่าเริ่มต้น 360000 · เพดาน 600000 · `0` = ปิด) แล้วหยิบงานถัดไปที่ไม่ถูกชะลอแทน (ไม่บล็อกคิว) · งานที่ชะลอยังเป็น `pending` ไม่นับ `processing` · log หนึ่งบรรทัดต่อรอบ `[QueueService] ⏳ hold <jobId8> รอรีเสิร์ช (อายุ xs/ys)` · การรอในท่อ (ข้อบน) คงไว้เป็นตาข่ายสำรอง
  - **หยิบตามปกติ (ไม่ชะลอ) เมื่อ:** ใบขอ `done`/`failed`/`expired` · ไม่มีใบขอ · ใบขอเลย `deadlineAt` · ใบขอ `queued` แต่ไม่มีชีพจร worker ≤ 10 นาที (worker ออฟไลน์ — ข่าวไม่ช้าเพราะรอคนที่ไม่มา) · อ่านใบขอไม่ได้หรือเกิน 3 วิ (fail-open) · ปิดสวิตช์/`shadow`/`assist` (ไม่ import อะไร · ตัวหยิบงานเดิมทุกไบต์)
  - **ข้อเสริมหลังออดิต (1 ต.ค. 69 · W5):** ใบขอ `leased` ที่ชีพจร worker ขาด > 150 วิ (`heartbeatAt` · ไม่มี = `leasedAt` · worker ส่งทุก 30 วิ) = worker ตายกลางงาน → ไม่ชะลอ **และท่อเลิกรอทันที** (สถานะ `offline` → เขียนจากต้นฉบับ · บอทขึ้น "รีเสิร์ชไม่ทัน") · งานที่ input มีลิงก์ (รวม URL ล้วน = ลิงก์ + ข้อความอื่น ≤ 20 ตัวอักษร) หรือรูป = สาย URL/รูปที่ไม่ใช้ฉบับเสริม → ไม่ชะลอ (ตัวตรวจเดียวกับ `/api/auto/process`: `detectInputType`)
  - **บอท:** `/api/queue/status` ตอบเพิ่ม `researchHold: {heldMs, maxMs}` เฉพาะงานที่ถูกชะลอ → ข้อความรอเปลี่ยนเป็น "⏳ กำลังค้นคว้าก่อนเขียน (x/y นาที)" · ไม่ปลุก worker เปล่าระหว่างชะลอ · ยืดเวลารอผลของบอทเท่าเพดานที่เห็น (15 นาทีเดิม + ≤ 10 นาที) · ไม่มีช่องนี้ = ข้อความเดิม
  - **ข้อจำกัด:** หน้าเว็บ (`/content/new`) ยังโชว์ "รอคิว" และมีเพดาน poll 15 นาทีเดิม · self-heal ของ `/api/queue/status` ยังปลุก worker ทุก 20 วิระหว่างชะลอ (ปลุกแล้วถูกข้ามเอง · ปลุกนี้ทำให้หยิบได้ทันทีเมื่อการชะลอจบ)
- **ไฟล์ผลเอเจนต์เข้ารหัสผิด (W4 · SPEC-v3 ส่วน 10):** ไฟล์ผลที่ไทยกลายเป็น `?` ถูกจับ 3 ชั้น (ใบงานสั่ง apply_patch + `tools/check-result.mjs` · worker รันซ้ำ 1 รอบเมื่อเหลือ ≥ 6 นาที · ไม่ทัน/ยังเสีย = `failed` + ธง `ENCODING_BROKEN` การ์ดทุกใบ `dropped`) → บรรณาธิการไม่ได้รับการ์ดเสีย ข่าวเขียนจากต้นฉบับ · รายละเอียด/วิธีตรวจ ส่วน 13.1
- **ท่อข่าวขนาน (W6 · SPEC-v3 ส่วน 11 · เจ้าของสั่ง 2 ต.ค. 69 "เวลาต่อข่าวเท่าเดิมได้ แค่อยากให้ไม่ต้องต่อคิวกัน เพราะพนักงานเป็นสิบ"):** ตั้ง `QUEUE_NEWS_CONCURRENCY` (Vercel · ค่าแผน 8 · เพดาน 10) → ตัวหยิบงานคิว (`getNextPendingJobs`) ยอมให้ข่าววิ่งพร้อมกันได้ถึงค่านี้ต่อเครื่อง (เดิมคงที่ 1 = ข่าวที่ส่งซ้อนกันรอข่าวก่อนหน้าเขียนเสร็จ ~4 นาที/ข่าว) · ทุกข่าวยังเป็น 1 invocation ของ `/api/queue/worker` → `/api/auto/process` เหมือนเดิม (เวลาต่อข่าวเท่าเดิม) · ไม่ตั้ง/อ่านไม่ได้/< 1 = 1 = เดิมทุกไบต์ (เทส `tests/queue-parallel.test.mjs` เทียบซอร์สที่ถอด W6)
  - **ใครปลุก worker:** ตัวปลุกเดิม 3 ทางเท่านั้น — `/api/queue/add` ยิง worker หลังรับข่าว (1 ข่าว/การส่ง = ขนานตามจำนวนที่ส่ง) · self-heal ของ `/api/queue/status` (บอท/หน้าเว็บ poll ทุก 3 วิ · throttle 20 วิ) ปลุกเมื่อ `pending > 0` และ `processing < QUEUE_NEWS_CONCURRENCY` (เดิม `processing === 0`) · cron ทุก 1 นาที · worker ยังหยิบ 1 งานต่อครั้ง · **ไม่มี self-fetch worker→worker** (บทเรียน 508 INFINITE_LOOP 24 มิ.ย. 69)
  - **ความปลอดภัย:** atomic claim (Supabase CAS) กันสอง invocation หยิบงานเดียวกัน · นับงานที่วิ่งอยู่จากฐานจริงทุกครั้ง (ไม่มี state ในหน่วยความจำ) · งานปก/คลิป (ไม่ใช่ข่าว) คงทีละ 1 งาน/เครื่อง · เครื่องทีม (Windows) ที่ไม่เปิด `QUEUE_LOCAL_NEWS=1` = 1 เสมอ · คิวชะลอหยิบงาน (W3) ยังข้ามงานที่รอรีเสิร์ชแล้วเติมช่องด้วยงานถัดไป
  - **ข้อจำกัด:** ข่าวที่ส่งพร้อมกันเป๊ะอาจชนกันที่ claim (invocation ที่แพ้ไม่ไปหยิบงานถัดไป) → งานนั้นรอตัวปลุกรอบถัดไป (บอทปลุกซ้ำหลัง 10 วิ · self-heal 20 วิ · cron ≤ 1 นาที) · self-heal นับ `processing` รวมทุกเครื่อง (ปกบนเครื่องทีมกินช่องในการตัดสินใจปลุก แต่ไม่กินช่องจริงของ Vercel) · ปลุกเปล่าระหว่างงานถูกชะลอรอรีเสิร์ช = worker ตอบ "No pending jobs" แล้วจบ · เฝ้า rate limit ของ Anthropic/OpenAI 2–3 วันหลังเปิด · ถอย = ส่วน 8

## 17. แจ้งเตือนเจ้าของ + สรุปรายวัน (W7 · SPEC-v3 ส่วน 12 · เจ้าของตอบ 2 ต.ค. 69)

เจ้าของมีคอมเครื่องเดียวที่รัน worker และไม่มี worker สำรอง → บอท (Railway · โปรเซสที่รันยาวและส่ง DM ได้) ต้องแจ้งให้ไว · ทำงานเมื่อเปิดสวิตช์รีเสิร์ชของบอทเท่านั้น (ปิด = ไม่ตั้ง timer · ไม่ยิง HTTP · ไม่ log · บอทเดิมทุกไบต์) · ไม่ปรับอะไรอัตโนมัติ — 👍👎 รวมไว้ให้เจ้าของดูรายสัปดาห์แล้วสั่งปรับเอง

| เหตุ | เกณฑ์ | ข้อความ | ซ้ำ |
|---|---|---|---|
| worker ค้นคว้าออฟไลน์ | บอทถาม `/api/research/status` ทุก 60 วิ · สถานะ offline และนับจาก `lastSeenAt` ล่าสุด ≥ 10 นาที (route ไม่มี `lastSeenAt` = นับจากครั้งแรกที่บอทเห็นออฟไลน์) | 🔴 worker ค้นคว้าออฟไลน์ตั้งแต่ <เวลา> — ข่าวกำลังออกแบบไม่มีรีเสิร์ช | ทุก 60 นาทีถ้ายังออฟไลน์ · กลับมา = 🟢 worker กลับมาแล้ว (ออฟไลน์ไป x นาที) |
| บอทติดต่อ Vercel ไม่ได้ | `/api/research/status` ล้ม (เน็ต/HTTP ไม่ใช่ 2xx/ตอบผิดรูป) ติดกัน ≥ 3 ครั้ง — **ไม่นับเป็น worker ออฟไลน์** (สถานะ worker คงค่าล่าสุด) | ⚠️ บอทติดต่อ Vercel ไม่ได้ (ล้มติดกัน N ครั้ง · เหตุ) | ≤ 1 ครั้ง/ชม. |
| รีเสิร์ชล้มติดกัน | ผลที่บอทเห็นจากบัตร: การ์ด `failed` · ธง `AGENT_FAILED`/`ENCODING_BROKEN`/`BRAIN_UNAVAILABLE` · บรรณาธิการ `failed` ติดกัน ≥ 3 งาน (`done` = เริ่มนับใหม่ · `skipped`/`not_ready` ไม่นับและไม่รีเซ็ต · งานเดิมนับครั้งเดียว) | 🔴 รีเสิร์ชล้มติดกัน N ข่าว — ล่าสุด: jobId 3 ตัว (เหตุ) | ที่ 6, 9 … |
| สรุปรายวัน | ทุกวัน `RESEARCH_DIGEST_HOUR`:`RESEARCH_DIGEST_MINUTE` เวลาไทย (ค่าเริ่มต้น 07:30) ครอบช่วง "เมื่อวานเวลาเดียวกัน → วันนี้" | 📊 สรุปรีเสิร์ช <วันที่> (≤ 1,800 ตัวอักษร) | วันละครั้ง — จำใน Supabase `store_items` store `bot-state` แถว `bstate_daily-digest` (จองแบบ cas ก่อนส่ง) → รีสตาร์ต/redeploy/สองบอททับกันไม่ส่งซ้ำ · บอทล่มตอนถึงเวลา = ส่งตอนตื่นได้จนถึงรอบถัดไป |

- **ส่งหาใคร:** DM `RESEARCH_AGENT_OWNER_DISCORD_ID` → DM ไม่ได้ (เจ้าของปิด DM / ไม่ได้อยู่เซิร์ฟเวอร์เดียวกับบอท) = โพสต์ห้อง `ADMIN_LOG_CHANNEL_ID` พร้อม mention เจ้าของ → ไม่ได้อีก/ไม่ได้ตั้ง = log ของบอท (Railway logs ขึ้นต้น `[ResearchWatch]`) · ไม่มี owner id = ห้องสำรอง (ไม่ mention) → log
- **เนื้อสรุปรายวัน:** ข่าวทั้งหมด · ผ่านระบบใหม่ (แยกโหมด write/assist/shadow) · เข้าเนื้อ / ไม่ทัน / ไม่ผ่านเกณฑ์ / ล้ม / ไฟล์เข้ารหัสผิด · แก้ข้อผิดรวม / เพิ่มข้อมูลรวม · ธง ข่าวเก่า / ขัดต้นฉบับ / ยืนยันต้นทางไม่ได้ (+ ธงระบบถ้ามี) · เวลาเฉลี่ย (รอการ์ด / บรรณาธิการ / ทั้งท่อ) · ค่าเครื่องมือ (`usage.costUsd` ของการ์ดในช่วง) + ค่า AI ประมาณจาก `api_usage_logs` (ทุกงาน LLM ในช่วง ไม่ใช่เฉพาะรีเสิร์ช · Codex ใช้โควตา subscription ไม่อยู่ในตาราง) · โควตา Codex ล่าสุด (จากรอบเฝ้าล่าสุด) · 👍👎 แยกใบแรก/ใบสอง (นับเฉพาะที่กดในช่วง) + jobId ที่ได้ 👎 · ข่าวที่ควรดู ≤ 3 (👎 ก่อน แล้วข่าวที่บรรณาธิการแก้ข้อผิด · ลิงก์หน้าตรวจงาน `/generation-logs/<caseId>`) · ส่วนที่อ่านไม่ได้ขึ้น "⚠️ ข้อมูลไม่ครบ"
- **route ใหม่ (Vercel · บอทเรียกด้วย `API_KEY` เดิม = `DISCORD_API_SECRET` · ไม่ตั้ง = 403 ปิดประตู):** `/api/research/digest` — GET `?since=&until=` (ISO · ไม่ส่ง = 24 ชม. ล่าสุด · ยาวสุด 8 วัน) อ่าน `generation_logs.pipeline_info.researchAgent` + `research-cards` (สถานะ/ธง/usage/feedback) + `api_usage_logs` (`cost_usd` ทีละ 1,000 แถว) · จำกัด 8 วิ · ส่วนที่อ่านไม่ได้/ไม่ทัน = ช่องนั้น `null` + `errors` (ไม่ 500 ทั้งก้อน) · ไม่มีเนื้อข่าว (มีแค่ชื่อข่าว ≤ 60 ตัวอักษรของข่าวที่ควรดู) · `/api/research/bot-state` — GET `?key=daily-digest` / POST `{key, expectedRevision, state}` (0 = ยังไม่มีแถว · ชน = 409 `BOT_STATE_CONFLICT` + ค่าล่าสุด)
- **ทดสอบจริงหลัง deploy (ห้ามยิงก่อนเจ้าของอนุมัติ push):** (1) Railway logs ต้องเห็น `[ResearchWatch] 👀 เริ่มตัวเฝ้า …` หลังบอทออนไลน์ (บอกเวลาสรุปและปลายทาง) (2) `curl -H "x-api-key: <API_KEY ของบอท>" "<โดเมน>/api/research/digest"` ได้ JSON ตัวเลข `success:true` (3) ครั้งแรกหลังเปิดใช้ บอทส่งสรุปของรอบเวลาสรุปล่าสุดภายใน ~1 นาที (ยังไม่เคยมีแถว `bstate_daily-digest`) — ได้ DM = ช่องทางใช้ได้ (4) หยุด worker ด้วย `--stop` นานกว่า 10 นาที → ได้ 🔴 · เปิดกลับ (`--resume`) → ได้ 🟢
- **ถอย:** ส่วน 8 (ปิดเฉพาะสรุป = `RESEARCH_DIGEST=0` · ไม่มีสวิตช์แยกของตัวเฝ้า = ปิดสวิตช์รีเสิร์ชของบอทหรือถอยโค้ด)
