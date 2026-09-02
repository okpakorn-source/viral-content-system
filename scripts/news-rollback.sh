#!/usr/bin/env bash
# ============================================================
# 🔙 scripts/news-rollback.sh — กลไกย้อนกลับระบบข่าว (3 ก.ย. 69)
# ------------------------------------------------------------
# ใช้จาก Git Bash ในโฟลเดอร์โปรเจกต์ (worktree main):
#   bash scripts/news-rollback.sh status              ดูว่า production ชี้ commit ไหน · แท็กจุดกู้ครบไหม · worktree สะอาดไหม (ไม่แตะอะไร)
#   bash scripts/news-rollback.sh dry-run <TAG>       แสดงคำสั่งที่จะรันทั้งหมดโดยไม่รัน + ตรวจเงื่อนไขก่อน (แนะนำรันก่อนทุกครั้ง)
#   bash scripts/news-rollback.sh code <TAG>          ⚠️ ย้อน production กลับไปที่ commit ของแท็ก (force-with-lease) → Vercel + บอท Railway deploy ตัวเดิมเอง
#   bash scripts/news-rollback.sh verify <TAG>        ตรวจหลังย้อน: origin/main == แท็ก · deploy ล่าสุดบน Vercel
#
# แท็กจุดกู้ (สร้างตอนปล่อยของทุกครั้ง · ชื่อ = news-prod-<sha7>-<วันที่>):
#   news-prod-736adca3-2sep69 = production ก่อนงานยกระดับ 13 ข้อ (2 ก.ย. 69)
#   news-prod-5b4b6064-3sep69 = ปล่อยเฟส 1–3 + เปิดกฎนักเขียนชุดใหม่ (3 ก.ย. 69)
#
# ระดับการย้อน (เลือกเบาสุดที่พอ):
#   ระดับ 1 (ไม่แตะโค้ด · ไม่ต้อง push): ปิดสวิตช์ใน Vercel env แล้ว Redeploy — ทุกฟีเจอร์ใหม่มีสวิตช์ ดู docs/NEWS-SWITCHES.md
#            กฎนักเขียนชุดใหม่: WRITER_LENGTH_TARGET_V2=0 WRITER_FIDELITY_RULES_V2=0 WRITER_VIRAL_RULES_V2=0
#   ระดับ 2 (เก็บประวัติ): git revert <commit> && git push origin HEAD:main
#   ระดับ 3 (สะอาด 100% = โค้ดเหมือน production เดิมทุกไบต์): สคริปต์นี้โหมด code <TAG>
# ข้อมูล: ไม่มี migration · ฟีเจอร์ใหม่เขียนได้แค่ store ใหม่ (bot-tracking · post-metrics ถ้าเคยรัน import) ซึ่งโค้ดเดิมไม่อ่าน = ทิ้งไว้ได้ไม่มีผล
#         ดัมพ์การ์ด/ครู/คิว ณ 2 ก.ย. อยู่ Desktop\ระบบข่าว-จุดกู้ก่อนยกระดับ13ข้อ-2-9-69\db (ถ้าต้องกู้ข้อมูล ดู 00-อ่านก่อน-วิธีกู้.md)
# ============================================================
set -euo pipefail
MODE="${1:-status}"
TAG="${2:-}"
REPO_API="repos/okpakorn-source/viral-content-system"
cd "$(git rev-parse --show-toplevel)"

say() { printf '%s\n' "$*"; }
die() { say "❌ $*"; exit 1; }

check_clean() {
  if [ -n "$(git status --porcelain)" ]; then die "worktree ไม่สะอาด — commit/stash ก่อน (git status --short)"; fi
}
resolve_tag() {
  [ -n "$TAG" ] || die "ต้องระบุแท็ก เช่น news-prod-736adca3-2sep69 (ดูรายการ: git tag -l 'news-prod*')"
  git rev-parse -q --verify "refs/tags/$TAG^{commit}" >/dev/null || die "ไม่มีแท็ก $TAG ในเครื่อง"
  TARGET="$(git rev-parse "refs/tags/$TAG^{commit}")"
}
show_status() {
  git fetch origin -q
  say "== จุดกู้ที่มี =="; git tag -l 'news-prod*' | while read -r t; do say "  $t → $(git rev-parse --short "$t^{commit}")  $(git log -1 --format=%s "$t^{commit}")"; done
  say "== ตอนนี้ =="
  say "  origin/main = $(git rev-parse --short origin/main)  $(git log -1 --format=%s origin/main)"
  say "  HEAD        = $(git rev-parse --short HEAD)"
  say "  worktree    = $([ -z "$(git status --porcelain)" ] && echo สะอาด || echo 'มีไฟล์ค้าง ❗')"
  if command -v gh >/dev/null 2>&1; then
    say "== deploy ล่าสุดบน Vercel (จาก GitHub deployments) =="
    gh api "$REPO_API/deployments?environment=Production&per_page=3" --jq '.[] | "  \(.created_at) \(.sha[0:8]) \(.ref)"' 2>/dev/null || say "  (อ่านไม่ได้ — gh auth status)"
  fi
}
case "$MODE" in
  status) show_status ;;
  dry-run|code)
    resolve_tag; git fetch origin -q
    CUR="$(git rev-parse origin/main)"
    say "จะย้อน origin/main: $(git rev-parse --short "$CUR") → $(git rev-parse --short "$TARGET") ($TAG)"
    [ "$CUR" != "$TARGET" ] || { say "✅ origin/main อยู่ที่ $TAG อยู่แล้ว ไม่ต้องทำอะไร"; exit 0; }
    git merge-base --is-ancestor "$TARGET" "$CUR" || die "แท็กไม่ใช่บรรพบุรุษของ origin/main — ไม่ใช่การย้อนกลับธรรมดา หยุดก่อน"
    say "commit ที่จะหายจาก production ($(git rev-list --count "$TARGET..$CUR") ก้อน):"; git log --oneline "$TARGET..$CUR" | sed 's/^/   /' | head -30
    CMD="git push --force-with-lease=main:$CUR origin $TARGET:main"
    if [ "$MODE" = "dry-run" ]; then
      say "== dry-run: คำสั่งที่จะรัน =="; say "   $CMD"; say "   (แล้วตรวจ: bash scripts/news-rollback.sh verify $TAG)"
      git push --dry-run --force-with-lease="main:$CUR" origin "$TARGET:main" && say "✅ git ยอมรับคำสั่ง (dry-run ผ่าน)"
      exit 0
    fi
    check_clean
    say "⚠️ กำลังย้อน production ใน 5 วินาที (Ctrl+C เพื่อยกเลิก) — บอท Railway จะรีสตาร์ต"; sleep 5
    eval "$CMD"
    git fetch origin -q
    [ "$(git rev-parse origin/main)" = "$TARGET" ] && say "✅ origin/main = $TAG แล้ว · Vercel/Railway กำลัง deploy ตัวเดิม (ตรวจ: bash scripts/news-rollback.sh verify $TAG)" || die "origin/main ไม่ตรงแท็กหลัง push"
    ;;
  verify)
    resolve_tag; git fetch origin -q
    [ "$(git rev-parse origin/main)" = "$TARGET" ] && say "✅ origin/main = $TAG ($(git rev-parse --short "$TARGET"))" || say "❌ origin/main = $(git rev-parse --short origin/main) ≠ $TAG"
    if command -v gh >/dev/null 2>&1; then
      say "deploy ล่าสุด:"; gh api "$REPO_API/deployments?environment=Production&per_page=3" --jq '.[] | "  \(.created_at) \(.sha[0:8]) \(.ref)"' 2>/dev/null || true
      DEP_ID="$(gh api "$REPO_API/deployments?environment=Production&per_page=1" --jq '.[0].id' 2>/dev/null || true)"
      [ -n "$DEP_ID" ] && gh api "$REPO_API/deployments/$DEP_ID/statuses" --jq '.[0] | "  สถานะล่าสุด: \(.state) \(.created_at) \(.environment_url // "")"' 2>/dev/null || true
    fi
    say "เฝ้าข่าวจริง: node C:/tmp/news-r233-run/watch-news.mjs $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    ;;
  *) die "โหมดไม่รู้จัก: $MODE (status | dry-run <TAG> | code <TAG> | verify <TAG>)" ;;
esac
