# Routine API — คู่มือสร้าง workflow ข่าวสำหรับ Codex

API ชุดนี้เป็น facade แยกใต้ `/api/routine` สำหรับเรียกท่อข่าวและคิวข่าวเดิมด้วยคีย์ของ routine โดยเฉพาะ ค่าเริ่มต้นปิด ต้องตั้ง `ROUTINE_API=1` จึงใช้งานได้ การเพิ่ม facade ไม่ใช่การเปิดระบบบน production และเอกสารนี้ไม่ได้สั่ง deploy, merge, เปลี่ยน Vercel env หรือเรียกข่าวจริง

## ขอบเขตและเงื่อนไขสำคัญ

- API ใช้ header `x-routine-key` ซึ่งต้องตรงกับ `ROUTINE_API_KEY` ไม่ใช้ `DISCORD_API_SECRET` หรือ header `x-api-key` ของบอท
- เมื่อปิดสวิตช์ ทุก endpoint ในเอกสารตอบ `404 ROUTINE_API_DISABLED` ก่อนโหลด dependency ของท่อข่าว/ฐานข้อมูล เมื่อเปิดแต่คีย์ไม่ได้ตั้งหรือคีย์ไม่ตรง ตอบ `401 ROUTINE_UNAUTHORIZED`
- เปรียบเทียบคีย์โดยใช้ `timingSafeEqual`; อย่าใส่คีย์ใน URL, source control, แชท, screenshot หรือ log
- งานข่าวเดินผ่านท่อเดิม ผลลัพธ์เป็นฉบับข่าวใน `versions[]`; facade ไม่สร้างหรือสังเคราะห์พิกเซลภาพ และไม่สั่งเผยแพร่ Facebook
- `/news` (รอผล) **ไม่เข้าคลังข่าว (archive)** — ผลอยู่ใน `generation_logs` และ response เท่านั้น; `/jobs` (คิว) เข้าคลังข่าวตามปกติผ่าน worker ให้ Codex เลือกโหมดตามความต้องการเรื่อง archive
- รักษา `TEXT_ONLY_MODE` ของระบบเดิม: ค่าเริ่มต้นรับข้อความล้วน URL จะใช้ได้เมื่อผู้ดูแลตั้ง `TEXT_ONLY_MODE=0` อยู่แล้ว เส้นทาง sync รองรับเฉพาะแขนง Enhanced ที่มี service เดิมให้เรียกโดยตรง หาก input ต้องใช้แขนงอื่นตอบ `400 ROUTINE_UNSUPPORTED_INPUT`; ใช้ queue ได้ตามความสามารถและข้อจำกัดของ worker เดิม
- ใช้ workflow ID รูปแบบ `routine_<routine>_<uuid>` เพื่อระบุแหล่งงาน routine โดย `<routine>` เป็นชื่อที่ส่งมา เช่น `morning-news`
- เวลาจากการวิจัยเดิม: ประมาณ 3 นาทีและประมาณ US$0.8 ต่อข่าวหนึ่งงาน เป็นผลวัดก่อนหน้า ไม่ใช่ SLA ราคาเหมาจ่าย หรือผลทดสอบ deployment นี้
- `POST /results/{caseId}/select` ยังไม่รองรับ ตอบ `501` และไม่เลือกฉบับแทนผู้ใช้

## เริ่มต้นบน Vercel Preview แบบตั้งค่าด้วยมือ

ให้เจ้าของสร้าง Preview ของกิ่งนี้และตั้ง Environment Variables ใน Vercel Dashboard โดยเลือก scope **Preview** เท่านั้นก่อนทดลอง ใช้คีย์ routine ใหม่ที่สร้างด้วยตัวสุ่มแบบเข้ารหัส เก็บใน secret manager และสร้าง deployment ใหม่ตามกระบวนการของ Vercel เพื่อให้ environment ที่เปลี่ยนมีผล อย่าเปิด production เพียงเพราะเพิ่มไฟล์ API สำเร็จแล้ว

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `ROUTINE_API` | ปิดเมื่อไม่ใช่ `1` | สวิตช์เปิด facade |
| `ROUTINE_API_KEY` | ไม่ตั้ง | secret เฉพาะ routine; ไม่ตั้งแล้ว request ที่เปิดสวิตช์ตอบ 401 |
| `ROUTINE_DAILY_USD` | `10` | เพดานยอดเงินต่อวันของ routine key ทั้งหมด |
| `ROUTINE_DAILY_JOBS` | `10` | จำนวนงานที่รับสูงสุดต่อวัน รวมงานที่ล้มเหลวภายหลัง |
| `ROUTINE_EST_USD_PER_JOB` | `1` | เงินสำรองต่อการรับงานหนึ่งครั้ง จนกว่าจะมีต้นทุนจริงจากท่อ |
| `ROUTINE_MAX_CONCURRENT` | `2` | เพดานงาน routine พร้อมกัน รวมงาน sync และงาน queue ที่ยัง pending/processing |
| `ROUTINE_MAX_INPUT_CHARS` | `20000` | เพดานความยาว input; request ต้องมีอย่างน้อย 20 ตัวอักษรหลัง trim |

เพดานนับวันตาม `Asia/Bangkok` (UTC+7) ไม่ใช่ UTC และเป็นเพดานร่วมของ secret เดียว ไม่แยกตามชื่อ routine การตั้งค่าตัวเลขไม่ถูกต้องจะทำให้ request ที่เกี่ยวข้องถูกปฏิเสธด้วย `ROUTINE_CONFIG_INVALID` ควรเริ่มจากค่าที่ต่ำใน Preview

Preview ที่มี Deployment Protection อาจปฏิเสธ request ก่อนถึง route นี้ คีย์ routine ไม่ใช่คีย์ bypass ของ Vercel ให้เจ้าของจัดการการเข้าถึง Preview ด้วยวิธีของโครงการก่อน smoke script นี้ไม่จัดการ deployment หรือส่ง bypass secret ให้

คิวเดิมอาศัย worker/cron ที่มีอยู่ Preview อาจไม่มี cron ทำงาน จึงต้องยืนยันว่ามี worker ที่ได้รับอนุญาตกำลังประมวลผลคิวก่อนทดสอบ async หาก API แสดง `queued` ให้ตรวจ worker; อย่าส่ง POST ซ้ำเพื่อปลุกคิว และอย่าเรียก worker production โดยไม่ได้รับอนุญาต

**แยก Preview ก่อนยิง smoke:** ตรวจฐานข้อมูล/`store_items`, คิว และค่าปลายทางของ worker ว่าแยกจาก production แล้ว พฤติกรรมเดิมของ `QUEUE_SELF_BASE_URL` และ fallback `VERCEL_PROJECT_PRODUCTION_URL` อาจทำให้ worker ที่รันบน Preview ส่งงานต่อไป production ได้ การมี URL Preview เพียงอย่างเดียวจึงไม่ยืนยันว่าเป็นสนามทดสอบแยก ให้เจ้าของตรวจ environment และฐานข้อมูลที่ worker ใช้ด้วย facade นี้ไม่ได้สร้าง worker ใหม่หรือเปลี่ยนค่าปลายทางเดิม

## สัญญา request และ idempotency

`POST /news` กับ `POST /jobs` ใช้ body เหมือนกัน:

```json
{
  "input": "ข่าวดิบหรือ URL ที่มีความยาวอย่างน้อยยี่สิบตัวอักษร",
  "contentLength": "medium",
  "routine": "morning-news",
  "idempotencyKey": "morning-news-2026-09-08-item-001"
}
```

- `input` เป็น string ต้องเหลืออย่างน้อย 20 ตัวอักษรหลัง trim และความยาว string ต้นฉบับต้องไม่เกิน `ROUTINE_MAX_INPUT_CHARS` (ค่าเริ่มต้น 20,000) ไม่รับ object หรือ array แทนข้อความ อีกทั้งจำกัด JSON ที่เข้ารหัสแล้วไม่เกิน `maxInputChars × 6 + 8192` ไบต์
- `contentLength` เป็น `short`, `medium` หรือ `long`; ไม่ส่งเท่ากับ `medium`
- `routine` เป็นฟิลด์บังคับ ใช้อักษร `a-z`, ตัวเลข และ `-` ความยาว 1–40 ตัว ตาม `^[a-z0-9-]{1,40}$` ไม่รับฟิลด์อื่นนอก `input`, `contentLength`, `routine`, `idempotencyKey`
- idempotency เป็น optional แต่ client ที่ใช้งานจริงควรส่งทุกครั้ง ผ่าน header `idempotency-key` (รองรับ header `idempotencyKey` ด้วย) หรือ `idempotencyKey` ใน body ความยาว 1–200 ตัวและต้องไม่เป็น whitespace ล้วน ถ้าส่งทั้ง header และ body ค่าต้องตรงกัน ใช้ key คงที่ต่อ **ข่าวต้นฉบับและงานหนึ่งครั้ง** ห้ามสร้าง key ใหม่ทุก retry
- เก็บ idempotency 24 ชั่วโมง เมื่อ key เดิมกับ payload เดิมเสร็จแล้ว จะคืน reply เดิม (รวม error ที่บันทึกไว้) เมื่อยังทำงานอยู่ตอบ `409 ROUTINE_IN_PROGRESS` เมื่อ key เดิมกับ input/routine/contentLength/endpoint mode ต่างกันตอบ `409 ROUTINE_IDEMPOTENCY_CONFLICT` อย่าใช้ key เดียวกันข้าม `/news` กับ `/jobs`
- การปฏิเสธก่อนรับงานจะปล่อย claim เพื่อให้ retry ด้วย key เดิมได้ ส่วน error หลังรับงานถูกเก็บเป็น reply ของ key นั้น การเพิ่มคิวที่ยังยืนยันไม่ได้อาจบันทึกไปแล้ว: ใช้ key เดิมเพื่อกู้ `jobId` เดิม ไม่ enqueue ซ้ำ
- ข้อยกเว้นอายุ claim: ถ้ายังไม่มี reply/result และอ่าน storage สำเร็จแล้วไม่พบงานคิวรองรับ จะตอบ `409 ROUTINE_IN_PROGRESS` เฉพาะช่วง **20 นาทีจากเวลาสร้าง claim** (นานกว่า pipeline deadline 700 วินาทีและ lease 15 นาที) หลังจากนั้น key เดิมและ payload เดิมแย่ง claim ใหม่ด้วย revision CAS แล้วรับงานใหม่ได้ ครอบคลุม enqueue ล้มเหลวโดยไม่ได้ commit และการปฏิเสธก่อนรับงานที่ลบ claim ไม่สำเร็จ หากอ่าน storage ไม่ได้ยังตอบ 503; หากพบ reply/result หรือ job เดิมยัง replay ของเดิมภายใน 24 ชั่วโมง การรับงานใหม่ยังผ่านเพดานเดิมและไม่คืนโควตาของงานที่เคยรับแล้ว
- เมื่อ HTTP client timeout งานบน server อาจยังทำต่อ ห้ามถือว่าไม่ได้รับงานแล้วเริ่มข่าวใหม่ด้วย key ใหม่ ให้ใช้ key เดิมภายใน 24 ชั่วโมงหรืออ่านสถานะ/ผลก่อน
- เลือกใช้ sync หรือ queue สำหรับข่าวหนึ่งชิ้น การส่งทั้งสอง endpoint เป็นสองงานที่อาจมีค่าใช้จ่ายแยกกัน

## ผลลัพธ์และการคุมค่าใช้จ่าย

ผลข่าวสำเร็จจาก `/news` หรือ `GET /jobs/{jobId}` เมื่อ `done` มี `workflowId`, `versions[]`, `cost`, `timing` และ `pipeline` โดย `caseId` เป็นข้อมูลเสริมเมื่อท่อเดิมส่ง ID กลับมา ไม่ควรอนุมาน `caseId` จาก `workflowId` ส่วน `/results` คืนรายการย่อใน `items[]` ซึ่งไม่มี `success`, `cost`, `timing` หรือ `pipeline` ต่อรายการ

`pipeline` คืนข้อมูลท่อที่ตัดคีย์ขึ้นต้น `_` ออกทุกระดับ รวม `_blackbox`, `_rawModelDraft` และ debug ใน `analysisResult.versions[]`/`versions[]`; คงเนื้อข่าวและหลักฐาน `usedModel` แม้เป็น non-enumerable โดย trim ชื่อโมเดลแบบเดียวกับ `compactDelegatedVersions` ใช้กับผลใหม่และผลเก่าที่อ่านมา replay/poll ด้วย จึงไม่ใช่ legacyData ดิบทั้งก้อน และยังอาจมีข้อความต้นฉบับ/เนื้อข่าวที่ไม่ควร log ทั้ง response

```json
{
  "success": true,
  "workflowId": "routine_morning-news_00000000-0000-4000-8000-000000000001",
  "versions": [
    {
      "index": 0,
      "content": "เนื้อข่าวฉบับที่ระบบสร้าง...",
      "usedModel": "ชื่อโมเดลที่ท่อส่งกลับมา",
      "promptName": "ชื่อพรอมป์ต์",
      "promptSource": "แหล่งพรอมป์ต์",
      "wordCount": 120,
      "paragraphs": 4
    }
  ],
  "cost": { "usd": 1, "estimated": true },
  "timing": { "ms": 180000 },
  "pipeline": {}
}
```

`versions[].index` เริ่มที่ 0 ระบุฉบับ ส่วน `content` คือข้อความข่าว ไม่ควรผูก client กับชื่อโมเดลตายตัว `usedModel`, `promptName`, `promptSource` และข้อมูลความยาวอาจเป็น `null` เมื่อไม่มีต้นทาง `timing.ms` เป็นเวลารวมหน่วยมิลลิวินาที ส่วน `pipeline` เป็น object ระดับบนเก็บข้อมูลท่อเดิม และอาจมีเนื้อข่าว/ข้อมูลต้นฉบับ จึงอย่า log ทั้ง response โดยไม่จำเป็น ไม่รับประกันรายชื่อขั้นตอนตายตัว

หากข่าวสำเร็จแต่เก็บกวาด lease หรือปรับมิเตอร์ยังไม่ครบ API อาจคืน `maintenancePending:true` พร้อมผลสำเร็จ ให้เก็บผลเดิมและแจ้งผู้ดูแล ไม่เริ่มงานข่าวซ้ำเพียงเพราะฟิลด์นี้เป็น true

ค่าใช้จ่ายและ admission ใช้แถว guard `routine_guard_v1` ใน `store_items` ชื่อ store `routine_meter` สำรองเงินและจำนวนงานก่อนรับงาน พร้อมแถว mapping ต่อ job สำหรับ `workflowId`, `caseId` และผลลัพธ์ งานที่รับแล้วล้มเหลวยังใช้โควตาจำนวนงาน เมื่อท่อคืนต้นทุนจริงที่ใช้ได้จะนำมาแทนเงินสำรอง หากไม่มีต้นทุนจริงให้ถือยอดเป็น **ประมาณการ** (`cost.estimated=true`) ไม่ใช่ใบแจ้งหนี้จากผู้ให้บริการ หากต้นทุนจริงเกินประมาณการ ยอดที่รับไปแล้วอาจสูงกว่าเพดานได้; เพดานนี้เป็นการคุมการรับงาน ไม่ได้หยุดการคิดเงินกลางท่อ

การนับพร้อมกันใช้ lease สำหรับ sync อายุ 15 นาทีใน `routine_lease` และนับ async ที่กำลังทำงานจากคิวข่าวเดิม `job_queue` (ภายในมี `pending`, `processing` และสถานะรอ/กู้คืนที่เทียบเท่า) หากตรวจ storage หรือสถานะคิวไม่ได้ ระบบปฏิเสธรับงาน (`503`) แทนการเดาจำนวนงานเป็นศูนย์ การจอง admission ใช้ revision compare-and-swap บน guard กลาง; retry การชนกันสูงสุด 12 ครั้งก่อนตอบ error การอ่าน storage จำกัด 10,000 แถวต่อการอ่าน หากเกินขอบเขตให้ผู้ดูแลตรวจข้อมูล ไม่ fallback เป็นโควตาว่าง

facade ต้องใช้ Supabase ที่พร้อมใช้งานสำหรับการจองแบบ atomic และ fail closed เมื่อยืนยันการบันทึกไม่ได้ ไม่ใช้ cache ในหน่วยความจำแทนมิเตอร์ร่วมหลาย instance การเพิ่ม job เรียก persistence เดิมในรูปแบบ `job_queue`; job มี `userId='discord-bot'` ตามรูปแบบ worker เดิมแต่ payload ไม่ใส่ `userId` การยืนยันตัวตนภายนอกยังใช้ routine key เท่านั้น และไม่เปลี่ยน/เรียก worker โดย facade

อย่าใช้ `api_usage_logs` join กับ workflow โดยเดา: log รุ่นเดิมไม่มี workflow linkage ที่เชื่อถือได้ครบทุกจุด หากต้องตรวจต้นทุนจริง ให้ผู้ดูแลเทียบ usage ตามช่วงเวลากับงานที่รันด้วยมือ และแยกคำว่า actual กับ estimated เสมอ

## Endpoint และตัวอย่าง curl / fetch

ตัวอย่าง shell ด้านล่างใช้ Bash และตัวแปร environment ที่มีอยู่แล้ว; ใน PowerShell ให้ใช้ `curl.exe` และแทนตัวแปรด้วย `$env:ROUTINE_API_KEY` อย่าแทนตัวอย่างด้วยคีย์จริงแล้ว commit ตั้ง `BASE` เป็น origin เช่น `https://YOUR-PREVIEW.vercel.app` โดยไม่มี `/api/routine` ต่อท้าย

```bash
export BASE='https://YOUR-PREVIEW.vercel.app'
# ROUTINE_API_KEY ต้องมาจาก environment/secret manager; ไม่พิมพ์ค่าออกมา
```

สำหรับ JavaScript ตัวอย่างต่อไปนี้ใช้ Node.js 20+ ร่วมกับ helper นี้ ตัวอย่างมี timeout จำกัดและไม่ retry POST:

```js
const base = process.env.ROUTINE_BASE_URL;
const key = process.env.ROUTINE_API_KEY;
if (!base || !key) throw new Error('Missing routine environment');
async function api(path, init = {}) {
  const response = await fetch(`${base}/api/routine${path}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(init.method === 'POST' ? 810000 : 30000),
    headers: {
      'x-routine-key': key,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  const body = await response.json();
  return { status: response.status, body };
}
```

### 1. `GET /api/routine/health`

ตรวจว่าเปิด facade และคีย์ใช้ได้ พร้อมอ่านมิเตอร์และจำนวนงานจาก storage ไม่สร้างข่าวและไม่โหลดบริการสร้างข่าว ไม่ใช่การรับประกันว่า AI provider หรือ worker จะทำงานสำเร็จทุกขั้น เมื่อ storage/queue อ่านไม่ได้ endpoint นี้อาจตอบ 503

คำตอบใช้ `ok` (ไม่ใช่ `success`) พร้อม `enabled`, `keyConfigured`, `caps`, `today`, `estimateUsdPerJob`, `costBasis`, `inFlight` โดย `today` มี `usd`, `jobs`, `estimated`, `date`, `timezone`; `today.estimated=true` เป็นคำเตือนว่ายอดอาจมีเงินสำรองปนอยู่ ไม่ใช่การยืนยันว่าแต่ละรายการเป็นค่าใช้จ่ายจริง

```bash
curl --silent --show-error --max-time 30 \
  --header "x-routine-key: $ROUTINE_API_KEY" \
  "$BASE/api/routine/health"
```

```js
const health = await api('/health');
if (health.status !== 200) throw new Error(health.body.errorType);
```

### 2. `POST /api/routine/news` — รอผลใน request เดียว

เตรียม `request.json` ตามตัวอย่าง body ด้านบน โดยเลือกหนึ่งวิธีส่ง idempotency key ตัวอย่างนี้ใช้ header จึงไม่ต้องใส่ `idempotencyKey` ในไฟล์

```bash
curl --silent --show-error --max-time 810 \
  --request POST --header 'content-type: application/json' \
  --header "x-routine-key: $ROUTINE_API_KEY" \
  --header 'idempotency-key: morning-news-2026-09-08-item-001-sync' \
  --data-binary @request.json "$BASE/api/routine/news"
```

```js
import { readFile } from 'node:fs/promises';
const input = (await readFile('./news.txt', 'utf8')).trim();
const news = await api('/news', {
  method: 'POST',
  headers: { 'idempotency-key': 'morning-news-2026-09-08-item-001-sync' },
  body: JSON.stringify({ input, routine: 'morning-news', contentLength: 'medium' }),
});
if (news.status !== 200) throw new Error(news.body.errorType);
// เก็บ news.body.workflowId และ news.body.versions ในระบบปลายทางที่ได้รับอนุญาต
```

เส้นทาง sync เหมาะกับ client ที่รอ connection ได้นาน route ประกาศ `maxDuration=800` วินาที และ adapter ส่ง pipeline deadline 700 วินาทีลงบริการเดิม ค่าจริงที่ hosting รองรับยังขึ้นกับ deployment/plan request timeout ไม่ใช่คำสั่งยกเลิกงาน AI อย่าตั้ง library ให้ retry POST อัตโนมัติ

### 3. `POST /api/routine/jobs` — รับเข้าคิว

ส่ง input ผ่านคิวข่าวเดิมและคืน `jobId` ใช้ polling endpoint ถัดไป การได้รับ `202` หมายถึงรับงาน ไม่ใช่ข่าวเสร็จแล้ว

```bash
curl --silent --show-error --max-time 30 \
  --request POST --header 'content-type: application/json' \
  --header "x-routine-key: $ROUTINE_API_KEY" \
  --header 'idempotency-key: morning-news-2026-09-08-item-001-queue' \
  --data-binary @request.json "$BASE/api/routine/jobs"
```

```js
const submitted = await api('/jobs', {
  method: 'POST',
  headers: { 'idempotency-key': 'morning-news-2026-09-08-item-001-queue' },
  body: JSON.stringify({ input, routine: 'morning-news', contentLength: 'medium' }),
});
if (submitted.status !== 202) throw new Error(submitted.body.errorType);
const jobId = submitted.body.jobId;
```

### 4. `GET /api/routine/jobs/{jobId}` — ดูสถานะและผลคิว

สถานะ API เป็น `queued`, `running`, `done` หรือ `failed` เมื่อ `done` อ่าน `result` ตามรูปแบบผลข่าว Response ไม่จำเป็นต้องคืน `jobId` ซ้ำ ให้ client เก็บ ID จาก POST ดึงได้เฉพาะงานที่มีทั้ง workflow routine และ admission record ของ facade; job ที่ไม่พบหรือไม่ใช่งาน routine ตอบ `404 ROUTINE_NOT_FOUND`

```bash
curl --silent --show-error --max-time 30 \
  --header "x-routine-key: $ROUTINE_API_KEY" \
  "$BASE/api/routine/jobs/$JOB_ID"
```

```js
import { setTimeout as delay } from 'node:timers/promises';
const deadline = Date.now() + 15 * 60 * 1000;
let finalJob;
for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt += 1) {
  const reply = await api(`/jobs/${encodeURIComponent(jobId)}`);
  if (reply.status !== 200) throw new Error(reply.body.errorType);
  if (reply.body.status === 'failed') throw new Error('ROUTINE_PIPELINE_FAILED');
  if (reply.body.status === 'done') { finalJob = reply.body; break; }
  await delay(15000);
}
if (!finalJob) throw new Error('Polling ended; preserve jobId and check the worker');
const result = finalJob.result;
```

การหมดเวลารอไม่ลบ job และไม่อนุญาตให้เริ่มงานใหม่อัตโนมัติ เก็บ `jobId` ไว้ตรวจต่อภายหลัง แถวคิวที่จบแล้วอาจถูก cleanup ตามระบบเดิมประมาณ 30 นาที facade เก็บ snapshot ผลลง mapping เมื่อมีการ poll หรืออ่าน results หลังแถวคิวถูกลบ status/results ยังอ่าน snapshot ที่เคยเก็บแล้วได้ แต่หากแถวคิวถูกลบก่อนเคยอ่าน ผลอาจกู้คืนไม่ได้และ status ตอบ 404

### 5. `GET /api/routine/results?since=...&limit=50&routine=...`

อ่านผลย้อนหลังที่ facade เชื่อมโยงเป็นงาน routine ได้ ใช้ `since` เป็นเวลา ISO 8601 พร้อม timezone เช่น `2026-09-08T00:00:00+07:00` หรือ `2026-09-07T17:00:00.000Z`; `limit` ค่าเริ่มต้น 50 และสูงสุด 50; `routine` เป็นตัวกรองชื่อ routine ตามรูปแบบเดียวกับ request

```bash
curl --silent --show-error --max-time 30 --get \
  --header "x-routine-key: $ROUTINE_API_KEY" \
  --data-urlencode 'since=2026-09-07T17:00:00.000Z' \
  --data-urlencode 'limit=50' --data-urlencode 'routine=morning-news' \
  "$BASE/api/routine/results"
```

```js
const query = new URLSearchParams({
  since: '2026-09-07T17:00:00.000Z', limit: '50', routine: 'morning-news',
});
const history = await api(`/results?${query}`);
if (history.status !== 200) throw new Error(history.body.errorType);
const results = history.body.items;
```

แต่ละ `items[]` มี `workflowId`, `routine`, `createdAt`, `versions` และ `caseId` เมื่อทราบ เรียงตามเวลารับงานจากใหม่ไปเก่า `since` กรองตามเวลารับงาน ไม่ใช่เวลาที่ข่าวเสร็จ `generation_logs` เดิมไม่มีคอลัมน์ `workflowId`; endpoint นี้อ่าน mapping ใน `routine_meter` และใช้ `caseId` เชื่อม log เมื่อทราบ จึงไม่ใช่ประวัติข่าวทั้งหมด Client ควรเก็บผล sync หรือ `jobId` ที่ได้รับไว้เองด้วย และอย่าใช้ `since` เป็น cursor ที่รับประกันการดึงครบทุกแถวเมื่อมีผลมากกว่า 50 รายการในช่วงเดียวกัน

### 6. `POST /api/routine/results/{caseId}/select` — ยังไม่รองรับ

ตัวอย่างนี้ใช้สำหรับตรวจสัญญา `501` เท่านั้น ไม่มีการเลือกฉบับหรือเปลี่ยนข่าวที่บันทึกแล้ว:

```bash
curl --silent --show-error --max-time 30 --request POST \
  --header 'content-type: application/json' \
  --header "x-routine-key: $ROUTINE_API_KEY" \
  --data '{"index":0}' "$BASE/api/routine/results/$CASE_ID/select"
```

```js
const selection = await api(`/results/${encodeURIComponent(caseId)}/select`, {
  method: 'POST', body: JSON.stringify({ index: 0 }),
});
if (selection.status !== 501 || selection.body.errorType !== 'ROUTINE_NOT_IMPLEMENTED') {
  throw new Error('Unexpected selection contract');
}
```

## Error contract และการตอบสนองของ client

ทุก error ที่ facade จัดการตอบ JSON รูปแบบนี้ โดย error อาจมีข้อมูลเพิ่มเติมที่ไม่ควรใช้เป็นเงื่อนไขแทน `errorType`:

```json
{
  "success": false,
  "error": "ข้อความอธิบายสำหรับคนอ่าน",
  "errorType": "ROUTINE_INVALID_INPUT"
}
```

| HTTP | `errorType` | วิธีจัดการ |
| --- | --- | --- |
| 404 | `ROUTINE_API_DISABLED` | ให้เจ้าของตรวจสวิตช์และ deployment; ไม่ retry งาน |
| 401 | `ROUTINE_UNAUTHORIZED` | ตรวจ secret แยกของ routine; อย่าใช้คีย์ Discord แทน |
| 400 | `ROUTINE_INVALID_JSON`, `ROUTINE_INVALID_REQUEST` | แก้ JSON/body ให้ตรงสัญญา |
| 400 | `ROUTINE_INVALID_INPUT`, `ROUTINE_INVALID_ROUTINE`, `ROUTINE_INVALID_CONTENT_LENGTH` | แก้ input/ชื่อ/ความยาวข่าว |
| 400 | `ROUTINE_INPUT_TOO_LARGE` | ลด input/JSON ให้ไม่เกินค่าที่ตั้งไว้ |
| 400 | `ROUTINE_INVALID_IDEMPOTENCY_KEY` | แก้ key ให้ถูกต้องและสอดคล้องกัน |
| 400 | `ROUTINE_INVALID_QUERY` | ใช้ since ISO, limit 1–50 และชื่อ routine ที่ถูกต้อง |
| 400 | `TEXT_ONLY_MODE`, `GARBLED_INPUT`, `EMPTY_INPUT`, `ROUTINE_UNSUPPORTED_INPUT`, `INVALID_REQUEST_FIELDS` | ตรวจประเภทข้อความและข้อจำกัดท่อเดิม |
| 409 | `ROUTINE_IDEMPOTENCY_CONFLICT` | ห้ามใช้ key เดิมกับข่าวหรือ options ที่เปลี่ยนแล้ว |
| 409 | `ROUTINE_IN_PROGRESS` | งาน key เดิมยังไม่เสร็จ; เก็บ key เดิม รอแบบจำกัดเวลา |
| 429 | `ROUTINE_DAILY_CAP` | หยุดรับข่าวใหม่จนวันไทยถัดไปหรือเจ้าของปรับเพดาน |
| 429 | `ROUTINE_BUSY` | รอให้งานเดิมจบ; ไม่วน retry แบบไม่จำกัด |
| 503 | `ROUTINE_QUEUE_UNAVAILABLE`, `ROUTINE_STORAGE_UNAVAILABLE` | ตรวจ queue/storage; ไม่ bypass guardrail |
| 503 | `ROUTINE_CONFIG_INVALID` | ให้เจ้าของแก้ค่าตัวเลขของ environment |
| 503 | `WORKFLOW_PERSISTENCE_UNAVAILABLE`, `WORKFLOW_INIT_FAILED` | ตรวจการเตรียม workflow ของท่อเดิม |
| 409 | `WORKFLOW_CONTEXT_CONFLICT` | workflow เดิมอ้างอิง input อื่น; ตรวจที่มาของงาน |
| 404 | `ROUTINE_NOT_FOUND` | ตรวจ job/case ID และขอบเขต routine |
| 405 | `ROUTINE_METHOD_NOT_ALLOWED` | ใช้ HTTP method ตาม endpoint |
| 501 | `ROUTINE_NOT_IMPLEMENTED` | การเลือกฉบับยังไม่รองรับ; ห้ามรายงานว่าสำเร็จ |
| 502 | `ROUTINE_PIPELINE_FAILED`, `ROUTINE_RESULT_UNAVAILABLE` | งานข่าวล้มเหลวหรือไม่มีฉบับที่อ่านได้; งานนี้อาจมีต้นทุนแล้ว |
| 504 | `PIPELINE_DEADLINE_EXCEEDED` | ท่อเกินเวลาที่กำหนด; ไม่สร้าง key ใหม่เพื่อ retry ทันที |
| 500 | `ROUTINE_INTERNAL_ERROR` | ข้อผิดพลาดภายในที่ซ่อนรายละเอียด; ให้ผู้ดูแลตรวจ |

ท่อเดิมอาจส่ง `errorType` อักษรใหญ่เพิ่มเติมในกรณี 502 client ต้องรองรับค่าที่ไม่เคยรู้จักและไม่ถือ error ที่ไม่อยู่ในตารางว่าสำเร็จ

ทุก HTTP method ที่ route รับผ่านจะตรวจสวิตช์/คีย์ก่อน ถ้าเปิดและยืนยันตัวตนแล้วใช้ method ผิดจะได้ 405; path routine ที่ไม่รู้จักได้ 404 ตามสัญญา `HEAD` ไม่มี response body เมื่อส่งผ่าน HTTP จริงตามมาตรฐาน จึงอย่า parse JSON จาก HEAD

GET สามารถ retry เมื่อเกิด transport error หรือ 408/429/502/503/504 ได้แบบมีเพดานและหน่วงเวลา ส่วน POST ที่ตอบกลับไม่ครบต้องรักษา idempotency key เดิม เพราะ server อาจทำงานต่อแล้ว

## Smoke ที่ให้มาด้วย

ต้องใช้ Node.js 20+ ไม่มี dependency เพิ่ม `--input-file` เป็นไฟล์ UTF-8 ที่เก็บข่าวดิบอย่างเดียว ไม่ใช่ JSON (URL ต้องผ่าน `TEXT_ONLY_MODE=0` ของระบบเดิม) script อ่าน secret จาก environment เท่านั้น และไม่แสดง secret, เนื้อข่าว หรือ raw error จาก server

```bash
# อ่าน health/results เท่านั้น ไม่รับงานและไม่ใช้ AI
node scripts/routine-smoke.mjs \
  --base https://YOUR-PREVIEW.vercel.app \
  --key-env ROUTINE_API_KEY --mode read-only

# ค่าเริ่มต้น both: health → news หนึ่งงาน → jobs หนึ่งงาน → poll → results
node scripts/routine-smoke.mjs \
  --base https://YOUR-PREVIEW.vercel.app \
  --key-env ROUTINE_API_KEY --input-file ./news.txt

# ทดลอง queue อย่างเดียว พร้อมจำกัดเวลา/จำนวน poll
node scripts/routine-smoke.mjs \
  --base https://YOUR-PREVIEW.vercel.app \
  --key-env ROUTINE_API_KEY --input-file ./news.txt --mode queue \
  --timeout-ms 1200000 --poll-ms 15000 --max-polls 60
```

โหมด `both` รับงานได้สูงสุดสองงาน และอาจมีค่าใช้จ่ายประมาณ US$1.6 ตามค่าที่เคยวัดก่อนหน้า ขณะที่เงินสำรองเริ่มต้นคือ US$2 ไม่ได้คิดเป็นข่าวเดียว script ไม่ยิง POST ซ้ำเอง; GET แต่ละครั้งลองสูงสุด 3 ครั้ง จำกัดเวลารวมเริ่มต้น 20 นาที polling สูงสุด 60 ครั้ง และไม่เรียก select/worker/publication

idempotency key ของ smoke สร้างจาก hash ของ base, input, contentLength และชื่อ routine (`smoke-sync` / `smoke-queue`) การรันซ้ำด้วยข้อมูลเดิมภายใน 24 ชั่วโมงจึงใช้ key เดิม แต่อาจได้ `409 ROUTINE_IN_PROGRESS` และหยุดอย่างชัดเจน การเปลี่ยน input/options/base หรือรอเกิน 24 ชั่วโมงอาจรับงานใหม่และมีค่าใช้จ่ายใหม่ การหมดเวลาของ smoke ไม่ใช่การยกเลิกงานที่ server รับไปแล้ว

ตรวจ syntax แบบไม่เรียกเครือข่าย:

```bash
node --check scripts/routine-smoke.mjs
node scripts/routine-smoke.mjs --help
```

การตรวจฝั่ง client ใน change นี้: `node --check` และ `--help` ผ่าน, OpenAPI YAML parse ได้ครบ 6 paths และ smoke กับ mock HTTP บน localhost ผ่านทั้ง sync/queue, key เดิมเมื่อรันซ้ำ, POST ที่ล้มเหลวไม่ retry, ไม่มี secret ใน output และโหมด read-only ไม่มี POST ผลเหล่านี้ไม่ใช่การทดสอบ AI หรือ Preview จริง ให้ใช้ผล validator/build/test ของ change ประกอบก่อนเปิดใช้งาน

## ปิดระบบและ rollback

1. ปิดด้วยการลบ `ROUTINE_API` (หรือตั้งให้ไม่ใช่ `1`) จาก scope ที่เปิดไว้ แล้วทำให้ deployment ที่ให้บริการโหลด environment ใหม่ตามขั้นตอน Vercel การลบ env ใน Dashboard อย่างเดียวไม่ได้เปลี่ยน process/deployment ที่ใช้ค่าเก่าอยู่แล้วทันที
2. ตรวจ `GET /api/routine/health` ของ deployment ที่ใช้งานจริงว่าเป็น `404 ROUTINE_API_DISABLED` ปิดหรือจำกัดการเข้าถึง deployment เก่าที่เคยเปิดสวิตช์ด้วย
3. การปิด admission ไม่หยุดงาน AI หรือ job queue ที่รับไปก่อนหน้า ให้ตรวจสถานะงานค้างผ่านวิธีของระบบเดิมที่ผู้ดูแลได้รับอนุญาต
4. หากต้องเพิกถอนคีย์ ให้ลบ/หมุน `ROUTINE_API_KEY` และอัปเดต deployment ตามขั้นตอนเดียวกัน อย่าแก้คีย์บอทเพื่อปิด routine
5. โค้ด facade ถูกเพิ่มเป็นไฟล์ใหม่ การ rollback ให้ revert เฉพาะชุดไฟล์ routine ที่เพิ่มใน change นี้ ไม่แตะท่อข่าวเดิมและไม่ลบข้อมูลข่าวเดิมเพื่อ rollback

## OpenAPI 3.1

บล็อก YAML ต่อไปนี้คือสัญญา API สำหรับ client generator สามารถคัดลอกเป็น `.yaml` ได้ ใช้ response ที่ยอมให้มี metadata เพิ่มเพื่อรองรับท่อเดิม ช่อง `caseId` เป็น optional และ `pipeline` ไม่บังคับชื่อขั้นตอน Error type เปิดให้ท่อเดิมส่งชื่อเพิ่มได้

```yaml
openapi: 3.1.0
info:
  title: Viral Content System Routine API
  version: 1.0.0
  description: >-
    Facade for the existing news pipeline. Disabled unless ROUTINE_API=1.
    Uses a separate routine API key. Does not publish or select a final version.
servers:
  - url: /api/routine
security:
  - RoutineKey: []
paths:
  /health:
    get:
      operationId: routineHealth
      summary: ตรวจสวิตช์และการยืนยันตัวตน
      responses:
        '200':
          description: Facade enabled and authenticated; not a provider readiness probe
          content:
            application/json:
              schema:
                type: object
                required: [ok, enabled, keyConfigured, caps, today, estimateUsdPerJob, costBasis, inFlight]
                properties:
                  ok: { const: true }
                  enabled: { const: true }
                  keyConfigured: { const: true }
                  caps:
                    type: object
                    required: [dailyUsd, dailyJobs, maxConcurrent]
                    properties:
                      dailyUsd: { type: number, minimum: 0 }
                      dailyJobs: { type: integer, minimum: 0 }
                      maxConcurrent: { type: integer, minimum: 0 }
                  today:
                    type: object
                    required: [usd, jobs, estimated, date, timezone]
                    properties:
                      usd: { type: number, minimum: 0 }
                      jobs: { type: integer, minimum: 0 }
                      estimated: { const: true }
                      date: { type: string, format: date }
                      timezone: { const: Asia/Bangkok }
                  estimateUsdPerJob: { type: number, exclusiveMinimum: 0 }
                  costBasis: { type: string }
                  inFlight: { type: integer, minimum: 0 }
                additionalProperties: true
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/DisabledOrNotFound' }
        default: { $ref: '#/components/responses/Error' }
  /news:
    post:
      operationId: createRoutineNews
      summary: สร้างข่าวและรอผล
      parameters:
        - { $ref: '#/components/parameters/IdempotencyKey' }
      requestBody: { $ref: '#/components/requestBodies/NewsInput' }
      responses:
        '200':
          description: Completed news result or replay of the same request
          content:
            application/json:
              schema: { $ref: '#/components/schemas/NewsResult' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/DisabledOrNotFound' }
        '409': { $ref: '#/components/responses/Conflict' }
        '429': { $ref: '#/components/responses/Capacity' }
        '502': { $ref: '#/components/responses/PipelineFailed' }
        '503': { $ref: '#/components/responses/Unavailable' }
        '504': { $ref: '#/components/responses/Deadline' }
        default: { $ref: '#/components/responses/Error' }
  /jobs:
    post:
      operationId: submitRoutineJob
      summary: ส่งข่าวเข้าคิวเดิม
      parameters:
        - { $ref: '#/components/parameters/IdempotencyKey' }
      requestBody: { $ref: '#/components/requestBodies/NewsInput' }
      responses:
        '202':
          description: Accepted into the existing news queue
          content:
            application/json:
              schema: { $ref: '#/components/schemas/JobAccepted' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/DisabledOrNotFound' }
        '409': { $ref: '#/components/responses/Conflict' }
        '429': { $ref: '#/components/responses/Capacity' }
        '503': { $ref: '#/components/responses/Unavailable' }
        default: { $ref: '#/components/responses/Error' }
  /jobs/{jobId}:
    get:
      operationId: getRoutineJob
      summary: ดูสถานะและผลของงาน routine
      parameters:
        - name: jobId
          in: path
          required: true
          schema: { type: string, minLength: 1 }
      responses:
        '200':
          description: Status; result is present when status is done
          content:
            application/json:
              schema: { $ref: '#/components/schemas/JobStatus' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/DisabledOrNotFound' }
        '503': { $ref: '#/components/responses/Unavailable' }
        default: { $ref: '#/components/responses/Error' }
  /results:
    get:
      operationId: listRoutineResults
      summary: อ่านผลย้อนหลังที่เชื่อมโยงกับ routine ได้
      parameters:
        - name: since
          in: query
          required: false
          schema: { type: string, format: date-time }
          description: ISO 8601 time with timezone; not a pagination cursor
        - name: limit
          in: query
          required: false
          schema: { type: integer, minimum: 1, maximum: 50, default: 50 }
        - name: routine
          in: query
          required: false
          schema: { $ref: '#/components/schemas/RoutineName' }
      responses:
        '200':
          description: Available routine results; legacy log linkage may be incomplete
          content:
            application/json:
              schema:
                type: object
                required: [success, items]
                properties:
                  success: { const: true }
                  items:
                    type: array
                    maxItems: 50
                    items: { $ref: '#/components/schemas/ResultItem' }
                additionalProperties: true
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/DisabledOrNotFound' }
        '503': { $ref: '#/components/responses/Unavailable' }
        default: { $ref: '#/components/responses/Error' }
  /results/{caseId}/select:
    post:
      operationId: selectRoutineResult
      summary: Reserved endpoint; currently always returns 501 after authorization
      parameters:
        - name: caseId
          in: path
          required: true
          schema: { type: string, minLength: 1 }
      requestBody:
        required: false
        content:
          application/json:
            schema:
              type: object
              properties:
                index: { type: integer, minimum: 0 }
              additionalProperties: true
      responses:
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/DisabledOrNotFound' }
        '501':
          description: ROUTINE_NOT_IMPLEMENTED; no selection is performed
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ApiError' }
        default: { $ref: '#/components/responses/Error' }
components:
  securitySchemes:
    RoutineKey:
      type: apiKey
      in: header
      name: x-routine-key
      description: Separate ROUTINE_API_KEY; never the Discord key
  parameters:
    IdempotencyKey:
      name: idempotency-key
      in: header
      required: false
      schema: { type: string, minLength: 1, maxLength: 200 }
      description: >-
        Stable key for one input and options set; alternatively use body
        idempotencyKey (or header idempotencyKey). Must not be all whitespace.
        Header and body must match if both supplied. Retained 24h, including
        admitted failures. Pre-admission rejection releases the key claim.
        A claim without a reply/result or backing queue job can be replaced
        atomically after 20 minutes from claim creation. Failed storage reads
        return 503; existing replies/results/jobs still replay within 24h.
        Changed input, options or endpoint mode returns 409.
  requestBodies:
    NewsInput:
      required: true
      content:
        application/json:
          schema: { $ref: '#/components/schemas/NewsInput' }
  schemas:
    RoutineName:
      type: string
      minLength: 1
      maxLength: 40
      pattern: '^[a-z0-9-]{1,40}$'
      example: morning-news
    NewsInput:
      type: object
      required: [input, routine]
      properties:
        input:
          type: string
          minLength: 20
          maxLength: 20000
          description: >-
            Raw article, or URL only when existing TEXT_ONLY_MODE=0 permits it.
            Minimum is checked after trim; maximum against the original string.
            Deployment input cap may differ from the 20000-character default.
        contentLength:
          type: string
          enum: [short, medium, long]
          default: medium
        routine: { $ref: '#/components/schemas/RoutineName' }
        idempotencyKey:
          type: string
          minLength: 1
          maxLength: 200
      additionalProperties: false
    NewsVersion:
      type: object
      required: [index, content, usedModel, promptName, promptSource, wordCount, paragraphs]
      properties:
        index: { type: integer, minimum: 0 }
        content: { type: string }
        usedModel: { type: [string, 'null'] }
        promptName: { type: [string, 'null'] }
        promptSource: { type: [string, 'null'] }
        wordCount: { type: [integer, 'null'], minimum: 0 }
        paragraphs: { type: [integer, 'null'], minimum: 0 }
      additionalProperties: true
    Cost:
      type: object
      required: [usd, estimated]
      properties:
        usd: { type: number, minimum: 0 }
        estimated:
          type: boolean
          description: True when based on reservation instead of a reported actual cost
      additionalProperties: true
    Timing:
      type: object
      required: [ms]
      properties:
        ms: { type: number, minimum: 0 }
      additionalProperties: true
    PublicJsonValue:
      description: JSON value with keys starting with underscore removed recursively
      anyOf:
        - type: ['null', boolean, number, string]
        - type: array
          items: { $ref: '#/components/schemas/PublicJsonValue' }
        - type: object
          propertyNames:
            not: { pattern: '^_' }
          additionalProperties: { $ref: '#/components/schemas/PublicJsonValue' }
    NewsResult:
      type: object
      required: [success, workflowId, versions, cost, timing, pipeline]
      properties:
        success: { const: true }
        workflowId:
          type: string
          pattern: '^routine_[a-z0-9-]{1,40}_'
        caseId: { type: string }
        versions:
          type: array
          minItems: 1
          items: { $ref: '#/components/schemas/NewsVersion' }
        cost: { $ref: '#/components/schemas/Cost' }
        timing: { $ref: '#/components/schemas/Timing' }
        pipeline:
          type: object
          description: >-
            Compacted pipeline data, including nested versions. All keys starting
            with underscore are removed; usedModel writer provenance is retained
            and trimmed even when non-enumerable. May still contain source text
            and generated content. Applies to fresh and replayed results.
          propertyNames:
            not: { pattern: '^_' }
          additionalProperties: { $ref: '#/components/schemas/PublicJsonValue' }
        maintenancePending:
          type: boolean
          description: Result succeeded; lease or meter maintenance still needs reconciliation
      additionalProperties: true
    ResultItem:
      type: object
      required: [workflowId, routine, createdAt, versions]
      properties:
        caseId: { type: string }
        workflowId: { type: string }
        routine: { $ref: '#/components/schemas/RoutineName' }
        createdAt:
          type: string
          format: date-time
          description: Admission time, not completion time
        versions:
          type: array
          items: { $ref: '#/components/schemas/NewsVersion' }
      additionalProperties: true
    JobAccepted:
      type: object
      required: [success, jobId, workflowId]
      properties:
        success: { const: true }
        jobId: { type: string }
        workflowId: { type: string }
      additionalProperties: true
    JobStatus:
      type: object
      required: [success, status]
      properties:
        success: { const: true }
        status: { type: string, enum: [queued, running, done, failed] }
        result: { $ref: '#/components/schemas/NewsResult' }
        error: { type: [string, 'null'] }
        errorType: { type: string }
      additionalProperties: true
    ApiError:
      type: object
      required: [success, error, errorType]
      properties:
        success: { const: false }
        error: { type: string }
        errorType:
          type: string
          description: Known names below; additional uppercase errors can pass through from the existing pipeline
          examples:
            - ROUTINE_API_DISABLED
            - ROUTINE_UNAUTHORIZED
            - ROUTINE_DAILY_CAP
            - ROUTINE_BUSY
            - ROUTINE_INPUT_TOO_LARGE
            - ROUTINE_INVALID_INPUT
            - ROUTINE_INVALID_ROUTINE
            - ROUTINE_INVALID_CONTENT_LENGTH
            - ROUTINE_INVALID_JSON
            - ROUTINE_INVALID_REQUEST
            - ROUTINE_INVALID_IDEMPOTENCY_KEY
            - ROUTINE_IDEMPOTENCY_CONFLICT
            - ROUTINE_IN_PROGRESS
            - ROUTINE_QUEUE_UNAVAILABLE
            - ROUTINE_STORAGE_UNAVAILABLE
            - ROUTINE_NOT_FOUND
            - ROUTINE_NOT_IMPLEMENTED
            - ROUTINE_PIPELINE_FAILED
            - ROUTINE_INVALID_QUERY
            - ROUTINE_CONFIG_INVALID
            - ROUTINE_METHOD_NOT_ALLOWED
            - ROUTINE_INTERNAL_ERROR
            - ROUTINE_RESULT_UNAVAILABLE
            - ROUTINE_UNSUPPORTED_INPUT
            - TEXT_ONLY_MODE
            - GARBLED_INPUT
            - EMPTY_INPUT
            - INVALID_REQUEST_FIELDS
            - WORKFLOW_PERSISTENCE_UNAVAILABLE
            - WORKFLOW_INIT_FAILED
            - WORKFLOW_CONTEXT_CONFLICT
            - PIPELINE_DEADLINE_EXCEEDED
      additionalProperties: true
  responses:
    Error:
      description: Structured facade error
      content:
        application/json:
          schema: { $ref: '#/components/schemas/ApiError' }
    Unauthorized:
      description: ROUTINE_UNAUTHORIZED
      content:
        application/json:
          schema: { $ref: '#/components/schemas/ApiError' }
    DisabledOrNotFound:
      description: ROUTINE_API_DISABLED or ROUTINE_NOT_FOUND
      content:
        application/json:
          schema: { $ref: '#/components/schemas/ApiError' }
    BadRequest:
      description: Invalid/oversized JSON or input, routine, content length, query, key or unsupported input type
      content:
        application/json:
          schema: { $ref: '#/components/schemas/ApiError' }
    Conflict:
      description: ROUTINE_IDEMPOTENCY_CONFLICT, ROUTINE_IN_PROGRESS or WORKFLOW_CONTEXT_CONFLICT
      content:
        application/json:
          schema: { $ref: '#/components/schemas/ApiError' }
    Capacity:
      description: ROUTINE_DAILY_CAP or ROUTINE_BUSY
      content:
        application/json:
          schema: { $ref: '#/components/schemas/ApiError' }
    PipelineFailed:
      description: ROUTINE_PIPELINE_FAILED, ROUTINE_RESULT_UNAVAILABLE or legacy pipeline error; costs may be incurred
      content:
        application/json:
          schema: { $ref: '#/components/schemas/ApiError' }
    Unavailable:
      description: Routine queue/storage/config unavailable or legacy workflow persistence initialization failure
      content:
        application/json:
          schema: { $ref: '#/components/schemas/ApiError' }
    Deadline:
      description: PIPELINE_DEADLINE_EXCEEDED; request timeout does not guarantee provider cancellation
      content:
        application/json:
          schema: { $ref: '#/components/schemas/ApiError' }
```

## หลักฐานการตรวจในเครื่อง 8 กันยายน 2569

ฐาน `a313281c23c0fb5b129376ea545518152fa4219d`, กิ่ง `feat/routine-api`, Node `v24.15.0`, Next.js `16.2.6` ผู้บัญชาการจัด node_modules เป็นสำเนาจริงแล้ว ผล build ของผู้บัญชาการและ Fable เป็น exit 0 ทั้งคู่ ตัวเลข 57 เทสและ mutation 6 ตัวด้านล่างเป็นหลักฐานรอบแรกก่อนแก้ findings; รอบแก้เริ่มจาก `3912ce67` บนกิ่ง preview ที่ผู้บัญชาการ push แล้ว ผู้แก้ไม่ได้ install/ci, push, deploy หรือทดสอบ AI/ฐานข้อมูลจริง

**ผลรอบแก้ findings จาก `3912ce67`:** เทสเพิ่ม 5 ตัวครอบคลุม M2 และ L2 พร้อมปรับ assertion เดิมให้ตรวจค่า JSON หลัง compact แทน object identity; mutation ถอดการแก้จาก source จริงทีละข้อและคืนไฟล์ด้วย SHA256 ตรงกันก่อนทดสอบชุดรวม

```text
$ node --test tests/routine-*.test.mjs
ℹ tests 62
ℹ pass 62
ℹ fail 0
exit 0

M2 mutation: ถอดเงื่อนไขหมดอายุ pending claim 20 นาที
# tests 3 / # pass 0 / # fail 3 / exit 1
ERR_ASSERTION: M2_UNCOMMITTED; M2_REJECTED (409 !== 200, 409 !== 202)
L2 mutation: เปลี่ยน compactResponse ให้คืนข้อมูลเดิม
# tests 2 / # pass 0 / # fail 2 / exit 1
ERR_ASSERTION: L2_INTERNAL_KEY: _blackbox

$ npx next build
▲ Next.js 16.2.6 (Turbopack)
Turbopack build encountered 14 warnings:
✓ Compiled successfully in 5.2s
✓ Generating static pages using 23 workers (134/134) in 476ms
exit 0
```

รอบ build นี้รันคำสั่งเดิมด้วยสิทธิ์อ่าน path dependency ที่ sandbox จำกัด โดยไม่แก้ config หรือ dependency; scoped ESLint ผ่าน exit 0 และ validator ผ่าน 67/68 exit 0 ตามข้อยกเว้นเดิม ผล 57 เทสที่เหลือด้านล่างเป็นบันทึกรอบแรก

- เทสรวม: **57/57 ผ่าน**, exit 0; off-parity ทดสอบ route จริงทั้ง 7 route × 7 methods พร้อม import sentinel และตรวจซ้ำใน process ใหม่
- Mutation: baseline 6/6 ผ่าน exit 0; mutation 6/6 ถูกตรวจจับด้วย `ERR_ASSERTION` ที่ตรงเป้าหมาย exit 1 (แต่ละตัวอีก 5 contracts ผ่าน) ไม่ถือ syntax/import error ว่าฆ่า mutation ได้
- Validator: exit 0, ผ่าน 67/68 (99%); ข้อเดียวที่ไม่ผ่านคือ OPENAI_API_KEY ไม่ตั้ง ตามข้อยกเว้นภาคผนวกรอบ 2
- **Build ผ่าน** `npx next build` exit 0 ทั้งของผู้บัญชาการและ Fable; มี route `/api/routine` ครบ 7 route
- Scoped ESLint ผ่าน exit 0 ไม่มี warning/error; smoke syntax exit 0
- OpenAPI YAML parse 6 paths และ JSON Schema ตรวจผ่าน; smoke syntax/help และ localhost mock ผ่าน รวมตรวจ POST ไม่ retry และไม่พิมพ์ secret
- การอ่าน storage ใช้ keyset pagination จนได้หน้าว่าง จำกัด 10,000 แถวและ 100 หน้า; ข้อมูลไม่ครบ/รูปแบบผิดปฏิเสธ 503
- `git diff a313281c --stat -- <path ข่าว>` ว่าง; ไม่เปลี่ยนไฟล์เดิม รวม .env.example; env ทั้ง 8 ตัวข้างต้นเป็นสัญญาใหม่ใน facade/เอกสาร ไม่ได้ตั้งค่า env จริง

| Mutation | ผลดิบ assertion | Child exit | ผล |
| --- | --- | --- | --- |
| ถอดสวิตช์ | 200 !== 404 | 1 | KILLED |
| ถอด auth | 200 !== 401 | 1 | KILLED |
| ถอดเพดานเงิน | 202 !== 429 | 1 | KILLED |
| ถอดเพดานพร้อมกัน | actual [202,202], expected [202,429] | 1 | KILLED |
| ถอดตัวกรอง workflow prefix | 200 !== 404 | 1 | KILLED |
| ถอด idempotency | 2 !== 1 | 1 | KILLED |

หลักฐาน build ปัจจุบันจากรายงาน Fable และผล validator (ข้อ OPENAI_API_KEY เป็นข้อยกเว้น environment ที่ผู้บัญชาการยอมรับ):

```text
$ npx next build
exit 0 · route /api/routine ครบ 7 ใน .next

$ node scripts/validate-workflow.mjs
Total checks: 68
✅ Passed: 67
❌ Failed: 1
Score: 99%
1. OPENAI_API_KEY — ต้องมี — ระบบหลักใช้ GPT-4o
⚠️ Minor issues found but score 99% >= 95% — Proceeding with deploy
exit 0
```

ข้อความ “Proceeding with deploy” เป็น output เดิมของ validator เท่านั้น งานแก้ findings นี้ไม่ได้ deploy

ข้อจำกัดที่ต้องตรวจบน Preview: ยังไม่ยืนยัน DB schema/RLS/PostgREST ที่ deploy จริง ไม่ได้รัน worker/ข่าวจริง; queue ที่ถูกล้างก่อน facade poll เก็บ snapshot อาจอ่านผลไม่ได้; service เดิมไม่มี workflowId ใน generation_logs จึงเก็บความสัมพันธ์ caseId ใน routine_meter; การปิดสวิตช์หยุดรับงานใหม่แต่ไม่ยกเลิกงานที่รับไปแล้วหรือ worker เดิม; ส่วน select ยังคง 501 ตามคำตัดสิน และ sync รับเฉพาะแขนงที่มี service ให้เรียกตรงตามสัญญาเดิม

<details>
<summary>ผลดิบ node --test --test-reporter=tap tests/routine-*.test.mjs (exit 0)</summary>

```text
TAP version 13
# Subtest: Thai accounting day changes exactly at 17:00 UTC; actual cost requires explicit unestimated numeric cost
ok 1 - Thai accounting day changes exactly at 17:00 UTC; actual cost requires explicit unestimated numeric cost
  ---
  duration_ms: 1.5432
  type: 'test'
  ...
# Subtest: simultaneous async admissions enforce shared CAS concurrency and daily caps
ok 2 - simultaneous async admissions enforce shared CAS concurrency and daily caps
  ---
  duration_ms: 23.2203
  type: 'test'
  ...
# Subtest: queued and running routine jobs count together while expired sync leases are excluded
ok 3 - queued and running routine jobs count together while expired sync leases are excluded
  ---
  duration_ms: 0.9794
  type: 'test'
  ...
# Subtest: sync pipeline receives unmodified input and expected mode; cost settlement and lease release are durable
ok 4 - sync pipeline receives unmodified input and expected mode; cost settlement and lease release are durable
  ---
  duration_ms: 2.0795
  type: 'test'
  ...
# Subtest: async enqueue preserves bot payload defaults and every retry resolves to the same job
ok 5 - async enqueue preserves bot payload defaults and every retry resolves to the same job
  ---
  duration_ms: 2.8157
  type: 'test'
  ...
# Subtest: uncertain async write retains its receipt and idempotency key recovers a committed job without another enqueue
ok 6 - uncertain async write retains its receipt and idempotency key recovers a committed job without another enqueue
  ---
  duration_ms: 1.0051
  type: 'test'
  ...
# Subtest: health is read-only; persistence failures stop admission before enqueue or pipeline execution
ok 7 - health is read-only; persistence failures stop admission before enqueue or pipeline execution
  ---
  duration_ms: 0.7899
  type: 'test'
  ...
# Subtest: foreign queue jobs and nonfacade routine ids are excluded from status and results
ok 8 - foreign queue jobs and nonfacade routine ids are excluded from status and results
  ---
  duration_ms: 1.7882
  type: 'test'
  ...
# Subtest: sync pipeline errors release their lease and retain conservative daily charge
ok 9 - sync pipeline errors release their lease and retain conservative daily charge
  ---
  duration_ms: 0.9523
  type: 'test'
  ...
# Subtest: successful sync result survives a transient settlement failure and remains replayable
ok 10 - successful sync result survives a transient settlement failure and remains replayable
  ---
  duration_ms: 1.8661
  type: 'test'
  ...
# Subtest: malformed live-lease state fails closed instead of admitting work with unknown concurrency
ok 11 - malformed live-lease state fails closed instead of admitting work with unknown concurrency
  ---
  duration_ms: 0.4338
  type: 'test'
  ...
# Subtest: persistent CAS contention has a finite admission retry limit and never starts work
ok 12 - persistent CAS contention has a finite admission retry limit and never starts work
  ---
  duration_ms: 0.7391
  type: 'test'
  ...
# Subtest: a lease-release error does not prevent settlement or erase successful sync content
ok 13 - a lease-release error does not prevent settlement or erase successful sync content
  ---
  duration_ms: 0.6858
  type: 'test'
  ...
# Subtest: an uncertain result write is reconciled without replacing already committed success with an error
ok 14 - an uncertain result write is reconciled without replacing already committed success with an error
  ---
  duration_ms: 1.0494
  type: 'test'
  ...
# Subtest: malformed daily accounting counters fail closed
ok 15 - malformed daily accounting counters fail closed
  ---
  duration_ms: 0.3757
  type: 'test'
  ...
# Subtest: completed owned jobs expose stored versions, settle actual cost once, and filter result listings
ok 16 - completed owned jobs expose stored versions, settle actual cost once, and filter result listings
  ---
  duration_ms: 1.6059
  type: 'test'
  ...
# Subtest: mutation baseline: all six guard contracts pass unchanged production source
ok 17 - mutation baseline: all six guard contracts pass unchanged production source
  ---
  duration_ms: 132.1031
  type: 'test'
  ...
# baseline: child exit=0, signal=none
# child TAP | TAP version 13
# child TAP | \# Subtest: switch gate denies disabled requests before loading runtime
# child TAP | ok 1 - switch gate denies disabled requests before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 16.5169
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: auth gate denies incorrect keys before loading runtime
# child TAP | ok 2 - auth gate denies incorrect keys before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 0.6636
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: daily budget rejects an unaffordable reservation before enqueue
# child TAP | ok 3 - daily budget rejects an unaffordable reservation before enqueue
# child TAP |   ---
# child TAP |   duration_ms: 3.6812
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: concurrency reservation admits only one simultaneous submission
# child TAP | ok 4 - concurrency reservation admits only one simultaneous submission
# child TAP |   ---
# child TAP |   duration_ms: 2.1348
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP | ok 5 - workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP |   ---
# child TAP |   duration_ms: 0.707
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: idempotency replay does not execute a second news generation
# child TAP | ok 6 - idempotency replay does not execute a second news generation
# child TAP |   ---
# child TAP |   duration_ms: 1.3313
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | 1..6
# child TAP | \# tests 6
# child TAP | \# suites 0
# child TAP | \# pass 6
# child TAP | \# fail 0
# child TAP | \# cancelled 0
# child TAP | \# skipped 0
# child TAP | \# todo 0
# child TAP | \# duration_ms 32.0016
# Subtest: mutation killed: remove feature switch gate
ok 18 - mutation killed: remove feature switch gate
  ---
  duration_ms: 99.6039
  type: 'test'
  ...
# remove feature switch gate: child exit=1, signal=none
# child TAP | TAP version 13
# child TAP | \# Subtest: switch gate denies disabled requests before loading runtime
# child TAP | not ok 1 - switch gate denies disabled requests before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 16.1667
# child TAP |   type: 'test'
# child TAP |   location: 'C:\\\\tmp\\\\news-routine-api\\\\[eval1]:96:1'
# child TAP |   failureType: 'testCodeFailure'
# child TAP |   error: |-
# child TAP |     GUARD_SWITCH
# child TAP |
# child TAP |     200 !== 404
# child TAP |
# child TAP |   code: 'ERR_ASSERTION'
# child TAP |   name: 'AssertionError'
# child TAP |   expected: 404
# child TAP |   actual: 200
# child TAP |   operator: 'strictEqual'
# child TAP |   stack: |-
# child TAP |     TestContext.<anonymous> (file:///C:/tmp/news-routine-api/[eval1]:99:10)
# child TAP |     async Test.run (node:internal/test_runner/test:1208:7)
# child TAP |     async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3)
# child TAP |   ...
# child TAP | \# Subtest: auth gate denies incorrect keys before loading runtime
# child TAP | ok 2 - auth gate denies incorrect keys before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 0.9441
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: daily budget rejects an unaffordable reservation before enqueue
# child TAP | ok 3 - daily budget rejects an unaffordable reservation before enqueue
# child TAP |   ---
# child TAP |   duration_ms: 2.2979
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: concurrency reservation admits only one simultaneous submission
# child TAP | ok 4 - concurrency reservation admits only one simultaneous submission
# child TAP |   ---
# child TAP |   duration_ms: 2.1719
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP | ok 5 - workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP |   ---
# child TAP |   duration_ms: 0.5974
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: idempotency replay does not execute a second news generation
# child TAP | ok 6 - idempotency replay does not execute a second news generation
# child TAP |   ---
# child TAP |   duration_ms: 1.4749
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | 1..6
# child TAP | \# tests 6
# child TAP | \# suites 0
# child TAP | \# pass 5
# child TAP | \# fail 1
# child TAP | \# cancelled 0
# child TAP | \# skipped 0
# child TAP | \# todo 0
# child TAP | \# duration_ms 29.8175
# KILLED GUARD_SWITCH: targeted assertion failed; child exit=1; remaining contracts passed=5.
# Subtest: mutation killed: remove API key authentication gate
ok 19 - mutation killed: remove API key authentication gate
  ---
  duration_ms: 97.6987
  type: 'test'
  ...
# remove API key authentication gate: child exit=1, signal=none
# child TAP | TAP version 13
# child TAP | \# Subtest: switch gate denies disabled requests before loading runtime
# child TAP | ok 1 - switch gate denies disabled requests before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 16.3191
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: auth gate denies incorrect keys before loading runtime
# child TAP | not ok 2 - auth gate denies incorrect keys before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 2.2046
# child TAP |   type: 'test'
# child TAP |   location: 'C:\\\\tmp\\\\news-routine-api\\\\[eval1]:103:1'
# child TAP |   failureType: 'testCodeFailure'
# child TAP |   error: |-
# child TAP |     GUARD_AUTH
# child TAP |
# child TAP |     200 !== 401
# child TAP |
# child TAP |   code: 'ERR_ASSERTION'
# child TAP |   name: 'AssertionError'
# child TAP |   expected: 401
# child TAP |   actual: 200
# child TAP |   operator: 'strictEqual'
# child TAP |   stack: |-
# child TAP |     TestContext.<anonymous> (file:///C:/tmp/news-routine-api/[eval1]:106:10)
# child TAP |     async Test.run (node:internal/test_runner/test:1208:7)
# child TAP |     async Test.processPendingSubtests (node:internal/test_runner/test:831:7)
# child TAP |   ...
# child TAP | \# Subtest: daily budget rejects an unaffordable reservation before enqueue
# child TAP | ok 3 - daily budget rejects an unaffordable reservation before enqueue
# child TAP |   ---
# child TAP |   duration_ms: 2.3826
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: concurrency reservation admits only one simultaneous submission
# child TAP | ok 4 - concurrency reservation admits only one simultaneous submission
# child TAP |   ---
# child TAP |   duration_ms: 1.9878
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP | ok 5 - workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP |   ---
# child TAP |   duration_ms: 0.7037
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: idempotency replay does not execute a second news generation
# child TAP | ok 6 - idempotency replay does not execute a second news generation
# child TAP |   ---
# child TAP |   duration_ms: 1.4846
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | 1..6
# child TAP | \# tests 6
# child TAP | \# suites 0
# child TAP | \# pass 5
# child TAP | \# fail 1
# child TAP | \# cancelled 0
# child TAP | \# skipped 0
# child TAP | \# todo 0
# child TAP | \# duration_ms 31.7791
# KILLED GUARD_AUTH: targeted assertion failed; child exit=1; remaining contracts passed=5.
# Subtest: mutation killed: remove daily budget admission guard
ok 20 - mutation killed: remove daily budget admission guard
  ---
  duration_ms: 97.8431
  type: 'test'
  ...
# remove daily budget admission guard: child exit=1, signal=none
# child TAP | TAP version 13
# child TAP | \# Subtest: switch gate denies disabled requests before loading runtime
# child TAP | ok 1 - switch gate denies disabled requests before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 16.6986
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: auth gate denies incorrect keys before loading runtime
# child TAP | ok 2 - auth gate denies incorrect keys before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 0.6765
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: daily budget rejects an unaffordable reservation before enqueue
# child TAP | not ok 3 - daily budget rejects an unaffordable reservation before enqueue
# child TAP |   ---
# child TAP |   duration_ms: 6.5528
# child TAP |   type: 'test'
# child TAP |   location: 'C:\\\\tmp\\\\news-routine-api\\\\[eval1]:110:1'
# child TAP |   failureType: 'testCodeFailure'
# child TAP |   error: |-
# child TAP |     GUARD_DAILY_BUDGET
# child TAP |
# child TAP |     202 !== 429
# child TAP |
# child TAP |   code: 'ERR_ASSERTION'
# child TAP |   name: 'AssertionError'
# child TAP |   expected: 429
# child TAP |   actual: 202
# child TAP |   operator: 'strictEqual'
# child TAP |   stack: |-
# child TAP |     TestContext.<anonymous> (file:///C:/tmp/news-routine-api/[eval1]:113:10)
# child TAP |     async Test.run (node:internal/test_runner/test:1208:7)
# child TAP |     async Test.processPendingSubtests (node:internal/test_runner/test:831:7)
# child TAP |   ...
# child TAP | \# Subtest: concurrency reservation admits only one simultaneous submission
# child TAP | ok 4 - concurrency reservation admits only one simultaneous submission
# child TAP |   ---
# child TAP |   duration_ms: 2.0184
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP | ok 5 - workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP |   ---
# child TAP |   duration_ms: 0.6387
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: idempotency replay does not execute a second news generation
# child TAP | ok 6 - idempotency replay does not execute a second news generation
# child TAP |   ---
# child TAP |   duration_ms: 1.2694
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | 1..6
# child TAP | \# tests 6
# child TAP | \# suites 0
# child TAP | \# pass 5
# child TAP | \# fail 1
# child TAP | \# cancelled 0
# child TAP | \# skipped 0
# child TAP | \# todo 0
# child TAP | \# duration_ms 34.223
# KILLED GUARD_DAILY_BUDGET: targeted assertion failed; child exit=1; remaining contracts passed=5.
# Subtest: mutation killed: remove concurrency admission guard
ok 21 - mutation killed: remove concurrency admission guard
  ---
  duration_ms: 99.5578
  type: 'test'
  ...
# remove concurrency admission guard: child exit=1, signal=none
# child TAP | TAP version 13
# child TAP | \# Subtest: switch gate denies disabled requests before loading runtime
# child TAP | ok 1 - switch gate denies disabled requests before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 15.9125
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: auth gate denies incorrect keys before loading runtime
# child TAP | ok 2 - auth gate denies incorrect keys before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 0.6405
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: daily budget rejects an unaffordable reservation before enqueue
# child TAP | ok 3 - daily budget rejects an unaffordable reservation before enqueue
# child TAP |   ---
# child TAP |   duration_ms: 3.7377
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: concurrency reservation admits only one simultaneous submission
# child TAP | not ok 4 - concurrency reservation admits only one simultaneous submission
# child TAP |   ---
# child TAP |   duration_ms: 2.8287
# child TAP |   type: 'test'
# child TAP |   location: 'C:\\\\tmp\\\\news-routine-api\\\\[eval1]:118:1'
# child TAP |   failureType: 'testCodeFailure'
# child TAP |   error: |-
# child TAP |     GUARD_CONCURRENCY
# child TAP |     + actual - expected
# child TAP |
# child TAP |       [
# child TAP |         202,
# child TAP |     +   202
# child TAP |     -   429
# child TAP |       ]
# child TAP |
# child TAP |   code: 'ERR_ASSERTION'
# child TAP |   name: 'AssertionError'
# child TAP |   expected:
# child TAP |     0: 202
# child TAP |     1: 429
# child TAP |   actual:
# child TAP |     0: 202
# child TAP |     1: 202
# child TAP |   operator: 'deepStrictEqual'
# child TAP |   stack: |-
# child TAP |     TestContext.<anonymous> (file:///C:/tmp/news-routine-api/[eval1]:124:10)
# child TAP |     async Test.run (node:internal/test_runner/test:1208:7)
# child TAP |     async Test.processPendingSubtests (node:internal/test_runner/test:831:7)
# child TAP |   ...
# child TAP | \# Subtest: workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP | ok 5 - workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP |   ---
# child TAP |   duration_ms: 0.6792
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: idempotency replay does not execute a second news generation
# child TAP | ok 6 - idempotency replay does not execute a second news generation
# child TAP |   ---
# child TAP |   duration_ms: 1.2483
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | 1..6
# child TAP | \# tests 6
# child TAP | \# suites 0
# child TAP | \# pass 5
# child TAP | \# fail 1
# child TAP | \# cancelled 0
# child TAP | \# skipped 0
# child TAP | \# todo 0
# child TAP | \# duration_ms 31.027
# KILLED GUARD_CONCURRENCY: targeted assertion failed; child exit=1; remaining contracts passed=5.
# Subtest: mutation killed: remove foreign workflow prefix guard
ok 22 - mutation killed: remove foreign workflow prefix guard
  ---
  duration_ms: 94.9242
  type: 'test'
  ...
# remove foreign workflow prefix guard: child exit=1, signal=none
# child TAP | TAP version 13
# child TAP | \# Subtest: switch gate denies disabled requests before loading runtime
# child TAP | ok 1 - switch gate denies disabled requests before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 15.3163
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: auth gate denies incorrect keys before loading runtime
# child TAP | ok 2 - auth gate denies incorrect keys before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 0.6026
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: daily budget rejects an unaffordable reservation before enqueue
# child TAP | ok 3 - daily budget rejects an unaffordable reservation before enqueue
# child TAP |   ---
# child TAP |   duration_ms: 3.5541
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: concurrency reservation admits only one simultaneous submission
# child TAP | ok 4 - concurrency reservation admits only one simultaneous submission
# child TAP |   ---
# child TAP |   duration_ms: 2.0338
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP | not ok 5 - workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP |   ---
# child TAP |   duration_ms: 1.1788
# child TAP |   type: 'test'
# child TAP |   location: 'C:\\\\tmp\\\\news-routine-api\\\\[eval1]:128:1'
# child TAP |   failureType: 'testCodeFailure'
# child TAP |   error: |-
# child TAP |     GUARD_PREFIX
# child TAP |
# child TAP |     200 !== 404
# child TAP |
# child TAP |   code: 'ERR_ASSERTION'
# child TAP |   name: 'AssertionError'
# child TAP |   expected: 404
# child TAP |   actual: 200
# child TAP |   operator: 'strictEqual'
# child TAP |   stack: |-
# child TAP |     TestContext.<anonymous> (file:///C:/tmp/news-routine-api/[eval1]:135:10)
# child TAP |     async Test.run (node:internal/test_runner/test:1208:7)
# child TAP |     async Test.processPendingSubtests (node:internal/test_runner/test:831:7)
# child TAP |   ...
# child TAP | \# Subtest: idempotency replay does not execute a second news generation
# child TAP | ok 6 - idempotency replay does not execute a second news generation
# child TAP |   ---
# child TAP |   duration_ms: 1.2266
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | 1..6
# child TAP | \# tests 6
# child TAP | \# suites 0
# child TAP | \# pass 5
# child TAP | \# fail 1
# child TAP | \# cancelled 0
# child TAP | \# skipped 0
# child TAP | \# todo 0
# child TAP | \# duration_ms 30.1295
# KILLED GUARD_PREFIX: targeted assertion failed; child exit=1; remaining contracts passed=5.
# Subtest: mutation killed: remove idempotency claim and replay
ok 23 - mutation killed: remove idempotency claim and replay
  ---
  duration_ms: 105.4694
  type: 'test'
  ...
# remove idempotency claim and replay: child exit=1, signal=none
# child TAP | TAP version 13
# child TAP | \# Subtest: switch gate denies disabled requests before loading runtime
# child TAP | ok 1 - switch gate denies disabled requests before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 17.5014
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: auth gate denies incorrect keys before loading runtime
# child TAP | ok 2 - auth gate denies incorrect keys before loading runtime
# child TAP |   ---
# child TAP |   duration_ms: 0.6033
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: daily budget rejects an unaffordable reservation before enqueue
# child TAP | ok 3 - daily budget rejects an unaffordable reservation before enqueue
# child TAP |   ---
# child TAP |   duration_ms: 3.7517
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: concurrency reservation admits only one simultaneous submission
# child TAP | ok 4 - concurrency reservation admits only one simultaneous submission
# child TAP |   ---
# child TAP |   duration_ms: 2.6721
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP | ok 5 - workflow prefix excludes a foreign queue job even with a matching stored record
# child TAP |   ---
# child TAP |   duration_ms: 0.7474
# child TAP |   type: 'test'
# child TAP |   ...
# child TAP | \# Subtest: idempotency replay does not execute a second news generation
# child TAP | not ok 6 - idempotency replay does not execute a second news generation
# child TAP |   ---
# child TAP |   duration_ms: 1.8439
# child TAP |   type: 'test'
# child TAP |   location: 'C:\\\\tmp\\\\news-routine-api\\\\[eval1]:139:1'
# child TAP |   failureType: 'testCodeFailure'
# child TAP |   error: |-
# child TAP |     GUARD_IDEMPOTENCY
# child TAP |
# child TAP |     2 !== 1
# child TAP |
# child TAP |   code: 'ERR_ASSERTION'
# child TAP |   name: 'AssertionError'
# child TAP |   expected: 1
# child TAP |   actual: 2
# child TAP |   operator: 'strictEqual'
# child TAP |   stack: |-
# child TAP |     TestContext.<anonymous> (file:///C:/tmp/news-routine-api/[eval1]:146:10)
# child TAP |     async Test.run (node:internal/test_runner/test:1208:7)
# child TAP |     async Test.processPendingSubtests (node:internal/test_runner/test:831:7)
# child TAP |   ...
# child TAP | 1..6
# child TAP | \# tests 6
# child TAP | \# suites 0
# child TAP | \# pass 5
# child TAP | \# fail 1
# child TAP | \# cancelled 0
# child TAP | \# skipped 0
# child TAP | \# todo 0
# child TAP | \# duration_ms 33.7162
# KILLED GUARD_IDEMPOTENCY: targeted assertion failed; child exit=1; remaining contracts passed=5.
# (node:56248) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///C:/tmp/news-routine-api/src/lib/input-engine/detector.js is not specified and it doesn't parse as CommonJS.
# Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
# To eliminate this warning, add "type": "module" to C:\\tmp\\news-routine-api\\package.json.
# (Use `node --trace-warnings ...` to show where the warning was created)
# Subtest: text delegates unchanged arguments after durable workflow initialization
ok 24 - text delegates unchanged arguments after durable workflow initialization
  ---
  duration_ms: 3.2413
  type: 'test'
  ...
# Subtest: enhanced URL delegates exact original arguments without sourceType or text workflow initialization
ok 25 - enhanced URL delegates exact original arguments without sourceType or text workflow initialization
  ---
  duration_ms: 1.4917
  type: 'test'
  ...
# Subtest: text-only gate defaults closed for URLs and short malformed URL markers in queue mode
ok 26 - text-only gate defaults closed for URLs and short malformed URL markers in queue mode
  ---
  duration_ms: 1.2724
  type: 'test'
  ...
# Subtest: queue preserves garbled-input ratio and length thresholds
ok 27 - queue preserves garbled-input ratio and length thresholds
  ---
  duration_ms: 0.3675
  type: 'test'
  ...
# Subtest: nondelegated inputs remain queue-only instead of being rerouted to the article service
ok 28 - nondelegated inputs remain queue-only instead of being rerouted to the article service
  ---
  duration_ms: 0.62
  type: 'test'
  ...
# Subtest: empty and invalid inputs are rejected before loading news dependencies
ok 29 - empty and invalid inputs are rejected before loading news dependencies
  ---
  duration_ms: 0.191
  type: 'test'
  ...
# Subtest: missing workflow persistence prevents AI service calls
ok 30 - missing workflow persistence prevents AI service calls
  ---
  duration_ms: 0.4535
  type: 'test'
  ...
# Subtest: failed workflow initialization and context conflicts prevent AI service calls
ok 31 - failed workflow initialization and context conflicts prevent AI service calls
  ---
  duration_ms: 0.4097
  type: 'test'
  ...
# Subtest: deadline expiring while workflow initializes prevents the subsequent AI call
ok 32 - deadline expiring while workflow initializes prevents the subsequent AI call
  ---
  duration_ms: 0.3805
  type: 'test'
  ...
# Subtest: original hard deadline bounds a stalled service and retains a safe error
ok 33 - original hard deadline bounds a stalled service and retains a safe error
  ---
  duration_ms: 0.5373
  type: 'test'
  ...
# Subtest: upstream failures sanitize messages and only retain valid error types
ok 34 - upstream failures sanitize messages and only retain valid error types
  ---
  duration_ms: 0.8414
  type: 'test'
  ...
# Subtest: deadline errors from services retain timeout classification
ok 35 - deadline errors from services retain timeout classification
  ---
  duration_ms: 0.2594
  type: 'test'
  ...
# Subtest: plans not produced by this adapter cannot load a service
ok 36 - plans not produced by this adapter cannot load a service
  ---
  duration_ms: 0.1411
  type: 'test'
  ...
# (node:16572) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///C:/tmp/news-routine-api/src/app/api/routine/health/route.js is not specified and it doesn't parse as CommonJS.
# Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
# To eliminate this warning, add "type": "module" to C:\\tmp\\news-routine-api\\package.json.
# (Use `node --trace-warnings ...` to show where the warning was created)
# Subtest: actual route files: switch off returns 404 for every verb without evaluating runtime or legacy imports
ok 37 - actual route files: switch off returns 404 for every verb without evaluating runtime or legacy imports
  ---
  duration_ms: 41.83
  type: 'test'
  ...
# Subtest: fresh process import sentinel proves route entry graph is dormant
ok 38 - fresh process import sentinel proves route entry graph is dormant
  ---
  duration_ms: 82.4078
  type: 'test'
  ...
# Subtest: all supported operations reject absent/wrong routine key before loading dependencies
ok 39 - all supported operations reject absent/wrong routine key before loading dependencies
  ---
  duration_ms: 2.827
  type: 'test'
  ...
# Subtest: timing-safe comparator receives equal length digests even for wrong-length keys
ok 40 - timing-safe comparator receives equal length digests even for wrong-length keys
  ---
  duration_ms: 1.1721
  type: 'test'
  ...
# Subtest: correct key dispatches once with awaited Next params; unsupported methods and select remain JSON
ok 41 - correct key dispatches once with awaited Next params; unsupported methods and select remain JSON
  ---
  duration_ms: 0.4961
  type: 'test'
  ...
# Subtest: unexpected dependency errors are sanitized; no credentials or raw error message in JSON
ok 42 - unexpected dependency errors are sanitized; no credentials or raw error message in JSON
  ---
  duration_ms: 0.2363
  type: 'test'
  ...
# Subtest: authoritative reads distinguish missing rows from all persistence errors
ok 43 - authoritative reads distinguish missing rows from all persistence errors
  ---
  duration_ms: 3.5313
  type: 'test'
  ...
# Subtest: insert is an atomic unique-key claim; only PostgreSQL 23505 is a miss
ok 44 - insert is an atomic unique-key claim; only PostgreSQL 23505 is a miss
  ---
  duration_ms: 1.1839
  type: 'test'
  ...
# Subtest: numeric idempotency timestamps become ISO timestamptz values without altering JSON data
ok 45 - numeric idempotency timestamps become ISO timestamptz values without altering JSON data
  ---
  duration_ms: 0.1654
  type: 'test'
  ...
# Subtest: CAS and removal fence writes with namespace, row id, and expected revision
ok 46 - CAS and removal fence writes with namespace, row id, and expected revision
  ---
  duration_ms: 0.4885
  type: 'test'
  ...
# Subtest: list paginates deterministically and rejects partial, oversized, or malformed reads
ok 47 - list paginates deterministically and rejects partial, oversized, or malformed reads
  ---
  duration_ms: 2.7118
  type: 'test'
  ...
# Subtest: active queue uses literal routine prefix and includes transitional reservations
ok 48 - active queue uses literal routine prefix and includes transitional reservations
  ---
  duration_ms: 0.6935
  type: 'test'
  ...
# Subtest: short server-limited pages continue until empty; repeated keys and page-limit exhaustion fail closed
ok 49 - short server-limited pages continue until empty; repeated keys and page-limit exhaustion fail closed
  ---
  duration_ms: 2.2856
  type: 'test'
  ...
# Subtest: queue insertion preserves the existing bot/worker shape and verifies committed ownership
ok 50 - queue insertion preserves the existing bot/worker shape and verifies committed ownership
  ---
  duration_ms: 0.4525
  type: 'test'
  ...
# Subtest: job reads never follow replacement links; generation reads preserve verified arrays
ok 51 - job reads never follow replacement links; generation reads preserve verified arrays
  ---
  duration_ms: 0.3248
  type: 'test'
  ...
# Subtest: request allowlist never admits model, prompt, preset, images, user, or workflow overrides
ok 52 - request allowlist never admits model, prompt, preset, images, user, or workflow overrides
  ---
  duration_ms: 23.7985
  type: 'test'
  ...
# Subtest: input limits include exact twenty-character boundary and chunked encoded body limits
ok 53 - input limits include exact twenty-character boundary and chunked encoded body limits
  ---
  duration_ms: 2.0728
  type: 'test'
  ...
# Subtest: JSON, routine names, and existing contentLength values have explicit errors
ok 54 - JSON, routine names, and existing contentLength values have explicit errors
  ---
  duration_ms: 2.1644
  type: 'test'
  ...
# Subtest: idempotency headers/body agree and are bounded
ok 55 - idempotency headers/body agree and are bounded
  ---
  duration_ms: 0.7141
  type: 'test'
  ...
# Subtest: defaults are safe and malformed configuration fails closed including zero admission caps
ok 56 - defaults are safe and malformed configuration fails closed including zero admission caps
  ---
  duration_ms: 0.5924
  type: 'test'
  ...
# Subtest: response uses original per-version provenance without inventing missing case or model
ok 57 - response uses original per-version provenance without inventing missing case or model
  ---
  duration_ms: 0.3132
  type: 'test'
  ...
1..57
# tests 57
# suites 0
# pass 57
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 826.0174
```

</details>
