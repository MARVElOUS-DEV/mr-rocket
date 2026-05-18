# Mr-Rocket Command Reference

Use `bun run cli <command>` inside the Mr-Rocket source repo. Use `mr-rocket <command>` if the binary is installed.

## Merge Requests

`mr list`

- Purpose: list GitLab merge requests.
- Useful options: `--state opened|closed|merged`, `--search <term>`, `--labels <l1,l2>`, `--author <id>`, `--assignee <id>`, `--project <id>`, `--json`.
- Example: `bun run cli mr list --state opened --labels "bug" --json`.

`mr show <mr-iid>`

- Purpose: show one MR.
- Useful options: `--project <id>`, `--json`.

`mr create`

- Purpose: create a GitLab MR.
- Useful options: `--source <branch>` (defaults to current git branch), `--target <branch>`, `--title <title>`, `--description <text>`, `--description-stdin`, `--labels <l1,l2>`, `--assignee-id <id>`, `--reviewer-id <id>`, `--reviewer-ids <ids>`, `--project <id>`, `--commit-message <text>`, `--no-commit-current`, `--dry-run`, `--json`.
- Notes: `--description` uploads local image references; `--description-stdin` supports pasted images.
- Default title behavior: if `--title` is omitted, the command summarizes local commits in `target..source`, auto-committing dirty current-branch changes first on real runs. `--dry-run` reports the would-be auto-commit without mutating git.

`mr approve <mr-iid>`

- Purpose: approve an MR.
- Useful options: `--message <text>`, `--project <id>`.
- Safety: mutates GitLab state.

`mr merge <mr-iid>`

- Purpose: merge an MR.
- Useful options: `--squash`, `--remove-source`, `--project <id>`.
- Safety: mutates GitLab state.

## CDP Bugs

`cdp status`

- Purpose: check CDP configuration/auth status.
- Use before bug commands if auth is uncertain.

`cdp bugs list`

- Purpose: list CDP bugs.
- Useful options: `--status <status>`, `--priority <priority>`, `--assignee <user>`, `--search <query>` or `-q <query>`, `--json`.

`cdp bugs show <bug-id>`

- Purpose: show bug details.
- Useful options: `--json`.

## Combined Workflow

`mrx`

- Purpose: create a GitLab MR and post a CDP bug comment.
- MR options: `--source <branch>`, `--target <branch>`, `--title <title>`, `--description <text>`, `--labels <l1,l2>`, `--assignee-id <id>`, `--reviewer-id <id>`, `--reviewer-ids <ids>`, `--project <id|group/repo>`, `--dry-run`.
- CDP comment options: `--bug-id <id>`, `--comment <text>`, `--comment-file <path>`, `--reason <text>`, `--solution <text>`, `--agent <name>`, `--repo <path>`, `--no-ai`, `--no-local-images`.
- Description template placeholders: `{{cdpLink}}`, `{{selfTestResults}}`, `{{utScreenshots}}`, `{{e2eScreenshots}}`, `{{solution}}`, `{{backendDependency}}`.
- Inference: branch from current git branch, bug ID from branch suffix like `abc-10476866`, project from `origin` or config.

## Wiki

`wiki search`

- Purpose: search Confluence/wiki pages.
- Useful options: `--query <text>`, `--limit <number>`, `--offset <number>`, `--space <key>`, `--json`.

`wiki read`

- Purpose: read a wiki page by title.
- Useful options: `--title <title>`, `--space <key>`, `--json`.

## Images

`bug attach`

- Purpose: attach an image to a bug from clipboard or file.
- Usage: `bug attach <bugId> [--file <path>]`.
- Useful options: `--file <path>`.

`bug images`

- Purpose: list locally attached bug images.

## Logs and Agents

`logs`

- Purpose: inspect Mr-Rocket command logs.
- Useful options: `--limit <number>`.

`agent list`

- Purpose: list configured AI coding agents from config.

`agent run`

- Purpose: run a prompt through configured coding agents.
- Useful options: `--agent <name>`, `--agents <n1,n2>`.
