import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';

/**
 * Firewall-level blocking, layered on top of the hosts-file block.
 *
 * The hosts file only intercepts name resolution, so a browser with Secure
 * DNS (DoH) enabled sails right past it. Firewall mode resolves each target
 * hostname to its current IPs and blocks those at the OS firewall:
 *
 *   - Linux:   iptables / ip6tables OUTPUT rules tagged with a "killm" comment
 *   - Windows: a single "killm" outbound netsh advfirewall rule
 *   - macOS:   a pf anchor named "killm"
 *
 * All rules are identifiable without local state, so `killm --restore` can
 * always clean up, even after a crash.
 */

export const RULE_TAG = 'killm';

/** Maximum IPs per netsh rule; Windows accepts a comma list but not unbounded. */
const WINDOWS_CHUNK = 100;

export interface ExecResult {
  ok: boolean;
  stdout: string;
}

/** Runs a command, optionally feeding stdin. Injectable for tests. */
export type Runner = (cmd: string, args: string[], stdin?: string) => Promise<ExecResult>;

export const defaultRunner: Runner = (cmd, args, stdin) =>
  new Promise((resolve) => {
    const child = execFile(cmd, args, (error, stdout) =>
      resolve({ ok: !error, stdout: stdout ?? '' })
    );
    if (stdin != null && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });

export interface Resolver {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
}

export interface ResolvedIPs {
  v4: string[];
  v6: string[];
  /** Hostnames that failed to resolve at all (logged, not fatal). */
  unresolved: string[];
}

/**
 * Resolve every hostname to its current A/AAAA records. Failures are
 * collected, not thrown — an unresolvable host simply can't be blocked by IP.
 */
export async function resolveTargetIPs(
  hosts: readonly string[],
  resolver: Resolver = dns
): Promise<ResolvedIPs> {
  const v4 = new Set<string>();
  const v6 = new Set<string>();
  const unresolved: string[] = [];

  await Promise.all(
    hosts.map(async (host) => {
      const [a, aaaa] = await Promise.all([
        resolver.resolve4(host).catch(() => [] as string[]),
        resolver.resolve6(host).catch(() => [] as string[]),
      ]);
      if (a.length === 0 && aaaa.length === 0) {
        unresolved.push(host);
        return;
      }
      for (const ip of a) v4.add(ip);
      for (const ip of aaaa) v6.add(ip);
    })
  );

  return { v4: Array.from(v4).sort(), v6: Array.from(v6).sort(), unresolved: unresolved.sort() };
}

// ---- pure command builders (unit-tested per platform) --------------------

/** iptables/ip6tables arguments to add one REJECT rule tagged with killm. */
export function linuxAddArgs(ip: string): string[] {
  return ['-I', 'OUTPUT', '-d', ip, '-j', 'REJECT', '-m', 'comment', '--comment', RULE_TAG];
}

/**
 * Convert `iptables -S OUTPUT` output into the `-D` argument lists needed to
 * delete every killm-tagged rule. Our rules never contain quoted spaces, so
 * whitespace splitting is safe.
 */
export function linuxDeleteArgsFromListing(listing: string): string[][] {
  const out: string[][] = [];
  for (const line of listing.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('-A OUTPUT')) continue;
    if (!trimmed.includes(`--comment ${RULE_TAG}`)) continue;
    out.push(['-D', ...trimmed.slice('-A '.length).split(/\s+/)]);
  }
  return out;
}

/** netsh argument lists to add the killm outbound block rule(s). */
export function windowsAddArgs(ips: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ips.length; i += WINDOWS_CHUNK) {
    const chunk = ips.slice(i, i + WINDOWS_CHUNK);
    out.push([
      'advfirewall',
      'firewall',
      'add',
      'rule',
      `name=${RULE_TAG}`,
      'dir=out',
      'action=block',
      `remoteip=${chunk.join(',')}`,
    ]);
  }
  return out;
}

/** netsh argument list that deletes every rule named killm. */
export function windowsDeleteArgs(): string[] {
  return ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_TAG}`];
}

/** pf rule text for the killm anchor on macOS. */
export function darwinAnchorRules(v4: readonly string[], v6: readonly string[]): string {
  const all = [...v4, ...v6];
  if (all.length === 0) return '';
  return `block drop out quick to { ${all.join(', ')} }\n`;
}

// ---- apply / remove -------------------------------------------------------

export interface FirewallOptions {
  runner?: Runner;
  resolver?: Resolver;
  platform?: NodeJS.Platform;
}

export interface ApplyResult {
  blocked: number;
  unresolved: string[];
}

/**
 * Resolve the hostnames and install firewall rules for their current IPs.
 * Throws on unsupported platforms; individual rule failures are tolerated.
 */
export async function applyFirewall(
  hosts: readonly string[],
  opts: FirewallOptions = {}
): Promise<ApplyResult> {
  const runner = opts.runner ?? defaultRunner;
  const platform = opts.platform ?? process.platform;
  const { v4, v6, unresolved } = await resolveTargetIPs(hosts, opts.resolver);
  const blocked = v4.length + v6.length;

  // Individual rule failures are tolerated, but if not a single command
  // succeeded the firewall tool itself is missing/unusable — surface that
  // instead of pretending the IPs are blocked.
  let applied = 0;
  const failIfNothingApplied = (): ApplyResult => {
    if (blocked > 0 && applied === 0) {
      throw new Error('no firewall rules could be applied (is the firewall tool available?)');
    }
    return { blocked, unresolved };
  };

  if (platform === 'linux') {
    for (const ip of v4) if ((await runner('iptables', linuxAddArgs(ip))).ok) applied++;
    for (const ip of v6) if ((await runner('ip6tables', linuxAddArgs(ip))).ok) applied++;
    return failIfNothingApplied();
  }

  if (platform === 'win32') {
    for (const args of windowsAddArgs([...v4, ...v6])) {
      if ((await runner('netsh', args)).ok) applied++;
    }
    return failIfNothingApplied();
  }

  if (platform === 'darwin') {
    const rules = darwinAnchorRules(v4, v6);
    if (rules) {
      await runner('pfctl', ['-e']); // best effort: enable pf if it isn't
      if ((await runner('pfctl', ['-a', RULE_TAG, '-f', '-'], rules)).ok) applied++;
    }
    return failIfNothingApplied();
  }

  throw new Error(`--firewall is not supported on platform "${platform}"`);
}

/**
 * Remove every killm firewall rule. Needs no stored state, so it also cleans
 * up rules left behind by a crashed run. Failures are tolerated — rules that
 * don't exist can't be removed.
 */
export async function removeFirewall(opts: FirewallOptions = {}): Promise<void> {
  const runner = opts.runner ?? defaultRunner;
  const platform = opts.platform ?? process.platform;

  if (platform === 'linux') {
    for (const tool of ['iptables', 'ip6tables']) {
      const listing = await runner(tool, ['-S', 'OUTPUT']);
      if (!listing.ok) continue;
      for (const args of linuxDeleteArgsFromListing(listing.stdout)) {
        await runner(tool, args);
      }
    }
    return;
  }

  if (platform === 'win32') {
    await runner('netsh', windowsDeleteArgs());
    return;
  }

  if (platform === 'darwin') {
    await runner('pfctl', ['-a', RULE_TAG, '-F', 'rules']);
    return;
  }
}
