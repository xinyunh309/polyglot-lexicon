#!/usr/bin/env node
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));

const API_KEY = process.env.VITE_FIREBASE_API_KEY;
const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID;
if (!API_KEY || !PROJECT_ID) {
  console.error('Missing VITE_FIREBASE_API_KEY or VITE_FIREBASE_PROJECT_ID in .env');
  process.exit(1);
}

const args = process.argv.slice(2);
const MARK_REVIEWED = args.includes('--mark-reviewed');
const scenarioIdx = args.indexOf('--scenario');
const SCENARIO = scenarioIdx >= 0 ? (args[scenarioIdx + 1] || '') : '';
const markIdsArg = args.find(a => a.startsWith('--mark-ids='));
const MARK_IDS = markIdsArg ? markIdsArg.slice('--mark-ids='.length).split(',').map(s => s.trim()).filter(Boolean) : null;

const COUNT = parseInt(process.env.REVIEW_COUNT || '15');
const MIN_FRENCH = parseInt(process.env.REVIEW_MIN_FRENCH || '6');
// Spaced-repetition curve (days). Kept in sync with src/App.tsx INTERVALS.
// stage advances by +1 on each scheduled-task mark (equivalent to web app's "remember" action).
const INTERVALS = [7, 21, 42, 90, 180, 270, 365, 548, 730];

// --- Anonymous sign-in via Identity Toolkit REST ---
const signInRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) }
);
if (!signInRes.ok) {
  console.error(`Auth failed: ${signInRes.status} ${await signInRes.text()}`);
  process.exit(1);
}
const { idToken } = await signInRes.json();
const authHeaders = { 'Authorization': `Bearer ${idToken}` };

// --- Firestore REST helpers ---
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function fsValToJs(v) {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsValToJs);
  if ('mapValue' in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = fsValToJs(val);
    return out;
  }
  return null;
}

function docToJs(doc) {
  const id = doc.name.split('/').pop();
  const out = { id };
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fsValToJs(v);
  return out;
}

async function listVocabulary() {
  const all = [];
  let pageToken = '';
  while (true) {
    const url = `${FS_BASE}/vocabulary?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: authHeaders });
    if (!res.ok) throw new Error(`List failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    for (const d of (data.documents || [])) all.push(docToJs(d));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return all;
}

async function getCurrentStage(id) {
  const url = `${FS_BASE}/vocabulary/${id}?mask.fieldPaths=stage`;
  const res = await fetch(url, { headers: authHeaders });
  if (!res.ok) throw new Error(`Get ${id} stage failed: ${res.status} ${await res.text()}`);
  const d = await res.json();
  return Number(d.fields?.stage?.integerValue ?? 0);
}

// Mark a vocabulary item as just reviewed: advance stage +1, set nextReviewDate per INTERVALS curve.
// Returns { newStage, intervalDays, nextMs } so the caller can log/explain.
async function patchReviewed(id, lastMs, currentStage) {
  const newStage = Math.min(currentStage + 1, INTERVALS.length - 1);
  const intervalDays = INTERVALS[newStage];
  const nextMs = lastMs + intervalDays * 86400000;
  const url = `${FS_BASE}/vocabulary/${id}?updateMask.fieldPaths=lastReviewedDate&updateMask.fieldPaths=nextReviewDate&updateMask.fieldPaths=stage`;
  const body = {
    fields: {
      lastReviewedDate: { integerValue: String(lastMs) },
      nextReviewDate: { integerValue: String(nextMs) },
      stage: { integerValue: String(newStage) },
    },
  };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Patch ${id} failed: ${res.status} ${await res.text()}`);
  return { newStage, intervalDays, nextMs };
}

// --- Main ---

// Path 1: --mark-ids=... → just PATCH those IDs in Firestore and exit (no markdown, no selection).
if (MARK_IDS && MARK_IDS.length > 0) {
  const now = Date.now();
  const results = await Promise.all(MARK_IDS.map(async id => {
    const stage = await getCurrentStage(id);
    const r = await patchReviewed(id, now, stage);
    return { id, fromStage: stage, ...r };
  }));
  const summary = results.map(r => `${r.id}: stage ${r.fromStage}→${r.newStage} (+${r.intervalDays}d)`).join('\n  ');
  console.error(`[daily-review] Marked ${MARK_IDS.length} items reviewed (by id):\n  ${summary}`);
  process.exit(0);
}

// Path 2: pick + (optionally) mark + emit markdown.
const allItems = await listVocabulary();
const active = allItems.filter(i => !i.isArchived && i.entry?.word);

const now = Date.now();
const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
const todayStartMs = todayStart.getTime();

const eligible = active.filter(i => (i.lastReviewedDate || 0) < todayStartMs);
const due = eligible.filter(i => (i.nextReviewDate || 0) <= now);

const isFr = i => i.entry.lang?.toLowerCase() === 'fr';

function pickRandom(pool, count) {
  const copy = [...pool];
  const picked = [];
  while (picked.length < count && copy.length > 0) {
    const idx = Math.floor(Math.random() * copy.length);
    picked.push(copy.splice(idx, 1)[0]);
  }
  return picked;
}

const dueFr = due.filter(isFr);
const dueOther = due.filter(i => !isFr(i));

const frenchTake = Math.min(MIN_FRENCH, dueFr.length);
let selected = [
  ...pickRandom(dueFr, frenchTake),
  ...pickRandom(dueOther, COUNT - frenchTake),
];

if (selected.length < COUNT) {
  const used = new Set(selected.map(i => i.id));
  const pool = eligible.filter(i => !used.has(i.id));
  const frenchShort = Math.max(0, MIN_FRENCH - selected.filter(isFr).length);
  selected.push(...pickRandom(pool.filter(isFr), frenchShort));
  const used2 = new Set(selected.map(i => i.id));
  selected.push(...pickRandom(pool.filter(i => !used2.has(i.id)), COUNT - selected.length));
}

selected = selected.slice(0, COUNT);

if (MARK_REVIEWED && selected.length > 0) {
  const results = await Promise.all(selected.map(async item => {
    const r = await patchReviewed(item.id, now, item.stage || 0);
    return { id: item.id, fromStage: item.stage || 0, ...r };
  }));
  const summary = results.map(r => `${r.id}: stage ${r.fromStage}→${r.newStage} (+${r.intervalDays}d)`).join('\n  ');
  console.error(`[daily-review] Marked ${selected.length} items reviewed:\n  ${summary}`);
}

const langNames = {
  it: '🇮🇹 意大利语', fr: '🇫🇷 法语', de: '🇩🇪 德语', es: '🇪🇸 西班牙语',
  ja: '🇯🇵 日语', ko: '🇰🇷 韩语', zh: '🇨🇳 中文', en: '🇬🇧 英语',
  id: '🇮🇩 印尼语', nl: '🇳🇱 荷兰语', ru: '🇷🇺 俄语', ar: '🇸🇦 阿拉伯语',
  el: '🇬🇷 希腊语', sv: '🇸🇪 瑞典语', tr: '🇹🇷 土耳其语', vi: '🇻🇳 越南语',
  pl: '🇵🇱 波兰语',
};

const byLang = {};
for (const item of selected) {
  const lang = item.entry.lang?.toLowerCase() || 'unknown';
  (byLang[lang] = byLang[lang] || []).push(item);
}

const today = new Date().toISOString().split('T')[0];
const langOrder = Object.entries(byLang).sort((a, b) => {
  if (a[0] === 'fr') return -1;
  if (b[0] === 'fr') return 1;
  return b[1].length - a[1].length;
});

let md = `###### 📖 今日复习\n\n`;
md += `> ${selected.length} 词 · 今日到期总数 ${due.length}\n\n`;

for (const [lang, items] of langOrder) {
  md += `**${langNames[lang] || lang}** (${items.length})\n`;
  for (const item of items) {
    const e = item.entry;
    const pron = e.pronunciation ? ` \`${e.pronunciation}\`` : '';
    const pos = e.pos ? ` *${e.pos}*` : '';
    md += `- **${e.word}**${pron}${pos} — ${e.meaning || ''}\n`;
  }
  md += '\n';
}

md += `###### 🎬 场景串句\n`;
if (SCENARIO) {
  md += `*场景：${SCENARIO}*\n\n`;
}
md += `> _待 Claude 用上面的词串成一句贴近场景的话_\n`;

md += `\n<!-- polyglot-review-ids: ${selected.map(i => i.id).join(',')} -->\n`;

console.log(md);
process.exit(0);
