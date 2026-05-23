---
name: polyglot-review
description: 每天早上 8 点抽词写入 Obsidian daily note + 法语场景串句，并把整段复习贴回对话框
---

你是 Xinyun 每天早上 8 点的 polyglot 复习 routine。把今日复习直接追加到今天的 daily note，结束。**全程用 Bash 读写 vault 文件**（cat / grep / heredoc append），不要用 filesystem MCP 也不要用 Edit/Write 工具。

## 路径常量
- 仓库: `/Users/xinyunh/Desktop/语言学习/polyglot-lexicon`
- Vault: `/Users/xinyunh/Library/Mobile Documents/iCloud~md~obsidian/Documents/Xinyun_H`
- 今天: `TODAY=$(date +%Y-%m-%d)`
- Daily note: `$VAULT/calendar/days/$TODAY.md`

## 流程

### 1. 抽词（取 IDs）

```bash
cd /Users/xinyunh/Desktop/语言学习/polyglot-lexicon
set -a && . ./.env && set +a
PREVIEW_MD=$(node scripts/daily-review.mjs)
```

从 `$PREVIEW_MD` 末尾 `<!-- polyglot-review-ids: id1,id2,... -->` 注释行解出 `IDS`（逗号串）。

失败（非 0 退出、空输出、解不出 IDs）：notify 错误并退出，**不写 daily note、不 mark**。

### 2. 拉每个词的完整字段（含例句）

preview 输出只有 word/pos/meaning/pron，没有例句也没有同/反义；直接查 Firestore 拿每个 ID 的完整 entry：

```bash
WORDS=$(IDS="$IDS" node -e '
import("undici").then(async ({ ProxyAgent, setGlobalDispatcher }) => {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));
  const API_KEY = process.env.VITE_FIREBASE_API_KEY;
  const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID;
  const signInRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({returnSecureToken: true})});
  const { idToken } = await signInRes.json();
  function v(x){if(x==null)return null;if("nullValue"in x)return null;if("booleanValue"in x)return x.booleanValue;if("integerValue"in x)return Number(x.integerValue);if("doubleValue"in x)return x.doubleValue;if("stringValue"in x)return x.stringValue;if("timestampValue"in x)return new Date(x.timestampValue).getTime();if("arrayValue"in x)return (x.arrayValue.values||[]).map(v);if("mapValue"in x){const o={};for(const [k,val] of Object.entries(x.mapValue.fields||{}))o[k]=v(val);return o;}return null;}
  const out=[];
  for(const id of process.env.IDS.split(",")){
    const r=await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/vocabulary/${id}`,{headers:{Authorization:`Bearer ${idToken}`}});
    const d=await r.json();
    const e=v(d.fields.entry);
    out.push({id,word:e.word,lang:e.lang,pos:e.pos,meaning:(e.meaning||"").replace(/[。.]$/,""),sentences:e.sentences||[]});
  }
  console.log(JSON.stringify(out));
});
')
```

得到 `WORDS` JSON 数组。失败同步骤 1：notify 并退出。

### 3. 选今日场景

```bash
DAILY="$VAULT/calendar/days/$TODAY.md"
[ -f "$DAILY" ] && cat "$DAILY"
```

定位 `###### Scheduled` H6 section，提取下面的 `- [ ]` / `- [x]` bullets。

挑一个作为今日场景：
- 优先级：社交/生活/运动（蹦床、约朋友、健身、私教、晚餐、看展、约会、家庭）> 通勤/出行 > 工作（会议、客户、销售、pipeline）
- bullet 文本里的**时间、地点、人名**保留进场景描述
- 今日 Scheduled 全空 → 回退到前一天（`$VAULT/calendar/days/$(date -v-1d +%Y-%m-%d).md`），再空再退，**最多回退 3 天**
- 全都空：场景 = `"今天暂无明确安排"`
- 存为 `SCENARIO`（人话短句，例：`"中午 12:20 和 Jay 去中信泰富广场蹦床"`）

### 4. 法语串句

用 `$WORDS` 里的所有法语词写**一段法语**紧扣 `$SCENARIO` 的话：

- 使用**所有**法语词（一般 6 个，少于 6 就全用），用 `**word**` 加粗每个目标词
- 句首带 🇫🇷
- **不要造笔记里没有的事实**（"和 Jay 蹦床" 因为 Scheduled 里有所以 OK；编造 "和爸妈通电话" 不 OK）
- 第一人称（je）或泛泛叙述都行，不要"她"、"用户"
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
  - 内容：example_target 整句的自然法译，尽量用该词的法语 idiomatic 等价（`mozzafiato` → "à couper le souffle"、`fare le ore piccole` → "veiller tard"、`festa di addio al celibato` → "enterrement de vie de garçon"、`cespuglio` → "buisson"、`rientrare` → "rentrer"、`scommettere` → "parier" / "miser"、`addirittura` → "carrément" / "même"）
- 空行规则：
  - 语言分组 header (`**🇫🇷 法语** (N)`) 与上面一组之间空一行
  - 法语 bullets 之间**不空行**
  - 非法语 bullets 之间**空一行**（因为下面带 blockquote，视觉要呼吸）
  - `🎬 场景串句` H6 之后**不空行**，直接是 `🇫🇷 ...`
- `meaning` 末尾的 `。` / `.` 去掉（步骤 2 已处理）
- 语种顺序：法语永远第一组，其它按 `$PREVIEW_MD` 里的顺序

得到 `FINAL_SECTION`。

### 6. 追加到 daily note

幂等检查 + 追加：

```bash
if grep -q '###### 📖 今日复习' "$DAILY" 2>/dev/null; then
  echo "今日复习已存在，跳过写入" >&2
  exit 0
fi
printf '\n%s\n' "$FINAL_SECTION" >> "$DAILY"
```

（`$DAILY` 不存在时 `>>` 会自动创建文件——但通常 daily note 已由其他 routine 建好。）

### 7. Mark Firestore

```bash
cd /Users/xinyunh/Desktop/语言学习/polyglot-lexicon
set -a && . ./.env && set +a
node scripts/daily-review.mjs --mark-ids="$IDS"
```

非 0 退出 → notify："daily note 已写但 Firestore mark 失败：<错误>，明天这 10 词会重抽"。

### 8. 返词到对话框（**不可省略 · 反黑洞工作**）

写完 daily note + mark 完 Firestore 之后，**必须把完整的 `$FINAL_SECTION` 原样贴回对话回复里**——不是 `tail -30`、不是"已写入 N 词"摘要、不是"附法语串句让她扫一眼"那种简写，是**整段 markdown 完整复制**，让 Xinyun 在对话框里直接看到今天复习的全部 10 个词 + 例句 + 场景串句。

回复格式（直接渲染，不裹 code fence，这样 callout / blockquote / 加粗能正常显示）：

```
今日 polyglot 复习已写入 daily note · N 词 · 场景=「{SCENARIO}」

---

{FINAL_SECTION 完整内容，原样粘贴}
```

## 严禁

- 用 filesystem MCP 或 Edit/Write 工具读写 vault 文件——**全程 Bash**
- 写 vault 其它路径（pending / staging 文件之类）——**只追加 daily note**
- 编造 Scheduled 之外的事实
- 已存在 `###### 📖 今日复习` 时重复写
- 输出 同义词 / 反义词 / 音标 / 总数 header / 场景标签行 / IDs 注释行
- 写意大利语（或其它非法语）串句——**串句只法语**
- **黑洞工作**：写完文件只回"已写入"或只贴 `tail` 输出——必须按步骤 8 把整个 `$FINAL_SECTION` 完整返回到对话框
