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

### WSL users — read this

WSL and Windows have **separate hosts files**. Running `sudo npx killm` inside
WSL edits WSL's `/etc/hosts`, which only blocks processes running _inside_ WSL
(curl, node, coding agents in your WSL shell). Your browser is a Windows app —
it reads `C:\Windows\System32\drivers\etc\hosts` and is **not affected**.

To block Windows apps (the browser, Windows-side editors), run killm **on
Windows** from an Administrator PowerShell:

```powershell
npx killm for 1h --web
```

killm detects WSL and prints a warning when this applies. If you want both
sides blocked, run it in both places.

### Browser caveats

Two browser behaviors can make a block look like it isn't working:

- **Secure DNS (DNS-over-HTTPS):** when enabled, the browser resolves names
  through an encrypted remote resolver and **bypasses the hosts file
  entirely**. Disable it (Chrome/Edge: Settings → Privacy → Security → "Use
  secure DNS"; Firefox: Settings → Privacy → DNS over HTTPS) for the block to
  apply.
- **Browser DNS caching:** already-open tabs and cached lookups keep working
  for a while. Restart the browser, or clear its DNS cache
  (`chrome://net-internals/#dns` in Chrome/Edge).

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
| `--firewall`      | Also block current IPs at the OS firewall        |
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
the timer expires — or on `Ctrl+C`, `SIGTERM`, or closing the terminal
(`SIGHUP`) — it strips that block back out and flushes again. The markers mean
it only ever touches its own lines — your existing hosts entries are left
alone.

### If the killm process dies, the block stays — until killm heals it

The timer lives in the killm process, so **keep it running** for the duration.
Ctrl+C and closing the terminal both lift the block cleanly, but a `kill -9`,
a crash, or a machine shutdown can strand the block in your hosts file.

killm writes the expiry time into the block itself, so it self-heals: **any
later killm command** (`--status`, `--restore`, or starting a new block)
notices an expired stranded block and removes it. To lift one immediately:

```bash
sudo npx killm --restore
```

`killm --status` also tells you when an active block is scheduled to lift.

## Firewall mode (`--firewall`)

The hosts file only intercepts name resolution, so a browser with **Secure DNS
(DoH)** enabled bypasses it. `--firewall` closes that hole: in addition to the
hosts entries, killm resolves each target hostname to its **current IPs** and
blocks those at the OS firewall:

```bash
sudo npx killm for 1h --web --firewall
```

- **Linux:** `iptables` / `ip6tables` OUTPUT rules, tagged with a `killm`
  comment
- **Windows:** one outbound Windows Firewall rule named `killm` (via `netsh`)
- **macOS:** a `pf` anchor named `killm`

Rules are removed together with the hosts block (timer, `Ctrl+C`, or
`killm --restore` — which also sweeps up rules left behind by a crash, since
they're all tagged).

Caveats, honestly stated:

- IPs are captured **at block time**; if a provider rotates addresses
  mid-block, new IPs aren't covered.
- Big providers sit behind shared CDNs — blocking their current IPs _may_
  affect unrelated sites served from the same edge.
- Inside WSL, iptables rules (like the hosts file) only affect WSL traffic,
  not Windows apps.

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
