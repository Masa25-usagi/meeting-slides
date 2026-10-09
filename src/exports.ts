import { colors, type Session } from './types.ts';
import { bulletLines } from './components/DeckCanvas.tsx';
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const filename = (title: string) => (title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim() || '会議スライド').slice(0, 80);
export function download(content: Blob | string, name: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function sourceText(session: Session, ids: string[]) {
  return ids.map(id => session.events.find(e => e.id === id)).filter(e => !!e).map(e => `[${e.id}] ${e.speaker} / ${e.timestamp}\n${e.text}${e.rawTranscript !== e.text ? `\n元の認識: ${e.rawTranscript}` : ''}`).join('\n\n');
}
export function exportJson(session: Session) {
  download(JSON.stringify(session, null, 2), `${filename(session.title)}.meeting.json`, 'application/json;charset=utf-8');
}
export function exportMarkdown(session: Session, includeSources: boolean) {
  const md = `# ${session.title}\n\nスライド草稿\n\n` + session.slides.map((s, i) => `## ${i + 1}. ${s.title}\n\n${bulletLines(s.bulletText).map(t => `- ${t}`).join('\n')}\n${s.notes ? `\n発表者メモ:\n${s.notes}\n` : ''}${includeSources && s.sourceIds.length ? `\n出典の発言:\n${sourceText(session, s.sourceIds)}\n` : ''}`).join('\n---\n\n');
  download(md, `${filename(session.title)}.md`, 'text/markdown;charset=utf-8');
}
export function exportHtml(session: Session, includeSources: boolean) {
  const pages = session.slides.map((s, i) => `<section class="page" style="--accent:${colors[s.accent]}"><article class="slide"><h2>${escapeHtml(s.title)}</h2><ul>${bulletLines(s.bulletText).map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul><footer><span>${escapeHtml(session.title)}</span><span>${String(i + 1).padStart(2, '0')}</span></footer></article>${s.notes || (includeSources && s.sourceIds.length) ? `<details><summary>発表者メモ${includeSources ? '・出典' : ''}</summary><pre>${escapeHtml(s.notes)}${includeSources ? `\n\n${escapeHtml(sourceText(session, s.sourceIds))}` : ''}</pre></details>` : ''}</section>`).join('');
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(session.title)}</title><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#f4f6fa;font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;color:#182a3c}nav{display:flex;justify-content:center;gap:16px;padding:0 0 24px}button{padding:10px 20px;border:1px solid #193c60;background:white;border-radius:6px;color:#193c60;font:inherit}.page{max-width:1280px;margin:0 auto 32px}.slide{background:white;aspect-ratio:16/9;position:relative;border-top:8px solid var(--accent);padding:7% 7% 9%;container-type:inline-size}.slide h2{font-size:4.6cqw;line-height:1.35;color:var(--accent);margin:0 0 3.8%;overflow-wrap:anywhere}.slide ul{font-size:2.75cqw;line-height:1.5;padding-left:1.2em;margin:0}.slide li{margin-bottom:.55em;overflow-wrap:anywhere}footer{position:absolute;bottom:5%;left:4%;right:4%;border-top:1px solid #dfe5ec;padding-top:1.5%;font-size:1.4cqw;display:flex;justify-content:space-between;color:#62748b}details{background:white;padding:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.present .page{display:none}.present .page.active{display:block}.present details{display:none}@media print{@page{size:13.333in 7.5in;margin:0}body{padding:0;background:white}nav,details{display:none!important}.page,.present .page{display:block!important;width:13.333in;height:7.5in;max-width:none;margin:0;break-after:page}.slide{height:7.5in;box-shadow:none}}@media(max-width:600px){body{padding:12px}nav{font-size:13px;gap:8px}button{padding:8px 12px}}</style></head><body><nav><button id="toggle">発表モード</button><button id="prev">前へ</button><span id="count"></span><button id="next">次へ</button><button onclick="window.print()">印刷・PDF</button></nav>${pages}<script>(()=>{const pages=[...document.querySelectorAll('.page')];let i=0;function show(){pages.forEach((p,n)=>p.classList.toggle('active',n===i));document.getElementById('count').textContent=(i+1)+' / '+pages.length;document.getElementById('prev').disabled=i===0;document.getElementById('next').disabled=i===pages.length-1}function move(d){i=Math.max(0,Math.min(pages.length-1,i+d));show()}document.getElementById('toggle').onclick=()=>{document.body.classList.toggle('present');document.getElementById('toggle').textContent=document.body.classList.contains('present')?'一覧へ戻る':'発表モード';show()};document.getElementById('prev').onclick=()=>move(-1);document.getElementById('next').onclick=()=>move(1);document.addEventListener('keydown',e=>{if(e.key==='ArrowRight')move(1);if(e.key==='ArrowLeft')move(-1)});show()})()</script></body></html>`;
  download(html, `${filename(session.title)}.html`, 'text/html;charset=utf-8');
}
export async function exportPowerPoint(session: Session, includeSources: boolean) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.author = '会議スライド'; pptx.subject = '会議の発言から作成した草稿'; pptx.title = session.title; pptx.theme = { headFontFace: 'Hiragino Sans', bodyFontFace: 'Hiragino Sans' };
  session.slides.forEach((s, i) => {
    const slide = pptx.addSlide(); const accent = colors[s.accent].slice(1);
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: .09, fill: { color: accent }, line: { color: accent } });
    slide.addText(s.title, { x: .8, y: .8, w: 11.7, h: 1.3, fontFace: 'Hiragino Sans', lang: 'ja-JP', fontSize: 30, bold: true, color: accent, margin: 0, breakLine: false, fit: 'shrink', valign: 'middle' });
    const lines = bulletLines(s.bulletText);
    if (lines.length) slide.addText(lines.map(text => ({ text, options: { bullet: { indent: 20 }, hanging: 4, breakLine: true } })), { x: 1, y: 2.25, w: 11.2, h: 3.8, fontFace: 'Hiragino Sans', lang: 'ja-JP', fontSize: 23, color: '182A3C', margin: 0, paraSpaceAfter: 16, fit: 'shrink', valign: 'top' });
    slide.addShape(pptx.ShapeType.line, { x: .65, y: 6.72, w: 12.03, h: 0, line: { color: 'DFE5EC', width: .6 } });
    slide.addText(session.title, { x: .75, y: 6.86, w: 10.8, h: .25, fontFace: 'Hiragino Sans', lang: 'ja-JP', fontSize: 10, color: '62748B', margin: 0 });
    slide.addText(String(i + 1).padStart(2, '0'), { x: 11.9, y: 6.86, w: .6, h: .25, fontSize: 10, color: '62748B', align: 'right', margin: 0 });
    const notes = [s.notes, includeSources ? sourceText(session, s.sourceIds) : ''].filter(Boolean).join('\n\n');
    if (notes) slide.addNotes(notes);
  });
  const blob = await pptx.write({ outputType: 'blob' });
  download(blob as Blob, `${filename(session.title)}.pptx`);
}
