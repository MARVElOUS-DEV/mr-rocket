import { stripVTControlCharacters } from "node:util";
import { agentService } from "../services/agent.service";
import type { AgentResult } from "../types/agent";

export interface CommentResult {
  reason: string;
  solution: string;
}

export interface GenerateCommentOptions {
  agentName?: string;
  target?: string;
  repo?: string;
}

function agentFailureDetail(result: AgentResult): string {
  return stripVTControlCharacters(
    result.stderr || result.stdout || result.output,
  )
    .trim()
    .slice(0, 1000);
}

function assertAgentSucceeded(result: AgentResult): void {
  if (result.exitCode === 0) return;

  const detail = agentFailureDetail(result);
  throw new Error(
    `${result.agent} exited with code ${result.exitCode ?? "unknown"}${detail ? `: ${detail}` : ""}`,
  );
}

function parseCommentOutput(output: string, agentName: string): CommentResult {
  const candidates: Record<string, unknown>[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < output.length; index++) {
    const char = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"' && depth > 0) {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) start = index;
      depth++;
    } else if (char === "}" && depth > 0 && --depth === 0) {
      try {
        const parsed = JSON.parse(output.slice(start, index + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          candidates.push(parsed as Record<string, unknown>);
        }
      } catch {
        // Continue looking for a later valid JSON object.
      }
    }
  }

  const parsed = candidates.findLast(
    (candidate) => "reason" in candidate && "solution" in candidate,
  );
  const reason = typeof parsed?.reason === "string" ? parsed.reason.trim() : "";
  const solution =
    typeof parsed?.solution === "string" ? parsed.solution.trim() : "";

  if (!reason || !solution) {
    throw new Error(
      `${agentName} did not return valid JSON with non-empty reason and solution`,
    );
  }

  return { reason, solution };
}

export async function generateComment(
  options?: GenerateCommentOptions,
): Promise<CommentResult> {
  const targetContext = options?.target
    ? `The merge-request target branch is "${options.target}". Inspect the full current branch diff from its merge base (try both the local and origin target refs).`
    : "Inspect the full current branch diff from its merge base when possible.";
  const prompt = `Analyze the git changes in this repository and provide a bug fix summary.
  ${targetContext}
  Include staged, unstaged, and untracked changes. If no branch diff is available, inspect the latest commit.
  Each should be simple and brief no more than 20 words, focusing on the main solution and its cause.
  
Respond ONLY with valid JSON (no markdown):
{"reason": "root cause in Chinese (1-2 sentences)", "solution": "what was fixed in Chinese (1-2 sentences)"}`;

  const result = await agentService.run(prompt, {
    agentName: options?.agentName,
    repo: options?.repo,
  });
  assertAgentSucceeded(result);
  return parseCommentOutput(result.output, result.agent);
}
