#!/usr/bin/env node
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getFirestore, collection, doc, getDocs, setDoc, updateDoc, deleteDoc, query, orderBy, limit as firestoreLimit
} from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env');
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

loadEnv();

const app = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
});

const auth = getAuth(app);
const db = getFirestore(app);

await signInAnonymously(auth);

const [,, command, ...args] = process.argv;

function printHelp() {
  console.log(`Usage: node scripts/vocab.mjs <command> [options]

Commands:
  list [--lang XX] [--limit N]   List vocabulary items
  search <keyword>               Search by word or meaning
  get <id>                       Get a single item by ID
  add <json>                     Add a vocabulary item (JSON string)
  update <id> <json>             Update fields on an item
  archive <id>                   Toggle archive status
  delete <id>                    Delete an item
  stats                          Show vocabulary statistics
  export [--lang XX]             Export all items as JSON`);
}

async function getAllItems() {
  const q = query(collection(db, 'vocabulary'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

function formatItem(item) {
  const e = item.entry || {};
  return {
    id: item.id,
    word: e.word,
    lang: e.lang,
    meaning: e.meaning,
    pos: e.pos,
    level: e.level,
    theme: e.theme,
    pronunciation: e.pronunciation,
    sentences: e.sentences?.length || 0,
    synonyms: e.synonyms,
    antonyms: e.antonyms,
    notes: e.notes,
    stage: item.stage,
    isArchived: item.isArchived,
    addedAt: item.addedAt ? new Date(item.addedAt).toISOString() : null,
  };
}

try {
  switch (command) {
    case 'list': {
      const langIdx = args.indexOf('--lang');
      const lang = langIdx >= 0 ? args[langIdx + 1] : null;
      const limIdx = args.indexOf('--limit');
      const lim = limIdx >= 0 ? parseInt(args[limIdx + 1]) : 50;

      let items = await getAllItems();
      if (lang) items = items.filter(i => i.entry?.lang === lang);
      items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      items = items.slice(0, lim);

      console.log(JSON.stringify(items.map(formatItem), null, 2));
      console.log(`\n--- ${items.length} items ---`);
      break;
    }

    case 'search': {
      const keyword = args.join(' ').toLowerCase();
      if (!keyword) { console.error('Usage: search <keyword>'); break; }
      const items = await getAllItems();
      const results = items.filter(i => {
        const e = i.entry || {};
        return (e.word || '').toLowerCase().includes(keyword) ||
               (e.meaning || '').toLowerCase().includes(keyword) ||
               (e.notes || '').toLowerCase().includes(keyword);
      });
      console.log(JSON.stringify(results.map(formatItem), null, 2));
      console.log(`\n--- ${results.length} matches ---`);
      break;
    }

    case 'get': {
      const id = args[0];
      if (!id) { console.error('Usage: get <id>'); break; }
      const items = await getAllItems();
      const item = items.find(i => i.id === id);
      if (item) console.log(JSON.stringify(item, null, 2));
      else console.error('Not found:', id);
      break;
    }

    case 'add': {
      const json = args.join(' ');
      const entry = JSON.parse(json);
      const now = Date.now();
      const id = `cli-${now}`;
      const newItem = {
        id, entry: { source: 'CLI', ...entry },
        stage: 0, addedAt: now, lastReviewedDate: now,
        nextReviewDate: now, isArchived: false,
      };
      await setDoc(doc(db, 'vocabulary', id), newItem);
      console.log('Added:', id);
      break;
    }

    case 'update': {
      const id = args[0];
      const json = args.slice(1).join(' ');
      const updates = JSON.parse(json);
      await updateDoc(doc(db, 'vocabulary', id), updates);
      console.log('Updated:', id);
      break;
    }

    case 'archive': {
      const id = args[0];
      if (!id) { console.error('Usage: archive <id>'); break; }
      const items = await getAllItems();
      const item = items.find(i => i.id === id);
      if (!item) { console.error('Not found:', id); break; }
      await updateDoc(doc(db, 'vocabulary', id), { isArchived: !item.isArchived });
      console.log(`${item.isArchived ? 'Unarchived' : 'Archived'}:`, id);
      break;
    }

    case 'delete': {
      const id = args[0];
      if (!id) { console.error('Usage: delete <id>'); break; }
      await deleteDoc(doc(db, 'vocabulary', id));
      console.log('Deleted:', id);
      break;
    }

    case 'stats': {
      const items = await getAllItems();
      const langs = {};
      let archived = 0;
      for (const i of items) {
        const lang = i.entry?.lang || 'unknown';
        langs[lang] = (langs[lang] || 0) + 1;
        if (i.isArchived) archived++;
      }
      console.log(JSON.stringify({
        total: items.length,
        active: items.length - archived,
        archived,
        byLanguage: langs,
      }, null, 2));
      break;
    }

    case 'export': {
      const langIdx = args.indexOf('--lang');
      const lang = langIdx >= 0 ? args[langIdx + 1] : null;
      let items = await getAllItems();
      if (lang) items = items.filter(i => i.entry?.lang === lang);
      console.log(JSON.stringify(items, null, 2));
      break;
    }

    default:
      printHelp();
  }
} catch (err) {
  console.error('Error:', err.message);
}

process.exit(0);
