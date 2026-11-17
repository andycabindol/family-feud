import type { Pack, Question, Rng } from './types';
import { isFastMoneyFriendly, questionKey } from './validate';

// ------------------------------------------------------------------ RNG

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------------ Groups

/** A weighted source of questions (a pack, or several packs merged). */
export interface Group {
  key: string;
  label: string;
  /** Relative weight; only the ratios matter (percentages in the UI). */
  weight: number;
  questions: Question[];
}

/** Set-up choices that determine where a game's questions come from. */
export type ThemeChoice =
  | { mode: 'single'; packId: string }
  | { mode: 'custom'; packIds: string[] }
  | { mode: 'mixed'; weights: Record<string, number> };

export function groupsFor(choice: ThemeChoice, packs: Pack[]): Group[] {
  const byId = new Map(packs.map((p) => [p.id, p]));
  const toGroup = (p: Pack, weight: number): Group => ({ key: p.id, label: p.name, weight, questions: p.questions });
  switch (choice.mode) {
    case 'single': {
      const p = byId.get(choice.packId);
      return p ? [toGroup(p, 1)] : [];
    }
    case 'custom':
      // Several custom packs behave like one big pool: weight by size.
      return choice.packIds.flatMap((id) => {
        const p = byId.get(id);
        return p && p.questions.length ? [toGroup(p, p.questions.length)] : [];
      });
    case 'mixed':
      return Object.entries(choice.weights).flatMap(([id, w]) => {
        const p = byId.get(id);
        return p && w > 0 ? [toGroup(p, w)] : [];
      });
  }
}

// ------------------------------------------------------------------ Percentages

/**
 * Move one slider to `value` and rescale the others proportionally so the total stays 100.
 * Rounds to whole percents and fixes any rounding drift on the largest other slider.
 */
export function setMixPercent(mix: Record<string, number>, key: string, value: number): Record<string, number> {
  const keys = Object.keys(mix);
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = keys.filter((k) => k !== key);
  if (!others.length) return { [key]: 100 };
  const remaining = 100 - v;
  const otherTotal = others.reduce((s, k) => s + mix[k], 0);
  const next: Record<string, number> = { [key]: v };
  if (otherTotal <= 0) {
    // Spread evenly.
    const base = Math.floor(remaining / others.length);
    others.forEach((k) => (next[k] = base));
  } else {
    others.forEach((k) => (next[k] = Math.floor((mix[k] / otherTotal) * remaining)));
  }
  let drift = remaining - others.reduce((s, k) => s + next[k], 0);
  const order = [...others].sort((a, b) => (mix[b] ?? 0) - (mix[a] ?? 0));
  for (let i = 0; drift > 0; i = (i + 1) % order.length, drift--) next[order[i]]++;
  // Preserve original key order.
  return Object.fromEntries(keys.map((k) => [k, next[k]]));
}

/** Evenly split 100% across keys. */
export function evenMix(keys: string[]): Record<string, number> {
  if (!keys.length) return {};
  const base = Math.floor(100 / keys.length);
  const out: Record<string, number> = {};
  keys.forEach((k, i) => (out[k] = base + (i < 100 - base * keys.length ? 1 : 0)));
  return out;
}

/** Add or remove a key from a mix, re-normalising the rest to 100. */
export function toggleMixKey(mix: Record<string, number>, key: string, on: boolean): Record<string, number> {
  const has = key in mix;
  if (on === has) return mix;
  if (on) {
    const keys = [...Object.keys(mix), key];
    const share = Math.round(100 / keys.length);
    return setMixPercent({ ...mix, [key]: 0 }, key, share);
  }
  const rest = Object.fromEntries(Object.entries(mix).filter(([k]) => k !== key));
  const total = Object.values(rest).reduce((s, n) => s + n, 0);
  if (!Object.keys(rest).length) return {};
  if (total <= 0) return evenMix(Object.keys(rest));
  // Scale up to 100.
  const first = Object.keys(rest)[0];
  return setMixPercent(rest, first, Math.round((rest[first] / total) * 100));
}

// ------------------------------------------------------------------ Allocation

/**
 * Split `total` slots across groups proportionally to weight using largest remainders,
 * never exceeding each group's capacity (spilling the overflow to the others).
 */
export function allocate(
  total: number,
  slots: { weight: number; capacity: number }[],
  rng: Rng = Math.random,
): number[] {
  const result = slots.map(() => 0);
  let remaining = Math.min(total, slots.reduce((s, g) => s + g.capacity, 0));
  while (remaining > 0) {
    const open = slots.map((g, i) => ({ g, i })).filter(({ g, i }) => g.weight > 0 && result[i] < g.capacity);
    // If only zero-weight groups still have room, fall back to them equally.
    const pool = open.length
      ? open
      : slots.map((g, i) => ({ g: { ...g, weight: 1 }, i })).filter(({ g, i }) => result[i] < g.capacity);
    if (!pool.length) break;
    const wTotal = pool.reduce((s, { g }) => s + g.weight, 0);
    const ideal = pool.map(({ g, i }) => ({ i, exact: (remaining * g.weight) / wTotal, room: g.capacity - result[i] }));
    let given = 0;
    for (const x of ideal) {
      const n = Math.min(Math.floor(x.exact), x.room);
      result[x.i] += n;
      given += n;
    }
    let leftover = remaining - given;
    const byFraction = ideal
      .map((x) => ({ ...x, frac: x.exact - Math.floor(x.exact), tie: rng() }))
      .sort((a, b) => b.frac - a.frac || a.tie - b.tie);
    for (const x of byFraction) {
      if (leftover <= 0) break;
      if (result[x.i] < slots[x.i].capacity) {
        result[x.i]++;
        leftover--;
        given++;
      }
    }
    if (given === 0) break;
    remaining -= given;
  }
  return result;
}

// ------------------------------------------------------------------ Assembly

export interface Plan {
  rounds: Question[];
  fastMoney: Question[];
}

export interface AssembleOptions {
  groups: Group[];
  roundCount: number;
  fastMoneyCount: number;
  rng?: Rng;
  /** Question ids/texts that must not be used (e.g. already played). */
  exclude?: Iterable<string>;
}

export interface AssembleResult extends Plan {
  warnings: string[];
}

interface Pools {
  /** Unused questions by group index, shuffled. */
  pools: Question[][];
  seenTexts: Set<string>;
  seenIds: Set<string>;
}

function makePools(groups: Group[], exclude: Iterable<string>, rng: Rng): Pools {
  const seenIds = new Set<string>(exclude);
  const seenTexts = new Set<string>();
  const pools = groups.map((g) => shuffle(g.questions, rng));
  return { pools, seenIds, seenTexts };
}

function takeFrom(
  p: Pools,
  groupIndex: number,
  n: number,
  predicate: (q: Question) => boolean = () => true,
): Question[] {
  const out: Question[] = [];
  for (const q of p.pools[groupIndex]) {
    if (out.length >= n) break;
    if (p.seenIds.has(q.id) || p.seenTexts.has(questionKey(q)) || !predicate(q)) continue;
    out.push(q);
    p.seenIds.add(q.id);
    p.seenTexts.add(questionKey(q));
  }
  return out;
}

function available(p: Pools, groupIndex: number, predicate: (q: Question) => boolean = () => true): number {
  const texts = new Set<string>();
  let n = 0;
  for (const q of p.pools[groupIndex]) {
    const k = questionKey(q);
    if (p.seenIds.has(q.id) || p.seenTexts.has(k) || texts.has(k) || !predicate(q)) continue;
    texts.add(k);
    n++;
  }
  return n;
}

/**
 * Build a game: Fast Money first (it needs the pickiest questions), then rounds from what is left.
 * Both honour the group weights, so Mixed Theme Mode applies to Fast Money too. No question or
 * duplicate wording is used twice.
 */
export function assemblePlan(opts: AssembleOptions): AssembleResult {
  const rng = opts.rng ?? Math.random;
  const warnings: string[] = [];
  const { groups } = opts;
  const p = makePools(groups, opts.exclude ?? [], rng);

  // --- Fast Money (picked first because it is pickier), but never at the expense of the rounds
  // when the chosen themes are too small to fill both.
  const totalAvailable = groups.reduce((n, _, i) => n + available(p, i), 0);
  const fmTarget = Math.min(opts.fastMoneyCount, Math.max(0, totalAvailable - opts.roundCount));
  const fmCaps = groups.map((_, i) => available(p, i, isFastMoneyFriendly));
  const fmAlloc = allocate(fmTarget, groups.map((g, i) => ({ weight: g.weight, capacity: fmCaps[i] })), rng);
  let fastMoney: Question[] = [];
  groups.forEach((_, i) => fastMoney.push(...takeFrom(p, i, fmAlloc[i], isFastMoneyFriendly)));
  if (fastMoney.length < fmTarget) {
    // Not enough well-shaped questions in these themes: take the best available rest.
    const need = fmTarget - fastMoney.length;
    const caps = groups.map((_, i) => available(p, i));
    const extra = allocate(need, groups.map((g, i) => ({ weight: g.weight, capacity: caps[i] })), rng);
    groups.forEach((_, i) => fastMoney.push(...takeFrom(p, i, extra[i])));
    if (fastMoney.length >= fmTarget)
      warnings.push('Some Fast Money questions do not have an ideal answer spread (not enough suitable questions in the chosen themes).');
  }

  // --- Rounds
  const roundCaps = groups.map((_, i) => available(p, i));
  const roundAlloc = allocate(opts.roundCount, groups.map((g, i) => ({ weight: g.weight, capacity: roundCaps[i] })), rng);
  let rounds: Question[] = [];
  groups.forEach((_, i) => rounds.push(...takeFrom(p, i, roundAlloc[i])));

  if (rounds.length < opts.roundCount)
    warnings.push(`Only ${rounds.length} of ${opts.roundCount} round questions could be found; add more questions or themes.`);
  if (fastMoney.length < opts.fastMoneyCount)
    warnings.push(`Only ${fastMoney.length} of ${opts.fastMoneyCount} Fast Money questions could be found.`);

  rounds = shuffle(rounds, rng);
  fastMoney = shuffle(fastMoney, rng);
  return { rounds, fastMoney, warnings };
}

/**
 * Like assemblePlan, but prefers questions not played in earlier games. If the unplayed
 * questions in the chosen themes run out, the shortfall is filled from played ones and
 * `repeats` counts how many questions in the plan were played before.
 */
export function assembleAvoiding(opts: AssembleOptions & { played?: Iterable<string> }): AssembleResult & { repeats: number } {
  const played = new Set(opts.played ?? []);
  const rng = opts.rng ?? Math.random;
  const first = assemblePlan({ ...opts, exclude: [...played, ...(opts.exclude ?? [])] });
  let rounds = first.rounds;
  let fastMoney = first.fastMoney;
  const warnings = first.warnings.filter((w) => !w.startsWith('Only '));

  const shortRounds = Math.max(0, opts.roundCount - rounds.length);
  const shortFm = Math.max(0, opts.fastMoneyCount - fastMoney.length);
  if (shortRounds > 0 || shortFm > 0) {
    const used = [...rounds, ...fastMoney].map((q) => q.id);
    const rest = assemblePlan({
      ...opts,
      roundCount: shortRounds,
      fastMoneyCount: shortFm,
      exclude: [...used, ...(opts.exclude ?? [])],
    });
    rounds = [...rounds, ...rest.rounds];
    fastMoney = [...fastMoney, ...rest.fastMoney];
    warnings.push(...rest.warnings.filter((w) => !w.startsWith('Only ')));
  }

  rounds = shuffle(rounds, rng);
  fastMoney = shuffle(fastMoney, rng);
  if (rounds.length < opts.roundCount)
    warnings.push(`Only ${rounds.length} of ${opts.roundCount} round questions could be found; add more questions or themes.`);
  if (fastMoney.length < opts.fastMoneyCount)
    warnings.push(`Only ${fastMoney.length} of ${opts.fastMoneyCount} Fast Money questions could be found.`);

  const repeats = [...rounds, ...fastMoney].filter((q) => played.has(q.id)).length;
  if (repeats > 0)
    warnings.push(
      `${repeats} question${repeats === 1 ? '' : 's'} repeat${repeats === 1 ? 's' : ''} an earlier game, because these themes have no unplayed questions left. Reset played questions to start fresh.`,
    );
  return { rounds, fastMoney, warnings: [...new Set(warnings)], repeats };
}

/** Questions already in the plan, as an exclusion set (ids). */
export function planIds(plan: { rounds: (Question | null)[]; fastMoney: (Question | null)[] }): Set<string> {
  const ids = new Set<string>();
  for (const q of [...plan.rounds, ...plan.fastMoney]) if (q) ids.add(q.id);
  return ids;
}

export function planTexts(plan: { rounds: (Question | null)[]; fastMoney: (Question | null)[] }): Set<string> {
  const t = new Set<string>();
  for (const q of [...plan.rounds, ...plan.fastMoney]) if (q) t.add(questionKey(q));
  return t;
}

export interface PickOptions {
  groups: Group[];
  /** Restrict to this group key (e.g. "keep the same theme"). */
  groupKey?: string;
  /** Ids to avoid (the rest of the plan, previously played...). */
  excludeIds: Set<string>;
  excludeTexts: Set<string>;
  fastMoney?: boolean;
  rng?: Rng;
}

/** Candidates for a replacement, honouring theme, no-repeat rules and Fast Money suitability. */
export function candidates(opts: PickOptions): Question[] {
  const groups = opts.groupKey ? opts.groups.filter((g) => g.key === opts.groupKey) : opts.groups;
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const g of groups)
    for (const q of g.questions) {
      const k = questionKey(q);
      if (opts.excludeIds.has(q.id) || opts.excludeTexts.has(k) || seen.has(k)) continue;
      if (opts.fastMoney && !isFastMoneyFriendly(q)) continue;
      seen.add(k);
      out.push(q);
    }
  return out;
}

/** Pick one random replacement (weighted by group weight when no group is forced). */
export function pickReplacement(opts: PickOptions): Question | null {
  const rng = opts.rng ?? Math.random;
  const groups = opts.groupKey ? opts.groups.filter((g) => g.key === opts.groupKey) : opts.groups;
  const pools = groups.map((g) => candidates({ ...opts, groups: [g], groupKey: undefined }));
  const weighted = groups.map((g, i) => ({ g, pool: pools[i] })).filter((x) => x.pool.length > 0);
  if (!weighted.length) {
    if (opts.fastMoney) return pickReplacement({ ...opts, fastMoney: false });
    return null;
  }
  const total = weighted.reduce((s, x) => s + Math.max(x.g.weight, 0.0001), 0);
  let r = rng() * total;
  let chosen = weighted[weighted.length - 1];
  for (const x of weighted) {
    r -= Math.max(x.g.weight, 0.0001);
    if (r <= 0) {
      chosen = x;
      break;
    }
  }
  return chosen.pool[Math.floor(rng() * chosen.pool.length)];
}

/** How a finished plan is distributed across themes, for display. */
export function themeBreakdown(questions: (Question | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of questions) if (q) out[q.themeId] = (out[q.themeId] ?? 0) + 1;
  return out;
}
