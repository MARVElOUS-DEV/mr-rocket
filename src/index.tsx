import { TextAttributes } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import { initializeTUI, createTUIRoot, cleanupTUI, getRenderer } from "./tui/client.js";
import { getStore } from "./tui/store.js";
import { Dashboard } from "./tui/components/dashboard.js";
import { MRList } from "./tui/components/mr-list.js";
import { MRCreate } from "./tui/components/mr-create.js";
import { BugsList } from "./tui/components/bugs-list.js";
import { BugComment } from "./tui/components/bug-comment.js";
import { HistoryList } from "./tui/components/history-list.js";
import { WikiSearch } from "./tui/components/wiki-search.js";
import { Toast } from "./tui/components/toast.js";
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
    if (state.currentScreen === "mr-create" || state.currentScreen === "bug-comment") {
      return;
    }
    if (input === "q") {
      cleanupTUI();
      process.exit(0);
    } else if (input === "escape") {
      store.dispatch({ type: "NAVIGATE", screen: "dashboard" });
    } else if (input === "b") {
      store.dispatch({ type: "NAVIGATE", screen: "dashboard" });
    } else if (input === "m") {
      store.dispatch({ type: "NAVIGATE", screen: "mr-list" });
    } else if (input === "c") {
      store.dispatch({ type: "NAVIGATE", screen: "mr-create" });
    } else if (input === "i") {
      store.dispatch({ type: "NAVIGATE", screen: "bugs-list" });
    } else if (input === "n") {
      store.dispatch({ type: "NAVIGATE", screen: "bug-comment" });
    } else if (input === "h") {
      store.dispatch({ type: "NAVIGATE", screen: "history" });
    } else if (input === "w") {
      store.dispatch({ type: "NAVIGATE", screen: "wiki-search" });
    }
  });

  const renderScreen = () => {
    switch (state.currentScreen) {
      case "dashboard":
        return <Dashboard />;
      case "mr-list":
        return <MRList />;
      case "mr-create":
        return <MRCreate />;
      case "bugs-list":
        return <BugsList />;
      case "bug-comment":
        return <BugComment />;
      case "history":
        return <HistoryList />;
      case "wiki-search":
        return <WikiSearch />;
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
      <Toast />
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
