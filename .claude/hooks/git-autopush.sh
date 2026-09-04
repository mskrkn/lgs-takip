#!/bin/bash
# PostToolUse hook (Bash / git commit*): push the current branch right after
# a commit so it reaches GitHub without a separate manual push step.
cd "${CLAUDE_PROJECT_DIR:-$PWD}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null)

if [ -z "$UPSTREAM" ]; then
  OUT=$(git push -u origin "$BRANCH" 2>&1)
else
  OUT=$(git push 2>&1)
fi

if printf '%s' "$OUT" | grep -qiE "error|fatal|rejected|failed"; then
  MSG="Git push basarisiz oldu, elle kontrol edin: $OUT"
else
  MSG="Git: '$BRANCH' GitHub'a push edildi."
fi

ESC=$(printf '%s' "$MSG" | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"systemMessage":"%s"}' "$ESC"
