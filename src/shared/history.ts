import { type Action, type Ctx, type GameState, GameError, reduce } from './game';

export interface Session {
  state: GameState;
  /** Previous states, oldest first. */
  past: GameState[];
}

const MAX_HISTORY = 200;
/** Actions that never create an undo step (timer ticks, and ones that wipe history). */
const NO_STEP = new Set<Action['type']>(['startTimer', 'stopTimer']);
const CLEARS_HISTORY = new Set<Action['type']>(['startGame', 'reset', 'restart']);

export const newSession = (state: GameState): Session => ({ state, past: [] });

/** Applies an action and records history so the host can undo it. */
export function step(session: Session, action: Action, ctx: Ctx): Session {
  const { state, past } = session;

  if (action.type === 'undo') {
    const prev = past[past.length - 1];
    if (!prev) throw new GameError('Nothing to undo.');
    return {
      past: past.slice(0, -1),
      state: { ...prev, version: state.version + 1, timerEndsAt: state.timerEndsAt, notice: 'Undid the last action.' },
    };
  }

  const next = reduce(state, action, ctx);
  if (CLEARS_HISTORY.has(action.type)) return { state: next, past: [] };
  // A repeated Fast Money answer changes nothing but the counter, so it is not an undo step.
  const repeatOnly = (action.type === 'fmSubmit' || action.type === 'fmEdit') && (next.fm?.repeats ?? 0) !== (state.fm?.repeats ?? 0);
  if (NO_STEP.has(action.type) || repeatOnly || next.version === state.version) return { state: next, past };
  return { state: next, past: [...past, state].slice(-MAX_HISTORY) };
}
