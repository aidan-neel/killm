/**
 * Domain target lists, split by the kind of access they represent.
 *
 * The split between `agents` and `web` is the whole point of killm: an agentic
 * coding tool (Claude Code, Cursor, Copilot, Aider, ...) talks to a *different*
 * host than the consumer chat website. Claude Code hits `api.anthropic.com`
 * while the chat UI lives on `claude.ai`; the OpenAI API lives on
 * `api.openai.com` while ChatGPT lives on `chatgpt.com`. Because they are
 * separate hostnames we can cut off one without touching the other.
 *
 * Blocking is done at the hostname level (via the hosts file), so we cannot
 * block by URL path. Where a product only exposes a chat product behind a path
 * we block the closest dedicated hostname instead.
 */

export interface Scope {
  agents: boolean;
  web: boolean;
  all: boolean;
}

// API endpoints + dedicated coding-assistant backends. Blocking these stops
// agentic coding tools and raw API usage WITHOUT touching the chat websites.
export const AGENTS: readonly string[] = [
  // Provider API endpoints (used by Claude Code, Codex, Aider, Continue, etc.)
  'api.anthropic.com',
  'api.openai.com',
  'api.x.ai',
  'api.mistral.ai',
  'api.groq.com',
  'api.deepseek.com',
  'api.together.xyz',
  'api.fireworks.ai',
  'api.cohere.com',
  'api.perplexity.ai',
  'generativelanguage.googleapis.com',
  'api.replicate.com',

  // Cursor
  'cursor.com',
  'api2.cursor.sh',
  'api3.cursor.sh',
  'api4.cursor.sh',
  'repo42.cursor.sh',

  // GitHub Copilot
  'api.githubcopilot.com',
  'copilot-proxy.githubusercontent.com',
  'copilot-telemetry.githubusercontent.com',
  'proxy.individual.githubcopilot.com',
  'proxy.business.githubcopilot.com',
  'api.individual.githubcopilot.com',
  'api.business.githubcopilot.com',

  // Codeium / Windsurf
  'server.codeium.com',
  'codeium.com',
  'windsurf.com',

  // Sourcegraph Cody
  'cody-gateway.sourcegraph.com',
  'sourcegraph.com',

  // Tabnine
  'api.tabnine.com',
  'tabnine.com',

  // Continue.dev
  'api.continue.dev',
  'continue.dev',

  // Supermaven
  'api.supermaven.com',
  'supermaven.com',
];

// Consumer chat websites. Blocking these stops the browser apps WITHOUT
// touching the API endpoints that coding agents rely on.
export const WEB: readonly string[] = [
  // OpenAI ChatGPT
  'chatgpt.com',
  'chat.openai.com',

  // Anthropic Claude
  'claude.ai',

  // Google Gemini
  'gemini.google.com',
  'bard.google.com',

  // xAI Grok
  'grok.com',

  // Microsoft Copilot (consumer)
  'copilot.microsoft.com',

  // Mistral Le Chat
  'chat.mistral.ai',

  // DeepSeek
  'chat.deepseek.com',

  // Perplexity
  'perplexity.ai',
  'www.perplexity.ai',

  // Meta AI
  'meta.ai',
  'www.meta.ai',

  // Poe
  'poe.com',

  // Character.AI
  'character.ai',

  // You.com
  'you.com',

  // Phind
  'phind.com',

  // Hugging Face Chat
  'huggingface.co',
];

/**
 * Resolve the set of hostnames to block from the parsed category flags.
 * Returns a de-duplicated, sorted array.
 */
export function resolveTargets(flags: Partial<Scope>): string[] {
  const set = new Set<string>();

  if (flags.all || flags.agents) {
    for (const h of AGENTS) set.add(h);
  }
  if (flags.all || flags.web) {
    for (const h of WEB) set.add(h);
  }

  return Array.from(set).sort();
}
