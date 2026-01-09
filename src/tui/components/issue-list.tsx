import { TextAttributes } from "@opentui/core";
import { useEffect, useState } from "react";
import { getStore } from "../store.js";
import { getGitLabService } from "../client.js";
import { TUIContext } from "../context.js";
import type { Issue } from "../../models/gitlab.js";

export function IssueList() {
  const store = getStore();
  const [issues, setIssues] = useState<Issue[]>(store.getState().loadedI || []);
  const [loading, setLoading] = useState(issues.length === 0);

  useEffect(() => {
    async function fetchIssues() {
      try {
        const gitlab = getGitLabService();
        const projectId = TUIContext.getInstance().getGitLabProjectId();
        const data = await gitlab.listIssues(projectId, { state: "opened" });
        store.dispatch({ type: "SET_ISSUES", issues: data });
        setIssues(data);
      } catch (err: any) {
        store.dispatch({ type: "SET_ERROR", error: err.message });
      } finally {
        setLoading(false);
      }
    }

    if (issues.length === 0) {
      fetchIssues();
    }
  }, [issues.length, store]);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box paddingBottom={1} borderStyle="single" borderColor="green">
        <text attributes={TextAttributes.BOLD}>Issues</text>
      </box>

      {loading ? (
        <box padding={1}>
          <text attributes={TextAttributes.DIM}>Loading...</text>
        </box>
      ) : (
        <box flexDirection="column" gap={0} flexGrow={1}>
          {issues.length === 0 ? (
            <text>No open issues found.</text>
          ) : (
            issues.map((issue) => (
              <box key={issue.iid} flexDirection="row" gap={2}>
                <text>#{issue.iid}</text>
                <text flexGrow={1}>{issue.title}</text>
                <text attributes={TextAttributes.DIM}>{issue.author.name}</text>
              </box>
            ))
          )}
        </box>
      )}

      <box paddingTop={1}>
        <text attributes={TextAttributes.DIM}>[b] Back to Dashboard</text>
      </box>
    </box>
  );
}
