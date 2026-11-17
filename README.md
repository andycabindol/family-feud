# Family Feud

A Family Feud-style game for a TV/laptop (the board) with a phone as the host remote.

```bash
npm install
npm run dev        # board: http://localhost:5173  ·  host phone: http://<your-LAN-ip>:5173/host
npm test           # engine + content tests
npm run build && npm start   # single-port production server on :3001
```

- `/` – the board (TV); shows a waiting screen until the host starts a game
- `/host` – game setup, then the host controller (reveal answers, strikes, award points, Fast Money, change the *next* question's theme)
- `/packs` – create, edit, import (JSON/CSV) and export custom question packs

## Question themes

Themes only change the questions/answers. Built-in themes: General, Thanksgiving (33 questions),
Christmas, Family & Relationships, Food & Drinks, Pop Culture, Kids & Family Friendly, plus
Custom Question Pack and Mixed Themes (percentage sliders, applied to rounds and Fast Money).

**Points in built-in packs are editorial estimates, not real survey results**, and are labelled
"Estimated points" everywhere. Custom questions can be marked as a real survey (name/year/sample size/link).

### Import formats

CSV (one row per answer; rows with the same `question` are grouped):

```
pack,question,category,difficulty,answer,points,aliases,source_type,source_name,source_year,source_sample_size,source_note
```

Only `question, answer, points` are required; `aliases` are separated by `|`. JSON accepts
`{ "name", "questions": [{ "text", "category", "difficulty", "source", "answers": [{ "text", "points", "aliases" }] }] }`,
a bare array of questions, or `{ "packs": [...] }`. Use the "Download CSV template" button in the importer.

Every question needs 4–8 answers with whole-number points; invalid rows are skipped with a reason.

## Data

Custom packs and the in-progress game are stored as JSON in `./data` (override with `DATA_DIR`).

## Deploying (Render)

1. Push this repo to GitHub, then in Render choose **New → Blueprint** and select it (it reads `render.yaml`).
2. When asked for `HOST_PIN`, enter the PIN you'll type on your phone at `/host`.
3. Open `https://<your-service>.onrender.com/` on the TV and `/host` on your phone.

`HOST_PIN` is optional locally. When set, only a host that knows it can change the game or packs; the TV page stays open.
The disk (`DATA_DIR=/var/data`) keeps custom packs, the played-questions memory and the in-progress game across restarts.
