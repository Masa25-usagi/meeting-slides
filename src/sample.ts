import { emptySession, ingestEvents } from './drafts.ts';
export const sampleEvents = [
  { id: 'sample-purpose', speaker: '企画担当', text: '目的は、会議後の資料作成を短くすることです。', second: 0 },
  { id: 'sample-issue', speaker: '開発担当', text: '課題は、決定事項と検討中の案が混ざることです。', second: 12 },
  { id: 'sample-proposal', speaker: '企画担当', text: '提案は、発言からスライド草稿を自動で作ることです。', second: 25 },
  { id: 'sample-decision', speaker: '企画担当', text: '決定事項は、最初に確定した文字起こしから試作を進めることです。', second: 38 },
  { id: 'sample-action', speaker: '開発担当', text: '次の行動は、編集と出典の確認ができる最小版を作成することです。', second: 51 },
].map(({ second, ...e }) => ({ ...e, source: 'manual', isFinal: true,
  timestamp: new Date(Date.UTC(2026, 9, 2, 0, 0, second)).toISOString() }));
export const initialSession = () => ingestEvents(emptySession('企画ミーティング', 'sample'), sampleEvents.slice(0, 3));
