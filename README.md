# killm

**Temporarily block your machine from reaching LLM services, to curb AI dependency.**

```bash
npx killm for 1h --agents      # no coding agents for an hour
npx killm 30m --web            # no chat websites for 30 minutes
npx killm for 2h --all         # cut everything off for two hours
```

---

## Run

```bash
npx killm for 1h --agents
```

Editing the hosts file needs elevated privileges:

- **macOS / Linux:** prefix with `sudo` → `sudo npx killm for 1h --agents`
- **Windows:** run from an **Administrator** terminal

## Agents vs. Web

The whole point of `killm` is that an agentic coding tool and a chat website
talk to **different hostnames**, so you can cut one without losing the other:

| Tool                        | Hostname            | Scope      |
| --------------------------- | ------------------- | ---------- |
| Claude Code, Aider, raw API | `api.anthropic.com` | `--agents` |
| Claude chat website         | `claude.ai`         | `--web`    |
| OpenAI API, Codex           | `api.openai.com`    | `--agents` |
| ChatGPT website             | `chatgpt.com`       | `--web`    |

So:

- **`--agents`** blocks API endpoints and dedicated coding-assistant backends.
- **`--web`** blocks the consumer chat websites (`claude.ai`, `chatgpt.com`,
  `gemini.google.com`, `perplexity.ai`, etc).
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

## Firewall mode (`--firewall`)

The hosts file only intercepts name resolution, so a browser with **Secure DNS** 
enabled bypasses it. `--firewall` closes that hole: in addition to the
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

## License

MIT © Aidan Neel
