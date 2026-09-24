<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# One branch per request (mandatory)

Every feature, fix or request is built on its own branch. `main` is never
committed to directly.

- Before editing anything: `git switch -c feat/<slug>` (or `fix/`, `docs/`,
  `chore/`) from an up-to-date `main`. One branch = one request.
- **The working tree usually carries unrelated work in progress.** Stage files
  by explicit path (`git add <paths>`). Never `git add -A`, `git add .` or
  `git commit -a`. If one of your files also holds someone else's in-flight
  changes, stage only your hunks (`git add -p`) or ask before committing it.
- **Every commit must stand on its own**: never import a file that a later
  commit adds. Check the commit you are about to make with
  `pnpm exec tsc --noEmit` before writing it.
- Conventional Commits, in the language the history already uses.
- Do not push, and never rewrite pushed history (`--force`), without an
  explicit request. `--force-with-lease` only, and only when asked.
- Close a request with `pnpm test && pnpm lint && pnpm build`, and report the
  branch name in the final message.
- `openspec/` is gitignored: proposals and specs are written to disk, never
  committed.

