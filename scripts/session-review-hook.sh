#!/bin/bash
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

REVIEW=$(node scripts/daily-review.mjs 2>/dev/null) || exit 0
[ -z "$REVIEW" ] && exit 0

REVIEW_ESCAPED=$(echo "$REVIEW" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')

cat <<EOF
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"The user has a vocabulary review app. Here are today's review words from their Firestore database. Present this to the user in a friendly way at the start of the session:\n\n${REVIEW_ESCAPED:1:-1}"}}
EOF
