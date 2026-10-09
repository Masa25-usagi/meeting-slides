import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEvent, upsertEvent } from '../src/input.ts';
import { aiAvailable, generateWithCodex } from './ai.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.resolve(root, '../../work');
const port = Number(process.env.MEETING_SLIDES_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid MEETING_SLIDES_PORT');
const host = '127.0.0.1';
const token = randomBytes(24).toString('base64url');
const sessions = new Map();
const clients = new Map();
let currentSessionId = null;
const validSession = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
};
async function body(req) {
  let chunks = [], bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 512 * 1024) throw new Error('入力が大きすぎます。512KB以内で送信してください。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('JSONを読み取れません。'); }
}
async function writePairing() {
  await mkdir(work, { recursive: true, mode: 0o700 });
  await writeFile(path.join(work, 'connection.json'), JSON.stringify({ url: `http://${host}:${port}`, token, sessionId: currentSessionId }, null, 2), { mode: 0o600 });
}
let vite;
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
}
const server = http.createServer(async (req, res) => {
  // ループバックでのみ待受け。異なるWebページからの入力とDNS rebindingを受け付けない。
  const requestHost = req.headers.host;
  if (![`${host}:${port}`, `localhost:${port}`].includes(requestHost) || (req.headers.origin && !origins.has(req.headers.origin))) { json(res, 403, { error: 'この接続元は許可されていません。' }); return; }
  const url = new URL(req.url, `http://${host}:${port}`);
  try {
    if (url.pathname === '/api/status' && req.method === 'GET') {
      json(res, 200, { app: 'meeting-slides', version: '0.1.0', aiAvailable, token, sessionId: currentSessionId, bridgeUrl: `http://${host}:${port}/api/events` }); return;
    }
    if (url.pathname.startsWith('/api/') && req.method !== 'GET' && req.headers['x-meeting-token'] !== token) {
      json(res, 401, { error: '接続用トークンが必要です。接続画面で確認してください。' }); return;
    }
    if (url.pathname === '/api/session' && req.method === 'POST') {
      const data = await body(req);
      if (!validSession(data.sessionId)) throw new Error('sessionIdが不正です。');
      if (!sessions.has(data.sessionId)) {
        if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
        sessions.set(data.sessionId, []);
      }
      currentSessionId = data.sessionId;
      await writePairing(); json(res, 200, { sessionId: currentSessionId }); return;
    }
    if (url.pathname === '/api/stream' && req.method === 'GET') {
      const id = url.searchParams.get('sessionId');
      if (!validSession(id) || !sessions.has(id)) throw new Error('連携を開始してから接続してください。');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: snapshot\ndata: ${JSON.stringify(sessions.get(id))}\n\n`);
      if (!clients.has(id)) clients.set(id, new Set());
      clients.get(id).add(res);
      const timer = setInterval(() => res.write(': keepalive\n\n'), 15000);
      req.on('close', () => { clearInterval(timer); clients.get(id)?.delete(res); }); return;
    }
    if (url.pathname === '/api/events' && req.method === 'POST') {
      const data = await body(req);
      if (!validSession(data.sessionId) || !sessions.has(data.sessionId)) throw new Error('接続画面で開始したsessionIdを指定してください。');
      const input = Array.isArray(data.events) ? data.events : [data.event ?? data];
      if (!input.length || input.length > 100) throw new Error('1回で送信できる発言は1〜100件です。');
      const events = input.map(normalizeEvent);
      let records = sessions.get(data.sessionId);
      const changed = [];
      for (const event of events) { const next = upsertEvent(records, event); if (next !== records) { records = next; changed.push(event); } }
      if (records.length > 2000) throw new Error('発言は2,000件以内です。');
      sessions.set(data.sessionId, records);
      for (const client of clients.get(data.sessionId) || []) for (const event of changed) client.write(`event: transcript\ndata: ${JSON.stringify(event)}\n\n`);
      json(res, 200, { accepted: changed.length, received: events.length, total: records.length, connectedBrowsers: clients.get(data.sessionId)?.size || 0 }); return;
    }
    if (url.pathname === '/api/ai' && req.method === 'POST') {
      const data = await body(req);
      if (typeof data.title !== 'string' || data.title.length > 100 || !Array.isArray(data.events)) throw new Error('会議名と発言を指定してください。');
      const abort = new AbortController(); res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      const slides = await generateWithCodex(data.title, data.events.map(normalizeEvent), abort.signal);
      json(res, 200, { slides }); return;
    }
    if (url.pathname.startsWith('/api/')) { json(res, 404, { error: 'このAPIはありません。' }); return; }
    if (vite) { vite.middlewares(req, res, () => { res.writeHead(404); res.end(); }); return; }
    const location = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.resolve(root, 'dist', `.${location}`);
    if (!file.startsWith(path.join(root, 'dist') + path.sep)) { res.writeHead(404); res.end(); return; }
    const data = await readFile(file);
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' }); res.end(data);
  } catch (error) {
    if (!res.headersSent) json(res, 400, { error: error.message || '処理できませんでした。' });
    else res.end();
  }
});
server.listen(port, host, () => console.log(`会議スライド: http://${host}:${port}`));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `${port}番ポートが使用中です。MEETING_SLIDES_PORTで変更してください。` : error.message); process.exitCode = 1; });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  for (const list of clients.values()) for (const client of list) client.end();
  server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref();
});
