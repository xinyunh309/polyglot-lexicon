---
name: polyglot-review
description: 每天早上 8 点抽词写入 Obsidian daily note + 法语场景串句，并把整段复习贴回对话框
---

你是 Xinyun 每天早上 8 点的 polyglot 复习 routine。把今日复习直接追加到 daily note，结束。**全程用 Bash 读写 vault 文件**（cat / grep / heredoc append），不要用 filesystem MCP 也不要用 Edit/Write 工具。

## 路径常量

仓库和 vault 路径在两台 mac 上不同，先探测：

```bash
# REPO: 公司 mac 在 Desktop/语言学习，家里 mac 在 Documents/Claude
for p in \
  "/Users/xinyun/Desktop/语言学习/polyglot-lexicon" \
  "/Users/xinyunh/Desktop/语言学习/polyglot-lexicon" \
  "/Users/xinyunh/Documents/Claude/polyglot-lexicon"; do
  [ -d "$p" ] && REPO="$p" && break
done

# VAULT: 公司 mac 用 xinyun，家里 mac 用 xinyunh
for p in \
  "/Users/xinyun/Library/Mobile Documents/iCloud~md~obsidian/Documents/Xinyun_H" \
  "/Users/xinyunh/Library/Mobile Documents/iCloud~md~obsidian/Documents/Xinyun_H"; do
  [ -d "$p" ] && VAULT="$p" && break
done

TODAY=$(date +%Y-%m-%d)
```

## 流程

### 0. 选目标日（**先做幂等检查再 fetch**）

```bash
# 从今天往回找最近一个没写过 📖 今日复习 的 daily note，最多回退 7 天
TARGET_DAY=""
for i in 0 1 2 3 4 5 6 7; do
  d=$(date -v-${i}d +%Y-%m-%d)
  f="$VAULT/calendar/days/$d.md"
  if [ -f "$f" ] && ! grep -q '###### 📖 今日复习' "$f"; then
    TARGET_DAY="$d"
    break
  fi
done
# 全找完都已写过 → 退出，今天什么都不抽
if [ -z "$TARGET_DAY" ]; then
  echo "近 7 天 daily notes 都已写过今日复习，跳过" >&2
  exit 0
fi
TARGET_FILE="$VAULT/calendar/days/$TARGET_DAY.md"
```

**关键**：先选目标日再 fetch Firestore。如果今天已写、且最近 7 天也都已写，直接退出，**不要白白抽词、白白消耗 SR 间隔**。

### 1. 抽词（取 IDs）

```bash
cd "$REPO"
# 兼容用户级 Homebrew（如 ~/homebrew，而非默认 /opt/homebrew）
[ -x "$HOME/homebrew/bin/brew" ] && eval "$("$HOME/homebrew/bin/brew" shellenv)"
set -a && . ./.env && set +a

# 家里 mac 上 Node 26 + undici 8 的 setGlobalDispatcher(ProxyAgent) 对全局 fetch 失效，
# 必须用 run-with-proxy.mjs wrapper（替换 globalThis.fetch）。
# 公司 mac 上没 proxy，wrapper 也能透传，所以统一走 wrapper。
PREVIEW_MD=$(NODE_EXTRA_CA_CERTS=${NODE_EXTRA_CA_CERTS:-/etc/ssl/cert.pem} \
  node ./run-with-proxy.mjs ./scripts/daily-review.mjs)
```

从 `$PREVIEW_MD` 末尾 `<!-- polyglot-review-ids: id1,id2,... -->` 注释行解出 `IDS`（逗号串）。

失败（非 0 退出、空输出、解不出 IDs）：notify 错误并退出，**不写 daily note、不 mark**。

### 2. 拉每个词的完整字段（含例句）

preview 输出只有 word/pos/meaning/pron，没有例句也没有同/反义；用 `./fetch-entries.mjs`（同样是 wrapper-style，处理 home mac 的 proxy 问题）：

```bash
WORDS=$(IDS="$IDS" NODE_EXTRA_CA_CERTS=${NODE_EXTRA_CA_CERTS:-/etc/ssl/cert.pem} \
  node ./fetch-entries.mjs)
```

`fetch-entries.mjs` 输出 JSON 数组（每个 entry 含 id/word/lang/pos/meaning/sentences）。失败同步骤 1：notify 并退出。

### 3. 选场景

```bash
[ -f "$TARGET_FILE" ] && cat "$TARGET_FILE"
```

定位 `###### Scheduled` H6 section，提取下面的 `- [ ]` / `- [x]` bullets。

挑一个作为场景：
- 优先级：社交/生活/运动（蹦床、约朋友、健身、私教、晚餐、看展、约会、家庭）> 通勤/出行 > 工作（会议、客户、销售、pipeline）
- bullet 文本里的**时间、地点、人名**保留进场景描述
- `$TARGET_DAY` 的 Scheduled 全空 → 回退到前一天，再空再退，**最多回退 3 天**
- 全都空：场景 = `"暂无明确安排"`
- 存为 `SCENARIO`（人话短句，例：`"晚上 19:35 和 Jay 在长宁来福士蹦床"`）

### 4. 法语串句

用 `$WORDS` 里的所有法语词写**一段法语**紧扣 `$SCENARIO` 的话：

- 使用**所有**法语词（一般 9 个，少于就全用），用 `**word**` 加粗每个目标词
- 句首带 🇫🇷
- **不要造笔记里没有的事实**（"和 Jay 蹦床" 因为 Scheduled 里有所以 OK；编造 "和爸妈通电话" 不 OK）
- 第一人称（je）或泛泛叙述都行，不要"她"、"用户"
- 时态：场景源自过去的 Scheduled（`[x]` 已完成或 `$TARGET_DAY` 已经过去）→ 用 passé composé/imparfait；场景源自未来的 Scheduled → 用现在时或未来时
- **只写法语一段**——非法语词不写串句

存为 `FR_SENTENCE`。

### 5. 拼 📖 section

格式（每词一行，紧凑；非法语词紧跟一行法译 blockquote）：

```
###### 📖 今日复习

**🇫🇷 法语** (N)
- **{word}** *{pos}* — {meaning}：*{example_target}* — {example_translation}
- **{word2}** *{pos}* — ...
- ...

**🇮🇹 意大利语** (M)
- **{word}** *{pos}* — {meaning}：*{example_target}* — {example_translation}
 > *{法语对照翻译}*

- **{word2}** *{pos}* — ...
 > *{法语对照翻译}*

###### 🎬 场景串句
🇫🇷 {FR_SENTENCE}
```

规则：
- **绝不写**：音标 / 同义词 / 反义词 / "N 词 · 今日到期总数 X" header / `*场景：...*` 行 / 末尾 `<!-- polyglot-review-ids -->` 注释行 / 非法语串句
- 每个词从 `sentences` 数组挑**一条**：优先 Common，没 Common 就用 Original / Advanced；挑明确使用该词的、不太冗长的
- 法语词条**不带**法译 blockquote（本来就是法语）
- **非法语词条**（it / de / es / ja ...）每条第二行加一句法语对照翻译：
  - 格式：` > *{法译}*`（一个前导空格 + `>` + 空格 + italic）
  - 内容：example_target 整句的自然法译，尽量用该词的法语 idiomatic 等价（`mozzafiato` → "à couper le souffle"、`fare le ore piccole` → "veiller tard"、`festa di addio al celibato` → "enterrement de vie de garçon"、`cespuglio` → "buisson"、`rientrare` → "rentrer"、`scommettere` → "parier" / "miser"、`addirittura` → "carrément" / "même"、`ricondurre` → "ramener"、`bocciare` → "recaler"）
- 空行规则：
  - 语言分组 header (`**🇫🇷 法语** (N)`) 与上面一组之间空一行
  - 法语 bullets 之间**不空行**
  - 非法语 bullets 之间**空一行**（因为下面带 blockquote，视觉要呼吸）
  - `🎬 场景串句` H6 之后**不空行**，直接是 `🇫🇷 ...`
- `meaning` 末尾的 `。` / `.` 去掉（步骤 2 已处理）
- 语种顺序：法语永远第一组，其它按 `$PREVIEW_MD` 里的顺序

得到 `FINAL_SECTION`。

### 6. 追加到 target day daily note

```bash
# 二次幂等检查（步骤 0 已检查，但保险起见再 grep 一次）
if grep -q '###### 📖 今日复习' "$TARGET_FILE" 2>/dev/null; then
  echo "$TARGET_DAY 今日复习已存在，跳过写入" >&2
  exit 0
fi
printf '\n%s\n' "$FINAL_SECTION" >> "$TARGET_FILE"
```

（`$TARGET_FILE` 通常已由 daily-log routine 建好；不存在 `>>` 也会自动创建。）

### 7. Mark Firestore

```bash
cd "$REPO"
set -a && . ./.env && set +a
NODE_EXTRA_CA_CERTS=${NODE_EXTRA_CA_CERTS:-/etc/ssl/cert.pem} \
  node ./run-with-proxy.mjs ./scripts/daily-review.mjs --mark-ids="$IDS"
```

`daily-review.mjs` 的 mark 逻辑：每个词 stage +1，按 `INTERVALS = [7, 21, 42, 90, 180, 270, 365, 548, 730]` 天算下次到期（和 web app SR 曲线对齐）。

非 0 退出 → notify："$TARGET_DAY daily note 已写但 Firestore mark 失败：<错误>，这批词会重抽"。

### 8. 返词到对话框（**不可省略 · 反黑洞工作**）

写完 daily note + mark 完 Firestore 之后，**必须把完整的 `$FINAL_SECTION` 原样贴回对话回复里**——不是 `tail -30`、不是"已写入 N 词"摘要，是**整段 markdown 完整复制**。

回复格式（直接渲染，不裹 code fence）：

```
今日 polyglot 复习已写入 $TARGET_DAY daily note · N 词 · 场景=「{SCENARIO}」

---

{FINAL_SECTION 完整内容，原样粘贴}
```

如果 `$TARGET_DAY != $TODAY`（往前补的），在第一行后面加一句解释：「今天 $TODAY 已写过，往前补最近一个空日 $TARGET_DAY」。

## 严禁

- 用 filesystem MCP 或 Edit/Write 工具读写 vault 文件——**全程 Bash**
- 写 vault 其它路径（pending / staging 文件之类）——**只追加 daily note**
- 编造 Scheduled 之外的事实
- 已存在 `###### 📖 今日复习` 时重复写（步骤 0 已挡，步骤 6 二次挡）
- 输出 同义词 / 反义词 / 音标 / 总数 header / 场景标签行 / IDs 注释行
- 写意大利语（或其它非法语）串句——**串句只法语**
- **黑洞工作**：写完文件只回"已写入"或只贴 `tail` 输出——必须按步骤 8 把整个 `$FINAL_SECTION` 完整返回到对话框
- 直接 `node scripts/daily-review.mjs`（不走 wrapper）——home mac 会拿到 raw TLS bytes
