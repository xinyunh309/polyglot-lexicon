import { useState, useEffect, useMemo } from 'react'; 
import { 
  BookOpen, RefreshCw, Globe, 
  Save, CheckCircle, Loader2, X,
  Wand2, Lightbulb, MessageCircle,
  Merge, Send, Volume2, 
  Image as ImageIcon, Trash2,
  Library, Sparkles, Archive, Check, Code, Clock
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, collection, doc, setDoc, onSnapshot, query, updateDoc, writeBatch, deleteDoc
} from 'firebase/firestore';

// --- Global Setup ---
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash"; 
const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const IMAGEN_MODEL = "imagen-3.0-generate-001"; 

// --- Firebase Init ---
const userFirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

let auth: any;
let db: any;
let isFirebaseAvailable = false;

const sanitizeData = (data: any): any => {
    return JSON.parse(JSON.stringify(data));
};

try {
    if (!getApps().length) {
        initializeApp(userFirebaseConfig);
    }
    const app = getApp();
    auth = getAuth(app);
    db = getFirestore(app);
    isFirebaseAvailable = true;
} catch (e) {
    console.warn("Firebase init error:", e);
}

// Caches
const audioCache = new Map<string, string>();
const requestCache = new Map<string, string>(); 

// --- Utilities ---
const pcmToWav = (base64PCM: string, sampleRate: number = 24000) => {
  try {
      const binaryString = atob(base64PCM);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const wavHeader = new ArrayBuffer(44);
      const view = new DataView(wavHeader);
      const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
      };
      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36 + len, true);
      writeString(view, 8, 'WAVE');
      writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); 
      view.setUint16(22, 1, true); 
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(view, 36, 'data');
      view.setUint32(40, len, true);
      return URL.createObjectURL(new Blob([view, bytes], { type: 'audio/wav' }));
  } catch (e) {
      console.error("Audio conversion error", e);
      return "";
  }
};

const renderBoldText = (text: string) => {
  if (!text || typeof text !== 'string') return null;
  const parts = text.split(/(\*\*.*?\*\*)/);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="text-indigo-700 bg-indigo-50 px-1 rounded font-bold font-serif mx-1">{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
};

const renderChatText = (text: string) => {
    if (!text) return null;
    if (text.includes('Context:') || text.includes('Guide:')) {
        const lines = text.split('\n').filter(l => l.trim());
        return (
            <div className="flex flex-col gap-2">
                {lines.map((line, idx) => {
                    if (line.startsWith('Context:')) return <div key={idx} className="text-[10px] font-bold text-blue-600 bg-blue-50 p-1.5 rounded border border-blue-100">{line.replace('Context:', '').trim()}</div>;
                    if (line.startsWith('Guide:')) return <div key={idx} className="text-[10px] text-emerald-700 bg-emerald-50 p-1.5 rounded border border-emerald-100 flex gap-2 items-start"><Lightbulb size={12} className="mt-0.5 shrink-0"/> <span>{renderBoldText(line.replace('Guide:', '').trim())}</span></div>;
                    if (line.startsWith('AI:')) return <div key={idx} className="text-xs leading-relaxed text-slate-800 pl-1">{renderBoldText(line.replace('AI:', '').trim())}</div>;
                    return <div key={idx} className="text-xs leading-relaxed">{renderBoldText(line)}</div>;
                })}
            </div>
        );
    }
    return renderBoldText(text);
};

const POS_MAP: Record<string, string> = { 'noun': '名词', 'verb': '动词', 'adjective': '形容词', 'adverb': '副词', 'preposition': '介词', 'conjunction': '连词', 'pronoun': '代词', 'phrase': '短语', 'idiom': '习语', 'expression': '表达', 'n': '名词', 'v': '动词', 'adj': '形容词', 'adv': '副词' };
const formatPOS = (pos: string): string => {
    if (!pos) return '未知';
    const lower = pos.toLowerCase().trim();
    if (POS_MAP[lower]) return POS_MAP[lower];
    if (lower.includes('noun')) return '名词';
    if (lower.includes('verb')) return '动词';
    if (lower.includes('adjective')) return '形容词';
    if (/[\u4e00-\u9fa5]/.test(pos)) return pos;
    return pos; 
};
// ❌ Removed unused isNoun function to fix build error

// --- Types ---
type Language = 'de' | 'en' | 'fr' | 'es' | 'it' | 'ja' | 'zh';

interface VocabEntry {
  word: string; lang: Language; pronunciation?: string; pos: string; gender?: string; meaning: string; level: string; theme: string; morphology?: string; idiom?: string; idiomMeaning?: string; 
  sentences: { type?: string; target: string; translation: string; }[];
  synonyms: string[]; antonyms: string[]; crossRefs: { lang: string; word: string }[]; source?: string;
}

interface ReviewItem {
  id: string; entry: VocabEntry; stage: number; nextReviewDate: number; lastReviewedDate: number; addedAt?: number; created_at: number; isArchived: boolean; 
}

interface StoryData { target_story: string; mixed_story: string; }
interface ChatMessage { role: 'user' | 'ai'; text: string; timestamp: number; }

const INTERVALS = [1, 3, 5, 10, 20, 40, 60];
const LANGUAGES: { code: Language; label: string; voiceCode: string; flag: string }[] = [
  { code: 'fr', label: 'FR', voiceCode: 'fr-FR', flag: '🇫🇷' },
  { code: 'de', label: 'DE', voiceCode: 'de-DE', flag: '🇩🇪' },
  { code: 'ja', label: 'JP', voiceCode: 'ja-JP', flag: '🇯🇵' },
  { code: 'en', label: 'EN', voiceCode: 'en-US', flag: '🇬🇧' },
  { code: 'es', label: 'ES', voiceCode: 'es-ES', flag: '🇪🇸' },
  { code: 'it', label: 'IT', voiceCode: 'it-IT', flag: '🇮🇹' },
  { code: 'zh', label: 'ZH', voiceCode: 'zh-CN', flag: '🇨🇳' },
];
const FLAGS: Record<string, string> = LANGUAGES.reduce((acc, lang) => ({ ...acc, [lang.code]: lang.flag }), {});

// --- Components ---
const TTSButton = ({ text, lang, size = 16, label, minimal = false }: { text: string; lang: Language, size?: number, label?: string, minimal?: boolean }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const playAudio = (url: string) => {
    const audio = new Audio(url);
    audio.onplay = () => { setIsPlaying(true); setIsLoading(false); };
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => { console.error("Audio playback error"); setIsPlaying(false); setIsLoading(false); };
    audio.play();
  };

  const playGeminiTTS = async () => {
    if (isPlaying || isLoading) return;
    const cacheKey = `${lang}:${text.substring(0, 50)}`; 
    if (audioCache.has(cacheKey)) { playAudio(audioCache.get(cacheKey)!); return; }
    setIsLoading(true);
    try {
      const langLabel = LANGUAGES.find(l => l.code === lang)?.label || "Target Language";
      const prompt = `Say in ${langLabel}: ${text}`;
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } } })
        }
      );
      if (!response.ok) throw new Error("TTS failed");
      const data = await response.json();
      const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioData) {
        const wavUrl = pcmToWav(audioData);
        if (wavUrl) { audioCache.set(cacheKey, wavUrl); playAudio(wavUrl); }
      }
    } catch (error) {
      const u = new SpeechSynthesisUtterance(text);
      const lConfig = LANGUAGES.find(la => la.code === lang);
      u.lang = lConfig?.voiceCode || 'en-US';
      window.speechSynthesis.speak(u);
      setIsPlaying(false); setIsLoading(false);
    }
  };

  if (minimal) return <button onClick={(e) => { e.stopPropagation(); playGeminiTTS(); }} disabled={isLoading} className={`text-slate-400 hover:text-indigo-600 ${isPlaying ? 'text-indigo-600 animate-pulse' : ''}`}><Volume2 size={size} /></button>;
  return <button onClick={(e) => { e.stopPropagation(); playGeminiTTS(); }} disabled={isLoading} className={`flex items-center gap-2 p-2 rounded-full ${isPlaying ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 bg-slate-100'}`}><Volume2 size={size} className={isPlaying ? "animate-pulse" : ""} />{label && <span className="text-[10px] font-bold uppercase">{label}</span>}</button>;
};

const Tag = ({ icon: Icon, text, colorClass, onClick }: { icon?: any, text: string, colorClass: string, onClick?: () => void }) => (
  <button onClick={(e) => { e.stopPropagation(); onClick && onClick(); }} className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${colorClass} mr-1 mb-1 ${onClick ? 'cursor-pointer' : ''}`}>
    {Icon && <Icon size={10} className="mr-1" />}{text}
  </button>
);

// --- Main Application ---
export default function LexiconAppV2() {
  // ❌ Removed unused dbLoading state
  const [mainTab, setMainTab] = useState<'dictionary' | 'review' | 'library'>('library'); 
  const [inputMode, setInputMode] = useState<'word' | 'text' | 'import'>('word');
  const [currentLang, setCurrentLang] = useState<Language>('en');
  const [isAutoLang, setIsAutoLang] = useState(true);

  // Data
  const [savedItems, setSavedItems] = useState<ReviewItem[]>([]);
  const [generatedEntries, setGeneratedEntries] = useState<VocabEntry[]>([]);
  const [generatedIndex, setGeneratedIndex] = useState(0);
  const [entry, setEntry] = useState<VocabEntry | null>(null);
   
  // UI States
  const [inputWord, setInputWord] = useState('');
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isClustering, setIsClustering] = useState(false);
   
  // Story & Chat & Image
  const [showStoryModal, setShowStoryModal] = useState(false);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [storyContent, setStoryContent] = useState<StoryData | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  // Review Logic 
  const [reviewQueue, setReviewQueue] = useState<ReviewItem[]>([]);
  const [isReviewFlipped, setIsReviewFlipped] = useState(false); 
  const [reviewFilterLang, setReviewFilterLang] = useState<Language | 'all'>('all'); 

  // Filters
  const [filters, setFilters] = useState({ lang: 'all', level: 'all', pos: 'all', theme: 'all' });
  const [sortMode] = useState<'recent' | 'review_soon' | 'level_asc'>('recent');
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => { if (!isFirebaseAvailable) return; signInAnonymously(auth).catch(console.error); initAuth(); }, []);
  const initAuth = () => onAuthStateChanged(auth, () => {});

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, 'vocabulary')); 
    return onSnapshot(q, (snapshot) => {
      const items: ReviewItem[] = [];
      snapshot.forEach(doc => {
          const d = doc.data();
          items.push({ id: doc.id, ...d, addedAt: d.addedAt || d.created_at || Date.now(), entry: d.entry || { word: "Error", sentences: [] } } as any);
      });
      items.sort((a: any, b: any) => b.addedAt - a.addedAt);
      setSavedItems(items); 
      // ❌ Removed setDbLoading call
    });
  }, []);

  const refreshReviewQueue = () => {
      const now = Date.now();
      let due = savedItems.filter(item => !item.isArchived && (item.nextReviewDate || 0) <= now);
      if (reviewFilterLang !== 'all') due = due.filter(item => item.entry.lang === reviewFilterLang);
      due.sort((a,b) => a.nextReviewDate - b.nextReviewDate);
      setReviewQueue(due);
  };
  useEffect(() => { refreshReviewQueue(); }, [savedItems.length, reviewFilterLang]);
  useEffect(() => { if (generatedEntries.length > 0) { setEntry(generatedEntries[generatedIndex]); setChatMessages([]); setGeneratedImage(null); } }, [generatedIndex, generatedEntries]);

  const callGemini = async (prompt: string, isJson: boolean = false) => {
    try {
      if (requestCache.has(prompt)) return requestCache.get(prompt);
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
              contents: [{ parts: [{ text: prompt }] }], 
              safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }],
              generationConfig: isJson ? { responseMimeType: "application/json" } : undefined 
          })
      });
      if (!response.ok) throw new Error(`API Error`);
      const data = await response.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (isJson && text) text = text.replace(/```json\n?|```/g, '').trim();
      if (text) requestCache.set(prompt, text); 
      return text;
    } catch (error) { return null; }
  };

  const handleGenerate = async (overrideWord?: string) => {
    const target = overrideWord || inputWord || inputText;
    if (!target) return;
    if (inputMode === 'word') {
        const existing = savedItems.find(i => i.entry.word.toLowerCase() === target.toLowerCase());
        if (existing) { setEntry(existing.entry); setGeneratedEntries([existing.entry]); setGeneratedIndex(0); setMainTab('dictionary'); setInputWord(''); return; }
    }
    setIsGenerating(true); setMainTab('dictionary');
    const langInstr = isAutoLang ? `DETECT Lang. Matches FR/DE/JA/ES/IT/EN? Use it. Else EN.` : `Target: ${LANGUAGES.find(l => l.code === currentLang)?.label}.`;
    const schema = `{ "word": "Lemma", "lang": "code", "pos": "POS (CN)", "gender": "m/f", "pronunciation": "...", "meaning": "CN Def", "idiom": "Phrase", "idiomMeaning": "Meaning", "level": "B2", "theme": "Topic (CN)", "morphology": "...", "sentences": [{ "type": "Original/Common", "target": "...", "translation": "..." }], "synonyms": ["..."], "antonyms": ["..."], "crossRefs": [{ "lang": "code", "word": "..." }] }`;
    const prompt = inputMode === 'word' || overrideWord 
      ? `SYSTEM: Polyglot Lexicon. ${langInstr} User: CN Native. Goal: JP(N1), FR/ES/IT(C1). Gen JSON for "${target}". RULES: 1. Concise Simplified Chinese definition (B2-C2). 2. CN output. 3. Kana only for JP. 4. CrossRefs in [fr,de,es,it,en,ja]. 5. Min 2 sentences. 6. LEVEL UPPERCASE. ${schema}`
      : `Analyze text. ${langInstr} Extract 3-8 B2-C2 words/idioms. STRICT: Words must be in text. JSON Array. Text: "${target.substring(0, 2000)}" ${schema}`;
    
    const res = await callGemini(prompt, true);
    setIsGenerating(false);
    if (res) {
      try {
        const parsed = JSON.parse(res);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        const valid = arr.map((e: any) => ({ ...e, sentences: e.sentences||[], synonyms: e.synonyms||[], crossRefs: e.crossRefs||[], pos: formatPOS(e.pos), level: e.level?.toUpperCase()||'B2' }));
        setGeneratedEntries(valid); setGeneratedIndex(0); setEntry(valid[0]); if (valid[0]?.lang) setCurrentLang(valid[0].lang as Language);
      } catch (e) { alert("AI Error"); }
    }
  };

  const handleSmartEnrich = async () => {
      if (!entry) return;
      const hasSents = entry.sentences && entry.sentences.length > 0;
      const task = hasSents ? `Add 1 NEW Advanced/Literary sentence. Do NOT delete existing.` : `Add 2 sentences.`;
      const res = await callGemini(`ENRICH "${entry.word}". Current: ${JSON.stringify(entry)} TASK: ${task} Add 5 synonyms, Cross-Lang. Return FULL JSON.`, true);
      
      if (res) {
          const enriched = JSON.parse(res);
          let newSents = entry.sentences || [];
          if (enriched.sentences) {
              const existT = new Set(newSents.map(s=>s.target));
              newSents = [...newSents, ...enriched.sentences.filter((s:any)=>!existT.has(s.target))];
          }
          const merged = { ...entry, ...enriched, sentences: newSents, pos: formatPOS(enriched.pos||entry.pos) };
          setEntry(merged);
          const newGen = [...generatedEntries]; newGen[generatedIndex] = merged; setGeneratedEntries(newGen);
          if (isCurrentSaved) await updateDoc(doc(db, 'vocabulary', isCurrentSaved.id), { entry: sanitizeData(merged) });
      }
  };

  const handleSmartSave = async () => {
    if (!entry) return;
    const wordToSave = (entry.idiom && entry.idiom.length > entry.word.length) ? entry.idiom : entry.word;
    const exist = savedItems.find(i => i.entry.word.toLowerCase() === wordToSave.toLowerCase());
    const now = Date.now();
    if (exist) {
      if (!confirm(`Merge "${wordToSave}"?`)) return;
      const merged = { ...exist.entry, sentences: [...exist.entry.sentences, ...entry.sentences], synonyms: [...new Set([...exist.entry.synonyms, ...entry.synonyms])], crossRefs: [...exist.entry.crossRefs, ...entry.crossRefs] };
      await updateDoc(doc(db, 'vocabulary', exist.id), { entry: sanitizeData(merged), created_at: now });
    } else {
      const newItem = { id: crypto.randomUUID(), entry: { ...entry, word: wordToSave }, stage: 0, nextReviewDate: now, lastReviewedDate: now, created_at: now, addedAt: now, isArchived: false };
      await setDoc(doc(db, 'vocabulary', newItem.id), sanitizeData(newItem));
    }
  };

  const handleReviewAction = async (remember: boolean) => {
      const item = reviewQueue[0]; if (!item) return;
      setReviewQueue(prev => prev.slice(1)); setIsReviewFlipped(false);
      const nextStage = remember ? Math.min(item.stage + 1, INTERVALS.length - 1) : 0;
      await updateDoc(doc(db, 'vocabulary', item.id), { nextReviewDate: remember ? Date.now() + INTERVALS[nextStage] * 86400000 : Date.now(), stage: nextStage, lastReviewedDate: Date.now() });
      if (reviewQueue.length <= 1) setMainTab('library');
  };

  const handleStory = async (words: VocabEntry[]) => {
    if (words.length === 0) return;
    setIsGeneratingStory(true); setShowStoryModal(true);
    const langName = LANGUAGES.find(l => l.code === words[0].lang)?.label || "Target Language";
    const res = await callGemini(`Create story with: ${words.map(w=>w.word).join(',')}. CONSTRAINTS: 1. Target Story MUST be in ${langName}. 2. Mixed Story in Chinese with bold keywords. JSON: { "target_story": "...", "mixed_story": "..." }`, true);
    if (res) setStoryContent(JSON.parse(res));
    setIsGeneratingStory(false);
  };

  const handleGenerateImage = async () => {
      if (!entry || isGeneratingImage) return;
      setIsGeneratingImage(true);
      try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instances: [{ prompt: `Minimalist vector illustration of '${entry.word}' (${entry.meaning}). White background.` }], parameters: { sampleCount: 1 } }) });
          const data = await res.json();
          if (data.predictions?.[0]?.bytesBase64Encoded) setGeneratedImage(`data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`);
      } catch (e) { console.error(e); } finally { setIsGeneratingImage(false); }
  };

  const getEtymology = async () => {
      if (!entry) return;
      setIsChatting(true);
      const res = await callGemini(`Etymology of "${entry.word}". Output in Chinese.`, false);
      setIsChatting(false);
      if (res) setChatMessages(prev => [...prev, { role: 'ai', text: res, timestamp: Date.now() }]);
  };

  const handleChatSubmit = async () => {
      if (!chatInput || !entry) return;
      const userMsg: ChatMessage = { role: 'user', text: chatInput, timestamp: Date.now() };
      setChatMessages(prev => [...prev, userMsg]); setChatInput('');
      setIsChatting(true);
      const res = await callGemini(`Context: "${entry.word}". User: "${userMsg.text}". Answer in CN.`, false);
      setIsChatting(false);
      if (res) setChatMessages(prev => [...prev, { role: 'ai', text: res, timestamp: Date.now() }]);
  };

  const handleAutoCluster = async () => {
      setIsClustering(true);
      const themes = [...new Set(savedItems.map(i => i.entry.theme))];
      const res = await callGemini(`Group themes into 6-8 CN categories. JSON { "old": "new" }. Themes: ${JSON.stringify(themes)}`, true);
      if (res) {
          const map = JSON.parse(res);
          const batch = writeBatch(db);
          savedItems.forEach(i => { if (map[i.entry.theme]) batch.update(doc(db,'vocabulary',i.id), { 'entry.theme': map[i.entry.theme] }); });
          await batch.commit();
      }
      setIsClustering(false);
  };

  const deleteItem = async (id: string) => { if(confirm("Delete?")) await deleteDoc(doc(db, 'vocabulary', id)); };
  const toggleArchive = async (id: string, status: boolean) => updateDoc(doc(db, 'vocabulary', id), { isArchived: !status });
  const isCurrentSaved = useMemo(() => savedItems.find(i => i.entry.word === entry?.word), [savedItems, entry]);
  const filteredItems = useMemo(() => {
      let res = savedItems.filter(i => i.isArchived === showArchived);
      if (filters.lang !== 'all') res = res.filter(i => i.entry.lang === filters.lang);
      if (filters.level !== 'all') res = res.filter(i => i.entry.level === filters.level);
      if (filters.pos !== 'all') res = res.filter(i => i.entry.pos === filters.pos);
      if (filters.theme !== 'all') res = res.filter(i => i.entry.theme === filters.theme);
      return res.sort((a, b) => sortMode === 'recent' ? b.created_at - a.created_at : a.nextReviewDate - b.nextReviewDate);
  }, [savedItems, filters, sortMode, showArchived]);

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-slate-50 text-slate-800 font-sans fixed inset-0 overscroll-none flex flex-col">
      {/* MOBILE BOTTOM NAV */}
      <div className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-50 flex justify-around py-3 pb-safe shadow-[0_-4px_10px_rgba(0,0,0,0.03)]">
        {['dictionary', 'library', 'review'].map(tab => (
            <button key={tab} onClick={() => setMainTab(tab as any)} className={`flex flex-col items-center gap-1 ${mainTab === tab ? 'text-indigo-600' : 'text-slate-400'}`}>
                {tab==='dictionary'?<BookOpen size={22}/>:tab==='library'?<Library size={22}/>:<RefreshCw size={22}/>}
                <span className="text-[9px] font-bold uppercase tracking-wide">{tab}</span>
            </button>
        ))}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden pb-20 md:pb-0">
        {/* COMPACT HEADER */}
        <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 px-4 py-3 shrink-0 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <div className="bg-indigo-600 text-white p-1 rounded-lg"><Globe size={16} /></div>
                Polyglot
            </h1>
            <button onClick={() => setIsAutoLang(!isAutoLang)} className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors ${isAutoLang ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-white text-slate-400 border-slate-200'}`}>
                {isAutoLang ? "Auto" : "Manual"}
            </button>
            {!isAutoLang && (
                <select value={currentLang} onChange={(e) => setCurrentLang(e.target.value as Language)} className="text-[10px] font-bold bg-transparent outline-none text-slate-600 border-none p-0">
                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.code.toUpperCase()}</option>)}
                </select>
            )}
          </div>
          <div className="hidden md:flex items-center gap-2">
             <button onClick={() => alert(JSON.stringify(entry,null,2))} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded"><Code size={16}/></button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden relative">
          {/* DICTIONARY TAB */}
          {mainTab === 'dictionary' && (
            <div className="h-full flex flex-col md:flex-row md:gap-6 md:p-6 overflow-y-auto overscroll-contain">
              <div className="p-4 md:w-1/3 md:p-0 shrink-0">
                <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200">
                   <div className="flex gap-1 mb-2 p-0.5 bg-slate-100 rounded-lg">
                       {['word', 'text'].map(m => ( 
                           <button key={m} onClick={() => setInputMode(m as any)} className={`flex-1 py-1 text-[10px] font-bold uppercase rounded-md transition-all ${inputMode === m ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}>{m}</button>
                       ))}
                   </div>
                   <div className="relative">
                       {inputMode === 'word' ? (
                           <input type="text" value={inputWord} onChange={e=>setInputWord(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleGenerate()} className="w-full pl-3 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none font-medium placeholder:text-slate-400" placeholder="Enter word..." />
                       ) : (
                           <textarea value={inputText} onChange={e=>setInputText(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl h-24 text-xs focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none" placeholder="Paste text..." />
                       )}
                       <button onClick={()=>handleGenerate()} disabled={isGenerating} className="absolute right-1 top-1 p-1.5 bg-indigo-600 text-white rounded-lg disabled:opacity-50">{isGenerating ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}</button>
                   </div>
                </div>
              </div>

              <div className="flex-1 px-4 pb-20 md:pb-0 md:px-0">
                {entry ? (
                    <div className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-300">
                        <div className="bg-slate-50/80 p-5 border-b border-slate-100">
                             <div className="flex justify-between items-start">
                                 <div className="flex-1">
                                     <div className="flex flex-wrap items-center gap-1 mb-1">
                                         <span className="text-lg mr-1">{FLAGS[entry.lang]}</span>
                                         <Tag text={entry.pos} colorClass="bg-white border border-slate-200 text-slate-500" />
                                         <Tag text={entry.level} colorClass="bg-amber-50 text-amber-700" />
                                     </div>
                                     <h2 className="font-serif font-bold text-slate-900 leading-none break-words" style={{ fontSize: 'clamp(1.5rem, 6vw, 2.5rem)' }}>{entry.word}</h2>
                                     <div className="flex items-center gap-3 mt-2">
                                         <span className="text-slate-400 font-mono text-xs">{entry.pronunciation}</span>
                                         <TTSButton text={entry.word} lang={entry.lang} size={18} />
                                         <button onClick={handleGenerateImage} disabled={isGeneratingImage} className="text-indigo-400 hover:text-indigo-600">{isGeneratingImage ? <Loader2 size={16} className="animate-spin"/> : <ImageIcon size={16}/>}</button>
                                     </div>
                                 </div>
                                 <div className="flex gap-1">
                                    {isCurrentSaved && <button onClick={handleSmartEnrich} className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Sparkles size={16}/></button>}
                                    <button onClick={handleSmartSave} className={`p-2 rounded-lg ${isCurrentSaved ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-600 text-white'}`}>{isCurrentSaved ? <Merge size={16}/> : <Save size={16}/>}</button>
                                 </div>
                             </div>
                        </div>

                        <div className="p-5 space-y-5">
                             {generatedImage && <img src={generatedImage} className="w-full h-32 object-cover rounded-lg bg-slate-100 border border-slate-200"/>}
                             <div className="text-lg text-slate-800 font-medium leading-relaxed border-l-2 border-indigo-400 pl-3">{entry.meaning}</div>
                             <div className="space-y-3">
                                {(entry.sentences || []).map((s, i) => (
                                    <div key={i} className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                        <div className="flex justify-between items-start gap-2">
                                            <div className="text-sm text-slate-800 font-medium">{s.target}</div>
                                            <TTSButton text={s.target} lang={entry.lang} minimal size={14}/>
                                        </div>
                                        <div className="text-xs text-slate-400 mt-1">{s.translation}</div>
                                    </div>
                                ))}
                             </div>
                             <div className="bg-indigo-50/50 rounded-xl p-3 border border-indigo-100">
                                <div className="flex justify-between mb-2">
                                    <span className="text-[10px] font-bold text-indigo-900 uppercase flex items-center gap-1"><MessageCircle size={12}/> AI Context</span>
                                    <div className="flex gap-1"><button onClick={getEtymology} className="text-[9px] bg-white px-1.5 py-0.5 rounded border border-indigo-100">Etymology</button></div>
                                </div>
                                <div className="space-y-2 max-h-32 overflow-y-auto mb-2">
                                    {chatMessages.map((m,i)=><div key={i} className={`text-xs p-2 rounded-lg ${m.role==='user'?'bg-indigo-600 text-white self-end':'bg-white text-slate-800 border border-indigo-100'}`}>{renderChatText(m.text)}</div>)}
                                    {isChatting && <div className="text-center"><Loader2 size={12} className="animate-spin text-indigo-400 inline"/></div>}
                                </div>
                                <div className="flex gap-1"><input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleChatSubmit()} className="flex-1 text-xs p-2 rounded border border-indigo-200" placeholder="Ask AI..." /><button onClick={handleChatSubmit} className="p-2 bg-indigo-600 text-white rounded"><Send size={14}/></button></div>
                             </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-60 flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-2xl"><BookOpen size={32} className="mb-2"/><span className="text-xs font-bold uppercase">No Card Loaded</span></div>
                )}
              </div>
            </div>
          )}
           
          {/* LIBRARY TAB */}
          {mainTab === 'library' && (
            <div className="h-full flex flex-col bg-white">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
                    <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Library size={16} className="text-indigo-600"/> Collection <span className="text-xs text-slate-400 font-normal">({savedItems.filter(i=>!i.isArchived).length})</span></h2>
                    <div className="flex gap-2">
                         <button onClick={handleAutoCluster} disabled={isClustering} className="p-1.5 bg-white border border-indigo-100 text-indigo-600 rounded-md shadow-sm">{isClustering ? <Loader2 size={14} className="animate-spin"/> : <Wand2 size={14}/>}</button>
                         <button onClick={()=>handleStory(savedItems.slice(0,8).map(i=>i.entry))} className="p-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-md shadow-sm"><Sparkles size={14}/></button>
                    </div>
                </div>
                
                <div className="px-4 py-2 border-b border-slate-50 flex gap-2 overflow-x-auto scrollbar-hide shrink-0">
                      <select className="text-[10px] font-bold bg-slate-50 border border-slate-200 rounded px-1 py-1 outline-none" value={filters.lang} onChange={e=>setFilters({...filters, lang: e.target.value})}><option value="all">All Langs</option>{LANGUAGES.map(l=><option key={l.code} value={l.code}>{l.flag} {l.code.toUpperCase()}</option>)}</select>
                      <select className="text-[10px] font-bold bg-slate-50 border border-slate-200 rounded px-1 py-1 outline-none" value={filters.level} onChange={e=>setFilters({...filters, level: e.target.value})}><option value="all">All Levels</option>{['A1','A2','B1','B2','C1','C2','N1','N2'].map(l=><option key={l} value={l}>{l}</option>)}</select>
                      <button onClick={()=>setShowArchived(!showArchived)} className={`ml-auto px-2 py-1 text-[10px] font-bold rounded border ${showArchived ? 'bg-indigo-600 text-white' : 'bg-white text-slate-400 border-slate-200'}`}>{showArchived ? 'Archived' : 'Active'}</button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 overscroll-contain">
                    <div className="grid grid-cols-2 gap-2 pb-20">
                        {filteredItems.map(item => (
                            <div key={item.id} onClick={()=>{setEntry(item.entry); setMainTab('dictionary')}} className="bg-white border border-slate-100 p-3 rounded-xl shadow-sm active:scale-95 transition-transform relative">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-xs opacity-60">{FLAGS[item.entry.lang]}</span>
                                    <span className="text-[9px] px-1.5 bg-slate-100 text-slate-500 rounded">{item.entry.level}</span>
                                </div>
                                <h3 className="font-bold text-slate-900 text-base mb-1 truncate">{item.entry.word}</h3>
                                <p className="text-[10px] text-slate-500 line-clamp-2 leading-tight">{item.entry.meaning}</p>
                                <div className="absolute bottom-2 right-2 flex gap-2">
                                    <button onClick={(e)=>{e.stopPropagation(); toggleArchive(item.id, item.isArchived)}} className="text-slate-300 hover:text-indigo-500"><Archive size={14}/></button>
                                    <button onClick={(e)=>{e.stopPropagation(); deleteItem(item.id)}} className="text-slate-300 hover:text-rose-500"><Trash2 size={14}/></button>
                                </div>
                            </div>
                        ))}
                        {filteredItems.length === 0 && <div className="col-span-2 text-center text-xs text-slate-400 py-10">Nothing here yet.</div>}
                    </div>
                </div>
            </div>
          )}

          {/* REVIEW TAB */}
          {mainTab === 'review' && (
             <div className="h-full flex flex-col pb-20 overflow-y-auto overscroll-contain bg-slate-100">
                <div className="bg-white p-4 flex justify-between items-center border-b border-slate-200 sticky top-0 z-10">
                    <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest">Due: {reviewQueue.length}</span>
                    <select className="text-xs font-bold bg-transparent outline-none text-slate-600" value={reviewFilterLang} onChange={(e) => setReviewFilterLang(e.target.value as any)}>
                        <option value="all">All Langs</option>
                        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.code.toUpperCase()}</option>)}
                    </select>
                </div>

                <div className="flex-1 flex items-center justify-center p-4">
                    {reviewQueue[0] ? (
                        <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden flex flex-col min-h-[400px]" onClick={() => setIsReviewFlipped(!isReviewFlipped)}>
                            {!isReviewFlipped ? (
                                <div className="flex-1 flex flex-col items-center justify-center p-8 animate-in fade-in">
                                    <span className="text-3xl mb-6">{FLAGS[reviewQueue[0].entry.lang]}</span>
                                    <h2 className="font-serif font-bold text-slate-900 text-4xl mb-8 text-center">{reviewQueue[0].entry.word}</h2>
                                    <div onClick={e=>e.stopPropagation()} className="p-3 bg-indigo-50 rounded-full mb-8"><TTSButton text={reviewQueue[0].entry.word} lang={reviewQueue[0].entry.lang} size={24}/></div>
                                    <p className="text-xs text-slate-400 font-bold animate-bounce">TAP TO FLIP</p>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col p-6 animate-in fade-in">
                                    <div className="flex justify-between items-center mb-4">
                                        <h2 className="text-xl font-bold text-slate-900">{reviewQueue[0].entry.word}</h2>
                                        <TTSButton text={reviewQueue[0].entry.word} lang={reviewQueue[0].entry.lang} size={16} minimal/>
                                    </div>
                                    <div className="bg-indigo-50 p-3 rounded-xl text-indigo-900 font-medium text-base mb-4">{reviewQueue[0].entry.meaning}</div>
                                    <div className="space-y-2 mb-auto">
                                        {reviewQueue[0].entry.sentences.slice(0,1).map((s,i)=><div key={i} className="text-xs text-slate-600 bg-slate-50 p-2 rounded border border-slate-100"><div>{s.target}</div><div className="text-slate-400 mt-1">{s.translation}</div></div>)}
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 pt-4 mt-4 border-t border-slate-100">
                                        <button onClick={(e)=>{e.stopPropagation(); handleReviewAction(false)}} className="py-3 bg-rose-50 text-rose-600 font-bold rounded-xl text-xs flex items-center justify-center gap-1"><X size={14}/> Forgot</button>
                                        <button onClick={(e)=>{e.stopPropagation(); handleReviewAction(true)}} className="py-3 bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1"><Check size={14}/> {INTERVALS[Math.min(reviewQueue[0].stage+1,6)]}d</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-center text-slate-400"><CheckCircle size={40} className="mx-auto mb-2 text-emerald-400"/><p className="text-sm font-bold">All Clear!</p></div>
                    )}
                </div>
             </div>
          )}
        </main>

        {showStoryModal && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center"><h3 className="font-bold text-sm flex items-center gap-2"><Sparkles size={14} className="text-purple-500"/> AI Story</h3><button onClick={()=>setShowStoryModal(false)}><X size={18}/></button></div>
                    <div className="p-5 overflow-y-auto flex-1">
                        {isGeneratingStory ? <div className="text-center py-10"><Loader2 className="animate-spin mx-auto mb-2 text-indigo-500"/><p className="text-xs text-slate-400">Dreaming...</p></div> : storyContent ? (
                            <div className="space-y-4 text-sm leading-loose">
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-slate-700">{renderBoldText(storyContent.target_story)}</div>
                                <div className="text-slate-500">{renderBoldText(storyContent.mixed_story)}</div>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}
