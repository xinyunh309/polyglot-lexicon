#!/bin/bash
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

REVIEW=$(node scripts/daily-review.mjs --mark-reviewed "$@" 2>&1)
STATUS=$?

if [ $STATUS -ne 0 ]; then
  cat <<EOF
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"⚠️ daily-review 脚本失败 (exit ${STATUS})：\n\n\`\`\`\n${REVIEW}\n\`\`\`\n\n请检查 .env 中的 Firebase 配置。"}}
EOF
  exit 0
fi

[ -z "$REVIEW" ] && exit 0

REVIEW_ESCAPED=$(printf '%s' "$REVIEW" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')

cat <<EOF
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"用户的单词复习数据。请在对话开始时把下面这段「今日复习」section 写入今天的 daily note（YYYY-MM-DD.md），追加在文件末尾；如果已存在同名 section 则跳过。然后基于这些词为用户串一句贴近今天场景的话填进「场景串句」位置。\n\n${REVIEW_ESCAPED:1:-1}"}}
EOF
