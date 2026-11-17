import type { Answer, Difficulty, Question, SurveySource } from './types';
import { normalize, stem } from './text';

export const MIN_ANSWERS = 4;
export const MAX_ANSWERS = 8;

export interface Issues {
  errors: string[];
  warnings: string[];
}

export function sumPoints(q: Pick<Question, 'answers'>): number {
  return q.answers.reduce((s, a) => s + a.points, 0);
}

/** Hard requirements (blocks saving) and soft quality warnings. */
export function validateQuestion(q: Pick<Question, 'text' | 'answers'>): Issues {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!q.text.trim()) errors.push('Question text is required.');
  const n = q.answers.length;
  if (n < MIN_ANSWERS || n > MAX_ANSWERS) errors.push(`Needs ${MIN_ANSWERS}–${MAX_ANSWERS} answers (has ${n}).`);

  const seen = new Map<string, number>();
  q.answers.forEach((a, i) => {
    if (!a.text.trim()) errors.push(`Answer ${i + 1} is empty.`);
    if (!Number.isFinite(a.points) || !Number.isInteger(a.points) || a.points < 1)
      errors.push(`Answer ${i + 1} ("${a.text}") needs a whole-number point value of at least 1.`);
    for (const form of [a.text, ...a.aliases]) {
      const key = stem(form);
      if (!key) continue;
      const prev = seen.get(key);
      if (prev !== undefined && prev !== i)
        errors.push(`"${form}" appears in both answer ${prev + 1} and answer ${i + 1}.`);
      else seen.set(key, i);
    }
  });

  const sorted = q.answers.every((a, i) => i === 0 || q.answers[i - 1].points >= a.points);
  if (!sorted) warnings.push('Answers are not ranked highest to lowest; they will be sorted on save.');
  const total = q.answers.reduce((s, a) => s + (Number.isFinite(a.points) ? a.points : 0), 0);
  if (total > 100) warnings.push(`Points add up to ${total}; surveys of 100 people usually total 100 or less.`);
  if (total > 0 && total < 50) warnings.push(`Points only add up to ${total}; consider adding more answers or points.`);
  return { errors, warnings };
}

/**
 * Fast Money works best when there's one clearly popular answer and a
 * spread of lower-scoring ones, so a quick guess usually scores something.
 */
export function isFastMoneyFriendly(q: Pick<Question, 'answers'>): boolean {
  const a = q.answers;
  if (a.length < 5) return false;
  const top = a[0].points;
  if (top < 20 || top > 50) return false;
  if (top - a[1].points < 3) return false;
  const total = sumPoints(q);
  return total >= 70 && total <= 100;
}

export function sortAnswers(answers: Answer[]): Answer[] {
  return [...answers].sort((x, y) => y.points - x.points);
}

export function questionKey(q: Pick<Question, 'text'>): string {
  return normalize(q.text);
}

export const ESTIMATED_SOURCE: SurveySource = {
  type: 'estimated',
  name: 'Editorial estimate',
  note: 'Points are estimated to resemble a typical survey of 100 people. No real survey was conducted.',
};

export function describeSource(s: SurveySource): string {
  if (s.type === 'survey') {
    const bits = [s.name];
    if (s.year) bits.push(String(s.year));
    if (s.sampleSize) bits.push(`n=${s.sampleSize}`);
    return `Survey: ${bits.join(', ')}`;
  }
  return `Estimated points (${s.name || 'editorial'})`;
}

export function difficultyFrom(v: string | undefined): Difficulty {
  const s = (v ?? '').trim().toLowerCase();
  if (s.startsWith('e') || s === '1') return 'easy';
  if (s.startsWith('h') || s === '3') return 'hard';
  return 'medium';
}
