import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../../types/config";
import type { ParsedArgs } from "../../utils/cli-parser";
import { MrxCommand } from "./mrx";

type ResolveContext = {
  args: ParsedArgs;
  config?: AppConfig;
  repo?: string;
};

type ProjectResolver = {
  resolveProjectId(ctx: ResolveContext): Promise<string>;
};

function args(project?: string): ParsedArgs {
  return {
    command: ["mrx"],
    flags: new Map(),
    options: new Map(project ? [["project", project]] : []),
    positional: [],
    json: false,
    help: false,
  };
}

function config(): AppConfig {
  return {
    version: "1.0.0",
    gitlab: {
      host: "https://code.example.com",
      token: "test-token",
      defaultProjectId: "15212",
      defaultBranch: "master",
      projects: [
        { name: "console-plugin-aidp", id: "15212" },
        { name: "console-plugin-hpc", id: "12518" },
      ],
    },
    confluence: { host: "", token: "" },
    ui: { refreshInterval: 10000, maxHistoryItems: 1000 },
  };
}

async function gitRepo(origin: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "mr-rocket-mrx-repo-"));
  const init = Bun.spawnSync(["git", "init", "-q", repo]);
  if (init.exitCode !== 0) throw new Error(init.stderr.toString());
  const remote = Bun.spawnSync([
    "git",
    "-C",
    repo,
    "remote",
    "add",
    "origin",
    origin,
  ]);
  if (remote.exitCode !== 0) throw new Error(remote.stderr.toString());
  return repo;
}

function resolver(): ProjectResolver {
  return new MrxCommand() as unknown as ProjectResolver;
}

describe("mrx project resolution", () => {
  test("prefers the current repository mapping over defaultProjectId", async () => {
    const repo = await gitRepo(
      "git@code.example.com:team/console-plugin-hpc.git",
    );

    await expect(
      resolver().resolveProjectId({ args: args(), config: config(), repo }),
    ).resolves.toBe("12518");
  });

  test("uses the origin namespace when the repository is not configured", async () => {
    const repo = await gitRepo(
      "https://code.example.com/team/console-plugin-cube-threed.git",
    );

    await expect(
      resolver().resolveProjectId({ args: args(), config: config(), repo }),
    ).resolves.toBe("team/console-plugin-cube-threed");
  });

  test("uses defaultProjectId only outside a Git worktree", async () => {
    const repo = await mkdtemp(join(tmpdir(), "mr-rocket-mrx-nonrepo-"));

    await expect(
      resolver().resolveProjectId({ args: args(), config: config(), repo }),
    ).resolves.toBe("15212");
  });

  test("keeps an explicit project as the highest priority", async () => {
    const repo = await gitRepo(
      "git@code.example.com:team/console-plugin-hpc.git",
    );

    await expect(
      resolver().resolveProjectId({
        args: args("99999"),
        config: config(),
        repo,
      }),
    ).resolves.toBe("99999");
  });

  test("does not hide a mismatched GitLab host behind the default", async () => {
    const repo = await gitRepo(
      "git@other.example.com:team/console-plugin-hpc.git",
    );

    await expect(
      resolver().resolveProjectId({ args: args(), config: config(), repo }),
    ).rejects.toThrow("does not match configured gitlab.host");
  });
});
