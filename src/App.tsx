import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleCheck, FileText, Plug, X } from 'lucide-react';
import { emptySession, ingestEvents, manualSlide, mergeDrafts, validateSession, deriveDrafts } from './drafts.ts';
import { parseTranscriptFile } from './input.ts';
import { initialSession, sampleEvents } from './sample.ts';
import { useSpeech } from './speech.ts';
import type { GeneratedSlide, Session, Slide } from './types.ts';
import { TranscriptPane } from './components/TranscriptPane.tsx';
import { DeckCanvas } from './components/DeckCanvas.tsx';
import { EditorPane } from './components/EditorPane.tsx';
import { AiDialog, ConnectionDialog, ExportDialog, SourcesDialog, type ConnectionStatus } from './components/Dialogs.tsx';
import { Modal } from './components/Modal.tsx';
import { exportJson } from './exports.ts';

export const storageKey = 'meeting-slides.session.v1';
function load() {
  try { const saved = localStorage.getItem(storageKey); return saved ? validateSession(JSON.parse(saved)) : initialSession(); }
  catch { return initialSession(); }
}
type Dialog = 'connection' | 'export' | 'sources' | 'ai' | 'candidate' | 'delete' | 'new' | null;
export default function App() {
  const [session, setSession] = useState<Session>(load), [dialog, setDialog] = useState<Dialog>(null);
  const [server, setServer] = useState<ConnectionStatus | null>(null), [toast, setToast] = useState('');
  const [sourceIds, setSourceIds] = useState<string[]>([]), [saved, setSaved] = useState(true);
  const [replaying, setReplaying] = useState(false), [connected, setConnected] = useState(false);
  const [lastReceived, setLastReceived] = useState<string | null>(null), [newTitle, setNewTitle] = useState('新しい会議');
  const [importPending, setImportPending] = useState<Session | null>(null);
  const sessionRef = useRef(session); sessionRef.current = session;
  const stream = useRef<EventSource | null>(null), replayTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const selected = session.slides.find(s => s.id === session.selectedId);
  const notice = useCallback((text: string) => setToast(text), []);
  const update = useCallback((transform: (s: Session) => Session) => setSession(previous => {
    try { return transform(previous); }
    catch (error) { queueMicrotask(() => notice((error as Error).message)); return previous; }
  }), [notice]);
  const ingest = useCallback((events: unknown[], mode?: Session['mode']) => update(s => ingestEvents(s, events, mode)), [update]);
  const speech = useSpeech(events => ingest(events, 'live'), notice);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(session)); setSaved(true); } catch { setSaved(false); } }, [session]);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/status', { signal: abort.signal }).then(r => r.ok ? r.json() : Promise.reject()).then(setServer).catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => () => { stream.current?.close(); if (replayTimer.current) clearInterval(replayTimer.current); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timer); }, [toast]);
  const stopReplay = () => { if (replayTimer.current) clearInterval(replayTimer.current); replayTimer.current = null; setReplaying(false); };
  const stopConnection = () => { stream.current?.close(); stream.current = null; setConnected(false); };
  const stopAll = () => { stopReplay(); stopConnection(); speech.stop(); };
  const showSources = (ids: string[]) => { setSourceIds(ids); setDialog('sources'); };
  const replay = () => {
    if (replaying) { stopReplay(); return; }
    setReplaying(true); let index = 0;
    replayTimer.current = setInterval(() => {
      if (sessionRef.current.mode !== 'sample' || index >= sampleEvents.length) { stopReplay(); return; }
      ingest([sampleEvents[index++]], 'sample');
      if (index === sampleEvents.length) { stopReplay(); notice('サンプルの5件を反映しました。録音は行っていません。'); }
    }, 850);
  };
  const editSlide = (field: 'title' | 'bulletText' | 'notes' | 'accent', value: string) => update(s => ({ ...s, updatedAt: new Date().toISOString(), slides: s.slides.map(d => d.id === s.selectedId ? { ...d, [field]: value, locked: field === 'title' || field === 'bulletText' ? { ...d.locked, [field]: true } : d.locked } as Slide : d) }));
  const unlock = (field: 'title' | 'bulletText') => update(s => mergeDrafts({ ...s, slides: s.slides.map(d => d.id === s.selectedId ? { ...d, locked: { ...d.locked, [field]: false } } : d) }));
  const addSlide = () => update(s => { if (s.slides.length >= 500) throw new Error('スライドは500枚が上限です。'); const slide = manualSlide(); return { ...s, slides: [...s.slides, slide], selectedId: slide.id, updatedAt: new Date().toISOString() }; });
  const move = (delta: number) => update(s => {
    const i = s.slides.findIndex(d => d.id === s.selectedId), slides = [...s.slides];
    if (i < 0 || i + delta < 0 || i + delta >= slides.length) return s;
    [slides[i], slides[i + delta]] = [slides[i + delta], slides[i]];
    return { ...s, slides, updatedAt: new Date().toISOString() };
  });
  const deleteSlide = () => {
    update(s => { const i = s.slides.findIndex(d => d.id === s.selectedId), slides = s.slides.filter(d => d.id !== s.selectedId);
      return { ...s, slides, selectedId: slides[Math.min(i, slides.length - 1)]?.id ?? null,
        suppressedIds: [...s.suppressedIds, s.selectedId!], updatedAt: new Date().toISOString() }; });
    setDialog(null); notice('スライドを削除しました。自動更新で同じ草稿は復活しません。');
  };
  const importFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { notice('読み込めるファイルは5MB以内です。'); return; }
    try {
      const text = await file.text();
      if (/\.json$/i.test(file.name)) {
        const data = JSON.parse(text);
        if (data.schemaVersion === 1 && Array.isArray(data.slides)) { setImportPending(validateSession(data)); return; }
      }
      const events = parseTranscriptFile(text, file.name); stopReplay();
      update(s => ingestEvents(s.mode === 'sample' ? emptySession(s.title) : s, events, 'manual'));
      notice(`${events.length}件の文字起こしを読み込みました。`);
    } catch (e) { notice((e as Error).message); }
  };
  const startConnection = async () => {
    if (!server) { notice('ローカルサーバーに接続できません。起動状態を確認してください。'); return; }
    stopReplay(); speech.stop();
    const next = sessionRef.current.mode === 'sample' ? emptySession(sessionRef.current.title, 'live') : { ...sessionRef.current, mode: 'live' as const };
    try {
      const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Meeting-Token': server.token }, body: JSON.stringify({ sessionId: next.id }) });
      if (!response.ok) throw new Error('連携を開始できませんでした。');
      stopConnection(); setSession(next); setLastReceived(null);
      const source = new EventSource(`/api/stream?sessionId=${encodeURIComponent(next.id)}`); stream.current = source;
      source.onopen = () => setConnected(true);
      source.onerror = () => { setConnected(false); };
      const receive = (events: unknown[]) => { if (stream.current !== source) return; ingest(events, 'live'); if (events.length) setLastReceived(new Date().toISOString()); };
      source.addEventListener('snapshot', e => { try { receive(JSON.parse((e as MessageEvent).data)); } catch { notice('連携データの形式を確認してください。'); } });
      source.addEventListener('transcript', e => { try { receive([JSON.parse((e as MessageEvent).data)]); } catch { notice('連携データの形式を確認してください。'); } });
    } catch (e) { notice((e as Error).message); }
  };
  const micStart = () => { stopReplay(); if (sessionRef.current.mode === 'sample') setSession(emptySession(sessionRef.current.title, 'live')); speech.start(); };
  const addEvent = (text: string) => {
    stopReplay(); const event = { id: crypto.randomUUID(), text, source: 'manual', speaker: '入力', isFinal: true, timestamp: new Date().toISOString() };
    update(s => ingestEvents(s.mode === 'sample' ? emptySession(s.title) : s, [event], connected || speech.listening ? 'live' : 'manual'));
  };
  const applyAi = (drafts: GeneratedSlide[]) => update(s => {
    const next = mergeDrafts(s, drafts, true);
    return { ...next, slides: next.slides.map(d => d.generatedBy === 'ai' ? { ...d, locked: { title: true, bulletText: true } } : d) };
  });
  const applyCandidate = () => {
    update(s => ({ ...s, updatedAt: new Date().toISOString(), slides: s.slides.map(d => d.id === s.selectedId && d.candidate ? { ...d, title: d.candidate.title, bulletText: d.candidate.bulletText, sourceIds: d.candidate.sourceIds, locked: { title: false, bulletText: false }, candidate: null } : d) }));
    setDialog(null); notice('更新候補を適用しました。この草稿は自動更新に戻ります。');
  };
  const modeLabel = session.mode === 'sample' ? '架空の会議・サンプル' : speech.listening ? 'マイク入力中' : connected ? '文字起こし連携中' : session.mode === 'live' ? '連携入力・停止中' : '入力テキストから作成';
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="/" aria-label="会議スライド"><span className="brand-mark" aria-hidden="true"><span /></span><span>会議スライド</span></a><div className="header-actions"><button className={`button ${connected || speech.listening ? 'connection-active' : ''}`} onClick={() => setDialog('connection')}><Plug />接続</button><button className="button primary" onClick={() => setDialog('export')}>取り出す<ChevronDown /></button></div></header>
    <section className="meeting-bar" aria-label="会議の設定"><div className="meeting-info"><input className="meeting-title" value={session.title} aria-label="会議名" maxLength={100} onChange={e => update(s => ({ ...s, title: e.target.value, updatedAt: new Date().toISOString() }))} /><span className="meeting-mode">{modeLabel}</span><span className={`save-status ${saved ? '' : 'save-error'}`} role="status">{saved ? <CircleCheck /> : <FileText />}{saved ? '端末内に保存' : '保存できません・JSONで取り出してください'}</span></div><label className="auto-control"><span>発言から草稿を更新</span><input type="checkbox" role="switch" checked={session.autoUpdate} onChange={e => update(s => e.target.checked ? mergeDrafts({ ...s, autoUpdate: true }) : { ...s, autoUpdate: false, updatedAt: new Date().toISOString() })} /><span className="switch-track" aria-hidden="true" /></label></section>
    <div className="workspace"><TranscriptPane session={session} sourceIds={selected?.sourceIds ?? []} replaying={replaying} onReplay={replay} onAdd={addEvent} onImport={importFile} onSource={showSources} /><DeckCanvas session={session} selected={selected} onSelect={id => update(s => ({ ...s, selectedId: id }))} onAdd={addSlide} onSources={() => showSources(selected?.sourceIds ?? [])} onAi={() => setDialog('ai')} /><EditorPane session={session} slide={selected} onEdit={editSlide} onUnlock={unlock} onCandidate={() => setDialog('candidate')} onMove={move} onDelete={() => setDialog('delete')} onSource={showSources} /></div>
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="通知を閉じる" onClick={() => setToast('')}><X /></button></div>}
    {dialog === 'sources' && <SourcesDialog session={session} ids={sourceIds} onClose={() => setDialog(null)} />}
    {dialog === 'export' && <ExportDialog session={session} onClose={() => setDialog(null)} onNotice={notice} />}
    {dialog === 'connection' && <ConnectionDialog session={session} server={server} connected={connected} lastReceived={lastReceived} onStart={startConnection} onStop={stopConnection} onClose={() => setDialog(null)} onNotice={notice} speech={speech} onMicStart={micStart} onNew={() => { setNewTitle('新しい会議'); setDialog('new'); }} />}
    {dialog === 'ai' && <AiDialog session={session} server={server} latest={() => sessionRef.current} onApply={applyAi} onClose={() => setDialog(null)} onNotice={notice} />}
    {dialog === 'candidate' && selected?.candidate && <Modal title="新しい草稿の候補" onClose={() => setDialog(null)}><p className="modal-description">今の編集を保持しています。この候補を適用するとタイトルと箇条書きが自動更新に戻ります。</p><article className="candidate-preview"><h3>{selected.candidate.title}</h3><ul>{selected.candidate.bulletText.split('\n').map((t, i) => <li key={i}>{t}</li>)}</ul><small>出典 {selected.candidate.sourceIds.length}件</small></article><div className="modal-actions"><button className="button" onClick={() => setDialog(null)}>今の編集を使う</button><button className="button primary" onClick={applyCandidate}>候補を適用</button></div></Modal>}
    {dialog === 'delete' && <Modal title="スライドを削除" onClose={() => setDialog(null)}><p>「{selected?.title}」を削除します。元の発言は残ります。</p><div className="modal-actions"><button className="button" onClick={() => setDialog(null)}>キャンセル</button><button className="button danger-primary" onClick={deleteSlide}>削除する</button></div></Modal>}
    {dialog === 'new' && <Modal title="新しい会議を始める" onClose={() => setDialog('connection')}><p className="modal-description">今の会議を残す場合は、再開用JSONを取り出せます。</p><div className="field-group"><label htmlFor="new-meeting-title">会議名</label><input id="new-meeting-title" value={newTitle} maxLength={100} onChange={e => setNewTitle(e.target.value)} /></div><div className="modal-actions"><button className="button" onClick={() => exportJson(session)}>今の会議をJSONで保存</button><button className="button primary" onClick={() => { stopAll(); setSession(emptySession(newTitle.trim() || '新しい会議')); setDialog(null); }}>新しい会議を開始</button></div></Modal>}
    {importPending && <Modal title="保存した会議を再開" onClose={() => setImportPending(null)}><p>「{importPending.title}」の{importPending.slides.length}枚と{importPending.events.length}件の発言を読み込みます。</p><div className="modal-actions"><button className="button" onClick={() => setImportPending(null)}>キャンセル</button><button className="button" onClick={() => exportJson(session)}>今の会議をJSONで保存</button><button className="button primary" onClick={() => { stopAll(); setSession(importPending); setImportPending(null); notice('保存した会議を再開しました。'); }}>この会議を再開</button></div></Modal>}
  </div>;
}
