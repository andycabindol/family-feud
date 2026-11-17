import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, GameView } from '../shared/game';
import type { ClientMessage, ServerMessage } from '../shared/protocol';

export interface GameConnection {
  view: GameView | null;
  /** performance.now() when `view` arrived, used to run the countdown. */
  receivedAt: number;
  connected: boolean;
  error: { id: number; message: string } | null;
  /** The server wants the host PIN (host role only). */
  needsPin: boolean;
  send: (action: Action) => void;
}

const PIN_KEY = 'ff-pin';
export function getPin(): string {
  try {
    return localStorage.getItem(PIN_KEY) ?? '';
  } catch {
    return '';
  }
}
export function savePin(pin: string) {
  try {
    localStorage.setItem(PIN_KEY, pin);
  } catch {
    /* ignore */
  }
}

export function useGame(role: 'display' | 'host'): GameConnection {
  const [view, setView] = useState<GameView | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<GameConnection['error']>(null);
  const [needsPin, setNeedsPin] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const errId = useRef(0);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    let attempt = 0;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        const hello: ClientMessage = { type: 'hello', role, pin: role === 'host' ? getPin() : undefined };
        ws.send(JSON.stringify(hello));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.type === 'state') {
          setNeedsPin(false);
          setView(msg.view);
          setReceivedAt(performance.now());
        } else if (msg.code === 'auth') {
          setNeedsPin(true);
          if (msg.message === 'Wrong PIN.') setError({ id: ++errId.current, message: msg.message });
        } else setError({ id: ++errId.current, message: msg.message });
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, Math.min(5000, 500 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [role]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError((e) => (e?.id === error.id ? null : e)), 4500);
    return () => clearTimeout(t);
  }, [error]);

  const send = useCallback((action: Action) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError({ id: ++errId.current, message: 'Not connected to the game server.' });
      return;
    }
    const msg: ClientMessage = { type: 'action', action };
    ws.send(JSON.stringify(msg));
  }, []);

  return { view, receivedAt, connected, error, needsPin, send };
}
