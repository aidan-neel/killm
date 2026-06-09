#!/usr/bin/env node
import { main } from './index.js';

// Exit quietly if our output is piped into something that closes early
// (e.g. `killm --list | head`), rather than crashing on EPIPE.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err?.code === 'EPIPE') process.exit(0);
  throw err;
});

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code || 0;
  })
  .catch((err: unknown) => {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`killm: unexpected error: ${detail}\n`);
    process.exitCode = 1;
  });
