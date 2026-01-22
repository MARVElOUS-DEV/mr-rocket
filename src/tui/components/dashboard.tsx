import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";

const MENU_ITEMS = [
  { key: "m", label: "View Merge Requests" },
  { key: "c", label: "Create Merge Request" },
  { key: "i", label: "View CDP Bugs" },
  { key: "n", label: "New Bug Comment" },
  { key: "a", label: "Attach Bug Image" },
  { key: "w", label: "Search Wiki" },
  { key: "h", label: "View History" },
] as const;

const TAGLINES = [
  "Launch your workflow",
  "Fast lanes for daily routines",
  "Less toil, more shipping",
] as const;

const LOGO_COLORS = ["cyan", "blue", "magenta", "blue"] as const;

export function Dashboard() {
  const { width } = useTerminalDimensions();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 700);
    return () => clearInterval(id);
  }, []);

  const logoColors = useMemo(() => {
    const offset = tick % LOGO_COLORS.length;
    return [...LOGO_COLORS.slice(offset), ...LOGO_COLORS.slice(0, offset)];
  }, [tick]);

  const panelWidth = Math.min(70, Math.max(44, width - 4));
  const logoFont = width >= 100 ? "slick" : "tiny";
  const tagline = TAGLINES[tick % TAGLINES.length] ?? TAGLINES[0];
  const dots = ".".repeat((tick % 3) + 1);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      gap={1}
    >
      <box alignItems="center">
        <ascii-font color={logoColors} font={logoFont} text="MR-ROCKET" />
      </box>

      <text attributes={TextAttributes.DIM}>
        {tagline}
        {dots}
      </text>

      <box
        width={panelWidth}
        flexDirection="column"
        borderStyle="rounded"
        borderColor="cyan"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={0}
      >
        <text attributes={TextAttributes.BOLD}>Menu</text>
        <text attributes={TextAttributes.DIM}>Press a key:</text>

        <box flexDirection="column" gap={0} paddingTop={1}>
          {MENU_ITEMS.map((item) => (
            <box key={item.key} flexDirection="row" gap={1}>
              <text style={{ fg: "cyan" }} attributes={TextAttributes.BOLD}>
                [{item.key}]
              </text>
              <text>{item.label}</text>
            </box>
          ))}

          <box flexDirection="row" gap={1} paddingTop={1}>
            <text style={{ fg: "yellow" }} attributes={TextAttributes.BOLD}>
              [q]
            </text>
            <text>Quit</text>
          </box>
        </box>
      </box>

      <text attributes={TextAttributes.DIM}>
        Tip: press [Esc] anytime to return here.
      </text>
    </box>
  );
}
