import { describe, expect, it } from 'vitest';
import { BUILT_IN_PACKS } from '../src/shared/packs';
import {
  allocate, assembleAvoiding, assemblePlan, candidates, evenMix, groupsFor, mulberry32, pickReplacement, planIds, planTexts, setMixPercent, toggleMixKey,
} from '../src/shared/selection';
import { isFastMoneyFriendly, questionKey } from '../src/shared/validate';

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe('setMixPercent', () => {
  it('keeps the total at 100', () => {
    const next = setMixPercent({ a: 60, b: 40 }, 'a', 70);
    expect(next).toEqual({ a: 70, b: 30 });
    const three = setMixPercent({ a: 50, b: 30, c: 20 }, 'a', 80);
    expect(sum(three)).toBe(100);
    expect(three.a).toBe(80);
    expect(three.b).toBeGreaterThan(three.c);
  });
  it('handles a single key and zero others', () => {
    expect(setMixPercent({ a: 40 }, 'a', 10)).toEqual({ a: 100 });
    expect(sum(setMixPercent({ a: 100, b: 0, c: 0 }, 'a', 40))).toBe(100);
  });
  it('toggling keys renormalises', () => {
    const added = toggleMixKey({ a: 60, b: 40 }, 'c', true);
    expect(sum(added)).toBe(100);
    expect(added.c).toBeGreaterThan(0);
    const removed = toggleMixKey(added, 'c', false);
    expect(sum(removed)).toBe(100);
    expect(Object.keys(removed)).toEqual(['a', 'b']);
    expect(sum(evenMix(['x', 'y', 'z']))).toBe(100);
  });
});

describe('allocate', () => {
  const rng = mulberry32(1);
  it('splits proportionally', () => {
    expect(allocate(10, [{ weight: 60, capacity: 99 }, { weight: 40, capacity: 99 }], rng)).toEqual([6, 4]);
    expect(allocate(5, [{ weight: 60, capacity: 99 }, { weight: 40, capacity: 99 }], rng)).toEqual([3, 2]);
  });
  it('spills over when a group is out of questions', () => {
    expect(allocate(10, [{ weight: 60, capacity: 2 }, { weight: 40, capacity: 99 }], rng)).toEqual([2, 8]);
  });
  it('never exceeds total capacity', () => {
    expect(allocate(10, [{ weight: 1, capacity: 2 }, { weight: 1, capacity: 3 }], rng)).toEqual([2, 3]);
  });
  it('always allocates exactly `total` when capacity allows', () => {
    for (let seed = 0; seed < 50; seed++) {
      const r = mulberry32(seed);
      const slots = [{ weight: 33, capacity: 9 }, { weight: 33, capacity: 9 }, { weight: 34, capacity: 9 }];
      for (let n = 1; n <= 20; n++) expect(allocate(n, slots, r).reduce((a, b) => a + b, 0)).toBe(n);
    }
  });
});

describe('assemblePlan', () => {
  const groups = groupsFor({ mode: 'mixed', weights: { thanksgiving: 60, general: 40 } }, BUILT_IN_PACKS);

  it('mixes themes by percentage across rounds and Fast Money', () => {
    const plan = assemblePlan({ groups, roundCount: 5, fastMoneyCount: 5, rng: mulberry32(7) });
    expect(plan.rounds).toHaveLength(5);
    expect(plan.fastMoney).toHaveLength(5);
    // 5 FM @ 60/40 -> 3 / 2
    expect(plan.fastMoney.filter((q) => q.themeId === 'thanksgiving')).toHaveLength(3);
    expect(plan.fastMoney.filter((q) => q.themeId === 'general')).toHaveLength(2);
    // 5 rounds @ 60/40 -> 3 / 2
    expect(plan.rounds.filter((q) => q.themeId === 'thanksgiving')).toHaveLength(3);
  });

  it('never repeats a question across rounds and Fast Money', () => {
    for (let seed = 0; seed < 100; seed++) {
      const plan = assemblePlan({ groups, roundCount: 8, fastMoneyCount: 5, rng: mulberry32(seed) });
      const all = [...plan.rounds, ...plan.fastMoney];
      expect(new Set(all.map((q) => q.id)).size).toBe(all.length);
      expect(new Set(all.map(questionKey)).size).toBe(all.length);
      expect(all).toHaveLength(13);
    }
  });

  it('prefers Fast Money questions with a good answer spread', () => {
    for (let seed = 0; seed < 50; seed++) {
      const plan = assemblePlan({ groups, roundCount: 4, fastMoneyCount: 5, rng: mulberry32(seed) });
      expect(plan.fastMoney.every(isFastMoneyFriendly)).toBe(true);
      expect(plan.warnings).toEqual([]);
    }
  });

  it('single theme only uses that theme', () => {
    const g = groupsFor({ mode: 'single', packId: 'thanksgiving' }, BUILT_IN_PACKS);
    const plan = assemblePlan({ groups: g, roundCount: 8, fastMoneyCount: 5, rng: mulberry32(3) });
    expect([...plan.rounds, ...plan.fastMoney].every((q) => q.themeId === 'thanksgiving')).toBe(true);
  });

  it('warns when a theme is too small', () => {
    const small = [{ key: 's', label: 's', weight: 1, questions: BUILT_IN_PACKS[0].questions.slice(0, 3) }];
    const plan = assemblePlan({ groups: small, roundCount: 4, fastMoneyCount: 5, rng: mulberry32(1) });
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.rounds.length + plan.fastMoney.length).toBe(3);
    // Rounds take priority over Fast Money when themes are tiny.
    expect(plan.rounds.length).toBe(3);
    expect(plan.fastMoney.length).toBe(0);
  });

  it('honours exclusions', () => {
    const first = assemblePlan({ groups, roundCount: 4, fastMoneyCount: 5, rng: mulberry32(5) });
    const used = [...first.rounds, ...first.fastMoney].map((q) => q.id);
    const second = assemblePlan({ groups, roundCount: 4, fastMoneyCount: 5, rng: mulberry32(5), exclude: used });
    for (const q of [...second.rounds, ...second.fastMoney]) expect(used).not.toContain(q.id);
  });
});

describe('replacement', () => {
  it('never offers a question already in the plan', () => {
    const groups = groupsFor({ mode: 'single', packId: 'thanksgiving' }, BUILT_IN_PACKS);
    const plan = assemblePlan({ groups, roundCount: 4, fastMoneyCount: 5, rng: mulberry32(2) });
    const ids = planIds(plan);
    const texts = planTexts(plan);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const q = pickReplacement({ groups, excludeIds: ids, excludeTexts: texts, rng: mulberry32(i) })!;
      expect(ids.has(q.id)).toBe(false);
      seen.add(q.id);
    }
    expect(seen.size).toBeGreaterThan(5);
    const fm = candidates({ groups, excludeIds: ids, excludeTexts: texts, fastMoney: true });
    expect(fm.every(isFastMoneyFriendly)).toBe(true);
  });
});

describe('assembleAvoiding (played questions)', () => {
  const groups = groupsFor({ mode: 'single', packId: 'thanksgiving' }, BUILT_IN_PACKS);
  const all = groups[0].questions;

  it('takes no played questions while enough unplayed ones remain', () => {
    const played = all.slice(0, 10).map((q) => q.id);
    const plan = assembleAvoiding({ groups, roundCount: 4, fastMoneyCount: 5, rng: mulberry32(7), played });
    expect(plan.rounds).toHaveLength(4);
    expect(plan.fastMoney).toHaveLength(5);
    expect(plan.repeats).toBe(0);
    for (const q of [...plan.rounds, ...plan.fastMoney]) expect(played).not.toContain(q.id);
  });

  it('falls back to played questions only when the unplayed pool runs out, and says so', () => {
    const played = all.slice(0, all.length - 3).map((q) => q.id); // only 3 unplayed left
    const plan = assembleAvoiding({ groups, roundCount: 4, fastMoneyCount: 5, rng: mulberry32(7), played });
    const ids = [...plan.rounds, ...plan.fastMoney].map((q) => q.id);
    expect(plan.rounds).toHaveLength(4);
    expect(plan.fastMoney).toHaveLength(5);
    expect(new Set(ids).size).toBe(ids.length); // no question used twice in one game
    expect(plan.repeats).toBe(ids.filter((id) => played.includes(id)).length);
    expect(plan.repeats).toBeGreaterThan(0);
    expect(plan.warnings.join(' ')).toMatch(/earlier game/);
  });
});
