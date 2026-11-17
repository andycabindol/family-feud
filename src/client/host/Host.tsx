import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { savePin, useGame } from '../net';
import { FM_TARGET, MAX_STRIKES, fmTotal, type GameView } from '../../shared/game';
import { matchAnswer } from '../../shared/text';
import { QuestionDetails } from '../ui';
import { Setup } from '../setup/Setup';

type Send = ReturnType<typeof useGame>['send'];

export function Host() {
  const conn = useGame('host');
  const { view: v, send } = conn;

  if (conn.needsPin) return <PinGate error={conn.error?.message} />;

  return (
    <div className="host">
      {v && v.phase !== 'setup' ? (
        <>
          <Top v={v} />
          <div className="h-body">
            {v.notice && <div className="msg" style={{ marginBottom: 12 }}>{v.notice}</div>}
            {v.phase === 'intro' && <Intro v={v} send={send} />}
            {(v.phase === 'round' || v.phase === 'awarded') && <Round v={v} send={send} />}
            {v.phase === 'fastmoney' && <FastMoney v={v} send={send} />}
            {v.phase === 'final' && <Final v={v} send={send} />}
            {(v.phase === 'round' || v.phase === 'awarded') && <Next v={v} send={send} />}
            <Scores v={v} send={send} />
            <Controls v={v} send={send} />
          </div>
        </>
      ) : v ? (
        <Setup conn={conn} />
      ) : (
        <div className="h-body">
          <h2>{conn.connected ? 'Loading…' : 'Connecting…'}</h2>
        </div>
      )}
      {!conn.connected && <div className="toast" style={{ bottom: 100 }}>Reconnecting…</div>}
      {conn.error && <div className="toast">{conn.error.message}</div>}
    </div>
  );
}

/** Shown when the server has a HOST_PIN and this phone hasn't entered it (or entered it wrong). */
function PinGate({ error }: { error?: string }) {
  const [pin, setPin] = useState('');
  const submit = () => {
    if (!pin.trim()) return;
    savePin(pin.trim());
    location.reload();
  };
  return (
    <div className="host">
      <div className="h-body stack">
        <h2>Host PIN</h2>
        <input
          className="h-input"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          value={pin}
          placeholder="Enter PIN"
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {error && <div className="msg">{error}</div>}
        <button className="primary" style={{ minHeight: 52 }} onClick={submit}>Continue</button>
      </div>
    </div>
  );
}

function Top({ v }: { v: GameView }) {
  return (
    <div className="h-top">
      <span>{v.settings.teamNames[0]}<b>{v.scores[0]}</b></span>
      <small>
        {v.phase === 'fastmoney' ? 'Fast Money' : v.roundIndex >= 0 ? `R${v.roundIndex + 1}/${v.rounds.length}${v.multiplier > 1 ? ` ×${v.multiplier}` : ''} · pot ${v.pot}` : ''}
      </small>
      <span><b>{v.scores[1]}</b>{v.settings.teamNames[1]}</span>
    </div>
  );
}

function Bar({ children }: { children: React.ReactNode }) {
  return <div className="h-bar">{children}</div>;
}

function Intro({ v, send }: { v: GameView; send: Send }) {
  const current = v.settings.teamNames;
  const [names, setNames] = useState<[string, string]>([current[0], current[1]]);
  // Stay in sync if names change elsewhere (e.g. after a restart or another device).
  useEffect(() => setNames([current[0], current[1]]), [current[0], current[1]]);
  const dirty = names[0].trim() !== current[0] || names[1].trim() !== current[1];
  const save = () => dirty && send({ type: 'setTeamNames', names });
  // The first question stays hidden from the TV until "Start round 1".
  const first = v.upcoming && v.upcoming.kind === 'round' ? v.rounds[v.upcoming.index] : null;

  return (
    <>
      <small>{v.settings.themeLabel} · {v.rounds.length} rounds</small>
      {first && (
        <section className="h-first">
          <small>Round 1 · {v.settings.themeNames[first.themeId]} · not on the main screen yet</small>
          <div className="h-q">{first.text}</div>
          <QuestionDetails q={first} hints={false} />
          <ChangeNext v={v} send={send} />
        </section>
      )}
      <div className="row">
        {[0, 1].map((i) => (
          <label key={i} className="grow">
            Team {i + 1} name (optional)
            <input
              className="h-input"
              value={names[i]}
              maxLength={24}
              autoCapitalize="words"
              enterKeyHint="done"
              onChange={(e) => setNames((n) => (i === 0 ? [e.target.value, n[1]] : [n[0], e.target.value]))}
              onBlur={save}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
        ))}
      </div>
      <Bar>
        <button
          className="primary"
          onClick={() => {
            save();
            send({ type: 'begin' });
          }}
        >
          Start round 1
        </button>
      </Bar>
    </>
  );
}

function Round({ v, send }: { v: GameView; send: Send }) {
  const q = v.rounds[v.roundIndex];
  const awarded = v.phase === 'awarded';
  const last = v.roundIndex + 1 >= v.rounds.length;
  return (
    <>
      <div className="h-q">{q.text}</div>
      <div className="h-list">
        {q.answers.map((a, i) => {
          const done = v.revealed.includes(i);
          return (
            <button key={i} className={`h-item ${done ? 'done' : ''}`} disabled={done || awarded} onClick={() => send({ type: 'reveal', index: i })}>
              <span className="n">{i + 1}</span>
              <span className="t">{a.text}</span>
              <span>{a.points}</span>
            </button>
          );
        })}
      </div>
      <Bar>
        {awarded ? (
          <button className="primary" onClick={() => send({ type: 'nextRound' })}>
            {last ? (v.settings.fastMoneyEnabled ? 'Fast Money' : 'Finish') : `Round ${v.roundIndex + 2}`}
          </button>
        ) : (
          <>
            <button disabled={v.strikes >= MAX_STRIKES} onClick={() => send({ type: 'strike' })}>✕ {v.strikes}/{MAX_STRIKES}</button>
            {[0, 1].map((t) => (
              <button key={t} className="primary" onClick={() => send({ type: 'award', team: t as 0 | 1 })}>
                → {v.settings.teamNames[t]}
              </button>
            ))}
          </>
        )}
      </Bar>
    </>
  );
}

/** Theme picker + "different question" for the upcoming question. */
function ChangeNext({ v, send }: { v: GameView; send: Send }) {
  const mixed = Object.keys(v.settings.mix).length > 1;
  return (
    <>
      <select
        value=""
        aria-label="Change theme of next question"
        onChange={(e) => e.target.value && send({ type: 'setUpcomingTheme', themeId: e.target.value })}
      >
        <option value="">Change theme…</option>
        {mixed && <option value="mix">Mixed (game mix)</option>}
        {v.themes.map((t) => (
          <option key={t.id} value={t.id} disabled={t.remaining === 0}>{t.name} ({t.remaining})</option>
        ))}
      </select>
      <button onClick={() => send({ type: 'rerollUpcoming' })}>Different question</button>
    </>
  );
}

/** Change the theme of the NEXT question without touching the live round. */
function Next({ v, send }: { v: GameView; send: Send }) {
  const up = v.upcoming;
  if (!up) return null;
  const isRound = up.kind === 'round';
  const q = isRound ? v.rounds[up.index] : null;
  return (
    <details className="h-next">
      <summary>
        Next: {isRound ? `Round ${up.index + 1}` : 'Fast Money'} · {q ? v.settings.themeNames[q.themeId] : 'all 5'}
      </summary>
      {q ? <div style={{ margin: '4px 0' }}>{q.text}</div> : (
        <ol className="answers">{v.fastMoney.map((f) => <li key={f.id}>{f.text}</li>)}</ol>
      )}
      <ChangeNext v={v} send={send} />
      {q && (
        <details>
          <summary>Answers</summary>
          <QuestionDetails q={q} hints={false} />
        </details>
      )}
    </details>
  );
}

function FastMoney({ v, send }: { v: GameView; send: Send }) {
  const fm = v.fm!;
  const [text, setText] = useState('');
  const q = v.fastMoney[Math.min(fm.qi, v.fastMoney.length - 1)];
  const guess = useMemo(() => (text.trim() && fm.stage === 'answering' ? matchAnswer(q, text) : null), [text, q, fm.stage]);
  const taken = fm.player === 1 ? fm.entries[0][fm.qi]?.answerIndex : undefined;
  useEffect(() => setText(''), [fm.qi, fm.player]);

  if (fm.stage === 'intro') return <FmIntro v={v} send={send} />;
  if (fm.stage === 'review') return <FmReview v={v} send={send} />;

  if (fm.stage === 'reveal') {
    const allShown = fm.scored[fm.player].every(Boolean);
    return (
      <>
        <small>Player {fm.player + 1} · total {fmTotal(v, fm.player)} · both {fmTotal(v, 0) + fmTotal(v, 1)}/{FM_TARGET}</small>
        <p style={{ margin: '4px 0 0' }}>Tap an answer once to show what they said, tap it again to show the points.</p>
        <div className="h-list" style={{ marginTop: 8 }}>
          {v.fastMoney.map((f, i) => {
            const e = fm.entries[fm.player][i]!;
            const said = fm.revealed[fm.player][i];
            const done = fm.scored[fm.player][i];
            return (
              <button key={f.id} className={`h-item ${done ? 'done' : ''}`} disabled={done} onClick={() => send({ type: 'fmReveal', qi: i })}>
                <span className="n">{i + 1}</span>
                <span className="t">
                  {e.answerIndex !== null ? f.answers[e.answerIndex].text : e.text || 'No answer'}
                  <small>{f.text}</small>
                  {said && !done && <small>Answer shown · tap for points</small>}
                </span>
                <span>{done ? e.points : said ? '…' : ''}</span>
              </button>
            );
          })}
        </div>
        <Bar>
          <button disabled={allShown} onClick={() => send({ type: 'fmRevealAll' })}>Reveal all</button>
          <button className="primary" disabled={!allShown} onClick={() => send({ type: 'fmNext' })}>{fm.player === 0 ? 'Player 2' : 'Finish'}</button>
        </Bar>
      </>
    );
  }

  const secs = fm.player === 0 ? 20 : 25;
  const pick = (i: number) => send({ type: 'fmSubmit', text: q.answers[i].text, answerIndex: i });
  return (
    <>
      <small>Player {fm.player + 1} · question {fm.qi + 1}/{v.fastMoney.length}</small>
      <div className="h-q">{q.text}</div>
      <div className="h-list">
        {q.answers.map((a, i) => (
          <button key={i} className="h-item" onClick={() => pick(i)}>
            <span className="n">{i + 1}</span>
            <span className="t">{a.text}{taken === i && <small>Player 1 said this · tap for “try again”</small>}</span>
            <span>{a.points}</span>
          </button>
        ))}
        <button className="h-item" onClick={() => send({ type: 'fmSubmit', text: text.trim(), answerIndex: null })}>
          <span className="t">{text.trim() ? `Not on list: “${text.trim()}” (0)` : 'No answer / not on list (0)'}</span>
        </button>
      </div>
      <details style={{ marginTop: 12 }}>
        <summary>Type what they said</summary>
        <input className="h-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Their answer" autoCapitalize="off" autoCorrect="off" />
        {guess && (
          <button style={{ width: '100%', minHeight: 48, marginTop: 8 }} onClick={() => pick(guess.index)}>
            Looks like {q.answers[guess.index].text} ({q.answers[guess.index].points}), use it
          </button>
        )}
      </details>
      <Bar>
        <button onClick={() => send(v.timerRemainingMs !== null ? { type: 'stopTimer' } : { type: 'startTimer', seconds: secs })}>
          {v.timerRemainingMs !== null ? 'Stop timer' : `Start ${secs}s`}
        </button>
      </Bar>
    </>
  );
}

/** Shown on the TV before the first Fast Money question; the host sees the questions here and starts when ready. */
function FmIntro({ v, send }: { v: GameView; send: Send }) {
  const mixed = Object.keys(v.settings.mix).length > 1;
  return (
    <>
      <small>Fast Money · {FM_TARGET} points to win</small>
      <div className="h-q">Ready for Fast Money?</div>
      <p style={{ margin: '0 0 8px' }}>The main screen is showing the Fast Money title. The questions are not shown there yet.</p>
      <div className="h-list">
        {v.fastMoney.map((f, i) => (
          <div key={f.id} className="h-item" style={{ cursor: 'default' }}>
            <span className="n">{i + 1}</span>
            <span className="t">{f.text}<small>{v.settings.themeNames[f.themeId] ?? f.themeId}</small></span>
            <button aria-label={`Change question ${i + 1}`} style={{ minHeight: 40 }} onClick={() => send({ type: 'fmReplace', qi: i })}>Change</button>
          </div>
        ))}
      </div>
      <select
        style={{ width: '100%', minHeight: 48, marginTop: 8 }}
        value=""
        aria-label="Change theme of all Fast Money questions"
        onChange={(e) => e.target.value && send({ type: 'fmChangeTheme', themeId: e.target.value })}
      >
        <option value="">Change all five to a theme…</option>
        {mixed && <option value="mix">Mixed (game mix)</option>}
        {v.themes.map((t) => (
          <option key={t.id} value={t.id} disabled={t.remaining === 0}>{t.name} ({t.remaining})</option>
        ))}
      </select>
      <Bar>
        <button className="primary" onClick={() => send({ type: 'fmBegin' })}>Start Fast Money</button>
      </Bar>
    </>
  );
}

/** After all five answers are in: fix any answer (retype it or pick the match) before anything is revealed. */
function FmReview({ v, send }: { v: GameView; send: Send }) {
  const fm = v.fm!;
  const entries = fm.entries[fm.player];
  const fromServer = () => entries.map((e) => e?.text ?? '');
  const [drafts, setDrafts] = useState<string[]>(fromServer);
  useEffect(() => setDrafts(fromServer()), [JSON.stringify(entries), v.notice]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (i: number) => {
    if ((drafts[i] ?? '').trim() !== (entries[i]?.text ?? '')) send({ type: 'fmEdit', qi: i, text: drafts[i] ?? '' });
  };
  return (
    <>
      <small>Player {fm.player + 1} · check the answers, then reveal</small>
      <div className="stack" style={{ marginTop: 8 }}>
        {v.fastMoney.map((f, i) => {
          const e = entries[i];
          const said = fm.player === 1 ? fm.entries[0][i]?.answerIndex : undefined;
          return (
            <div key={f.id}>
              <small>{i + 1}. {f.text}</small>
              <input
                className="h-input"
                value={drafts[i] ?? ''}
                placeholder="No answer"
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(ev) => setDrafts((d) => d.map((x, j) => (j === i ? ev.target.value : x)))}
                onBlur={() => commit(i)}
                onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
              />
              <div className="row" style={{ marginTop: 4 }}>
                <small className="grow" style={{ minWidth: 0 }}>{e && e.answerIndex !== null ? `→ ${f.answers[e.answerIndex].text} (${e.points})` : 'Not on the list (0)'}</small>
                <select
                  aria-label={`Answer for question ${i + 1}`}
                  value={e?.answerIndex ?? ''}
                  onChange={(ev) => {
                    const idx = ev.target.value === '' ? null : Number(ev.target.value);
                    send({ type: 'fmEdit', qi: i, text: (drafts[i] ?? '').trim() || (idx === null ? '' : f.answers[idx].text), answerIndex: idx });
                  }}
                >
                  <option value="">Not on the list (0)</option>
                  {f.answers.map((a, j) => (
                    <option key={j} value={j} disabled={said === j}>{a.text} ({a.points}){said === j ? ' — Player 1' : ''}</option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
      <Bar>
        <button
          className="primary"
          onClick={() => {
            // Save anything still being typed (some phones don't blur the field on tap) before locking answers in.
            v.fastMoney.forEach((_, i) => commit(i));
            send({ type: 'fmConfirm' });
          }}
        >
          Reveal answers
        </button>
      </Bar>
    </>
  );
}

function Final({ v }: { v: GameView; send: Send }) {
  const fm = v.fm ? fmTotal(v, 0) + fmTotal(v, 1) : null;
  return (
    <>
      <div className="h-q">Game over</div>
      {fm !== null && <p>Fast Money {fm} / {FM_TARGET}</p>}
    </>
  );
}

function Scores({ v, send }: { v: GameView; send: Send }) {
  return (
    <details style={{ marginTop: 18 }}>
      <summary>Adjust scores</summary>
      {[0, 1].map((t) => (
        <div key={t} className="row between" style={{ marginBottom: 8 }}>
          <span>{v.settings.teamNames[t]}</span>
          <span className="row">
            <button onClick={() => send({ type: 'adjustScore', team: t as 0 | 1, delta: -10 })}>−10</button>
            <button onClick={() => send({ type: 'adjustScore', team: t as 0 | 1, delta: 10 })}>+10</button>
          </span>
        </div>
      ))}
    </details>
  );
}

type Pending = 'restart' | 'setup' | null;

/** Master controls: undo the last action, restart this game, or go back to setup. */
function Controls({ v, send }: { v: GameView; send: Send }) {
  const [pending, setPending] = useState<Pending>(null);
  return (
    <div className="h-controls">
      <h3>Game controls</h3>
      <div className="row">
        <button className="grow" disabled={!v.canUndo} onClick={() => send({ type: 'undo' })}>↶ Undo</button>
        <button className="grow" onClick={() => setPending('restart')}>Restart game</button>
        <button className="grow" onClick={() => setPending('setup')}>New game</button>
      </div>
      {pending === 'restart' && (
        <Confirm
          title="Restart this game?"
          confirmLabel="Restart"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            send({ type: 'restart' });
          }}
        >
          Scores and progress go back to zero. The same questions are used.
        </Confirm>
      )}
      {pending === 'setup' && (
        <Confirm
          title="Start a new game?"
          confirmLabel="New game"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            send({ type: 'reset' });
          }}
        >
          This ends the current game and returns the main screen to setup.
        </Confirm>
      )}
    </div>
  );
}

function Confirm(props: { title: string; confirmLabel: string; children: ReactNode; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-bg" style={{ alignItems: 'center', padding: 16 }} onClick={props.onCancel}>
      <div className="modal stack" role="alertdialog" aria-modal="true" aria-label={props.title} style={{ maxWidth: 380, border: '2px solid #000' }} onClick={(e) => e.stopPropagation()}>
        <h2>{props.title}</h2>
        <div>{props.children}</div>
        <div className="row">
          <button className="grow" style={{ minHeight: 52 }} onClick={props.onCancel} autoFocus>Cancel</button>
          <button className="grow primary" style={{ minHeight: 52 }} onClick={props.onConfirm}>{props.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
