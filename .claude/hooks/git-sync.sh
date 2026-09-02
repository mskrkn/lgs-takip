#!/bin/bash
# SessionStart hook: pull the current branch from origin so work from other
# computers shows up automatically, without the user having to ask for it.
cd "${CLAUDE_PROJECT_DIR:-$PWD}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
git fetch --quiet origin 2>/dev/null
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null)

if [ -z "$UPSTREAM" ]; then
  MSG="Git: '$BRANCH' dalinin uzak (origin) takip dali yok - bu dal push edilmeden diger bilgisayarda gorunmez."
else
  OUT=$(git pull --ff-only 2>&1)
  if printf '%s' "$OUT" | grep -qi "up to date"; then
    MSG="Git: '$BRANCH' zaten guncel."
  elif printf '%s' "$OUT" | grep -qiE "error|fatal|would be overwritten|conflict"; then
    MSG="Git pull basarisiz oldu, elle kontrol edin: $OUT"
  else
    MSG="Git: '$BRANCH' guncellendi -> $(git log -1 --format='%h %s' 2>/dev/null)"
  fi
fi

ESC=$(printf '%s' "$MSG" | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"systemMessage":"%s"}' "$ESC"
