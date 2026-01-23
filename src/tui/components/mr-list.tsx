import { TextAttributes } from "@opentui/core";
import { useEffect, useState } from "react";
import { getStore } from "../store.js";
import { getGitLabService } from "../client.js";
import { TUIContext } from "../context.js";
import type { MergeRequest } from "../../models/gitlab.js";

export function MRList() {
  const store = getStore();
  const [mrs, setMrs] = useState<MergeRequest[]>(store.getState().loadedM || []);
  const [loading, setLoading] = useState(mrs.length === 0);

  useEffect(() => {
    async function fetchMRs() {
      try {
        const gitlab = getGitLabService();
        const projectId = TUIContext.getInstance().getGitLabProjectId();
        const data = await gitlab.listMergeRequests(projectId, { state: "opened" });
        store.dispatch({ type: "SET_MR", mrs: data });
        setMrs(data);
      } catch (err: any) {
        store.dispatch({ type: "SET_ERROR", error: err.message });
      } finally {
        setLoading(false);
      }
    }

    if (mrs.length === 0) {
      fetchMRs();
    }
  }, [mrs.length, store]);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box paddingBottom={1} borderStyle="single" borderColor="blue">
        <text attributes={TextAttributes.BOLD}>Merge Requests</text>
      </box>

      {loading ? (
        <box padding={1}>
          <text attributes={TextAttributes.DIM}>Loading...</text>
        </box>
      ) : (
        <box flexDirection="column" gap={0} flexGrow={1}>
          {mrs.length === 0 ? (
            <text>No open merge requests found.</text>
          ) : (
            mrs.map((mr) => (
              <box key={mr.iid} flexDirection="row" gap={2}>
                <text>!{mr.iid}</text>
                <text flexGrow={1}>
                  {mr.webUrl ? (
                    <a href={mr.webUrl}>
                      <u>
                        <span fg="cyan">{mr.title}</span>
                      </u>
                    </a>
                  ) : (
                    mr.title
                  )}
                </text>
                <text attributes={TextAttributes.DIM}>{mr.author.name}</text>
              </box>
            ))
          )}
        </box>
      )}

      <box paddingTop={1}>
        <text attributes={TextAttributes.DIM}>Esc back</text>
      </box>
    </box>
  );
}
