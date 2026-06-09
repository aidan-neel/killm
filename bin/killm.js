#!/usr/bin/env node
'use strict';

const { main } = require('../src/index');

// Exit quietly if our output is piped into something that closes early
// (e.g. `killm --list | head`), rather than crashing on EPIPE.
process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
  throw err;
});

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code || 0;
  })
  .catch((err) => {
    process.stderr.write(`killm: unexpected error: ${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  });
