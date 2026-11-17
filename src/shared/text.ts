import type { Question } from './types';

const ARTICLES = new Set(['the', 'a', 'an', 'my', 'some', 'their', 'your', 'our', 'his', 'her']);

export function normalize(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (base.length > 1 && ARTICLES.has(base[0])) base.shift();
  return base.join(' ');
}

function stemWord(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Normalised + singularised, used for comparing answers. */
export function stem(input: string): string {
  return normalize(input).split(' ').map(stemWord).join(' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export type MatchKind = 'exact' | 'contains' | 'fuzzy';
export interface AnswerMatch {
  index: number;
  kind: MatchKind;
}

const TIER: Record<MatchKind, number> = { exact: 0, contains: 1, fuzzy: 2 };

/**
 * Find which ranked answer a spoken/typed response corresponds to.
 * Returns the best match (exact > contains > fuzzy; ties go to the higher-ranked answer),
 * or null when nothing plausibly matches. Hosts can always override the suggestion.
 */
export function matchAnswer(question: Question, input: string): AnswerMatch | null {
  const guess = stem(input);
  if (!guess) return null;
  const guessTokens = guess.split(' ');
  let best: AnswerMatch | null = null;

  question.answers.forEach((answer, index) => {
    let bestKind: MatchKind | null = null;
    for (const candidateRaw of [answer.text, ...answer.aliases]) {
      const cand = stem(candidateRaw);
      if (!cand) continue;
      let kind: MatchKind | null = null;
      if (cand === guess) kind = 'exact';
      else {
        const candTokens = cand.split(' ');
        const guessHasCand = cand.length >= 4 && candTokens.every((t) => guessTokens.includes(t));
        const candHasGuess = guess.length >= 4 && guessTokens.every((t) => candTokens.includes(t));
        if (guessHasCand || candHasGuess) kind = 'contains';
        else {
          const tolerance = cand.length >= 8 ? 2 : cand.length >= 4 ? 1 : 0;
          if (tolerance > 0 && levenshtein(cand, guess) <= tolerance) kind = 'fuzzy';
        }
      }
      if (kind && (bestKind === null || TIER[kind] < TIER[bestKind])) bestKind = kind;
    }
    if (bestKind && (best === null || TIER[bestKind] < TIER[best.kind])) best = { index, kind: bestKind };
  });
  return best;
}
