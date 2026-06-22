---
name: mr-rocket-flow
description: Use when operating Mr-Rocket as a daily workflow tool for GitLab merge requests, CDP bug handling, wiki lookup, bug image attachment, command history, or the combined mrx MR-plus-bug-comment flow from Claude, Codex, Cursor Agent, OpenCode, or other coding agents.
metadata:
  short-description: Operate the Mr-Rocket MR and bug workflow
---

# Mr-Rocket Flow

Use this skill when the user wants an agent to operate Mr-Rocket, not when the task is to change Mr-Rocket's source code.

## Execution Model

- This skill is for production use from any target product repository. Prefer an installed Mr-Rocket CLI on `PATH` and run commands as `mr-rocket <command>`.
- Before the first Mr-Rocket command, resolve the executable:
  - If `command -v mr-rocket` succeeds, use `mr-rocket`.
  - If the user provided an absolute path to a Mr-Rocket binary, use that path.
  - If and only if the current checkout is the Mr-Rocket source repo and `bun` is available, use `bun run cli <command>` as a local development fallback.
  - If no executable is available, stop and tell the user that Mr-Rocket CLI is not installed or not on `PATH`; do not assume Bun or this source repository exists.
- Run commands from the target product repository when relying on git branch or remote inference. If you run Mr-Rocket from another directory, pass `--repo <path>`, `--source <branch>`, and `--project <id|group/repo>` as needed.
- Use `--json` for automation, parsing, summaries, and agent-to-agent handoff.
- Never print GitLab tokens, CDP cookies, native auth file contents, or full `~/.mr-rocket/config.json` values. If config is missing, report only the missing field names and file path.
- Prefer `--dry-run` before creating MRs through `mr create` or `mrx` when inputs were inferred or assembled by the agent.
- Approval and merge commands mutate GitLab state. Execute them only when the user explicitly asked for that action or after getting confirmation.

In examples below, `mr-rocket` means the resolved executable. Replace it with the local development fallback only when operating inside the Mr-Rocket source repo.

## Core Workflow

1. Determine whether the request is about MR work, CDP bugs, wiki lookup, bug images, history/logs, or AI agent orchestration.
2. Confirm the target repo context with `git rev-parse --abbrev-ref HEAD` and `git remote get-url origin` when branch/project inference matters.
3. If the task needs GitLab/CDP/Confluence access, run the narrowest read command first, usually with `--json`, to verify config and auth.
4. For create/update actions, assemble the command explicitly, run `--dry-run` when available, then run the real command if the user has authorized the action.
5. Summarize results with IDs, URLs, and any skipped best-effort step; do not paste large JSON unless requested.

## High-Value Commands

MR list/show:

```bash
mr-rocket mr list --state opened --json
mr-rocket mr show <mr-iid> --project <id> --json
```

MR create:

```bash
mr-rocket mr create --source <branch> --target <branch> --title "<title>" --project <id> --dry-run
mr-rocket mr create --source <branch> --target <branch> --title "<title>" --description "<markdown>" --labels "bug,fix" --reviewer-ids "123,456"
mr-rocket mr create --target <branch> --dry-run
```

When `--title` is omitted, `mr create` summarizes the local `target..source` commit range. It defaults `--source` to the current git branch and, on a real non-dry run, auto-commits dirty current-branch changes before generating the title unless `--no-commit-current` is passed.

MR approve/merge:

```bash
mr-rocket mr approve <mr-iid> --message "LGTM" --project <id>
mr-rocket mr merge <mr-iid> --squash --remove-source --project <id>
```

CDP bug read:

```bash
mr-rocket cdp status --json
mr-rocket cdp bugs list --status open --assignee @me --json
mr-rocket cdp bugs show <bug-id> --json
```

Bug image attachment:

```bash
mr-rocket bug attach <bug-id> --file <path>
mr-rocket bug images
```

Wiki lookup:

```bash
mr-rocket wiki search --query "<text>" --limit 5 --json
mr-rocket wiki read --title "<title>" --json
```

History and agents:

```bash
mr-rocket logs --limit 50
mr-rocket agent list
mr-rocket agent run "<prompt>" --agent codex
mr-rocket agent run "<prompt>" --agents claude,codex
```

For a fuller command reference, read `references/commands.md`.

## Combined MR + CDP Bug Flow

Use `mrx` when the user wants to create a GitLab MR and post a CDP bug comment in one operation.

```bash
mr-rocket mrx --bug-id <bug-id> --source <branch> --target master --project <id> --reason "<root cause>" --solution "<fix summary>" --dry-run
mr-rocket mrx --bug-id <bug-id> --reason "<root cause>" --solution "<fix summary>"
mr-rocket mrx --agent claude --repo <target-repo-path>
```

Important behavior:

- `mrx` can infer the source branch from the current git branch.
- `mrx` can infer the bug ID from branch names ending in a pattern like `abc-10476866`.
- `mrx` can infer the GitLab project from `origin`, or from `gitlab.defaultProjectId` / `gitlab.projects` in config.
- `mrx` requires both a reason and solution for the CDP comment unless an enabled agent can generate them.
- When `mrx` auto-commits dirty current-branch changes, it uses `--commit-message` if provided; otherwise it asks the configured agent to generate the commit message.
- `--comment <text>` splits reason/solution on a line containing only `---`; otherwise the first line is the reason and the rest is the solution.
- `--no-local-images` skips upload of files stored under `~/.mr-rocket/images/<bugId>`.

## Configuration Checks

Mr-Rocket uses `~/.mr-rocket/config.json`.

Required or common sections:

- `gitlab.host`, `gitlab.token`, optional `gitlab.defaultProjectId`, `gitlab.defaultBranch`, `gitlab.projects`.
- `cdp.host` and synced CDP auth for CDP bug commands.
- `confluence.host`, `confluence.token`, optional `confluence.defaultSpaceKey` for wiki commands.
- `agents` entries for `mrx --agent` and `agent run`.

If CDP auth fails, tell the user to open Chrome, log into CDP, and ensure the Mr-Rocket extension/native host sync is installed. Do not inspect or expose cookie files.

## Agent Handoff Pattern

When another agent asks for help with MR or bug workflow:

```text
Use Mr-Rocket to inspect the current branch, find the related CDP bug, create a dry-run MR, then report the exact command you would run for the real action.
```

When asked to complete the action, execute the real command and return the MR IID, MR URL, bug ID, and CDP comment status.
