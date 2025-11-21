import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Volume2, Copy, BookOpen, Type, RefreshCw, Hash, Globe, 
  ChevronRight, Save, Calendar, CheckCircle, Layout, Clock,
  Library, Sparkles, Filter, Archive, Check, ArrowUpDown, Loader2, X,
  Wand2, RotateCcw, Info, Lightbulb, Flame, ChevronLeft, MessageCircle,
  Upload, Merge, Smartphone, Database, Send, Menu, Eye, EyeOff, FileText,
  Zap, Image as ImageIcon, Gamepad2, Trash2, AlertTriangle, User as UserIcon,
  List, Code
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken, type User 
} from 'firebase/auth';
import { 
  getFirestore, collection, doc, setDoc, getDoc, onSnapshot, getDocs,
  query, orderBy, updateDoc, writeBatch, deleteDoc
} from 'firebase/firestore';

// 确保这一行在 LexiconApp 的开头部分
const [dbLoading, setDbLoading] = useState(true);

// --- Global Setup ---
const apiKey = "AIzaSyA3opeTV-nPpDyAiCrYttD4uPSZmKMhQ34"; 
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";
const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const IMAGEN_MODEL = "imagen-3.0-generate-001"; 

// --- Firebase Init (User Config) ---
const userFirebaseConfig = {
  apiKey: "AIzaSyAjAY1wpzBIiY3vn6WomIYdnVXPNdzdLiM",
  authDomain: "polyglot-lexicon.firebaseapp.com",
  projectId: "polyglot-lexicon",
  storageBucket: "polyglot-lexicon.firebasestorage.app",
  messagingSenderId: "993089680528",
  appId: "1:993089680528:web:8780f94a9ecb7d11e21415"
};

let auth: any;
let db: any;
let isFirebaseAvailable = false;

// Helper to clean undefined fields for Firestore
const sanitizeData = (data: any): any => {
    return JSON.parse(JSON.stringify(data));
};

try {
    // Force init with user config if not already initialized
    if (!getApps().length) {
        initializeApp(userFirebaseConfig);
    }
    const app = getApp();
    // We assume if app exists in this context, it's the right one or compatible
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

const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
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
            <div className="flex flex-col gap-3">
                {lines.map((line, idx) => {
                    if (line.startsWith('Context:')) {
                        return <div key={idx} className="text-xs font-bold text-blue-600 bg-blue-50 p-2 rounded-lg border border-blue-100">{line.replace('Context:', '').trim()}</div>;
                    }
                    if (line.startsWith('Guide:')) {
                        return <div key={idx} className="text-xs text-emerald-700 bg-emerald-50 p-2 rounded-lg border border-emerald-100 flex gap-2 items-start"><Lightbulb size={14} className="mt-0.5 shrink-0"/> <span>{renderBoldText(line.replace('Guide:', '').trim())}</span></div>;
                    }
                    if (line.startsWith('AI:')) {
                         return <div key={idx} className="text-sm leading-relaxed text-slate-800 pl-1">{renderBoldText(line.replace('AI:', '').trim())}</div>;
                    }
                    return <div key={idx} className="text-sm leading-relaxed">{renderBoldText(line)}</div>;
                })}
            </div>
        );
    }

    let clean = text.replace(/#+\s/g, '').replace(/```/g, ''); 
    return renderBoldText(clean);
};

const POS_MAP: Record<string, string> = {
    'noun': '名词', 'verb': '动词', 'adjective': '形容词', 'adverb': '副词', 
    'preposition': '介词', 'conjunction': '连词', 'pronoun': '代词', 
    'phrase': '短语', 'idiom': '习语', 'expression': '表达',
    'n': '名词', 'v': '动词', 'adj': '形容词', 'adv': '副词'
};

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

const isNoun = (pos: string): boolean => formatPOS(pos) === '名词';

// --- Types ---
type Language = 'de' | 'en' | 'fr' | 'es' | 'it' | 'ja' | 'zh';

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
  idiom?: string; 
  idiomMeaning?: string; 
  sentences: {
    type?: 'Original' | 'Common' | 'Example' | 'Literary';
    target: string;
    translation: string;
  }[];
  synonyms: string[];
  antonyms: string[];
  crossRefs: { lang: string; word: string }[]; 
  source?: string;
}

interface ReviewItem {
  id: string;
  entry: VocabEntry;
  stage: number; 
  nextReviewDate: number; 
  lastReviewedDate: number;
  created_at: number; 
  isArchived: boolean; 
}

interface StoryData {
  target_story: string; 
  mixed_story: string;  
}

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  timestamp: number;
}

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
    if (audioCache.has(cacheKey)) {
      playAudio(audioCache.get(cacheKey)!);
      return;
    }

    setIsLoading(true);
    try {
      const langLabel = LANGUAGES.find(l => l.code === lang)?.label || "Target Language";
      const prompt = `Say in ${langLabel}: ${text}`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }
            }
          }),
        }
      );
      if (!response.ok) throw new Error("Gemini TTS failed");
      const data = await response.json();
      const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioData) {
        const wavUrl = pcmToWav(audioData);
        if (wavUrl) {
            audioCache.set(cacheKey, wavUrl); 
            playAudio(wavUrl);
        } else {
             throw new Error("Audio conversion failed");
        }
      } else throw new Error("No audio data");
    } catch (error) {
      console.warn("TTS Fallback:", error);
      const u = new SpeechSynthesisUtterance(text);
      const lConfig = LANGUAGES.find(la => la.code === lang);
      u.lang = lConfig?.voiceCode || 'en-US';
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find(voice => voice.lang === u.lang);
      if (v) u.voice = v;
      
      u.onstart = () => setIsPlaying(true);
      u.onend = () => { setIsPlaying(false); setIsLoading(false); };
      window.speechSynthesis.speak(u);
    }
  };

  if (minimal) {
      return (
        <button 
            onClick={(e) => { e.stopPropagation(); playGeminiTTS(); }}
            disabled={isLoading}
            className={`text-slate-400 hover:text-indigo-600 transition-colors ${isPlaying ? 'text-indigo-600 animate-pulse' : ''}`}
        >
            <Volume2 size={size} />
        </button>
      );
  }

  return (
    <button 
      onClick={(e) => { e.stopPropagation(); playGeminiTTS(); }}
      disabled={isLoading}
      className={`flex items-center gap-2 p-2 rounded-full transition-colors ${isPlaying ? 'text-indigo-600 bg-indigo-50' : isLoading ? 'text-slate-400 bg-slate-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
      title={isLoading ? "Loading AI Audio..." : "Play Audio"}
    >
      {isLoading ? <Loader2 size={size} className="animate-spin" /> : <Volume2 size={size} className={isPlaying ? "animate-pulse" : ""} />}
      {label && <span className="text-xs font-bold uppercase">{label}</span>}
    </button>
  );
};

const Tag = ({ icon: Icon, text, colorClass, onClick, title }: { icon?: any, text: string, colorClass: string, onClick?: () => void, title?: string }) => (
  <button 
    onClick={(e) => { e.stopPropagation(); onClick && onClick(); }} 
    title={title}
    className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${colorClass} mr-2 mb-1 hover:brightness-95 transition-all ${onClick ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-indigo-200' : 'cursor-default'}`}
  >
    {Icon && <Icon size={12} className="mr-1.5" />}
    {text}
  </button>
);

// --- Main Application ---

export default function LexiconAppV2() {
  const [user, setUser] = useState<User | null>(null);
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
  const [importText, setImportText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false); 
  const [isFigurativeMode, setIsFigurativeMode] = useState(false);
  const [showMarkdown, setShowMarkdown] = useState(false);
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
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
  const [isReviewFlipped, setIsReviewFlipped] = useState(false); 

  // Filters
  const [filters, setFilters] = useState({ lang: 'all', level: 'all', pos: 'all', theme: 'all' });
  const [sortMode, setSortMode] = useState<'recent' | 'review_soon' | 'level_asc'>('recent');
  const [showArchived, setShowArchived] = useState(false);
  const [generatedMarkdown, setGeneratedMarkdown] = useState('');

  // --- Auth Logic ---
  useEffect(() => {
    if (!isFirebaseAvailable) return;
    const initAuth = async () => {
        try {
            await signInAnonymously(auth);
        } catch (error) {
            console.error("Auth failed, relying on open DB rules", error);
            setUser({ uid: 'guest_user', isAnonymous: true } as User);
        }
    };
    initAuth();
    return onAuthStateChanged(auth, (u) => {
        if (u) setUser(u);
        // else initAuth() is handled by mount
    });
  }, []);
// --- Data Sync (Safe Mode) ---
  useEffect(() => {
    // 1. 安全检查：如果没有连接数据库，直接不执行，防止崩
    if (!db) return;

    // 2. 简单粗暴：不加任何过滤条件，先把所有数据抓回来再说
    // (去掉了 orderBy，防止因为缺少索引导致 App 打不开)
    const q = query(collection(db, 'vocabulary')); 
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: ReviewItem[] = [];
      
      snapshot.forEach(doc => {
          const rawData = doc.data();
          
          // 3. 数据清洗：确保关键字段存在
          // 不管库里是 created_at 还是 addedAt，都统一成 addedAt
          const realTime = rawData.addedAt || rawData.created_at || Date.now();

          const cleanItem: any = {
             id: doc.id,
             ...rawData,
             addedAt: realTime, 
             // 确保 entry 存在，防止读取 entry.word 时白屏
             entry: rawData.entry || { word: "Error Data", sentences: [] } 
          };
          
          // 补全 entry 里的数组，防止 undefined 报错
          if (!cleanItem.entry.sentences) cleanItem.entry.sentences = [];
          if (!cleanItem.entry.synonyms) cleanItem.entry.synonyms = [];
          if (!cleanItem.entry.antonyms) cleanItem.entry.antonyms = [];
          if (!cleanItem.entry.crossRefs) cleanItem.entry.crossRefs = [];

          items.push(cleanItem);
      });

      // 4. 本地排序：在电脑上排好序再显示 (最新导入的排前面)
      items.sort((a: any, b: any) => b.addedAt - a.addedAt);

      console.log(`成功加载 ${items.length} 个单词`);
      setSavedItems(items);
      setDbLoading(false);
      
    }, (err) => {
      console.error("Sync Error:", err);
      // 如果出错，不要让 App 崩溃，只停止加载动画
      setDbLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const now = Date.now();
    setReviewQueue(
        savedItems
        .filter(item => !item.isArchived && (item.nextReviewDate || 0) <= now)
        .sort((a,b) => a.nextReviewDate - b.nextReviewDate)
    );
  }, [savedItems]);

  useEffect(() => {
    if (generatedEntries.length > 0) {
      setEntry(generatedEntries[generatedIndex]);
      setChatMessages([]);
      setGeneratedImage(null); 
      setShowMarkdown(false);
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

  const copyToClipboard = () => {
      if (!generatedMarkdown) return;
      navigator.clipboard.writeText(generatedMarkdown);
  };

  const handleTagJump = (type: 'lang' | 'level' | 'pos' | 'theme', value: string) => {
    setFilters(prev => ({ ...prev, [type]: value }));
    setMainTab('library');
  };

  const toggleArchive = async (id: string, currentStatus: boolean) => {
      await updateDoc(doc(db, 'vocabulary', id), { isArchived: !currentStatus });
  };

// --- 📂 文件上传导入功能 (专业版) ---
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 再次确认
    if (!confirm(`确定要导入文件 "${file.name}" 吗？`)) return;

    setIsGenerating(true); // 显示加载圈
    
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const rawData = JSON.parse(text);
        const items = Array.isArray(rawData) ? rawData : [rawData];
        
        console.log(`开始导入 ${items.length} 条数据...`);
        
        let successCount = 0;
        const batchNow = Date.now();

        // 循环上传 (使用 Promise.all 并发太快可能会被 Firebase 限制，所以我们用 for 循环一条条稳稳地传)
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          
          // 构造标准结构
          const newDoc = {
            id: `import-${batchNow}-${i}`, // 确保ID唯一
            entry: {
              word: item.word || "Unknown",
              lang: item.lang || "fr",
              pos: item.pos || "未知",
              gender: item.gender || "",
              pronunciation: item.pronunciation || "",
              meaning: item.meaning || "",
              idiom: item.idiom || "", 
              idiomMeaning: item.idiomMeaning || "",
              morphology: item.morphology || "",
              level: item.level || "B2",
              theme: item.theme || "General",
              // 保护数组字段
              sentences: Array.isArray(item.sentences) ? item.sentences : [],
              synonyms: Array.isArray(item.synonyms) ? item.synonyms : [],
              antonyms: Array.isArray(item.antonyms) ? item.antonyms : [],
              crossRefs: Array.isArray(item.crossRefs) ? item.crossRefs : [],
              source: "Batch File Import"
            },
            stage: 0,
            addedAt: batchNow,
            lastReviewedDate: batchNow,
            nextReviewDate: batchNow,
            isArchived: false
          };

          // 写入数据库
          await setDoc(doc(db, "vocabulary", newDoc.id), newDoc);
          successCount++;
          
          // 每处理 10 条在控制台报个数，让你知道进度
          if (successCount % 10 === 0) console.log(`已导入 ${successCount}/${items.length}`);
        }

        alert(`✅ 导入成功！共处理了 ${successCount} 条单词。\n格式已自动修正。`);
        window.location.reload();

      } catch (error) {
        console.error(error);
        alert("❌ 文件解析失败！请确保你上传的是标准的 JSON 格式文件。");
      } finally {
        setIsGenerating(false);
        // 清空 input 防止重复上传同一个文件不触发 onchange
        event.target.value = ''; 
      }
    };

    reader.readAsText(file);
  };
  const deleteItem = async (e: React.MouseEvent, id: string) => {
      e.stopPropagation(); 
      if(window.confirm("Permanently delete this card?")) {
          try {
              await deleteDoc(doc(db, 'vocabulary', id));
              // Force UI update if needed, though onSnapshot should handle it
          } catch (err) {
              console.error(err);
              alert("Error deleting: " + err);
          }
      }
  };

  // --- Logic: AI ---
  const callGemini = async (prompt: string, isJson: boolean = false) => {
    try {
      if (requestCache.has(prompt)) return requestCache.get(prompt);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: isJson ? { responseMimeType: "application/json" } : undefined
          }),
        }
      );
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const data = await response.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (isJson && text) text = text.replace(/```json\n?|```/g, '').trim();
      
      if (text) requestCache.set(prompt, text); 
      return text;
    } catch (error) {
      console.error("Gemini API Error:", error);
      return null;
    }
  };

  const handleGenerate = async (overrideWord?: string) => {
    const target = overrideWord || inputWord || inputText;
    if (!target) return;
    setIsGenerating(true);
    setMainTab('dictionary');

    const langInstruction = isAutoLang 
      ? `DETECT Lang. Matches FR/DE/JA/ES/IT/EN? Use it. Else EN.` 
      : `Target: ${LANGUAGES.find(l => l.code === currentLang)?.label}.`;

    const definitionFocus = isFigurativeMode 
      ? `PRIORITY: FIGURATIVE MEANING.` 
      : `Concise Simplified Chinese definition (B2-C2).`;

    let prompt = "";
    
    const commonSchema = `
        JSON Schema:
        {
          "word": "Lemma",
          "lang": "code", 
          "pos": "POS (Chinese)",
          "gender": "m/f/n (optional)",
          "pronunciation": "...",
          "meaning": "Chinese Def",
          "idiom": "Phrase",
          "idiomMeaning": "Meaning",
          "level": "B2 (Upper case)",
          "theme": "Topic (CN)",
          "morphology": "e.g. Irregular Past Participle...",
          "sentences": [
             { "type": "Original/Common", "target": "Sentence 1", "translation": "CN Trans" },
             { "type": "Advanced/Literary", "target": "Sentence 2", "translation": "CN Trans" }
          ],
          "synonyms": ["Syn1", "Syn2"], 
          "antonyms": ["Ant1"], 
          "crossRefs": [{ "lang": "code", "word": "..." }]
        }
    `;

    if (inputMode === 'word' || overrideWord) { 
      prompt = `
        SYSTEM: Polyglot Lexicon.
        ${langInstruction}
        User: CN Native. Work: EN, DE. Goal: JP (N1), FR/ES/IT (C1).
        Generate JSON for "${target}".
        
        RULES:
        1. ${definitionFocus}
        2. "pos", "theme", "meaning": IN SIMPLIFIED CHINESE.
        3. "pronunciation": ONLY Kana for JP. NO IPA for others.
        4. "crossRefs": Equiv in [fr, de, es, it, en, ja] (exclude target).
        5. MUST PROVIDE AT LEAST 2 SENTENCES.
        6. LEVEL MUST BE UPPERCASE (e.g. B2, C1, N1).
        7. IF IRREGULAR CONJUGATION/PLURAL, FILL "morphology" field.
        
        ${commonSchema}
      `;
    } else {
      // Text Mode
      prompt = `
        Analyze text. ${langInstruction}
        Task: Extract 3-8 B2-C2 words/idioms that APPEAR in the text.
        
        STRICT CONSTRAINT: 
        1. Words must be present in text (or be the lemma). 
        2. CRITICAL: IF IT IS AN IDIOM (e.g. 'vendre la mèche'), SET "word" TO THE FULL IDIOM, not just 'vendre'.
        3. For 'Original' sentence, YOU MUST QUOTE FROM TEXT.
        4. DO NOT hallucinate words not in text.
        5. "crossRefs" MUST BE POPULATED for every word. This is mandatory.
        
        Return JSON ARRAY of objects.
        Text: "${target.substring(0, 2000)}"
        ${commonSchema}
      `;
    }

    const result = await callGemini(prompt, true);
    setIsGenerating(false);

    if (result) {
      try {
        const parsed = JSON.parse(result);
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        const validEntries = entries.map((e: any) => ({
            ...e,
            word: e.word, 
            sentences: e.sentences || [],
            synonyms: e.synonyms || [],
            antonyms: e.antonyms || [],
            crossRefs: e.crossRefs || [],
            pos: formatPOS(e.pos),
            level: e.level?.toUpperCase() || 'B2'
        }));

        setGeneratedEntries(validEntries);
        setGeneratedIndex(0);
        setEntry(validEntries[0]);
        if (validEntries[0]?.lang) setCurrentLang(validEntries[0].lang as Language);
      } catch (e) { alert("Failed to parse AI response."); }
    }
  };

  const handleSmartImport = async () => {
      if (!importText) return;
      setIsGenerating(true);
      setMainTab('dictionary');
      
      const prompt = `
        PARSE input text to JSON ARRAY for a Polyglot App.
        DETECT LANGUAGE AUTOMATICALLY.
        Target User: Chinese Native.
        
        TASK:
        1. Identify vocabulary items.
        2. GENERATE missing definitions, sentences, synonyms.
        3. GENERATE 'theme' (Topic) for each word.
        4. "level" should be estimated (B2 default).
        5. Ensure NO duplicates.
        
        JSON Schema per item:
        { "word": "...", "lang": "code", "pos": "CN", "meaning": "CN", "level": "B2", "theme": "Topic", "sentences": [{"target":"...","translation":"..."}], "synonyms": ["..."], "crossRefs": [] }
        
        Input Text:
        "${importText.substring(0, 4000)}"
      `;

      const result = await callGemini(prompt, true);
      setIsGenerating(false);

      if (result) {
          try {
              const parsed = JSON.parse(result);
              const entries = Array.isArray(parsed) ? parsed : [parsed];
              
              const existingWords = new Set(savedItems.map(i => i.entry.word.toLowerCase()));
              const uniqueEntries = entries.filter((e: any) => !existingWords.has(e.word?.toLowerCase()));
              
              const validEntries = uniqueEntries.map((e: any) => ({
                ...e,
                sentences: e.sentences || [],
                synonyms: e.synonyms || [],
                antonyms: e.antonyms || [],
                crossRefs: e.crossRefs || [],
                pos: formatPOS(e.pos),
                level: e.level?.toUpperCase() || 'B2',
                source: "Smart Import"
              }));
              
              if (validEntries.length > 0) {
                  const batch = validEntries.map((en: VocabEntry) => {
                      const newItem: ReviewItem = {
                          id: crypto.randomUUID(),
                          entry: en,
                          stage: 0,
                          nextReviewDate: Date.now(), 
                          lastReviewedDate: Date.now(),
                          created_at: Date.now(),
                          isArchived: false
                      };
                      // Use sanitizeData to avoid undefined fields
                      return setDoc(doc(db, 'vocabulary', newItem.id), sanitizeData(newItem));
                  });
                  await Promise.all(batch);
                  alert(`Smart Import: ${validEntries.length} new cards created! (${entries.length - validEntries.length} duplicates skipped)`);
                  setGeneratedEntries(validEntries);
                  setEntry(validEntries[0]);
                  setImportText('');
              } else {
                  alert("No new words found or all were duplicates.");
              }
          } catch (e) { console.error(e); alert("Smart Import Failed. Please check text format."); }
      }
  };

  const handleAutoCluster = async () => {
      setIsClustering(true);
      const currentThemes = [...new Set(savedItems.map(i => i.entry.theme))];
      
      const prompt = `
        Group these themes into 6-8 standardized CHINESE categories (e.g. 商业, 生活, 科技, 情感).
        Return JSON mapping: { "old_theme": "New Category", ... }
        Themes: ${JSON.stringify(currentThemes)}
      `;
      
      const result = await callGemini(prompt, true);
      setIsClustering(false);
      
      if (result) {
          try {
              const mapping = JSON.parse(result);
              const batch = writeBatch(db);
              savedItems.forEach(item => {
                  if (mapping[item.entry.theme] && mapping[item.entry.theme] !== item.entry.theme) {
                      const ref = doc(db, 'vocabulary', item.id);
                      batch.update(ref, { 'entry.theme': mapping[item.entry.theme] });
                  }
              });
              await batch.commit();
              alert("Themes Organized!");
          } catch (e) { console.error(e); }
      }
  };

  const handleSmartEnrich = async () => {
      if (!entry) return;
      setIsEnriching(true);
      
      const prompt = `
        ENRICH entry. Word: "${entry.word}".
        Current: ${JSON.stringify(entry)}
        TASK: Add 5 synonyms, Cross-Language (fr, de, es, it, en, ja), Ensure 2 sentences.
        Return FULL updated JSON.
      `;
      
      const result = await callGemini(prompt, true);
      setIsEnriching(false);
      
      if (result) {
          try {
              const enriched = JSON.parse(result);
              const merged: VocabEntry = {
                  ...entry,
                  ...enriched,
                  sentences: [...entry.sentences, ...(enriched.sentences || [])].slice(0, 3), 
                  crossRefs: enriched.crossRefs || entry.crossRefs,
                  pos: formatPOS(enriched.pos || entry.pos),
                  level: enriched.level?.toUpperCase() || entry.level
              };
              
              setEntry(merged);
              const newGen = [...generatedEntries];
              newGen[generatedIndex] = merged;
              setGeneratedEntries(newGen);
              
              if (isCurrentSaved) {
                  await updateDoc(doc(db, 'vocabulary', isCurrentSaved.id), { entry: sanitizeData(merged) });
                  alert("Enriched & Updated!");
              }
          } catch(e) { alert("Enrich failed"); }
      }
  };

  const handleSmartSave = async () => {
    if (!entry) return;
    
    // Req: Idiom Priority on Save
    const wordToSave = (entry.idiom && entry.idiom.length > entry.word.length) ? entry.idiom : entry.word;
    
    const existingItem = savedItems.find(i => i.entry.word.toLowerCase() === wordToSave.toLowerCase());
    const now = Date.now();
    let newItem: ReviewItem;

    const entryToSave = { ...entry, word: wordToSave };

    if (existingItem) {
      if (!window.confirm(`"${wordToSave}" exists! Merge?`)) return;
      
      const mergedEntry: VocabEntry = {
        ...existingItem.entry,
        sentences: [...(existingItem.entry.sentences || []), ...entry.sentences],
        synonyms: Array.from(new Set([...(existingItem.entry.synonyms || []), ...entry.synonyms])),
        antonyms: Array.from(new Set([...(existingItem.entry.antonyms || []), ...entry.antonyms])),
        meaning: entry.meaning.length > existingItem.entry.meaning.length ? entry.meaning : existingItem.entry.meaning,
        level: entry.level,
        theme: entry.theme,
        crossRefs: [...(existingItem.entry.crossRefs || []), ...entry.crossRefs],
        pos: formatPOS(entry.pos)
      };
      
      await updateDoc(doc(db, 'vocabulary', existingItem.id), { entry: sanitizeData(mergedEntry), created_at: now }); 
      alert("Merged!");
    } else {
      newItem = {
        id: crypto.randomUUID(),
        entry: entryToSave, 
        stage: 0, 
        nextReviewDate: Date.now(), 
        lastReviewedDate: Date.now(),
        created_at: now, 
        isArchived: false
      };
      try {
        await setDoc(doc(db, 'vocabulary', newItem.id), sanitizeData(newItem));
        alert(`Saved: ${wordToSave}`);
      } catch (e) { console.error("Save failed", e); alert("Save failed. Check console."); }
    }
  };

  const handleReviewAction = async (remember: boolean) => {
      const item = reviewQueue[currentReviewIndex];
      if (!item) return; 

      try {
          if (remember) {
            const nextStage = Math.min(item.stage + 1, INTERVALS.length - 1);
            await updateDoc(doc(db, 'vocabulary', item.id), {
                nextReviewDate: Date.now() + INTERVALS[nextStage] * 86400000,
                stage: nextStage,
                lastReviewedDate: Date.now()
            });
          } else {
            await updateDoc(doc(db, 'vocabulary', item.id), {
                nextReviewDate: Date.now(), 
                stage: 0
            });
          }
      } catch(e) { console.error(e); }

      setIsReviewFlipped(false);
      if (currentReviewIndex < reviewQueue.length - 1) {
          setCurrentReviewIndex(prev => prev + 1);
      } else {
          alert("Review Session Complete!");
          setMainTab('library');
          setCurrentReviewIndex(0);
      }
  };

  const handleChatSubmit = async () => {
    if (!chatInput || !entry) return;
    const userMsg: ChatMessage = { role: 'user', text: chatInput, timestamp: Date.now() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatting(true);
    if (chatInput.trim() === '/json') {
        setChatMessages(prev => [...prev, { role: 'ai', text: "JSON Data:\n" + JSON.stringify(entry, null, 2), timestamp: Date.now() }]);
        setIsChatting(false);
        return;
    }

    const prompt = `Context: Word "${entry.word}" (${entry.meaning}). User Question: "${userMsg.text}". Answer concisely in Chinese. Pure Text only (no markdown).`;
    const res = await callGemini(prompt);
    setIsChatting(false);
    if (res) setChatMessages(prev => [...prev, { role: 'ai', text: res, timestamp: Date.now() }]);
  };

  const handleStory = async (words: VocabEntry[]) => {
    setIsGeneratingStory(true);
    setShowStoryModal(true);
    const wordList = words.slice(0, 8).map(w => `${w.word} (${w.meaning})`).join(', ');
    const prompt = `Create a mnemonic story with: ${wordList}. Return JSON: { "target_story": "Story in Target Language", "mixed_story": "Story in Chinese with bold keywords" }`;
    const res = await callGemini(prompt, true);
    if (res) setStoryContent(JSON.parse(res));
    setIsGeneratingStory(false);
  };

  const handleGenerateImage = async () => {
      if (!entry) return;
      if (isGeneratingImage) return;
      setIsGeneratingImage(true);
      try {
          const prompt = `Minimalist illustration of concept '${entry.word}' (${entry.meaning}).`;
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } }) });
          if (!response.ok) throw new Error("Failed");
          const data = await response.json();
          if (data.predictions?.[0]?.bytesBase64Encoded) setGeneratedImage(`data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`);
      } catch (e) { alert("Image generation failed."); } finally { setIsGeneratingImage(false); }
  };

  // Req: Roleplay - No Translation, Target Lang Guide
  const startRoleplay = async () => {
      if (!entry) return;
      setChatInput('');
      setIsChatting(true);
      const prompt = `
        Roleplay Scenario for "${entry.word}" (Meaning: ${entry.meaning}).
        Language: ${entry.lang}.
        
        OUTPUT FORMAT:
        Context: [Target Language Context, max 1 sentence]
        AI: [Opening line in Target Language using the word]
        Guide: [Specific hint/question in ${entry.lang} to guide user]
        
        NO translations.
      `;
      const res = await callGemini(prompt);
      setIsChatting(false);
      if (res) setChatMessages(prev => [...prev, { role: 'ai', text: res, timestamp: Date.now() }]);
  };

  const getEtymology = async () => {
      if (!entry) return;
      setChatInput('');
      setIsChatting(true);
      const prompt = `Etymology of "${entry.word}". Output in Chinese. NO Pinyin. NO English translation at end.`;
      const res = await callGemini(prompt);
      setIsChatting(false);
      if (res) setChatMessages(prev => [...prev, { role: 'ai', text: res, timestamp: Date.now() }]);
  };

  // New: Export JSON
  const showEntryJson = () => {
      if (!entry) return;
      alert(JSON.stringify(entry, null, 2));
  };

  const filteredItems = useMemo(() => {
      let res = savedItems.filter(i => i.isArchived === showArchived);
      if (filters.lang !== 'all') res = res.filter(i => i.entry.lang === filters.lang);
      if (filters.level !== 'all') res = res.filter(i => i.entry.level === filters.level);
      if (filters.pos !== 'all') res = res.filter(i => i.entry.pos === filters.pos);
      if (filters.theme !== 'all') res = res.filter(i => i.entry.theme === filters.theme);

      res.sort((a, b) => {
          if (sortMode === 'recent') return b.created_at - a.created_at; 
          if (sortMode === 'review_soon') return a.nextReviewDate - b.nextReviewDate;
          if (sortMode === 'level_asc') return a.entry.level.localeCompare(b.entry.level);
          return 0;
      });
      return res;
  }, [savedItems, filters, sortMode, showArchived]);

  const availableLevels = useMemo(() => [...new Set(savedItems.map(i=>i.entry.level))].sort(), [savedItems]);
  const availablePos = useMemo(() => [...new Set(savedItems.map(i=>i.entry.pos))].sort(), [savedItems]);
  const availableThemes = useMemo(() => [...new Set(savedItems.map(i=>i.entry.theme))].sort(), [savedItems]);
  const isCurrentSaved = useMemo(() => savedItems.find(i => i.entry.word === entry?.word), [savedItems, entry]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-20 md:pb-0 safe-p-b">
      <div className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-50 flex justify-around py-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] pb-safe">
        {['dictionary', 'library', 'review'].map(tab => (
            <button key={tab} onClick={() => setMainTab(tab as any)} className={`flex flex-col items-center gap-1 ${mainTab === tab ? 'text-indigo-600' : 'text-slate-400'}`}>
                {tab==='dictionary'?<BookOpen size={20}/>:tab==='library'?<Library size={20}/>:<RefreshCw size={20}/>}
                <span className="text-[10px] font-bold uppercase">{tab}</span>
            </button>
        ))}
      </div>

      <div className="max-w-7xl mx-auto p-4 md:p-8 min-h-[100dvh] flex flex-col">
        <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-col items-start">
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                <div className="bg-indigo-600 text-white p-1.5 rounded-lg"><Globe size={20} /></div>
                Polyglot Lexicon 
            </h1>
            <p className="text-xs text-slate-400 font-medium mt-1 ml-10">Advanced Vocabulary Builder (B2-C2)</p>
          </div>
          <label className="ml-6 cursor-pointer flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-colors text-xs font-bold">
  <span>📂 Import JSON</span>
  <input 
    type="file" 
    accept=".json" 
    onChange={handleFileSelect} 
    className="hidden" 
  />
</label>
          <div className="flex items-center gap-3 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
              <button onClick={() => setIsAutoLang(!isAutoLang)} className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${isAutoLang ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'text-slate-400 hover:bg-slate-50'}`}>
                  {isAutoLang ? "⚡ Auto-Lang" : "Manual"}
              </button>
              {!isAutoLang && (
                  <select value={currentLang} onChange={(e) => setCurrentLang(e.target.value as Language)} className="text-xs font-bold bg-transparent outline-none text-slate-600">
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}
                  </select>
              )}
              <button onClick={showEntryJson} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Export JSON">
                 <Code size={16}/>
              </button>
              <div className="w-px h-4 bg-slate-200 mx-1"></div>
              <div className="hidden md:flex gap-1">
                {['dictionary', 'library', 'review'].map(tab => (
                <button key={tab} onClick={() => setMainTab(tab as any)} className={`px-4 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all capitalize ${mainTab === tab ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                    {tab === 'review' && reviewQueue.length > 0 && <span className="w-2 h-2 bg-rose-500 rounded-full"></span>}{tab}
                </button>
                ))}
              </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col min-w-0">
          {/* DICTIONARY TAB */}
          {mainTab === 'dictionary' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 h-full items-start">
              {/* --- LEFT: INPUT PANEL --- */}
              <div className="lg:col-span-4 space-y-4 min-w-0">
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
                    </div>
                </div>
              </div>

              {/* --- RIGHT: CARD DISPLAY --- */}
              <div className="lg:col-span-8 min-w-0">
                {entry ? (
                    <div className="bg-white rounded-2xl shadow-xl border border-indigo-50/50 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col">
                        {/* 1. Card Header */}
                        <div className="bg-slate-50/80 p-6 md:p-8 border-b border-slate-100 relative">
                             {/* Nav */}
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
                                     {/* Tags */}
                                     <div className="flex flex-wrap items-center gap-2 mb-3">
                                         <span className="text-3xl drop-shadow-sm mr-1">{FLAGS[entry.lang]}</span>
                                         <Tag text={entry.lang?.toUpperCase() || 'EN'} colorClass="bg-white border border-slate-200 text-slate-500 shadow-sm" onClick={()=>handleTagJump('lang', entry.lang)} title="Filter by Language"/>
                                         <Tag text={formatPOS(entry.pos)} colorClass="bg-white border border-slate-200 text-slate-500 shadow-sm" onClick={()=>handleTagJump('pos', entry.pos)} title="Filter by POS"/>
                                         {isNoun(entry.pos) && entry.gender && <Tag text={entry.gender} colorClass="bg-purple-50 border border-purple-100 text-purple-700"/>}
                                         <Tag text={entry.level} colorClass="bg-amber-50 border border-amber-100 text-amber-700" icon={ChevronRight} onClick={()=>handleTagJump('level', entry.level)} title="Filter by Level"/>
                                         <Tag text={entry.theme} colorClass="bg-blue-50 border border-blue-100 text-blue-700" icon={Hash} onClick={()=>handleTagJump('theme', entry.theme)} title="Filter by Theme"/>
                                     </div>
                                     
                                     {/* Title */}
                                     <div className="relative">
                                         <h2 className="font-serif font-bold text-slate-900 leading-none tracking-tight break-words hyphens-auto w-full" style={{ fontSize: 'clamp(2rem, 8vw, 4rem)' }}>
                                             {entry.word}
                                         </h2>
                                         {entry.morphology && (
                                             <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-bold uppercase rounded border border-purple-200">
                                                 <Zap size={10} className="fill-purple-500"/> {entry.morphology}
                                             </div>
                                         )}
                                     </div>

                                     <div className="flex items-center gap-4 mt-4 flex-wrap">
                                         {(entry.lang === 'en' || entry.lang === 'ja') && entry.pronunciation && (
                                            <span className="text-slate-500 font-mono text-lg tracking-wide">{entry.pronunciation}</span>
                                         )}
                                         <TTSButton text={entry.word} lang={entry.lang} size={22} />
                                         
                                         <button onClick={handleGenerateImage} disabled={isGeneratingImage} className="p-2 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors" title="Generate Visual Mnemonic">
                                            {isGeneratingImage ? <Loader2 size={18} className="animate-spin"/> : <ImageIcon size={18}/>}
                                         </button>
                                     </div>
                                 </div>
                                 <div className="flex gap-2 shrink-0 w-full md:w-auto">
                                    {isCurrentSaved && (
                                        <button onClick={handleSmartEnrich} disabled={isEnriching} className={`p-3 rounded-xl border transition-all bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100`} title="Auto-Complete Missing Data">
                                            {isEnriching ? <Loader2 className="animate-spin"/> : <Sparkles size={18}/>}
                                        </button>
                                    )}
                                    <button onClick={handleSmartSave} className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold shadow-lg shadow-indigo-200/50 transition-all transform hover:scale-105 ${isCurrentSaved ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                                        {isCurrentSaved ? <><Merge size={18}/> Update</> : <><Save size={18}/> Save</>}
                                    </button>
                                    {isCurrentSaved && (
                                        <>
                                            <button onClick={()=>toggleArchive(isCurrentSaved.id, isCurrentSaved.isArchived)} className={`p-3 rounded-xl border transition-all ${isCurrentSaved.isArchived ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-400 hover:text-slate-600 border-slate-200'}`} title={isCurrentSaved.isArchived ? "Unarchive" : "Archive"}>
                                                <Archive size={18}/>
                                            </button>
                                            <button onClick={(e)=>deleteItem(e, isCurrentSaved.id)} className="p-3 rounded-xl border border-rose-200 text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-all z-50 relative" title="Delete">
                                                <Trash2 size={18}/>
                                            </button>
                                        </>
                                    )}
                                 </div>
                             </div>
                        </div>

                        {/* 2. Card Content */}
                        <div className="p-6 md:p-10 space-y-8">
                             {generatedImage && (
                                <div className="rounded-xl overflow-hidden bg-slate-100 border border-slate-200 mb-6 animate-in fade-in zoom-in-95">
                                    <img src={generatedImage} alt="Visual Mnemonic" className="w-full h-64 object-cover"/>
                                </div>
                             )}

                             <div className="text-xl md:text-2xl text-slate-800 font-medium leading-relaxed border-l-4 border-indigo-400 pl-6 py-1 break-words">
                                {entry.meaning}
                             </div>

                             {entry.idiom && (
                                <div className="bg-amber-50/80 p-5 rounded-xl border border-amber-100/80 text-amber-900 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-2 opacity-10"><Flame size={80}/></div>
                                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600 mb-2"><Flame size={12}/> Idiomatic Usage</div>
                                    <div className="text-xl font-serif font-bold mb-1 relative z-10">{entry.idiom}</div>
                                    <div className="text-base opacity-80 relative z-10">{entry.idiomMeaning}</div>
                                </div>
                             )}

                             <div className="space-y-4">
                                {(entry.sentences || []).map((s, i) => (
                                    <div key={i} className="group p-4 rounded-xl border border-transparent hover:bg-slate-50 hover:border-slate-100 transition-all">
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="text-lg text-slate-800 leading-relaxed font-medium break-words">
                                                {s.type && <span className="text-xs font-bold text-indigo-400 uppercase mr-2 bg-indigo-50 px-1.5 py-0.5 rounded align-middle">{s.type}</span>}
                                                {s.target}
                                            </div>
                                            <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><TTSButton text={s.target} lang={entry.lang} minimal size={18}/></div>
                                        </div>
                                        <div className="text-slate-500 mt-2 pl-1">{s.translation}</div>
                                    </div>
                                ))}
                             </div>

                             <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8 border-t border-slate-100">
                                 <div className="space-y-6">
                                     <div>
                                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">Synonyms</span>
                                        <div className="flex flex-wrap gap-2">
                                            {(entry.synonyms || []).length > 0 ? entry.synonyms.map((s, i)=><span key={`syn-${i}`} onClick={()=>handleGenerate(s)} className="cursor-pointer px-2.5 py-1 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-md hover:bg-indigo-100 transition-colors">{s}</span>) : <span className="text-sm text-slate-300 italic">None</span>}
                                        </div>
                                     </div>
                                     <div>
                                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">Antonyms</span>
                                        <div className="flex flex-wrap gap-2">
                                            {(entry.antonyms || []).length > 0 ? entry.antonyms.map((s, i)=><span key={`ant-${i}`} onClick={()=>handleGenerate(s)} className="cursor-pointer px-2.5 py-1 bg-rose-50 text-rose-700 text-sm font-medium rounded-md hover:bg-rose-100 transition-colors">{s}</span>) : <span className="text-sm text-slate-300 italic">None</span>}
                                        </div>
                                     </div>
                                 </div>
                                 
                                 <div>
                                     <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-3">Cross-Language</span>
                                     <div className="flex flex-wrap gap-2">
                                         {(entry.crossRefs || []).map((ref, i) => (
                                             <div key={i} onClick={()=>handleGenerate(ref.word)} className="cursor-pointer flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-indigo-200 transition-colors group">
                                                 <span className="text-base opacity-80 group-hover:opacity-100 transition-opacity">{FLAGS[ref.lang]}</span> 
                                                 <span className="text-sm font-medium text-slate-700">{ref.word}</span>
                                             </div>
                                         ))}
                                     </div>
                                 </div>
                             </div>
                             
                             {/* Chat Section */}
                             <div className="pt-6 border-t border-slate-100">
                                <div className="bg-indigo-50/50 rounded-xl p-4 border border-indigo-100">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-2">
                                            <MessageCircle size={16} className="text-indigo-500"/>
                                            <span className="text-xs font-bold text-indigo-900 uppercase">AI Context Chat</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={getEtymology} className="text-[10px] bg-white border border-indigo-100 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-50 flex items-center gap-1"><Clock size={10}/> Etymology</button>
                                            <button onClick={startRoleplay} className="text-[10px] bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 flex items-center gap-1"><Gamepad2 size={10}/> Roleplay</button>
                                        </div>
                                    </div>
                                    <div className="space-y-3 mb-3 max-h-[200px] overflow-y-auto custom-scrollbar">
                                        {chatMessages.map((m, i) => (
                                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[90%] px-3 py-2 rounded-lg text-sm leading-relaxed ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border border-indigo-100 text-indigo-900 shadow-sm'}`}>
                                                    {/* Req 3: Render specialized chat */}
                                                    {renderChatText(m.text)}
                                                </div>
                                            </div>
                                        ))}
                                        {isChatting && <div className="flex justify-start"><div className="bg-white px-3 py-2 rounded-lg border border-indigo-100"><Loader2 size={14} className="animate-spin text-indigo-400"/></div></div>}
                                    </div>
                                    <div className="flex gap-2">
                                        <input 
                                            value={chatInput} 
                                            onChange={e=>setChatInput(e.target.value)} 
                                            onKeyDown={e=>e.key==='Enter'&&handleChatSubmit()} 
                                            className="flex-1 bg-white border border-indigo-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none placeholder:text-indigo-200" 
                                            placeholder="Ask about nuances, formality... (Try /json)" 
                                        />
                                        <button onClick={handleChatSubmit} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"><Send size={16}/></button>
                                    </div>
                                </div>
                             </div>
                        </div>

                        {/* 3. Markdown Footer */}
                        <div className="bg-slate-900 px-6 py-3 flex flex-col">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-mono text-slate-400 truncate max-w-[70%]">
                                   {generatedEntries.length > 1 ? `Markdown Source (${generatedEntries.length} words)` : "Markdown Source"}
                                </span>
                                <div className="flex gap-3">
                                    <button onClick={()=>setShowMarkdown(!showMarkdown)} className="text-xs font-bold text-slate-300 hover:text-white flex items-center gap-1">
                                        {showMarkdown ? <EyeOff size={12}/> : <Eye size={12}/>} {showMarkdown ? 'Hide' : 'View'}
                                    </button>
                                    <button onClick={copyToClipboard} className="text-xs font-bold text-slate-300 hover:text-white flex items-center gap-1"><Copy size={12}/> Copy</button>
                                </div>
                            </div>
                            {showMarkdown && (
                                <pre className="mt-3 text-xs text-slate-400 font-mono whitespace-pre-wrap bg-black/20 p-3 rounded border border-white/10 animate-in slide-in-from-top-2">
                                    {generatedMarkdown}
                                </pre>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                        <div className="w-20 h-20 bg-white rounded-full shadow-sm flex items-center justify-center mb-6">
                            <BookOpen size={40} className="text-slate-300"/>
                        </div>
                        <h3 className="text-xl font-bold text-slate-700 mb-2">Ready to Explore</h3>
                        <p className="text-slate-400 max-w-xs">Enter a word in the sidebar to generate a comprehensive B2-C2 level card.</p>
                    </div>
                )}
              </div>
            </div>
          )}
          
          {/* LIBRARY TAB */}
          {mainTab === 'library' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[calc(100vh-140px)]">
                <div className="p-5 border-b border-slate-200 flex flex-wrap gap-4 justify-between items-center bg-slate-50/50 rounded-t-2xl">
                    <div className="flex items-center gap-3">
                        <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600"><Library size={20}/></div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">Your Collection</h2>
                            <p className="text-xs text-slate-500">{savedItems.length} items • {savedItems.filter(i=>!i.isArchived).length} active</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                         <button onClick={handleAutoCluster} disabled={isClustering} className="px-3 py-2 bg-white border border-indigo-100 text-indigo-600 rounded-lg font-bold text-xs flex items-center gap-2 hover:bg-indigo-50 transition-all">
                            {isClustering ? <Loader2 className="animate-spin" size={14}/> : <Wand2 size={14}/>} Auto Cluster
                         </button>
                         <button onClick={()=>handleStory(savedItems.slice(0,8).map(i=>i.entry))} className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-bold text-xs flex items-center gap-2 shadow-md hover:shadow-lg transition-all"><Sparkles size={14}/> AI Story</button>
                    </div>
                </div>
                
                {/* Filters */}
                <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-3 items-center">
                     <div className="flex items-center gap-1 text-xs font-bold text-slate-400 uppercase mr-1"><Filter size={12}/> Filter:</div>
                     <select className="text-xs font-medium p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-300" value={filters.lang} onChange={e=>setFilters({...filters, lang: e.target.value})}><option value="all">All Languages</option>{LANGUAGES.map(l=><option key={l.code} value={l.code}>{l.flag} {l.label}</option>)}</select>
                     <select className="text-xs font-medium p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-300" value={filters.level} onChange={e=>setFilters({...filters, level: e.target.value})}><option value="all">All Levels</option>{availableLevels.map(l=><option key={l} value={l}>{l}</option>)}</select>
                     <select className="text-xs font-medium p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-300 max-w-[100px] truncate" value={filters.pos} onChange={e=>setFilters({...filters, pos: e.target.value})}><option value="all">All POS</option>{availablePos.map(p=><option key={p} value={p}>{p}</option>)}</select>
                     <select className="text-xs font-medium p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-300 max-w-[100px] truncate" value={filters.theme} onChange={e=>setFilters({...filters, theme: e.target.value})}><option value="all">All Themes</option>{availableThemes.map(t=><option key={t} value={t}>{t}</option>)}</select>
                     
                     <button onClick={()=>setFilters({lang:'all', level:'all', pos:'all', theme:'all'})} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600" title="Reset Filters"><RotateCcw size={14}/></button>

                     <div className="w-px h-6 bg-slate-200 mx-2"></div>
                     <div className="flex items-center gap-1 text-xs font-bold text-slate-400 uppercase mr-1"><ArrowUpDown size={12}/> Sort:</div>
                     <select className="text-xs font-medium p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-300" value={sortMode} onChange={e=>setSortMode(e.target.value as any)}>
                         <option value="recent">Recently Added</option>
                         <option value="review_soon">Review Priority</option>
                         <option value="level_asc">Level (A-Z)</option>
                     </select>

                     <button onClick={()=>setShowArchived(!showArchived)} className={`ml-auto text-xs font-bold px-3 py-2 border rounded-lg transition-colors flex items-center gap-2 ${showArchived ? 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50' : 'bg-indigo-600 text-white border-indigo-600'}`}>
                        {showArchived ? <Library size={12}/> : <Archive size={12}/>} {showArchived ? 'Back to Active' : 'View Archive'}
                     </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 bg-slate-50/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {filteredItems.length > 0 ? filteredItems.map(item => (
                                <div key={item.id} onClick={()=>{setEntry(item.entry); setMainTab('dictionary')}} className="group relative bg-white border border-slate-200 p-5 rounded-xl hover:shadow-lg hover:border-indigo-300 hover:-translate-y-1 transition-all cursor-pointer">
                                    <div className="absolute top-4 right-4 text-xl opacity-40 group-hover:opacity-100 group-hover:scale-110 transition-all">{FLAGS[item.entry.lang]}</div>
                                    <h3 className="font-serif font-bold text-xl text-slate-900 mb-1 group-hover:text-indigo-700 transition-colors">{item.entry.word}</h3>
                                    <p className="text-sm text-slate-500 line-clamp-2 mb-4 h-10 leading-relaxed">{item.entry.meaning}</p>
                                    <div className="flex flex-wrap gap-2 mt-auto">
                                        <span className="text-[10px] px-2 py-1 bg-slate-100 rounded-md font-medium text-slate-600 uppercase tracking-wide">{formatPOS(item.entry.pos)}</span>
                                        <span className="text-[10px] px-2 py-1 bg-amber-50 text-amber-700 rounded-md font-bold">{item.entry.level}</span>
                                        <span className="text-[10px] px-2 py-1 bg-blue-50 text-blue-600 rounded-md truncate max-w-[100px]">{item.entry.theme}</span>
                                    </div>
                                    {/* Delete Button - Z-index Fixed */}
                                    <button onClick={(e)=>deleteItem(e, item.id)} className="absolute bottom-4 right-4 p-2 z-50 text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors opacity-100">
                                        <Trash2 size={18}/>
                                    </button>
                                </div>
                        )) : (
                            <div className="col-span-full py-20 text-center text-slate-400">No words match current filters.</div>
                        )}
                    </div>
                </div>
            </div>
          )}

          {/* REVIEW TAB (Mobile Optimized) */}
          {mainTab === 'review' && (
             <div className="max-w-4xl mx-auto h-full flex flex-col justify-center pb-10 min-w-0">
                {reviewQueue.length > 0 && reviewQueue[currentReviewIndex] ? (
                    <div className="w-full md:w-[600px] mx-auto min-h-[400px] relative bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden cursor-pointer flex flex-col" onClick={() => setIsReviewFlipped(!isReviewFlipped)}>
                        {/* Status Bar */}
                        <div className="h-12 bg-slate-50 border-b border-slate-100 flex items-center justify-between px-6 shrink-0">
                            <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Card {currentReviewIndex + 1} / {reviewQueue.length}</span>
                            <span className="text-2xl">{FLAGS[reviewQueue[currentReviewIndex].entry.lang]}</span>
                        </div>

                        {/* Main Content Area */}
                        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center overflow-y-auto">
                            {!isReviewFlipped ? (
                                /* FRONT */
                                <div className="flex flex-col items-center animate-in fade-in w-full">
                                    {/* Font Size Clamp for Mobile */}
                                    <h2 className="font-serif font-bold text-slate-900 mb-8 text-center break-words leading-tight w-full px-4" style={{ fontSize: 'clamp(2rem, 8vw, 4rem)' }}>
                                        {reviewQueue[currentReviewIndex].entry.word}
                                    </h2>
                                    <div onClick={e=>e.stopPropagation()} className="p-4 bg-indigo-50 rounded-full hover:scale-110 transition-transform mb-12">
                                        <TTSButton text={reviewQueue[currentReviewIndex].entry.word} lang={reviewQueue[currentReviewIndex].entry.lang} size={32}/>
                                    </div>
                                    <p className="text-sm text-slate-400 font-medium flex items-center gap-2 animate-bounce"><RotateCcw size={14}/> Tap to reveal</p>
                                </div>
                            ) : (
                                /* BACK */
                                <div className="w-full flex flex-col items-center animate-in fade-in slide-in-from-bottom-2">
                                    <h2 className="text-2xl font-bold text-slate-900 mb-2">{reviewQueue[currentReviewIndex].entry.word}</h2>
                                    <div className="w-full bg-indigo-50 p-4 rounded-xl text-indigo-900 font-medium text-lg mb-4 leading-relaxed border border-indigo-100">
                                        {reviewQueue[currentReviewIndex].entry.meaning}
                                    </div>
                                    <div className="w-full space-y-3 mb-4 text-left">
                                        {(reviewQueue[currentReviewIndex].entry.sentences || []).slice(0,1).map((s, i) => (
                                            <div key={i} className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                                <p className="text-slate-800 font-medium text-sm mb-1">{s.target}</p>
                                                <p className="text-xs text-slate-500">{s.translation}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Action Footer (Only on Back) */}
                        {isReviewFlipped && (
                            <div className="p-4 border-t border-slate-100 bg-white grid grid-cols-2 gap-4 shrink-0">
                                <button onClick={(e)=>{e.stopPropagation(); handleReviewAction(false);}} className="py-3 bg-rose-50 text-rose-600 font-bold rounded-xl hover:bg-rose-100 flex items-center justify-center gap-2"><X size={18}/> Forgot</button>
                                <button onClick={(e)=>{e.stopPropagation(); handleReviewAction(true);}} className="py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 flex items-center justify-center gap-2"><Check size={18}/> Remember</button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-center py-20 bg-white rounded-3xl border border-slate-100 shadow-xl p-10 max-w-lg mx-auto">
                        <div className="w-24 h-24 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner"><CheckCircle size={48}/></div>
                        <h2 className="text-3xl font-bold text-slate-900 mb-3">All Caught Up!</h2>
                        <p className="text-slate-500 mb-8 max-w-xs mx-auto leading-relaxed">Your Review Queue is empty. Great job keeping up with your language goals.</p>
                        <button onClick={()=>setMainTab('library')} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:scale-105 transition-transform shadow-lg">Explore Library</button>
                    </div>
                )}
             </div>
          )}
        </main>

        {/* Modals */}
        {showStoryModal && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                    <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <h3 className="font-bold text-lg flex items-center gap-2 text-indigo-900"><Sparkles size={20} className="text-purple-500"/> AI Memory Story</h3>
                        <button onClick={()=>setShowStoryModal(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X className="text-slate-500" size={20}/></button>
                    </div>
                    <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                        {isGeneratingStory ? (
                            <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-4"><Loader2 className="animate-spin text-indigo-500" size={40}/><p className="font-medium">Weaving your story...</p></div>
                        ) : storyContent ? (
                            <div className="space-y-6">
                                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                    <div className="flex justify-between items-center mb-4">
                                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Target Language</div>
                                        {/* Req 10: Optimized Audio Button */}
                                        <TTSButton text={storyContent.target_story} lang={entry?.lang || 'en'} label="Listen to Story" size={18}/>
                                    </div>
                                    <div className="prose prose-lg leading-loose text-slate-800">{renderBoldText(storyContent.target_story)}</div>
                                </div>
                                <div className="bg-indigo-50/50 p-6 rounded-xl border border-indigo-100">
                                    <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-4">Bilingual Guide</div>
                                    <div className="leading-loose text-indigo-900 text-lg">{renderBoldText(storyContent.mixed_story)}</div>
                                </div>
                            </div>
                        ) : <div className="text-center text-slate-400">Error loading story.</div>}
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}