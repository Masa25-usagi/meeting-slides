import type { TranscriptEvent, Source } from './types.ts';

const sourceLabels: Record<Source, string> = {
  microphone: 'マイク', meeting: '会議音声', assistant: 'AI', manual: '入力', mobile: 'モバイル',
};
export function normalizeEvent(input: unknown): TranscriptEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('発言はJSONオブジェクトで指定してください。');
  const e = input as Record<string, unknown>;
  if (typeof e.id !== 'string' || !e.id.trim() || e.id.length > 128) throw new Error('発言に一意のid（128文字以内）が必要です。');
  const source = e.source ?? 'meeting';
  if (typeof source !== 'string' || !Object.hasOwn(sourceLabels, source)) throw new Error('sourceはmicrophone / meeting / manual / mobile / assistantのいずれかです。');
  const text = e.normalizedTranscript ?? e.text ?? e.rawTranscript;
  if (typeof text !== 'string' || !text.trim() || text.length > 10000) throw new Error('発言のtextは1〜10,000文字で指定してください。');
  const raw = e.rawTranscript ?? e.text ?? text;
  if (typeof raw !== 'string' || raw.length > 10000) throw new Error('rawTranscriptは10,000文字以内です。');
  if (e.isFinal !== undefined && typeof e.isFinal !== 'boolean') throw new Error('isFinalはtrueまたはfalseで指定してください。');
  if (e.speaker !== undefined && (typeof e.speaker !== 'string' || e.speaker.length > 80)) throw new Error('speakerは80文字以内です。');
  let stamp: Date;
  if (typeof e.timestamp === 'number' && Number.isFinite(e.timestamp)) {
    const n = e.timestamp;
    if (e.timestampFormat === 'unix-ms' || n > 1e12) stamp = new Date(n);
    else if (e.timestampFormat === 'unix' || n > 1e9) stamp = new Date(n * 1000);
    else stamp = new Date((n + 978307200) * 1000);
  } else if (e.timestamp === undefined) stamp = new Date();
  else if (typeof e.timestamp === 'string') stamp = new Date(e.timestamp);
  else throw new Error('timestampはISO 8601または秒で指定してください。');
  if (!Number.isFinite(stamp.getTime())) throw new Error('timestampを日付として読み取れません。');
  return {
    id: e.id.trim(), text: text.trim(), normalizedTranscript: text.trim(), rawTranscript: raw,
    source: source as Source, speaker: (e.speaker as string)?.trim() || sourceLabels[source as Source],
    isFinal: e.isFinal !== false, timestamp: stamp.toISOString(),
  };
}
export function upsertEvent(events: TranscriptEvent[], event: TranscriptEvent): TranscriptEvent[] {
  const i = events.findIndex(e => e.id === event.id);
  if (i < 0) return [...events, event];
  if (events[i].isFinal && !event.isFinal) return events;
  const prior = events[i];
  if (prior.text === event.text && prior.rawTranscript === event.rawTranscript && prior.normalizedTranscript === event.normalizedTranscript && prior.source === event.source && prior.speaker === event.speaker && prior.isFinal === event.isFinal) return events;
  return events.map((e, n) => n === i ? event : e);
}
export function parseTranscriptFile(text: string, fileName: string): TranscriptEvent[] {
  if (/\.json$/i.test(fileName)) {
    const data = JSON.parse(text);
    const events = Array.isArray(data) ? data : data.events ?? [data];
    if (!Array.isArray(events) || events.length > 2000) throw new Error('発言は2,000件以内です。');
    return events.map(normalizeEvent);
  }
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length > 2000) throw new Error('発言は2,000件以内です。');
  return lines.map((line, i) => {
    if (/\.jsonl$/i.test(fileName)) {
      try { return normalizeEvent(JSON.parse(line)); }
      catch (error) { throw new Error(`${i + 1}行目: ${(error as Error).message}`); }
    }
    const match = line.match(/^([^：:]{1,40})[：:]\s*(.+)$/);
    return normalizeEvent({ id: crypto.randomUUID(), text: match?.[2] ?? line, speaker: match?.[1] ?? '読み込み', source: 'manual', isFinal: true });
  });
}
