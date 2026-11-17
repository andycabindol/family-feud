import type { Pack, Question } from '../types';
import { ESTIMATED_SOURCE, difficultyFrom, sortAnswers } from '../validate';

/**
 * Compact authoring format used for the built-in packs:
 *   Question text | Category | e/m/h | Answer:points:alias,alias ; Answer:points ; ...
 */
export function parseCompact(themeId: string, lines: string[]): Question[] {
  return lines.map((line, i) => {
    const parts = line.split(' | ').map((s) => s.trim());
    if (parts.length !== 4) throw new Error(`[${themeId}] bad line ${i + 1}: ${line}`);
    const [text, category, diff, answerStr] = parts;
    const answers = answerStr.split(' ; ').map((chunk) => {
      const [name, pts, aliasStr] = chunk.split(':').map((s) => s.trim());
      const points = Number(pts);
      if (!name || !Number.isInteger(points)) throw new Error(`[${themeId}] bad answer "${chunk}" in: ${text}`);
      return {
        text: name,
        points,
        aliases: aliasStr ? aliasStr.split(',').map((s) => s.trim()).filter(Boolean) : [],
      };
    });
    return {
      id: `${themeId}-${String(i + 1).padStart(2, '0')}`,
      themeId,
      text,
      category,
      difficulty: difficultyFrom(diff),
      answers: sortAnswers(answers),
      source: { ...ESTIMATED_SOURCE },
    };
  });
}

export function builtInPack(id: string, name: string, description: string, lines: string[]): Pack {
  return { id, name, description, builtIn: true, questions: parseCompact(id, lines), updatedAt: 0 };
}
