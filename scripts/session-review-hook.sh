#!/bin/bash
# vault 会话启动时检测今日 polyglot 复习 pending 文件。
# 不再主动跑 daily-review.mjs（那一步交给 8am scheduled task `polyglot-daily-review`）。

VAULT="/Users/xinyunh/Library/Mobile Documents/iCloud~md~obsidian/Documents/Xinyun_H"
TODAY=$(date +%Y-%m-%d)
PENDING="$VAULT/extras/polyglot-review/$TODAY.md"
REPO="/Users/xinyunh/Desktop/语言学习/polyglot-lexicon"

if [ ! -f "$PENDING" ]; then
  exit 0
fi

python3 - "$PENDING" "$TODAY" "$REPO" "$VAULT" <<'PY'
import sys, json, pathlib
pending_path, today, repo, vault = sys.argv[1:]
content = pathlib.Path(pending_path).read_text(encoding='utf-8')
preamble = (
  f"今日 polyglot 复习已由 8am routine stage 到 `extras/polyglot-review/{today}.md`。"
  "用户**没**主动说写入前，不要动 daily note，也不要跑 Firestore mark。\n\n"
  "当用户表达「写入 / 落到 daily / 今天复习 OK」之类意图时，按以下流程执行：\n"
  f"1. Read `extras/polyglot-review/{today}.md`\n"
  "2. 删掉末尾 `<!-- polyglot-review-ids: a,b,c -->` 注释行，把那串 IDs 记下。\n"
  f"3. 用 Edit 把剩余内容追加到 `calendar/days/{today}.md` 末尾（在 `###### Special notes` 之后）。\n"
  "4. 在终端运行 mark Firestore：\n"
  f"   ```\n   cd \"{repo}\" && set -a && . ./.env && set +a && node scripts/daily-review.mjs --mark-ids=<那串 IDs>\n   ```\n"
  f"5. 删除 pending 文件 `extras/polyglot-review/{today}.md`。\n\n"
  "—— 下面是 pending 文件全文，供用户预览参考 ——\n\n"
)
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": preamble + content}}))
PY
