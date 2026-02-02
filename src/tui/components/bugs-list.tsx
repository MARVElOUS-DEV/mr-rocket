import { TextAttributes } from "@opentui/core";
import { useEffect, useState } from "react";
import { getStore } from "../store.js";
import { CDPService, type BugMetadata } from "../../services/cdp.service.js";
import { configManager } from "../../core/config-manager.js";

export function BugsList() {
  const store = getStore();
  const [bugs, setBugs] = useState<BugMetadata[]>(
    store.getState().loadedBugs || [],
  );
  const [loading, setLoading] = useState(bugs.length === 0);
  const [error, setError] = useState<string>();

  useEffect(() => {
    async function fetchBugs() {
      try {
        const config = configManager.getConfig();
        if (!config.cdp) {
          setError("CDP not configured");
          setLoading(false);
          return;
        }
        const service = new CDPService(config.cdp);
        const records = await service.listBugs({ showModule: "workstation_bug" });
        store.dispatch({ type: "SET_BUGS", bugs: records });
        setBugs(records);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (bugs.length === 0) {
      fetchBugs();
    }
  }, [bugs.length, store]);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box paddingBottom={1} borderStyle="single" borderColor="cyan">
        <text attributes={TextAttributes.BOLD}>CDP Bugs</text>
      </box>

      {loading ? (
        <text attributes={TextAttributes.DIM}>Loading...</text>
      ) : error ? (
        <text style={{ fg: "red" }}>{error}</text>
      ) : bugs.length === 0 ? (
        <text>No bugs found.</text>
      ) : (
        <box flexDirection="column" gap={0} flexGrow={1}>
          {bugs.map((bug) => (
            <box key={bug.id} flexDirection="row" gap={2}>
              <text>#{bug.id}</text>
              <text style={bug.priority === "high" ? { fg: "red" } : undefined}>
                [{bug.priority}]
              </text>
              <text flexGrow={1}>{bug.title}</text>
              <text attributes={TextAttributes.DIM}>{bug.status}</text>
            </box>
          ))}
        </box>
      )}

      <box paddingTop={1}>
        <text attributes={TextAttributes.DIM}>Esc back</text>
      </box>
    </box>
  );
}
