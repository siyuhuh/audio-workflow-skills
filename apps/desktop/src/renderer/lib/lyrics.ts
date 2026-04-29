export interface TimedWord {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
  compact?: boolean;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
  words?: TimedWord[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function tokenizeLyricText(text: string): string[] {
  return [
    ...text.matchAll(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?|[^\s]/gu
    )
  ].map((match) => match[0]);
}

function estimatedTokenWeight(token: string): number {
  if (/^[^\p{L}\p{N}]+$/u.test(token)) {
    return 0.35;
  }
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(token)) {
    return 1;
  }
  return Math.max(0.8, Math.min(3.6, token.length / 3));
}

export function shouldUseCompactWordSpacing(token: string, cueText: string): boolean {
  return (
    !/\s/.test(cueText) ||
    /^[^\p{L}\p{N}]+$/u.test(token) ||
    /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(token)
  );
}

export function withTimedWords(cue: Cue, cueKey: string): Cue {
  const words = cue.words?.length ? cue.words : inferTimedWords(cue, cueKey);
  return { ...cue, words };
}

export function inferTimedWords(cue: Cue, cueKey: string): TimedWord[] {
  const tokens = tokenizeLyricText(cue.text);
  const lyricTokens = tokens.length > 0 ? tokens : [cue.text.trim()].filter(Boolean);
  if (lyricTokens.length === 0) {
    return [];
  }

  const duration = Math.max(0.05, cue.end - cue.start);
  const weights = lyricTokens.map(estimatedTokenWeight);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0) || lyricTokens.length;
  let cursor = cue.start;

  return lyricTokens.map((token, index) => {
    const start = index === 0 ? cue.start : cursor;
    const end =
      index === lyricTokens.length - 1
        ? cue.end
        : Math.min(cue.end, start + duration * (weights[index] / totalWeight));
    cursor = end;
    return {
      id: `${cueKey}-${index}`,
      text: token,
      start,
      end: Math.max(end, start + 0.01),
      compact: shouldUseCompactWordSpacing(token, cue.text)
    };
  });
}

export function wordProgressForTime(word: TimedWord, time: number): number {
  if (word.end <= word.start) {
    return time >= word.start ? 1 : 0;
  }
  return clamp01((time - word.start) / (word.end - word.start));
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }
  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
