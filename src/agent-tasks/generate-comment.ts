import { logger } from "../core/logger";
import { agentService } from "../services/agent.service";

export interface CommentResult {
  reason: string;
  solution: string;
}

export interface GenerateCommentOptions {
  agentName?: string;
  target?: string;
  cwd?: string;
}

export async function generateComment(
  options?: GenerateCommentOptions,
): Promise<CommentResult> {
  const prompt = `Analyze the git changes in this repo or the latest git commit if the changes are committed and provide a bug fix summary.
  Each should be simple and brief no more than 20 words, focusing on the main solution and its cause.
  
Respond ONLY with valid JSON (no markdown):
{"reason": "root cause in Chinese (1-2 sentences)", "solution": "what was fixed in Chinese (1-2 sentences)"}`;

  try {
    const result = await agentService.run(prompt, {
      agentName: options?.agentName,
      cwd: options?.cwd,
    });
    const jsonMatch = result.output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        reason: parsed.reason || "",
        solution: parsed.solution || "",
      };
    }
  } catch (error) {
    logger.error("Failed to generate comment:", error);
  }
  return { reason: "", solution: "" };
}
