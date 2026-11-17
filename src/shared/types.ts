export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Answer {
  text: string;
  /** Points for this answer (out of ~100 respondents). */
  points: number;
  /** Other phrasings that should count as this answer. */
  aliases: string[];
}

/**
 * Where the point values came from. Built-in packs are always `estimated`:
 * we never claim a real survey was run unless a pack author says so.
 */
export interface SurveySource {
  type: 'survey' | 'estimated';
  name: string;
  year?: number;
  sampleSize?: number;
  url?: string;
  note?: string;
}

export interface Question {
  id: string;
  /** The pack (theme) this question belongs to. */
  themeId: string;
  text: string;
  category: string;
  difficulty: Difficulty;
  /** Ranked, highest points first. */
  answers: Answer[];
  source: SurveySource;
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  questions: Question[];
  updatedAt: number;
}

export type Rng = () => number;
