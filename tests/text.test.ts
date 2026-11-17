import { describe, expect, it } from 'vitest';
import { BUILT_IN_PACKS } from '../src/shared/packs';
import { matchAnswer, normalize } from '../src/shared/text';

const q = BUILT_IN_PACKS.find((p) => p.id === 'thanksgiving')!.questions[0]; // foods served

describe('matchAnswer', () => {
  it('matches exact answers and aliases, ignoring case and punctuation', () => {
    expect(matchAnswer(q, 'TURKEY!')).toMatchObject({ index: 0, kind: 'exact' });
    expect(matchAnswer(q, 'dressing')).toMatchObject({ index: 2 });
    expect(matchAnswer(q, 'The Mashed Potatoes')).toMatchObject({ index: 1 });
  });
  it('handles plurals and typos', () => {
    expect(matchAnswer(q, 'cranberries')?.index).toBe(3);
    expect(matchAnswer(q, 'mashed potatos')?.index).toBe(1);
    expect(matchAnswer(q, 'stufing')?.index).toBe(2);
  });
  it('matches longer phrases containing an answer', () => {
    expect(matchAnswer(q, 'a big roasted turkey')?.index).toBe(0);
    expect(matchAnswer(q, 'pumpkin')?.index).toBe(4);
  });
  it('returns null when nothing fits', () => {
    expect(matchAnswer(q, 'sushi')).toBeNull();
    expect(matchAnswer(q, '')).toBeNull();
    expect(matchAnswer(q, 'pi')).toBeNull();
  });
  it('normalises apostrophes and accents', () => {
    expect(normalize("Grandma's House")).toBe('grandmas house');
    expect(normalize('Café')).toBe('cafe');
  });
});
