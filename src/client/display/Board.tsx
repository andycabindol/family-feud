import { useEffect, useRef, useState } from 'react';
import type { GameConnection } from '../net';
import { FM_TARGET, MAX_STRIKES, fmTotal, type GameView } from '../../shared/game';
import { audioRunning, isMuted, playBuzzer, playDing, playFlip, playRepeat, playZero, setMuted, unlockAudio } from '../sound';

function SoundToggle() {
  const [muted, setM] = useState(isMuted());
  const [running, setRunning] = useState(audioRunning());
  useEffect(() => {
    const t = setInterval(() => setRunning(audioRunning()), 500);
    return () => clearInterval(t);
  }, []);
  const label = muted ? 'Sound off' : running ? 'Sound on' : 'Tap to enable sound';
  return (
    <button
      className="sound"
      onClick={() => {
        unlockAudio();
        if (!muted && !running) return; // first tap just unlocks
        setMuted(!muted);
        setM(!muted);
      }}
    >
      {label}
    </button>
  );
}

export function Countdown({ ms, receivedAt }: { ms: number | null; receivedAt: number }) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (ms === null) return;
    const t = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(t);
  }, [ms, receivedAt]);
  if (ms === null) return null;
  return <div className="countdown">{Math.max(0, Math.ceil((ms - (now - receivedAt)) / 1000))}</div>;
}

/** Shown on the TV while the host sets up a new game on their phone. */
export function Waiting() {
  return (
    <div className="board">
      <SoundToggle />
      <div className="center hero">
        <div className="title big">Family Feud</div>
      </div>
    </div>
  );
}

export function Board({ conn }: { conn: GameConnection }) {
  const v = conn.view!;

  return (
    <div className="board">
      {!conn.connected && <div className="toast">Reconnecting…</div>}
      {v.phase === 'intro' && <SoundToggle />}
      {v.phase === 'intro' && (
        <div className="center hero">
          <div className="title big">Family Feud</div>
          <h2 className="names">
            {v.settings.teamNames[0]}<span className="vs">vs</span>{v.settings.teamNames[1]}
          </h2>
        </div>
      )}
      {(v.phase === 'round' || v.phase === 'awarded') && <RoundBoard v={v} receivedAt={conn.receivedAt} />}
      {v.phase === 'fastmoney' && <FastMoneyBoard v={v} receivedAt={conn.receivedAt} />}
      {v.phase === 'final' && <Final v={v} />}
    </div>
  );
}

function Scores({ v, mid }: { v: GameView; mid: string }) {
  return (
    <div className="scores">
      <span>{v.settings.teamNames[0]} <b>{v.scores[0]}</b></span>
      <span className="mid">{mid}</span>
      <span><b>{v.scores[1]}</b> {v.settings.teamNames[1]}</span>
    </div>
  );
}

/** Delay between each unanswered answer flipping over after a round is awarded. */
const REMAINING_DELAY_MS = 2000;
/** Full-screen "points awarded" takeover: total length, and when/how long the number counts up. */
const TAKEOVER_MS = 4600;
const COUNT_START_MS = 700;
const COUNT_MS = 2000;
/** Pause after the takeover before the first remaining answer flips. */
const AFTER_TAKEOVER_MS = 800;

/** Team names and scores side by side; the awarded team's number counts up to its new score. */
function Takeover({ names, from, to }: { names: [string, string]; from: [number, number]; to: [number, number] }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - start - COUNT_START_MS;
      const p = Math.min(1, Math.max(0, elapsed / COUNT_MS));
      setT(1 - Math.pow(1 - p, 3)); // ease out
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="takeover" aria-hidden>
      {[0, 1].map((i) => {
        const gained = to[i] - from[i];
        return (
          <div key={i} className={`team ${gained > 0 ? 'win' : ''}`}>
            <div className="t-name">{names[i]}</div>
            <div className="t-score">{Math.round(from[i] + gained * t)}</div>
            <div className="t-plus" style={{ opacity: gained > 0 ? 1 : 0 }}>+{gained}</div>
          </div>
        );
      })}
    </div>
  );
}

function RoundBoard({ v, receivedAt }: { v: GameView; receivedAt: number }) {
  const q = v.rounds[v.roundIndex];
  const rows = Math.ceil(q.answers.length / 2);
  // Brief full-screen X when a strike is added.
  const prev = useRef(v.strikes);
  const [flash, setFlash] = useState(false);
  // Full-screen takeover when points are awarded (from -> to scores), before the remaining answers flip.
  const [takeover, setTakeover] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  const takeoverTimer = useRef<ReturnType<typeof setTimeout>>();
  const afterAward = useRef(false); // true while a fresh award is being presented
  const prevPhase = useRef(v.phase);
  const prevScores = useRef(v.scores);
  useEffect(() => () => clearTimeout(takeoverTimer.current), []);
  useEffect(() => {
    const justAwarded = prevPhase.current === 'round' && v.phase === 'awarded';
    const from = prevScores.current;
    prevPhase.current = v.phase;
    prevScores.current = v.scores;
    if (justAwarded) {
      afterAward.current = true;
      clearTimeout(takeoverTimer.current);
      setTakeover({ from, to: v.scores });
      takeoverTimer.current = setTimeout(() => setTakeover(null), TAKEOVER_MS);
    } else if (v.phase !== 'awarded') {
      afterAward.current = false; // undo / next round
      clearTimeout(takeoverTimer.current);
      setTakeover(null);
    }
  }, [v.phase, v.scores]);
  // Tiles actually flipped on screen. Normal reveals show at once; after points are awarded the
  // remaining (unanswered) tiles flip one by one, REMAINING_DELAY_MS apart.
  const [shown, setShown] = useState<number[]>(v.revealed);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const revealedKey = v.revealed.join(',');
  useEffect(() => {
    const target = v.revealed;
    const shownNow = shownRef.current;
    const pending = target.filter((i) => !shownNow.includes(i));
    const behind = shownNow.some((i) => !target.includes(i)); // undo / next round
    if (v.phase !== 'awarded' || behind || pending.length === 0) {
      setShown(target);
      return;
    }
    // After a fresh award, wait for the takeover to finish, then flip the rest one by one.
    const lead = afterAward.current ? TAKEOVER_MS + AFTER_TAKEOVER_MS : REMAINING_DELAY_MS;
    const timers = pending.map((index, k) =>
      setTimeout(() => setShown((s) => (s.includes(index) ? s : [...s, index])), lead + k * REMAINING_DELAY_MS),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.phase, v.roundIndex, revealedKey]);
  const prevShown = useRef(shown.length);
  useEffect(() => {
    if (shown.length > prevShown.current) playDing();
    prevShown.current = shown.length;
  }, [shown.length]);
  useEffect(() => {
    const added = v.strikes > prev.current;
    prev.current = v.strikes;
    if (!added) return;
    playBuzzer();
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1500);
    return () => clearTimeout(t);
  }, [v.strikes]);

  return (
    <>
      <Scores v={v} mid={`Round ${v.roundIndex + 1}/${v.rounds.length}${v.multiplier > 1 ? ` ×${v.multiplier}` : ''}`} />
      <div className="question">{q.text}</div>
      <div className="grid" style={{ gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {q.answers.map((a, i) => (
          <div key={i} className={`tile ${shown.includes(i) ? 'on' : ''}`}>
            <div className="tile-in">
              <div className="tile-f">{i + 1}</div>
              <div className="tile-b"><span>{a.text}</span><span>{a.points}</span></div>
            </div>
          </div>
        ))}
      </div>
      <div className="foot">
        <span>
          {Array.from({ length: MAX_STRIKES }, (_, i) =>
            i < v.strikes ? <span key={i} className="red">✕ </span> : <span key={i}>· </span>,
          )}
        </span>
        <Countdown ms={v.timerRemainingMs} receivedAt={receivedAt} />
        <span>Pot {v.pot}</span>
      </div>
      {takeover && <Takeover key={v.roundIndex} names={v.settings.teamNames} from={takeover.from} to={takeover.to} />}
      {flash && (
        <div className="strike-overlay" aria-hidden>
          {Array.from({ length: v.strikes }, (_, i) => (
            <BigX key={i} />
          ))}
        </div>
      )}
    </>
  );
}

/** Big red X, drawn as SVG so it scales cleanly. */
function BigX() {
  return (
    <svg className="big-x" viewBox="0 0 100 100">
      <g strokeLinecap="butt" fill="none">
        <path d="M14 14 L86 86 M86 14 L14 86" stroke="#000" strokeWidth="26" />
        <path d="M14 14 L86 86 M86 14 L14 86" stroke="#e3000f" strokeWidth="19" />
      </g>
    </svg>
  );
}

function FastMoneyBoard({ v, receivedAt }: { v: GameView; receivedAt: number }) {
  const fm = v.fm!;
  const t0 = fmTotal(v, 0);
  const t1 = fmTotal(v, 1);
  // Sounds: answer text revealed -> flip; points revealed -> ding if it scored, "zero" sound if 0.
  const revealedKeys: string[] = [];
  const scoredKeys: string[] = [];
  [0, 1].forEach((p) =>
    fm.entries[p].forEach((e, i) => {
      if (e && fm.revealed[p][i]) revealedKeys.push(`${p}:${i}`);
      if (e && fm.scored[p][i]) scoredKeys.push(`${p}:${i}`);
    }),
  );
  const prevRepeats = useRef(fm.repeats ?? 0);
  useEffect(() => {
    const n = fm.repeats ?? 0;
    if (n > prevRepeats.current) playRepeat();
    prevRepeats.current = n;
  }, [fm.repeats]);
  const revealedId = revealedKeys.join(',');
  const scoredId = scoredKeys.join(',');
  const prevRevealed = useRef(new Set(revealedKeys));
  const prevScored = useRef(new Set(scoredKeys));
  useEffect(() => {
    const freshRevealed = revealedKeys.filter((k) => !prevRevealed.current.has(k));
    const freshScored = scoredKeys.filter((k) => !prevScored.current.has(k));
    prevRevealed.current = new Set(revealedKeys);
    prevScored.current = new Set(scoredKeys);
    if (freshScored.length > 0) {
      const allZero = freshScored.every((k) => {
        const [p, i] = k.split(':').map(Number);
        return (fm.entries[p][i]?.points ?? 0) === 0;
      });
      if (allZero) playZero();
      else playDing();
    } else if (freshRevealed.length > 0) playFlip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealedId, scoredId]);
  return (
    <>
      <Scores v={v} mid="Fast Money" />
      {fm.stage === 'intro' && (
        <div className="center hero">
          <div className="title big">Fast Money</div>
          <h2 className="names">{FM_TARGET} points to win</h2>
        </div>
      )}
      {fm.stage === 'answering' && (
        <div className="center">
          <small>Player {fm.player + 1} · {fm.qi + 1} of {v.fastMoney.length}</small>
          <div className="question">{v.fastMoney[fm.qi].text}</div>
          <Countdown ms={v.timerRemainingMs} receivedAt={receivedAt} />
        </div>
      )}
      {(fm.stage === 'reveal' || fm.stage === 'review' || fm.player === 1) && (
        <div className="fm">
          {v.fastMoney.map((q, i) => (
            <FmRow key={q.id} v={v} i={i} />
          ))}
          <b>Total</b><b>{t0}</b><b>{t1}</b>
          <div className="fq" style={{ gridColumn: '1 / -1', textAlign: 'center', fontSize: '1.6em', fontWeight: 800 }}>
            {t0 + t1} / {FM_TARGET}{t0 + t1 >= FM_TARGET ? ' — WIN' : ''}
          </div>
        </div>
      )}
    </>
  );
}

function FmRow({ v, i }: { v: GameView; i: number }) {
  const fm = v.fm!;
  const q = v.fastMoney[i];
  return (
    <>
      <span className="fq">{fm.stage === 'reveal' || fm.stage === 'review' || fm.entries[0][i] ? q.text : '…'}</span>
      {[0, 1].map((p) => {
        const e = fm.entries[p][i];
        const shown = !!e && fm.revealed[p][i];
        const scored = !!e && fm.scored[p][i];
        return (
          <span key={p} className={`cell ${shown ? 'on' : ''}`}>
            {shown ? (
              <>
                <span>{e!.answerIndex !== null ? q.answers[e!.answerIndex].text : e!.text || '—'}</span>
                <span>{scored ? e!.points : ''}</span>
              </>
            ) : e ? '●' : ''}
          </span>
        );
      })}
    </>
  );
}

function Final({ v }: { v: GameView }) {
  const [a, b] = v.scores;
  const fm = v.fm ? fmTotal(v, 0) + fmTotal(v, 1) : null;
  return (
    <div className="center">
      <div className="title">{a === b ? 'Tie game' : `${v.settings.teamNames[a > b ? 0 : 1]} wins`}</div>
      <h2>{v.settings.teamNames[0]} {a} — {b} {v.settings.teamNames[1]}</h2>
      {fm !== null && <h2>Fast Money {fm} / {FM_TARGET}</h2>}
    </div>
  );
}
