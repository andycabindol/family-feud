import { describe, expect, it } from 'vitest';
import { BUILT_IN_PACKS } from '../src/shared/packs';
import { type Action, type GameSettings, FM_QUESTIONS, GameError, initialState } from '../src/shared/game';
import { type Session, newSession, step } from '../src/shared/history';
import { assemblePlan, groupsFor, mulberry32 } from '../src/shared/selection';

const bank = BUILT_IN_PACKS.flatMap((p) => p.questions);
const ctx = { rng: mulberry32(3), now: 1000 };

function started(): Session {
  const groups = groupsFor({ mode: 'single', packId: 'thanksgiving' }, BUILT_IN_PACKS);
  const plan = assemblePlan({ groups, roundCount: 3, fastMoneyCount: FM_QUESTIONS, rng: mulberry32(1) });
  const settings: GameSettings = {
    teamNames: ['A', 'B'], roundCount: 3, fastMoneyEnabled: true, mix: { thanksgiving: 100 },
    themeNames: { thanksgiving: 'Thanksgiving' }, themeLabel: 'Thanksgiving',
  };
  return step(newSession(initialState()), { type: 'startGame', settings, rounds: plan.rounds, fastMoney: plan.fastMoney, bank }, ctx);
}
const run = (s: Session, ...a: Action[]) => a.reduce((x, act) => step(x, act, ctx), s);

describe('undo', () => {
  it('has nothing to undo at the start', () => {
    expect(started().past).toHaveLength(0);
    expect(() => step(started(), { type: 'undo' }, ctx)).toThrow(GameError);
  });

  it('reverts reveals, strikes and awards one step at a time', () => {
    let s = run(started(), { type: 'begin' }, { type: 'reveal', index: 0 }, { type: 'strike' }, { type: 'award', team: 0 });
    expect(s.state.phase).toBe('awarded');
    const score = s.state.scores[0];
    expect(score).toBeGreaterThan(0);
    s = run(s, { type: 'undo' });
    expect(s.state.phase).toBe('round');
    expect(s.state.scores).toEqual([0, 0]);
    expect(s.state.strikes).toBe(1);
    s = run(s, { type: 'undo' });
    expect(s.state.strikes).toBe(0);
    expect(s.state.revealed).toEqual([0]);
    s = run(s, { type: 'undo' });
    expect(s.state.revealed).toEqual([]);
    s = run(s, { type: 'undo' });
    expect(s.state.phase).toBe('intro');
    expect(() => step(s, { type: 'undo' }, ctx)).toThrow(/Nothing to undo/);
  });

  it('keeps versions increasing so clients accept the undone state', () => {
    let s = run(started(), { type: 'begin' }, { type: 'strike' });
    const v = s.state.version;
    s = run(s, { type: 'undo' });
    expect(s.state.version).toBeGreaterThan(v);
  });

  it('does not record timer actions or no-op reveals as steps', () => {
    let s = run(started(), { type: 'begin' }, { type: 'reveal', index: 0 });
    const n = s.past.length;
    s = run(s, { type: 'startTimer', seconds: 20 }, { type: 'stopTimer' }, { type: 'reveal', index: 0 });
    expect(s.past.length).toBe(n);
  });

  it('undoes a theme change on the upcoming question', () => {
    let s = run(started(), { type: 'begin' });
    const before = s.state.rounds[1].id;
    s = run(s, { type: 'rerollUpcoming' });
    expect(s.state.rounds[1].id).not.toBe(before);
    s = run(s, { type: 'undo' });
    expect(s.state.rounds[1].id).toBe(before);
  });
});

describe('restart', () => {
  it('resets scores and progress but keeps the lineup, and clears undo history', () => {
    const base = started();
    let s = run(base, { type: 'begin' }, { type: 'reveal', index: 0 }, { type: 'award', team: 1 });
    expect(s.state.scores[1]).toBeGreaterThan(0);
    s = run(s, { type: 'restart' });
    expect(s.state.phase).toBe('intro');
    expect(s.state.scores).toEqual([0, 0]);
    expect(s.state.roundIndex).toBe(-1);
    expect(s.state.rounds).toEqual(base.state.rounds);
    expect(s.state.fastMoney).toEqual(base.state.fastMoney);
    expect(s.past).toHaveLength(0);
    // And the restarted game plays normally.
    s = run(s, { type: 'begin' });
    expect(s.state.phase).toBe('round');
  });

  it('cannot restart when no game is running', () => {
    expect(() => step(newSession(initialState()), { type: 'restart' }, ctx)).toThrow(GameError);
  });
});

describe('fast money repeats', () => {
  it('repeating player 1\'s answer is not an undo step and records nothing', () => {
    // Play through to player 2's first question.
    let s = started();
    s = run(s, { type: 'begin' });
    for (let r = 0; r < 3; r++) s = run(s, { type: 'award', team: 0 }, { type: 'nextRound' });
    const q = (i: number) => s.state.fastMoney[i].answers[0].text;
    s = run(s, { type: 'fmBegin' });
    for (let i = 0; i < FM_QUESTIONS; i++) s = run(s, { type: 'fmSubmit', text: q(i) });
    s = run(s, { type: 'fmConfirm' }, { type: 'fmRevealAll' }, { type: 'fmNext' });
    expect(s.state.fm).toMatchObject({ player: 1, qi: 0 });
    const n = s.past.length;
    s = run(s, { type: 'fmSubmit', text: q(0) });
    expect(s.state.fm).toMatchObject({ qi: 0, repeats: 1 });
    expect(s.past.length).toBe(n);
    expect(s.state.notice).toMatch(/already gave/);
  });
});
