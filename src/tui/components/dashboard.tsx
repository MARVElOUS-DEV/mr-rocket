import { TextAttributes } from "@opentui/core";
import { getStore } from "../store.js";

export function Dashboard() {
  return (
    <box flexDirection="column" flexGrow={1}>
      <box paddingBottom={1}>
        <ascii-font color="cyan" font="tiny" text="Mr-Rocket" />
      </box>

      <box flexDirection="column" gap={1}>
        <text>Dashboard</text>
        <text attributes={TextAttributes.DIM}>Use keyboard to navigate:</text>
        <text attributes={TextAttributes.DIM}>  [m] View Merge Requests</text>
        <text attributes={TextAttributes.DIM}>  [c] Create Merge Request</text>
        <text attributes={TextAttributes.DIM}>  [i] View CDP Bugs</text>
        <text attributes={TextAttributes.DIM}>  [n] New Bug Comment</text>
        <text attributes={TextAttributes.DIM}>  [w] Search Wiki</text>
        <text attributes={TextAttributes.DIM}>  [h] View History</text>
        <text attributes={TextAttributes.DIM}>  [q] Quit</text>
      </box>
    </box>
  );
}
