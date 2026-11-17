import { useEffect, useState } from 'react';
import { useGame } from './net';
import { Board, Waiting } from './display/Board';
import { Host } from './host/Host';
import { PackManager } from './packs/PackManager';
import { installAudioUnlock, setMusic, type MusicTrack } from './sound';

export function navigate(path: string) {
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function Link({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}

function Display() {
  const conn = useGame('display');
  useEffect(() => installAudioUnlock(), []);

  // Theme music while waiting for the game to start and on the Fast Money intro; Fast Money music while a player is answering.
  const v = conn.view;
  let track: MusicTrack | null = null;
  if (v && (v.phase === 'setup' || v.phase === 'intro' || (v.phase === 'fastmoney' && v.fm?.stage === 'intro'))) track = 'theme';
  else if (v && v.phase === 'fastmoney' && v.fm?.stage === 'answering') track = 'fm';
  useEffect(() => {
    setMusic(track);
  }, [track]);
  useEffect(() => () => setMusic(null), []);

  if (!conn.view) return <div className="center-screen">{conn.connected ? 'Loading…' : 'Connecting to the game server…'}</div>;
  if (conn.view.phase === 'setup') return <Waiting />;
  return <Board conn={conn} />;
}

export function App() {
  const path = usePath();
  if (path.startsWith('/host')) return <Host />;
  if (path.startsWith('/packs')) return <PackManager />;
  return <Display />;
}
