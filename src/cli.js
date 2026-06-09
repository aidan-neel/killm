'use strict';

const { parseDuration } = require('./duration');

const VERSION = require('../package.json').version;

const HELP = `killm — temporarily block your machine from reaching LLM services

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
 *
 * @param {string[]} argv
 * @returns {{
 *   command: 'help'|'version'|'status'|'list'|'restore'|'run',
 *   durationMs?: number,
 *   durationInput?: string,
 *   scope: {agents:boolean, web:boolean, all:boolean},
 *   dryRun: boolean,
 *   yes: boolean,
 *   error?: string
 * }}
 */
function parseArgs(argv) {
  const result = {
    command: 'run',
    scope: { agents: false, web: false, all: false },
    dryRun: false,
    yes: false,
  };

  let durationInput;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        return { ...result, command: 'help' };
      case '-v':
      case '--version':
        return { ...result, command: 'version' };
      case '--status':
        result.command = result.command === 'run' ? 'status' : result.command;
        result._explicit = 'status';
        break;
      case '--list':
        result._explicit = 'list';
        break;
      case '--restore':
      case '--unblock':
        result._explicit = 'restore';
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
  if (result._explicit === 'restore') return { ...result, command: 'restore' };
  if (result._explicit === 'status') return { ...result, command: 'status' };

  // --list needs to know the scope but not a duration.
  if (result._explicit === 'list') {
    if (!result.scope.agents && !result.scope.web && !result.scope.all) {
      result.scope.all = true;
    }
    return { ...result, command: 'list' };
  }

  // From here we're running a block, which requires a duration.
  if (durationInput === undefined) {
    return { ...result, command: 'help', error: 'a duration is required, e.g. "killm for 1h --agents"' };
  }

  let durationMs;
  try {
    durationMs = parseDuration(durationInput);
  } catch (err) {
    return { ...result, command: 'help', error: err.message };
  }

  // Default scope: everything.
  if (!result.scope.agents && !result.scope.web && !result.scope.all) {
    result.scope.all = true;
  }

  return {
    ...result,
    command: 'run',
    durationInput,
    durationMs,
  };
}

module.exports = { parseArgs, HELP, VERSION };
