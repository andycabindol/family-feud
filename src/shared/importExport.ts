import type { Answer, Pack, Question, SurveySource } from './types';
import { slug, uid } from './ids';
import { ESTIMATED_SOURCE, difficultyFrom, sortAnswers, validateQuestion } from './validate';

export interface ImportedQuestion {
  /** Pack name given in the file (CSV `pack` column / JSON pack name), if any. */
  packName?: string;
  question: Omit<Question, 'id' | 'themeId'>;
}

export interface ImportResult {
  items: ImportedQuestion[];
  /** Problems that prevented a question from being imported. */
  rejected: { label: string; reasons: string[] }[];
  warnings: string[];
}

// ---------------------------------------------------------------- CSV

/** RFC-4180-ish CSV parser (quotes, escaped quotes, newlines inside quotes). */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

function csvEscape(v: string | number | undefined): string {
  const s = v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = [
  'pack', 'question', 'category', 'difficulty', 'answer', 'points', 'aliases', 'source_type', 'source_name', 'source_year', 'source_sample_size', 'source_note',
];

/** One row per answer. Aliases are separated with `|`. */
export function questionsToCsv(packName: string, questions: Omit<Question, 'id' | 'themeId'>[] | Question[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const q of questions) {
    q.answers.forEach((a, i) => {
      const first = i === 0;
      lines.push(
        [
          packName,
          q.text,
          first ? q.category : '',
          first ? q.difficulty : '',
          a.text,
          a.points,
          a.aliases.join('|'),
          first ? q.source.type : '',
          first ? q.source.name : '',
          first ? q.source.year : '',
          first ? q.source.sampleSize : '',
          first ? q.source.note : '',
        ].map(csvEscape).join(','),
      );
    });
  }
  return lines.join('\n') + '\n';
}

function parseSource(get: (k: string) => string): SurveySource {
  const type = get('source_type').toLowerCase().startsWith('survey') ? 'survey' : 'estimated';
  const name = get('source_name') || (type === 'estimated' ? ESTIMATED_SOURCE.name : 'Unspecified survey');
  const year = Number(get('source_year'));
  const sampleSize = Number(get('source_sample_size'));
  const source: SurveySource = { type, name };
  if (Number.isFinite(year) && year > 0) source.year = year;
  if (Number.isFinite(sampleSize) && sampleSize > 0) source.sampleSize = sampleSize;
  const note = get('source_note');
  if (note) source.note = note;
  else if (type === 'estimated') source.note = ESTIMATED_SOURCE.note;
  return source;
}

export function importCsv(text: string): ImportResult {
  const rows = parseCsv(text);
  const result: ImportResult = { items: [], rejected: [], warnings: [] };
  if (rows.length < 2) {
    result.warnings.push('CSV has no data rows.');
    return result;
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col('question') < 0 || col('answer') < 0 || col('points') < 0) {
    result.warnings.push('CSV needs at least the columns: question, answer, points (see the template).');
    return result;
  }

  interface Draft {
    packName?: string;
    text: string;
    category: string;
    difficulty: string;
    answers: Answer[];
    sourceRow: string[];
  }
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  for (const row of rows.slice(1)) {
    const get = (k: string) => (col(k) >= 0 ? (row[col(k)] ?? '').trim() : '');
    const text = get('question');
    const packName = get('pack') || undefined;
    if (!current || text !== current.text || packName !== current.packName) {
      current = { packName, text, category: get('category'), difficulty: get('difficulty'), answers: [], sourceRow: row };
      drafts.push(current);
    } else {
      current.category ||= get('category');
      current.difficulty ||= get('difficulty');
    }
    const aliases = get('aliases').split('|').map((s) => s.trim()).filter(Boolean);
    current.answers.push({ text: get('answer'), points: Number(get('points')), aliases });
  }

  for (const d of drafts) {
    const get = (k: string) => (col(k) >= 0 ? (d.sourceRow[col(k)] ?? '').trim() : '');
    const question = {
      text: d.text,
      category: d.category || 'General',
      difficulty: difficultyFrom(d.difficulty),
      answers: sortAnswers(d.answers),
      source: parseSource(get),
    };
    const issues = validateQuestion(question);
    if (issues.errors.length) result.rejected.push({ label: d.text || '(blank question)', reasons: issues.errors });
    else result.items.push({ packName: d.packName, question });
  }
  return result;
}

// ---------------------------------------------------------------- JSON

interface LooseAnswer { text?: unknown; answer?: unknown; points?: unknown; aliases?: unknown; accepted?: unknown }
interface LooseQuestion { text?: unknown; question?: unknown; category?: unknown; difficulty?: unknown; source?: unknown; answers?: unknown }

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function looseSource(v: unknown): SurveySource {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const type = str(o.type).toLowerCase() === 'survey' ? 'survey' : 'estimated';
    const s: SurveySource = { type, name: str(o.name) || (type === 'estimated' ? ESTIMATED_SOURCE.name : 'Unspecified survey') };
    if (Number(o.year) > 0) s.year = Number(o.year);
    if (Number(o.sampleSize) > 0) s.sampleSize = Number(o.sampleSize);
    if (str(o.url)) s.url = str(o.url);
    s.note = str(o.note) || (type === 'estimated' ? ESTIMATED_SOURCE.note : undefined);
    return s;
  }
  if (typeof v === 'string' && v.trim()) return { type: 'estimated', name: v.trim(), note: ESTIMATED_SOURCE.note };
  return { ...ESTIMATED_SOURCE };
}

function importLooseQuestion(raw: LooseQuestion, packName: string | undefined, result: ImportResult, index: number) {
  const text = str(raw.text) || str(raw.question);
  const answersRaw = Array.isArray(raw.answers) ? (raw.answers as LooseAnswer[]) : [];
  const answers: Answer[] = answersRaw.map((a) => {
    const aliasSrc = a.aliases ?? a.accepted;
    const aliases = Array.isArray(aliasSrc) ? aliasSrc.map(str).filter(Boolean) : typeof aliasSrc === 'string' ? aliasSrc.split(/[|,]/).map((s) => s.trim()).filter(Boolean) : [];
    return { text: str(a.text) || str(a.answer), points: Number(a.points), aliases };
  });
  const question = {
    text,
    category: str(raw.category) || 'General',
    difficulty: difficultyFrom(str(raw.difficulty)),
    answers: sortAnswers(answers),
    source: looseSource(raw.source),
  };
  const issues = validateQuestion(question);
  if (issues.errors.length) result.rejected.push({ label: text || `Question #${index + 1}`, reasons: issues.errors });
  else result.items.push({ packName, question });
}

export function importJson(text: string): ImportResult {
  const result: ImportResult = { items: [], rejected: [], warnings: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    result.warnings.push(`Not valid JSON: ${(e as Error).message}`);
    return result;
  }
  const addPack = (p: Record<string, unknown>) => {
    const name = str(p.name) || undefined;
    const qs = Array.isArray(p.questions) ? p.questions : [];
    qs.forEach((q, i) => importLooseQuestion(q as LooseQuestion, name, result, i));
  };
  if (Array.isArray(data)) {
    if (data.length && typeof data[0] === 'object' && data[0] && 'questions' in (data[0] as object))
      (data as Record<string, unknown>[]).forEach(addPack);
    else data.forEach((q, i) => importLooseQuestion(q as LooseQuestion, undefined, result, i));
  } else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.packs)) (o.packs as Record<string, unknown>[]).forEach(addPack);
    else if (Array.isArray(o.questions)) addPack(o);
    else result.warnings.push('Expected a "questions" array, a "packs" array, or a list of questions.');
  } else result.warnings.push('Unrecognised JSON structure.');
  return result;
}

/** Auto-detects JSON vs CSV. */
export function importText(text: string): ImportResult {
  const t = text.trim();
  if (!t) return { items: [], rejected: [], warnings: ['Nothing to import.'] };
  return t.startsWith('{') || t.startsWith('[') ? importJson(t) : importCsv(t);
}

export function packToJson(pack: Pack): string {
  return JSON.stringify(
    {
      name: pack.name,
      description: pack.description,
      questions: pack.questions.map(({ text, category, difficulty, answers, source }) => ({ text, category, difficulty, source, answers })),
    },
    null,
    2,
  );
}

export function materializeQuestions(packId: string, items: ImportedQuestion[]): Question[] {
  return items.map((i) => ({ ...i.question, id: `${packId}:${uid()}`, themeId: packId }));
}

export function newPackId(name: string): string {
  return `custom-${slug(name)}-${uid(4)}`;
}

export const CSV_TEMPLATE = questionsToCsv('My Pack', [
  {
    text: 'Name something you bring to a picnic',
    category: 'Food',
    difficulty: 'easy',
    source: { type: 'estimated', name: 'My guess', note: ESTIMATED_SOURCE.note },
    answers: [
      { text: 'Blanket', points: 30, aliases: ['towel', 'quilt'] },
      { text: 'Sandwiches', points: 25, aliases: ['sandwich', 'food'] },
      { text: 'Drinks', points: 18, aliases: ['soda', 'water', 'lemonade'] },
      { text: 'Chips', points: 12, aliases: ['snacks'] },
      { text: 'Fruit', points: 8, aliases: ['watermelon', 'grapes'] },
    ],
  },
]);
