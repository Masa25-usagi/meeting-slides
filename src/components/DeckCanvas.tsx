import { useEffect, useRef, useState } from 'react';
import { FileText, Info, Plus, Sparkles } from 'lucide-react';
import { colors, type Session, type Slide } from '../types.ts';

export const bulletLines = (text: string) => text.split('\n').map(line => line.replace(/^\s*[-•・]\s*/, '').trim()).filter(Boolean);
export function SlidePreview({ slide, title, number, thumbnail = false }: { slide: Slide; title: string; number: number; thumbnail?: boolean }) {
  const holder = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.55);
  useEffect(() => {
    const observer = new ResizeObserver(entries => { setScale(entries[0].contentRect.width / 1280); });
    if (holder.current) observer.observe(holder.current);
    return () => observer.disconnect();
  }, []);
  const lines = bulletLines(slide.bulletText);
  const length = lines.reduce((n, line) => n + line.length, 0);
  const fontSize = length > 260 ? 29 : length > 150 ? 34 : 40;
  return <div ref={holder} className={`slide-frame ${thumbnail ? 'thumbnail-frame' : ''}`} style={{ aspectRatio: '16 / 9' }}>
    <div className="slide-paper" style={{ transform: `scale(${scale})`, '--slide-accent': colors[slide.accent] } as React.CSSProperties}>
      <div className="slide-stripe" />
      <div className="slide-content"><h3 style={{ fontSize: slide.title.length > 34 ? 54 : slide.title.length > 22 ? 60 : 70 }}>{slide.title || 'タイトル未入力'}</h3><ul style={{ fontSize }}>{lines.map((line, i) => <li key={i}>{line}</li>)}</ul></div>
      <div className="slide-footer"><span>{title}</span><span>{String(number).padStart(2, '0')}</span></div>
    </div>
  </div>;
}
export function DeckCanvas({ session, selected, onSelect, onAdd, onSources, onAi }: {
  session: Session; selected: Slide | undefined; onSelect: (id: string) => void; onAdd: () => void; onSources: () => void; onAi: () => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => { rail.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }, [session.selectedId]);
  return <main className="deck-pane" aria-label="スライド草稿"><div className="pane-heading"><div className="heading-with-count"><h2>スライド草稿</h2><span>{session.slides.length}枚</span></div><button className="button" onClick={onAi} disabled={!session.events.some(e => e.isFinal && e.source !== 'assistant')}><Sparkles />AIで整える</button></div>
    <div className="canvas-zone">{selected ? <SlidePreview slide={selected} title={session.title} number={session.slides.findIndex(s => s.id === selected.id) + 1} /> : <div className="empty-canvas"><FileText /><h3>話したことが、草稿になります。</h3><p>確定した発言を追加すると<br />ここに最初のスライドができます。</p></div>}</div>
    <button className="source-link" disabled={!selected?.sourceIds.length} onClick={onSources}><FileText />出典の発言を見る{selected ? `（${selected.sourceIds.length}件）` : ''}</button>
    <div className="thumbnail-rail" ref={rail} aria-label="スライド一覧">{session.slides.map((slide, i) => <button key={slide.id} className={`thumbnail ${slide.id === session.selectedId ? 'selected' : ''}`} aria-current={slide.id === session.selectedId} aria-label={`${i + 1}枚目 ${slide.label}`} onClick={() => onSelect(slide.id)}><SlidePreview slide={slide} title={session.title} number={i + 1} thumbnail /><span className="thumbnail-label"><span>{String(i + 1).padStart(2, '0')}</span><span>{slide.label}</span>{(slide.locked.title || slide.locked.bulletText) && <span className="edited-dot" aria-label="編集済み" />}</span></button>)}</div>
    <div className="deck-bottom"><span><Info />確定した発言だけを反映します</span><button className="button" onClick={onAdd}><Plus />スライドを追加</button></div>
  </main>;
}
