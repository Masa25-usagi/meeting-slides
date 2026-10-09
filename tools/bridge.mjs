#!/usr/bin/env node
import { readFile, stat, open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEvent } from '../src/input.ts';

const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('--help') || (!args.includes('--stdin') && !value('--file'))) {
  console.log('使い方: node tools/bridge.mjs --stdin\n        node tools/bridge.mjs --file <events.jsonl> --follow\n        node tools/bridge.mjs --file <events.jsonl> --replay\nWeb画面で「接続」→「連携を開始」してから実行します。--followは開始時点より後に追加された行だけを送ります。');
  process.exit(0);
}
const defaultPair = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../work/connection.json');
const pairFile = value('--pair') || defaultPair;
let pair;
try { pair = JSON.parse(await readFile(pairFile, 'utf8')); }
catch { console.error('接続情報がありません。Web画面で「連携を開始」してから実行してください。'); process.exit(1); }
if (!pair.sessionId || !pair.token) { console.error('接続先の会議が未設定です。Web画面で「連携を開始」してください。'); process.exit(1); }
const endpoint = new URL('/api/events', pair.url);
if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.protocol !== 'http:') throw new Error('接続先はこの端末のローカルサーバーに限定しています。');
let count = 0;
async function send(line) {
  if (!line.trim()) return;
  const current = JSON.parse(await readFile(pairFile, 'utf8'));
  if (current.sessionId !== pair.sessionId || current.token !== pair.token) throw new Error('接続先の会議またはサーバーが変わりました。bridgeを再起動してください。');
  const event = normalizeEvent(JSON.parse(line));
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Meeting-Token': pair.token }, body: JSON.stringify({ sessionId: pair.sessionId, event }), signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '受け口に送信できませんでした。');
  count += data.accepted;
  console.log(`反映 ${data.accepted}件 / 合計 ${count}件 / 接続中の画面 ${data.connectedBrowsers}個`);
}
try {
  if (args.includes('--stdin') || args.includes('--replay')) {
    const input = args.includes('--stdin') ? process.stdin : createReadStream(value('--file'), { encoding: 'utf8' });
    for await (const line of createInterface({ input, crlfDelay: Infinity })) await send(line);
  } else if (args.includes('--follow')) {
    const file = path.resolve(value('--file'));
    let position = (await stat(file)).size, fragment = '';
    const decoder = new TextDecoder('utf-8');
    console.log('新しい確定発言を待っています。録音・音声認識はこのbridgeでは行いません。');
    for (;;) {
      const size = (await stat(file)).size;
      if (size < position) { position = 0; fragment = ''; decoder.decode(); }
      if (size > position) {
        const fd = await open(file, 'r');
        try {
          const bytes = Buffer.alloc(Math.min(size - position, 1024 * 1024));
          const result = await fd.read(bytes, 0, bytes.length, position); position += result.bytesRead;
          fragment += decoder.decode(bytes.subarray(0, result.bytesRead), { stream: true });
          const lines = fragment.split(/\r?\n/); fragment = lines.pop() || '';
          for (const line of lines) await send(line);
          if (fragment.length > 100000) throw new Error('JSONLの1行が大きすぎます。');
        } finally { await fd.close(); }
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  } else throw new Error('--follow（追記のみ）または--replay（全件）を指定してください。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
