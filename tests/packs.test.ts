import { describe, expect, it } from 'vitest';
import { BUILT_IN_PACKS } from '../src/shared/packs';
import { isFastMoneyFriendly, sumPoints, validateQuestion } from '../src/shared/validate';
import { questionKey } from '../src/shared/validate';

describe('built-in packs', () => {
  it('includes all requested themes', () => {
    expect(BUILT_IN_PACKS.map((p) => p.id).sort()).toEqual(
      ['christmas', 'family', 'food', 'general', 'kids', 'popculture', 'thanksgiving'],
    );
  });

  it('has at least 30 Thanksgiving questions', () => {
    const t = BUILT_IN_PACKS.find((p) => p.id === 'thanksgiving')!;
    expect(t.questions.length).toBeGreaterThanOrEqual(30);
  });

  for (const pack of BUILT_IN_PACKS) {
    describe(pack.name, () => {
      it('has enough questions for a full game', () => {
        expect(pack.questions.length).toBeGreaterThanOrEqual(14);
        // 5 Fast Money + at least a handful of rounds, all unique.
        expect(pack.questions.filter(isFastMoneyFriendly).length).toBeGreaterThanOrEqual(7);
      });

      it('has valid, ranked, estimated-source questions', () => {
        const problems: string[] = [];
        for (const q of pack.questions) {
          const { errors } = validateQuestion(q);
          errors.forEach((e) => problems.push(`${q.id}: ${e}`));
          if (q.answers.length < 4 || q.answers.length > 8) problems.push(`${q.id}: answer count`);
          if (sumPoints(q) > 100) problems.push(`${q.id}: points sum ${sumPoints(q)} > 100`);
          if (sumPoints(q) < 50) problems.push(`${q.id}: points sum ${sumPoints(q)} < 50`);
          q.answers.forEach((a, i) => {
            if (i && q.answers[i - 1].points < a.points) problems.push(`${q.id}: not ranked`);
          });
          if (q.source.type !== 'estimated') problems.push(`${q.id}: built-in sources must be labelled estimated`);
          if (!q.category || !q.difficulty) problems.push(`${q.id}: missing category/difficulty`);
          if (q.themeId !== pack.id) problems.push(`${q.id}: wrong themeId`);
        }
        expect(problems).toEqual([]);
      });
    });
  }

  it('has globally unique ids and question text', () => {
    const ids = new Set<string>();
    const texts = new Set<string>();
    for (const q of BUILT_IN_PACKS.flatMap((p) => p.questions)) {
      expect(ids.has(q.id)).toBe(false);
      expect(texts.has(questionKey(q))).toBe(false);
      ids.add(q.id);
      texts.add(questionKey(q));
    }
  });
});
