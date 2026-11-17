import { describe, expect, it } from 'vitest';
import { BUILT_IN_PACKS } from '../src/shared/packs';
import { type Action, type GameSettings, type GameState, FM_QUESTIONS, GameError, fmTotal, initialState, reduce, roundMultiplier, themeAvailability, toView, upcoming } from '../src/shared/game';
import { assemblePlan, groupsFor, mulberry32 } from '../src/shared/selection';
import { questionKey } from '../src/shared/validate';

const bank = BUILT_IN_PACKS.flatMap((p) => p.questions);
const themeNames = Object.fromEntries(BUILT_IN_PACKS.map((p) => [p.id, p.name]));
const rng = mulberry32(11);
const ctx = { rng, now: 1_000_000 };

function start(rounds = 4, mix: Record<string, number> = { thanksgiving: 100 }): GameState {
  const groups = groupsFor({ mode: 'mixed', weights: mix }, BUILT_IN_PACKS);
  const plan = assemblePlan({ groups, roundCount: rounds, fastMoneyCount: FM_QUESTIONS, rng: mulberry32(5) });
  const settings: GameSettings = { teamNames: ['A', 'B'], roundCount: rounds, fastMoneyEnabled: true, mix, themeNames, themeLabel: 'x' };
  return reduce(initialState(), { type: 'startGame', settings, rounds: plan.rounds, fastMoney: plan.fastMoney, bank }, ctx);
}
const run = (s: GameState, ...actions: Action[]) => actions.reduce((st, a) => reduce(st, a, ctx), s);

describe('round flow', () => {
  it('scores with multipliers and moves to Fast Money', () => {
    let s = run(start(), { type: 'begin' });
    expect(s.phase).toBe('round');
    const q0 = s.rounds[0];
    s = run(s, { type: 'reveal', index: 0 }, { type: 'reveal', index: 1 }, { type: 'award', team: 1 });
    expect(s.pot).toBe(q0.answers[0].points + q0.answers[1].points);
    expect(s.scores).toEqual([0, s.pot]);
    expect(s.phase).toBe('awarded');
    expect(s.revealed).toHaveLength(q0.answers.length);
    expect(s.pot).toBe(q0.answers[0].points + q0.answers[1].points); // revealing the rest doesn't add
    // Play out the remaining rounds: last round is worth triple, then Fast Money starts.
    s = run(s, { type: 'nextRound' }, { type: 'reveal', index: 0 }, { type: 'award', team: 0 });
    s = run(s, { type: 'nextRound' }, { type: 'reveal', index: 0 }, { type: 'award', team: 0 });
    const pts = (i: number) => s.rounds[i].answers[0].points;
    expect(s.scores[0]).toBe(pts(1) + pts(2) * 2);
    s = run(s, { type: 'nextRound' }, { type: 'reveal', index: 0 }, { type: 'award', team: 0 });
    expect(s.scores[0]).toBe(pts(1) + pts(2) * 2 + pts(3) * 3);
    s = run(s, { type: 'nextRound' });
    expect(s.phase).toBe('fastmoney');
    expect([roundMultiplier(0, 4), roundMultiplier(1, 4), roundMultiplier(2, 4), roundMultiplier(3, 4)]).toEqual([1, 1, 2, 3]);
  });

  it('caps strikes at 3 and rejects actions in wrong phases', () => {
    let s = run(start(), { type: 'begin' }, { type: 'strike' }, { type: 'strike' }, { type: 'strike' }, { type: 'strike' });
    expect(s.strikes).toBe(3);
    expect(() => reduce(start(), { type: 'reveal', index: 0 }, ctx)).toThrow(GameError);
    s = run(s, { type: 'award', team: 0 });
    expect(() => reduce(s, { type: 'strike' }, ctx)).toThrow(GameError);
  });

  it('rejects duplicate questions at startGame', () => {
    const q = bank[0];
    expect(() =>
      reduce(initialState(), { type: 'startGame', settings: start().settings, rounds: [q, q], fastMoney: bank.slice(1, 6), bank }, ctx),
    ).toThrow(/twice/);
  });
});

describe('changing the upcoming question theme (from the phone)', () => {
  it('replaces only the next round and leaves the current round untouched', () => {
    let s = run(start(4), { type: 'begin' }, { type: 'reveal', index: 0 });
    const current = s.rounds[0];
    const before = s.rounds.slice();
    expect(upcoming(s)).toEqual({ kind: 'round', index: 1 });
    s = run(s, { type: 'setUpcomingTheme', themeId: 'christmas' });
    expect(s.rounds[0]).toBe(current);
    expect(s.revealed).toEqual([0]);
    expect(s.phase).toBe('round');
    expect(s.rounds[1].themeId).toBe('christmas');
    expect(s.rounds[2]).toBe(before[2]);
    expect(s.rounds[3]).toBe(before[3]);
    expect(s.notice).toMatch(/Round 2/);
  });

  it('never introduces a repeat', () => {
    let s = run(start(4), { type: 'begin' });
    for (let i = 0; i < 30; i++) {
      s = run(s, { type: 'setUpcomingTheme', themeId: 'thanksgiving' });
      const all = [...s.rounds, ...s.fastMoney];
      expect(new Set(all.map((q) => q.id)).size).toBe(all.length);
      expect(new Set(all.map(questionKey)).size).toBe(all.length);
    }
  });

  it('can re-mix using the game mix, and reports availability', () => {
    const mix = { thanksgiving: 50, general: 50 };
    let s = run(start(4, mix), { type: 'begin' });
    for (let i = 0; i < 10; i++) {
      s = run(s, { type: 'setUpcomingTheme', themeId: 'mix' });
      expect(['thanksgiving', 'general']).toContain(s.rounds[1].themeId);
    }
    const avail = themeAvailability(s);
    expect(avail.find((t) => t.id === 'thanksgiving')!.remaining).toBeGreaterThan(0);
  });

  it('applies to Fast Money once the rounds run out, using friendly questions', () => {
    let s = run(start(1), { type: 'begin' });
    expect(upcoming(s)).toEqual({ kind: 'fastMoney' });
    const oldIds = s.fastMoney.map((q) => q.id);
    s = run(s, { type: 'setUpcomingTheme', themeId: 'food' });
    expect(s.fastMoney).toHaveLength(FM_QUESTIONS);
    expect(s.fastMoney.every((q) => q.themeId === 'food')).toBe(true);
    expect(s.fastMoney.map((q) => q.id)).not.toEqual(oldIds);
    expect(new Set([...s.rounds, ...s.fastMoney].map((q) => q.id)).size).toBe(1 + FM_QUESTIONS);
  });

  it('is not possible during Fast Money', () => {
    let s = run(start(1), { type: 'begin' }, { type: 'award', team: 0 }, { type: 'nextRound' });
    expect(s.phase).toBe('fastmoney');
    expect(() => reduce(s, { type: 'setUpcomingTheme', themeId: 'food' }, ctx)).toThrow(GameError);
    s = run(s, { type: 'stopTimer' });
  });
});

describe('Fast Money', () => {
  const toFastMoney = () => run(start(1), { type: 'begin' }, { type: 'award', team: 0 }, { type: 'nextRound' });

  it('opens on an intro screen and only asks questions after the host starts it', () => {
    let s = toFastMoney();
    expect(s.fm).toMatchObject({ player: 0, stage: 'intro', qi: 0 });
    expect(() => reduce(s, { type: 'fmSubmit', text: 'turkey' }, ctx)).toThrow(/Start Fast Money first/);
    s = run(s, { type: 'fmBegin' });
    expect(s.fm).toMatchObject({ stage: 'answering', qi: 0 });
    expect(() => reduce(s, { type: 'fmBegin' }, ctx)).toThrow(/already started/);
  });

  it('lets the host swap Fast Money questions on the intro screen only', () => {
    let s = toFastMoney();
    const before = s.fastMoney.map((q) => q.id);
    const used = new Set([...s.rounds.map((q) => q.id), ...before]);
    s = run(s, { type: 'fmReplace', qi: 2 });
    expect(s.fastMoney).toHaveLength(FM_QUESTIONS);
    expect(s.fastMoney[2].id).not.toBe(before[2]);
    expect(s.fastMoney.filter((_, i) => i !== 2).map((q) => q.id)).toEqual(before.filter((_, i) => i !== 2));
    expect(used.has(s.fastMoney[2].id)).toBe(false);
    s = run(s, { type: 'fmReplace', qi: 0, themeId: 'food' });
    expect(s.fastMoney[0].themeId).toBe('food');
    s = run(s, { type: 'fmChangeTheme', themeId: 'food' });
    expect(s.fastMoney.every((q) => q.themeId === 'food')).toBe(true);
    expect(new Set(s.fastMoney.map((q) => q.id)).size).toBe(FM_QUESTIONS);
    expect(() => reduce(s, { type: 'fmReplace', qi: 9 }, ctx)).toThrow(/No such question/);
    s = run(s, { type: 'fmBegin' });
    expect(() => reduce(s, { type: 'fmReplace', qi: 0 }, ctx)).toThrow(/before Fast Money starts/);
    expect(() => reduce(s, { type: 'fmChangeTheme', themeId: 'food' }, ctx)).toThrow(/before Fast Money starts/);
  });

  it('collects answers, blocks duplicates for player 2, and totals revealed points', () => {
    let s = run(toFastMoney(), { type: 'fmBegin' });
    const topAnswers = s.fastMoney.map((q) => q.answers[0].text);
    for (let i = 0; i < FM_QUESTIONS; i++) s = run(s, { type: 'fmSubmit', text: topAnswers[i] });
    expect(s.fm!.stage).toBe('review');
    expect(() => reduce(s, { type: 'fmReveal', qi: 0 }, ctx)).toThrow(GameError); // not before confirming
    s = run(s, { type: 'fmConfirm' });
    expect(s.fm!.stage).toBe('reveal');
    expect(() => reduce(s, { type: 'fmNext' }, ctx)).toThrow(/Reveal all/);
    // First tap shows what they said (no points yet), second tap shows the points.
    s = run(s, { type: 'fmReveal', qi: 0 });
    expect(s.fm!.revealed[0][0]).toBe(true);
    expect(s.fm!.scored[0][0]).toBe(false);
    expect(fmTotal(s, 0)).toBe(0);
    s = run(s, { type: 'fmReveal', qi: 0 });
    expect(s.fm!.scored[0][0]).toBe(true);
    expect(fmTotal(s, 0)).toBe(s.fm!.entries[0][0]!.points);
    expect(reduce(s, { type: 'fmReveal', qi: 0 }, ctx).fm).toEqual(s.fm); // nothing left to show
    s = run(s, { type: 'fmReveal', qi: 1 });
    expect(() => reduce(s, { type: 'fmNext' }, ctx)).toThrow(/Reveal all/); // answer shown, points not yet
    s = run(s, { type: 'fmRevealAll' }, { type: 'fmNext' });
    expect(s.fm).toMatchObject({ player: 1, stage: 'answering', qi: 0 });
    // Repeating player 1's answer is not recorded: it bumps `repeats` (the TV plays a sound) and keeps the same question.
    const repeated = reduce(s, { type: 'fmSubmit', text: topAnswers[0] }, ctx);
    expect(repeated.fm).toMatchObject({ qi: 0, stage: 'answering', repeats: 1 });
    expect(repeated.fm!.entries[1][0]).toBeNull();
    expect(repeated.notice).toMatch(/already gave/);
    s = run(s, { type: 'fmSubmit', text: 'zzzz nothing' });
    expect(s.fm!.entries[1][0]).toMatchObject({ answerIndex: null, points: 0 });
    expect(s.fm!.qi).toBe(1);
  });

  it('lets the host retype or re-pick answers after all are in, but not once revealing starts', () => {
    let s = run(toFastMoney(), { type: 'fmBegin' });
    const q = s.fastMoney;
    expect(() => reduce(s, { type: 'fmEdit', qi: 0, text: 'x' }, ctx)).toThrow(/before the reveal/); // still answering
    for (let i = 0; i < FM_QUESTIONS; i++) s = run(s, { type: 'fmSubmit', text: 'zzzz nothing' });
    expect(s.fm!.stage).toBe('review');
    expect(s.fm!.entries[0][0]).toMatchObject({ answerIndex: null, points: 0 });
    // Retype: the new text is matched against the answers again.
    s = run(s, { type: 'fmEdit', qi: 0, text: q[0].answers[1].text });
    expect(s.fm!.entries[0][0]).toMatchObject({ answerIndex: 1, points: q[0].answers[1].points });
    // Re-pick explicitly (and "not on the list").
    s = run(s, { type: 'fmEdit', qi: 1, text: 'my own words', answerIndex: 2 });
    expect(s.fm!.entries[0][1]).toMatchObject({ answerIndex: 2, points: q[1].answers[2].points });
    s = run(s, { type: 'fmEdit', qi: 1, text: 'my own words', answerIndex: null });
    expect(s.fm!.entries[0][1]).toMatchObject({ answerIndex: null, points: 0 });
    expect(() => reduce(s, { type: 'fmEdit', qi: 0, text: 'x', answerIndex: 99 }, ctx)).toThrow(/No such answer/);
    s = run(s, { type: 'fmConfirm' });
    expect(() => reduce(s, { type: 'fmEdit', qi: 0, text: 'x' }, ctx)).toThrow(/before the reveal/);
  });

  it('keeps the no-repeat rule for player 2 when answers are edited', () => {
    let s = run(toFastMoney(), { type: 'fmBegin' });
    for (let i = 0; i < FM_QUESTIONS; i++) s = run(s, { type: 'fmSubmit', text: s.fastMoney[i].answers[0].text });
    s = run(s, { type: 'fmConfirm' }, { type: 'fmRevealAll' }, { type: 'fmNext' });
    for (let i = 0; i < FM_QUESTIONS; i++) s = run(s, { type: 'fmSubmit', text: 'zzzz nothing' });
    expect(s.fm!.stage).toBe('review');
    const repeated = reduce(s, { type: 'fmEdit', qi: 0, text: s.fastMoney[0].answers[0].text }, ctx);
    expect(repeated.fm!.repeats).toBe(1);
    expect(repeated.fm!.entries[1][0]).toMatchObject({ answerIndex: null }); // unchanged
    expect(repeated.notice).toMatch(/already gave/);
  });

  it('allows the host to override the match', () => {
    let s = run(toFastMoney(), { type: 'fmBegin' });
    s = run(s, { type: 'fmSubmit', text: 'something odd', answerIndex: 2 });
    expect(s.fm!.entries[0][0]!.points).toBe(s.fastMoney[0].answers[2].points);
  });
});

describe('view', () => {
  it('never leaks the bank and converts the timer to a remaining duration', () => {
    const s = run(start(), { type: 'startTimer', seconds: 20 });
    const v = toView(s, ctx.now + 5000);
    expect('bank' in v).toBe(false);
    expect(v.timerRemainingMs).toBe(15000);
    expect(v.themes.length).toBe(BUILT_IN_PACKS.length);
  });
});
