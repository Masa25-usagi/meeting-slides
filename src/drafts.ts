import { sections, type Category, type GeneratedSlide, type Session, type Slide, type TranscriptEvent } from './types.ts';
import { normalizeEvent, upsertEvent } from './input.ts';

export function classify(text: string): Category {
  const lead = text.trim();
  if (/^(課題|問題|懸念)/.test(lead)) return 'issue';
  if (/^(目的|目標|ゴール)/.test(lead)) return 'purpose';
  if (/^(提案|アイデア)/.test(lead)) return 'proposal';
  if (/^(次の行動|宿題|TODO|タスク)/i.test(lead)) return 'action';
  if (/^(決定事項|決定したこと|合意事項)/.test(lead)) return /まだ決|未決|決まってい|決定してい|合意してい|未確定|決定ではない|合意がない/.test(lead) ? 'discussion' : 'decision';
  if (/次の行動|宿題|担当|TODO|タスク|までに|期限|調べて|確認して|作成して|準備して/.test(text)) return 'action';
  if (/課題|問題|困って|難し|不足|遅い|懸念|低すぎ|混ざる/.test(text)) return 'issue';
  if (/目的|目指|ゴール|目標|実現したい/.test(text)) return 'purpose';
  if (/まだ決|未決|決まってい|合意してい|決定してい|検討中|かもしれ|どうでしょう|決めたい|決める必要|採用しない/.test(text)) return 'discussion';
  if (/決定しました|決定した|決めました|合意しました|合意した|採用します|採用することに|進めます|方針とします/.test(text)) return 'decision';
  if (/提案|アイデア|したい|欲しい|ほしい|どうでしょう|試して|仕組み|アプリ/.test(text)) return 'proposal';
  return 'discussion';
}
function titleFor(text: string, category: Category) {
  const first = text.split(/(?<=[。！？!?])\s*/u)[0]
    .replace(/^(目的|目標|提案|課題|問題|決定事項|次の行動|決定|結論)は[、,\s]*/, '')
    .replace(/^(目的|提案|課題|決定事項|次の行動)[：:]\s*/, '')
    .replace(/(ことです|ことにします|と考えています|と思います|です|ます)[。.]?$/, '').replace(/[。.]$/, '');
  if (first.length > 44) return sections.find(s => s[0] === category)![1];
  return first || sections.find(s => s[0] === category)![1];
}
export function deriveDrafts(events: TranscriptEvent[]): GeneratedSlide[] {
  const groups = new Map<Category, { text: string; event: TranscriptEvent }[]>();
  events.filter(e => e.isFinal && e.source !== 'assistant').forEach(e => {
    let previous = classify(e.text);
    e.text.split(/(?<=[。！？!?])\s*/u).filter(t => t.trim()).forEach(sentence => {
      let category = classify(sentence);
      if (category === 'discussion' && !/まだ決|未決|決まってい|決定してい|合意してい|検討中|かもしれ/.test(sentence)) category = previous;
      previous = category;
      groups.set(category, [...(groups.get(category) ?? []), { text: sentence, event: e }]);
    });
  });
  return sections.flatMap(([category, label]) => {
    const group = groups.get(category) ?? [];
    const items = group.flatMap(({ text: sentence, event }) => {
      const chars = [...sentence], parts: string[] = [];
      while (chars.length > 80) {
        const near = chars.slice(0, 80).join(''), comma = near.lastIndexOf('、');
        parts.push(chars.splice(0, comma > 38 ? [...near.slice(0, comma + 1)].length : 80).join(''));
      }
      if (chars.length) parts.push(chars.join(''));
      return parts.map(text => ({ text, event }));
    });
    const pages: GeneratedSlide[] = [];
    for (let offset = 0; offset < items.length; offset += 3) {
      const chunk = items.slice(offset, offset + 3);
      const page = Math.floor(offset / 3);
      const sourceIds = [...new Set(chunk.map(item => item.event.id))];
      const title = page === 0 ? titleFor(group[0].text, category) : `${label}（${page + 1}）`;
      pages.push({ id: `draft-${category}-${page}`, category, label, title,
        bulletText: chunk.map(item => item.text).join('\n'), sourceIds });
    }
    return pages;
  });
}
export function newSlide(draft: GeneratedSlide, ai = false): Slide {
  return { ...draft, notes: '', accent: 'navy', kind: 'generated',
    locked: { title: false, bulletText: false }, candidate: null, generatedBy: ai ? 'ai' : 'extractive' };
}
export function mergeDrafts(session: Session, drafts = deriveDrafts(session.events), ai = false): Session {
  const remaining = new Map(drafts.filter(d => !session.suppressedIds.includes(d.id)).map(d => [d.id, d]));
  const slides: Slide[] = [];
  for (const slide of session.slides) {
    if (slide.kind === 'manual') { slides.push(slide); continue; }
    const draft = remaining.get(slide.id);
    if (!draft) {
      if (slide.locked.title || slide.locked.bulletText || slide.notes) slides.push({ ...slide, candidate: null });
      continue;
    }
    remaining.delete(slide.id);
    const differs = (slide.locked.title && slide.title !== draft.title) || (slide.locked.bulletText && slide.bulletText !== draft.bulletText);
    slides.push({ ...slide, label: draft.label, sourceIds: draft.sourceIds,
      title: slide.locked.title ? slide.title : draft.title,
      bulletText: slide.locked.bulletText ? slide.bulletText : draft.bulletText,
      candidate: differs ? draft : null, generatedBy: ai ? 'ai' : 'extractive' });
  }
  remaining.forEach(d => slides.push(newSlide(d, ai)));
  if (slides.length > 500) throw new Error('草稿は500枚が上限です。会議をJSONで保存し、新しい会議として続きを入力してください。');
  return { ...session, slides,
    selectedId: slides.some(s => s.id === session.selectedId) ? session.selectedId : slides[0]?.id ?? null,
    updatedAt: new Date().toISOString() };
}
export function ingestEvents(session: Session, input: unknown[], mode?: Session['mode']): Session {
  const validated = input.map(normalizeEvent);
  let events = session.events;
  validated.forEach(e => { events = upsertEvent(events, e); });
  if (events.length > 2000) throw new Error('この会議の発言は2,000件が上限です。新しい会議を開始してください。');
  if (events === session.events) return mode && mode !== session.mode ? { ...session, mode } : session;
  const next = { ...session, events, mode: mode ?? session.mode, updatedAt: new Date().toISOString() };
  return next.autoUpdate ? mergeDrafts(next) : next;
}
export function emptySession(title = '企画ミーティング', mode: Session['mode'] = 'manual'): Session {
  return { schemaVersion: 1, id: crypto.randomUUID(), title, mode, events: [], slides: [], selectedId: null,
    suppressedIds: [], autoUpdate: true, updatedAt: new Date().toISOString() };
}
export function manualSlide(): Slide {
  return { ...newSlide({ id: crypto.randomUUID(), category: 'discussion', label: '手動のスライド',
    title: '新しいスライド', bulletText: '', sourceIds: [] }), kind: 'manual', locked: { title: true, bulletText: true } };
}
export function validateSession(data: unknown): Session {
  if (!data || typeof data !== 'object') throw new Error('会議データを読み取れません。');
  const s = data as Session;
  if (s.schemaVersion !== 1 || typeof s.id !== 'string' || s.id.length > 128 || typeof s.title !== 'string' || s.title.length > 100) throw new Error('この会議JSONの形式は対応していません。');
  if (!Array.isArray(s.events) || s.events.length > 2000 || !Array.isArray(s.slides) || s.slides.length > 500) throw new Error('会議JSONの件数が不正です。');
  const ids = new Set<string>();
  const events = s.events.map(normalizeEvent);
  if (new Set(events.map(e => e.id)).size !== events.length) throw new Error('発言idが重複しています。');
  const slides = s.slides.map(d => {
    if (typeof d.id !== 'string' || ids.has(d.id) || typeof d.title !== 'string' || d.title.length > 500 || typeof d.bulletText !== 'string' || d.bulletText.length > 20000 || typeof d.notes !== 'string' || d.notes.length > 20000 || !Array.isArray(d.sourceIds) || d.sourceIds.some(id => typeof id !== 'string' || !events.some(e => e.id === id)) || !['navy', 'teal', 'wine'].includes(d.accent) || !sections.some(c => c[0] === d.category)) throw new Error('スライドの形式または出典idが不正です。');
    ids.add(d.id);
    let candidate = null;
    if (d.candidate) {
      const c = d.candidate;
      if (c.id !== d.id || typeof c.title !== 'string' || c.title.length > 500 || typeof c.bulletText !== 'string' || c.bulletText.length > 20000 || !sections.some(v => v[0] === c.category) || !Array.isArray(c.sourceIds) || c.sourceIds.some(id => !events.some(e => e.id === id))) throw new Error('更新候補の形式が不正です。');
      candidate = { ...c, label: sections.find(v => v[0] === c.category)![1] };
    }
    return { ...d, label: typeof d.label === 'string' ? d.label.slice(0,100) : sections.find(v => v[0] === d.category)![1], generatedBy: d.generatedBy === 'ai' ? 'ai' as const : 'extractive' as const,
      candidate, locked: { title: !!d.locked?.title, bulletText: !!d.locked?.bulletText }, kind: d.kind === 'manual' ? 'manual' as const : 'generated' as const };
  });
  return { ...emptySession(s.title, ['sample', 'manual', 'live'].includes(s.mode) ? s.mode : 'manual'),
    id: s.id, events, slides, selectedId: slides.some(d => d.id === s.selectedId) ? s.selectedId : slides[0]?.id ?? null,
    suppressedIds: Array.isArray(s.suppressedIds) ? s.suppressedIds.filter(id => typeof id === 'string') : [],
    autoUpdate: s.autoUpdate !== false, updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : new Date().toISOString() };
}
