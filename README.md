# killm

**Temporarily block your machine from reaching LLM services, to curb AI dependency.**

`killm` is a zero-dependency CLI. You give it a duration and a scope, and for
that window it points the relevant LLM hostnames at a dead address in your
system hosts file. When the timer runs out — or you hit `Ctrl+C` — it restores
everything automatically.

```bash
npx killm for 1h --agents      # no coding agents for an hour
npx killm 30m --web            # no chat websites for 30 minutes
npx killm for 2h --all         # cut everything off for two hours
```

No account, no proxy, no daemon. Just a timed edit to your hosts file that
cleans up after itself.

---

## Why

It's easy to reach for an LLM by reflex — autocomplete in the editor, a chat tab
for every small question — and lose the muscle of thinking a problem through.
`killm` lets you put a hard, time-boxed wall between you and that reflex without
uninstalling your tools or changing your accounts. The wall comes down on its
own; you don't have to remember to turn anything back on.

## Install / run

No install needed — run it on demand with `npx`:

```bash
npx killm for 1h --agents
```

Editing the hosts file needs elevated privileges:

- **macOS / Linux:** prefix with `sudo` → `sudo npx killm for 1h --agents`
- **Windows:** run from an **Administrator** terminal

## The key idea: agents vs. web

The whole point of `killm` is that an agentic coding tool and a chat website
talk to **different hostnames**, so you can cut one without losing the other:

| Tool                        | Hostname            | Scope      |
| --------------------------- | ------------------- | ---------- |
| Claude Code, Aider, raw API | `api.anthropic.com` | `--agents` |
| Claude chat website         | `claude.ai`         | `--web`    |
| OpenAI API, Codex           | `api.openai.com`    | `--agents` |
| ChatGPT website             | `chatgpt.com`       | `--web`    |

So:

- **`--agents`** blocks API endpoints and dedicated coding-assistant backends
  (Cursor, GitHub Copilot, Codeium/Windsurf, Cody, Tabnine, Continue, …). Your
  coding agents go dark, but you can still open `claude.ai` or `chatgpt.com` in a
  browser if you genuinely need to.
- **`--web`** blocks the consumer chat websites (`claude.ai`, `chatgpt.com`,
  `gemini.google.com`, `perplexity.ai`, …). Your API-based tooling keeps working.
- **`--all`** blocks both. This is the default if you don't pass a scope.

## Usage

```
npx killm for <duration> [scope] [options]
npx killm <duration> [scope] [options]
```

The word `for` is optional sugar — `killm for 1h --agents` and
`killm 1h --agents` are identical.

### Duration

Combine units `d` / `h` / `m` / `s`:

```
90s    30m    1h    1h30m    2d
```

A bare number is treated as minutes (`45` = `45m`).

### Scope

| Flag       | Blocks                                   |
| ---------- | ---------------------------------------- |
| `--agents` | Agentic coding tools + raw API endpoints |
| `--web`    | Consumer chat websites                   |
| `--all`    | Both (default)                           |

You can combine `--agents` and `--web`; that's the same as `--all`.

### Options

| Option            | Effect                                           |
| ----------------- | ------------------------------------------------ |
| `--restore`       | Lift any active block right now and exit         |
| `--status`        | Report whether a block is currently active       |
| `--list`          | Print the hostnames a given scope would block    |
| `--dry-run`       | Show what would change without touching anything |
| `-y`, `--yes`     | Skip the confirmation prompt                     |
| `-h`, `--help`    | Show help                                        |
| `-v`, `--version` | Show version                                     |

### Examples

```bash
npx killm for 1h --agents          # coding agents off for an hour
npx killm 30m --web                # chat websites off for 30 minutes
npx killm for 2h --all             # everything off for two hours
npx killm --list --agents          # see exactly what --agents blocks
npx killm for 25m --web --dry-run  # preview, change nothing
npx killm --restore                # end an active block early
npx killm --status                 # is a block running right now?
```

## How it works

`killm` writes a clearly-marked block into your system hosts file
(`/etc/hosts`, or `…\System32\drivers\etc\hosts` on Windows) that points each
target hostname at `0.0.0.0` (and `::1` for IPv6):

```
# >>> killm block (do not edit between markers) >>>
# added by killm at 2026-06-09T17:58:07.849Z
# auto-removed at 2026-06-09T18:58:07.849Z (or when killm exits)
0.0.0.0	api.anthropic.com
::1	api.anthropic.com
...
# <<< killm block <<<
```

It then flushes the OS DNS cache so the change takes effect immediately. When
the timer expires, or on `Ctrl+C`, `SIGTERM`, or process exit, it strips that
block back out and flushes again. The markers mean it only ever touches its own
lines — your existing hosts entries are left alone.

If something goes wrong and a block is left behind, `sudo npx killm --restore`
(or the Administrator equivalent) cleans it up.

## Limitations & honesty

`killm` is a **speed bump, not a vault.** It's designed to defeat reflex, not a
determined workaround:

- It blocks by **hostname**, so it can't block a single path on a shared domain.
- Anyone with admin rights can edit the hosts file back, use a different DNS
  resolver, a VPN, or a phone. That's fine — the goal is to make the easy thing
  hard, not to make it impossible.
- Hostname lists drift as providers add endpoints. `--list` shows the current
  set; PRs to keep it current are welcome.

## Development

The CLI is written in TypeScript (ESM) with zero runtime dependencies; tests
run against the compiled output, so they exercise exactly what ships.

```bash
npm ci               # install dev toolchain
npm run build        # compile TypeScript to dist/
npm test             # build + run the test suite (node:test)
npm run lint         # eslint
npm run format       # prettier --write
npm run typecheck    # tsc --noEmit
```

CI runs lint, format, typecheck, and the test matrix (Linux/macOS/Windows ×
Node 18/20/22) on every push and PR. Publishing happens automatically when a
GitHub release is published (requires the `NPM_TOKEN` repo secret).

## License

MIT © Aidan Neel
