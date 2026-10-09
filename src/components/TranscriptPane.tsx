import { useEffect, useRef, useState } from 'react';
import { FileUp, Info, Pause, Play } from 'lucide-react';
import type { Session, TranscriptEvent } from '../types.ts';

export function eventTime(event: TranscriptEvent, session: Session) {
  if (session.mode === 'sample' || event.id.startsWith('sample-')) {
    const seconds = Math.max(0, Math.round((Date.parse(event.timestamp) - Date.UTC(2026, 9, 2, 0, 0)) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return new Date(event.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Tokyo' });
}
export function TranscriptRow({ event, session, selected = false, onClick, compact = false }: { event: TranscriptEvent; session: Session; selected?: boolean; onClick?: () => void; compact?: boolean }) {
  const content = <><span className={`avatar ${event.speaker.includes('開発') ? 'avatar-muted' : ''}`} aria-hidden="true">{event.speaker[0]}</span><span className="event-content"><span className="event-meta"><strong>{event.speaker}</strong><time dateTime={event.timestamp}>{eventTime(event, session)}</time>{!event.isFinal && <span className="partial-label">認識中</span>}</span><span className="event-text">{event.text}</span></span></>;
  return onClick ? <button className={`transcript-row ${selected ? 'is-source' : ''} ${compact ? 'compact' : ''} ${event.isFinal ? '' : 'partial'}`} onClick={onClick} aria-label={`${event.speaker}の発言 ${eventTime(event, session)}`}>{content}</button> : <div className={`transcript-row ${compact ? 'compact' : ''}`}>{content}</div>;
}
export function TranscriptPane({ session, sourceIds, replaying, onReplay, onAdd, onImport, onSource }: {
  session: Session; sourceIds: string[]; replaying: boolean; onReplay: () => void;
  onAdd: (text: string) => void; onImport: (file: File) => void; onSource: (ids: string[]) => void;
}) {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [session.events.length]);
  const submit = () => { if (text.trim()) { onAdd(text); setText(''); } };
  return <aside className="transcript-pane" aria-label="文字起こし">
    <div className="pane-heading"><h2>文字起こし</h2><button className="button small" onClick={onReplay} disabled={session.mode !== 'sample'}>{replaying ? <Pause /> : <Play />}<span>{replaying ? '再生を停止' : 'サンプルを再生'}</span></button></div>
    <div className="input-notice"><Info /><p>{session.mode === 'sample' ? 'これは架空の会議の文字起こしです。' : '確定した発言から、草稿を更新します。'}<small>{session.mode === 'sample' ? '録音や実会議の音声は使っていません。' : '音声の認識精度は、入力元で確認してください。'}</small></p></div>
    <div className="transcript-list" ref={list}>
      {session.events.length === 0 && <p className="empty-note">最初の発言を待っています。<br />手入力や文字起こしの読み込みからも始められます。</p>}
      {session.events.map(event => <TranscriptRow key={event.id} event={event} session={session} selected={sourceIds.includes(event.id)} onClick={() => onSource([event.id])} />)}
    </div>
    <div className="composer"><label htmlFor="manual-transcript">発言を追加</label><textarea id="manual-transcript" value={text} onChange={e => setText(e.target.value)} placeholder="確定した発言を入力…" maxLength={10000} rows={2} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } }} /><button className="button primary full" onClick={submit} disabled={!text.trim()}>草稿に反映</button><button className="button plain full import-button" onClick={() => file.current?.click()}><FileUp />文字起こしを読み込む</button><input ref={file} type="file" accept=".txt,.json,.jsonl" hidden onChange={e => { const selected = e.target.files?.[0]; if (selected) onImport(selected); e.target.value = ''; }} /></div>
  </aside>;
}
