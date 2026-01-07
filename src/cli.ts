import { cliParser } from "./utils/cli-parser";
import { commandRegistry } from "./commands/index";
import { configManager } from "./core/config-manager";
import { outputFormatter } from "./core/output-formatter";
import { MrCreateCommand } from "./commands/gitlab/mr/create";
import { MrListCommand } from "./commands/gitlab/mr/list";
import { MrApproveCommand } from "./commands/gitlab/mr/approve";
import { MrMergeCommand } from "./commands/gitlab/mr/merge";
import { MrShowCommand } from "./commands/gitlab/mr/show";
import { IssueCreateCommand } from "./commands/gitlab/issue/create";
import { IssueListCommand } from "./commands/gitlab/issue/list";

async function main() {
  const parsed = cliParser.parse(process.argv);

  if (parsed.positional[0] === "ui") {
    console.error("Error: TUI mode not implemented yet. Use headless mode commands.");
    process.exit(1);
  }

  if (parsed.positional.length === 0 || parsed.help) {
    commandRegistry.printGlobalHelp();
    process.exit(0);
  }

  try {
    await configManager.load();
  } catch (err) {
    console.error("Failed to load configuration");
    console.error("Please ensure ~/.mr-rocket/config.json exists and is valid.");
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

main();
