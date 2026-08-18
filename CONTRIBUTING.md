# Contributing

Thanks for taking a look. This is a small, focused project — a desktop reader for translating
and annotating academic PDFs — and contributions are welcome.

## Getting set up

```bash
npm install
npm run dev
```

You'll need [Node.js](https://nodejs.org) 20+. To exercise translation you also need a local
[LM Studio](https://lmstudio.ai) server running (see the README), or a Gemini API key in
Settings.

## Before opening a pull request

```bash
npm run typecheck
npm run lint
npm run format
```

CI runs exactly these three plus a build, so a green local run means a green PR.

## Where things live

- `src/main/` — Electron main process: the sql.js database, LLM calls, IPC handlers.
- `src/preload/` — the `window.api` surface. Adding an IPC channel means touching the handler
  in `main/index.ts` _and_ the wrapper here.
- `src/renderer/` — the React UI, one file per page under `pages/`.
- `src/shared/` — types used by both processes.

### A note on `renderer/src/lib/pdfLayout.ts`

This file reconstructs a page's reading structure (headings, paragraphs, figures, tables,
charts, footnotes) from what pdf.js reports, and it is where most of the subtlety in this
project lives. Two things worth knowing before changing it:

1. **It is heuristic, and the constants at the top are load-bearing.** Each one has a comment
   explaining what real-world layout it exists to handle. Please extend those comments rather
   than replacing them, so the next person knows which case a threshold protects.

2. **Test against real PDFs, not just reasoning.** Layout bugs are almost never visible by
   reading the code. Generate a small fixture PDF that reproduces the layout you care about,
   run the extractor over it, and check the block list before and after your change — a
   change that fixes one paper very easily breaks another.

## Reporting bugs

Layout issues are much easier to fix with the PDF in hand. If the paper is public, a link or
DOI is ideal; if it isn't, a page screenshot plus what you expected to see is usually enough.
