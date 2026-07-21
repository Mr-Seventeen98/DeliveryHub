import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverSshConfigAliases,
  parseSshConfig,
} from "./ssh-config-discovery.service";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("parseSshConfig", () => {
  it("collects explicit aliases and ignores wildcard host rules", () => {
    const result = parseSshConfig(`
      Host production-m2 staging
        User delivery
      Host *
        ServerAliveInterval 30
      Host *.internal !blocked
      Host "quoted-host" # a comment
    `);

    expect(result.aliases).toEqual(["production-m2", "staging", "quoted-host"]);
  });

  it("collects every Include pattern", () => {
    expect(
      parseSshConfig("Include conf.d/*.conf 'team hosts/common.conf'").includes,
    ).toEqual(["conf.d/*.conf", "team hosts/common.conf"]);
  });
});

describe("discoverSshConfigAliases", () => {
  it("recursively expands Include files without looping", () => {
    const directory = mkdtempSync(join(tmpdir(), "delivery-hub-ssh-"));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, "conf.d"));
    writeFileSync(
      join(directory, "config"),
      "Host root-host\nInclude conf.d/*.conf\n",
    );
    writeFileSync(
      join(directory, "conf.d", "production.conf"),
      "Host production\nInclude ../config\n",
    );

    expect(discoverSshConfigAliases(join(directory, "config"))).toEqual([
      "production",
      "root-host",
    ]);
  });
});
