import type { Question, Rng } from './types';
import { matchAnswer } from './text';
import {
  type Group,
  allocate,
  candidates,
  pickReplacement,
  planIds,
  planTexts,
  shuffle,
} from './selection';
import { isFastMoneyFriendly, questionKey } from './validate';

export const FM_QUESTIONS = 5;
export const FM_TARGET = 200;
export const MAX_STRIKES = 3;

export type Phase = 'setup' | 'intro' | 'round' | 'awarded' | 'fastmoney' | 'final';

export interface GameSettings {
  teamNames: [string, string];
  roundCount: number;
  fastMoneyEnabled: boolean;
  /** Pack id -> percent, used when the host re-mixes the upcoming question ("Mixed"). */
  mix: Record<string, number>;
  /** Display names for every pack id in the bank. */
  themeNames: Record<string, string>;
  /** Human description of the chosen theme setup, e.g. "Thanksgiving 60% · General 40%". */
  themeLabel: string;
}

export interface FastMoneyEntry {
  text: string;
  /** Index of the matched answer, or null if nothing matched (0 points). */
  answerIndex: number | null;
  points: number;
}

export interface FastMoneyState {
  player: 0 | 1;
  /** intro (before the first question) -> answering -> review (host can fix answers) -> reveal. */
  stage: 'intro' | 'answering' | 'review' | 'reveal';
  /** Question the current player is on (0-based) while answering. */
  qi: number;
  entries: [(FastMoneyEntry | null)[], (FastMoneyEntry | null)[]];
  /** Each answer is revealed in two taps: first what they said (`revealed`), then its points (`scored`). */
  revealed: [boolean[], boolean[]];
  scored: [boolean[], boolean[]];
  /** Counts times player 2 repeated one of player 1's answers (the TV plays a "try again" sound on each). */
  repeats: number;
}

export interface GameState {
  phase: Phase;
  settings: GameSettings;
  rounds: Question[];
  fastMoney: Question[];
  /** Every question the host could switch to (all packs at game start). Never sent to clients. */
  bank: Question[];
  roundIndex: number;
  revealed: number[];
  strikes: number;
  pot: number;
  scores: [number, number];
  fm: FastMoneyState | null;
  /** Server-clock epoch ms when the timer ends, or null. */
  timerEndsAt: number | null;
  timerSeconds: number;
  /** Bumped on every change so clients can ignore stale messages. */
  version: number;
  /** Last "upcoming question changed" note shown on the host's phone. */
  notice: string | null;
}

export type Action =
  | { type: 'startGame'; settings: GameSettings; rounds: Question[]; fastMoney: Question[]; bank: Question[] }
  | { type: 'setTeamNames'; names: [string, string] }
  | { type: 'begin' }
  | { type: 'reveal'; index: number }
  | { type: 'strike' }
  | { type: 'clearStrikes' }
  | { type: 'award'; team: 0 | 1 }
  | { type: 'nextRound' }
  | { type: 'adjustScore'; team: 0 | 1; delta: number }
  | { type: 'setUpcomingTheme'; themeId: string }
  | { type: 'rerollUpcoming' }
  /** Fast Money intro only: swap all five questions to a theme, or swap one question. */
  | { type: 'fmChangeTheme'; themeId: string }
  | { type: 'fmReplace'; qi: number; themeId?: string }
  | { type: 'fmBegin' }
  | { type: 'fmSubmit'; text: string; answerIndex?: number | null }
  | { type: 'fmEdit'; qi: number; text: string; answerIndex?: number | null }
  | { type: 'fmConfirm' }
  | { type: 'fmUndo' }
  | { type: 'fmReveal'; qi: number }
  | { type: 'fmRevealAll' }
  | { type: 'fmNext' }
  | { type: 'startTimer'; seconds: number }
  | { type: 'stopTimer' }
  | { type: 'restart' }
  | { type: 'undo' }
  | { type: 'reset' };

export interface Ctx {
  rng: Rng;
  now: number;
}

export class GameError extends Error {}

export function initialState(): GameState {
  return {
    phase: 'setup',
    settings: { teamNames: ['Team 1', 'Team 2'], roundCount: 4, fastMoneyEnabled: true, mix: {}, themeNames: {}, themeLabel: '' },
    rounds: [],
    fastMoney: [],
    bank: [],
    roundIndex: -1,
    revealed: [],
    strikes: 0,
    pot: 0,
    scores: [0, 0],
    fm: null,
    timerEndsAt: null,
    timerSeconds: 0,
    version: 0,
    notice: null,
  };
}

/** Last round ×3, second to last ×2, everything else ×1. */
export function roundMultiplier(index: number, total: number): number {
  if (total >= 3 && index === total - 1) return 3;
  if (total >= 3 && index === total - 2) return 2;
  return 1;
}

export function currentRound(s: GameState): Question | null {
  return s.roundIndex >= 0 ? (s.rounds[s.roundIndex] ?? null) : null;
}

export type Upcoming = { kind: 'round'; index: number } | { kind: 'fastMoney' } | null;

/** The next question the host could still change without touching the live round. */
export function upcoming(s: GameState): Upcoming {
  if (s.phase === 'setup' || s.phase === 'final' || s.phase === 'fastmoney') return null;
  const next = s.roundIndex + 1;
  if (next < s.rounds.length) return { kind: 'round', index: next };
  if (s.settings.fastMoneyEnabled) return { kind: 'fastMoney' };
  return null;
}

export function fmTotal(s: Pick<GameState, 'fm'>, player: 0 | 1): number {
  if (!s.fm) return 0;
  return s.fm.entries[player].reduce((sum, e, i) => sum + (e && s.fm!.scored[player][i] ? e.points : 0), 0);
}

function bankGroups(s: GameState, weights?: Record<string, number>, onlyPack?: string): Group[] {
  const byPack = new Map<string, Question[]>();
  for (const q of s.bank) {
    if (!byPack.has(q.themeId)) byPack.set(q.themeId, []);
    byPack.get(q.themeId)!.push(q);
  }
  return [...byPack.entries()]
    .filter(([id]) => !onlyPack || id === onlyPack)
    .map(([id, questions]) => ({
      key: id,
      label: s.settings.themeNames[id] ?? id,
      weight: weights ? (weights[id] ?? 0) : 1,
      questions,
    }))
    .filter((g) => g.weight > 0);
}

/** Questions in play are never offered again (even if they have since been swapped out of the plan). */
function excludedFor(s: GameState, replacing?: Question[]): { ids: Set<string>; texts: Set<string> } {
  const plan = { rounds: s.rounds, fastMoney: s.fastMoney };
  const ids = planIds(plan);
  const texts = planTexts(plan);
  for (const q of replacing ?? []) {
    ids.delete(q.id);
    texts.delete(questionKey(q));
  }
  return { ids, texts };
}

/** Remaining unused questions per pack: powers the host's "change next theme" picker. */
export function themeAvailability(s: GameState): { id: string; name: string; remaining: number }[] {
  const { ids, texts } = excludedFor(s);
  return bankGroups(s).map((g) => ({
    id: g.key,
    name: g.label,
    remaining: candidates({ groups: [g], excludeIds: ids, excludeTexts: texts }).length,
  }));
}

function themeGroups(s: GameState, themeId: string) {
  const mixed = themeId === 'mix';
  const groups = mixed ? bankGroups(s, s.settings.mix) : bankGroups(s, undefined, themeId);
  if (!groups.length) throw new GameError('That theme has no questions.');
  const themeName = mixed ? 'Mixed' : (s.settings.themeNames[themeId] ?? themeId);
  return { groups, mixed, themeName };
}

function replaceUpcoming(s: GameState, themeId: string, ctx: Ctx): GameState {
  const up = upcoming(s);
  if (!up) throw new GameError('There is no upcoming question to change.');
  if (up.kind === 'fastMoney') return redoFastMoney(s, themeId, ctx);
  const { groups, mixed, themeName } = themeGroups(s, themeId);
  const old = s.rounds[up.index];
  const { ids, texts } = excludedFor(s, [old]);
  const q = pickReplacement({ groups, excludeIds: ids, excludeTexts: texts, rng: ctx.rng });
  if (!q) throw new GameError(`No unused ${themeName} questions are left.`);
  const rounds = s.rounds.slice();
  rounds[up.index] = q;
  return { ...s, rounds, notice: `Round ${up.index + 1} is now a ${mixed ? 'Mixed' : themeName} question.` };
}

/** Redo all five Fast Money questions from a theme (or the game mix). */
function redoFastMoney(s: GameState, themeId: string, ctx: Ctx): GameState {
  const { groups, mixed, themeName } = themeGroups(s, themeId);
  const { ids, texts } = excludedFor(s, s.fastMoney);
  const picked: Question[] = [];
  const caps = groups.map((g) => candidates({ groups: [g], excludeIds: ids, excludeTexts: texts, fastMoney: true }).length);
  const alloc = allocate(FM_QUESTIONS, groups.map((g, i) => ({ weight: g.weight, capacity: caps[i] })), ctx.rng);
  const usedIds = new Set(ids);
  const usedTexts = new Set(texts);
  groups.forEach((g, i) => {
    const pool = shuffle(candidates({ groups: [g], excludeIds: usedIds, excludeTexts: usedTexts, fastMoney: true }), ctx.rng);
    pool.slice(0, alloc[i]).forEach((q) => {
      picked.push(q);
      usedIds.add(q.id);
    });
  });
  // Top up from anything if themes lack well-shaped Fast Money questions.
  while (picked.length < FM_QUESTIONS) {
    const q = pickReplacement({ groups, excludeIds: usedIds, excludeTexts: usedTexts, fastMoney: false, rng: ctx.rng });
    if (!q) break;
    picked.push(q);
    usedIds.add(q.id);
  }
  if (picked.length < FM_QUESTIONS) throw new GameError(`Not enough unused ${themeName} questions for Fast Money.`);
  return { ...s, fastMoney: shuffle(picked, ctx.rng), notice: `Fast Money is now ${mixed ? 'Mixed' : themeName}.` };
}

/** Swap a single Fast Money question (a different one, from `themeId` or the same theme). */
function replaceFastMoneyQuestion(s: GameState, qi: number, themeId: string | undefined, ctx: Ctx): GameState {
  const old = s.fastMoney[qi];
  if (!old) throw new GameError('No such question.');
  const { groups, themeName } = themeGroups(s, themeId ?? old.themeId);
  const { ids, texts } = excludedFor(s);
  const q = pickReplacement({ groups, excludeIds: ids, excludeTexts: texts, fastMoney: true, rng: ctx.rng });
  if (!q) throw new GameError(`No unused ${themeName} questions are left.`);
  const fastMoney = s.fastMoney.slice();
  fastMoney[qi] = q;
  return { ...s, fastMoney, notice: `Question ${qi + 1} changed.` };
}

function bump(s: GameState): GameState {
  return { ...s, version: s.version + 1 };
}

function requirePhase(s: GameState, ...phases: Phase[]) {
  if (!phases.includes(s.phase)) throw new GameError(`Not allowed during "${s.phase}".`);
}

const REPEAT_NOTICE = 'Player 1 already gave that answer. Ask for something different.';

/** Builds a Fast Money entry from what the host typed / tapped (auto-matching typed text). */
function makeEntry(q: Question, text: string, answerIndex: number | null | undefined): FastMoneyEntry {
  const t = text.trim();
  const index = answerIndex !== undefined ? answerIndex : t ? (matchAnswer(q, t)?.index ?? null) : null;
  if (index !== null && (index < 0 || index >= q.answers.length)) throw new GameError('No such answer.');
  return { text: t, answerIndex: index, points: index === null ? 0 : q.answers[index].points };
}

/** Player 2 may not repeat player 1's answer to the same question. */
function isRepeat(fm: FastMoneyState, qi: number, entry: FastMoneyEntry): boolean {
  return fm.player === 1 && entry.answerIndex !== null && fm.entries[0][qi]?.answerIndex === entry.answerIndex;
}

export function reduce(state: GameState, action: Action, ctx: Ctx): GameState {
  const s = { ...state, notice: null as string | null };
  switch (action.type) {
    case 'startGame': {
      if (!action.rounds.length) throw new GameError('A game needs at least one round question.');
      if (action.settings.fastMoneyEnabled && action.fastMoney.length !== FM_QUESTIONS)
        throw new GameError(`Fast Money needs exactly ${FM_QUESTIONS} questions.`);
      const ids = new Set<string>();
      for (const q of [...action.rounds, ...action.fastMoney]) {
        if (ids.has(q.id)) throw new GameError('The same question cannot be used twice in one game.');
        ids.add(q.id);
      }
      return bump({
        ...initialState(),
        phase: 'intro',
        settings: { ...action.settings, roundCount: action.rounds.length },
        rounds: action.rounds,
        fastMoney: action.settings.fastMoneyEnabled ? action.fastMoney : [],
        bank: action.bank,
        version: state.version,
      });
    }
    case 'setTeamNames': {
      requirePhase(s, 'intro');
      const clean = (n: string, fallback: string) => n.trim().slice(0, 24) || fallback;
      return bump({ ...s, settings: { ...s.settings, teamNames: [clean(action.names[0], 'Team 1'), clean(action.names[1], 'Team 2')] } });
    }
    case 'begin':
      requirePhase(s, 'intro');
      return bump({ ...s, phase: 'round', roundIndex: 0, revealed: [], strikes: 0, pot: 0 });
    case 'reveal': {
      requirePhase(s, 'round', 'awarded');
      const q = currentRound(s);
      if (!q || action.index < 0 || action.index >= q.answers.length) throw new GameError('No such answer.');
      if (s.revealed.includes(action.index)) return s;
      const pot = s.phase === 'round' ? s.pot + q.answers[action.index].points : s.pot;
      return bump({ ...s, revealed: [...s.revealed, action.index], pot });
    }
    case 'strike':
      requirePhase(s, 'round');
      return bump({ ...s, strikes: Math.min(MAX_STRIKES, s.strikes + 1) });
    case 'clearStrikes':
      requirePhase(s, 'round');
      return bump({ ...s, strikes: 0 });
    case 'award': {
      requirePhase(s, 'round');
      const q = currentRound(s)!;
      const mult = roundMultiplier(s.roundIndex, s.rounds.length);
      const scores: [number, number] = [...s.scores];
      scores[action.team] += s.pot * mult;
      return bump({ ...s, phase: 'awarded', scores, revealed: q.answers.map((_, i) => i) });
    }
    case 'nextRound': {
      requirePhase(s, 'awarded');
      const next = s.roundIndex + 1;
      if (next < s.rounds.length) return bump({ ...s, phase: 'round', roundIndex: next, revealed: [], strikes: 0, pot: 0, timerEndsAt: null });
      if (s.settings.fastMoneyEnabled)
        return bump({
          ...s,
          phase: 'fastmoney',
          timerEndsAt: null,
          fm: {
            player: 0,
            stage: 'intro',
            qi: 0,
            entries: [Array(FM_QUESTIONS).fill(null), Array(FM_QUESTIONS).fill(null)],
            revealed: [Array(FM_QUESTIONS).fill(false), Array(FM_QUESTIONS).fill(false)],
            scored: [Array(FM_QUESTIONS).fill(false), Array(FM_QUESTIONS).fill(false)],
            repeats: 0,
          },
        });
      return bump({ ...s, phase: 'final', timerEndsAt: null });
    }
    case 'adjustScore': {
      const scores: [number, number] = [...s.scores];
      scores[action.team] = Math.max(0, scores[action.team] + action.delta);
      return bump({ ...s, scores });
    }
    case 'setUpcomingTheme':
      return bump(replaceUpcoming(s, action.themeId, ctx));
    case 'rerollUpcoming': {
      const up = upcoming(s);
      if (!up) throw new GameError('There is no upcoming question to change.');
      const theme = up.kind === 'round' ? s.rounds[up.index].themeId : 'mix';
      return bump(replaceUpcoming(s, theme, ctx));
    }
    case 'fmChangeTheme':
    case 'fmReplace': {
      requirePhase(s, 'fastmoney');
      if (s.fm!.stage !== 'intro') throw new GameError('Questions can only be changed before Fast Money starts.');
      return bump(action.type === 'fmChangeTheme' ? redoFastMoney(s, action.themeId, ctx) : replaceFastMoneyQuestion(s, action.qi, action.themeId, ctx));
    }
    case 'fmBegin': {
      requirePhase(s, 'fastmoney');
      const fm = s.fm!;
      if (fm.stage !== 'intro') throw new GameError('Fast Money has already started.');
      return bump({ ...s, fm: { ...fm, stage: 'answering' } });
    }
    case 'fmSubmit': {
      requirePhase(s, 'fastmoney');
      const fm = s.fm!;
      if (fm.stage === 'intro') throw new GameError('Start Fast Money first.');
      if (fm.stage !== 'answering') throw new GameError('Answers are already in.');
      const entry = makeEntry(s.fastMoney[fm.qi], action.text, action.answerIndex);
      // Repeating player 1's answer is not recorded: the TV plays the "try again" sound.
      if (isRepeat(fm, fm.qi, entry)) return bump({ ...s, fm: { ...fm, repeats: (fm.repeats ?? 0) + 1 }, notice: REPEAT_NOTICE });
      const entries: FastMoneyState['entries'] = [fm.entries[0].slice(), fm.entries[1].slice()];
      entries[fm.player][fm.qi] = entry;
      const done = fm.qi + 1 >= FM_QUESTIONS;
      return bump({ ...s, fm: { ...fm, entries, qi: done ? fm.qi : fm.qi + 1, stage: done ? 'review' : 'answering' } });
    }
    case 'fmEdit': {
      // After all answers are in, the host can retype / re-pick any of them before the reveal.
      requirePhase(s, 'fastmoney');
      const fm = s.fm!;
      if (fm.stage !== 'review') throw new GameError('Answers can only be changed before the reveal.');
      const q = s.fastMoney[action.qi];
      if (!q) throw new GameError('No such question.');
      const entry = makeEntry(q, action.text, action.answerIndex);
      if (isRepeat(fm, action.qi, entry)) return bump({ ...s, fm: { ...fm, repeats: (fm.repeats ?? 0) + 1 }, notice: REPEAT_NOTICE });
      const entries: FastMoneyState['entries'] = [fm.entries[0].slice(), fm.entries[1].slice()];
      entries[fm.player][action.qi] = entry;
      return bump({ ...s, fm: { ...fm, entries } });
    }
    case 'fmConfirm': {
      requirePhase(s, 'fastmoney');
      const fm = s.fm!;
      if (fm.stage !== 'review') throw new GameError('Nothing to confirm.');
      return bump({ ...s, fm: { ...fm, stage: 'reveal' } });
    }
    case 'fmUndo': {
      requirePhase(s, 'fastmoney');
      const fm = s.fm!;
      const lastFilled = fm.stage === 'reveal' || fm.stage === 'review' ? FM_QUESTIONS - 1 : fm.qi - 1;
      if (fm.stage === 'intro' || lastFilled < 0) return s;
      if (fm.revealed[fm.player].some(Boolean)) throw new GameError('Cannot undo after revealing.');
      const entries: FastMoneyState['entries'] = [fm.entries[0].slice(), fm.entries[1].slice()];
      entries[fm.player][lastFilled] = null;
      return bump({ ...s, fm: { ...fm, entries, qi: lastFilled, stage: 'answering' } });
    }
    case 'fmReveal': {
      requirePhase(s, 'fastmoney');
      const fm = s.fm!;
      if (fm.stage !== 'reveal' || !fm.entries[fm.player][action.qi]) throw new GameError('Nothing to reveal.');
      const revealed: FastMoneyState['revealed'] = [fm.revealed[0].slice(), fm.revealed[1].slice()];
      const scored: FastMoneyState['scored'] = [fm.scored[0].slice(), fm.scored[1].slice()];
      if (!revealed[fm.player][action.qi]) revealed[fm.player][action.qi] = true; // 1st tap: what they said
      else if (!scored[fm.player][action.qi]) scored[fm.player][action.qi] = true; // 2nd tap: the points
      else return s;
      return bump({ ...s, fm: { ...fm, revealed, scored } });
    }
    case 'fmRevealAll': {
      requirePhase(s, 'fastmoney');
      const fm = s.fm!;
      if (fm.stage !== 'reveal') throw new GameError('Finish collecting answers first.');
      const revealed: FastMoneyState['revealed'] = [fm.revealed[0].slice(), fm.revealed[1].slice()];
      const scored: FastMoneyState['scored'] = [fm.scored[0].slice(), fm.scored[1].slice()];
      revealed[fm.player] = revealed[fm.player].map(() => true);
      scored[fm.player] = scored[fm.player].map(() => true);
      return bump({ ...s, fm: { ...fm, revealed, scored } });
    }
    case 'fmNext': {
      requirePhase(s, 'fastmoney');
      const fm = s.fm!;
      if (fm.stage !== 'reveal') throw new GameError('Finish collecting answers first.');
      if (!fm.scored[fm.player].every(Boolean)) throw new GameError('Reveal all answers first.');
      if (fm.player === 0) return bump({ ...s, timerEndsAt: null, fm: { ...fm, player: 1, stage: 'answering', qi: 0 } });
      return bump({ ...s, phase: 'final', timerEndsAt: null });
    }
    case 'startTimer':
      return bump({ ...s, timerEndsAt: ctx.now + Math.max(1, action.seconds) * 1000, timerSeconds: action.seconds });
    case 'stopTimer':
      return bump({ ...s, timerEndsAt: null });
    case 'restart':
      // Same lineup, back to the start: scores and progress cleared.
      if (state.phase === 'setup') throw new GameError('No game to restart.');
      return bump({
        ...state,
        phase: 'intro',
        roundIndex: -1,
        revealed: [],
        strikes: 0,
        pot: 0,
        scores: [0, 0],
        fm: null,
        timerEndsAt: null,
        notice: 'Game restarted.',
      });
    case 'undo':
      // Needs the game's history, so it is handled by `step` in history.ts.
      throw new GameError('Undo is handled by the game session.');
    case 'reset':
      return bump({ ...initialState(), version: state.version });
  }
}

/** Fast Money questions that were chosen even though their answer spread is not ideal. */
export function fastMoneyWarnings(questions: Question[]): string[] {
  return questions.filter((q) => !isFastMoneyFriendly(q)).map((q) => q.text);
}

// ------------------------------------------------------------------ Client view

export interface GameView extends Omit<GameState, 'bank' | 'timerEndsAt'> {
  /** Milliseconds left on the timer (relative to when this view was sent). */
  timerRemainingMs: number | null;
  canUndo: boolean;
  themes: { id: string; name: string; remaining: number }[];
  upcoming: Upcoming;
  multiplier: number;
}

export function toView(s: GameState, now: number, canUndo = false): GameView {
  const { bank: _bank, timerEndsAt, ...rest } = s;
  void _bank;
  return {
    ...rest,
    timerRemainingMs: timerEndsAt ? Math.max(0, timerEndsAt - now) : null,
    canUndo,
    themes: s.phase === 'setup' ? [] : themeAvailability(s),
    upcoming: upcoming(s),
    multiplier: s.roundIndex >= 0 ? roundMultiplier(s.roundIndex, s.rounds.length) : 1,
  };
}
