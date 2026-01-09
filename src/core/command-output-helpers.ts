import type { CommandOutput } from "../models/command-output.ts";

export const buildErrorOutput = (
  error: Error,
  message?: string
): CommandOutput => {
  return {
    success: false,
    error,
    message: message ?? error.message,
  };
};
