import { useMemo, useState } from 'react';
import type { Answer, Difficulty, Question } from '../../shared/types';
import { MAX_ANSWERS, MIN_ANSWERS, sortAnswers, sumPoints, validateQuestion } from '../../shared/validate';
import { uid } from '../../shared/ids';

interface Props {
  packId: string;
  initial: Question | null;
  existingTexts: string[];
  onSave: (q: Question) => void;
  onCancel: () => void;
}

interface Draft { key: string; text: string; points: string; aliases: string }
const blank = (): Draft => ({ key: uid(), text: '', points: '', aliases: '' });

export function QuestionEditor({ packId, initial, existingTexts, onSave, onCancel }: Props) {
  const [text, setText] = useState(initial?.text ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'General');
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? 'easy');
  const [answers, setAnswers] = useState<Draft[]>(
    initial ? initial.answers.map((a) => ({ key: uid(), text: a.text, points: String(a.points), aliases: a.aliases.join(', ') })) : Array.from({ length: MIN_ANSWERS }, blank),
  );
  const [isSurvey, setIsSurvey] = useState(initial?.source.type === 'survey');
  const [srcName, setSrcName] = useState(initial?.source.name ?? '');
  const [srcYear, setSrcYear] = useState(initial?.source.year ? String(initial.source.year) : '');
  const [srcSample, setSrcSample] = useState(initial?.source.sampleSize ? String(initial.source.sampleSize) : '');
  const [tried, setTried] = useState(false);

  const built: Question = useMemo(() => {
    const parsed: Answer[] = answers
      .filter((a) => a.text.trim() || a.points.trim() || a.aliases.trim())
      .map((a) => ({ text: a.text.trim(), points: Number(a.points), aliases: a.aliases.split(',').map((s) => s.trim()).filter(Boolean) }));
    return {
      id: initial?.id ?? `${packId}:${uid()}`,
      themeId: packId,
      text: text.trim(),
      category: category.trim() || 'General',
      difficulty,
      answers: sortAnswers(parsed),
      source: isSurvey
        ? { type: 'survey', name: srcName.trim() || 'Unspecified survey', ...(Number(srcYear) > 0 ? { year: Number(srcYear) } : {}), ...(Number(srcSample) > 0 ? { sampleSize: Number(srcSample) } : {}) }
        : { type: 'estimated', name: srcName.trim() || 'Editorial estimate', note: 'Points are estimated. No real survey was conducted.' },
    };
  }, [answers, text, category, difficulty, isSurvey, srcName, srcYear, srcSample, packId, initial?.id]);

  const issues = validateQuestion(built);
  const dup = existingTexts.some((t) => t.trim().toLowerCase() === built.text.toLowerCase());
  const errors = dup ? [...issues.errors, 'Another question here has the same text.'] : issues.errors;
  const update = (key: string, patch: Partial<Draft>) => setAnswers((as) => as.map((a) => (a.key === key ? { ...a, ...patch } : a)));

  return (
    <div className="modal-bg">
      <div className="modal stack" role="dialog" aria-label="Question editor">
        <div className="row between">
          <h2>{initial ? 'Edit question' : 'New question'}</h2>
          <button onClick={onCancel}>Cancel</button>
        </div>
        <label>
          Question
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Name something people forget at a picnic" autoFocus />
        </label>
        <div className="row">
          <label className="grow">Category<input value={category} onChange={(e) => setCategory(e.target.value)} /></label>
          <label>
            Difficulty
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        </div>
        <div>
          <small>Answers ({MIN_ANSWERS}–{MAX_ANSWERS}), ranked by points. “Also accepts”: comma-separated.</small>
          {answers.map((a, i) => (
            <div key={a.key} className="ae">
              <input value={a.text} onChange={(e) => update(a.key, { text: e.target.value })} placeholder={`Answer ${i + 1}`} aria-label={`Answer ${i + 1}`} />
              <input type="number" min={1} max={100} style={{ width: '100%' }} value={a.points} onChange={(e) => update(a.key, { points: e.target.value })} placeholder="Pts" aria-label={`Points ${i + 1}`} />
              <input value={a.aliases} onChange={(e) => update(a.key, { aliases: e.target.value })} placeholder="Also accepts" aria-label={`Also accepts ${i + 1}`} />
              <button className="link" disabled={answers.length <= 1} onClick={() => setAnswers((as) => as.filter((x) => x.key !== a.key))} aria-label="Remove">✕</button>
            </div>
          ))}
          <div className="row between">
            <button disabled={answers.length >= MAX_ANSWERS} onClick={() => setAnswers((as) => [...as, blank()])}>Add answer</button>
            <small>Total {sumPoints(built) || 0}</small>
          </div>
        </div>
        <div className="stack">
          <label className="inline">
            <input type="checkbox" checked={isSurvey} onChange={(e) => setIsSurvey(e.target.checked)} /> Points come from a real survey
          </label>
          {isSurvey ? (
            <div className="row wrap">
              <label className="grow">Survey name<input value={srcName} onChange={(e) => setSrcName(e.target.value)} /></label>
              <label>Year<input style={{ width: 80 }} value={srcYear} onChange={(e) => setSrcYear(e.target.value)} inputMode="numeric" /></label>
              <label>People<input style={{ width: 80 }} value={srcSample} onChange={(e) => setSrcSample(e.target.value)} inputMode="numeric" /></label>
            </div>
          ) : (
            <small>Labelled “estimated points” in the game.</small>
          )}
        </div>
        {tried && errors.map((e) => <div key={e} className="msg">{e}</div>)}
        {issues.warnings.map((w) => <small key={w}>{w}</small>)}
        <button
          className="primary"
          onClick={() => {
            setTried(true);
            if (!errors.length) onSave(built);
          }}
        >
          Save question
        </button>
      </div>
    </div>
  );
}
