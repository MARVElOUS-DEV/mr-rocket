import { logger } from "../core/logger";
import { agentService } from "../services/agent.service";

export interface CommitMessageResult {
  message: string;
}

export interface GenerateCommitMessageOptions {
  agentName?: string;
  repo?: string;
}

export async function generateCommitMessage(
  options?: GenerateCommitMessageOptions,
): Promise<CommitMessageResult> {
  const prompt = `Analyze the current git working tree changes in this repository and generate one concise commit message.

Requirements:
- Inspect staged, unstaged, and untracked changes.
- Use a conventional commit subject, for example "fix: handle empty payment response".
- Keep it under 72 characters when possible.
- Do not infer the message from the branch name.

Respond ONLY with valid JSON (no markdown):
{"message": "conventional commit subject"}`;

  try {
    const result = await agentService.run(prompt, {
      agentName: options?.agentName,
      repo: options?.repo,
    });
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        message: typeof parsed.message === "string" ? parsed.message : "",
      };
    }
  } catch (error) {
    logger.error("Failed to generate commit message:", error);
  }

  return { message: "" };
}
