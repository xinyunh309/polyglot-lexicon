import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Volume2, Copy, BookOpen, RefreshCw, Hash, Globe, 
  ChevronRight, Save, CheckCircle, Loader2, X,
  Wand2, RotateCcw, Lightbulb, Flame, ChevronLeft, MessageCircle,
  Upload, Merge, Database, Send, Eye, EyeOff, 
  Image as ImageIcon, Gamepad2, Trash2,
  Library, Sparkles, Filter, Archive, Check, ArrowUpDown, Clock, Calendar,
  Bot, GraduationCap, Download, User, ArrowLeft, Grid3X3, Split, Layers
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, collection, doc, setDoc, onSnapshot, query, updateDoc, writeBatch, deleteDoc
} from 'firebase/firestore';

// ==========================================
// 1. 全局配置 (Configuration)
// ==========================================

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

// Models Configuration
const GEMINI_TEXT_MODEL = "gemini-2.5-flash"; // Text Generation
const GEMINI_SIMPLE_TTS_MODEL = "gemini-2.5-flash-preview-tts"; // Fast, simple TTS (Buttons)
const GEMINI_PRO_TTS_MODEL = "gemini-2.5-pro-preview-tts"; // High Quality, Multi-speaker (Playground)
const IMAGEN_MODEL = "imagen-4.0-fast-generate-001"; 

// Voice Pool for Multi-speaker
const AVAILABLE_VOICES = ['Kore', 'Fenrir', 'Puck', 'Aoede', 'Charon'];

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

// Helper
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
    console.log("Connected to Firebase:", userFirebaseConfig.projectId);
} catch (e) {
    console.warn("Firebase init error:", e);
}

// Caches
const audioCache = new Map<string, string>();
const requestCache = new Map<string, string>(); 

const INTERVALS = [1, 3, 5, 10, 20, 40, 60];
type Language = 'de' | 'en' | 'fr' | 'es' | 'it' | 'ja' | 'zh' | 'ko' | 'id' | 'nl' | 'ru' | 'ar' | 'el' | 'sv' | 'tr';

const LANGUAGES: { code: Language; label: string; voiceCode: string; flag: string }[] = [
  { code: 'en', label: 'EN', voiceCode: 'en-US', flag: '🇬🇧' },
  { code: 'zh', label: 'ZH', voiceCode: 'zh-CN', flag: '🇨🇳' },
  { code: 'ja', label: 'JP', voiceCode: 'ja-JP', flag: '🇯🇵' },
  { code: 'ko', label: 'KR', voiceCode: 'ko-KR', flag: '🇰🇷' },
  { code: 'de', label: 'DE', voiceCode: 'de-DE', flag: '🇩🇪' },
  { code: 'fr', label: 'FR', voiceCode: 'fr-FR', flag: '🇫🇷' },
  { code: 'es', label: 'ES', voiceCode: 'es-ES', flag: '🇪🇸' },
  { code: 'it', label: 'IT', voiceCode: 'it-IT', flag: '🇮🇹' },
  { code: 'id', label: 'ID', voiceCode: 'id-ID', flag: '🇮🇩' },
  { code: 'nl', label: 'NL', voiceCode: 'nl-NL', flag: '🇳🇱' },
  { code: 'ru', label: 'RU', voiceCode: 'ru-RU', flag: '🇷🇺' },
  { code: 'ar', label: 'AR', voiceCode: 'ar-XA', flag: '🇸🇦' },
  { code: 'el', label: 'EL', voiceCode: 'el-GR', flag: '🇬🇷' }, // 新增: 希腊语
  { code: 'sv', label: 'SV', voiceCode: 'sv-SE', flag: '🇸🇪' }, // 新增: 瑞典语
  { code: 'tr', label: 'TR', voiceCode: 'tr-TR', flag: '🇹🇷' }, // 新增: 土耳其语
];

const FLAGS: Record<string, string> = LANGUAGES.reduce((acc, lang) => ({ ...acc, [lang.code]: lang.flag }), {});

const getFlag = (langCode: string) => {
    if (!langCode || typeof langCode !== 'string') return '🌐';
    const normalized = langCode.toLowerCase().split('-')[0];
    return FLAGS[normalized] || '🌐';
};

// ==========================================
// 2. 工具函数 (Utilities)
// ==========================================

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
    let clean = text.replace(/#+\s/g, '').replace(/```/g, ''); 
    return renderBoldText(clean);
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

// ==========================================
// 3. 核心类型 (Types)
// ==========================================

const isNoun = (pos: string): boolean => formatPOS(pos) === '名词';

interface VocabEntry {
  word: string; 
  lang: Language; 
  pronunciation?: string; 
  pos: string; 
  gender?: string; 
  meaning: string; 
  level: string; 
  theme: string; 
  morphology?: string; 
  originalInput?: string; 
  idiom?: string; 
  idiomMeaning?: string; 
  sentences: { type?: string; target: string; translation: string; }[];
  synonyms: string[]; 
  antonyms: string[]; 
  crossRefs: { lang: string; word: string }[]; 
  conjugations?: { tense: string; forms: string[] }[]; 
  source?: string;
}
interface ReviewItem {
  id: string; entry: VocabEntry; stage: number; nextReviewDate: number; lastReviewedDate: number; addedAt?: number; created_at: number; isArchived: boolean; 
}
interface StoryData { target_story: string; mixed_story: string; }
interface ChatMessage { role: 'user' | 'ai'; text: string; timestamp: number; }

// ==========================================
// 4. 组件 (Components)
// ==========================================

// ✅ Updated: Uses GEMINI_SIMPLE_TTS_MODEL for basic buttons
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
      // Uses the simple/flash preview for buttons
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_SIMPLE_TTS_MODEL}:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
              contents: [{ parts: [{ text: text }] }], 
              generationConfig: { 
                  responseModalities: ["AUDIO"], 
                  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } 
              } 
          })
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
      console.warn("TTS Fallback:", error);
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

const Tag = ({ icon: Icon, text, colorClass, onClick, title }: { icon?: any, text: string, colorClass: string, onClick?: () => void, title?: string }) => (
  <button onClick={(e) => { e.stopPropagation(); onClick && onClick(); }} title={title} className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${colorClass} mr-2 mb-1 hover:brightness-95 transition-all ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-indigo-200' : 'cursor-default'}`}>
    {Icon && <Icon size={12} className="mr-1.5" />} {text}
  </button>
);

// ==========================================
// 5. 主应用逻辑 (Main App)
// ==========================================

export default function App() {
  const [dbLoading, setDbLoading] = useState(true); 
  const [mainTab, setMainTab] = useState<'dictionary' | 'playground' | 'library' | 'review'>('dictionary'); 
  const [inputMode, setInputMode] = useState<'word' | 'text' | 'import'>('word');
  const [currentLang, setCurrentLang] = useState<Language>('en');
  const [isAutoLang, setIsAutoLang] = useState(true);

  // Data
  const [savedItems, setSavedItems] = useState<ReviewItem[]>([]);
  const [generatedEntries, setGeneratedEntries] = useState<VocabEntry[]>([]);
  const [generatedIndex, setGeneratedIndex] = useState(0);
  const [entry, setEntry] = useState<VocabEntry | null>(null);
  const [history, setHistory] = useState<VocabEntry[]>([]);
     
  // UI States
  const [inputWord, setInputWord] = useState('');
  const [inputText, setInputText] = useState('');
  const [importText, setImportText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false); 
  const [isFigurativeMode, setIsFigurativeMode] = useState(false);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [isClustering, setIsClustering] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
   
  // Conjugation Modal
  const [showConjugationModal, setShowConjugationModal] = useState(false);
     
  // Story & Chat & Image
  const [showStoryModal, setShowStoryModal] = useState(false);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [storyContent, setStoryContent] = useState<StoryData | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  // Playground State
  const [playgroundInput, setPlaygroundInput] = useState('');
  const [playgroundLang, setPlaygroundLang] = useState<Language | 'auto'>('auto');
  const [playgroundMode, setPlaygroundMode] = useState<'learning' | 'reinforce'>('learning');
  const [playgroundChat, setPlaygroundChat] = useState<ChatMessage[]>([]);
  const [playgroundUserMsg, setPlaygroundUserMsg] = useState('');
  const [isPlaygroundChatting, setIsPlaygroundChatting] = useState(false);
    
  // Playground 音频状态
  const [ttsGender, setTtsGender] = useState<'female' | 'male' | 'dialogue'>('female');
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);

  const playgroundEndRef = useRef<HTMLDivElement>(null);

  // Review Logic 
  const [reviewQueue, setReviewQueue] = useState<ReviewItem[]>([]);
  const [isReviewFlipped, setIsReviewFlipped] = useState(false); 
  const [reviewFilterLang, setReviewFilterLang] = useState<Language | 'all'>('all'); 

  // Filters
  const [filters, setFilters] = useState({ lang: 'all', level: 'all', pos: 'all', theme: 'all' });
  const [sortMode, setSortMode] = useState<'recent' | 'review_soon' | 'level_asc'>('recent');
  const [showArchived, setShowArchived] = useState(false);
  const [generatedMarkdown, setGeneratedMarkdown] = useState('');

  // --- Auth Logic ---
  useEffect(() => {
    if (!isFirebaseAvailable) return;
    const initAuth = async () => {
        try { await signInAnonymously(auth); } catch (error) { console.error("Auth error", error); }
    };
    initAuth();
    return onAuthStateChanged(auth, () => { });
  }, []);

  // --- Data Sync ---
  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, 'vocabulary')); 
    return onSnapshot(q, (snapshot) => {
      const items: ReviewItem[] = [];
      snapshot.forEach(doc => {
          const rawData = doc.data();
          const cleanItem: any = {
             id: doc.id, ...rawData, addedAt: rawData.addedAt || rawData.created_at || Date.now(), 
             entry: rawData.entry || { word: "Error Data", sentences: [] } 
          };
          if (!cleanItem.entry.sentences) cleanItem.entry.sentences = [];
          items.push(cleanItem);
      });
      items.sort((a: any, b: any) => b.addedAt - a.addedAt);
      setSavedItems(items); setDbLoading(false);
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

  useEffect(() => {
    if (generatedEntries.length > 0) {
      setEntry(generatedEntries[generatedIndex]); setChatMessages([]); setGeneratedImage(null); setShowMarkdown(false);
    }
  }, [generatedIndex, generatedEntries]);

  // Markdown Aggregation
  useEffect(() => {
      if (generatedEntries.length === 0) return;
      const mdOutput = generatedEntries.map(e => {
          const sentencesStr = e.sentences?.map(s => ` • ${s.type ? `[${s.type}] ` : ''}${s.target} ${s.translation}`).join('\n') || '';
          return `---
# ${e.word}
#vocab/${formatPOS(e.pos)} ${e.meaning}
#comp/level/${e.level?.toLowerCase() || 'b2'} #comp/theme/${e.theme}
${e.idiom ? `Expression: ${e.idiom} (${e.idiomMeaning})\n` : ''}
${sentencesStr}
 • 同义词: ${e.synonyms?.join(', ')}
 • 反义词: ${e.antonyms?.join(', ')}
>[[${e.source || 'polyglot-app'}]]`;
      }).join('\n\n');
      setGeneratedMarkdown(mdOutput);
  }, [generatedEntries]);

  useEffect(() => { playgroundEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [playgroundChat]);

  const copyToClipboard = () => { if (generatedMarkdown) navigator.clipboard.writeText(generatedMarkdown); };
  const handleTagJump = (type: 'lang' | 'level' | 'pos' | 'theme', value: string) => { setFilters(prev => ({ ...prev, [type]: value })); setMainTab('library'); };
  const toggleArchive = async (id: string, currentStatus: boolean) => { await updateDoc(doc(db, 'vocabulary', id), { isArchived: !currentStatus }); };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!confirm(`确定要导入文件 "${file.name}" 吗？`)) return;
    setIsGenerating(true); 
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const rawData = JSON.parse(text);
        const items = Array.isArray(rawData) ? rawData : [rawData];
        let successCount = 0;
        const batchNow = Date.now();
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const newDoc = {
            id: `import-${batchNow}-${i}`, entry: { ...item, source: "Batch File Import" }, stage: 0, addedAt: batchNow, lastReviewedDate: batchNow, nextReviewDate: batchNow, isArchived: false
          };
          await setDoc(doc(db, "vocabulary", newDoc.id), newDoc);
          successCount++;
        }
        alert(`✅ 导入成功！共处理了 ${successCount} 条单词。`);
        window.location.reload();
      } catch (error) { alert("文件解析失败！"); } finally { setIsGenerating(false); event.target.value = ''; }
    };
    reader.readAsText(file);
  };

  const deleteItem = async (e: React.MouseEvent, id: string) => {
      e.stopPropagation(); 
      if(window.confirm("Permanently delete this card?")) {
          try { await deleteDoc(doc(db, 'vocabulary', id)); } catch (err) { alert("Error deleting: " + err); }
      }
  };

  // --- AI Logic (Basic) ---
  const callGemini = async (prompt: string, isJson: boolean = false) => {
    try {
      if (requestCache.has(prompt)) return requestCache.get(prompt);
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
              contents: [{ parts: [{ text: prompt }] }], 
              generationConfig: isJson ? { responseMimeType: "application/json" } : undefined,
              safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" }, { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }]
          })
      });
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const data = await response.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (isJson && text) text = text.replace(/```json\n?|```/g, '').trim();
      if (text) requestCache.set(prompt, text); 
      return text;
    } catch (error) { console.error("Gemini API Error:", error); return null; }
  };

  // --- Playground Logic (Chat) ---
  const handlePlaygroundChat = async () => {
    if (!playgroundUserMsg.trim()) return;
    const userMsg: ChatMessage = { role: 'user', text: playgroundUserMsg, timestamp: Date.now() };
    const newHistory = [...playgroundChat, userMsg];
    setPlaygroundChat(newHistory); setPlaygroundUserMsg(''); setIsPlaygroundChatting(true);

    const langLabel = playgroundLang === 'auto' ? "detected language" : LANGUAGES.find(l => l.code === playgroundLang)?.label || "Target Language";
    let systemPrompt = "";
    
    if (playgroundMode === 'learning') {
        systemPrompt = `
            You are a helpful language tutor for ${langLabel}.
            The user provided this context text: "${playgroundInput.substring(0, 500)}...".
             
            Goal: Engage in a natural conversation about this text or topic.
            - Correct any major grammar mistakes gently in your response.
            - Keep the conversation flowing.
            - Respond in target language primarily, but provide Chinese hints if the user seems stuck or asks.
        `;
    } else {
        const validWords = savedItems
            .filter(i => playgroundLang === 'auto' || i.entry.lang === playgroundLang)
            .map(i => i.entry.word);
        
        const randomWords = validWords.sort(() => 0.5 - Math.random()).slice(0, 5);
        const wordList = randomWords.join(', ');

        systemPrompt = `
            You are a strict language tutor for ${langLabel}.
             
            GOAL: Help the user practice these specific words from their vocabulary list: [ ${wordList || "No specific words found, just chat"} ].
             
            INSTRUCTIONS:
            1. Ask a question related to the input text: "${playgroundInput.substring(0, 300)}...".
            2. TRY to guide the user to use one of the target words in their answer.
            3. If they use a target word correctly, praise them.
            4. Respond in target language.
        `;
    }
    const historyText = newHistory.map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`).join('\n');
    const response = await callGemini(`${systemPrompt}\n\nConversation History:\n${historyText}\n\nAI Response:`);
    setIsPlaygroundChatting(false);
    if (response) setPlaygroundChat([...newHistory, { role: 'ai', text: response, timestamp: Date.now() }]);
  };

// ✅ Playground Audio (带自动降级：Pro -> Flash)
  const handlePlaygroundAudio = async (action: 'play' | 'download') => {
      if (!playgroundInput.trim()) return;
      setIsProcessingAudio(true);
      
      const isDialogue = ttsGender === 'dialogue';
      
      // 1. 准备 Pro 模型需要的 Multi-speaker 配置
      let proSpeechConfig: any = {};
      
      if (isDialogue) {
          const lines = playgroundInput.split('\n');
          const speakerMap = new Map<string, string>();
          const distinctSpeakers: string[] = [];
          
          lines.forEach(line => {
              const match = line.match(/^([^:：]+)[:：]/);
              if (match) {
                  const name = match[1].trim();
                  if (!speakerMap.has(name) && distinctSpeakers.length < 5) {
                      const voiceName = AVAILABLE_VOICES[distinctSpeakers.length];
                      speakerMap.set(name, voiceName);
                      distinctSpeakers.push(name);
                  }
              }
          });

          if (distinctSpeakers.length > 0) {
              proSpeechConfig = {
                  multiSpeakerVoiceConfig: {
                      speakerVoiceConfigs: distinctSpeakers.map(name => ({
                          speaker: name,
                          voiceConfig: { prebuiltVoiceConfig: { voiceName: speakerMap.get(name)! } }
                      }))
                  }
              };
          } else {
              proSpeechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } };
          }
      } else {
          proSpeechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: ttsGender === 'female' ? "Kore" : "Fenrir" } } };
      }

      // 封装处理音频数据的辅助函数
      const processAudioData = (base64Audio: string) => {
          const wavUrl = pcmToWav(base64Audio);
          if (action === 'play') {
              new Audio(wavUrl).play();
          } else {
              const link = document.createElement('a');
              link.href = wavUrl;
              link.download = `polyglot_tts_${playgroundLang}_${Date.now()}.wav`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
          }
      };

      try {
          // 尝试 1: 使用 Pro 模型 (支持多说话人)
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PRO_TTS_MODEL}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: isDialogue ? `TTS the following conversation, ignoring the speaker name in audio:\n${playgroundInput}` : playgroundInput }] }], 
                    generationConfig: { 
                        responseModalities: ["AUDIO"], 
                        speechConfig: proSpeechConfig
                    }
                }),
            }
          );

          if (!response.ok) throw new Error(`Pro TTS failed: ${response.status}`);
          const data = await response.json();
          const base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (base64Audio) {
              processAudioData(base64Audio);
              return; // 成功则退出
          }
          throw new Error("No audio data in Pro response");

      } catch (e) {
          console.warn("Pro TTS Model failed, falling back to Flash...", e);

          try {
              // 尝试 2: 降级到 Flash 模型 (仅支持单人 voiceConfig)
              // 强制使用单人配置，忽略之前的 multiSpeaker 配置
              const fallbackConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } };

              const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_SIMPLE_TTS_MODEL}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: playgroundInput }] }], // Flash可能对prompt指令理解较弱，直接传原文
                        generationConfig: { 
                            responseModalities: ["AUDIO"], 
                            speechConfig: fallbackConfig
                        }
                    }),
                }
              );

              if (!response.ok) throw new Error(`Flash TTS failed: ${response.status}`);
              const data = await response.json();
              const base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
              if (base64Audio) {
                  processAudioData(base64Audio);
              } else {
                  alert("Audio generation failed on both models.");
              }
          } catch (e2) {
              console.error(e2);
              alert("TTS Service currently unavailable. Please check your API Key or Quota.");
          }
      } finally {
          setIsProcessingAudio(false);
      }
  };

  // --- Dictionary AI Logic ---
  const handleGenerate = async (overrideWord?: string) => {
    const target = overrideWord || inputWord || inputText;
    if (!target) return;
    if (inputMode === 'word') {
        const existingItem = savedItems.find(i => i.entry.word.toLowerCase() === target.toLowerCase());
        if (existingItem) { setEntry(existingItem.entry); setGeneratedEntries([existingItem.entry]); setGeneratedIndex(0); setMainTab('dictionary'); setInputWord(''); return; }
    }
    setIsGenerating(true); setMainTab('dictionary');

    const shouldUseAuto = isAutoLang && !overrideWord;
    
    let targetLangCode = "en";
    let targetLangLabel = "English";

    if (!shouldUseAuto) {
        const targetLangObj = LANGUAGES.find(l => l.code === (overrideWord ? entry?.lang || 'en' : currentLang)); 
        targetLangLabel = targetLangObj?.label || "English";
        targetLangCode = targetLangObj?.code || "en";
    }

    const systemPrompt = `You are a precise lexicographer API. 
    Role: Generate a STRICT JSON object for the word "${target}". 
     
    ${shouldUseAuto 
      ? `INSTRUCTION: DETECT the language of the input word "${target}". Set 'lang' to the detected ISO code (e.g., 'it' for Italian, 'es' for Spanish).` 
      : `Target Language: ${targetLangLabel} (${targetLangCode}).`}
     
    User Language: Chinese (Simplified).

    RULES:
    1. "meaning": Return direct Chinese translation keywords (e.g., '惊叹，令人窒息的'). DO NOT provide a descriptive sentence.
    2. "pos": Return standard part of speech in CHINESE (e.g., 名词, 动词, 形容词).
    3. "sentences": You MUST provide exactly 2 sentences:
       - Sentence 1: "Common" - A common, conversational, or simple usage.
       - Sentence 2: "Advanced" - A literary, formal, or complex academic usage.
       - Structure: {"type": "Common" or "Advanced", "target": "...", "translation": "..."}
    4. "crossRefs": List 3-4 semantic equivalents in: German (de), French (fr), Spanish (es), Japanese (ja).
    5. "level": CEFR Level (B1, B2, C1, C2).
    6. "theme": MUST be a broad, standardized category in CHINESE (e.g., 商业, 情感, 自然, 科技, 生活).
    7. "pronunciation": MUST use International Phonetic Alphabet (IPA) inside brackets, e.g., /.../.
    8. **IMPORTANT FOR JAPANESE/CHINESE**: 
       - "word" field MUST use Kanji/Hanzi (e.g., '猫').
       - "pronunciation" field MUST use Kana/Pinyin (e.g., 'ねこ').
    9. **Punctuation**: Use CHINESE Punctuation (，。；) for all Chinese text in meaning/translations.
    10. **Lemma**: If input is a conjugated verb or declined noun, the 'word' field MUST be the LEMMA (Infinitive/Singular). Fill 'morphology' with the analysis of the input form (e.g., "变位自: spaventano - 第三人称复数").
    11. **Conjugations (IMPORTANT)**: If it is a VERB, provide a DETAILED 'conjugations' array.
       - Include Indicative: Present, Imperfect, Future, Compound Past (e.g., Passato Prossimo), Remote/Simple Past (e.g., Passato Remoto).
       - Include: Subjunctive (Present, Imperfect), Conditional, Imperative.
       - Include: Participles (Present & Past) grouped under a single "Participles" section.
     
    JSON SCHEMA:
    {
      "word": "Lemma of ${target}",
      "lang": "${shouldUseAuto ? "detected_code" : targetLangCode}",
      "pos": "string (CN)",
      "meaning": "string (CN)",
      "level": "string",
      "theme": "string (CN)",
      "sentences": [
        {"type": "Common", "target": "string", "translation": "string (CN)"},
        {"type": "Advanced", "target": "string", "translation": "string (CN)"}
      ],
      "synonyms": ["string", "string"],
      "antonyms": ["string"],
      "crossRefs": [{"lang": "code", "word": "string"}],
      "conjugations": [{"tense": "string (CN/Target)", "forms": ["string"]}],
      "morphology": "string (CN, optional)",
      "idiom": "string (optional)",
      "idiomMeaning": "string (CN)",
      "pronunciation": "string (IPA)"
    }`;

    const prompt = inputMode === 'word' || overrideWord 
        ? systemPrompt 
        : `Extract vocabulary from text. Return JSON ARRAY using schema: ${systemPrompt}. Text: "${target.substring(0, 2000)}"`;
    
    const result = await callGemini(prompt, true);
    setIsGenerating(false);
    if (result) {
      try {
        const parsed = JSON.parse(result);
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        
        const validEntries = entries.map((e: any) => ({ 
            ...e, 
            sentences: Array.isArray(e.sentences) ? e.sentences : [], 
            synonyms: Array.isArray(e.synonyms) ? e.synonyms : [], 
            antonyms: Array.isArray(e.antonyms) ? e.antonyms : [], 
            crossRefs: Array.isArray(e.crossRefs) ? e.crossRefs : [], 
            conjugations: Array.isArray(e.conjugations) ? e.conjugations : [],
            pos: formatPOS(e.pos), 
            level: e.level?.toUpperCase()||'B2',
            originalInput: target !== e.word ? target : undefined
        }));
        
        setGeneratedEntries(validEntries); setGeneratedIndex(0); setEntry(validEntries[0]); setGeneratedImage(null);
        
        if (validEntries[0]?.lang) {
            const detectedCode = validEntries[0].lang.toLowerCase();
            if (LANGUAGES.some(l => l.code === detectedCode)) {
                setCurrentLang(detectedCode as Language);
            }
        }
      } catch (e) { alert("Failed to parse AI response. Please try again."); }
    }
  };

  const handleJump = (word: string) => {
      if (entry) setHistory(prev => [...prev, entry]);
      setGeneratedImage(null); 
      handleGenerate(word);
  };

  const handleBack = () => {
      if (history.length === 0) return;
      const previous = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));
      setEntry(previous);
      setGeneratedImage(null); 
      setGeneratedEntries([previous]); 
      setGeneratedIndex(0);
  };

  const handleSmartImport = async () => {
      if (!importText) return;
      setIsGenerating(true); setMainTab('dictionary');
      const prompt = `PARSE input text to JSON ARRAY. User: CN Native. TASK: 1. Identify vocab. 2. Gen missing definitions/sentences. 3. Gen theme. 4. Estimate level. Input: "${importText.substring(0, 4000)}"`;
      const result = await callGemini(prompt, true);
      setIsGenerating(false);
      if (result) {
          try {
              const entries = JSON.parse(result);
              const unique = (Array.isArray(entries) ? entries : [entries]).filter((e: any) => !savedItems.some(i => i.entry.word.toLowerCase() === e.word.toLowerCase()));
              if (unique.length > 0) {
                  const batch = unique.map((en: VocabEntry) => {
                      const newItem: ReviewItem = { id: crypto.randomUUID(), entry: { ...en, source: "Smart Import" }, stage: 0, nextReviewDate: Date.now(), lastReviewedDate: Date.now(), created_at: Date.now(), isArchived: false };
                      return setDoc(doc(db, 'vocabulary', newItem.id), sanitizeData(newItem));
                  });
                  await Promise.all(batch);
                  alert(`Imported ${unique.length} items.`);
                  setGeneratedEntries(unique); setEntry(unique[0]); setImportText('');
              }
          } catch (e) { alert("Import Failed."); }
      }
  };

  const handleAutoCluster = async () => {
      setIsClustering(true);
      const themes = [...new Set(savedItems.map(i => i.entry.theme))];
      const result = await callGemini(`Group themes into 6-8 CN categories. JSON { "old": "new" }. Themes: ${JSON.stringify(themes)}`, true);
      setIsClustering(false);
      if (result) {
          try {
              const map = JSON.parse(result);
              const batch = writeBatch(db);
              savedItems.forEach(item => {
                  if (map[item.entry.theme]) batch.update(doc(db, 'vocabulary', item.id), { 'entry.theme': map[item.entry.theme] });
              });
              await batch.commit();
              alert("Themes Organized!");
          } catch (e) { console.error(e); }
      }
  };

  const handleSmartEnrich = async () => {
      if (!entry) return;
      setIsEnriching(true);
      const hasSents = entry.sentences && entry.sentences.length > 0;
      const task = hasSents ? `TASK: 1. Add 1 NEW "Advanced/Literary" sentence. 2. Add Synonyms/CrossRefs. 3. DO NOT delete existing.` : `TASK: Add 2 sentences, synonyms, cross-refs.`;
      const result = await callGemini(`ENRICH "${entry.word}". Current: ${JSON.stringify(entry)} ${task} Return FULL JSON.`, true);
      setIsEnriching(false);
      if (result) {
          try {
              const enriched = JSON.parse(result);
              let newSents = entry.sentences || [];
              if (enriched.sentences) {
                  const existT = new Set(newSents.map(s => s.target));
                  newSents = [...newSents, ...enriched.sentences.filter((s: any) => !existT.has(s.target))];
              }
              const merged = { ...entry, ...enriched, sentences: newSents, crossRefs: enriched.crossRefs || entry.crossRefs, pos: formatPOS(enriched.pos || entry.pos) };
              setEntry(merged);
              const newGen = [...generatedEntries]; newGen[generatedIndex] = merged; setGeneratedEntries(newGen);
              if (isCurrentSaved) { await updateDoc(doc(db, 'vocabulary', isCurrentSaved.id), { entry: sanitizeData(merged) }); alert("Updated!"); }
          } catch(e) { alert("Enrich failed"); }
      }
  };

  const handleSmartSave = async () => {
    if (!entry) return;
    const wordToSave = (entry.idiom && entry.idiom.length > entry.word.length) ? entry.idiom : entry.word;
    const exist = savedItems.find(i => i.entry.word.toLowerCase() === wordToSave.toLowerCase());
    const now = Date.now();
    
    setSaveStatus('saved'); 
    
    if (exist) {
      const merged = { ...exist.entry, sentences: [...exist.entry.sentences, ...entry.sentences], synonyms: [...new Set([...exist.entry.synonyms, ...entry.synonyms])], crossRefs: [...exist.entry.crossRefs, ...entry.crossRefs] };
      await updateDoc(doc(db, 'vocabulary', exist.id), { entry: sanitizeData(merged), created_at: now }); 
    } else {
      const newItem = { id: crypto.randomUUID(), entry: { ...entry, word: wordToSave }, stage: 0, nextReviewDate: now, lastReviewedDate: now, created_at: now, addedAt: now, isArchived: false };
      await setDoc(doc(db, 'vocabulary', newItem.id), sanitizeData(newItem));
    }
    
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  const handleReviewAction = async (action: 'reset' | 'remember' | 'boost') => {
      const item = reviewQueue[0]; if (!item) return; 
      setReviewQueue(prev => prev.slice(1)); setIsReviewFlipped(false);
      try {
          let nextStage = item.stage;
          let nextDate = Date.now();

          if (action === 'reset') {
              nextStage = 0;
              // Reset sets date to now (review again immediately or soon)
          } else if (action === 'remember') {
              nextStage = Math.min(item.stage + 1, INTERVALS.length - 1);
              nextDate = Date.now() + INTERVALS[nextStage] * 86400000;
          } else if (action === 'boost') {
              // Boost: Advance stage but force 14 days interval
              nextStage = Math.min(item.stage + 1, INTERVALS.length - 1);
              nextDate = Date.now() + 14 * 86400000; 
          }

          await updateDoc(doc(db, 'vocabulary', item.id), { 
              nextReviewDate: nextDate, 
              stage: nextStage, 
              lastReviewedDate: Date.now() 
          });
      } catch(e) { console.error(e); }
      if (reviewQueue.length <= 1) setMainTab('library');
  };

  const handleChatSubmit = async () => {
    if (!chatInput || !entry) return;
    const userMsg: ChatMessage = { role: 'user', text: chatInput, timestamp: Date.now() };
    setChatMessages(prev => [...prev, userMsg]); setChatInput(''); setIsChatting(true);
    if (chatInput.trim() === '/json') { setChatMessages(prev => [...prev, { role: 'ai', text: JSON.stringify(entry, null, 2), timestamp: Date.now() }]); setIsChatting(false); return; }
    const res = await callGemini(`Context: "${entry.word}" (${entry.meaning}). User: "${userMsg.text}". Answer in CN.`);
    setIsChatting(false); if (res) setChatMessages(prev => [...prev, { role: 'ai', text: res, timestamp: Date.now() }]);
  };

  const handleStory = async (words: VocabEntry[]) => {
    if (words.length === 0) return;
    setIsGeneratingStory(true); setShowStoryModal(true);
    const targetLang = words[0].lang; 
    const langName = LANGUAGES.find(l => l.code === targetLang)?.label || targetLang;
    const result = await callGemini(`Create story with: ${words.map(w=>w.word).join(',')}. CONSTRAINTS: 1. Target Story MUST be in ${langName}. 2. Mixed Story in Chinese with bold keywords. JSON: { "target_story": "...", "mixed_story": "..." }`, true);
    if (result) { try { setStoryContent(JSON.parse(result)); } catch (e) { console.error(e); } }
    setIsGeneratingStory(false);
  };

  const handleGenerateImage = async () => {
      if (!entry) return;
      if (isGeneratingImage) return;
      setIsGeneratingImage(true);
      try {
          // Concrete prompt for better results
          const prompt = `A concrete, realistic scene depicting the meaning of '${entry.word}': ${entry.meaning}. High quality, clear details, cinematic lighting.`;
          
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict?key=${apiKey}`, 
            { 
              method: 'POST', 
              headers: { 'Content-Type': 'application/json' }, 
              body: JSON.stringify({ 
                instances: [{ prompt: prompt }], 
                parameters: { sampleCount: 1 } 
              }) 
            }
          );
          
          if (!response.ok) {
              console.warn("Imagen API failed/restricted, switching to Pollinations fallback.");
              const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
              const img = new Image();
              img.src = pollinationsUrl;
              img.onload = () => {
                  setGeneratedImage(pollinationsUrl);
                  setIsGeneratingImage(false);
              };
              img.onerror = () => {
                  throw new Error("Fallback failed");
              };
          } else {
             const data = await response.json();
             if (data.predictions?.[0]?.bytesBase64Encoded) {
                 setGeneratedImage(`data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`);
             }
             setIsGeneratingImage(false);
          }
      } catch (e) { 
          const prompt = `Detailed, realistic scene representing the concept: '${entry.word}' (${entry.meaning}). High quality, cinematic lighting, 4k.`;
          setGeneratedImage(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`);
          setIsGeneratingImage(false);
      }
  };

  const startRoleplay = async () => {
      if (!entry) return;
      setChatInput(''); setIsChatting(true);
      const res = await callGemini(`Roleplay Scenario for "${entry.word}". Language: ${entry.lang}. OUTPUT: Context, AI line, Guide. NO translations.`);
      setIsChatting(false); if (res) setChatMessages(prev => [...prev, { role: 'ai', text: res, timestamp: Date.now() }]);
  };

  const getEtymology = async () => {
      if (!entry) return;
      setChatInput(''); setIsChatting(true);
      const res = await callGemini(`Etymology of "${entry.word}". Output in Chinese.`);
      setIsChatting(false); if (res) setChatMessages(prev => [...prev, { role: 'ai', text: res, timestamp: Date.now() }]);
  };
   
  const isCurrentSaved = useMemo(() => savedItems.find(i => i.entry.word === entry?.word), [savedItems, entry]);

  // ✅ FIX: Contextually Related based on Meaning (Score > 5)
  const relatedWords = useMemo(() => {
    if (!entry || !entry.word) return []; 
    const currentWordLower = (entry.word || '').toLowerCase();
    
    // Helper to check text inclusion
    const checkTextOverlap = (text1: string, text2: string) => {
        if (!text1 || !text2) return false;
        return text1.toLowerCase().includes(text2.toLowerCase());
    };

    const scored = savedItems
        .filter(item => item.id !== (isCurrentSaved?.id || '')) 
        .map(item => {
            let score = 0;
            const itemWordLower = (item.entry.word || '').toLowerCase();
            
            // Safety check for arrays
            const itemCrossRefs = Array.isArray(item.entry.crossRefs) ? item.entry.crossRefs : [];
            const entryCrossRefs = Array.isArray(entry.crossRefs) ? entry.crossRefs : [];
            const itemSynonyms = Array.isArray(item.entry.synonyms) ? item.entry.synonyms : [];
            const entrySynonyms = Array.isArray(entry.synonyms) ? entry.synonyms : [];

            // 1. Direct Synonym / CrossRef Match (High Relevance)
            const isSemanticMatch = 
                itemCrossRefs.some(r => (r?.word || '').toLowerCase() === currentWordLower) ||
                entryCrossRefs.some(r => (r?.word || '').toLowerCase() === itemWordLower) ||
                itemSynonyms.some(s => (s || '').toLowerCase() === currentWordLower) ||
                entrySynonyms.some(s => (s || '').toLowerCase() === itemWordLower);
            
            if (isSemanticMatch) score += 10;

            // 2. Definition Overlap (Medium Relevance)
            if (checkTextOverlap(item.entry.meaning, entry.word) || checkTextOverlap(entry.meaning, item.entry.word)) {
                score += 3;
            }

            // 3. Metadata Match (Low Relevance - not enough alone)
            if (item.entry.pos === entry.pos) score += 0.5;
            
            return { item, score };
        })
        .filter(x => x.score > 2) // Filter low relevance
        .sort((a, b) => b.score - a.score) 
        .slice(0, 6); 
    
    return scored.map(x => x.item.entry);
  }, [entry, savedItems, isCurrentSaved]);

  const filteredItems = useMemo(() => {
      let res = savedItems.filter(i => i.isArchived === showArchived);
      if (filters.lang !== 'all') res = res.filter(i => i.entry.lang === filters.lang);
      if (filters.level !== 'all') res = res.filter(i => i.entry.level === filters.level);
      if (filters.pos !== 'all') res = res.filter(i => i.entry.pos === filters.pos);
      if (filters.theme !== 'all') res = res.filter(i => i.entry.theme === filters.theme);
      return res.sort((a, b) => sortMode === 'recent' ? b.created_at - a.created_at : a.nextReviewDate - b.nextReviewDate);
  }, [savedItems, filters, sortMode, showArchived]);

  const availableLevels = useMemo(() => [...new Set(savedItems.map(i=>i.entry.level))].sort(), [savedItems]);
  const availablePos = useMemo(() => [...new Set(savedItems.map(i=>i.entry.pos))].sort(), [savedItems]);
  const availableThemes = useMemo(() => [...new Set(savedItems.map(i=>i.entry.theme))].sort(), [savedItems]);

  const getNextIntervalLabel = (currentStage: number) => `${INTERVALS[Math.min(currentStage + 1, INTERVALS.length - 1)]}d`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-20 md:pb-0 safe-p-b">
      {/* Mobile Nav */}
      <div className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-50 flex justify-around py-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] pb-safe">
        {['dictionary', 'playground', 'library', 'review'].map(tab => (
            <button key={tab} onClick={() => setMainTab(tab as any)} className={`flex flex-col items-center gap-1 ${mainTab === tab ? 'text-indigo-600' : 'text-slate-400'}`}>
                {tab==='dictionary'?<BookOpen size={20}/>:tab==='playground'?<Gamepad2 size={20}/>:tab==='library'?<Library size={20}/>:<RefreshCw size={20}/>}
                <span className="text-[10px] font-bold uppercase">{tab}</span>
            </button>
        ))}
      </div>

      <div className="max-w-7xl mx-auto p-4 md:p-8 min-h-[100dvh] flex flex-col">
        {/* ✅ Updated Header: Cleaned up */}
        <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-col items-start">
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                <div className="bg-indigo-600 text-white p-1.5 rounded-lg"><Globe size={20} /></div>
                Polyglot Lexicon 
            </h1>
            <p className="text-xs text-slate-400 font-medium mt-1 ml-10">Advanced Vocabulary Builder (B2-C2)</p>
          </div>
          
          {/* 👇 修改重点：我在这个 div 上加了 "hidden md:flex"，这样手机上整个白色框都会消失 */}
          <div className="hidden md:flex items-center gap-3 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex gap-1">
                {['dictionary', 'playground', 'library', 'review'].map(tab => (
                <button key={tab} onClick={() => setMainTab(tab as any)} className={`px-4 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all capitalize ${mainTab === tab ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                    {tab === 'review' && reviewQueue.length > 0 && <span className="w-2 h-2 bg-rose-500 rounded-full"></span>}{tab}
                </button>
                ))}
              </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col min-w-0">
          {mainTab === 'dictionary' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 h-full items-start">
              {/* Left: Input Panel */}
              <div className="lg:col-span-4 space-y-4 min-w-0">
                {/* ✅ Moved Language Selector Here */}
                <div className="flex gap-2 mb-2">
                     <button onClick={() => setIsAutoLang(!isAutoLang)} className={`flex-1 text-xs font-bold px-3 py-2 rounded-lg transition-colors border ${isAutoLang ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-slate-400 border-slate-200'}`}>
                        {isAutoLang ? "⚡ Auto-Detect" : "Manual Select"}
                     </button>
                     {!isAutoLang && (
                         <select value={currentLang} onChange={(e) => setCurrentLang(e.target.value as Language)} className="flex-[2] text-xs font-bold bg-white border border-slate-200 rounded-lg px-2 outline-none text-slate-600">
                             {LANGUAGES.map(l => <option key={l.code} value={l.code}>{getFlag(l.code)} {l.label}</option>)}
                         </select>
                     )}
                </div>

                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                   <div className="flex gap-2 mb-4 p-1 bg-slate-100 rounded-lg">
                       {['word', 'text', 'import'].map(m => ( 
                           <button key={m} onClick={() => setInputMode(m as any)} className={`flex-1 py-1.5 text-xs font-bold uppercase rounded-md transition-all ${inputMode === m ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{m}</button>
                       ))}
                   </div>
                   {inputMode === 'word' && (
                       <div className="space-y-3">
                           <div className="relative">
                               <input type="text" value={inputWord} onChange={e=>setInputWord(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleGenerate()} className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 outline-none transition-all font-medium" placeholder="Enter a word..." />
                               <button onClick={()=>handleGenerate()} disabled={isGenerating} className="absolute right-2 top-2 p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">{isGenerating ? <Loader2 size={16} className="animate-spin"/> : <Sparkles size={16}/>}</button>
                           </div>
                           <button onClick={() => setIsFigurativeMode(!isFigurativeMode)} className={`w-full flex items-center justify-center gap-2 text-xs font-bold py-2 rounded-lg border transition-all ${isFigurativeMode ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'}`}>
                               <Lightbulb size={12} className={isFigurativeMode?"fill-amber-500":""}/> {isFigurativeMode ? "Figurative Priority Active" : "Standard Definition Mode"}
                           </button>
                       </div>
                   )}
                   {inputMode === 'text' && (
                       <div className="space-y-2">
                           <textarea value={inputText} onChange={e=>setInputText(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl h-40 resize-none text-sm focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none" placeholder="Paste article text here..." />
                           <button onClick={()=>handleGenerate()} disabled={isGenerating} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm flex justify-center items-center gap-2 hover:bg-indigo-700 transition-colors">{isGenerating ? <Loader2 className="animate-spin" size={14}/> : <Sparkles size={14}/>} Analyze & Extract</button>
                       </div>
                   )}
                   {inputMode === 'import' && (
                       <div className="space-y-2">
                           <textarea value={importText} onChange={e=>setImportText(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl h-40 resize-none text-xs font-mono focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none" placeholder="Paste ANY text/list to import..." />
                           <button onClick={handleSmartImport} disabled={isGenerating} className="w-full py-2.5 bg-slate-800 text-white rounded-xl font-bold text-sm flex justify-center items-center gap-2 hover:bg-slate-900 transition-colors">{isGenerating ? <Loader2 size={14} className="animate-spin"/> : <Upload size={14}/>} Smart AI Import</button>
                       </div>
                   )}
                </div>
                
                <div className="hidden lg:block bg-slate-100/50 p-5 rounded-2xl border border-slate-200/50 text-center">
                    <div className="text-xs font-bold text-slate-400 uppercase mb-1">System Status</div>
                    <div className="flex items-center justify-center gap-2 text-slate-600 font-medium text-sm">
                        <Database size={14} className={isFirebaseAvailable ? "text-emerald-500" : "text-slate-400"}/> 
                        {isFirebaseAvailable ? 'Cloud Sync Active' : 'Offline / Local'}
                        {dbLoading && <Loader2 size={14} className="animate-spin text-slate-400"/>}
                    </div>
                </div>
              </div>

              {/* Right: Card Display */}
              <div className="lg:col-span-8 min-w-0">
                {entry ? (
                    <div className="bg-white rounded-2xl shadow-xl border border-indigo-50/50 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col">
                        <div className={`bg-slate-50/80 p-6 md:p-8 border-b border-slate-100 relative ${history.length > 0 ? 'pl-14 pt-12 md:pl-8 md:pt-8' : ''}`}>
                             {/* Back Button */}
                             {history.length > 0 && (
                                 <button onClick={handleBack} className="absolute top-4 left-4 z-20 p-2 bg-white border border-slate-200 rounded-full hover:bg-slate-50 text-slate-500 transition-all shadow-sm group">
                                     <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
                                 </button>
                             )}

                             {generatedEntries.length > 1 && (
                                <div className="flex justify-center mb-4">
                                    <div className="flex items-center bg-white border border-slate-200 rounded-full px-3 py-1 shadow-sm">
                                        <button onClick={()=>setGeneratedIndex(i=>Math.max(0, i-1))} disabled={generatedIndex===0} className="p-1 disabled:opacity-30 hover:bg-slate-100 rounded-full"><ChevronLeft size={14}/></button>
                                        <span className="text-xs font-bold text-slate-500 mx-3">{generatedIndex+1} / {generatedEntries.length}</span>
                                        <button onClick={()=>setGeneratedIndex(i=>Math.min(generatedEntries.length-1, i+1))} disabled={generatedIndex===generatedEntries.length-1} className="p-1 disabled:opacity-30 hover:bg-slate-100 rounded-full"><ChevronRight size={14}/></button>
                                    </div>
                                </div>
                             )}
                             <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                                 <div className="w-full min-w-0">
                                     {entry.morphology && (
                                         <div className="mb-2 inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-xs font-bold w-full md:w-auto">
                                             <Split size={14}/> {entry.morphology}
                                         </div>
                                     )}
                                     
                                     <div className="flex flex-wrap items-center gap-2 mb-3">
                                         <span className="text-3xl drop-shadow-sm mr-1">{getFlag(entry.lang)}</span>
                                         <Tag text={entry.lang?.toUpperCase() || 'EN'} colorClass="bg-white border border-slate-200 text-slate-500 shadow-sm" onClick={()=>handleTagJump('lang', entry.lang)} title="Filter by Language"/>
                                         <Tag text={formatPOS(entry.pos)} colorClass="bg-white border border-slate-200 text-slate-500 shadow-sm" onClick={()=>handleTagJump('pos', entry.pos)} title="Filter by POS"/>
                                         {isNoun(entry.pos) && entry.gender && <Tag text={entry.gender} colorClass="bg-purple-50 border border-purple-100 text-purple-700"/>}
                                         <Tag text={entry.level} colorClass="bg-amber-50 border border-amber-100 text-amber-700" icon={ChevronRight} onClick={()=>handleTagJump('level', entry.level)} title="Filter by Level"/>
                                         <Tag text={entry.theme} colorClass="bg-blue-50 border border-blue-100 text-blue-700" icon={Hash} onClick={()=>handleTagJump('theme', entry.theme)} title="Filter by Theme"/>
                                     </div>
                                     
                                     <div className="relative flex items-center gap-3">
                                         {/* Font Size Clamp for Mobile */}
                                         <h2 className="font-serif font-bold text-slate-900 leading-none tracking-tight break-words hyphens-auto" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)' }}>{entry.word}</h2>
                                         
                                         {entry.conjugations && entry.conjugations.length > 0 && (
                                             <button onClick={()=>setShowConjugationModal(true)} className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors" title="View Conjugations">
                                                 <Grid3X3 size={20}/>
                                             </button>
                                         )}
                                     </div>

                                     <div className="flex items-center gap-4 mt-4 flex-wrap">
                                         {entry.pronunciation && (
                                            <span className="text-slate-500 font-mono text-lg tracking-wide">{entry.pronunciation}</span>
                                         )}
                                         <TTSButton text={entry.word} lang={entry.lang} size={22} />
                                         <button onClick={handleGenerateImage} disabled={isGeneratingImage} className="p-2 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors" title="Generate Visual Mnemonic">{isGeneratingImage ? <Loader2 size={18} className="animate-spin"/> : <ImageIcon size={18}/>}</button>
                                     </div>
                                 </div>
                                 <div className="flex gap-2 shrink-0 w-full md:w-auto">
                                    {isCurrentSaved && (
                                        <button onClick={handleSmartEnrich} disabled={isEnriching} className={`p-3 rounded-xl border transition-all bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100`} title="Auto-Complete Missing Data">{isEnriching ? <Loader2 className="animate-spin"/> : <Sparkles size={18}/>}</button>
                                    )}
                                    <button onClick={handleSmartSave} className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold shadow-lg shadow-indigo-200/50 transition-all transform hover:scale-105 ${saveStatus==='saved' ? 'bg-emerald-500 text-white scale-105' : isCurrentSaved ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                                        {saveStatus==='saved' ? <CheckCircle size={18}/> : isCurrentSaved ? <><Merge size={18}/> Update</> : <><Save size={18}/> Save</>}
                                    </button>
                                    {isCurrentSaved && (<><button onClick={()=>toggleArchive(isCurrentSaved.id, isCurrentSaved.isArchived)} className={`p-3 rounded-xl border transition-all ${isCurrentSaved.isArchived ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-400 hover:text-slate-600 border-slate-200'}`} title={isCurrentSaved.isArchived ? "Unarchive" : "Archive"}><Archive size={18}/></button><button onClick={(e)=>deleteItem(e, isCurrentSaved.id)} className="p-3 rounded-xl border border-rose-200 text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-all z-50 relative" title="Delete"><Trash2 size={18}/></button></>)}
                                 </div>
                             </div>
                        </div>

                        <div className="p-6 md:p-10 space-y-8">
                             {generatedImage && (<div className="rounded-xl overflow-hidden bg-slate-100 border border-slate-200 mb-6 animate-in fade-in zoom-in-95"><img src={generatedImage} alt="Visual Mnemonic" className="w-full h-64 object-cover"/></div>)}
                             <div className="text-xl md:text-2xl text-slate-800 font-medium leading-relaxed border-l-4 border-indigo-400 pl-6 py-1 break-words">{entry.meaning}</div>
                             {entry.idiom && (<div className="bg-amber-50/80 p-5 rounded-xl border border-amber-100/80 text-amber-900 relative overflow-hidden"><div className="absolute top-0 right-0 p-2 opacity-10"><Flame size={80}/></div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600 mb-2"><Flame size={12}/> Idiomatic Usage</div><div className="text-xl font-serif font-bold mb-1 relative z-10">{entry.idiom}</div><div className="text-base opacity-80 relative z-10">{entry.idiomMeaning}</div></div>)}
                             <div className="space-y-4">{(entry?.sentences || []).map((s, i) => (<div key={i} className="group p-4 rounded-xl border border-transparent hover:bg-slate-50 hover:border-slate-100 transition-all"><div className="flex justify-between items-start gap-4"><div className="text-lg text-slate-800 leading-relaxed font-medium break-words">{s.type && <span className="text-xs font-bold text-indigo-400 uppercase mr-2 bg-indigo-50 px-1.5 py-0.5 rounded align-middle">{s.type}</span>}{s.target}</div><div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><TTSButton text={s.target} lang={entry.lang} minimal size={18}/></div></div><div className="text-slate-500 mt-2 pl-1">{s.translation}</div></div>))}</div>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8 border-t border-slate-100">
                                 <div className="space-y-6">
                                     <div><span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">Synonyms</span><div className="flex flex-wrap gap-2">{(entry?.synonyms || []).length > 0 ? entry?.synonyms.map((s, i)=><span key={`syn-${i}`} onClick={()=>handleJump(s)} className="cursor-pointer px-2.5 py-1 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-md hover:bg-indigo-100 transition-colors">{s}</span>) : <span className="text-sm text-slate-300 italic">None</span>}</div></div>
                                     <div><span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">Antonyms</span><div className="flex flex-wrap gap-2">{(entry?.antonyms || []).length > 0 ? entry?.antonyms.map((s, i)=><span key={`ant-${i}`} onClick={()=>handleJump(s)} className="cursor-pointer px-2.5 py-1 bg-rose-50 text-rose-700 text-sm font-medium rounded-md hover:bg-rose-100 transition-colors">{s}</span>) : <span className="text-sm text-slate-300 italic">None</span>}</div></div>
                                 </div>
                                 <div><span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">Cross-Language</span><div className="flex flex-wrap gap-2">{(entry?.crossRefs || []).map((ref, i) => (<div key={i} onClick={()=>handleJump(ref.word)} className="cursor-pointer flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-indigo-200 transition-colors group"><span className="text-base opacity-80 group-hover:opacity-100 transition-opacity">{getFlag(ref.lang)}</span> <span className="text-sm font-medium text-slate-700">{ref.word}</span></div>))}</div></div>
                                 
                                 <div className="md:col-span-2">
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">Contextually Related</span>
                                    <div className="flex flex-wrap gap-2">
                                        {relatedWords.length > 0 ? relatedWords.map((w, i) => (
                                            <button key={`rel-${i}`} onClick={() => handleJump(w.word)} className="group flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg hover:border-indigo-300 hover:bg-white transition-all text-left">
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1">{getFlag(w.lang)} {w.word}</span>
                                                    <span className="text-[10px] text-slate-400">{(w.meaning || '').substring(0, 10)}...</span>
                                                </div>
                                                {w.theme === entry.theme && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" title="Same Theme"></span>}
                                            </button>
                                        )) : <span className="text-sm text-slate-300 italic">No highly relevant words found.</span>}
                                    </div>
                                 </div>
                             </div>
                             <div className="pt-6 border-t border-slate-100">
                                <div className="bg-indigo-50/50 rounded-xl p-4 border border-indigo-100">
                                    <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><MessageCircle size={16} className="text-indigo-500"/><span className="text-xs font-bold text-indigo-900 uppercase">AI Context Chat</span></div><div className="flex gap-2"><button onClick={getEtymology} className="text-[10px] bg-white border border-indigo-100 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-50 flex items-center gap-1"><Clock size={10}/> Etymology</button><button onClick={startRoleplay} className="text-[10px] bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 flex items-center gap-1"><Gamepad2 size={10}/> Roleplay</button></div></div>
                                    <div className="space-y-3 mb-3 max-h-[200px] overflow-y-auto custom-scrollbar">{chatMessages.map((m, i) => (<div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[90%] px-3 py-2 rounded-lg text-sm leading-relaxed ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border border-indigo-100 text-indigo-900 shadow-sm'}`}>{renderChatText(m.text)}</div></div>))}{isChatting && <div className="flex justify-start"><div className="bg-white px-3 py-2 rounded-lg border border-indigo-100"><Loader2 size={14} className="animate-spin text-indigo-400"/></div></div>}</div>
                                    <div className="flex gap-2"><input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleChatSubmit()} className="flex-1 bg-white border border-indigo-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none placeholder:text-indigo-200" placeholder="Ask about nuances, formality... (Try /json)" /><button onClick={handleChatSubmit} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"><Send size={16}/></button></div>
                                </div>
                             </div>
                        </div>
                        <div className="bg-slate-900 px-6 py-3 flex flex-col">
                            <div className="flex justify-between items-center"><span className="text-xs font-mono text-slate-400 truncate max-w-[70%]">{generatedEntries.length > 1 ? `Markdown Source (${generatedEntries.length} words)` : "Markdown Source"}</span><div className="flex gap-3"><button onClick={()=>setShowMarkdown(!showMarkdown)} className="text-xs font-bold text-slate-300 hover:text-white flex items-center gap-1">{showMarkdown ? <EyeOff size={12}/> : <Eye size={12}/>} {showMarkdown ? 'Hide' : 'View'}</button><button onClick={copyToClipboard} className="text-xs font-bold text-slate-300 hover:text-white flex items-center gap-1"><Copy size={12}/> Copy</button></div></div>
                            {showMarkdown && (<pre className="mt-3 text-xs text-slate-400 font-mono whitespace-pre-wrap bg-black/20 p-3 rounded border border-white/10 animate-in slide-in-from-top-2">{generatedMarkdown}</pre>)}
                        </div>
                    </div>
                ) : (
                    <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50"><div className="w-20 h-20 bg-white rounded-full shadow-sm flex items-center justify-center mb-6"><BookOpen size={40} className="text-slate-300"/></div><h3 className="text-xl font-bold text-slate-700 mb-2">Ready to Explore</h3><p className="text-slate-400 max-w-xs">Enter a word in the sidebar to generate a comprehensive B2-C2 level card.</p></div>
                )}
              </div>
            </div>
          )}

          {/* PLAYGROUND TAB */}
          {mainTab === 'playground' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8 h-[calc(100vh-140px)]">
                {/* Left: Input & TTS */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 md:p-6 flex flex-col h-full">
                    <div className="flex justify-between items-center mb-3">
                        {/* 👇 修改：字号调大，与 Smart Chat 一致 */}
                        <h2 className="text-base md:text-lg font-bold text-slate-900 flex items-center gap-2"><Gamepad2 size={20} className="text-indigo-600"/> Input</h2>
                        {/* 👇 修改：字号调大 */}
                        <select value={playgroundLang} onChange={e=>setPlaygroundLang(e.target.value as Language | 'auto')} className="text-sm font-bold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-300">
                             <option value="auto">⚡ Auto</option>
                             {LANGUAGES.map(l => <option key={l.code} value={l.code}>{getFlag(l.code)} {l.label}</option>)}
                        </select>
                    </div>
                    <textarea value={playgroundInput} onChange={e=>setPlaygroundInput(e.target.value)} className="flex-1 w-full bg-slate-50 border border-slate-200 rounded-xl p-4 resize-none outline-none focus:ring-2 focus:ring-indigo-100 text-lg leading-relaxed mb-3" placeholder="Type or paste text here..." />
                    
                    {/* 👇 修改：F/M 和 播放键放在同一行 */}
                    <div className="bg-slate-50 p-2 md:p-3 rounded-xl border border-slate-100 flex items-center justify-between gap-2 overflow-x-auto">
                        <div className="flex bg-white p-1 rounded-lg border border-slate-200 shrink-0">
                            <button onClick={()=>setTtsGender('female')} className={`px-2 py-1 rounded text-xs font-bold flex items-center gap-1 transition-all ${ttsGender==='female'?'bg-rose-100 text-rose-600':'text-slate-400 hover:bg-slate-50'}`}><User size={12}/> F</button>
                            <button onClick={()=>setTtsGender('male')} className={`px-2 py-1 rounded text-xs font-bold flex items-center gap-1 transition-all ${ttsGender==='male'?'bg-blue-100 text-blue-600':'text-slate-400 hover:bg-slate-50'}`}><User size={12}/> M</button>
                            <button onClick={()=>setTtsGender('dialogue' as any)} className={`px-2 py-1 rounded text-xs font-bold flex items-center gap-1 transition-all ${ttsGender==='dialogue'?'bg-indigo-100 text-indigo-600':'text-slate-400 hover:bg-slate-50'}`}><MessageCircle size={12}/> Dia</button>
                        </div>
                        <div className="w-px h-4 bg-slate-200 shrink-0"></div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button onClick={()=>handlePlaygroundAudio('play')} disabled={isProcessingAudio || !playgroundInput} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 transition-all disabled:opacity-50 text-xs font-bold" title="Play"><Volume2 size={14}/> Play</button>
                            <button onClick={()=>handlePlaygroundAudio('download')} disabled={isProcessingAudio || !playgroundInput} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 transition-all disabled:opacity-50 text-xs font-bold" title="Download"><Download size={14}/></button>
                        </div>
                    </div>
                </div>
                
                {/* Right: AI Chat */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden h-full">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center"><h2 className="text-base md:text-lg font-bold text-slate-900 flex items-center gap-2"><MessageCircle size={20} className="text-indigo-600"/> Smart Chat</h2><div className="flex bg-white rounded-lg p-1 border border-slate-200"><button onClick={()=>setPlaygroundMode('learning')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${playgroundMode==='learning'?'bg-indigo-600 text-white':'text-slate-500 hover:bg-slate-50'}`}><Bot size={14}/> Learn</button><button onClick={()=>setPlaygroundMode('reinforce')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${playgroundMode==='reinforce'?'bg-emerald-600 text-white':'text-slate-500 hover:bg-slate-50'}`}><GraduationCap size={14}/> Test</button></div></div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/30 custom-scrollbar">
                        {playgroundChat.length === 0 && (<div className="text-center py-10 text-slate-400"><Bot size={40} className="mx-auto mb-4 opacity-50"/><p className="text-sm">Type left & chat right!</p></div>)}
                        {playgroundChat.map((m, i) => (<div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white border border-slate-100 text-slate-800 rounded-bl-none'}`}>{renderBoldText(m.text)}</div></div>))}
                        {isPlaygroundChatting && (<div className="flex justify-start"><div className="bg-white px-4 py-3 rounded-2xl rounded-bl-none border border-slate-100 shadow-sm"><Loader2 size={16} className="animate-spin text-indigo-500"/></div></div>)}
                        <div ref={playgroundEndRef} />
                    </div>
                    <div className="p-3 md:p-4 border-t border-slate-100 bg-white"><div className="flex gap-2"><input value={playgroundUserMsg} onChange={e=>setPlaygroundUserMsg(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handlePlaygroundChat()} className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 transition-all placeholder:text-slate-400 text-sm" placeholder="Chat with AI..." /><button onClick={handlePlaygroundChat} disabled={!playgroundInput && playgroundChat.length===0} className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"><Send size={18}/></button></div></div>
                </div>
            </div>
          )}
           
          {/* LIBRARY TAB */}
          {mainTab === 'library' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[calc(100vh-140px)]">
                {/* Header: Mobile Optimized */}
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50 rounded-t-2xl">
                    <div className="flex items-center gap-2">
                        <div className="bg-indigo-100 p-1.5 rounded-lg text-indigo-600"><Library size={18}/></div>
                        <div>
                            <h2 className="text-base font-bold text-slate-900 leading-tight">Collection</h2>
                            <p className="text-[10px] text-slate-500">{savedItems.filter(i=>!i.isArchived).length} active</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Import: Desktop Only */}
                        <label className="hidden md:flex cursor-pointer px-3 py-2 bg-white border border-slate-200 text-emerald-600 rounded-lg font-bold text-xs items-center gap-2 hover:bg-emerald-50 transition-all">
                            <Upload size={14}/> Import
                            <input type="file" accept=".json" onChange={handleFileSelect} className="hidden" />
                        </label>
                        
                        {/* Cluster: Desktop Text, Mobile Icon */}
                        <button onClick={handleAutoCluster} disabled={isClustering} className="p-2 md:px-3 md:py-2 bg-white border border-indigo-100 text-indigo-600 rounded-lg font-bold text-xs flex items-center gap-2 hover:bg-indigo-50 transition-all">
                            {isClustering ? <Loader2 className="animate-spin" size={14}/> : <Wand2 size={14}/>} 
                            <span className="hidden md:inline">Cluster</span>
                        </button>
                        
                        {/* AI Story: Always Visible, Right Aligned */}
                        <button onClick={()=>handleStory(savedItems.slice(0,8).map(i=>i.entry))} className="px-3 py-1.5 md:px-4 md:py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-md hover:shadow-lg transition-all">
                            <Sparkles size={14}/> <span className="md:inline">AI Story</span>
                        </button>
                    </div>
                </div>
                
                {/* Filters: Mobile Compact & Two Lines */}
                <div className="px-4 py-2 border-b border-slate-100 bg-white">
                    {/* Row 1: Selectors */}
                    <div className="flex flex-wrap gap-2 items-center mb-2">
                        <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase"><Filter size={10}/></div>
                        
                        {/* Compact Selects */}
                        <select className="text-[10px] font-bold p-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none w-[50px] md:w-auto" value={filters.lang} onChange={e=>setFilters({...filters, lang: e.target.value})}><option value="all">Lan</option>{LANGUAGES.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}</select>
                        <select className="text-[10px] font-bold p-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none w-[50px] md:w-auto" value={filters.level} onChange={e=>setFilters({...filters, level: e.target.value})}><option value="all">Lvl</option>{availableLevels.map(l=><option key={l} value={l}>{l}</option>)}</select>
                        <select className="text-[10px] font-bold p-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none w-[50px] md:w-auto" value={filters.pos} onChange={e=>setFilters({...filters, pos: e.target.value})}><option value="all">POS</option>{availablePos.map(p=><option key={p} value={p}>{p}</option>)}</select>
                        <select className="text-[10px] font-bold p-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none w-[50px] md:w-auto" value={filters.theme} onChange={e=>setFilters({...filters, theme: e.target.value})}><option value="all">Thm</option>{availableThemes.map(t=><option key={t} value={t}>{t}</option>)}</select>
                        
                        <button onClick={()=>setFilters({lang:'all', level:'all', pos:'all', theme:'all'})} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 ml-auto md:ml-0" title="Reset"><RotateCcw size={12}/></button>
                    </div>

                    {/* Row 2: Sort (Mobile) */}
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-50 md:border-0 md:pt-0">
                         <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase"><ArrowUpDown size={10}/> Sort:</div>
                         <select className="text-[10px] font-bold p-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none flex-1 md:flex-none" value={sortMode} onChange={e=>setSortMode(e.target.value as any)}><option value="recent">Recent</option><option value="review_soon">Review</option><option value="level_asc">Level</option></select>
                         <button onClick={()=>setShowArchived(!showArchived)} className={`text-[10px] font-bold px-2 py-1.5 border rounded-lg transition-colors flex items-center gap-1.5 ${showArchived ? 'bg-white text-slate-500 border-slate-200' : 'bg-indigo-600 text-white border-indigo-600'}`}>{showArchived ? <Library size={10}/> : <Archive size={10}/>} {showArchived ? 'Active' : 'Archived'}</button>
                    </div>
                </div>

                {/* List: Compact Cards */}
                <div className="flex-1 overflow-y-auto p-3 md:p-5 bg-slate-50/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                        {filteredItems.length > 0 ? filteredItems.map(item => (
                                <div key={item.id} onClick={()=>{setEntry(item.entry); setGeneratedImage(null); setChatMessages([]); setMainTab('dictionary')}} className="group relative bg-white border border-slate-200 p-3 md:p-5 rounded-xl hover:shadow-lg hover:border-indigo-300 transition-all cursor-pointer">
                                    <div className="flex justify-between items-start mb-1">
                                        <h3 className="font-serif font-bold text-lg text-slate-900 group-hover:text-indigo-700 transition-colors">{item.entry.word}</h3>
                                        <span className="text-lg opacity-40">{getFlag(item.entry.lang)}</span>
                                    </div>
                                    <p className="text-xs text-slate-500 line-clamp-2 mb-3 h-8 leading-relaxed">{item.entry.meaning}</p>
                                    <div className="flex flex-wrap gap-1.5 mt-auto">
                                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-bold uppercase tracking-wide">{formatPOS(item.entry.pos)}</span>
                                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded font-bold">{item.entry.level}</span>
                                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded truncate max-w-[80px]">{item.entry.theme}</span>
                                    </div>
                                    <div className="hidden group-hover:block absolute bottom-2 right-2 flex gap-1 bg-white/90 p-1 rounded-lg shadow-sm">
                                         <button onClick={(e)=>{e.stopPropagation(); toggleArchive(item.id, item.isArchived)}} className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-full"><Archive size={14}/></button>
                                         <button onClick={(e)=>deleteItem(e, item.id)} className="p-1.5 text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-full"><Trash2 size={14}/></button>
                                    </div>
                                </div>
                        )) : (<div className="col-span-full py-20 text-center text-slate-400 text-sm">No words match filters.</div>)}
                    </div>
                </div>
            </div>
          )}

          {/* REVIEW TAB */}
          {mainTab === 'review' && (
             <div className="max-w-4xl mx-auto h-full flex flex-col justify-center pb-10 min-w-0">
                <div className="h-14 bg-white rounded-t-3xl border-b border-slate-100 flex items-center justify-between px-6 shrink-0 shadow-sm mb-4">
                    <div className="flex items-center gap-2"><span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">{reviewQueue.length > 0 ? `Queue: ${reviewQueue.length}` : 'Queue Empty'}</span></div>
                    <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-400">Filter:</span><select className="text-xs font-bold bg-transparent outline-none text-slate-600 border-b border-slate-300 pb-0.5 cursor-pointer" value={reviewFilterLang} onChange={(e) => setReviewFilterLang(e.target.value as any)}><option value="all">All</option>{LANGUAGES.map(l => <option key={l.code} value={l.code}>{getFlag(l.code)} {l.code.toUpperCase()}</option>)}</select></div>
                </div>
                {reviewQueue.length > 0 && reviewQueue[0] ? (
                    <div className="w-full md:w-[600px] mx-auto min-h-[400px] relative bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden cursor-pointer flex flex-col" onClick={() => setIsReviewFlipped(!isReviewFlipped)}>
                        <div className="h-12 bg-slate-50 border-b border-slate-100 flex items-center justify-end px-6 shrink-0"><span className="text-2xl">{getFlag(reviewQueue[0].entry.lang)}</span></div>
                        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center overflow-y-auto">
                            {!isReviewFlipped ? (
                                <div className="flex flex-col items-center animate-in fade-in w-full"><h2 className="font-serif font-bold text-slate-900 mb-8 text-center break-words leading-tight w-full px-4" style={{ fontSize: 'clamp(2rem, 8vw, 4rem)' }}>{reviewQueue[0].entry.word}</h2><div onClick={e=>e.stopPropagation()} className="p-4 bg-indigo-50 rounded-full hover:scale-110 transition-transform mb-12"><TTSButton text={reviewQueue[0].entry.word} lang={reviewQueue[0].entry.lang} size={32}/></div><p className="text-sm text-slate-400 font-medium flex items-center gap-2 animate-bounce"><RotateCcw size={14}/> Tap to reveal</p></div>
                            ) : (
                                <div className="w-full flex flex-col items-center animate-in fade-in slide-in-from-bottom-2 h-full"><h2 className="text-2xl font-bold text-slate-900 mb-2">{reviewQueue[0].entry.word}</h2><div className="w-full bg-indigo-50 p-4 rounded-xl text-indigo-900 font-medium text-lg mb-4 leading-relaxed border border-indigo-100">{reviewQueue[0].entry.meaning}</div><div className="w-full space-y-3 mb-auto text-left">{(reviewQueue[0].entry.sentences || []).slice(0,1).map((s, i) => (<div key={i} className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex justify-between items-start gap-3"><div className="flex-1"><p className="text-slate-800 font-medium text-sm mb-1">{s.target}</p><p className="text-xs text-slate-500">{s.translation}</p></div><div onClick={e=>e.stopPropagation()}><TTSButton text={s.target} lang={reviewQueue[0].entry.lang} minimal size={16}/></div></div>))}</div><div className="w-full pt-4 mt-4 border-t border-slate-100 flex justify-between text-xs text-slate-400 font-medium"><div className="flex items-center gap-1"><Calendar size={10}/> Added: {new Date(reviewQueue[0].addedAt || reviewQueue[0].created_at).toLocaleDateString()}</div><div className="flex items-center gap-1">Stage: {reviewQueue[0].stage}</div></div></div>
                            )}
                        </div>
                        {isReviewFlipped && (
                            <div className="p-4 border-t border-slate-100 bg-white grid grid-cols-3 gap-3 shrink-0">
                                {/* 🔴 修复点：这里必须是 'reset' */}
                                <button onClick={(e)=>{e.stopPropagation(); setGeneratedImage(null); handleReviewAction('reset');}} className="py-3 bg-rose-50 text-rose-600 font-bold rounded-xl hover:bg-rose-100 flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 text-xs md:text-sm">
                                    <X size={16}/> <span>Forgot</span>
                                </button>
                                
                                {/* 🔵 新增：+14 Days 按钮 */}
                                <button onClick={(e)=>{e.stopPropagation(); setGeneratedImage(null); handleReviewAction('boost');}} className="py-3 bg-blue-50 text-blue-600 font-bold rounded-xl hover:bg-blue-100 flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 text-xs md:text-sm">
                                    <Clock size={16}/> <span>+14 Days</span>
                                </button>

                                {/* 🟢 修复点：这里必须是 'remember' */}
                                <button onClick={(e)=>{e.stopPropagation(); setGeneratedImage(null); handleReviewAction('remember');}} className="py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 text-xs md:text-sm">
                                    <Check size={16}/> <span>{getNextIntervalLabel(reviewQueue[0].stage)}</span>
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-center py-20 bg-white rounded-3xl border border-slate-100 shadow-xl p-10 max-w-lg mx-auto"><div className="w-24 h-24 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner"><CheckCircle size={48}/></div><h2 className="text-3xl font-bold text-slate-900 mb-3">All Caught Up!</h2><p className="text-slate-500 mb-8 max-w-xs mx-auto leading-relaxed">{reviewFilterLang !== 'all' ? `No more ${reviewFilterLang.toUpperCase()} words to review.` : "Your Review Queue is empty."}</p><div className="flex gap-3 justify-center"><button onClick={()=>setMainTab('library')} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:scale-105 transition-transform shadow-lg">Explore Library</button><button onClick={()=>setReviewFilterLang('all')} className="px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50" title="Reset Filter"><RefreshCw size={20}/></button></div></div>
                )}
             </div>
          )}
        </main>

        {showStoryModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                    <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <h3 className="font-bold text-lg flex items-center gap-2 text-indigo-900"><Sparkles size={20} className="text-purple-500"/> AI Memory Story</h3>
                        <button onClick={()=>setShowStoryModal(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X className="text-slate-500" size={20}/></button>
                    </div>
                    <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                        {isGeneratingStory ? (<div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-4"><Loader2 className="animate-spin text-indigo-500" size={40}/><p className="font-medium">Weaving your story...</p></div>) : storyContent ? (
                            <div className="space-y-6"><div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm"><div className="flex justify-between items-center mb-4"><div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Target Language</div><TTSButton text={storyContent.target_story} lang={entry?.lang || 'en'} label="Listen to Story" size={18}/></div><div className="prose prose-lg leading-loose text-slate-800">{renderBoldText(storyContent.target_story)}</div></div><div className="bg-indigo-50/50 p-6 rounded-xl border border-indigo-100"><div className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-4">Bilingual Guide</div><div className="leading-loose text-indigo-900 text-lg">{renderBoldText(storyContent.mixed_story)}</div></div></div>
                        ) : <div className="text-center text-slate-400">Error loading story.</div>}
                    </div>
                </div>
            </div>
        )}

        {/* ✅ FIX: Enhanced Conjugation Modal */}
        {showConjugationModal && entry?.conjugations && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                    <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <div className="flex items-center gap-3">
                            <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600"><Layers size={20}/></div>
                            <div>
                                <h3 className="font-bold text-lg text-slate-900">Verb Conjugations</h3>
                                <p className="text-xs text-slate-500 font-mono">Lemma: {entry.word}</p>
                            </div>
                        </div>
                        <button onClick={()=>setShowConjugationModal(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X className="text-slate-500" size={20}/></button>
                    </div>
                    <div className="p-6 overflow-y-auto flex-1 custom-scrollbar bg-slate-50/50">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {entry.conjugations.map((c, i) => (
                                <div key={i} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full hover:shadow-md transition-shadow">
                                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 font-bold text-sm text-indigo-900 uppercase tracking-wide flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400"></div>
                                        {c.tense}
                                    </div>
                                    <div className="p-4 flex-1">
                                        <div className="grid grid-cols-1 gap-1.5">
                                            {c.forms.map((f, idx) => (
                                                <div key={idx} className="text-sm text-slate-700 py-1 px-2 hover:bg-slate-50 rounded transition-colors border-b border-slate-50 last:border-0 font-medium">
                                                    {f}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}
