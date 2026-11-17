import { describe, expect, it } from 'vitest';
import { CSV_TEMPLATE, importCsv, importJson, importText, packToJson, parseCsv, questionsToCsv } from '../src/shared/importExport';
import { BUILT_IN_PACKS } from '../src/shared/packs';

describe('CSV', () => {
  it('parses quotes, commas and newlines in fields', () => {
    expect(parseCsv('a,"b,c","d ""e"""\n1,2,3\r\n')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });

  it('imports the template', () => {
    const r = importCsv(CSV_TEMPLATE);
    expect(r.rejected).toEqual([]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].question.answers).toHaveLength(5);
    expect(r.items[0].question.answers[0]).toMatchObject({ text: 'Blanket', points: 30, aliases: ['towel', 'quilt'] });
    expect(r.items[0].packName).toBe('My Pack');
  });

  it('round-trips built-in questions', () => {
    const qs = BUILT_IN_PACKS[1].questions.slice(0, 5);
    const r = importCsv(questionsToCsv('X', qs));
    expect(r.rejected).toEqual([]);
    expect(r.items.map((i) => i.question.text)).toEqual(qs.map((q) => q.text));
    expect(r.items[0].question.answers).toEqual(qs[0].answers);
    expect(r.items[0].question.source.type).toBe('estimated');
  });

  it('rejects questions with too few answers and says why', () => {
    const r = importCsv('question,answer,points\nName a color,Red,50\nName a color,Blue,30\n');
    expect(r.items).toHaveLength(0);
    expect(r.rejected[0].reasons.join(' ')).toMatch(/4–8 answers/);
  });

  it('flags a missing header', () => {
    expect(importCsv('foo,bar\n1,2').warnings.length).toBe(1);
  });
});

describe('JSON', () => {
  it('imports a pack with loose field names and sorts answers', () => {
    const r = importJson(
      JSON.stringify({
        name: 'Loose',
        questions: [
          {
            question: 'Name a fruit',
            difficulty: 'Easy',
            source: { type: 'survey', name: 'Fam poll', year: 2024, sampleSize: 40 },
            answers: [
              { answer: 'Pear', points: 10 },
              { answer: 'Apple', points: 40, accepted: 'apples|red apple' },
              { answer: 'Banana', points: 25 },
              { answer: 'Grapes', points: 15, aliases: ['grape'] },
            ],
          },
        ],
      }),
    );
    expect(r.rejected).toEqual([]);
    const q = r.items[0].question;
    expect(r.items[0].packName).toBe('Loose');
    expect(q.answers.map((a) => a.text)).toEqual(['Apple', 'Banana', 'Grapes', 'Pear']);
    expect(q.answers[0].aliases).toEqual(['apples', 'red apple']);
    expect(q.source).toMatchObject({ type: 'survey', year: 2024, sampleSize: 40 });
    expect(q.difficulty).toBe('easy');
  });

  it('round-trips a pack through packToJson', () => {
    const pack = BUILT_IN_PACKS[1];
    const r = importText(packToJson(pack));
    expect(r.rejected).toEqual([]);
    expect(r.items).toHaveLength(pack.questions.length);
  });

  it('reports bad JSON and bad shapes', () => {
    expect(importJson('{nope').warnings[0]).toMatch(/Not valid JSON/);
    expect(importJson('{"a":1}').warnings).toHaveLength(1);
  });

  it('labels missing sources as estimated, never as a survey', () => {
    const r = importJson(
      JSON.stringify([{ text: 'Q?', answers: [{ text: 'a', points: 5 }, { text: 'b', points: 4 }, { text: 'c', points: 3 }, { text: 'd', points: 2 }] }]),
    );
    expect(r.items[0].question.source.type).toBe('estimated');
  });

  it('auto-detects the format', () => {
    expect(importText('question,answer,points\n').warnings.length).toBe(1);
    expect(importText('').warnings[0]).toBe('Nothing to import.');
  });
});
