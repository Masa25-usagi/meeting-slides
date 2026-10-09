import { useEffect, useRef, useState } from 'react';
interface SpeechResult { isFinal: boolean; [key: number]: { transcript: string }; }
interface SpeechEvent { resultIndex: number; results: { length: number; [key: number]: SpeechResult }; }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SpeechEvent) => void) | null; onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null; onstart: (() => void) | null; start(): void; abort(): void;
}
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
export function useSpeech(onEvents: (events: unknown[]) => void, onError: (text: string) => void) {
  const Constructor = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('停止中');
  const recognition = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventsRef = useRef(onEvents); onEventsRef.current = onEvents;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const stop = () => {
    wanted.current = false; if (retry.current) clearTimeout(retry.current);
    if (recognition.current) { recognition.current.onend = null; recognition.current.abort(); }
    recognition.current = null; setListening(false); setStatus('停止中');
  };
  useEffect(() => () => { wanted.current = false; if (retry.current) clearTimeout(retry.current); recognition.current?.abort(); }, []);
  const start = () => {
    if (!Constructor) { onErrorRef.current('このブラウザは音声入力に対応していません。JSON連携または手入力を使ってください。'); return; }
    stop(); wanted.current = true; setStatus('マイクの許可を待っています');
    let emptyRetries = 0;
    const begin = () => {
      if (!wanted.current) return;
      const r = new Constructor(), run = crypto.randomUUID(); recognition.current = r;
      r.lang = 'ja-JP'; r.continuous = true; r.interimResults = true;
      r.onstart = () => { if (wanted.current) { setListening(true); setStatus('日本語の音声を認識中'); } };
      r.onresult = e => {
        if (!wanted.current || recognition.current !== r) return;
        emptyRetries = 0;
        const events = [];
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const text = e.results[i][0].transcript.trim();
          if (text) events.push({ id: `${run}-${i}`, text, source: 'microphone', speaker: 'マイク',
            isFinal: e.results[i].isFinal, timestamp: new Date().toISOString() });
        }
        if (events.length) onEventsRef.current(events);
      };
      r.onerror = e => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        const text = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'マイクの使用が許可されていません。ブラウザの許可設定を確認してください。' : e.error === 'audio-capture' ? 'マイクを取得できませんでした。Meetなどで使っている機器を確認してください。' : '音声認識サービスに接続できませんでした。JSON連携または手入力は利用できます。';
        stop(); onErrorRef.current(text);
      };
      r.onend = () => {
        if (!wanted.current || recognition.current !== r) return;
        if (++emptyRetries > 3) { stop(); onErrorRef.current('音声認識が繰り返し終了したため停止しました。必要ならもう一度開始してください。'); return; }
        retry.current = setTimeout(begin, 400);
      };
      try { r.start(); } catch { stop(); onErrorRef.current('音声認識を開始できませんでした。'); }
    };
    begin();
  };
  return { supported: !!Constructor, listening, status, start, stop };
}
