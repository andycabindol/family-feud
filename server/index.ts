import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { type GameState, GameError, initialState, toView } from '../src/shared/game';
import { type Session, newSession, step } from '../src/shared/history';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol';
import type { Pack } from '../src/shared/types';
import { sortAnswers, validateQuestion } from '../src/shared/validate';

const PORT = Number(process.env.PORT ?? 3001);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data');
const DIST_DIR = path.join(ROOT, 'dist');
const PACKS_FILE = path.join(DATA_DIR, 'packs.json');
const GAME_FILE = path.join(DATA_DIR, 'game.json');
const PLAYED_FILE = path.join(DATA_DIR, 'played.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

// ------------------------------------------------------------------ Custom packs

let customPacks: Pack[] = readJson<Pack[]>(PACKS_FILE, []);

function sanitizePack(raw: unknown, id: string): { pack?: Pack; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Invalid pack.' };
  const p = raw as Partial<Pack>;
  if (!id.startsWith('custom-')) return { error: 'Custom pack ids must start with "custom-".' };
  const name = String(p.name ?? '').trim();
  if (!name) return { error: 'Pack name is required.' };
  if (!Array.isArray(p.questions)) return { error: 'Pack needs a questions list.' };
  const problems: string[] = [];
  const questions = p.questions.map((q, i) => {
    const answers = sortAnswers(
      (q.answers ?? []).map((a) => ({
        text: String(a.text ?? '').trim(),
        points: Number(a.points),
        aliases: (a.aliases ?? []).map((x) => String(x).trim()).filter(Boolean),
      })),
    );
    const question = {
      id: String(q.id || `${id}:${i}`),
      themeId: id,
      text: String(q.text ?? '').trim(),
      category: String(q.category ?? '').trim() || 'General',
      difficulty: (['easy', 'medium', 'hard'] as const).includes(q.difficulty) ? q.difficulty : 'medium',
      answers,
      source: q.source && (q.source.type === 'survey' || q.source.type === 'estimated') ? q.source : { type: 'estimated' as const, name: 'Custom' },
    };
    const { errors } = validateQuestion(question);
    errors.forEach((e) => problems.push(`"${question.text || `#${i + 1}`}": ${e}`));
    return question;
  });
  if (problems.length) return { error: problems.slice(0, 5).join(' ') };
  return {
    pack: { id, name, description: String(p.description ?? ''), builtIn: false, questions, updatedAt: Date.now() },
  };
}

// ------------------------------------------------------------------ Played questions

/** Question ids used in past games, grouped by theme (pack) id. Survives restarts. */
let played: Record<string, string[]> = readJson<Record<string, string[]>>(PLAYED_FILE, {});

function recordPlayed(s: GameState) {
  for (const q of [...s.rounds, ...s.fastMoney]) {
    const list = played[q.themeId] ?? [];
    if (!list.includes(q.id)) played[q.themeId] = [...list, q.id];
  }
  writeJsonAtomic(PLAYED_FILE, played);
}

// ------------------------------------------------------------------ Game

// Undo history lives in memory; it starts empty after a server restart.
let session: Session = newSession(readJson<GameState>(GAME_FILE, initialState()));
const viewNow = () => toView(session.state, Date.now(), session.past.length > 0);
let saveTimer: NodeJS.Timeout | null = null;

function persistSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      writeJsonAtomic(GAME_FILE, session.state);
    } catch (e) {
      console.error('Could not save game state', e);
    }
  }, 250);
}

const clients = new Map<WebSocket, 'display' | 'host'>();

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast() {
  const view = viewNow();
  for (const ws of clients.keys()) send(ws, { type: 'state', view });
}

// ------------------------------------------------------------------ HTTP

function lanUrls(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces()))
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

function readBody(req: http.IncomingMessage, limit = 10_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!fs.existsSync(DIST_DIR)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Frontend not built. Run `npm run build`, or use `npm run dev` and open http://localhost:5173');
    return;
  }
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.join(DIST_DIR, urlPath);
  if (!file.startsWith(DIST_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST_DIR, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/api/info') return json(res, 200, { lan: lanUrls() });

    if (url.pathname === '/api/packs' && req.method === 'GET') return json(res, 200, customPacks);

    if (url.pathname === '/api/played' && req.method === 'GET') return json(res, 200, played);
    if (url.pathname === '/api/played/clear' && req.method === 'POST') {
      const { themeIds } = JSON.parse(await readBody(req)) as { themeIds?: unknown };
      if (!Array.isArray(themeIds)) return json(res, 400, { error: 'themeIds must be a list.' });
      for (const id of themeIds) delete played[String(id)];
      writeJsonAtomic(PLAYED_FILE, played);
      return json(res, 200, played);
    }

    const m = url.pathname.match(/^\/api\/packs\/([\w-]+)$/);
    if (m) {
      const id = m[1];
      if (req.method === 'PUT') {
        const { pack, error } = sanitizePack(JSON.parse(await readBody(req)), id);
        if (!pack) return json(res, 400, { error });
        customPacks = [...customPacks.filter((p) => p.id !== id), pack].sort((a, b) => a.name.localeCompare(b.name));
        writeJsonAtomic(PACKS_FILE, customPacks);
        return json(res, 200, pack);
      }
      if (req.method === 'DELETE') {
        customPacks = customPacks.filter((p) => p.id !== id);
        writeJsonAtomic(PACKS_FILE, customPacks);
        return json(res, 200, { ok: true });
      }
    }

    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    serveStatic(req, res);
  } catch (e) {
    json(res, 400, { error: (e as Error).message });
  }
});

// ------------------------------------------------------------------ WebSocket

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 20 * 1024 * 1024 });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      clients.set(ws, msg.role);
      send(ws, { type: 'state', view: viewNow() });
      return;
    }
    if (msg.type === 'action') {
      try {
        session = step(session, msg.action, { rng: Math.random, now: Date.now() });
        persistSoon();
        if (['startGame', 'setUpcomingTheme', 'rerollUpcoming', 'fmChangeTheme', 'fmReplace'].includes(msg.action.type)) {
          try {
            recordPlayed(session.state);
          } catch (e) {
            console.error('Could not save played questions', e);
          }
        }
        broadcast();
      } catch (e) {
        if (e instanceof GameError) send(ws, { type: 'error', message: e.message });
        else {
          console.error(e);
          send(ws, { type: 'error', message: 'Something went wrong.' });
        }
      }
    }
  });
  ws.on('close', () => clients.delete(ws));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Family Feud server on :${PORT}`);
  for (const ip of lanUrls()) console.log(`  LAN: http://${ip}:${PORT}`);
});
