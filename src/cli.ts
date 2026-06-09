import fs from 'node:fs';

import { parseDuration } from './duration.js';
import type { Scope } from './targets.js';

export type Command = 'help' | 'version' | 'status' | 'list' | 'restore' | 'run';

export interface ParsedArgs {
  command: Command;
  scope: Scope;
  dryRun: boolean;
  yes: boolean;
  durationInput?: string;
  durationMs?: number;
  error?: string;
}

export const VERSION: string = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version;

export const HELP = `killm — temporarily block your machine from reaching LLM services

USAGE
  npx killm for <duration> [scope] [options]
  npx killm <duration> [scope] [options]

  The word "for" is optional sugar:  killm for 1h --agents  ==  killm 1h --agents

DURATION
  Combine units d/h/m/s, e.g.  90s  30m  1h  1h30m  2d
  A bare number means minutes, e.g.  45  ==  45m

SCOPE  (pick one or more; default is --all)
  --agents   Block agentic coding + raw API endpoints (api.anthropic.com,
             api.openai.com, Cursor, Copilot, Codeium, ...). Leaves the
             chat websites (claude.ai, chatgpt.com) reachable.
  --web      Block consumer chat websites (claude.ai, chatgpt.com,
             gemini.google.com, perplexity.ai, ...). Leaves API endpoints
             reachable so other tooling keeps working.
  --all      Block both of the above. This is the default if no scope is given.

OPTIONS
  --restore        Remove any active killm block right now and exit.
  --status         Show whether a block is currently active and exit.
  --list           Print the hostnames that would be blocked and exit.
  --dry-run        Show what would change without touching the hosts file.
  -y, --yes        Don't prompt for confirmation.
  -h, --help       Show this help.
  -v, --version    Show version.

EXAMPLES
  npx killm for 1h --agents          Block coding agents for an hour.
  npx killm 30m --web                Block chat websites for 30 minutes.
  npx killm for 2h --all             Block everything for two hours.
  npx killm --restore                Lift an active block early.

NOTE
  Editing the hosts file requires elevated privileges. Run with sudo on
  macOS/Linux, or from an Administrator terminal on Windows.
`;

/**
 * Parse argv (without node/script) into a structured command.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: 'run',
    scope: { agents: false, web: false, all: false },
    dryRun: false,
    yes: false,
  };

  let explicit: 'status' | 'list' | 'restore' | undefined;
  let durationInput: string | undefined;

  for (const arg of argv) {
    switch (arg) {
      case '-h':
      case '--help':
        return { ...result, command: 'help' };
      case '-v':
      case '--version':
        return { ...result, command: 'version' };
      case '--status':
        explicit = 'status';
        break;
      case '--list':
        explicit = 'list';
        break;
      case '--restore':
      case '--unblock':
        explicit = 'restore';
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '-y':
      case '--yes':
        result.yes = true;
        break;
      case '--agents':
        result.scope.agents = true;
        break;
      case '--web':
        result.scope.web = true;
        break;
      case '--all':
        result.scope.all = true;
        break;
      case 'for':
        // Noise word, ignore.
        break;
      default:
        if (arg.startsWith('-')) {
          return { ...result, command: 'help', error: `unknown option: ${arg}` };
        }
        if (durationInput !== undefined) {
          return { ...result, command: 'help', error: `unexpected argument: ${arg}` };
        }
        durationInput = arg;
        break;
    }
  }

  // Terminal sub-commands that don't need a duration.
  if (explicit === 'restore') return { ...result, command: 'restore' };
  if (explicit === 'status') return { ...result, command: 'status' };

  // --list needs to know the scope but not a duration.
  if (explicit === 'list') {
    if (!result.scope.agents && !result.scope.web && !result.scope.all) {
      result.scope.all = true;
    }
    return { ...result, command: 'list' };
  }

  // From here we're running a block, which requires a duration.
  if (durationInput === undefined) {
    return {
      ...result,
      command: 'help',
      error: 'a duration is required, e.g. "killm for 1h --agents"',
    };
  }

  let durationMs: number;
  try {
    durationMs = parseDuration(durationInput);
  } catch (err) {
    return { ...result, command: 'help', error: (err as Error).message };
  }

  // Default scope: everything.
  if (!result.scope.agents && !result.scope.web && !result.scope.all) {
    result.scope.all = true;
  }

  return { ...result, command: 'run', durationInput, durationMs };
}
