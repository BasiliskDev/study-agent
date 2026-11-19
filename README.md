# study-agent

A study agent that connects to Canvas, files your courses by subject, and has Claude write practice problem sets from your actual
course material: automatically for recent lectures, for a specific exam, or for anything you ask.

## Setup

```bash
npm install
cp apps/web/.env.example apps/web/.env.local   # add ANTHROPIC_API_KEY
npm run dev                                     # http://localhost:3100
```

1. **Settings → Canvas**: your Canvas URL (e.g. `https://courseworks2.columbia.edu`) and an access token from
   Canvas → Account → Settings → *New Access Token*. The token is encrypted (AES-256-GCM) before it's stored and only ever
   sent to your Canvas host.
2. **Sync with Canvas**: pulls active courses, files them by subject (from the course code: APMA→Math, COMS→CS, …; change it on
   the course page), downloads syllabus, pages and lecture PDFs, and has Claude build a topic outline per course (units, topics,
   exam coverage).
3. **Open a course → Generate**: *Exam prep* (pick an exam from the outline, optionally timed), *Recent material*, or
   *Ask for anything*. The agent reads your materials, writes the set, and a second model re-solves every answer blind to flag
   mistakes.

No API key yet? Sync still works, and "Try a sample set" loads questions from the old W3134 drill so you can try the player.

## Layout

```
apps/web/            Next.js app (UI, server actions, agent, SQLite via Drizzle/libSQL)
  lib/sync.ts        Canvas → materials (incremental; PDF text extraction; full-text index)
  lib/outline.ts     Claude builds the per-course TopicOutline (structured output)
  lib/agent/         generation agent: tool runner + Canvas MCP tools + local tools, answer verifier
  app/set/[id]/      the player: practice, flashcards, timed mock exam, progress tracking
packages/canvas/     Canvas REST client + read-only Canvas MCP server
packages/schema/     zod schemas shared by agent, DB and player (ProblemSet, TopicOutline)
artifacts/           the original standalone drills, served unchanged at /legacy/<name> and linked from their course
```

## How generation works

`lib/agent/generate.ts` runs Claude (`claude-opus-5-5`) in the SDK tool runner with:

- **Canvas MCP tools** (`get_syllabus`, `list_modules`, `get_page`), connected in-process to `packages/canvas`'s MCP server
- **Local tools**: `search_materials` (SQLite FTS5 over synced text), `read_material` (text by page range, or the real PDF via the
  Files API, uploaded once and cached), and `save_problem_set` (validated against the zod schema; ends the run)

The course outline and materials index go in a cached prompt prefix. Problem sets are Markdown + LaTeX only, and the player
escapes any raw HTML. After saving, `verify.ts` re-solves math/science/CS problems with code execution (without seeing the key),
compares the results, and flags disagreements in the player.

## Canvas MCP server for Claude Code / Desktop

The same server works on its own:

```bash
claude mcp add canvas -e CANVAS_BASE_URL=https://yourschool.instructure.com -e CANVAS_TOKEN=... \
  -- npx tsx /path/to/study-agent/packages/canvas/src/bin.ts
```

Tools: `list_courses`, `get_syllabus`, `list_modules`, `get_page`, `list_files`, `get_file_text`. All read-only.

## Scripts

| | |
|---|---|
| `npm run dev` | app on :3100 |
| `npm test` | unit tests + sync/agent-tools/MCP integration test against a fake Canvas |
| `npm run typecheck` | all packages |
| `npm run mcp` | stdio MCP server (needs `CANVAS_BASE_URL`, `CANVAS_TOKEN`) |
| `POST /api/sync` | start a sync from a script or cron |

## Hosting later

Built to move: every query is scoped by user id (one local user today), the DB driver is libSQL (point `DATABASE_URL` at Turso),
and file storage is behind `lib/storage.ts`. Still needed: auth, a durable job queue in place of the in-process jobs in
`lib/jobs.ts`, and blob storage.

## Original drills

| Folder | Course | What it is |
|---|---|---|
| `e2000-midterm-1-drill` / `-2-drill` | APMA E2000 | Randomized multivariable-calc problems with worked solutions |
| `chem-exam-3-mo-vsepr` | Chem | MO theory, VSEPR, hybridization |
| `functional-group-drills` | Chem UN1403 | Flashcards, quiz and timed match game |
| `w3134-exam-1-drills` | COMS W3134 | Flashcards, topic quizzes, complexity matching, mock exam |
| `red-black-tree-trainer` | COMS W3134 | Interactive red-black tree insertion trainer |
| `study-dashboard` | All | To-do dashboard; depends on the claude.ai artifact runtime, not wired up here |

Their procedural generators (`gSphere`, `gLag*`, …) are candidates for a future `procedural` tool the agent can call.
