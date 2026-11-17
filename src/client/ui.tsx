import type { Question } from '../shared/types';
import { describeSource } from '../shared/validate';

export function QuestionDetails({ q, hints = true }: { q: Question; hints?: boolean }) {
  return (
    <div>
      <ol className="answers">
        {q.answers.map((a, i) => (
          <li key={i}>
            {a.text}
            <span className="pts">{a.points}</span>
            {hints && a.aliases.length > 0 && <small> (also: {a.aliases.join(', ')})</small>}
          </li>
        ))}
      </ol>
      <small>
        {q.category} · {q.difficulty} · {describeSource(q.source)}
        {q.source.note ? ` — ${q.source.note}` : ''}
      </small>
    </div>
  );
}
