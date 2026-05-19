#!/usr/bin/env node
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, getDocs, query } from 'firebase/firestore';

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

const snapshot = await getDocs(query(collection(db, 'vocabulary')));
const allItems = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

const active = allItems.filter(i => !i.isArchived && i.entry?.word);

const now = Date.now();
const due = active.filter(i => (i.nextReviewDate || 0) <= now);
due.sort((a, b) => (a.nextReviewDate || 0) - (b.nextReviewDate || 0));

const COUNT = parseInt(process.env.REVIEW_COUNT || '10');

function pickWords(pool, count) {
  const picked = [];
  const copy = [...pool];
  while (picked.length < count && copy.length > 0) {
    const idx = Math.floor(Math.random() * copy.length);
    picked.push(copy.splice(idx, 1)[0]);
  }
  return picked;
}

let selected;
if (due.length >= COUNT) {
  selected = pickWords(due, COUNT);
} else {
  selected = [...due, ...pickWords(active.filter(i => !due.includes(i)), COUNT - due.length)].slice(0, COUNT);
}

const langNames = {
  it: '🇮🇹 Italian', fr: '🇫🇷 French', de: '🇩🇪 German', es: '🇪🇸 Spanish',
  ja: '🇯🇵 Japanese', ko: '🇰🇷 Korean', zh: '🇨🇳 Chinese', en: '🇬🇧 English',
  id: '🇮🇩 Indonesian', nl: '🇳🇱 Dutch', ru: '🇷🇺 Russian', ar: '🇸🇦 Arabic',
  el: '🇬🇷 Greek', sv: '🇸🇪 Swedish', tr: '🇹🇷 Turkish', vi: '🇻🇳 Vietnamese',
  pl: '🇵🇱 Polish',
};

const byLang = {};
for (const item of selected) {
  const lang = item.entry.lang?.toLowerCase() || 'unknown';
  if (!byLang[lang]) byLang[lang] = [];
  byLang[lang].push(item);
}

const today = new Date().toISOString().split('T')[0];
let md = `## 📖 Daily Vocab Review — ${today}\n\n`;
md += `> ${selected.length} words selected (${due.length} due for review in total)\n\n`;

for (const [lang, items] of Object.entries(byLang).sort((a, b) => b[1].length - a[1].length)) {
  md += `### ${langNames[lang] || lang}\n\n`;
  md += `| # | Word | POS | Meaning | Level |\n|---|------|-----|---------|-------|\n`;
  items.forEach((item, i) => {
    const e = item.entry;
    md += `| ${i + 1} | **${e.word}** ${e.pronunciation ? `\`${e.pronunciation}\`` : ''} | ${e.pos || ''} | ${e.meaning || ''} | ${e.level || ''} |\n`;
  });
  md += '\n';

  for (const item of items) {
    const e = item.entry;
    if (e.sentences?.length) {
      md += `<details><summary>📝 ${e.word} — examples</summary>\n\n`;
      for (const s of e.sentences) {
        md += `- ${s.target}\n  ${s.translation}\n`;
      }
      if (e.idiom) md += `\n**Expression:** ${e.idiom} — ${e.idiomMeaning}\n`;
      md += `\n</details>\n\n`;
    }
  }
}

md += `---\n*Total vocabulary: ${allItems.length} | Active: ${active.length} | Due: ${due.length}*\n`;

console.log(md);
process.exit(0);
