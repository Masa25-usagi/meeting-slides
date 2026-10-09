import { useRef, useState } from 'react';
import { Check, Clipboard, Download, FileCode, FileJson, FileText, Mic, Plug, Presentation, Sparkles } from 'lucide-react';
import { Modal } from './Modal.tsx';
import { TranscriptRow } from './TranscriptPane.tsx';
import { exportHtml, exportJson, exportMarkdown, exportPowerPoint } from '../exports.ts';
import type { GeneratedSlide, Session } from '../types.ts';
export interface ConnectionStatus { token: string; aiAvailable: boolean; bridgeUrl: string; }
export function SourcesDialog({ session, ids, onClose }: { session: Session; ids: string[]; onClose: () => void }) {
  const records = ids.map(id => session.events.find(e => e.id === id)).filter(e => !!e);
  return <Modal title="出典の発言" onClose={onClose} wide><p className="modal-description">この草稿に使った発言を、全文で確認できます。</p><div className="source-records">{records.map(e => <div key={e.id} className="source-record"><TranscriptRow event={e} session={session} /><small className="source-id">発言ID: {e.id}</small>{e.rawTranscript !== e.text && <details><summary>元の文字起こし</summary><p>{e.rawTranscript}</p></details>}</div>)}</div>{!records.length && <p>手動で作成したスライドには出典発言がありません。</p>}</Modal>;
}
export function ExportDialog({ session, onClose, onNotice }: { session: Session; onClose: () => void; onNotice: (message: string) => void }) {
  const [includeSources, setIncludeSources] = useState(false), [busy, setBusy] = useState(false);
  const run = async (kind: string) => {
    setBusy(true);
    try {
      if (kind === 'pptx') await exportPowerPoint(session, includeSources);
      else if (kind === 'html') exportHtml(session, includeSources);
      else if (kind === 'md') exportMarkdown(session, includeSources);
      else exportJson(session);
      onNotice('ダウンロードを開始しました。');
    } catch { onNotice('取り出しに失敗しました。もう一度お試しください。'); }
    finally { setBusy(false); }
  };
  return <Modal title="スライドを取り出す" onClose={onClose}><p className="modal-description">{session.title} · {session.slides.length}枚<br />取り出した内容も草稿として確認してください。</p><label className="check-option"><input type="checkbox" checked={includeSources} onChange={e => setIncludeSources(e.target.checked)} />出典の発言を発表者メモに含める</label><div className="export-options"><button disabled={busy || !session.slides.length} onClick={() => run('pptx')}><Presentation /><span><strong>PowerPoint</strong><small>編集できる16:9の資料 · .pptx</small></span><Download /></button><button disabled={busy || !session.slides.length} onClick={() => run('html')}><FileCode /><span><strong>HTMLスライド</strong><small>ブラウザで発表・印刷・PDF保存</small></span><Download /></button><button disabled={busy || !session.slides.length} onClick={() => run('md')}><FileText /><span><strong>Markdown</strong><small>文章で使う · .md</small></span><Download /></button><button disabled={busy} onClick={() => run('json')}><FileJson /><span><strong>再開用JSON</strong><small>編集内容と文字起こし全文を保存</small></span><Download /></button></div>{busy && <p role="status">資料を作成しています…</p>}</Modal>;
}
export function ConnectionDialog({ session, server, connected, lastReceived, onStart, onStop, onClose, onNotice, speech, onMicStart, onNew }: {
  session: Session; server: ConnectionStatus | null; connected: boolean; lastReceived: string | null;
  onStart: () => void; onStop: () => void; onClose: () => void; onNotice: (message: string) => void; onNew: () => void;
  speech: { supported: boolean; listening: boolean; status: string; stop: () => void }; onMicStart: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ url: server?.bridgeUrl, token: server?.token, sessionId: session.id }, null, 2)); setCopied(true); }
    catch { onNotice('コピーできませんでした。接続手順のconnection.jsonを使ってください。'); }
  };
  return <Modal title="文字起こしを接続" onClose={onClose}><p className="modal-description">会議の文字起こしを受け取るか、ブラウザのマイクで試せます。</p><section className="connection-section"><h3><Plug />文字起こし連携</h3><p>会議の相棒など、認識済みの発言をローカルで受け取ります。送り手の接続設定が必要です。</p><div className="connection-state"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? '入力の受け口を接続中' : '停止中'}{lastReceived && <small>最終受信 {new Date(lastReceived).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })}</small>}</div>{session.mode === 'sample' && !connected && <p className="field-hint">開始すると、サンプルを含まない新しい会議になります。</p>}<div className="button-row"><button className="button primary" disabled={!server} onClick={connected ? onStop : onStart}>{connected ? '連携を停止' : '連携を開始'}</button>{connected && <button className="button" onClick={copy}>{copied ? <Check /> : <Clipboard />}{copied ? 'コピーしました' : '接続情報をコピー'}</button>}</div><p className="field-hint">受け口への接続と、実会議の音声認識は別に確認します。</p></section><section className="connection-section"><h3><Mic />マイクで試す</h3><p>この端末のマイクで日本語を認識します。ブラウザの認識サービスへ音声が送られる場合があります。Meet・Zoomの参加者全員の声を扱うには、文字起こし連携を使ってください。</p><p className="connection-state"><span className={`status-dot ${speech.listening ? 'online' : ''}`} />{speech.supported ? speech.status : 'このブラウザは非対応です'}</p><button className="button" disabled={!speech.supported || connected} onClick={speech.listening ? speech.stop : onMicStart}>{speech.listening ? 'マイクを停止' : 'マイク入力を開始'}</button></section><div className="connection-footer"><button className="button plain" onClick={onNew}>会議を新しくする</button><span>認識中の発言は、確定するまで草稿に入りません。</span></div></Modal>;
}
export function AiDialog({ session, server, latest, onApply, onClose, onNotice }: {
  session: Session; server: ConnectionStatus | null; latest: () => Session; onApply: (drafts: GeneratedSlide[]) => void;
  onClose: () => void; onNotice: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false), [drafts, setDrafts] = useState<GeneratedSlide[] | null>(null), [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null), inputVersion = useRef('');
  const fingerprint = (s: Session) => JSON.stringify([s.id, s.title, s.events]);
  const close = () => { controller.current?.abort(); onClose(); };
  const run = async () => {
    setBusy(true); setError(''); controller.current = new AbortController();
    const snapshot = latest(); inputVersion.current = fingerprint(snapshot);
    try {
      const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Meeting-Token': server!.token }, signal: controller.current.signal, body: JSON.stringify({ title: snapshot.title, events: snapshot.events }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AIで整理できませんでした。');
      if (fingerprint(latest()) !== inputVersion.current) throw new Error('整理中に発言が更新されました。最新の発言でもう一度実行してください。');
      setDrafts(data.slides);
    } catch (e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const apply = () => {
    if (fingerprint(latest()) !== inputVersion.current) { setError('発言が更新されています。最新の発言でもう一度実行してください。'); setDrafts(null); return; }
    onApply(drafts!); onNotice('AIの草稿を適用しました。手で編集した項目は保持しています。'); onClose();
  };
  return <Modal title="AIで草稿を整える" onClose={close} wide><p className="modal-description">確定した発言をCodexで整理します。発言はCodexのAIサービスに送られます。APIキーや製品のモデル設定は変更しません。</p><div className="ai-info"><Sparkles /><p>通常の自動更新は、発言の分類・抜粋です。<br />AIの結果はここで確認してから適用できます。適用後は編集と同じように保護し、新しい発言は候補に残します。</p></div>{!server?.aiAvailable && <p className="message-error">認証済みのCodex CLIを使える状態ではありません。抜粋の草稿・編集・取り出しはそのまま利用できます。</p>}{error && <p className="message-error" role="alert">{error}</p>}{drafts && <div className="ai-preview">{drafts.map((draft, i) => <article key={draft.id}><span>{String(i + 1).padStart(2, '0')} · {draft.label}</span><h3>{draft.title}</h3><ul>{draft.bulletText.split('\n').map((b, n) => <li key={n}>{b}</li>)}</ul><small>出典 {draft.sourceIds.length}件</small></article>)}</div>}<div className="modal-actions"><button className="button" onClick={close}>{busy ? '停止して閉じる' : '閉じる'}</button>{drafts ? <button className="button primary" onClick={apply}>この草稿を適用</button> : <button className="button primary" disabled={busy || !server?.aiAvailable} onClick={run}><Sparkles />{busy ? 'AIが整理しています…' : 'AIで整理を実行'}</button>}</div>{busy && <p className="field-hint" role="status">完了まで最大2分待ちます。閉じると停止します。</p>}</Modal>;
}
