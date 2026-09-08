# Clip Agent API (P7)

API สำหรับเอเจนต์ส่งลิงก์คลิปเข้าคิว ติดตามงาน และอ่านผลจากคลังเดิม รองรับ `insight` (ถอดประเด็นข่าว) และ `transcript` (บทถอดเสียง) ใช้คิว `clip-jobs` และคลัง `clip-insights` / `clip-transcripts` ร่วมกับเครื่องมือคลิปเดิม

## เปิดใช้งานและยืนยันตัวตน

Base URL สำหรับเครื่องนี้คือ `http://localhost:3000` ส่วน production ใช้ URL ของ Vercel deployment ที่ตั้งค่าแล้ว เช่น `https://<your-project>.vercel.app` โดยแทน placeholder ด้วยโดเมนจริง

ตั้งค่าฝั่งเซิร์ฟเวอร์ใน `.env.local` หรือ environment ของ deployment:

```dotenv
CLIP_AGENT_API_KEY=<replace-with-a-long-random-secret>
CLIP_AGENT_WAIT_CAP_SEC=25
```

ทุก endpoint ต้องส่งคีย์ผ่าน header อย่างใดอย่างหนึ่ง:

```http
x-clip-agent-key: <your-agent-api-key>
```

หรือ:

```http
Authorization: Bearer <your-agent-api-key>
```

หากยังไม่ตั้ง `CLIP_AGENT_API_KEY` API จะปิดและตอบ HTTP `503` พร้อม `AGENT_API_DISABLED` และข้อความภาษาไทย หากคีย์ขาดหรือไม่ตรงจะตอบ HTTP `401` พร้อม `UNAUTHORIZED` เก็บคีย์ไว้ฝั่งเซิร์ฟเวอร์/เอเจนต์ ไม่ใส่ใน query string หรือโค้ดฝั่งเบราว์เซอร์

**Production ต้องมี clip worker ที่ทำงานอยู่และอ่าน/เขียน storage ชุดเดียวกับ API** การตั้งคีย์บน Vercel อย่างเดียวไม่ได้ทำให้เกิดการถอดคลิป หาก API กับ worker ใช้ local fallback คนละเครื่อง ทั้งสองฝั่งอาจไม่เห็นคิวหรือผลเดียวกัน

## ลำดับการเรียกที่แนะนำ

1. เรียก `POST /api/clip-agent/submit` ด้วย `force=false` หนึ่งครั้ง แล้วเก็บ `jobId` ที่ตอบกลับ — ถ้าคลิปนี้เคยถอดแล้ว worker จะคืนใบเดิมจากคลังภายในไม่กี่วินาที (สถานะ `done`) โดยไม่เสียค่าถอดใหม่ จึง**ไม่ต้อง**เรียก result ก่อน — **ข้อยกเว้น:** `kind=transcript` ไม่มีการใช้ใบเดิม (ถอดใหม่ทุกครั้ง เสียเงิน) ถ้าอยากใช้บทถอดเดิมให้เรียก `result?url=&kind=transcript` ก่อน
2. (ทางเลือก) `GET /api/clip-agent/result?id=<caseId>` ใช้อ่านใบในคลังซ้ำภายหลังด้วย `caseId` ที่ได้จากผล — อ่านแถวเดียว ถูกและเร็ว · ส่วน `result?url=` ต้องกวาดทั้งคลัง (ปัจจุบัน ~9 MB ต่อครั้งบน Supabase) ใช้เฉพาะเมื่อจำเป็นและอย่าเรียกถี่
3. เรียก `GET /api/clip-agent/status?id=<jobId>&wait=25` หากยังไม่จบ ให้เรียก status ของ **job เดิม** ต่อไป งานปกติอาจใช้เวลา 1–15 นาที ขึ้นกับคิว ความยาวคลิป และบริการถอดคลิป
4. เมื่อ `status=done` อ่าน `result` ได้เลย เมื่อเป็น `error` หรือ `cancelled` ให้หยุดรอและตรวจสาเหตุ

อย่าส่ง submit ซ้ำเป็นชุดระหว่างรอ งานลิงก์/ชนิดเดียวกันที่ยัง active จะคืน job เดิม (`dup=true`) ให้ติดตาม job นั้นต่อ

ตัวอย่าง `curl` ด้านล่างใช้ Bash (เช่น Git Bash/WSL) โดยกำหนด `BASE_URL` เป็น base URL และ `CLIP_AGENT_API_KEY` เป็นคีย์ที่ตั้งไว้ใน environment ของเอเจนต์ ตัวอย่างใช้ลิงก์และ ID สมมติ ให้แทนด้วยค่าจริงก่อนเรียก

```bash
BASE_URL='http://localhost:3000'
```

## 1. ส่งงาน: POST /api/clip-agent/submit

ส่ง JSON พร้อม `Content-Type: application/json`:

| ฟิลด์ | ชนิด | ค่าเริ่มต้น / ความหมาย |
|---|---|---|
| `url` | string | ต้องระบุ URL แบบ HTTP/HTTPS ของคลิป |
| `kind` | string | `insight` หรือ `transcript`; ไม่ส่งใช้ `insight` |
| `force` | boolean | ไม่ส่งใช้ `false`; `true` ขอถอดใหม่แม้มีผลในคลัง |
| `user` | string | ชื่อผู้ส่งสำหรับติดตามงาน; ไม่ส่งใช้ `codex-agent` |

แพลตฟอร์มที่รองรับคือ YouTube (`platform=youtube`), TikTok (`tiktok`) และ Facebook / Instagram (`meta`) ค่า `force` ต้องเป็น boolean เช่น `false` ไม่ใช่ string `"false"`

การ submit ผ่าน Agent API ตรวจว่า URL แบบ HTTP/HTTPS แปลงด้วย URL parser ได้ และตรวจ hostname จริง โดยรับเฉพาะ `youtube.com`, `youtu.be`, `tiktok.com`, `facebook.com`, `fb.watch`, `instagram.com` หรือ subdomain ของโดเมนเหล่านี้ การมีชื่อแพลตฟอร์มอยู่เพียงใน path/query หรือเป็นส่วนหนึ่งของโดเมนอื่น เช่น `youtube.com.example.org` ไม่ผ่านการตรวจแพลตฟอร์ม

```bash
curl -i --request POST "$BASE_URL/api/clip-agent/submit" \
  --header "x-clip-agent-key: $CLIP_AGENT_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"url":"https://www.youtube.com/watch?v=EXAMPLE_ID","kind":"insight","force":false,"user":"codex-agent"}'
```

ตัวอย่าง HTTP `202 Accepted`:

```json
{
  "ok": true,
  "jobId": "example-job-id",
  "status": "pending",
  "position": 1,
  "platform": "youtube",
  "dup": false,
  "statusUrl": "/api/clip-agent/status?id=example-job-id"
}
```

`202` หมายถึงรับงานเข้าคิวหรือพบงานเดิมที่ยัง active ไม่ใช่ถอดเสร็จแล้ว หาก `dup=true` ให้ใช้ `jobId` ที่ตอบกลับต่อไป `force=true` ยังอยู่ภายใต้การกันงาน active ซ้ำและอาจคืน job เดิม จึงไม่ได้รับประกันว่าจะสร้าง job ใหม่ทุกครั้ง

**`force=true` อาจเสียค่าถอดใหม่แม้มีผลที่ใช้ได้อยู่แล้ว** ใช้เมื่อมีเหตุผลให้ถอดใหม่เท่านั้น ค่า `false` เปิดให้กระบวนการเดิมใช้ผลในคลังได้

## 2. ติดตามงาน: GET /api/clip-agent/status

| Query | ค่า / ความหมาย |
|---|---|
| `id` | `jobId` จาก submit; ต้องระบุ |
| `wait` | จำนวนวินาทีที่จะรอในคำขอนี้; ไม่ส่งใช้ `0` (อ่านทันที) |
| `full` | ส่ง `1` เพื่อรับ `job.result` เดิมแบบเต็มเมื่อจบ; ไม่ส่งใช้ผลแบบ compact |

```bash
curl -i --get "$BASE_URL/api/clip-agent/status" \
  --header "Authorization: Bearer $CLIP_AGENT_API_KEY" \
  --data-urlencode 'id=example-job-id' \
  --data-urlencode 'wait=25'
```

ตัวอย่าง HTTP `200` เมื่อครบเวลารอแต่งานยังทำอยู่:

```json
{
  "ok": true,
  "jobId": "example-job-id",
  "status": "processing",
  "position": 0,
  "attempts": 1,
  "statusNote": "",
  "lastError": "",
  "error": "",
  "createdAt": "2026-09-08T03:00:00.000Z",
  "startedAt": "2026-09-08T03:00:05.000Z",
  "doneAt": null,
  "nextRetryAt": null,
  "platform": "youtube",
  "kind": "insight",
  "user": "codex-agent",
  "result": null,
  "timedOut": true
}
```

เมื่อ `wait>0` เซิร์ฟเวอร์อ่านเฉพาะแถวของงานนี้ (ไม่ดึงทั้งคิว) ประมาณทุก 2 วินาทีและตอบเมื่อพบสถานะจบหรือครบเวลารอ เพดานต่อคำขอมาจาก `CLIP_AGENT_WAIT_CAP_SEC` (ค่าเริ่มต้น `25` วินาที สูงสุด `780` วินาที) ค่า `wait` ที่เกินเพดานจะถูกจำกัด Route ประกาศ `maxDuration=800` วินาที แต่ deployment และ HTTP client ต้องรองรับระยะเวลาที่เลือกด้วย การเรียก `wait=25` ซ้ำเหมาะกับการรอนานหลายรอบ

`timedOut=true` หมายถึง **คำขอ status รอบนี้รอครบเวลา** งานยังทำต่อได้ และยังตอบ HTTP `200` ให้เรียก status ซ้ำโดยใช้ `jobId` เดิม `wait=0` เป็นการอ่านทันที ผล `result` จะเป็น `null` จนกว่า `status=done` แม้ส่ง `full=1`

คำตอบ status และ result ส่ง `Cache-Control: no-store` เพื่อให้เอเจนต์อ่านข้อมูลล่าสุด รวมถึงการอัปเดตที่ worker เขียนจากอีก process

| `status` | ความหมาย | เอเจนต์ควรทำต่อ |
|---|---|---|
| `pending` | รอ worker รับงาน | รอ status รอบถัดไป; `position` บอกลำดับคิว |
| `processing` | worker กำลังทำงาน | รอ job เดิม |
| `retry_wait` | รอการลองใหม่อัตโนมัติ | ดู `nextRetryAt`, `statusNote`, `lastError`, `attempts` แล้วรอ job เดิม |
| `done` | จบและมีผล | อ่าน `result`; หยุด polling |
| `error` | งานล้มเหลวและจบแล้ว | อ่าน `error` / `lastError`; หยุด polling |
| `cancelled` | งานถูกยกเลิกและจบแล้ว | หยุด polling |

`position` เป็นข้อมูลคิว ณ เวลาที่อ่าน ไม่ใช่เวลาเสร็จโดยประมาณ ค่า `0` ใช้เมื่อไม่ได้อยู่สถานะรอคิว เวลาต่าง ๆ อาจเป็น `null` เมื่อยังไม่มีข้อมูล

## 3. อ่านผลในคลัง: GET /api/clip-agent/result

| Query | ค่า / ความหมาย |
|---|---|
| `url` | URL ของคลิปที่จะค้นหา; เทียบกับค่าที่เก็บแบบตรงตัว |
| `id` | ID ของ **เคสในคลัง** (`caseId`); มีลำดับก่อน `url` หากส่งมาทั้งคู่ |
| `kind` | `insight` หรือ `transcript`; ไม่ส่งใช้ `insight` |
| `full` | ส่ง `1` เพื่อรับ record ของเคสเดิมแบบเต็ม; ไม่ส่งใช้ compact |

`id` ของ endpoint นี้คือ `caseId` ไม่ใช่ `jobId` (ค้นด้วย `id` = อ่านแถวเดียว ประหยัด) เมื่อค้นด้วย URL จะเลือกเคสที่ปักหมุด `chosen` ก่อน จากนั้นเลือก `createdAt` ล่าสุดในกลุ่มเดียวกัน คลังเก็บ URL ที่ล้างแล้ว (ลิงก์ YouTube ทุกแบบ → `https://www.youtube.com/watch?v=<id>` · ตัด fbclid/utm/si) และ endpoint นี้ล้างค่า `url` ที่ส่งมาแบบเดียวกันก่อนเทียบ จึงใช้ youtu.be/shorts/ลิงก์ติด tracking ค้นได้ · ลิงก์ที่ต่างกันจริง (คนละคลิป/คนละ query ที่ไม่ใช่ tracking) ไม่ตรงกัน

```bash
curl -i --get "$BASE_URL/api/clip-agent/result" \
  --header "x-clip-agent-key: $CLIP_AGENT_API_KEY" \
  --data-urlencode 'url=https://www.youtube.com/watch?v=EXAMPLE_ID' \
  --data-urlencode 'kind=transcript'
```

ตัวอย่าง HTTP `200` สำหรับผลแบบ compact ของ `transcript`:

```json
{
  "ok": true,
  "result": {
    "caseId": "example-case-id",
    "url": "https://www.youtube.com/watch?v=EXAMPLE_ID",
    "platform": "youtube",
    "title": "ชื่อคลิปตัวอย่าง",
    "text": "ข้อความถอดเสียงจากคลิป...",
    "createdAt": "2026-09-08T03:05:00.000Z"
  }
}
```

ผลแบบ compact มีรูปแบบดังนี้ ฟิลด์ที่ไม่มีข้อมูลอาจเป็น `null` และรายการที่ไม่มีข้อมูลเป็น `[]`:

รองรับทั้งเคสจากคลังที่มีข้อมูลอยู่ใต้ `insight` และผลจาก worker ที่วางข้อมูลไว้ระดับบน `createdAt` ใช้เวลาที่บันทึกใน `createdAt` หรือ `cachedAt` และอาจเป็น `null` ในผลที่ worker เพิ่งคืนมา หากใช้ `full=1` จะได้รับข้อมูลเดิมตามที่เก็บโดยไม่แปลงเป็น compact

- `transcript`: `caseId`, `url`, `platform`, `title`, `text`, `createdAt`; `text` มาจากบทถอดต้นฉบับ (`rawText`)
- `insight`: `caseId`, `url`, `platform`, `title`, `clipDurationSec`, `createdAt`, `elapsedMs`, `status`, `lowQuality` (true = ระบบติดธง "ผลอาจไม่สมบูรณ์" ตอนถอด ควรตรวจหรือ force ถอดใหม่), `qualityNote`, `headline`, `overview`, `mainStory`, `keyPoints`, `stories`, `warnings`, `brain`
- แต่ละสมาชิกใน `stories` มี `id`, `topic`, `story`, `highlight`, `facts`, `quotes`, `sharePct`, `quality`; สมาชิกใน `quotes` มี `text`, `speaker`, `verified`
- เคส insight รุ่นเดิมที่ไม่มี `topicsV2` จะมี `subStories` เพิ่ม โดยสมาชิกมี `title`, `text`
- `brain` มีข้อมูลเครื่องมือและการประมวลผล: `engine`, `elapsedMs`, `costUSD`, `topicsV2` โดยข้อมูล `topicsV2` สรุป `ok`, `gate`, `stories`, `elapsedMs`

`keyPoints`, `facts` และ `warnings` เป็นรายการข้อความ ส่วน `brain.topicsV2.stories` เป็นจำนวนเรื่อง ไม่ใช่รายการเนื้อเรื่อง `quotes[].verified` เป็น `true` (ตรวจแล้วตรง), `false` (ตรวจแล้วไม่ตรง) หรือ `null` (ยังไม่ได้ตรวจ/ไม่มีข้อมูล)

`result.status` ของ insight เป็นสถานะการวิเคราะห์ที่บันทึกในผล (`insight.brain.status`) ซึ่งเป็นคนละฟิลด์กับ `status` ของ job ที่ใช้ตัดสินว่าต้อง polling ต่อหรือไม่ เมื่อจำเป็นต้องอ่านข้อมูลเดิมทุกฟิลด์ ให้เพิ่ม `full=1` ใน status หรือ result ตามชนิด ID ที่มี

## HTTP และ errorType

ข้อผิดพลาดระดับ API ตอบ JSON พร้อม `ok=false` และ `errorType` โดยอาจมีข้อความ `error` ภาษาไทยเพิ่มเติม ฟิลด์ `error` ไม่ได้มีทุกคำตอบ เช่น HTTP `401` และ `404` ให้ใช้ HTTP status ร่วมกับ `errorType` ในการตัดสินใจ ส่วนงานที่ worker ทำแล้วล้มเหลวอ่านผ่าน status ได้เป็น HTTP `200` โดยมี `status=error`

| HTTP | `errorType` | เกิดเมื่อ / วิธีจัดการ |
|---|---|---|
| `503` | `AGENT_API_DISABLED` | ยังไม่ตั้งคีย์ฝั่ง API; ตั้ง `CLIP_AGENT_API_KEY` ให้ deployment ที่เรียก |
| `401` | `UNAUTHORIZED` | ไม่ส่งคีย์หรือคีย์ไม่ตรง; แก้ header ก่อนลองใหม่ |
| `400` | `BAD_REQUEST` | JSON, ชนิดข้อมูล หรือ `kind` ไม่ถูกต้อง; แก้คำขอ |
| `400` | `BAD_URL` | URL ไม่ถูกต้องหรือไม่ใช่ HTTP/HTTPS; แก้ลิงก์ |
| `400` | `UNSUPPORTED_PLATFORM` | โดเมนไม่ใช่แพลตฟอร์มที่รองรับ |
| `404` | `JOB_NOT_FOUND` | status ไม่มี `id` หรือหา job ไม่พบ (คิวเก็บงานจบแล้วไว้จำกัด อาจถูกล้าง); ระหว่างรอ (`wait>0`) ถ้า store สะดุดชั่วคราว จะได้สถานะล่าสุดที่เห็นแทน 404 · ก่อนส่งใหม่ให้ตรวจ job ID และใช้ result ค้นคลัง |
| `404` | `CASE_NOT_FOUND` | result หาเคสไม่พบหรือไม่มีตัวระบุเคส; ตรวจ `kind` / URL / case ID แล้วจึง submit หากต้องการงานใหม่ |
| `500` | `SUBMIT_ERROR` | ส่งคิวไม่สำเร็จจากข้อผิดพลาดภายใน; ตรวจระบบก่อนลองใหม่ อย่าส่งซ้ำรัว ๆ |
| `500` | `STATUS_ERROR` | อ่าน/รอสถานะไม่สำเร็จจากข้อผิดพลาดภายใน; ใช้ job ID เดิมลอง status ใหม่ภายหลัง |
| `500` | `RESULT_ERROR` | อ่านคลังไม่สำเร็จจากข้อผิดพลาดภายใน; ตรวจ storage แล้วลองอ่านใหม่ |

หาก worker รายงาน `403` จากต้นทางคลิปใน `error` / `lastError` หมายถึงการเข้าถึงคลิปถูกปฏิเสธ เช่น คลิปจำกัดสิทธิ์หรือแหล่งต้นทางบล็อกการดึง การ submit ซ้ำหรือใช้ `force=true` ไม่ได้แก้สิทธิ์เข้าถึง ให้แก้ปัญหาการเข้าถึงต้นทางก่อน
