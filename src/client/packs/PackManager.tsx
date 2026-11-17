import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pack, Question } from '../../shared/types';
import { BUILT_IN_PACKS } from '../../shared/packs';
import {
  CSV_TEMPLATE, type ImportResult, importText, materializeQuestions, newPackId, packToJson, questionsToCsv,
} from '../../shared/importExport';
import { questionKey } from '../../shared/validate';
import { api, download } from '../api';
import { Link } from '../App';
import { QuestionDetails } from '../ui';
import { QuestionEditor } from './QuestionEditor';

export function PackManager() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ question: Question | null } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [openQ, setOpenQ] = useState<string | null>(null);

  const flash = (kind: 'ok' | 'error', text: string) => {
    setMessage({ kind, text });
    setTimeout(() => setMessage((m) => (m?.text === text ? null : m)), 5000);
  };

  useEffect(() => {
    api
      .listPacks()
      .then((p) => {
        setPacks(p);
        setSelected((s) => s ?? p[0]?.id ?? BUILT_IN_PACKS[0].id);
      })
      .catch((e) => flash('error', (e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const all = useMemo(() => [...packs, ...BUILT_IN_PACKS], [packs]);
  const pack = all.find((p) => p.id === selected) ?? null;

  /** Saves to the server and updates local state. */
  const persist = async (p: Pack, okText?: string): Promise<boolean> => {
    try {
      const saved = await api.savePack(p);
      setPacks((ps) => [...ps.filter((x) => x.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      if (okText) flash('ok', okText);
      return true;
    } catch (e) {
      flash('error', `Not saved: ${(e as Error).message}`);
      return false;
    }
  };

  const createPack = async (name: string, questions: Question[] = [], description = '') => {
    const id = newPackId(name);
    const p: Pack = { id, name: name.trim(), description, builtIn: false, questions: questions.map((q) => ({ ...q, themeId: id, id: `${id}:${q.id.split(':').pop()}` })), updatedAt: Date.now() };
    if (await persist(p, `Created “${p.name}”.`)) setSelected(id);
  };

  const duplicateBuiltIn = (src: Pack) => createPack(`${src.name} (my copy)`, src.questions, src.description);

  const removePack = async (p: Pack) => {
    if (!confirm(`Delete the pack “${p.name}” and its ${p.questions.length} questions? This can’t be undone.`)) return;
    try {
      await api.deletePack(p.id);
      setPacks((ps) => ps.filter((x) => x.id !== p.id));
      setSelected(packs.find((x) => x.id !== p.id)?.id ?? BUILT_IN_PACKS[0].id);
      flash('ok', 'Pack deleted.');
    } catch (e) {
      flash('error', (e as Error).message);
    }
  };

  const saveQuestion = async (q: Question) => {
    if (!pack || pack.builtIn) return;
    const exists = pack.questions.some((x) => x.id === q.id);
    const questions = exists ? pack.questions.map((x) => (x.id === q.id ? q : x)) : [...pack.questions, q];
    if (await persist({ ...pack, questions, updatedAt: Date.now() }, 'Question saved.')) setEditing(null);
  };

  const deleteQuestion = async (q: Question) => {
    if (!pack || pack.builtIn || !confirm(`Delete “${q.text}”?`)) return;
    await persist({ ...pack, questions: pack.questions.filter((x) => x.id !== q.id), updatedAt: Date.now() }, 'Question deleted.');
  };

  return (
    <div className="page stack">
      <header>
        <h1>Question packs</h1>
        <Link to="/host">← Host</Link>
      </header>
      {message && <div className="msg">{message.text}</div>}

      <label>
        Pack
        <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
          {packs.length > 0 && (
            <optgroup label="My packs">
              {packs.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.questions.length})</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Built-in (read-only)">
            {BUILT_IN_PACKS.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.questions.length})</option>
            ))}
          </optgroup>
        </select>
      </label>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) {
            createPack(newName);
            setNewName('');
          }
        }}
      >
        <input className="grow" placeholder="New pack name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button disabled={!newName.trim()}>Create</button>
        <button type="button" onClick={() => setShowImport(true)}>Import</button>
      </form>

      {loading && <small>Loading…</small>}

      {pack && (
        <div>
          {pack.builtIn ? (
            <h2>{pack.name}</h2>
          ) : (
            <PackHeader key={pack.id} pack={pack} onChange={(patch) => persist({ ...pack, ...patch, updatedAt: Date.now() }, 'Saved.')} />
          )}
          <div className="row wrap" style={{ margin: '10px 0' }}>
            {pack.builtIn ? (
              <button onClick={() => duplicateBuiltIn(pack)}>Make editable copy</button>
            ) : (
              <button className="primary" onClick={() => setEditing({ question: null })}>Add question</button>
            )}
            <button onClick={() => download(`${pack.name}.json`, packToJson(pack), 'application/json')}>JSON</button>
            <button onClick={() => download(`${pack.name}.csv`, questionsToCsv(pack.name, pack.questions), 'text/csv')}>CSV</button>
            {!pack.builtIn && <button onClick={() => removePack(pack)}>Delete pack</button>}
          </div>
          {pack.questions.length === 0 && <small>No questions yet.</small>}
          {pack.questions.map((q) => (
            <div key={q.id} className="q-row">
              <div style={{ fontWeight: 600, cursor: 'pointer' }} onClick={() => setOpenQ(openQ === q.id ? null : q.id)}>{q.text}</div>
              {openQ === q.id && <QuestionDetails q={q} />}
              {!pack.builtIn && (
                <div className="row" style={{ marginTop: 6 }}>
                  <button onClick={() => setEditing({ question: q })}>Edit</button>
                  <button className="link" onClick={() => deleteQuestion(q)}>Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && pack && !pack.builtIn && (
        <QuestionEditor
          packId={pack.id}
          initial={editing.question}
          existingTexts={pack.questions.filter((q) => q.id !== editing.question?.id).map((q) => q.text)}
          onSave={saveQuestion}
          onCancel={() => setEditing(null)}
        />
      )}

      {showImport && (
        <ImportPanel
          packs={packs}
          targetId={pack && !pack.builtIn ? pack.id : null}
          onClose={() => setShowImport(false)}
          onImport={async (targetId, newPackName, questions) => {
            if (targetId) {
              const target = packs.find((p) => p.id === targetId)!;
              const have = new Set(target.questions.map(questionKey));
              const fresh = questions.filter((q) => !have.has(questionKey(q))).map((q) => ({ ...q, themeId: target.id, id: `${target.id}:${q.id.split(':').pop()}` }));
              const ok = await persist({ ...target, questions: [...target.questions, ...fresh], updatedAt: Date.now() }, `Imported ${fresh.length} question(s)${fresh.length < questions.length ? `, ${questions.length - fresh.length} duplicates skipped` : ''}.`);
              if (ok) setSelected(target.id);
              return ok;
            }
            await createPack(newPackName, questions);
            return true;
          }}
        />
      )}
    </div>
  );
}

function PackHeader({ pack, onChange }: { pack: Pack; onChange: (patch: Partial<Pack>) => void }) {
  const [name, setName] = useState(pack.name);
  const [desc, setDesc] = useState(pack.description);
  return (
    <div className="stack">
      <input className="h-input" style={{ width: '100%', fontWeight: 700 }} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== pack.name && onChange({ name: name.trim() })} aria-label="Pack name" />
      <input style={{ width: '100%' }} value={desc} placeholder="Description (optional)" onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== pack.description && onChange({ description: desc })} aria-label="Description" />
    </div>
  );
}

function ImportPanel({
  packs, targetId, onClose, onImport,
}: {
  packs: Pack[];
  targetId: string | null;
  onClose: () => void;
  onImport: (targetId: string | null, newPackName: string, questions: Question[]) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [target, setTarget] = useState<string>(targetId ?? 'new');
  const [newName, setNewName] = useState('Imported pack');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parse = (t: string, filename?: string) => {
    const r = importText(t);
    setResult(r);
    const fromFile = r.items.find((i) => i.packName)?.packName ?? filename?.replace(/\.[^.]+$/, '');
    if (fromFile) setNewName(fromFile);
  };

  return (
    <div className="modal-bg">
      <div className="modal stack" role="dialog" aria-label="Import questions">
        <div className="row between">
          <h2>Import</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <small>JSON or CSV (columns: question, answer, points; optional category, difficulty, aliases separated by |, source_*).</small>
        <div className="row wrap">
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv,.txt,application/json,text/csv"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const t = await f.text();
              setText(t);
              parse(t, f.name);
            }}
          />
          <button className="link" onClick={() => download('question-pack-template.csv', CSV_TEMPLATE, 'text/csv')}>CSV template</button>
        </div>
        <textarea rows={7} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste here" />
        <button onClick={() => parse(text)} disabled={!text.trim()}>Check</button>

        {result && (
          <div className="stack">
            {result.warnings.map((w) => <div key={w} className="msg">{w}</div>)}
            <div>{result.items.length} ready{result.rejected.length > 0 && `, ${result.rejected.length} skipped`}</div>
            {result.rejected.length > 0 && (
              <details>
                <summary>Why skipped</summary>
                <ul>
                  {result.rejected.map((r, i) => (
                    <li key={i}>{r.label}: {r.reasons.join(' ')}</li>
                  ))}
                </ul>
              </details>
            )}
            {result.items.length > 0 && (
              <>
                <label>
                  Add to
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="new">New pack</option>
                    {packs.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                {target === 'new' && (
                  <label>
                    New pack name
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} />
                  </label>
                )}
                <button
                  className="primary"
                  disabled={busy || (target === 'new' && !newName.trim())}
                  onClick={async () => {
                    setBusy(true);
                    const ok = await onImport(target === 'new' ? null : target, newName, materializeQuestions(target === 'new' ? 'tmp' : target, result.items));
                    setBusy(false);
                    if (ok) onClose();
                  }}
                >
                  Import {result.items.length} question(s)
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
