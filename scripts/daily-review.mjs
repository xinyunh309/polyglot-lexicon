#!/usr/bin/env node
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, doc, getDocs, updateDoc, query } from 'firebase/firestore';

const app = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
});

await signInAnonymously(getAuth(app));
const db = getFirestore(app);

const args = process.argv.slice(2);
const MARK_REVIEWED = args.includes('--mark-reviewed');
const scenarioIdx = args.indexOf('--scenario');
const SCENARIO = scenarioIdx >= 0 ? (args[scenarioIdx + 1] || '') : '';

const COUNT = parseInt(process.env.REVIEW_COUNT || '10');
const MIN_FRENCH = parseInt(process.env.REVIEW_MIN_FRENCH || '6');
const PUSH_DAYS = parseInt(process.env.REVIEW_PUSH_DAYS || '3');

const snapshot = await getDocs(query(collection(db, 'vocabulary')));
const allItems = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
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
  const pushedDate = now + PUSH_DAYS * 86400000;
  await Promise.all(selected.map(item =>
    updateDoc(doc(db, 'vocabulary', item.id), {
      lastReviewedDate: now,
      nextReviewDate: pushedDate,
    })
  ));
  console.error(`[daily-review] Marked ${selected.length} items reviewed, nextReviewDate +${PUSH_DAYS}d`);
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

let md = `## 📖 今日复习 — ${today}\n\n`;
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

md += `### 🎬 场景串句\n`;
if (SCENARIO) {
  md += `*场景：${SCENARIO}*\n\n`;
}
md += `> _待 Claude 用上面的词串成一句贴近场景的话_\n`;

console.log(md);
process.exit(0);
