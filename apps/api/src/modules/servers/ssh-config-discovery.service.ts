import { Injectable } from "@nestjs/common";
import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const SSH_ALIAS_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

@Injectable()
export class SshConfigDiscoveryService {
  readonly configPath = join(homedir(), ".ssh", "config");

  discoverAliases(): string[] {
    return discoverSshConfigAliases(this.configPath);
  }
}

export function discoverSshConfigAliases(configPath: string): string[] {
  const aliases = new Set<string>();
  readConfig(configPath, aliases, new Set<string>());
  return [...aliases].sort((left, right) => left.localeCompare(right));
}

export function parseSshConfig(content: string): {
  aliases: string[];
  includes: string[];
} {
  const aliases = new Set<string>();
  const includes: string[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const tokens = tokenizeConfigLine(rawLine);
    if (tokens.length < 2) continue;

    const directive = tokens[0]!.toLowerCase();
    if (directive === "host") {
      for (const alias of tokens.slice(1)) {
        if (
          !alias.startsWith("!") &&
          !alias.includes("*") &&
          !alias.includes("?") &&
          SSH_ALIAS_PATTERN.test(alias)
        ) {
          aliases.add(alias);
        }
      }
    } else if (directive === "include") {
      includes.push(...tokens.slice(1));
    }
  }

  return { aliases: [...aliases], includes };
}

function tokenizeConfigLine(line: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;

  for (const character of line.trim()) {
    if (!quote && character === "#") break;
    if (character === "'" || character === '"') {
      if (quote === character) quote = null;
      else if (!quote) quote = character;
      else token += character;
      continue;
    }
    if (!quote && /\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += character;
  }
  if (token) tokens.push(token);
  return tokens;
}

function resolveIncludePaths(pattern: string, includingPath: string): string[] {
  const homeExpanded =
    pattern === "~"
      ? homedir()
      : pattern.startsWith("~/")
        ? join(homedir(), pattern.slice(2))
        : pattern;
  const absolutePattern = isAbsolute(homeExpanded)
    ? homeExpanded
    : resolve(dirname(includingPath), homeExpanded);

  try {
    return globSync(absolutePattern, { withFileTypes: false }).sort();
  } catch {
    return [];
  }
}

function readConfig(
  configPath: string,
  aliases: Set<string>,
  visited: Set<string>,
): void {
  if (!existsSync(configPath)) return;

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(configPath);
  } catch {
    return;
  }
  if (visited.has(canonicalPath)) return;
  visited.add(canonicalPath);

  let content: string;
  try {
    content = readFileSync(canonicalPath, "utf8");
  } catch {
    return;
  }

  const parsed = parseSshConfig(content);
  for (const alias of parsed.aliases) aliases.add(alias);
  for (const pattern of parsed.includes) {
    for (const includedPath of resolveIncludePaths(pattern, canonicalPath)) {
      readConfig(includedPath, aliases, visited);
    }
  }
}
