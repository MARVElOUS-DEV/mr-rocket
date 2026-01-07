import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";

function App() {
  return (
    <box alignItems="center" justifyContent="center" flexGrow={1}>
      <box justifyContent="center" alignItems="flex-end">
        <ascii-font font="tiny" text="Mr-Rocket" />
        <text attributes={TextAttributes.DIM}>TUI mode coming soon!</text>
        <text attributes={TextAttributes.DIM}>Use headless mode: mr-rocket --help</text>
      </box>
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
