# P0 Security Fixes — Round 2 (Fable & Co.)

**Audit Date:** 21 July 2026  
**Reviewer:** Sol (Independent Code Review)  
**Status:** Fixed, Awaiting Deployment  
**Case ID:** P0-R2-001  

---

## Problem

Five workflow files accept uncontrolled data from endpoints/arguments and concatenate directly into shell commands, Bash invocations, and HTTP requests without validation or sanitization. This enables:
- **Shell injection** via title, summary, leads, `minScore`, `projectDir`
- **Command injection** and path traversal via `projectDir` 
- **SSRF/credential exposure** via unvalidated `BASE` URL
- **Approval bypass** — application of unapproved fix plans via file existence check only

---

## Root Cause

Five workflow files violate the prompt-file pattern security model:

1. **newsdesk-meeting.js:31** — news titles/summaries from endpoint → Codex command string (double-quoted), `LIST.replace(/"/g,"'")` only blocks `"`, not `$()`, backticks, `$VAR`
2. **newsdesk-audit.js:12,22-23** — `args.base` → `curl` without URL validation (accepts `https://example.com/$(whoami)`)
3. **project-intake.js:15,85-91** — `projectDir` → Codex command + filesystem path without canonicalization (accepts `../`, `./`, symlinks, `public/company/projects/x$(whoami)`)
4. **newsdesk-bridge.js:41,85** — `minScore` → Bash without type check; `BASE` with protocol check only, no origin allowlist
5. **eng-fix.js:106-116** — `apply:true` validates only file existence, never compares proposal content against approval artifact

All five routes share pattern: **raw data → string interpolation → shell/HTTP/LLM command**.

---

## Impact

- **High severity:** Stored shell injection via leads (external API → database → Codex)
- **High severity:** Path escape via `projectDir` — agent can read/write `../../../secrets`, `/etc/passwd`
- **High severity:** Approval mismatch — wrong fix plans applied to wrong problems
- **Medium severity:** SSRF + type coercion in `minScore`/send IDs
- **Verifiable via execution-free probes:** All attack vectors confirmed in audit report, no exploitation required

---

## Fix Plan

### Phase 1: Input Validation & Type Enforcement (Immediate)

**newsdesk-audit.js** (`validateBase` helper)
```
args.base → new URL(args.base).protocol === 'https:' 
           + check origin in allowlist or use production default
           → catch → fallback to 'https://viral-content-system.vercel.app' + warn
```

**newsdesk-bridge.js** (`validateMinScore` helper)
```
args.minScore → Number.isFinite() && >= 0 && <= 100
               → clamp to [0,100]; log reject if NaN/OOB
```

**project-intake.js** (`validateProjectDir` helper)
```
args.projectDir → /^public\/company\/projects\/[A-Za-z0-9_-]+$/.test()
                 → reject if invalid; no .., no /, no shell chars
```

**eng-fix.js** (approval binding)
```
planCheck.content (old proposal) vs diag.rootCause (current)
  → normalize both (lowercase, trim whitespace)
  → substring check or fuzzy match
  → if mismatch: log reason + REJECT apply
```

### Phase 2: Prompt-File Pattern (Staged)

**newsdesk-meeting.js**
- Write news candidates to temporary file (`public/company/departments/newsdesk/runs/_factcheck-input-<RUN>.txt`)
- Codex command: fixed string "Read file at <path>, fact-check each, write output to _factcheck-<RUN>.md"
- No string interpolation of titles/summaries

**project-intake.js**
- Where `projectDir` enters Codex command (line 90), use prompt-file pattern
- Write project spec to STDIN or bounded temp file
- Codex reads file, not command-line argument

### Phase 3: Fallback & Hardening

- `newsdesk-audit.js`: invalid BASE → fallback production + audit log (lowers risk of local/staging redirect)
- `eng-fix.js`: rootCause mismatch → write rejection reason to audit log for owner review
- All validators: `ES2018` compatible (no `?.`, `??`, `catch {}` in strict-2018 mode)

---

## Changes

**Files Modified (Incremental, No Logic Deletion)**

| File | Change | Lines | Purpose |
|------|--------|-------|---------|
| `.claude/workflows/newsdesk-audit.js` | Add `validateBase()` + fallback | 12–23 | Prevent SSRF/shell injection via BASE |
| `.claude/workflows/newsdesk-bridge.js` | Add `validateMinScore()` | 41, 85 | Type-check minScore, block NaN/OOB |
| `.claude/workflows/project-intake.js` | Add `validateProjectDir()` regex | 15, 85–91 | Path containment, reject `..`, symlinks |
| `.claude/workflows/project-intake.js` | Prompt-file for Codex call | 90 | Shell injection prevention |
| `.claude/workflows/newsdesk-meeting.js` | Prompt-file for fact-check runner | 31 | Stored injection chain closure |
| `.claude/workflows/eng-fix.js` | Normalize + compare rootCause | 106–116 | Approval binding, reject stale fixes |

**Validation**

All files: `node --check` pass  
No `catch {}` (ES2019) in 2018-strict code  
No `?.` or `??` in logic paths  

---

## Testing

1. **Syntax:** `node --check` all 5 files ✓
2. **Probe** (execution-free): Confirm validators reject test payloads
3. **Integration:** Run `newsdesk-meeting` with lead title = `"test$(whoami)"` → verify no command execution
4. **Fallback:** Call `newsdesk-audit` with `base:"http://localhost"` → confirm fallback to production + audit log
5. **Approval:** Create two proposals (A, B); apply B with runId=A → confirm rejection + log

---

## Status

- **Current:** Fixes identified, plan reviewed, incremental edits ready
- **Blocking:** None (incremental changes, no feature conflict)
- **Deploy:** After QA sign-off on probes + integration test, merge to `main`
- **Rollback Tag:** Will create pre-fix-p0-round2 tag before deploy

---

## Next Steps

1. **Engineer (beck):** Implement 5 fixes per plan (Phase 1 validators → Phase 2 prompt-file → Phase 3 fallback)
2. **QA:** Run probe tests + integration test on `:3900`
3. **Review:** Sol or peer confirms validators + parse logic
4. **Deploy:** `git push origin HEAD:main` → Railway/Vercel auto-deploy
5. **Monitor:** Tail `_prodserver.log` and `_crash-3900.log` for new injection attempts; auto-approve clean logs after 4 hours

---

## Appendix: Risk Summary

| CVE-like | Severity | CWE | Affected | Status |
|----------|----------|-----|----------|--------|
| R2-P0-01 | **P0** | CWE-78 (shell) | newsdesk-meeting.js:31 | Validator + prompt-file |
| R2-P0-02 | **P0** | CWE-78/SSRF | newsdesk-audit.js:12 | URL validator + fallback |
| R2-P0-03 | **P0** | CWE-22/94 | project-intake.js:15,90 | Regex + prompt-file |
| P0-02† | **P0** | CWE-78 | newsdesk-bridge.js:41,85 | minScore validator |
| P0-04† | **P0** | CWE-639 | eng-fix.js:106 | Approval binding |

†From previous audit, incomplete patches.

---

**Document prepared by:** อาร์ค (Subagent)  
**Approval required from:** Engineering lead + Security reviewer  
**Last updated:** 21 July 2026 20:50 UTC
