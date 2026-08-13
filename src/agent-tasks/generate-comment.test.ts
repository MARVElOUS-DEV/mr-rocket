import { afterEach, describe, expect, test } from "bun:test";
import { agentService } from "../services/agent.service";
import type { AgentResult } from "../types/agent";
import { generateComment } from "./generate-comment";

const originalRun = agentService.run;

afterEach(() => {
  agentService.run = originalRun;
});

function result(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agent: "cursor",
    output: "",
    exitCode: 0,
    duration: 1,
    ...overrides,
  };
}

describe("generateComment", () => {
  test("uses the target branch and parses the last matching JSON object", async () => {
    let prompt = "";
    agentService.run = async (value) => {
      prompt = value;
      return result({
        output:
          'diagnostic {"status":"working"}\n{"reason":" 根因 ","solution":" 修复方案 "}',
      });
    };

    await expect(
      generateComment({ target: "master", repo: "/tmp/example" }),
    ).resolves.toEqual({ reason: "根因", solution: "修复方案" });
    expect(prompt).toContain('target branch is "master"');
    expect(prompt).toContain("full current branch diff");
  });

  test("surfaces a failed agent process instead of returning empty fields", async () => {
    agentService.run = async () =>
      result({
        output: "Cursor authentication expired",
        stderr: "\u001b[31mCursor authentication expired\u001b[0m",
        exitCode: 1,
      });

    await expect(generateComment({ agentName: "cursor" })).rejects.toThrow(
      "cursor exited with code 1: Cursor authentication expired",
    );
  });

  test("reports invalid successful output as an agent response error", async () => {
    agentService.run = async () => result({ output: "No JSON returned" });

    await expect(generateComment({ agentName: "cursor" })).rejects.toThrow(
      "cursor did not return valid JSON",
    );
  });
});
