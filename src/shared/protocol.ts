import type { Action, GameView } from './game';

export type ClientMessage =
  | { type: 'hello'; role: 'display' | 'host' }
  | { type: 'action'; action: Action };

export type ServerMessage =
  | { type: 'state'; view: GameView }
  | { type: 'error'; message: string };
