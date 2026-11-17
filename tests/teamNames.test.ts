import { describe, expect, it } from 'vitest';
import { BUILT_IN_PACKS } from '../src/shared/packs';
import { type GameSettings, FM_QUESTIONS, GameError, initialState } from '../src/shared/game';
import { type Session, newSession, step } from '../src/shared/history';
import { assemblePlan, groupsFor, mulberry32 } from '../src/shared/selection';

const ctx = { rng: mulberry32(1), now: 0 };
function started(): Session {
  const plan = assemblePlan({ groups: groupsFor({ mode: 'single', packId: 'thanksgiving' }, BUILT_IN_PACKS), roundCount: 2, fastMoneyCount: FM_QUESTIONS, rng: mulberry32(2) });
  const settings: GameSettings = { teamNames: ['Team 1', 'Team 2'], roundCount: 2, fastMoneyEnabled: true, mix: {}, themeNames: {}, themeLabel: '' };
  return step(newSession(initialState()), { type: 'startGame', settings, rounds: plan.rounds, fastMoney: plan.fastMoney, bank: BUILT_IN_PACKS.flatMap((p) => p.questions) }, ctx);
}

describe('setTeamNames', () => {
  it('renames teams before the game starts, trimming and falling back for blanks', () => {
    let s = step(started(), { type: 'setTeamNames', names: ['  Grandparents ', '   '] }, ctx);
    expect(s.state.settings.teamNames).toEqual(['Grandparents', 'Team 2']);
    s = step(s, { type: 'setTeamNames', names: ['x'.repeat(40), 'Kids'] }, ctx);
    expect(s.state.settings.teamNames[0]).toHaveLength(24);
  });
  it('is not allowed once the game has begun', () => {
    const s = step(started(), { type: 'begin' }, ctx);
    expect(() => step(s, { type: 'setTeamNames', names: ['A', 'B'] }, ctx)).toThrow(GameError);
  });
  it('keeps the names after a restart', () => {
    let s = step(started(), { type: 'setTeamNames', names: ['Reds', 'Blues'] }, ctx);
    s = step(s, { type: 'begin' }, ctx);
    s = step(s, { type: 'restart' }, ctx);
    expect(s.state.settings.teamNames).toEqual(['Reds', 'Blues']);
  });
});
