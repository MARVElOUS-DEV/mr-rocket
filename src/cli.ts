import { cliParser } from "./utils/cli-parser";
import { commandRegistry } from "./commands/index";
import { configManager } from "./core/config-manager";
import { outputFormatter } from "./core/output-formatter";
import { logger, LogLevel } from "./core/logger";
import { MrCreateCommand } from "./commands/gitlab/mr/create";
import { MrListCommand } from "./commands/gitlab/mr/list";
import { MrApproveCommand } from "./commands/gitlab/mr/approve";
import { MrMergeCommand } from "./commands/gitlab/mr/merge";
import { MrShowCommand } from "./commands/gitlab/mr/show";
import { IssueCreateCommand } from "./commands/gitlab/issue/create";
import { IssueListCommand } from "./commands/gitlab/issue/list";
import { LogsCommand } from "./commands/system/logs";

async function main() {
  const parsed = cliParser.parse(process.argv);

  if (parsed.flags.get("verbose") || parsed.flags.get("v")) {
    logger.setLevel(LogLevel.DEBUG);
  }

  if (parsed.positional[0] === "ui" || parsed.positional[0] === "tui") {
    const { spawn } = await import("node:child_process");
    const child = spawn("bun", ["run", "src/index.tsx"], {
      stdio: "inherit",
      shell: true,
    });
    
    await new Promise((resolve) => {
      child.on("exit", resolve);
    });
    return;
  }

  if (parsed.positional.length === 0 || parsed.help) {
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
      console.log("1. Go to https://gitlab.com/-/user_settings/personal_access_tokens");
      console.log("2. Create a token with 'api' scope");
      console.log("3. Paste the token in ~/.mr-rocket/config.json:");
      console.log('   "gitlab": { "token": "YOUR_TOKEN_HERE" }');
    } else {
      console.error("Failed to load configuration");
      console.error("Please ensure ~/.mr-rocket/config.json exists and is valid.");
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
commandRegistry.register(new IssueCreateCommand());
commandRegistry.register(new IssueListCommand());
commandRegistry.register(new LogsCommand());

main();
