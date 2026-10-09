import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, deriveDrafts, emptySession, ingestEvents, mergeDrafts, validateSession } from '../src/drafts.ts';
import { normalizeEvent, parseTranscriptFile, upsertEvent } from '../src/input.ts';
import { initialSession } from '../src/sample.ts';
const event = (id: string, text: string, props = {}) => normalizeEvent({ id, text, source: 'meeting', isFinal: true, timestamp: '2026-10-02T09:00:00+09:00', ...props });

test('Foundation・Unix・ISO時刻を同じ発言時刻へ変換し、生の認識を保持する', () => {
  const iso = event('1', '課題は認識精度です。', { rawTranscript: 'かだいはにんしきせいどです。' });
  const unix = Date.parse(iso.timestamp) / 1000;
  assert.equal(event('1', iso.text, { timestamp: unix - 978307200 }).timestamp, iso.timestamp);
  assert.equal(event('1', iso.text, { timestamp: unix, timestampFormat: 'unix' }).timestamp, iso.timestamp);
  assert.equal(event('1', iso.text, { timestamp: unix * 1000 }).timestamp, iso.timestamp);
  assert.equal(iso.rawTranscript, 'かだいはにんしきせいどです。');
});
test('partialは表示だけ、同じidのfinalで草稿が1回だけ増える', () => {
  let s = ingestEvents(emptySession(), [event('p1', '提案はスライドを', { isFinal: false })]);
  assert.equal(s.events.length, 1); assert.equal(s.slides.length, 0);
  const final = event('p1', '提案はスライドを自動で作ることです。');
  s = ingestEvents(s, [final, final]);
  assert.equal(s.events.length, 1); assert.equal(s.slides.length, 1);
  s = ingestEvents(s, [event('p1', '古い途中認識', { isFinal: false })]);
  assert.equal(s.events[0].text, final.text);
});
test('課題に「決定事項」があっても、まだ未決でも、決定に昇格しない', () => {
  assert.equal(classify('課題は、決定事項と検討中の案が混ざることです。'), 'issue');
  assert.notEqual(classify('まだ決定していません。来週検討したいです。'), 'decision');
  assert.equal(classify('提案は、金曜までに試すことです。'), 'proposal');
  assert.equal(classify('決定事項は、確定した発言から進めることです。'), 'decision');
  assert.equal(classify('決定事項はまだ決まっていません。'), 'discussion');
});
test('AI自身の発言は、会議の目的・決定の根拠に混ぜない', () => {
  const s = ingestEvents(emptySession(), [event('a1', '決定事項は公開することです。', { source: 'assistant' }), event('u1', '目的は会議後の時間を短くすることです。')]);
  assert.equal(s.events.length, 2); assert.equal(s.slides.length, 1);
  assert.deepEqual(s.slides[0].sourceIds, ['u1']);
});
test('逐次発言で草稿が増え、すべての箇条書きを実際の発言へたどれる', () => {
  let s = emptySession();
  s = ingestEvents(s, [event('1', '目的は会議を短くすることです。')]);
  s = ingestEvents(s, [event('2', '課題は発言の重複です。')]);
  s = ingestEvents(s, [event('3', '提案は草稿を画面で確認することです。')]);
  assert.equal(s.slides.length, 3);
  for (const slide of s.slides) for (const bullet of slide.bulletText.split('\n')) assert.ok(slide.sourceIds.some(id => s.events.find(e => e.id === id)!.text.includes(bullet)));
});
test('手の編集と発表者メモを守り、最新発言からの候補は残す', () => {
  let s = ingestEvents(emptySession(), [event('1', '目的は会議を短くすることです。')]);
  s.slides[0] = { ...s.slides[0], title: '手で書いたタイトル', bulletText: '手で直した箇条書き', notes: '説明用の補足', locked: { title: true, bulletText: true } };
  s = ingestEvents(s, [event('2', '目標は資料作成の時間も短くすることです。')]);
  assert.equal(s.slides[0].title, '手で書いたタイトル'); assert.equal(s.slides[0].bulletText, '手で直した箇条書き');
  assert.equal(s.slides[0].notes, '説明用の補足'); assert.ok(s.slides[0].candidate?.sourceIds.includes('2'));
  s.slides[0].locked.title = false;
  s = mergeDrafts(s); assert.notEqual(s.slides[0].title, '手で書いたタイトル'); assert.equal(s.slides[0].bulletText, '手で直した箇条書き');
});
test('finalの訂正を受け取り、違う分類に移った古い未編集草稿を残さない', () => {
  let s = ingestEvents(emptySession(), [event('1', '決定事項は採用することです。')]);
  s = ingestEvents(s, [event('1', '提案は採用を検討することです。')]);
  assert.equal(s.events.length, 1); assert.equal(s.slides.length, 1); assert.equal(s.slides[0].category, 'proposal');
});
test('削除済みの草稿は同じ入力の再送で復活しない', () => {
  let s = initialSession(); const removed = s.slides[0].id;
  s.suppressedIds.push(removed); s.slides.shift();
  s = ingestEvents(s, [s.events[0]]); assert.ok(!s.slides.some(d => d.id === removed));
});
test('更新停止中も発言を保持し、再開で反映する', () => {
  let s = emptySession(); s.autoUpdate = false;
  s = ingestEvents(s, [event('1', '課題は記録不足です。')]);
  assert.equal(s.events.length, 1); assert.equal(s.slides.length, 0);
  s = mergeDrafts({ ...s, autoUpdate: true }); assert.equal(s.slides.length, 1);
});
test('JSON復元で編集、メモ、順序、出典を保持する', () => {
  const s = initialSession(); s.slides.reverse(); s.slides[0].notes = '補足メモ'; s.slides[0].locked.title = true; s.slides[0].title = '編集済み';
  const restored = validateSession(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored.slides.map(d => d.id), s.slides.map(d => d.id));
  assert.equal(restored.slides[0].notes, '補足メモ'); assert.equal(restored.slides[0].title, '編集済み');
  assert.equal(restored.slides[0].locked.title, true); assert.deepEqual(restored.slides[0].sourceIds, s.slides[0].sourceIds);
});
test('長い発言を複数ページに分け、否定を含む末尾も失わない', () => {
  const text = '提案は、' + '条件が整うまで公開を保留し、'.repeat(35) + '公開はまだ決定していません。';
  const drafts = deriveDrafts([event('long', text)]);
  assert.ok(drafts.length > 1);
  assert.equal(drafts.map(d => d.bulletText.split('\n').join('')).join(''), text);
  assert.ok(drafts.every(d => d.bulletText.split('\n').length <= 3));
});
test('不正入力は一括で拒否し、既存の会議を変更しない', () => {
  const s = initialSession(), snapshot = JSON.stringify(s);
  assert.throws(() => ingestEvents(s, [event('new', '提案は試作です。'), { id: 'bad', text: '発言', source: 'unknown' }]));
  assert.equal(JSON.stringify(s), snapshot);
  assert.throws(() => parseTranscriptFile('{"id":"1","text":"発言"}\ninvalid', 'sample.jsonl'), /2行目/);
  const broken = structuredClone(s); broken.slides[0].sourceIds = ['missing']; assert.throws(() => validateSession(broken));
  assert.throws(() => normalizeEvent({ id: 'x', text: '内容', isFinal: 'false' }));
});
test('重複の再送・再接続では編集済みAI草稿を元の抜粋へ戻さない', () => {
  const s = initialSession(); s.slides[0].title = '整理したタイトル'; s.slides[0].generatedBy = 'ai';
  const same = { ...s.events[0], timestamp: '2026-10-02T09:01:00+09:00' };
  const next = ingestEvents(s, [same]);
  assert.equal(next, s); assert.equal(next.slides[0].title, '整理したタイトル');
});
test('未適用の更新候補をJSON復元で失わない', () => {
  let s = initialSession(); s.slides[0].title = '手で編集'; s.slides[0].locked.title = true;
  s = ingestEvents(s, [event('added', '目的は、会議中の確認も速くすることです。')]);
  const restored = validateSession(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored.slides[0].candidate, s.slides[0].candidate);
});
test('一つの発話に目的・課題・提案があればそれぞれの草稿へ分ける', () => {
  const s = ingestEvents(emptySession(), [event('multi', '目的は会議後の時間を減らすことです。課題は記録の重複です。提案は共通の草稿を使うことです。')]);
  assert.deepEqual(s.slides.map(d => d.category), ['purpose','issue','proposal']);
  assert.ok(s.slides.every(d => d.sourceIds.includes('multi')));
});
