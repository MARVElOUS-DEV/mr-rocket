import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import { initializeTUI, createTUIRoot, cleanupTUI } from "./tui/client.js";
import { getStore } from "./tui/store.js";
import { Dashboard } from "./tui/components/dashboard.js";
import { MRList } from "./tui/components/mr-list.js";
import { IssueList } from "./tui/components/issue-list.js";
import { HistoryList } from "./tui/components/history-list.js";
import { type AppState } from "./tui/types.js";

function App() {
  const store = getStore();
  const [state, setState] = useState<AppState>(store.getState());

  useEffect(() => {
    return store.subscribe((newState) => {
      setState(newState);
    });
  }, [store]);

  useKeyboard((key) => {
    const input = key.name;
    if (input === "q") {
      cleanupTUI();
      process.exit(0);
    } else if (input === "b") {
      store.dispatch({ type: "NAVIGATE", screen: "dashboard" });
    } else if (input === "m") {
      store.dispatch({ type: "NAVIGATE", screen: "mr-list" });
    } else if (input === "i") {
      store.dispatch({ type: "NAVIGATE", screen: "issue-list" });
    } else if (input === "h") {
      store.dispatch({ type: "NAVIGATE", screen: "history" });
    }
  });

  const renderScreen = () => {
    switch (state.currentScreen) {
      case "dashboard":
        return <Dashboard />;
      case "mr-list":
        return <MRList />;
      case "issue-list":
        return <IssueList />;
      case "history":
        return <HistoryList />;
      default:
        return (
          <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <text attributes={TextAttributes.BOLD}>{state.currentScreen.toUpperCase()}</text>
            <text attributes={TextAttributes.DIM}>Coming Soon...</text>
            <text attributes={TextAttributes.DIM}>Press [q] to quit</text>
          </box>
        );
    }
  };

  return (
    <box flexDirection="column" flexGrow={1} padding={1}>
      {renderScreen()}
    </box>
  );
}

try {
  await initializeTUI();
  const root = createTUIRoot();
  root.render(<App />);
} catch (error: any) {
  if (error.message?.includes("GitLab token is not configured")) {
    console.error("\x1b[31mError: GitLab token not configured.\x1b[0m");
    console.error("Please add your token to ~/.mr-rocket/config.json");
    console.log("\n\x1b[36mQuick Guide:\x1b[0m");
    console.log("1. Go to https://gitlab.com/-/user_settings/personal_access_tokens");
    console.log("2. Create a token with 'api' scope");
    console.log("3. Paste the token in ~/.mr-rocket/config.json:");
    console.log('   "gitlab": { "token": "YOUR_TOKEN_HERE" }');
  } else {
    console.error("Failed to initialize TUI:", error);
    if (error instanceof Error) {
      console.error(error.stack);
    }
  }
  console.log("\n\x1b[33mPress Ctrl+C to exit...\x1b[0m");
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

process.on("SIGINT", () => {
  cleanupTUI();
  process.exit(0);
});
