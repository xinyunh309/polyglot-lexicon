import { ProxyAgent, fetch as ufetch } from 'undici';
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const agent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
const f = (url, opts = {}) => ufetch(url, { ...opts, dispatcher: agent });

const API_KEY = process.env.VITE_FIREBASE_API_KEY;
const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID;
const signInRes = await f(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true })
});
const { idToken } = await signInRes.json();

function v(x){if(x==null)return null;if("nullValue" in x)return null;if("booleanValue" in x)return x.booleanValue;if("integerValue" in x)return Number(x.integerValue);if("doubleValue" in x)return x.doubleValue;if("stringValue" in x)return x.stringValue;if("timestampValue" in x)return new Date(x.timestampValue).getTime();if("arrayValue" in x)return (x.arrayValue.values||[]).map(v);if("mapValue" in x){const o={};for(const [k,val] of Object.entries(x.mapValue.fields||{}))o[k]=v(val);return o;}return null;}

const IDS = process.env.IDS.split(',');
const out = [];
for (const id of IDS) {
  const r = await f(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/vocabulary/${id}`, { headers: { Authorization: `Bearer ${idToken}` } });
  const d = await r.json();
  const e = v(d.fields.entry);
  out.push({ id, word: e.word, lang: e.lang, pos: e.pos, meaning: (e.meaning || '').replace(/[。.]$/, ''), sentences: e.sentences || [] });
}
console.log(JSON.stringify(out, null, 2));
