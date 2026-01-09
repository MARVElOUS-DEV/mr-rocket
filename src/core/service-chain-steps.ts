import type { AppConfig } from "../models/config.ts";
import type { CommandOutput } from "../models/command-output.ts";
import type { ServiceChainStep } from "./service-chain.ts";
import { GitLabService } from "../services/gitlab.service.ts";
import { SystemService } from "../services/system.service.ts";
import { ConfluenceService } from "../services/confluence.service.ts";

export const withConfig = <T extends { config?: AppConfig }>(
  loadConfig: () => Promise<AppConfig>
): ServiceChainStep<T> => {
  return async (ctx, next) => {
    ctx.config = await loadConfig();
    await next();
  };
};

export const withGitLabService = <
  T extends { config?: AppConfig; gitlab?: GitLabService }
>(
  createService?: (config: AppConfig) => GitLabService
): ServiceChainStep<T> => {
  return async (ctx, next) => {
    if (!ctx.config) {
      throw new Error("Missing config for GitLab service");
    }
    const factory =
      createService ??
      ((config: AppConfig) =>
        new GitLabService(config.gitlab.host, config.gitlab.token, config.gitlab.tls));
    ctx.gitlab = factory(ctx.config);
    await next();
  };
};

export const withConfluenceService = <
  T extends { config?: AppConfig; confluence?: ConfluenceService }
>(
  createService?: (config: AppConfig) => ConfluenceService
): ServiceChainStep<T> => {
  return async (ctx, next) => {
    if (!ctx.config) {
      throw new Error("Missing config for Confluence service");
    }
    const factory =
      createService ??
      ((config: AppConfig) =>
        new ConfluenceService(config.confluence.host, config.confluence.token));
    ctx.confluence = factory(ctx.config);
    await next();
  };
};

export const withSystemService = <T extends { system?: SystemService }>(
  createService?: () => SystemService
): ServiceChainStep<T> => {
  return async (ctx, next) => {
    ctx.system = createService ? createService() : new SystemService();
    await next();
  };
};

export const withValidation = <T>(
  validate: (context: T) => Promise<void> | void
): ServiceChainStep<T> => {
  return async (ctx, next) => {
    await validate(ctx);
    await next();
  };
};

export const withTiming = <T>(
  label: string,
  onComplete: (context: T, durationMs: number, label: string) => Promise<void> | void
): ServiceChainStep<T> => {
  return async (ctx, next) => {
    const start = Date.now();
    await next();
    const durationMs = Date.now() - start;
    await onComplete(ctx, durationMs, label);
  };
};

export const withErrorBoundary = <T>(
  onError: (context: T, error: Error) => Promise<void> | void,
  options?: { rethrow?: boolean }
): ServiceChainStep<T> => {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await onError(ctx, error);
      if (options?.rethrow !== false) {
        throw error;
      }
    }
  };
};

export const withOutput = <T extends { output?: CommandOutput }>(
  buildOutput: (context: T) => CommandOutput
): ServiceChainStep<T> => {
  return async (ctx, next) => {
    await next();
    ctx.output = buildOutput(ctx);
  };
};

export const withOutputError = <T extends { output?: CommandOutput }>(
  buildOutput: (context: T, error: Error) => CommandOutput,
  options?: { rethrow?: boolean }
): ServiceChainStep<T> => {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      ctx.output = buildOutput(ctx, error);
      if (options?.rethrow) {
        throw error;
      }
    }
  };
};
