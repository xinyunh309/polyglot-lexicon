// Wrapper: Node 26 + undici 8 的 setGlobalDispatcher 不被全局 fetch 正确使用，
// 这里直接把 globalThis.fetch 换成 undici.fetch + dispatcher。
import { ProxyAgent, fetch as ufetch } from 'undici';
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  const agent = new ProxyAgent(proxyUrl);
  globalThis.fetch = (url, opts = {}) => ufetch(url, { ...opts, dispatcher: agent });
}
await import(process.argv[2]);
