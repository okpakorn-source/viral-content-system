# รายงานตรวจโค้ดอิสระรอบ 2 — Fable & Co.

วันที่ตรวจ: 21 กรกฎาคม 2026  
ผู้ตรวจหลัก: เรฟ (Sol Ultra, independent code review)  
ขอบเขต: workflow/สคริปต์ที่ระบุในคำสั่ง และการตรวจซ้ำ P0-02/P0-03/P0-04  
วิธีตรวจ: อ่าน source และ direct dependency แบบจำกัดขอบเขต, ตรวจ call chain/contract/เส้นทางข้อมูลจริง, ทำ execution-free probes ในหน่วยความจำ, ตรวจ syntax และ parse แบบ ES2018 โดย **ไม่เรียก AI, endpoint, database หรือ workflow จริง**

> หมายเหตุขอบเขต: ไม่พบ `scripts/backup-ai-brain.ps1` ใน working tree, Git index, `HEAD` หรือประวัติ Git ของ path นี้ จึงไม่มีเนื้อหา PowerShell ให้ตรวจในรอบนี้ รายงานนี้ไม่ตีความต่อว่าระบบ backup อื่นไม่มี แต่ acceptance ของไฟล์เป้าหมายนี้ยังปิดไม่ได้

## สรุปผู้บริหาร

คำตัดสิน: **ยังไม่ควรเปิด workflow ชุดนี้ให้รับ input ที่ผู้ใช้หรือระบบภายนอกควบคุม และยังไม่ควรประกาศว่า P0-02/P0-03/P0-04 แก้เสร็จ**

ผลตรวจซ้ำ patch ล่าสุด:

| ข้อ | คำตัดสิน | สรุป |
|---|---|---|
| P0-02 Shell injection | **ไม่ผ่าน** | `company-reply` และ Codex branch ของ `eng-fix` ลด direct shell interpolation บางส่วนจริง แต่ `newsdesk-bridge` ยังยอมให้ `$()`, backticks, quote และ `minScore` เข้า Bash; prompt-to-tools injection ยังอยู่ |
| P0-03 Queue loss/race | **ไม่ผ่าน** | atomic rename ลด race แบบ read/truncate แต่ยังย้ายทั้งคิวแล้วตัดเหลือ 8/12 ก่อนลบ processing file ทั้งก้อน; ไม่มี per-message ack, remainder, reclaim หรือ idempotency |
| P0-04 Approval/scope guard | **ไม่ผ่าน** | apply ตรวจเพียงว่า plan file มีอยู่ แต่ไม่ใช้/เทียบ content ที่อนุมัติ; guard เป็น lexical prefix ที่ traversal/case/dot-segment/symlink ข้ามได้ และ company target ยัง auto-apply |

บั๊กใหม่ระดับ P0 ที่พบในไฟล์ที่ไม่เคยตรวจมี 3 เส้นทางหลัก:

1. ลีดข่าวที่บันทึกจาก endpoint สามารถพา `$()`/backticks ไปถึง Bash ใน `newsdesk-meeting` ได้
2. `args.base` ของ `newsdesk-audit` เข้า `curl` โดยไม่ validate ทำ shell injection/SSRF ได้
3. `projectDir` ของ `project-intake` เข้า Codex command และ path เขียนไฟล์โดยไม่ canonicalize ทำ command injection และ scope escape ได้

นอกจากนี้พบ persistent knowledge poisoning, same-file parallel writers, false-success ของ workflow/queue, path traversal ผ่าน `runId`, shared Markdown race และ ES2018 regression รายละเอียดอยู่ด้านล่าง

สิ่งที่ patch ทำดีขึ้นแต่ยังไม่พอ:

- `company-reply.js:71-80` เอา raw question ออกจาก shell argument โดยตรงแล้ว
- `company-reply.js:43-49` เปลี่ยนจาก truncate คิวเป็น rename ก่อนประมวลผล จึงลด producer-vs-truncate race หนึ่งชนิด
- `eng-fix.js:135-136` ใช้ quoted command substitution อ่าน task file; shell metacharacter ที่เป็น “ผลลัพธ์จากไฟล์” จะไม่ถูก parse ซ้ำเป็น shell syntax โดยตรง
- `newsdesk-bridge.js:25-28,43-51` จำกัดอักขระของ send ID แบบ string ได้บางส่วน

แต่การทดสอบเพียง `node --check` ไม่สามารถพิสูจน์คุณสมบัติด้าน injection, queue semantics, approval binding, path containment หรือ ES2018 baseline ได้

## คำตัดสิน P0 fixes

### P0-02 — ไม่ผ่าน: direct shell injection และ prompt-to-tools bypass ยังเหลือ

#### จุดที่ยังโจมตีได้

1. **`newsdesk-bridge` คืน BASE ดิบหลังตรวจเพียง protocol**

   - `.claude/workflows/newsdesk-bridge.js:16-23` ใช้ `new URL()` แต่คืน `base` เดิม ไม่คืน canonical URL และไม่เทียบ exact origin
   - `.claude/workflows/newsdesk-bridge.js:41,85` นำ `minScore` ที่ไม่ validate เข้า command
   - `.claude/workflows/newsdesk-bridge.js:67,85` นำ `BASE` เข้า Bash ภายใน double quotes

   Execution-free probe ยืนยันว่า validator ปัจจุบันรับและคืนค่าเหล่านี้ครบ:

   - `https://example.com/$(whoami)`
   - ``https://example.com/`whoami` ``
   - `https://example.com/";echo INJECTED;#`
   - `https://127.0.0.1/internal` และ `https://[::1]/internal`

   Bash expand `$()` และ backticks แม้อยู่ใน double quotes; quote สามารถปิด argument ได้ ส่วน arbitrary HTTPS host/local address เปิด SSRF และป้อน response ที่ผู้โจมตีควบคุมกลับเข้า tool-capable agent

2. **invalid BASE fail-open ไป production**

   `.claude/workflows/newsdesk-bridge.js:30-37` เปลี่ยน BASE ที่ผู้เรียกระบุแต่ไม่ผ่านเป็น production default. เช่น `{base:"http://localhost:3000", sendIds:["lead1"]}` ซึ่งตั้งใจทดสอบ local จะกลับไปยิง production แทน

3. **send ID ยังไม่ใช่ strict typed/approved ID**

   `.claude/workflows/newsdesk-bridge.js:25-28,43-51` ใช้ `RegExp.test()` ซึ่ง coerce ค่า Execution-free probe ยืนยันว่า `null`, `123`, `true` และ `['abc']` ผ่าน regex ได้ ไม่มี length bound, dedupe, DB lookup หรือการผูกกับชุดที่อนุมัติจริง

4. **`company-reply` ย้าย injection จาก shell ไปหา agent ที่มี Write+Bash**

   `.claude/workflows/company-reply.js:72-80` วางคำถามผู้ใช้ใน delimiter `"""..."""` ของ prompt แล้วให้ Haiku เขียนไฟล์/รัน Bash และให้ Codex แบบ `workspace-write` “ทำตามคำสั่งในไฟล์ทั้งหมด” ข้อความที่ปิด delimiter หรือสวมคำสั่งใหม่จึงยังเปลี่ยนงานของ dispatcher ได้

5. **`eng-fix` ตรวจเฉพาะชื่อไฟล์ที่โมเดลประกาศ ไม่ได้ควบคุมคำสั่งจริง**

   `.claude/workflows/eng-fix.js:131-141` นำ `p.task` จาก diagnosis ไปให้ writer agent/Codex; task สามารถสั่งแตะไฟล์อื่นแม้ `p.files` ดูปลอดภัย และไม่มี post-write changed-path gate หยุดจริง

#### วิธีแก้ที่ต้องใช้

- เลิกประกอบ shell command string จากข้อมูลทุกชนิด; ใช้ host code เรียก `spawn/execFile` ด้วย argv และ `shell:false`
- ส่ง prompt/payload ผ่าน STDIN หรือไฟล์ที่ deterministic host สร้างแบบ exclusive, อยู่นอก `public/`, ชื่อสุ่มต่อ message และ cleanup ใน `finally`
- responder/reviewer/fact-checker ต้องใช้ read-only sandbox; ห้าม `workspace-write` หากงานไม่ต้องแก้ไฟล์
- BASE ต้องมาจาก server-side configuration หรือ exact-origin allowlist; reject explicit invalid value แทน fallback ไป production
- `minScore` ต้อง `Number.isFinite` และอยู่ในช่วง; send ID ต้อง `typeof === 'string'`, มี length limit, dedupe และ lookup กับ approval artifact

### P0-03 — ไม่ผ่าน: atomic rename แต่ยังทำข้อความหายแบบ deterministic

#### เส้นทางข้อมูลหายที่ยังอยู่

- `.claude/workflows/company-reply.js:43-49` ย้าย `_pending.jsonl` ทั้งไฟล์ไป processing
- `.claude/workflows/company-reply.js:51` เลือกเพียง 8 รายการ
- `.claude/workflows/company-reply.js:94` ตัด jobs เหลือ 12
- `.claude/workflows/company-reply.js:105-110` ลบ processing file ทั้งก้อนหลัง append chat

Execution-free probe:

- คิว 9 รายการ → `slice(0,8)` เหลือ 8 → รายการที่ 9 ถูกลบพร้อม processing file
- meeting 3 รายการ → 15 reply jobs → `slice(0,12)` ทิ้ง 3 jobs แต่คิวต้นทางถูกลบทั้งหมด

#### Race/recovery ที่ยังไม่ปิด

- `.claude/workflows/company-reply.js:41-42` processing filename มาจาก user `runId`/`Date.now()` ไม่มี exclusive create/lock; runId ที่ sanitize แล้วว่างชน `_processing-.jsonl`
- invocation ถัดไปอ่านเฉพาะ `_pending.jsonl` ที่ `:43-46`; targeted search ไม่พบ code reclaim `_processing-*` จึงเป็น “ทิ้งไฟล์ไว้” ไม่ใช่ recovery
- `.claude/workflows/company-reply.js:72` ใช้ `_ask-<handle>.txt`; สองข้อความถึง Codex handle เดียวกันถูก `parallel` พร้อมกันและชน write/read/delete ไฟล์เดียวกัน
- `.claude/workflows/company-reply.js:95` กรอง reply ที่เป็น falsy แล้วดำเนินต่อ ไม่มี mapping item→ack/retry; บางรายการล้มก็ยังลบ batch ได้
- `.claude/workflows/company-reply.js:100-103` ให้ LLM append chat ไม่มี lock/byte acknowledgement; concurrent invocation ทำ lost update ได้

#### วิธีแก้ที่ต้องใช้

สร้าง queue module แบบ deterministic: producer ใส่ stable message ID; consumer ใช้ UUID + exclusive lock/lease; parse JSONL ด้วย code; claim/ack ราย message; เก็บ remainder; retry/dead-letter; stale reclaim; idempotency หลัง crash และ append chat ด้วย host filesystem primitive ก่อน ack ห้ามให้ LLM เป็นผู้ย้าย/ลบ/ack คิว

### P0-04 — ไม่ผ่าน: plan “มีอยู่” แต่ไม่ใช่แผนที่ถูก apply

#### Approval mismatch ที่พิสูจน์ได้

- `.claude/workflows/eng-fix.js:55-68` สร้าง `diag`/plan ใหม่ทุก invocation
- `.claude/workflows/eng-fix.js:108-110` อ่าน plan เก่าเป็น `planCheck.content`
- `.claude/workflows/eng-fix.js:111-115` เช็คเพียง `found`
- `.claude/workflows/eng-fix.js:117-143` ใช้ `diag.plan` ใหม่; `planCheck.content` ไม่ถูก parse, compare หรือใช้ลงมือเลย

Trigger: สร้าง proposal ปัญหา A ด้วย runId `X` แล้วเรียก `{problem:"B", target:"newsdesk-prod", apply:true, runId:"X"}` ระบบเห็นเพียงว่าไฟล์ X มีอยู่ แล้ว apply แผนใหม่ของ B

`.claude/workflows/eng-fix.js:94-96` ยังระบุชัดว่า plan file “เขียนทับได้”; ไม่มี SHA-256, approver, approvedAt, exact file set, expiry, nonce หรือ one-time state

#### Path/scope guard bypass

`.claude/workflows/eng-fix.js:28-38` เปลี่ยน slash แล้วใช้ `startsWith/includes` โดยไม่ `resolve/relative/realpath`. Execution-free probes ยืนยันว่า guard ยอมรับ:

- `src/../../outside.txt` — prefix ผ่านและ resolve ออกนอก project
- `public/company/../../../outside.txt` — prefix ผ่านและ resolve ออกนอก project
- `src/lib/ai/./openai.js` — bypass critical exact substring แต่ resolve เป็นไฟล์หัวใจ
- `src/LIB/AI/openai.js` — bypass case-sensitive check บน Windows filesystem ที่ไม่แยก case

ยังไม่มี symlink/junction/reparse-point check หรือ revalidation หลัง writer จึงมี TOCTOU เพิ่มเติม และ allowlist เดียวใช้ทั้งสอง target: company code-allow `src/**`; newsdesk-prod code-allow `public/company/**`/workflow ทั้งหมด ซึ่งไม่ตรง `ZONE`

#### Approval/regression อื่น

- gate proposal มีเฉพาะ `TARGET === 'newsdesk-prod'` ที่ `.claude/workflows/eng-fix.js:90,106`; company ลงมือทันทีที่ `:122-143` แม้ risk medium/high
- `public/company/departments/engineering/ENG.md:42` ยังประกาศ args `{problem, scope, runId}` แต่ implementation อ่าน `target` ที่ `eng-fix.js:19`; caller เก่าที่ส่ง `scope:"newsdesk-prod"` ถูก coerce เป็น company และข้าม production gate
- runId ต่างกัน เช่น `a/b` กับ `a?b` canonicalize ชน `a_b`; default `fix` reuse artifact เก่าได้
- `.claude/workflows/eng-fix.js:143,167-172` ยังคืน `mode:"applied"` แม้ worker/QA/review ล้ม/FAIL และ writers ที่ไฟล์ทับกันยังรันพร้อมกัน

#### วิธีแก้ที่ต้องใช้

host ต้องสร้าง canonical proposal JSON + SHA-256 + random server ID; approval record อ้าง hash, approver, exact normalized paths, risk, revision, expiry และ atomic one-time state. Apply ต้องโหลดและใช้ artifact เดิมเท่านั้น. Path ต้องตรวจด้วย `path.resolve`/`path.relative` ต่อ target-specific roots, reject absolute/dot-segment/control/newline/glob/empty, case-fold ตาม Windows, `realpath` existing component และ reject reparse point; ตรวจ actual diff/changed paths หลัง writer และ FAIL ของ QA/review ต้อง block สถานะ applied

## บั๊กใหม่ที่พบ

### P0

#### R2-P0-01 — Research lead ไปถึง shell command ใน `newsdesk-meeting`

**ตำแหน่งหลัก**

- `.claude/workflows/newsdesk-meeting.js:13,16-17,31`
- call chain สนับสนุน: `src/app/api/desk/research/leads/route.js:54-61`, `src/lib/services/deskV2/researchLeads.js:160-185`, `src/lib/services/deskV2/dnaContract.js:41-46`, `.claude/workflows/newsdesk-bridge.js:83-95`

**Trigger/ผลกระทบ**

`candidate.title/summary/tone` หรือ `runId` ที่มี `$()`, backticks หรือ `$VAR` ถูกวางใน Codex command ภายใน double quotes; `LIST.replace(/"/g,"'")` ไม่ neutralize shell expansion. Codex ถูกเรียกด้วย `approval_policy=never -s workspace-write`

มี external source ที่พิสูจน์ได้: POST `action:saveBatch` ไม่มี auth ใน route เป้าหมาย; `sanitizeText()` ลบ control/ยุบ whitespace แต่คง shell metacharacter; bridge map title/snippet แล้วเรียก meeting จึงเป็น stored injection chain ไม่ใช่เพียง hypothetical local args

**วิธีแก้**

ปิด/authenticate `saveBatch`; แยก fact-check เป็น read-only host process; ส่ง candidates เป็น bounded JSON ผ่าน STDIN/argv โดยไม่ผ่าน shell และ validate `runId` เป็น opaque ID ที่ host สร้าง

#### R2-P0-02 — `newsdesk-audit` รับ arbitrary BASE เข้า Bash/SSRF

**ตำแหน่ง:** `.claude/workflows/newsdesk-audit.js:11-12,21-23`

**Trigger/ผลกระทบ:** `args.base` ถูกต่อใน `curl "<BASE>/..."` โดยไม่มี URL validation/allowlist. Quote/`$()`/backticks ทำ command execution; arbitrary scheme/host/local address ทำ SSRF/local read และ response ที่ควบคุมได้ถูกส่งต่อให้ writer agent

**วิธีแก้:** ใช้ host HTTP client + exact configured origin, disable/จำกัด redirects, egress allowlist, timeout/size cap และ parse response ด้วย code ห้ามใช้ raw response เป็น instruction ของ writer

#### R2-P0-03 — `project-intake.projectDir` เป็น command injection และ path escape

**ตำแหน่ง:** `.claude/workflows/project-intake.js:13-15,50-55,68,85-91,118-124`

**Trigger/ผลกระทบ**

- `projectDir='public/company/projects/x$(whoami)'` อยู่ใน double-quoted Codex command ที่ `:90`; Bash ทำ command substitution
- quote/backtick/newline สามารถเปลี่ยน argument/instruction ได้
- `..`, absolute/UNC path หรือ symlink/junction ใต้ projects ชี้ agent ไปอ่าน/เขียนนอก project
- `projectDir='/'` ผ่าน truthy check แล้วการตัด trailing slash ทำ `DIR=''`; path ที่สร้างกลายเป็น `/00-brief.md`, `/02-work/...`, `/03-report.md`

**วิธีแก้:** บังคับ relative path รูป `public/company/projects/<id>-<slug>`; canonicalize จาก repo root, ตรวจ `relative` containment, realpath existing components, reject symlink/junction/reparse/control/shell characters และใช้ argv/STDIN โดย `shell:false`

### P1

#### R2-P1-01 — Persistent prompt poisoning เข้าคลังคำสอนส่วนกลาง

**ตำแหน่ง:** `.claude/workflows/company-learn.js:8-20`; source `public/company/server.mjs:23-40`; consumer `src/app/api/company/chat/route.js:55-63,137,171-172`

server รับ `/api/say` แล้ว append raw chat โดยไม่มี auth; `company-learn` อ่าน chat ทั้งสองห้องและ `args.teach` ใน prompt เดียวกับ writer แล้วอาจ persist เป็น “คำสอนเจ้าของ” ที่ `lessons.md`; route นำไฟล์นี้เข้า system prompt ของพนักงานต่อเนื่อง เป็น durable cross-session poisoning

**วิธีแก้:** policy/lesson ต้องมาจาก signed owner artifact แยกจาก chat; model ทำ read-only proposal; host ตรวจ provenance/category/length แล้ว append หลัง approval พร้อม audit ID ห้ามให้ write-capable agent เรียนรู้ policy จากแชทดิบ

#### R2-P1-02 — `project-intake` มี same-file writers, stale artifact และ false-success

**ตำแหน่ง:** `.claude/workflows/project-intake.js:31-49,60,68,77,85-93,99-110,118-134`

- schema ไม่มี uniqueness/maxItems; assignment handle ซ้ำรันพร้อมกันแต่ใช้ `02-work/<handle>.md`, `_task-<handle>.txt` และ desk file เดียวกัน
- handle เดียวอยู่ work/review ทำ review ทับ deliverable ของ work
- รัน projectDir เดิมพร้อมกัน/ซ้ำใช้ `01-plan.md`, `03-report.md` และ task files เดิม; report อ่านทุกไฟล์เก่าค้างใน `02-work`
- `workFailed` นับเฉพาะ exact `null`; runner ที่ล้มแต่เขียน failure file/คืนข้อความไม่ถูกนับ และ review/report ยังเดินต่อ
- review result ถูกทิ้ง; return มี `reportPath` แม้ไฟล์รายงานไม่เกิด

**วิธีแก้:** unique handle/assignment ID, max roster size, per-project lock/lease/idempotency, run-scoped staging, atomic publish/backup, deterministic file existence+nonempty/hash checks และ block report/status success เมื่อ work/review ไม่ผ่าน

#### R2-P1-03 — `runId` path traversal และ prompt injection ใน hunt/meeting

**ตำแหน่ง:** `.claude/workflows/newsdesk-hunt.js:7-10,18-22`; `.claude/workflows/newsdesk-meeting.js:13,31,58-65`

`runId` ไม่ validate แต่ถูกต่อเป็น pathname/header/instruction. ค่า `/../../...` ทำ writer ถูกสั่งเขียนออกนอก `newsdesk/runs`; `theme` ของ hunt ก็อยู่ใน prompt เดียวกับ write instructions โดยไม่มี provenance/length boundary

**วิธีแก้:** `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, host-resolved containment + no-follow และ deterministic host writer; theme เป็น bounded untrusted field ไม่ใช่ instruction

#### R2-P1-04 — Audit ส่งข้อมูล remote/model-controlled ต่อให้ cross-department writer

**ตำแหน่ง:** `.claude/workflows/newsdesk-audit.js:18-26,34-42`

agent แรกอ่าน raw curl/archive แล้วแก้ `archive/jobs.md`; `audit.problems` ถูกส่งต่อให้ agent ที่สองซึ่งเขียนทั้ง engineering/newsdesk logs. Schema รับเพียง string ไม่ยืนยันว่า job อยู่ใน known set จึงเป็น indirect prompt injection/confused-deputy path

**วิธีแก้:** host parse bounded response, exact-match known job IDs/status enum, deterministic upsert/event log และให้ reporter ไม่มี filesystem tools

#### R2-P1-05 — `company_tasks` ยังอดคิว/claim ซ้ำ/overwrite และมี false OK

**ตำแหน่ง:** `scripts/company-tasks.mjs:26-38,41-46`

- query 50 แถวเก่าสุดแล้วค่อยกรอง pending ใน JS; terminal 50 แถว + pending แถว 51 ทำ `list` คืนว่าง
- SELECT→UPDATE ไม่มี current-status/version/owner/lease condition; manager สองตัว claim งานเดียวกันได้ และ terminal task ถูก claim ใหม่ได้
- update JSON ทั้ง record จาก stale read ทำ field/result ใหม่ของอีก worker หายได้
- update เช็คเพียง `up.error`; zero-row update หลัง row หาย/ถูกซ่อนสามารถพิมพ์ `OK` ทั้งที่ไม่มีอะไร persist
- worker crash ทิ้ง `running` ถาวรเพราะ list อ่านเฉพาะ pending

**วิธีแก้:** DB-side pending filter + cursor; transactional/RPC claim แบบ `FOR UPDATE SKIP LOCKED` หรือ compare-and-set ที่คืน affected row; owner/lease/version/attempt/idempotency; transition table; stale recovery/dead-letter และ fail closed ถ้า affected row ไม่เท่ากับ 1

#### R2-P1-06 — Prompt-file mitigation สร้างไฟล์ชนกันและข้อมูลชั่วคราวใต้ `public/`

**ตำแหน่ง:** `.claude/workflows/company-reply.js:42,72-80`; `.claude/workflows/eng-fix.js:131-137,152-158`; static serving `public/company/server.mjs:45-53`

- `_ask-<handle>.txt`, `_task-<run>-<handle>.txt`, `_review-<run>.txt` เป็น predictable shared names; parallel/retry ชน read/write/delete ได้
- ไฟล์ทั้งหมดอยู่ใต้ `public/company`; static server เสิร์ฟไฟล์ทุก extension ภายใต้ root
- `eng-fix` ไม่มี cleanup task/review file เลย; `company-reply` cleanup เป็นเพียงคำสั่งให้ agent ไม่มี `finally`
- processing queue ที่ค้างบน failure ก็อยู่ใต้ public path และอาจมีข้อความผู้ใช้

**วิธีแก้:** private temp directory นอก `public`, random O_EXCL filename ต่อ message/run, restrictive ACL, host-owned cleanup ใน `finally`, retention/reaper และห้ามเก็บ raw prompt หากไม่จำเป็น

#### R2-P1-07 — Shared Markdown writers ไม่มี lock/idempotency

**ตำแหน่ง:** `newsdesk-meeting.js:60-65`, `newsdesk-hunt.js:18-22`, `newsdesk-audit.js:20-25,36-41`, `company-learn.js:18-20`, `newsdesk-bridge.js:64-73`

workflow หลายตัวแก้ `worklog.md`, `comm-log.md`, `archive/jobs.md`, `lessons.md` ด้วย LLM Edit/Write; bridge ยังรัน sender หลายตัวพร้อมกันแล้วให้ append สองไฟล์เดียวกัน ทำ duplicate/lost update/status overwrite ได้

**วิธีแก้:** serialize writer ต่อ resource, immutable event log + idempotency key, atomic append/CAS และ materialize Markdown ภายใต้ lock แทน LLM read-modify-write

### P2

#### R2-P2-01 — ES2018 regression ใน `newsdesk-bridge`

`.claude/workflows/newsdesk-bridge.js:20` ใช้ optional catch binding `catch {}` ซึ่งเป็น ES2019. Acorn 8.16.0 ที่ล็อก `ecmaVersion:2018` parse fail ตรงบรรทัดนี้ ขณะที่ target อื่นในรอบนี้ผ่าน

**วิธีแก้:** ใช้ `catch (_error) { ... }` และเพิ่ม strict ES2018 parser ใน CI ไม่ใช่พึ่ง Node รุ่นปัจจุบัน

#### R2-P2-02 — Meeting schema ไม่ผูกผลโหวต/decision กับ candidate set

`.claude/workflows/newsdesk-meeting.js:19-20,34-35,52-67` ยอมรับ verdict array ว่าง, ID ซ้ำ, ID นอกชุด หรือขาดบาง ID; `mark()` แทนด้วย `?` แล้ว Ken ยังตัดสินต่อ และไม่มี host validation ของ `ken.decisions`

**วิธีแก้:** exact-set validation, one result per candidate, min/max items/length, reject unknown/duplicate/missing IDs และ fail closed/retry ก่อน return

#### R2-P2-03 — Audit ตัดปัญหา 600 ตัวอักษรแต่รายงานว่าส่งครบ

`.claude/workflows/newsdesk-audit.js:34-42,49-50` ใช้ `JSON.stringify(...).slice(0,600)` ซึ่งตัดกลาง JSON/ทิ้งรายการท้าย แต่ `reportedToEngineering` คืนจำนวนเต็มเดิมโดยไม่อ่านผล reporter

**วิธีแก้:** batch ราย item, max field length, ack ต่อ record และคืน actual reported/failed/remaining

#### R2-P2-04 — Timestamp/result semantics ของ task state ผิด

`scripts/company-tasks.mjs:35` ตั้ง `doneAt` แม้ transition เป็น `running`; `result || oldResult` ทำให้ done/fail ที่ส่ง empty string ล้างผลเก่าไม่ได้และอาจแสดงผล stale

**วิธีแก้:** `startedAt` เฉพาะ claim, `doneAt` เฉพาะ terminal, แยก `undefined` ออกจาก empty/null และ validate JSONB record ก่อนใช้งาน

#### R2-P2-05 — Contract ของ project plan ขัดกันและไม่มี fail-closed validation

`.claude/workflows/project-intake.js:31-49` enum อนุญาต `oat` แต่ prompt ที่ `:53` สั่งห้าม assign oat; ไม่มี maxItems/unique handle และ code ที่ `:60` เพียง drop unknown handle แล้วอาจเดินต่อโดยไม่มีงานผลิต/ผู้ตรวจ

**วิธีแก้:** host runtime schema validation, own-property allowlist, unique handle, max roster size, require อย่างน้อยหนึ่ง work และ review ตาม policy หรือบันทึก explicit waiver; invalid assignment ใด ๆ ต้อง block plan ทั้งชุด

#### R2-P2-06 — Invalid args กลายเป็น uncaught workflow failure

`newsdesk-meeting.js:11-16`, `newsdesk-hunt.js:7-9`, `newsdesk-audit.js:11-13`, `company-learn.js:8-9` parse JSON/อ่าน shape โดยไม่มี structured error boundary; เช่น candidates `[null]` ทำ `.id` throw ก่อน phase/logging

**วิธีแก้:** parse/validate ใน try/catch, จำกัด count/length/type และคืน error type/fallback ที่ชัดเจน

#### R2-P2-07 — ไฟล์ backup เป้าหมายไม่มีอยู่

`scripts/backup-ai-brain.ps1:ไม่มีไฟล์` — ไม่พบใน workspace, index, HEAD หรือ history จึงตรวจ injection/path/data-loss/PowerShell compatibility ไม่ได้

**วิธีแก้:** ยืนยันชื่อ/path ที่ถูกต้อง หรือ restore script จากแหล่งที่เชื่อถือได้ แล้วตรวจแยกเรื่อง destination containment, junction/reparse, overwrite policy, partial copy, retention, error propagation และ restore drill ก่อนใช้งาน

#### R2-P2-08 — เอกสาร fix อ้างคุณสมบัติที่ source ไม่มี

- `public/company/departments/engineering/fixes/p0-batch.md:44-47` อ้าง immutable/hash แต่ source ไม่มี hash และ apply ไม่ใช้ content
- `p0-batch.md:55` อ้างลบ task file แต่ `eng-fix.js:131-137` ไม่มี cleanup
- `p0-batch.md:66-70` เรียก protocol check ว่า allowlist ทั้งที่ arbitrary HTTPS host ผ่าน

**วิธีแก้:** เปลี่ยนเอกสารหลัง implementation/test จริงเท่านั้น และให้ acceptance test อ้าง observable invariant ไม่ใช่ `node --check`

## ข้อเสนอ

### ลำดับแก้

1. **Contain ทันที:** ปิด workflow ที่ประกอบ Bash จาก lead/base/projectDir/runId และปิด unauthenticated lead save/company chat จนมี auth/allowlist
2. **ย้าย side effect ออกจาก LLM:** process spawn, HTTP, queue move/ack, path resolution และ file append ต้องเป็น deterministic host code; LLM คืน structured proposal เท่านั้น
3. **ซ่อมคิว:** stable message ID, atomic claim, remainder, per-message ack, lease/reclaim, idempotency/dead-letter และ append acknowledgement
4. **ทำ approval จริง:** immutable canonical artifact + hash/approver/exact paths/expiry/one-time apply; actual diff containment และ QA/review fail gate
5. **กำจัด shared writer:** per-resource locks, unique private temp files, run-scoped staging และ atomic publish
6. **ซ่อม task state machine:** DB-side filter, transactional claim, owner/lease/version, transition constraints และ affected-row verification
7. **คืน ES2018 gate และ restore backup target:** parser CI + PowerShell script review/restore drill ก่อน sign-off

### Acceptance tests ก่อนประกาศผ่าน

- Injection corpus: `$()`, backticks, `$VAR`, quotes, newline, delimiter break, malicious BASE/minScore/runId/projectDir/lead title โดยใช้ process-spawn spy ยืนยันว่าไม่มี shell execute
- Queue: 9/50/51 records, concurrent producer/consumer, same runId, malformed JSONL, partial reply failure และ crash ทุกจุดระหว่าง claim→append→ack
- Approval: mismatch A→B, artifact tamper, overwrite, replay, concurrent apply, expired approval และ old `{scope:...}` caller
- Path: absolute/UNC, dot segments, mixed separators/case, control/newline, reserved Windows names, symlink และ junction/reparse TOCTOU
- State: double claim, terminal re-claim, stale lease recovery, zero-row update, concurrent done/fail และ result clear
- Compatibility: strict ES2018 parse ของ workflow bodies และ current-runtime syntax check

### สิ่งที่ตรวจแล้วไม่พบในขอบเขตนี้

- `scripts/company-tasks.mjs` ไม่มี shell/path construction และ Supabase `.eq()` ไม่ใช่ raw SQL concatenation
- `newsdesk-hunt` ไม่มี direct curl/shell/auto-publish; ความเสี่ยงของไฟล์นี้อยู่ที่ path/prompt/write boundary
- `company-learn` ไม่มี direct shell command ในตัวเอง; ความเสี่ยงคือ persistent policy poisoning ผ่าน privileged writer
- workflow เป้าหมาย compile บน Node ปัจจุบันเมื่อ wrap ตาม runtime; strict ES2018 fail เฉพาะ `newsdesk-bridge.js:20`
- ไม่พบ secret ถูกพิมพ์ใน patch P0 ที่ตรวจ

### ข้อจำกัด

ไม่พบ source ของ workflow host ที่นิยาม `agent`, `parallel` และ schema enforcement ในขอบเขตที่ระบุ จึงยืนยัน sandbox/error semantics ภายนอก source ไม่ได้ อย่างไรก็ดี findings ด้าน direct command construction, deterministic slicing, unused plan content และ lexical guard เกิดจาก source ที่ตรวจโดยตรง และบางจุดระบุ `workspace-write` เอง จึงไม่ควรถูกยกเลิกด้วยสมมติฐานว่ามี sandbox ที่มองไม่เห็น

### บัญชีโมเดลที่ใช้จริง

| Run | Provider / model / mode | บทบาท | ผลการนำมาใช้ |
|---|---|---|---|
| R2-TERRA-01 | OpenAI / gpt-5.6-terra / ultra | เริ่ม worker | **failed ก่อน inference** — API ไม่รับ model override คู่กับ full-history fork; ไม่มีไฟล์เปลี่ยน |
| R2-TERRA-02 | OpenAI / gpt-5.6-terra / ultra | ตรวจ workflow ชุด A | **accepted หลัง Sol ตรวจซ้ำ** — ใช้ call chain meeting/audit/learn และ schema/race findings; ไม่มีไฟล์เปลี่ยน |
| R2-LUNA-01 | OpenAI / gpt-5.6-luna / ultra | ตรวจ project-intake/scripts | **accepted หลัง Sol ตรวจซ้ำ** — ใช้ path/queue/state findings; ไม่มีไฟล์เปลี่ยน |
| R2-SOL-01 | OpenAI / gpt-5.6-sol / ultra | independent P0 audit | **accepted/reconciled** — ยืนยัน P0 ทั้งสามไม่ผ่านและ regression/compatibility; ไม่มีไฟล์เปลี่ยน |
| R2-SOL-ROOT-01 | OpenAI / gpt-5.6-sol / ultra | coordinator/final auditor | **accepted** — ตรวจ source/probes/diff จริง สังเคราะห์และเขียนรายงานไฟล์นี้เพียงไฟล์เดียว |

## ข้อสรุปสุดท้าย

patch ล่าสุดเป็น **partial mitigation** ไม่ใช่ P0 closure: rename ไม่เท่ากับ queue acknowledgement, plan existence ไม่เท่ากับ approved-plan binding, และ HTTPS parse ไม่เท่ากับ origin allowlist/shell safety. ต้องปิด direct shell boundary ก่อน จากนั้นทำ queue/approval/path enforcement ด้วย deterministic code และทดสอบ invariants ข้างต้น จึงค่อยส่งตรวจรอบถัดไป
