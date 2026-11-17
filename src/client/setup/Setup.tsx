import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameConnection } from '../net';
import type { GameSettings } from '../../shared/game';
import { FM_QUESTIONS, roundMultiplier } from '../../shared/game';
import { BUILT_IN_PACKS, DEFAULT_THEME_ID } from '../../shared/packs';
import type { Pack, Question } from '../../shared/types';
import {
  type Group, type ThemeChoice, assembleAvoiding, evenMix, groupsFor, pickReplacement, planIds, planTexts, setMixPercent, themeBreakdown, toggleMixKey,
} from '../../shared/selection';
import { questionKey } from '../../shared/validate';
import { api } from '../api';
import { Link } from '../App';
import { QuestionDetails } from '../ui';
import { QuestionPicker } from './QuestionPicker';

type ThemeSel = string; // a built-in pack id, 'custom', or 'mixed'

const THEMES: { id: ThemeSel; name: string }[] = [
  { id: 'general', name: 'General / Classic' },
  { id: 'thanksgiving', name: 'Thanksgiving' },
  { id: 'christmas', name: 'Christmas' },
  { id: 'family', name: 'Family & Relationships' },
  { id: 'food', name: 'Food & Drinks' },
  { id: 'popculture', name: 'Pop Culture' },
  { id: 'kids', name: 'Kids & Family Friendly' },
  { id: 'custom', name: 'Custom Question Pack' },
  { id: 'mixed', name: 'Mixed Themes' },
];

interface Lineup {
  rounds: (Question | null)[];
  fastMoney: (Question | null)[];
}

type SlotRef = { kind: 'round' | 'fm'; index: number };

const emptyLineup = (rounds: number, fm: number): Lineup => ({
  rounds: Array(rounds).fill(null),
  fastMoney: Array(fm).fill(null),
});

export function Setup({ conn }: { conn: GameConnection }) {
  const [customPacks, setCustomPacks] = useState<Pack[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [themeSel, setThemeSel] = useState<ThemeSel>(DEFAULT_THEME_ID);
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [mix, setMix] = useState<Record<string, number>>({ thanksgiving: 60, general: 40 });
  const [roundCount, setRoundCount] = useState(4);
  const [fmEnabled, setFmEnabled] = useState(true);
  const [assembly, setAssembly] = useState<'auto' | 'manual'>('auto');
  const [lineup, setLineup] = useState<Lineup>(() => emptyLineup(4, FM_QUESTIONS));
  const [warnings, setWarnings] = useState<string[]>([]);
  const [picker, setPicker] = useState<SlotRef | null>(null);
  const [slotNote, setSlotNote] = useState<Record<string, string>>({});
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [played, setPlayed] = useState<Record<string, string[]>>({});
  const [teamNames, setTeamNames] = useState<[string, string]>(['', '']);

  useEffect(() => {
    api.played().then(setPlayed).catch(() => undefined);
    api.listPacks().then(setCustomPacks).catch((e) => setLoadError((e as Error).message));
  }, []);

  const allPacks = useMemo(() => [...BUILT_IN_PACKS, ...customPacks], [customPacks]);
  const nameOf = useMemo(() => Object.fromEntries(allPacks.map((p) => [p.id, p.name])), [allPacks]);

  const choice: ThemeChoice = useMemo(() => {
    if (themeSel === 'custom') return { mode: 'custom', packIds: customIds };
    if (themeSel === 'mixed') return { mode: 'mixed', weights: mix };
    return { mode: 'single', packId: themeSel };
  }, [themeSel, customIds, mix]);

  const groups: Group[] = useMemo(() => groupsFor(choice, allPacks), [choice, allPacks]);
  const fmCount = fmEnabled ? FM_QUESTIONS : 0;
  const playedIds = useMemo(() => new Set(Object.values(played).flat()), [played]);
  const playedInChoice = groups.reduce((n, g) => n + g.questions.filter((q) => playedIds.has(q.id)).length, 0);
  const totalInChoice = groups.reduce((n, g) => n + g.questions.length, 0);
  const resetPlayed = () =>
    api.clearPlayed(groups.map((g) => g.key)).then(setPlayed).catch((e) => setLoadError((e as Error).message));

  // ---- Auto-assemble whenever the inputs change (Auto mode only).
  const regenerate = useCallback(() => {
    if (assembly === 'manual') {
      setLineup(emptyLineup(roundCount, fmCount));
      setWarnings([]);
      return;
    }
    const plan = assembleAvoiding({ groups, roundCount, fastMoneyCount: fmCount, played: playedIds });
    setLineup({ rounds: plan.rounds, fastMoney: plan.fastMoney });
    setWarnings(plan.warnings);
    setSlotNote({});
  }, [assembly, groups, roundCount, fmCount, playedIds]);

  const regenRef = useRef(regenerate);
  regenRef.current = regenerate;
  const signature = JSON.stringify([choice, roundCount, fmCount, assembly, playedIds.size, allPacks.map((p) => [p.id, p.questions.length, p.updatedAt])]);
  useEffect(() => {
    const t = setTimeout(() => regenRef.current(), 200);
    return () => clearTimeout(t);
  }, [signature]);

  // ---- Slot operations
  const usedIds = planIds(lineup);
  const usedTexts = planTexts(lineup);

  const setSlot = (ref: SlotRef, q: Question | null) =>
    setLineup((l) => {
      const arr = ref.kind === 'round' ? l.rounds.slice() : l.fastMoney.slice();
      arr[ref.index] = q;
      return ref.kind === 'round' ? { ...l, rounds: arr } : { ...l, fastMoney: arr };
    });

  const replaceSlot = (ref: SlotRef, groupKey?: string) => {
    const current = (ref.kind === 'round' ? lineup.rounds : lineup.fastMoney)[ref.index];
    const ids = new Set(usedIds);
    const texts = new Set(usedTexts);
    if (current) {
      ids.delete(current.id);
      texts.delete(questionKey(current));
    }
    const key = groupKey ?? (current && groups.some((g) => g.key === current.themeId) ? current.themeId : undefined);
    const pick = { groups, groupKey: key, excludeTexts: texts, fastMoney: ref.kind === 'fm' };
    // Prefer questions not played before; repeat one only if nothing else is left.
    let q: Question | null = pickReplacement({ ...pick, excludeIds: new Set([...ids, ...playedIds]) });
    const repeated = !q;
    if (!q) q = pickReplacement({ ...pick, excludeIds: ids });
    const noteKey = `${ref.kind}${ref.index}`;
    if (!q) {
      setSlotNote((n) => ({ ...n, [noteKey]: 'No more unused questions in this theme. Use “Choose…” to pick any question.' }));
      return;
    }
    setSlotNote((n) => ({ ...n, [noteKey]: repeated ? 'Repeats a question from an earlier game (no unplayed ones left in this theme).' : '' }));
    setSlot(ref, q);
  };

  const filled = lineup.rounds.every(Boolean) && lineup.fastMoney.every(Boolean) && lineup.rounds.length > 0;
  const totalSlots = lineup.rounds.length + lineup.fastMoney.length;

  const breakdown = useMemo(() => {
    const all = [...lineup.rounds, ...lineup.fastMoney];
    const counts = themeBreakdown(all);
    const total = all.filter(Boolean).length;
    return Object.entries(counts).map(([id, n]) => ({ id, n, pct: Math.round((n / Math.max(1, total)) * 100) }));
  }, [lineup]);

  // ---- Start
  const start = () => {
    const rounds = lineup.rounds as Question[];
    const fastMoney = lineup.fastMoney as Question[];
    const mixWeights = Object.fromEntries(
      (() => {
        const total = groups.reduce((s, g) => s + g.weight, 0) || 1;
        return groups.map((g) => [g.key, Math.round((g.weight / total) * 100)]);
      })(),
    );
    const themeLabel =
      themeSel === 'mixed'
        ? Object.entries(mix).filter(([, v]) => v > 0).map(([k, v]) => `${nameOf[k] ?? k} ${v}%`).join(' · ')
        : themeSel === 'custom'
          ? customIds.map((id) => nameOf[id] ?? id).join(' + ')
          : (nameOf[themeSel] ?? themeSel);
    const settings: GameSettings = {
      teamNames: [teamNames[0].trim() || 'Team 1', teamNames[1].trim() || 'Team 2'],
      roundCount: rounds.length,
      fastMoneyEnabled: fmEnabled,
      mix: mixWeights,
      themeNames: nameOf,
      themeLabel,
    };
    conn.send({ type: 'startGame', settings, rounds, fastMoney, bank: allPacks.flatMap((p) => p.questions) });
  };

  const pickerSlot = picker;
  const pickerQ = pickerSlot ? (pickerSlot.kind === 'round' ? lineup.rounds : lineup.fastMoney) [pickerSlot.index] : null;

  const mixKeys = Object.keys(mix);
  const mixTotal = Object.values(mix).reduce((a, b) => a + b, 0);
  const filledCount = [...lineup.rounds, ...lineup.fastMoney].filter(Boolean).length;

  const slotProps = (kind: 'round' | 'fm', i: number, q: Question | null) => {
    const key = `${kind}${i}`;
    return {
      q,
      themeName: q ? nameOf[q.themeId] : undefined,
      note: slotNote[key],
      open: openSlot === key,
      onToggle: () => setOpenSlot(openSlot === key ? null : key),
      onReplace: () => replaceSlot({ kind, index: i }),
      onChoose: () => setPicker({ kind, index: i }),
    };
  };

  return (
    <div className="page stack">
      <header>
        <h1>Family Feud</h1>
        <Link to="/packs">Question packs</Link>
      </header>

      {loadError && <div className="msg">Couldn’t load custom packs: {loadError}</div>}

      <div className="row">
        {[0, 1].map((i) => (
          <label key={i} className="grow">
            Team {i + 1} name (optional)
            <input
              placeholder={`Team ${i + 1}`}
              value={teamNames[i]}
              maxLength={24}
              autoCapitalize="words"
              onChange={(e) => setTeamNames((t) => (i === 0 ? [e.target.value, t[1]] : [t[0], e.target.value]))}
            />
          </label>
        ))}
      </div>

      <label>
        Question theme
        <select value={themeSel} onChange={(e) => setThemeSel(e.target.value)}>
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>

      {themeSel === 'custom' &&
        (customPacks.length === 0 ? (
          <small>No custom packs yet. <Link to="/packs">Create one</Link>.</small>
        ) : (
          <div className="stack">
            {customPacks.map((p) => (
              <label key={p.id} className="inline">
                <input type="checkbox" checked={customIds.includes(p.id)} onChange={(e) => setCustomIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))} />
                {p.name} <small>({p.questions.length})</small>
              </label>
            ))}
          </div>
        ))}

      {themeSel === 'mixed' && (
        <div>
          {allPacks.map((p) => {
            const on = p.id in mix;
            const locked = !on || mixKeys.length < 2;
            return (
              <div key={p.id} className="mix">
                <label className="inline">
                  <input type="checkbox" checked={on} disabled={on && mixKeys.length === 1} onChange={(e) => setMix((m) => toggleMixKey(m, p.id, e.target.checked))} />
                  {p.name}
                </label>
                <span className="row">
                  <input type="number" min={0} max={100} value={mix[p.id] ?? 0} disabled={locked} onChange={(e) => setMix((m) => setMixPercent(m, p.id, Number(e.target.value)))} aria-label={`${p.name} percent`} />%
                </span>
                {on && <input type="range" min={0} max={100} value={mix[p.id] ?? 0} disabled={locked} onChange={(e) => setMix((m) => setMixPercent(m, p.id, Number(e.target.value)))} aria-label={`${p.name} slider`} />}
              </div>
            );
          })}
          <div className="row wrap">
            <button className="link" onClick={() => setMix({ thanksgiving: 60, general: 40 })}>60/40 Thanksgiving/General</button>
            <button className="link" onClick={() => setMix(evenMix(mixKeys.length ? mixKeys : ['thanksgiving', 'general']))}>Even split</button>
          </div>
          {mixTotal !== 100 && <small>Total {mixTotal}% (must be 100)</small>}
        </div>
      )}

      <div className="row wrap">
        <label>
          Rounds
          <select value={roundCount} onChange={(e) => setRoundCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          Questions
          <select value={assembly} onChange={(e) => setAssembly(e.target.value as 'auto' | 'manual')}>
            <option value="auto">Auto-assemble</option>
            <option value="manual">I’ll choose</option>
          </select>
        </label>
        <label className="inline">
          <input type="checkbox" checked={fmEnabled} onChange={(e) => setFmEnabled(e.target.checked)} /> Fast Money
        </label>
      </div>

      <div>
        <div className="row between">
          <h3>Lineup</h3>
          <div className="row">
            {playedInChoice > 0 && (
              <>
                <small>{playedInChoice}/{totalInChoice} played before</small>
                <button className="link" onClick={resetPlayed}>Reset played</button>
              </>
            )}
            {assembly === 'auto' && <button className="link" onClick={regenerate}>Re-roll all</button>}
          </div>
        </div>
        {breakdown.length > 0 && (
          <small>
            {breakdown.map((b, i) => `${i ? ' · ' : ''}${nameOf[b.id] ?? b.id} ${b.n}/${totalSlots} (${b.pct}%)`).join('')}
          </small>
        )}
        {warnings.map((w) => (
          <div key={w} className="msg">{w}</div>
        ))}
        {lineup.rounds.map((q, i) => (
          <Slot
            key={`r${i}-${q?.id ?? 'empty'}`}
            label={`R${i + 1}${roundMultiplier(i, lineup.rounds.length) > 1 ? ` ×${roundMultiplier(i, lineup.rounds.length)}` : ''}`}
            {...slotProps('round', i, q)}
          />
        ))}
        {fmEnabled &&
          lineup.fastMoney.map((q, i) => <Slot key={`f${i}-${q?.id ?? 'empty'}`} label={`FM${i + 1}`} {...slotProps('fm', i, q)} />)}
      </div>

      <div className="start-bar">
        <small>{filledCount === totalSlots && totalSlots > 0 ? 'Ready' : `${filledCount}/${totalSlots} chosen`}</small>
        <button className="primary" disabled={!filled || !conn.connected || (themeSel === 'mixed' && mixTotal !== 100)} onClick={start}>Start game</button>
      </div>

      {pickerSlot && (
        <QuestionPicker
          packs={allPacks}
          title={pickerSlot.kind === 'round' ? `Round ${pickerSlot.index + 1}` : `Fast Money ${pickerSlot.index + 1}`}
          fastMoney={pickerSlot.kind === 'fm'}
          usedIds={new Set([...usedIds].filter((id) => id !== pickerQ?.id))}
          usedTexts={new Set([...usedTexts].filter((t) => !pickerQ || t !== questionKey(pickerQ)))}
          playedIds={playedIds}
          defaultPackId={allPacks.some((p) => p.id === themeSel) ? themeSel : undefined}
          onPick={(q) => {
            setSlot(pickerSlot, q);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function Slot(props: {
  label: string;
  q: Question | null;
  themeName?: string;
  note?: string;
  open: boolean;
  onToggle: () => void;
  onReplace: () => void;
  onChoose: () => void;
}) {
  const { q } = props;
  return (
    <div className="slot">
      <small>{props.label}{props.themeName ? ` · ${props.themeName}` : ''}</small>
      <div className="slot-q" onClick={q ? props.onToggle : undefined}>{q ? q.text : <span className="dim">Not chosen</span>}</div>
      {props.note && <small>{props.note}</small>}
      {q && props.open && <QuestionDetails q={q} />}
      <div className="row">
        {q && <button onClick={props.onReplace}>Replace</button>}
        <button onClick={props.onChoose}>{q ? 'Choose…' : 'Choose a question'}</button>
        {q && <button className="link" onClick={props.onToggle}>{props.open ? 'Hide' : 'Answers'}</button>}
      </div>
    </div>
  );
}
