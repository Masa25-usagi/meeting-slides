export const sections = [
  ['purpose', '会議の目的'], ['issue', '現在の課題'], ['proposal', '提案'],
  ['decision', '決定事項'], ['action', '次の行動'], ['discussion', '議論のメモ'],
] as const;
export type Category = typeof sections[number][0];
export type Source = 'microphone' | 'meeting' | 'assistant' | 'manual' | 'mobile';
export type Accent = 'navy' | 'teal' | 'wine';
export interface TranscriptEvent {
  id: string; text: string; rawTranscript: string; normalizedTranscript: string;
  source: Source; speaker: string; isFinal: boolean; timestamp: string;
}
export interface GeneratedSlide {
  id: string; category: Category; label: string; title: string; bulletText: string; sourceIds: string[];
}
export interface Slide extends GeneratedSlide {
  notes: string; accent: Accent; kind: 'generated' | 'manual';
  locked: { title: boolean; bulletText: boolean };
  candidate: GeneratedSlide | null;
  generatedBy: 'extractive' | 'ai';
}
export interface Session {
  schemaVersion: 1; id: string; title: string; mode: 'sample' | 'manual' | 'live';
  events: TranscriptEvent[]; slides: Slide[]; selectedId: string | null;
  suppressedIds: string[]; autoUpdate: boolean; updatedAt: string;
}
export const colors: Record<Accent, string> = { navy: '#193C60', teal: '#2C827E', wine: '#873451' };
