import { ArrowLeft, ArrowRight, LockKeyhole, RotateCcw, Trash2 } from 'lucide-react';
import { colors, type Accent, type Session, type Slide } from '../types.ts';
import { TranscriptRow } from './TranscriptPane.tsx';
export function EditorPane({ session, slide, onEdit, onUnlock, onCandidate, onMove, onDelete, onSource }: {
  session: Session; slide: Slide | undefined; onEdit: (field: 'title' | 'bulletText' | 'notes' | 'accent', value: string) => void;
  onUnlock: (field: 'title' | 'bulletText') => void; onCandidate: () => void; onMove: (delta: number) => void; onDelete: () => void; onSource: (ids: string[]) => void;
}) {
  const index = slide ? session.slides.findIndex(s => s.id === slide.id) : -1;
  return <aside className="editor-pane" aria-label="スライドの編集"><div className="editor-title"><h2>編集</h2><p>編集した内容は自動更新で上書きしません</p></div>
    {!slide ? <p className="empty-note">スライドを選ぶと編集できます。</p> : <>
      <div className="field-group"><div className="field-label"><label htmlFor="slide-title">タイトル</label>{slide.locked.title && slide.kind === 'generated' && <button className="field-reset" onClick={() => onUnlock('title')} title="タイトルを自動更新に戻す" aria-label="タイトルを自動更新に戻す"><LockKeyhole /><RotateCcw /></button>}</div><input id="slide-title" value={slide.title} maxLength={150} onChange={e => onEdit('title', e.target.value)} /></div>
      <div className="field-group"><div className="field-label"><label htmlFor="slide-bullets">箇条書き</label>{slide.locked.bulletText && slide.kind === 'generated' && <button className="field-reset" onClick={() => onUnlock('bulletText')} title="箇条書きを自動更新に戻す" aria-label="箇条書きを自動更新に戻す"><LockKeyhole /><RotateCcw /></button>}</div><textarea id="slide-bullets" value={slide.bulletText} rows={5} maxLength={12000} onChange={e => onEdit('bulletText', e.target.value)} /><small className="field-hint">1行につき1つの箇条書き</small></div>
      {slide.candidate && <div className="candidate-notice"><p>編集を守り、新しい草稿を候補に残しました。</p><button className="button small" onClick={onCandidate}>更新候補を確認</button></div>}
      <div className="field-group"><label htmlFor="slide-notes">発表者メモ</label><textarea id="slide-notes" value={slide.notes} rows={3} maxLength={20000} placeholder="補足を入力…" onChange={e => onEdit('notes', e.target.value)} /></div>
      <div className="field-group"><span className="field-label-text">アクセント</span><div className="swatches">{Object.entries(colors).map(([key, color]) => <button key={key} className={`swatch ${slide.accent === key ? 'selected' : ''}`} style={{ background: color }} aria-label={key === 'navy' ? '紺色' : key === 'teal' ? '青緑色' : 'えんじ色'} aria-pressed={slide.accent === key} onClick={() => onEdit('accent', key as Accent)} />)}</div></div>
      <div className="editor-sources"><div className="source-heading"><h3>出典</h3><span>{slide.sourceIds.length}件の発言</span></div><p className="source-type">{slide.kind === 'manual' ? '手動で作成したスライド' : slide.generatedBy === 'ai' ? 'AIが整理した草稿。内容は出典で確認してください。' : '確定発言を分類・抜粋した草稿'}{(slide.locked.title || slide.locked.bulletText) && '（編集あり）'}</p>{slide.sourceIds.map(id => session.events.find(e => e.id === id)).filter(e => !!e).slice(0, 3).map(event => <TranscriptRow key={event.id} event={event} session={session} compact onClick={() => onSource(slide.sourceIds)} />)}{slide.sourceIds.length > 3 && <button className="source-link" onClick={() => onSource(slide.sourceIds)}>すべての出典を見る</button>}</div>
      <div className="slide-actions"><button className="icon-button" aria-label="スライドを前へ" disabled={index <= 0} onClick={() => onMove(-1)}><ArrowLeft /></button><button className="icon-button" aria-label="スライドを後ろへ" disabled={index >= session.slides.length - 1} onClick={() => onMove(1)}><ArrowRight /></button><button className="icon-button danger" aria-label="スライドを削除" onClick={onDelete}><Trash2 /></button></div>
    </>}
  </aside>;
}
