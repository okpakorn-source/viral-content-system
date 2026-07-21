ผู้ตรวจหลัก: เรฟ (Sol Ultra, independent code review)  
ขอบเขตหลัก: `public/company/index.html`, office ทั้ง 3 หน้า, `public/company/server.mjs`, `src/app/api/company/chat/route.js`, `scripts/company-tasks.mjs` และ workflow 3 ตัวตามคำสั่ง  
วิธีตรวจ: อ่าน call chain จริงแบบมีเลขบรรทัด, เทียบ request/response contract, compile/syntax check, ES2018 parser, DOM ID scan และ in-memory stub execution โดย **ไม่เรียก AI/ฐานข้อมูล/endpoint จริง และไม่แก้โค้ดระบบ**

## สรุปผู้บริหาร

คำตัดสิน: **ระบบยังไม่ควรถูกถือว่าเป็น “ระบบสั่งงานจริงที่ปลอดภัยและไม่ทำงานหาย” จนกว่าจะแก้ P0/P1 ด้านล่าง**

สิ่งที่ทำงานถูกต้องคือชั้นปุ่มและ DOM: ปุ่ม `สั่งงานจริง`, `แจ้งบั๊กวิศวะ`, `เรียกประชุม`, `งานที่สั่ง` ใน office ทั้ง 3 หน้ามี element ID ครบ ไม่ซ้ำ มี `addEventListener` ครบ เมนู `เพิ่มเติม` เปิด/ปิดได้ และ task/bug/meeting กัน input ว่างก่อนยิง request จริง ปัญหาหลักอยู่หลังปุ่ม ได้แก่ authentication ที่หายไป, การตอบ success เท็จ, queue ที่ทำรายการตกหล่น, workflow ที่ล้างคิวก่อนทำเสร็จ, shell command injection และ approval gate ที่เป็นเพียงข้อความกำชับโมเดล

จุดเสี่ยงสูงสุดที่ยืนยันแล้ว:

1. `/api/company/chat` ไม่มีการตรวจ `COMPANY_CHAT_SECRET` หรือสิทธิ์ผู้ใช้จริงแม้ comment ระบุว่าปิดโดยปริยาย ผู้เรียกภายนอกจึงอ่านคิว, เพิ่ม task/bug และเรียก AI ได้
2. ข้อความแชท/ค่า workflow บางส่วนถูกต่อเข้า Bash command ด้วยการ escape แค่เครื่องหมาย `"` ทำให้ `$()`, backticks และ shell expansion ยังทำงานได้ โดย runner ใช้ `approval_policy=never` และ `workspace-write`
3. `company-reply` ให้ LLM อ่านแล้วล้าง `_pending.jsonl` ก่อนประมวลผล จากนั้นรับเพียง 8 รายการ จึงทำรายการที่ 9 เป็นต้นไปหายแน่นอน และมี race กับข้อความใหม่ที่ server append ระหว่าง read/truncate
4. `eng-fix` ไม่ได้ผูก `apply:true` กับ proposal ที่ผู้ใช้เห็น, ไม่ enforce path/scope ด้วย code, รัน writer ขนานกัน และประกาศ `mode:"applied"` แม้ QA/review จะ FAIL
5. `action:bug` ตอบ `success:true` แม้ Supabase ไม่มีหรือ insert ล้มเหลว ผู้ใช้เห็นว่าส่งแล้วแต่ไม่มีงานอยู่จริง
6. CLI คิวงานเลือก 50 แถวเก่าสุดก่อนกรอง pending และ claim แบบ SELECT→UPDATE ไม่มี compare-and-set/lease ทำให้งานอดคิว, ทำซ้ำ หรือค้าง `running` ได้

### เมทริกซ์ action ที่ตรวจจริง

| Action | UI ทั้ง 3 หน้า | Next route | `server.mjs` ใน LAN | คำตัดสิน |
|---|---|---|---|---|
| `action:task` | handler/body ถูก: `{action,to,text,scope}` | insert `company_tasks` ที่ `route.js:145-152` | ไม่มี endpoint/fallback | ออนไลน์ผูกถูก แต่ไม่ auth; LAN ใช้ไม่ได้ |
| `action:bug` | handler/body ถูก: `{action,text,scope}` | branch `route.js:181-192` | ไม่มี endpoint/fallback | มี false success เมื่อคิวล้ม และสถานะไม่ย้อนกลับห้องต้นทาง |
| `action:meeting` | handler/body ถูก; input ว่างถูกกัน | AI branch `route.js:126-142` | มี `/api/meeting` แต่ไม่รองรับ engineering scope | ออนไลน์ไม่ auth; engineering LAN เขียนผิดห้อง |
| `action:tasks` | เปิด popup และ poll ถูก | query `route.js:155-160` | ไม่มี endpoint | query error กลายเป็นคิวว่าง และ limit ก่อนกรอง scope |

### ผลตรวจ syntax/DOM ที่ต้องไม่ตีความเป็นบั๊ก

- `node --check` ผ่าน `public/company/server.mjs`, `src/app/api/company/chat/route.js`, `scripts/company-tasks.mjs`
- inline JavaScript ของ office ทั้ง 3 หน้า compile ผ่าน; literal `getElementById()` ทุกตัวมี element จริง และไม่พบ ID ซ้ำในแต่ละเอกสาร
- workflow ทั้ง 3 ตัว compile ผ่านเมื่อ wrap ตาม workflow runtime ซึ่งอนุญาต top-level `await/return`
- parser ที่ล็อก `ecmaVersion: 2018` ผ่าน inline scripts, route, task CLI และ workflow body ทั้งหมด ยกเว้น `server.mjs:8` ซึ่งใช้ `import.meta` (ES2020); current Node v24 รันได้ จึงเป็น compatibility violation ไม่ใช่ parse crash บนเครื่องปัจจุบัน
- ไม่พบ `?.`, `??`, `replaceAll`, `Array.prototype.flat` หรือ syntax รุ่นใหม่โดยไม่ได้ตั้งใจในไฟล์เป้าหมาย

## บั๊กวิกฤต (พร้อมไฟล์:บรรทัด+วิธีแก้)

### P0-01 — API บริษัทไม่มี authentication จริง แต่เปิดทั้ง AI, task read และ task write

**ตำแหน่ง**

- `src/app/api/company/chat/route.js:2` — comment อ้างว่าไม่ตั้ง `COMPANY_CHAT_SECRET` ต้องตอบ 503
- `src/app/api/company/chat/route.js:111-120` — เข้า POST, rate limit และ parse body ทันที โดยไม่มีการอ่าน ENV/secret/session
- `src/app/api/company/chat/route.js:126-160` — meeting, task และ tasks ทำงานก่อนมี authorization ใด ๆ
- `src/app/api/company/chat/route.js:181-192` — bug เขียนคิวและเรียก AI โดยไม่ auth

**เส้นทางที่พิสูจน์ได้**

ค้นทั้ง tracked code พบ `COMPANY_CHAT_SECRET` เพียง comment ที่ `route.js:2`; ไม่มี middleware หรือ executable check สำหรับ route นี้ In-memory stub ส่ง `action:task`, `action:bug`, `action:tasks` โดยไม่มี `secret` แล้วได้ response ปกติ

**ผลกระทบ**

- อ่าน `command`, `assignee`, `result` ในคิวงานภายในได้โดยเดา `scope`
- spam/persist ข้อความลง `store_items/company_tasks`
- เรียก Claude ผ่าน chat/meeting/bug จนเกิดค่าใช้จ่าย
- ฝังข้อความอันตรายลง queue แล้วรอ downstream agent/workflow ประมวลผล
- limiter ปัจจุบันเป็น global ต่อ instance จึงไม่ใช่ authorization และข้ามได้เมื่อมีหลาย serverless instance

**วิธีแก้ขั้นต่ำ**

1. บังคับ server-side owner authentication **ก่อนทุก action รวม `tasks`**; ถ้า ENV/config ไม่มีให้ fail closed 503, credential ไม่ผ่านให้ 403
2. แยกสิทธิ์ read/write/AI และอย่าใช้ secret ที่ฝังใน HTML เป็นขอบเขตความปลอดภัยหลัก; ใช้ signed session หรือระบบ auth ที่ตรวจฝั่ง server
3. ตรวจ `scope`, `to`, `action` ด้วย allowlist และใช้ per-user/IP shared rate limit หลังชั้นป้องกันพื้นฐาน
4. เพิ่ม contract tests: no credential, bad credential, valid credential สำหรับทุก action

### P0-02 — Shell command injection จากแชท/args เข้าสู่ Bash/Codex runner

**ตำแหน่ง**

- `public/company/server.mjs:33-40` รับ `to/text` แล้วเขียนลง `_pending.jsonl` โดยไม่มีข้อจำกัด shell metacharacter
- `.claude/workflows/company-reply.js:26,32-34` กำหนด responder ที่เรียก Codex
- `.claude/workflows/company-reply.js:70-74` ต่อ `question` เข้า command ที่อยู่ใน double quotes โดยแทนเพียง `"` เป็น `'`; `$()`, backticks และ `$VAR` ยัง expand ได้
- `.claude/workflows/eng-fix.js:87-89,103-105` ต่อ task/files ที่โมเดลสร้างเข้า Codex command แบบเดียวกัน
- `.claude/workflows/newsdesk-bridge.js:14,18,25-32` ต่อ `base` และ `sendIds` เข้า curl command โดยไม่ validate/escape

**เส้นทางโจมตีจริง**

`POST /api/say` → `_pending.jsonl` → `company-reply` เลือก Codex responder → runner ให้ agent รัน Bash command ที่มีข้อความผู้ใช้อยู่ใน double-quoted argument. ข้อความเช่น `$()` หรือ backticks ไม่ถูก neutralize และ command ใช้ `approval_policy=never -s workspace-write`

**ผลกระทบ**

เมื่อ workflow ถูกประมวลผล ผู้ส่งจาก LAN หรือผู้ควบคุม args สามารถทำ shell expansion/command execution ในสิทธิ์ของ runner ได้; อย่างน้อยที่สุดสามารถเปลี่ยน prompt/argument และขยาย environment โดยไม่ตั้งใจ และในกรณีเลวร้ายเขียนไฟล์หรือรันโปรแกรมใน workspace

**วิธีแก้ขั้นต่ำ**

1. ห้ามประกอบ shell command string จากข้อมูลผู้ใช้หรือ output ของโมเดล
2. เรียก process ด้วย argv array (`spawn/execFile`) และส่ง prompt ผ่านไฟล์ชั่วคราว/STDIN ที่ไม่ผ่าน shell
3. allowlist `BASE` เป็น origin ที่กำหนด, validate lead ID ด้วย regex/DB lookup, reject control characters/newline/metacharacter และ dedupe IDs
4. reply/review runner ต้องเป็น read-only; ไม่ใช้ `workspace-write` เมื่อไม่ต้องเขียน
5. เพิ่ม regression test ที่ส่ง `$()`, backticks, `$VAR`, newline และ quote แล้วตรวจว่าเป็น literal ทั้งหมดโดยไม่มีการ execute

### P0-03 — `company-reply` ล้างคิวก่อนทำสำเร็จ ทำข้อความหายแบบ deterministic และมี race

**ตำแหน่ง**

- `.claude/workflows/company-reply.js:41-47` ให้ LLM อ่านคิวและเขียนทับไฟล์เป็นค่าว่างใน phase เดียว
- `.claude/workflows/company-reply.js:49` ค่อย `.slice(0, 8)` หลังคิวถูกล้างแล้ว
- `.claude/workflows/company-reply.js:77-87` meeting แตกเป็นหลาย job แล้วถูกตัดเหลือ 12
- `.claude/workflows/company-reply.js:89-95` เขียน reply หลังงาน AI ทั้งหมด; ไม่มี ack/requeue เมื่อบางงานล้ม
- `public/company/server.mjs:40` append ข้อความใหม่ได้ในช่วงที่ workflow กำลัง read/truncate

**ผลกระทบ**

- คิว 9 รายการ: รายการที่ 9 หายแน่นอน เพราะไฟล์ถูกล้างแต่โค้ดเก็บเพียง 8
- meeting หลายรายการอาจขยายเกิน 12 jobs; ส่วนท้ายถูกทิ้งโดยไม่มีสถานะ
- ข้อความที่ server append หลัง intake อ่านแต่ก่อน intake truncate อาจถูกลบ
- ถ้า AI/reply/write chat ล้มหลัง truncate ข้อความเดิมไม่มีทาง retry
- workflow สอง instance สามารถอ่านคิวเดียวกันแล้วตอบซ้ำหรือลบงานของกันและกัน

**วิธีแก้ขั้นต่ำ**

ใช้ deterministic single-consumer spool: lock แล้ว atomic rename `_pending.jsonl` เป็นไฟล์ processing, parse JSONL ด้วย code, ใส่ message ID, ประมวลผล batch ที่กำหนด, ack เฉพาะหลังเขียน reply สำเร็จ, เก็บ remainder/requeue failure และทำ idempotency ต่อ message ID ห้ามให้ LLM เป็นผู้ล้างคิว

### P0-04 — `eng-fix` approval/scope guard เป็น prompt-only และ `apply:true` ไม่ผูกกับ proposal ที่อนุมัติ

**ตำแหน่ง**

- `.claude/workflows/eng-fix.js:16-21` รับ boolean `apply` และ `runId` ตรง ๆ
- `.claude/workflows/eng-fix.js:25-31` ขอบเขต/ไฟล์หัวใจเป็นข้อความเท่านั้น ไม่มี code validation
- `.claude/workflows/eng-fix.js:35-48` สร้าง diagnosis/plan ใหม่ทุก invocation
- `.claude/workflows/eng-fix.js:62-71` รอบ proposal คืนแผน แต่ไม่ persist hash/approval artifact
- `.claude/workflows/eng-fix.js:78-95` รอบ `apply:true` ลงมือด้วยแผนใหม่; company target ลงมืออัตโนมัติแม้ risk medium/high
- `.claude/workflows/eng-fix.js:21,55` ใช้ `runId` สร้าง path โดยไม่ validate

**ผลกระทบ**

- แผนที่ลงมืออาจไม่ใช่แผนที่เจ้าของอ่านและอนุมัติ
- prompt injection/model error สามารถคืน path นอก zone หรือไฟล์หัวใจ; ไม่มี code guard หยุดจริง
- `runId` ที่มี separator/`..` สามารถชี้รายงานออกนอก `fixes/` ผ่าน agent instruction
- ไม่มีการ enforce backup/safety net ก่อน writer เริ่ม
- workflow ขัดกับ `SYSTEM_SAFETY_RULES.md` ที่กำหนด approval สำหรับ MEDIUM+

**วิธีแก้ขั้นต่ำ**

persist proposal immutable พร้อม ID/hash, normalized file list, risk และ diff plan; approval ต้องอ้าง proposal ID/hash เดิม จากนั้น code ต้อง resolve path แล้วตรวจว่าอยู่ใน allowlisted root, reject protected paths, overlap และ path traversal ก่อนเรียก writer รวมถึงตรวจ safety net/backup ตามนโยบาย ห้ามใช้ boolean `apply` เป็น authorization เพียงอย่างเดียว

### P1-01 — `action:bug` ตอบ success แม้ไม่ได้เข้าคิววิศวกรรม

**ตำแหน่ง**

- `src/app/api/company/chat/route.js:181-190` ไม่มี DB หรือ insert error จะทำให้ `bugTaskId` ว่าง แต่ error ถูกกลืน
- `src/app/api/company/chat/route.js:191-192` ยังเรียก AI และตอบ `success:true` พร้อม note ว่าเข้าคิวแล้ว
- UI เชื่อ `success` แล้วล้าง input/แจ้งสำเร็จที่ `public/company/office-ui/office.html:1361-1370`, `departments/newsdesk/office.html:1536-1545`, `departments/engineering/office.html:1196-1205`

**ผลกระทบ**

รายงานบั๊กสูญหายแบบเงียบ ผู้ใช้เห็นคำตอบจากอาร์คและ toast “ส่งแล้ว” แต่ไม่มี record ให้ทีมแก้ In-memory stub ยืนยันว่า insert คืน error แล้วยังได้ HTTP 200, `success:true`, `bugTaskId:""`

**วิธีแก้ขั้นต่ำ**

fail closed เมื่อไม่มี DB/insert error ด้วย 503/500 + `errorType`; success ต้องมี persisted task ID เท่านั้น แยก queue acknowledgement ออกจาก AI acknowledgement และควรตอบ task ID ก่อน/ไม่ผูกความสำเร็จของ queue กับ AI call ที่ยาว

### P1-02 — คิว `company_tasks` อดงานและ claim ไม่ atomic

**ตำแหน่ง**

- `scripts/company-tasks.mjs:26-30` order เก่าสุดก่อน, limit 50 แล้วค่อยกรอง pending ใน JS
- `scripts/company-tasks.mjs:32-38` SELECT row แล้ว UPDATE แยกคำสั่ง ไม่มีเงื่อนไข current status/owner/version
- `scripts/company-tasks.mjs:35` ตั้ง `doneAt` แม้ status เป็น `running`
- `scripts/company-tasks.mjs:44-46` อนุญาต claim/done/fail โดยไม่ validate transition

**ผลกระทบ**

- เมื่อ 50 แถวเก่าสุดเป็น done/failed งาน pending แถวที่ 51+ จะไม่เคยปรากฏใน `list`
- manager สองตัวอ่าน pending เดียวกันแล้ว claim สำเร็จทั้งคู่ เกิด execution/ค่าใช้จ่ายซ้ำ
- done/fail แข่งกันแล้ว last writer ชนะ; terminal task ถูก claim กลับเป็น running ได้และยังแสดง result เก่า
- worker ตายกลางงานทำให้ task ค้าง running เพราะ `list` แสดงเฉพาะ pending และไม่มี lease/reclaim

**วิธีแก้ขั้นต่ำ**

กรอง status ใน DB ก่อน order/limit และ paginate; ทำ atomic conditional claim (`status=pending` + returning row) หรือ DB RPC/transaction; ใส่ `claimedBy`, `startedAt`, `leaseUntil`, version และ transition table; ตั้ง `doneAt` เฉพาะ terminal state พร้อม stale-job recovery

### P1-03 — Engineering chat แบบ LAN เป็น split-brain: เขียนสำนักงานใหญ่ แต่อ่านห้องวิศวะ

**ตำแหน่ง**

- `public/company/departments/engineering/office.html:783-787` ตั้ง `scope='engineering'`, อ่าน `./chat.md`
- `public/company/departments/engineering/office.html:1251-1269,1314-1329` fallback ไป `/api/say` และ `/api/meeting`
- `public/company/server.mjs:12-14,25-26` รองรับแค่ newsdesk; scope อื่นทั้งหมดถูกบังคับเป็น main/`public/company/office`
- `.claude/workflows/company-reply.js:12-15` รองรับเพียง newsdesk/main

**หลักฐานสภาพจริง**

ณ เวลาตรวจไม่มี `public/company/departments/engineering/chat.md` และ `_pending.jsonl` เมื่อ online route ตอบ 404, server จึงตอบ 200 และ UI ล้างข้อความ แต่ข้อความถูกเขียน `public/company/office/chat.md`; หน้า engineering reload คนละ path และ company-reply ตอบด้วย roster main

**วิธีแก้ขั้นต่ำ**

เพิ่ม engineering scope/files/roster ครบ end-to-end ใน server และ company-reply พร้อมสร้างไฟล์อย่าง deterministic หรือปิด home fallback สำหรับ engineering แล้วแสดง “ไม่รองรับ LAN” ห้ามรับ scope แล้ว silently coerce เป็น main

### P1-04 — หน้าและ AI รายงาน “คิวว่าง” ทั้งที่มีงานหรือ DB ล้ม

**ตำแหน่ง**

- `src/app/api/company/chat/route.js:81-85` limit 25 ทุก scope ก่อน filter scope/status และไม่ตรวจ `q.error`
- `src/app/api/company/chat/route.js:155-160` limit 15 ก่อน filter scope และไม่ตรวจ `q.error`
- UI แทนรายการเดิมด้วย `[]` เมื่อ response/error ที่ `office-ui/office.html:1306-1313`, `newsdesk/office.html:1481-1488`, `engineering/office.html:1141-1148`

**ผลกระทบ**

งาน scope ที่มีปริมาณน้อยถูกงานห้องอื่นกิน window จนหายจากจอและ `getTasksBlock`; DB outage ถูกแสดงเหมือน “ไม่มีงาน” Stub ที่มี 25 main tasks + engineering task ที่เก่ากว่ายืนยันว่า AI ฝั่ง engineering ได้ข้อความคิวว่างและไม่เห็นงานจริง

**วิธีแก้ขั้นต่ำ**

filter `store_name`, scope และ status ใน query ก่อน order/limit, check `q.error`, paginate และตอบ `TASK_LIST_FAIL`; UI ต้องรักษา last-known list แล้วแสดง degraded/error ห้ามล้างเป็น “ว่าง”

### P1-05 — `eng-fix` ประกาศ applied แม้ FAIL และเสี่ยง concurrent writers

**ตำแหน่ง**

- `.claude/workflows/eng-fix.js:95` รัน writer ตาม `diag.plan` แบบ parallel โดยไม่ตรวจไฟล์ซ้ำ/overlap
- `.claude/workflows/eng-fix.js:99-106` QA/review เป็นข้อความธรรมดา; reviewer ใช้ `workspace-write`
- `.claude/workflows/eng-fix.js:110-119` ไม่ gate PASS/FAIL/จำนวนผล/actual diff แต่คืน `mode:'applied'` เสมอ

**ผลกระทบ**

writer สองตัวแก้ไฟล์เดียวกันเกิด lost update; worker ล้มบางตัวก็ยังไป QA; reviewer อาจแก้ไฟล์หลัง QA; QA/review ตอบ FAIL แต่ report/status ยังบอก applied และพร้อมรอ deploy นอกจากนี้ tests ไม่ได้บังคับ `validate-workflow`, build หรือ functional test ตาม risk

**วิธีแก้ขั้นต่ำ**

normalize/dedupe file ownership และ serialize overlapping work; รับ structured result; reviewer read-only; ตรวจ actual git diff/changed paths; hard gate เมื่อ worker/test/review ไม่ผ่าน และให้ final Sol/owner ตรวจ diff พร้อม tests ที่เหมาะสมก่อนเปลี่ยนสถานะ

### P1-06 — `newsdesk-bridge` gate ส่งจริงไม่ใช่ approval artifact และ writer ชนไฟล์ log

**ตำแหน่ง**

- `.claude/workflows/newsdesk-bridge.js:18,22-35` เชื่อว่า `sendIds` ที่ไม่ว่างคืออนุมัติแล้ว โดยไม่ผูกกับ recommendation run/proposal เดิมและไม่ dedupe
- `.claude/workflows/newsdesk-bridge.js:25-34` ยิงหลาย ID ผ่าน `parallel`; worker ทุกตัว append `worklog.md` และ `archive/jobs.md` ชุดเดียวกัน
- `.claude/workflows/newsdesk-bridge.js:56` ผูก nested workflow ด้วย absolute path

**ผลกระทบ**

ผู้เรียกใส่ ID ใดก็เข้าสู่ send mode; ID ซ้ำถูก POST พร้อมกัน; concurrent read/edit/append ของ agent สามารถทำบรรทัด log หายหรือทับกัน และผลส่งจริงอาจไม่ตรง proposal ที่ผู้ใช้เห็น

**วิธีแก้ขั้นต่ำ**

ผูก approval กับ immutable recommendation run + approved ID set, validate/dedupe IDs กับ DB, ใช้ idempotency key ต่อ lead, ให้ workers คืนผลอย่างเดียวแล้วมี deterministic single writer เขียน log หลัง `parallel`; เลิก hard-code project path

## บั๊กรอง

### P2-01 — Local server ไม่มี action endpoint สำหรับ task/bug/tasks

`public/company/server.mjs:23-44` รองรับเฉพาะ `/api/say` และ `/api/meeting`; static miss จบเป็น 404 ที่ `:45-53` ขณะที่ `submitTask`, `submitBug`, `loadTasks` ใน office ทั้ง 3 หน้าเรียก `/api/company/chat` โดยไม่มี local fallback ดังนั้นปุ่มสามตัวนี้ fail/ว่างใน LAN แม้ UI แสดงเหมือนใช้งานได้ วิธีแก้คือ implement contract เดียวกันใน server หรือ disable/label action ที่ไม่รองรับตาม runtime อย่างชัดเจน

### P2-02 — ลิงก์ทั้ง 3 ใบใน `index.html` 404 เมื่อเปิดผ่าน server ที่โปรเจกต์ให้มา

`public/company/index.html:67,82,98` ใช้ href `/company/...` แต่ `public/company/server.mjs:8,46-50` ตั้ง static root เป็น `public/company` อยู่แล้ว การ resolve จริงกลายเป็น `public/company/company/...` ซึ่งไม่มีทั้ง 3 path (ตรวจด้วย resolver logic เดียวกับ server) ลิงก์นี้ถูกบน Next public hosting แต่ผิดบน `http://localhost:8787/` วิธีแก้คือใช้ relative links หรือให้ server strip prefix `/company/` อย่าง explicit

### P2-03 — Global rate limiter ถูก task polling กินและทำผู้ใช้อื่นโดน 429

`route.js:108-113` ใช้ counter เดียว 40 request/min ต่อ instance และนับก่อนแยก action ทุกหน้า poll ทุก 10 วินาทีตั้งแต่ boot (`office-ui/office.html:1831-1833`, `newsdesk/office.html:2001-2003`, `engineering/office.html:1586-1588`) หนึ่งแท็บใช้ราว 6 requests/min; หลายแท็บ/ผู้ใช้กิน quota แล้วบล็อก chat/meeting/bug จริงได้ ขณะเดียวกันหลาย serverless instance ทำให้ limiter ถูก bypass ได้ วิธีแก้: แยก cheap read endpoint/cache, poll เมื่อ popup visible หรือใช้ backoff, และ rate limit แบบ shared per identity/IP/action

### P2-04 — `loadTasks()` มี out-of-order race และล้างข้อมูลเดิมเมื่อ error

boot poll, interval poll, เปิด popup และ callback หลัง submit สามารถเรียกพร้อมกัน ไม่มี request sequence/abort/in-flight guard (`office-ui:1306-1314,1773-1776,1831-1833`; `newsdesk:1481-1489,1944-1947,2001-2003`; `engineering:1141-1149,1569-1572,1586-1588`) response เก่าที่มาทีหลังทับ state ใหม่ได้ วิธีแก้: request generation ID/AbortController และ only-latest commit; error ต้องเก็บ last-known data

### P2-05 — Secret UI/contract ของ 3 หน้าไม่สอดคล้อง และจะแตกทันทีเมื่อแก้ P0-01

- HQ ซ่อน parent ถาวรที่ `office-ui/office.html:848`; JS `:1790-1816` toggle แค่ child
- Newsdesk ซ่อน parent ที่ `newsdesk/office.html:926`; JS `:1961-1987` toggle แค่ child
- Engineering ไม่มี secret control และไม่ส่ง secret (`engineering/office.html:739-744,1265,1326`)
- HQ/News ส่ง secret เฉพาะ chat/meeting (`office-ui:1431,1492`; `newsdesk:1606,1668`) แต่ task/bug/tasks ไม่ส่ง

ปัจจุบันดูเหมือนใช้ได้เพราะ backend ไม่ตรวจ secret; เมื่อ restore guard action จะ 403 และผู้ใช้กรอก secret ไม่ได้ วิธีแก้คือเลือก auth contract เดียวสำหรับทุกหน้า/action และให้ server เป็นผู้บังคับใช้

### P2-06 — `getLive/getTasksBlock` cache สถานะงานผิดได้นาน 120 วินาที

`route.js:87-105` cache text ซึ่งรวม `getTasksBlock` ที่ `:103` หลัง task claim/done/bug insert ไม่มี invalidation AI จึงเห็น pending/running เก่าหรือไม่เห็นงานใหม่ได้ 2 นาที โดย bug branch โหลด `live` ก่อน insert (`:163-164` ก่อน `:181-188`) ทำให้อาร์คไม่เห็น bug ที่เพิ่งรับแม้อยู่ engineering scope วิธีแก้: แยก cache เอกสารคงที่ออกจาก task query, query task สดหรือ invalidate per scope หลัง mutation

### P2-07 — ไม่มี idempotency สำหรับ task/bug retry

`route.js:148-150,185-188` สร้าง ID ใหม่จากเวลา+random ทุก request; client ไม่มี request ID หาก DB insert สำเร็จแต่ response ขาด/timeout ผู้ใช้ retry จะสร้างคำสั่งซ้ำ โดย bug เสี่ยงสูงขึ้นเพราะ insert แล้วรอ AI ที่ `:191` วิธีแก้: client-generated idempotency key + unique constraint/upsert และแยก durable enqueue จาก slow acknowledgement

### P2-08 — Meeting filter ไม่ enforce ผู้เข้าร่วมตาม scope

`route.js:126-130` สร้าง `panel` ตาม scope แต่ `:138-140` filter เพียงว่ามี handle ใน global `ROSTER` Stub ที่คืน `sun` + `arch` สำหรับ engineering ยอมทั้งคู่แม้ `sun` ไม่อยู่ panel วิธีแก้: normalize handle แล้ว enforce `panel.includes(handle)` และ coverage/order ที่คาด

### P2-09 — ES2018 violation ที่พิสูจน์ได้: `import.meta`

`public/company/server.mjs:8` ใช้ `import.meta.url` ซึ่งเป็น ES2020 Strict Acorn `ecmaVersion:2018` fail ที่บรรทัดนี้ แม้ `node --check` บน Node v24 ผ่าน หาก baseline ต้องเป็น ES2018 จริง ให้ derive executable directory จาก `process.argv[1]` สำหรับ entry script หรือเปลี่ยน packaging เป็น CommonJS/วิธีที่รองรับ baseline; หาก baseline คือ Node รุ่นใหม่ ให้แก้เอกสาร compatibility แทน

### P2-10 — Local server เขียน event/outbox ไม่ atomic และ error contract ไม่ตรงมาตรฐาน

`server.mjs:38-40` append chat ก่อน pending เป็นสอง write; process/filesystem error ระหว่างกลางทำให้จอมีข้อความแต่ไม่มีงานตอบ `:55-57` คืน 500 `{ok,error}` ไม่มี `success/errorType`; `readBody` ที่ `:17` destroy เมื่อเกิน 100KB แต่ไม่มี reject/close handler จึงเสี่ยงค้าง Promise วิธีแก้: validate body/empty/scope, จำกัดขนาดด้วย explicit 413, ใช้ durable outbox/atomic strategy และ error JSON convention เดียวกัน

### P2-11 — self-fetch ไม่มี timeout ภายใต้ `maxDuration=60`

`route.js:4` จำกัด 60 วินาที แต่ `getLessons` ที่ `:57-64`, `fetchMd`/`getLive` ที่ `:76-105` ไม่มี AbortSignal/timeout และมีหลาย await ก่อน AI หาก self-fetch หรือ Supabase hang platform อาจตัด 504 ก่อน catch ส่ง error JSON วิธีแก้: timeout budget ต่อ dependency, parallel independent reads และเหลือ budget สำหรับ AI/response

### P3-01 — ป้าย “สมอง/โมเดล” บน 3 หน้าไม่ตรง model ที่ online route เรียก

ตัวอย่าง HQ แสดง Fable/GPT ที่ `office-ui/office.html:681,750-772`, News แสดง Sol-Codex ที่ `newsdesk/office.html:818`, Engineering แสดง GPT-5.6 ที่ `engineering/office.html:662,676` แต่ online route map `phupha→opus`, `jo/rev/sol/terra→sonnet`, `zip/luna→haiku` ที่ `route.js:35-42` Comment `:34` ระบุว่า online ใช้ Claude substitute จึงอาจเป็น design แต่ UI ไม่บอกความต่างระหว่าง workflow brain กับ online proxy ควรแก้ label/tooltip ให้ตรง runtime

### P3-02 — ปิด chat panel แล้ว more menu/task popup ยังเปิดค้าง

`closeChatPanel()` ของทั้ง 3 หน้าเปลี่ยนเฉพาะ panel class/aria (`office-ui:1534-1537`; `newsdesk:1710-1713`; `engineering:1368-1371`) ไม่ reset `moreMenu/tasksPopup` เปิดใหม่จึงเห็น state เดิม ไม่มี Escape/outside-click/`aria-expanded` วิธีแก้: reset transient UI state เมื่อปิดและเพิ่ม keyboard semantics

### P3-03 — Invalid body/scope/to สร้าง error หรือ task ที่ไม่มี consumer

`route.js:114-124` หาก JSON เป็น `null`, destructure ที่ `:115` ไป catch เป็น 500 แทน 400; scope/to ไม่มี allowlist และ `:145-150` รับ arbitrary value จึงสร้าง task ที่ไม่มีหน้า/worker เห็นได้ วิธีแก้: schema validation + 400 errorType, allowlist `main/newsdesk/engineering` และ handle ตาม roster

### P3-04 — Absolute paths ใช้ได้วันนี้แต่เปราะเมื่อย้ายโปรเจกต์/อัปเดต Codex

`.claude/workflows/newsdesk-bridge.js:56`, `eng-fix.js:23`, `company-reply.js:16` hard-code project/Codex install path ตรวจแล้ว path เหล่านี้มีอยู่จริงบนเครื่องปัจจุบัน จึงไม่ใช่ current missing-file แต่จะพังเมื่อย้าย backup folder หรือ binary hash เปลี่ยน ควร derive จาก workflow/project root และ config ที่ validate ตอน boot

## จุดเชื่อมที่ขาด

### 1. `company_tasks` ไม่มี dispatcher ไป workflow ใน code ที่ตรวจ

Targeted symbol search พบ producer/readers เพียง `route.js` และ `scripts/company-tasks.mjs`; CLI มีแค่ `list/claim/done/fail` ไม่เรียก `eng-fix`, `newsdesk-bridge` หรือ workflow อื่น ขณะที่ workflow รับ args คนละ schema ดังนั้นคำว่า “ทีมจะลงมือเมื่อผู้จัดการประมวลคิว” พึ่ง manual/external manager ที่ไม่ปรากฏและไม่มี health/lease/audit ในระบบนี้

สิ่งที่ต้องเพิ่ม: dispatcher ที่ atomic claim ตาม scope/type/assignee, map record เป็น workflow args, persist execution ID/owner/lease/result, heartbeat/retry/dead-letter และห้าม execute arbitrary command จาก `command` โดยตรง หากตั้งใจให้ manual ต้องระบุ runbook และ UI ต้องบอกสถานะ “รอผู้จัดการภายนอก” ไม่ใช่สื่อว่า workflow เริ่มเอง

### 2. แจ้งบั๊กข้ามแผนกส่งถึง engineering แต่ผู้แจ้งตามผลไม่ได้

`route.js:185-187` เก็บ bug เป็น `scope:'engineering'`; popup ของ HQ/News ส่ง `action:tasks` ด้วย scope ห้องต้นทางและ route filter scope ที่ `:159` จึงไม่เห็น bug นั้น UI ได้ `bugTaskId` แต่ไม่เก็บ/แสดง/ใช้ fetch by ID ผลแก้จึงไม่ย้อนกลับผู้แจ้งโดย contract

ควรเก็บ `sourceScope/sourceMessageId/requester`, มี lookup by task ID ที่ authorize แล้ว และ mirror/status notification กลับห้องต้นทางเมื่อ running/done/failed

### 3. Local JSONL queue กับ Supabase queue เป็นคนละระบบโดยไม่มี sync

`server.mjs` เขียน `_pending.jsonl` สำหรับ say/meeting; online route เขียน `store_items/company_tasks` สำหรับ task/bug; `company-reply` อ่านเฉพาะ JSONL และ `company-tasks.mjs` อ่านเฉพาะ Supabase ไม่มี bridge/dedupe/consistent IDs จึงได้พฤติกรรมต่างกันตามว่าเปิดผ่าน Next หรือ port 8787

ต้องกำหนด source of truth เดียว หรือมี explicit adapter/outbox ที่รักษา ID และ status semantics เดียวกัน

### 4. Proposal → approval → apply ไม่มี immutable linkage

`eng-fix` และ `newsdesk-bridge` ใช้ boolean/nonempty IDs แทน approval artifact ไม่มี proposal hash, approver, approved file/lead set, expiry หรือ one-time token จึงพิสูจน์ไม่ได้ว่าสิ่งที่ลงมือคือสิ่งที่อนุมัติ

### 5. `getLive/getTasksBlock` ไม่ใช่แหล่ง truth ที่เชื่อถือได้ในปัจจุบัน

limit-before-filter, swallowed DB errors และ 120s cache ทำให้ข้อมูลที่ป้อน persona เป็น “คิวว่าง/คิวเก่า” ได้ ต้องแยก source health จาก empty state และแนบ timestamp/degraded flag ให้ agent ห้ามอ้างว่าเป็นข้อมูลจริงเมื่อ fetch fail

### 6. Online conversation อยู่แค่ localStorage ไม่เชื่อม shared company record

office ทั้ง 3 หน้าเก็บ online exchange/history ใน `localStorage` ต่อ scope แล้วส่ง 8 turn กลับ API; ไม่มี server conversation ID, cross-tab merge หรือ linkage กับ local `chat.md`/workflow จึงไม่ใช่ shared company chat จริง หลายเครื่อง/แท็บเห็นประวัติต่างกันและ last-writer localStorage สามารถทับกันได้ หากต้องการเพียง client convenience ควรระบุ; หากต้องการ audit/shared memory ต้องมี server-side append-only conversation store

## ข้อเสนอ

### ลำดับแก้ที่แนะนำ

1. **Contain P0 ทันที** — ปิด/guard `/api/company/chat`; ระงับ Codex shell runners ที่รับข้อความดิบจนเปลี่ยนเป็น argv/prompt-file; จำกัด route ต่อ owner เท่านั้น
2. **หยุด data loss** — เปลี่ยน `company-reply` เป็น atomic spool/ack/requeue; แก้ bug false success; เพิ่ม DB query error handling
3. **ทำ queue ให้เป็น state machine จริง** — DB-side filtering, atomic claim, owner/lease/idempotency, stale recovery, retention/pagination และ dispatcher ที่มี execution record
4. **ซ่อม contract 3 หน้า/2 runtime** — auth payload เดียว, action capability negotiation, engineering scope end-to-end, local index links และ UI degraded state
5. **ผูก approval กับ artifact** — proposal ID/hash + exact file/lead set + approver; code-enforced path allowlist; actual diff/test/review gate
6. **ลด race/false status** — only-latest polling, preserve last-known data, invalidate task cache, return `queued/aiAck` แยกกัน และ notification กลับ source scope
7. **ทำ observability** — metric pending/running age, claim owner/lease, dead-letter, query degraded, task ID visible, audit log ของ proposal/approval/execution โดยไม่เก็บ secret

### Acceptance tests ที่ต้องผ่านก่อนประกาศพร้อมใช้

1. ไม่ตั้ง auth config → ทุก action ตอบ 503; credential ผิด → 403; valid owner → contract ถูกทุก action
2. บังคับ Supabase insert/query error → ห้ามมี `success:true`/“ไม่มีงาน”; UI ต้องเก็บรายการเดิมและแสดง error
3. Seed terminal 60 + pending หลาย scope → CLI/UI/`getTasksBlock` เห็น pending ครบตาม pagination
4. ยิง concurrent claim 20 ตัวที่ task เดียว → มีผู้ชนะหนึ่งคน; worker ตาย → lease หมดแล้ว reclaim ได้
5. ใส่ JSONL มากกว่า 8 รายการและ append ระหว่าง processing → ไม่มีรายการหาย/ซ้ำ; forced AI/write failure แล้ว retry ได้
6. ส่ง shell metacharacter ทุกชุดผ่าน chat/workflow args → ปรากฏเป็น literal และไม่มี command/process เพิ่ม
7. Proposal run A แล้ว apply → exact hash/file set ของ A เท่านั้น; สร้าง plan ใหม่หรือ QA/review FAIL ต้อง blocked ไม่ใช่ applied
8. เปิด `http://localhost:8787/` → ลิงก์ทั้ง 3 เข้าได้; chat/meeting engineering เขียนและตอบในห้อง engineering; action ที่ไม่รองรับถูก disable/อธิบาย
9. จำลอง task responses กลับลำดับสลับ → state ล่าสุดเท่านั้นที่ render; 429/timeout ไม่ล้าง feed
10. รัน strict ES2018 parser ตาม baseline; ถ้ายังคง `import.meta` ให้ประกาศ baseline Node รุ่นที่รองรับแทนคำอ้าง ES2018

### ข้อสรุปสุดท้าย

ปุ่มและ event wiring ไม่ใช่ต้นเหตุหลัก: ชั้น UI ผูกครบและ syntax ส่วนใหญ่สะอาด แต่ระบบขาด boundary ที่บังคับด้วย code ระหว่าง “ผู้ใช้พูด” → “AI ตัดสิน” → “shell/ไฟล์/ฐานข้อมูลเปลี่ยนจริง” เมื่อรวม unauthenticated API, command construction, queue truncation และ approval แบบ prompt-only แล้ว ความเสี่ยงปัจจุบันคือทั้ง **unauthorized action, remote command execution, silent data loss และ false-success** ควรแก้ P0/P1 และทดสอบ acceptance ข้างต้นก่อนเปิดให้เป็นระบบบริษัท AI ที่สั่งงานจริง
++ b/public/company/departments/engineering/fixes/sol-ultra-audit.md
# รายงานตรวจระบบบริษัท AI แบบอิสระ — Sol Ultra Audit

วันที่ตรวจ: 21 กรกฎาคม 2026  
ผู้ตรวจหลัก: เรฟ (Sol Ultra, independent code review)  
ขอบเขตหลัก: `public/company/index.html`, office ทั้ง 3 หน้า, `public/company/server.mjs`, `src/app/api/company/chat/route.js`, `scripts/company-tasks.mjs` และ workflow 3 ตัวตามคำสั่ง  
วิธีตรวจ: อ่าน call chain จริงแบบมีเลขบรรทัด, เทียบ request/response contract, compile/syntax check, ES2018 parser, DOM ID scan และ in-memory stub execution โดย **ไม่เรียก AI/ฐานข้อมูล/endpoint จริง และไม่แก้โค้ดระบบ**

## สรุปผู้บริหาร

คำตัดสิน: **ระบบยังไม่ควรถูกถือว่าเป็น “ระบบสั่งงานจริงที่ปลอดภัยและไม่ทำงานหาย” จนกว่าจะแก้ P0/P1 ด้านล่าง**

สิ่งที่ทำงานถูกต้องคือชั้นปุ่มและ DOM: ปุ่ม `สั่งงานจริง`, `แจ้งบั๊กวิศวะ`, `เรียกประชุม`, `งานที่สั่ง` ใน office ทั้ง 3 หน้ามี element ID ครบ ไม่ซ้ำ มี `addEventListener` ครบ เมนู `เพิ่มเติม` เปิด/ปิดได้ และ task/bug/meeting กัน input ว่างก่อนยิง request จริง ปัญหาหลักอยู่หลังปุ่ม ได้แก่ authentication ที่หายไป, การตอบ success เท็จ, queue ที่ทำรายการตกหล่น, workflow ที่ล้างคิวก่อนทำเสร็จ, shell command injection และ approval gate ที่เป็นเพียงข้อความกำชับโมเดล

จุดเสี่ยงสูงสุดที่ยืนยันแล้ว:
