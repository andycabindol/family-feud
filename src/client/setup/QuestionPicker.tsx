import { useMemo, useState } from 'react';
import type { Pack, Question } from '../../shared/types';
import { isFastMoneyFriendly, questionKey } from '../../shared/validate';
import { QuestionDetails } from '../ui';

interface Props {
  packs: Pack[];
  title: string;
  fastMoney: boolean;
  usedIds: Set<string>;
  usedTexts: Set<string>;
  /** Questions played in earlier games (still allowed, just labelled). */
  playedIds?: Set<string>;
  defaultPackId?: string;
  onPick: (q: Question) => void;
  onClose: () => void;
}

export function QuestionPicker({ packs, title, fastMoney, usedIds, usedTexts, playedIds, defaultPackId, onPick, onClose }: Props) {
  const [packId, setPackId] = useState(defaultPackId ?? 'all');
  const [search, setSearch] = useState('');
  const [onlyFm, setOnlyFm] = useState(fastMoney);
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return packs
      .filter((p) => packId === 'all' || p.id === packId)
      .flatMap((p) => p.questions.map((q) => ({ q, pack: p })))
      .filter(({ q }) => (!s || q.text.toLowerCase().includes(s) || q.answers.some((a) => a.text.toLowerCase().includes(s))) && (!onlyFm || isFastMoneyFriendly(q)));
  }, [packs, packId, search, onlyFm]);

  return (
    <div className="modal-bg">
      <div className="modal stack" role="dialog" aria-label={title}>
        <div className="row between">
          <h2>{title}</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="row wrap">
          <select value={packId} onChange={(e) => setPackId(e.target.value)} aria-label="Theme">
            <option value="all">All themes</option>
            {packs.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input className="grow" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {fastMoney && (
          <label className="inline">
            <input type="checkbox" checked={onlyFm} onChange={(e) => setOnlyFm(e.target.checked)} /> Good Fast Money spread only
          </label>
        )}
        <div>
          {rows.length === 0 && <small>No questions match.</small>}
          {rows.map(({ q, pack }) => {
            const used = usedIds.has(q.id) || usedTexts.has(questionKey(q));
            return (
              <div key={q.id} className={`pick ${used ? 'used' : ''}`}>
                <div className="grow">
                  <div onClick={() => setOpen(open === q.id ? null : q.id)} style={{ cursor: 'pointer', fontWeight: 600 }}>{q.text}</div>
                  <small>{pack.name}{used ? ' · in this game' : playedIds?.has(q.id) ? ' · played before' : ''}</small>
                  {open === q.id && <QuestionDetails q={q} />}
                </div>
                <button disabled={used} onClick={() => onPick(q)}>Use</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
