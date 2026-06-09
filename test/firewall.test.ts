import { test } from 'node:test';
import assert from 'node:assert';

import {
  RULE_TAG,
  resolveTargetIPs,
  linuxAddArgs,
  linuxDeleteArgsFromListing,
  windowsAddArgs,
  windowsDeleteArgs,
  darwinAnchorRules,
  applyFirewall,
  removeFirewall,
  type Resolver,
  type Runner,
  type ExecResult,
} from '../src/firewall.js';

interface Call {
  cmd: string;
  args: string[];
  stdin?: string;
}

/** A runner that records calls and replies from a canned response table. */
function fakeRunner(responses: Record<string, ExecResult> = {}): { calls: Call[]; run: Runner } {
  const calls: Call[] = [];
  const run: Runner = (cmd, args, stdin) => {
    calls.push({ cmd, args, stdin });
    const key = `${cmd} ${args.join(' ')}`;
    return Promise.resolve(responses[key] ?? { ok: true, stdout: '' });
  };
  return { calls, run };
}

const fakeResolver: Resolver = {
  resolve4: (host) =>
    host === 'unresolvable.example'
      ? Promise.reject(new Error('ENOTFOUND'))
      : Promise.resolve(['1.1.1.1', '2.2.2.2']),
  resolve6: (host) =>
    host === 'unresolvable.example' || host === 'v4only.example'
      ? Promise.reject(new Error('ENOTFOUND'))
      : Promise.resolve(['2606:4700::1']),
};

// ---- resolution -----------------------------------------------------------

test('resolveTargetIPs: collects, de-duplicates, and sorts v4/v6', async () => {
  const r = await resolveTargetIPs(['a.example', 'b.example'], fakeResolver);
  assert.deepStrictEqual(r.v4, ['1.1.1.1', '2.2.2.2']);
  assert.deepStrictEqual(r.v6, ['2606:4700::1']);
  assert.deepStrictEqual(r.unresolved, []);
});

test('resolveTargetIPs: reports unresolvable hosts without throwing', async () => {
  const r = await resolveTargetIPs(['a.example', 'unresolvable.example'], fakeResolver);
  assert.deepStrictEqual(r.unresolved, ['unresolvable.example']);
  assert.ok(r.v4.length > 0, 'resolvable hosts still resolved');
});

test('resolveTargetIPs: v4-only hosts are fine', async () => {
  const r = await resolveTargetIPs(['v4only.example'], fakeResolver);
  assert.deepStrictEqual(r.v4, ['1.1.1.1', '2.2.2.2']);
  assert.deepStrictEqual(r.v6, []);
  assert.deepStrictEqual(r.unresolved, []);
});

// ---- pure builders ---------------------------------------------------------

test('linuxAddArgs: REJECT rule tagged with the killm comment', () => {
  const args = linuxAddArgs('1.2.3.4');
  assert.deepStrictEqual(args, [
    '-I',
    'OUTPUT',
    '-d',
    '1.2.3.4',
    '-j',
    'REJECT',
    '-m',
    'comment',
    '--comment',
    RULE_TAG,
  ]);
});

test('linuxDeleteArgsFromListing: extracts only killm-tagged rules', () => {
  const listing = [
    '-P OUTPUT ACCEPT',
    '-A OUTPUT -d 1.2.3.4/32 -m comment --comment killm -j REJECT --reject-with icmp-port-unreachable',
    '-A OUTPUT -d 9.9.9.9/32 -j ACCEPT',
    '-A OUTPUT -d 5.6.7.8/32 -m comment --comment killm -j REJECT --reject-with icmp-port-unreachable',
  ].join('\n');
  const dels = linuxDeleteArgsFromListing(listing);
  assert.strictEqual(dels.length, 2);
  assert.strictEqual(dels[0]?.[0], '-D');
  assert.ok(dels[0]?.includes('1.2.3.4/32'));
  assert.ok(dels[1]?.includes('5.6.7.8/32'));
  assert.ok(!dels.flat().includes('9.9.9.9/32'), 'must not touch unrelated rules');
});

test('windowsAddArgs: single named rule with comma-separated IPs', () => {
  const cmds = windowsAddArgs(['1.1.1.1', '2.2.2.2']);
  assert.strictEqual(cmds.length, 1);
  assert.ok(cmds[0]?.includes(`name=${RULE_TAG}`));
  assert.ok(cmds[0]?.includes('remoteip=1.1.1.1,2.2.2.2'));
  assert.ok(cmds[0]?.includes('action=block'));
});

test('windowsAddArgs: chunks very large IP lists into multiple rules', () => {
  const ips = Array.from({ length: 250 }, (_, i) => `10.0.${Math.floor(i / 250)}.${i}`);
  const cmds = windowsAddArgs(ips);
  assert.strictEqual(cmds.length, 3); // 100 + 100 + 50
});

test('windowsDeleteArgs: deletes by rule name', () => {
  assert.deepStrictEqual(windowsDeleteArgs(), [
    'advfirewall',
    'firewall',
    'delete',
    'rule',
    `name=${RULE_TAG}`,
  ]);
});

test('darwinAnchorRules: one block-drop-out rule covering all IPs', () => {
  const rules = darwinAnchorRules(['1.1.1.1'], ['2606:4700::1']);
  assert.strictEqual(rules, 'block drop out quick to { 1.1.1.1, 2606:4700::1 }\n');
  assert.strictEqual(darwinAnchorRules([], []), '');
});

// ---- apply -----------------------------------------------------------------

test('applyFirewall on linux: iptables for v4, ip6tables for v6', async () => {
  const { calls, run } = fakeRunner();
  const result = await applyFirewall(['a.example'], {
    runner: run,
    resolver: fakeResolver,
    platform: 'linux',
  });
  assert.strictEqual(result.blocked, 3);
  const v4calls = calls.filter((c) => c.cmd === 'iptables');
  const v6calls = calls.filter((c) => c.cmd === 'ip6tables');
  assert.strictEqual(v4calls.length, 2);
  assert.strictEqual(v6calls.length, 1);
  assert.ok(v4calls[0]?.args.includes('1.1.1.1'));
  assert.ok(v6calls[0]?.args.includes('2606:4700::1'));
});

test('applyFirewall on win32: netsh add rule with all IPs', async () => {
  const { calls, run } = fakeRunner();
  await applyFirewall(['a.example'], { runner: run, resolver: fakeResolver, platform: 'win32' });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0]?.cmd, 'netsh');
  assert.ok(calls[0]?.args.join(' ').includes('remoteip=1.1.1.1,2.2.2.2,2606:4700::1'));
});

test('applyFirewall on darwin: enables pf and loads the killm anchor', async () => {
  const { calls, run } = fakeRunner();
  await applyFirewall(['a.example'], { runner: run, resolver: fakeResolver, platform: 'darwin' });
  assert.deepStrictEqual(calls[0], { cmd: 'pfctl', args: ['-e'], stdin: undefined });
  assert.strictEqual(calls[1]?.cmd, 'pfctl');
  assert.deepStrictEqual(calls[1]?.args, ['-a', RULE_TAG, '-f', '-']);
  assert.ok(calls[1]?.stdin?.includes('block drop out quick'));
});

test('applyFirewall: throws when every firewall command fails', async () => {
  const run: Runner = () => Promise.resolve({ ok: false, stdout: '' });
  await assert.rejects(
    applyFirewall(['a.example'], { runner: run, resolver: fakeResolver, platform: 'linux' }),
    /no firewall rules could be applied/
  );
});

test('applyFirewall: tolerates partial failures', async () => {
  let n = 0;
  const run: Runner = () => Promise.resolve({ ok: n++ === 0, stdout: '' }); // only first succeeds
  const result = await applyFirewall(['a.example'], {
    runner: run,
    resolver: fakeResolver,
    platform: 'linux',
  });
  assert.strictEqual(result.blocked, 3);
});

test('applyFirewall: throws on unsupported platforms', async () => {
  await assert.rejects(
    applyFirewall(['a.example'], { resolver: fakeResolver, platform: 'freebsd' }),
    /not supported/
  );
});

// ---- remove ----------------------------------------------------------------

test('removeFirewall on linux: deletes exactly the killm-tagged rules', async () => {
  const listing =
    '-A OUTPUT -d 1.2.3.4/32 -m comment --comment killm -j REJECT\n-A OUTPUT -d 9.9.9.9/32 -j ACCEPT\n';
  const { calls, run } = fakeRunner({
    'iptables -S OUTPUT': { ok: true, stdout: listing },
    'ip6tables -S OUTPUT': { ok: true, stdout: '' },
  });
  await removeFirewall({ runner: run, platform: 'linux' });
  const deletes = calls.filter((c) => c.args[0] === '-D');
  assert.strictEqual(deletes.length, 1);
  assert.ok(deletes[0]?.args.includes('1.2.3.4/32'));
});

test('removeFirewall on linux: tolerates a missing iptables binary', async () => {
  const { run } = fakeRunner({
    'iptables -S OUTPUT': { ok: false, stdout: '' },
    'ip6tables -S OUTPUT': { ok: false, stdout: '' },
  });
  await removeFirewall({ runner: run, platform: 'linux' }); // must not throw
});

test('removeFirewall on win32: deletes the named rule', async () => {
  const { calls, run } = fakeRunner();
  await removeFirewall({ runner: run, platform: 'win32' });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0]?.args, windowsDeleteArgs());
});

test('removeFirewall on darwin: flushes the killm anchor', async () => {
  const { calls, run } = fakeRunner();
  await removeFirewall({ runner: run, platform: 'darwin' });
  assert.deepStrictEqual(calls[0]?.args, ['-a', RULE_TAG, '-F', 'rules']);
});

test('removeFirewall: no-op on unsupported platforms', async () => {
  const { calls, run } = fakeRunner();
  await removeFirewall({ runner: run, platform: 'freebsd' });
  assert.strictEqual(calls.length, 0);
});
