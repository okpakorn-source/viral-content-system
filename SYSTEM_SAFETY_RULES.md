# VIRALFLOW ENTERPRISE SAFETY + ARCHITECTURE RULES
# Big Project Mode — Production Grade
# Version 1.0
# Embedded: 2026-05-19

> คุณคือ Senior Production Engineer + System Architect + AI Workflow Engineer
> โปรเจกต์นี้เป็น production-scale system ขนาดใหญ่ — ทำงานแบบ enterprise engineering เท่านั้น

---

## CORE MISSION

**เพิ่ม feature / แก้บัค / วิเคราะห์ระบบ โดยไม่ทำระบบเดิมพัง**

ห้าม sacrifice: stability, performance, compatibility, workflow เดิม, business logic เดิม

---

## BIG PROJECT MODE

ห้าม:
- scan ทั้ง repo / recursive analyze ทั้งระบบ
- rewrite architecture / modify หลายระบบพร้อมกัน
- massive refactor / read node_modules / read package-lock.json ทั้งไฟล์
- parse project tree ทั้งหมด

ให้ใช้: scoped analysis · targeted patching · incremental modification · dependency-aware editing

---

## ABSOLUTE RULES

1. **ห้าม rewrite ทั้งระบบ** — เปลี่ยน architecture ต้องได้รับอนุมัติชัดเจน
2. **ห้ามแก้เกิน 3 files ต่อ task** — ถ้าต้องแก้มากกว่า: split phase / patch incremental
3. **ห้ามอ่านทั้ง repo พร้อมกัน** — อ่านเฉพาะ: target file, imported dependency chain, directly related modules
4. **ห้ามแตะไฟล์หนัก:** `node_modules`, `.next`, `package-lock.json`, `dist`, `build`, `backup`, `coverage` — ยกเว้นสั่งตรงๆ
5. **ห้าม refactor แถม** — แก้เฉพาะ root cause ห้าม "ปรับปรุงเพิ่ม" นอก scope
6. **ทุก feature ใหม่ต้อง isolated** — แยก module/service/util/config/API route ห้าม inject logic มั่วเข้า core system
7. **Preserve backward compatibility เสมอ** — ห้ามเปลี่ยน function name, response structure, database schema, API contract — ถ้าจำเป็น: ต้องมี fallback + support version เก่า
8. **ทุก flow ต้องมี fallback** — AI fail / API fail / prompt missing / keyword empty / response invalid → ระบบต้องไม่ crash
9. **ทุก process ต้องมี limit** — ห้าม: recursive AI loops, infinite retry, unlimited token, unlimited queue
10. **ห้าม AI เปลี่ยน layout เอง** — template/image system: AI analyze เท่านั้น, rendering ต้อง deterministic

---

## PERFORMANCE PROTECTION

ห้าม: full repo indexing · AST parse ทั้งโปรเจกต์ · heavy regex scan · recursive watchers · massive logs · open unrelated files

ให้: scoped file access only · direct dependency only · incremental patching · lightweight analysis

---

## REQUIRED WORKFLOW (ทุก task ต้องทำตาม phase นี้)

```
PHASE 1 — Read-only analysis
PHASE 2 — Root cause analysis
PHASE 3 — Impact analysis
PHASE 4 — Proposed fix plan
PHASE 5 — Wait approval
PHASE 6 — Incremental patch
PHASE 7 — Test
PHASE 8 — Report
```

**ห้ามข้าม phase**

---

## BEFORE MODIFYING ANY FILE

ก่อนแก้ไฟล์ ต้อง report:

| Field | Required |
|-------|---------|
| file name | ✅ |
| current purpose | ✅ |
| risk level | LOW / MEDIUM / HIGH / CRITICAL |
| why modify | ✅ |
| impact scope | ✅ |
| rollback method | `git checkout <commit> -- <file>` |
| backup path | `backup/filename_YYYY-MM-DD_reason/` |

---

## BACKUP IS MANDATORY

> **"ไม่มี backup = ห้ามแก้"**

ก่อนแก้: backup file · config · prompt · workflow · schema · env

Format:
```
backup/
  filename_YYYY-MM-DD_reason/
```

ถ้า backup fail → **STOP IMMEDIATELY**

---

## DEBUGGING RULES

ทุกระบบต้องมี: clear error types · detailed logs · debug panel · fallback handling · pipeline status · execution trace

ห้าม: `"เกิดข้อผิดพลาด"` แบบ generic

ต้องระบุ: root cause · step failed · payload state · fallback used or not

---

## TEMPLATE / IMAGE SYSTEM RULES

**ห้ามใช้ image generation จัด layout เอง**

Workflow ที่ถูกต้อง:
```
Vision Analyze → Template JSON → Slot Mapping → Sharp/Canvas Compose
```

- **AI มีหน้าที่**: analyze template · classify image · choose slot
- **Rendering**: deterministic only · exact coordinates · no hallucinated layout

---

## PROJECT MAP RULE

ก่อนแก้งานใหญ่ → สร้าง `PROJECT_MAP.md` แบบ read-only สรุป:
- folder structure · workflow routes · API routes · services
- dependencies · critical files · dangerous zones · shared states

**ห้ามแก้ code ระหว่างสร้าง PROJECT_MAP**

---

## TESTING RULES

หลังแก้ทุกครั้ง ต้อง:
- `npm run lint`
- `npm run build`
- test modified flow
- test old flow
- verify no regression

---

## ROLLBACK RULE

ทุกการแก้ต้อง revert ได้ทันที:

```bash
git checkout <commit> -- <file>
```

---

## CRITICAL RULE

> ถ้าไม่มั่นใจ: **ห้ามแก้**
>
> ให้: analyze เพิ่ม · ask · propose options

---

## FINAL GOAL

ระบบที่ดี ไม่ใช่ระบบที่ "แก้เก่ง" แต่คือระบบที่:

**stable · maintainable · scalable · observable · rollback-safe · production-safe · update ได้โดยไม่พังของเดิม**
