import { cliParser } from "./utils/cli-parser";
import { commandRegistry } from "./commands/index";
import { configManager } from "./core/config-manager";
import { logger, LogLevel } from "./core/logger";
import { fileURLToPath } from "node:url";
import { MrCreateCommand } from "./commands/gitlab/mr/create";
import { MrListCommand } from "./commands/gitlab/mr/list";
import { MrApproveCommand } from "./commands/gitlab/mr/approve";
import { MrMergeCommand } from "./commands/gitlab/mr/merge";
import { MrShowCommand } from "./commands/gitlab/mr/show";
import { LogsCommand } from "./commands/system/logs";
import { WikiSearchCommand } from "./commands/wiki/search";
import { WikiReadCommand } from "./commands/wiki/read";
import { CDPStatusCommand } from "./commands/cdp/status";
import { CDPBugsListCommand } from "./commands/cdp/bugs-list";
import { CDPBugsShowCommand } from "./commands/cdp/bugs-show";
import { BugAttachCommand } from "./commands/bug/attach";
import { BugImagesCommand } from "./commands/bug/images";

async function main() {
  const parsed = cliParser.parse(process.argv);

  if (parsed.flags.get("verbose") || parsed.flags.get("v")) {
    logger.setLevel(LogLevel.DEBUG);
  }

  if (parsed.positional[0] === "ui" || parsed.positional[0] === "tui") {
    const { spawn } = await import("node:child_process");
    const tuiEntry = fileURLToPath(new URL("./index.tsx", import.meta.url));
    const child = spawn("bun", ["run", tuiEntry], {
      stdio: "inherit",
      shell: true,
    });

    const { exitCode, signal } = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code, sig) => resolve({ exitCode: code, signal: sig }));
    });

    if (typeof exitCode === "number") {
      process.exit(exitCode);
    }

    if (signal) {
      process.exit(1);
    }

    process.exit(0);
  }

  if (parsed.positional.length === 0) {
    commandRegistry.printGlobalHelp();
    process.exit(0);
  }

  try {
    await configManager.load();
  } catch (err: any) {
    if (err.message?.includes("GitLab token is not configured")) {
      console.error("\x1b[31mError: GitLab token not configured.\x1b[0m");
      console.error("Please add your token to ~/.mr-rocket/config.json");
      console.log("\n\x1b[36mQuick Guide:\x1b[0m");
      console.log(
        "1. Go to https://gitlab.com/-/user_settings/personal_access_tokens",
      );
      console.log("2. Create a token with 'api' scope");
      console.log("3. Paste the token in ~/.mr-rocket/config.json:");
      console.log('   "gitlab": { "token": "YOUR_TOKEN_HERE" }');
    } else {
      console.error("Failed to load configuration");
      console.error(
        "Please ensure ~/.mr-rocket/config.json exists and is valid.",
      );
    }
    process.exit(1);
  }

  const success = await commandRegistry.execute(parsed);
  process.exit(success ? 0 : 1);
}

commandRegistry.register(new MrCreateCommand());
commandRegistry.register(new MrListCommand());
commandRegistry.register(new MrApproveCommand());
commandRegistry.register(new MrMergeCommand());
commandRegistry.register(new MrShowCommand());
commandRegistry.register(new LogsCommand());
commandRegistry.register(new WikiSearchCommand());
commandRegistry.register(new WikiReadCommand());
commandRegistry.register(new CDPStatusCommand());
commandRegistry.register(new CDPBugsListCommand());
commandRegistry.register(new CDPBugsShowCommand());
commandRegistry.register(new BugAttachCommand());
commandRegistry.register(new BugImagesCommand());

main();
