# Mr-Rocket 🚀

An extensible CLI/TUI tool for daily workflow automation with GitLab integration.

## Features

- **Dual-mode operation**: Headless CLI for scripting and interactive TUI for browsing
- **GitLab integration**: Create, list, approve, and manage merge requests and issues
- **Command history**: Automatic logging of all operations with query support
- **Colored output**: Human-readable terminal output with color-coded messages
- **JSON mode**: Scriptable output with `--json` flag
- **Config management**: Single config file at `~/.mr-rocket/config.json`

## Installation

```bash
# Install dependencies
bun install
```

## Configuration

On first run, a default config will be created at `~/.mr-rocket/config.json`:

```json
{
  "version": "1.0.0",
  "gitlab": {
    "host": "https://gitlab.com",
    "token": "YOUR_PERSONAL_ACCESS_TOKEN_HERE",
    "defaultProjectId": "",
    "defaultBranch": "main"
  },
  "ui": {
    "refreshInterval": 10000,
    "maxHistoryItems": 1000
  }
}
```

1. Create a GitLab personal access token at https://gitlab.com/-/user_settings/personal_access_tokens
2. Update the `token` field in the config file
3. Optionally set `defaultProjectId` to avoid passing it with every command

## Usage

### CLI Mode (Headless)

```bash
# Show help
bun run cli --help

# Create a merge request
bun run cli mr create --source feature/new --target main --title "Add new feature"

# List open merge requests
bun run cli mr list --state opened

# List with JSON output for scripting
bun run cli mr list --state opened --json

# Approve a merge request
bun run cli mr approve 45 --message "LGTM"

# Merge a merge request
bun run cli mr merge 45 --squash --remove-source

# Show MR details
bun run cli mr show 45

# Create an issue
bun run cli issue create --title "Bug found" --labels "bug,critical"

# List issues
bun run cli issue list --state opened
```

### TUI Mode (Interactive - Coming Soon)

```bash
# Launch TUI interface
bun run tui
```

## Commands

### GitLab Merge Requests

| Command | Description |
|----------|-------------|
| `mr create` | Create a new merge request |
| `mr list` | List merge requests with filters |
| `mr approve` | Approve a merge request |
| `mr merge` | Merge a merge request |
| `mr show` | Show MR details |

### GitLab Issues

| Command | Description |
|----------|-------------|
| `issue create` | Create a new issue |
| `issue list` | List issues with filters |

## Global Options

- `--json` - Output in JSON format
- `--help`, `-h` - Show help for command

## Architecture

- **Runtime**: Bun
- **Language**: TypeScript (ESNext)
- **CLI**: Custom parser with bun.argv
- **TUI**: OpenTUI (@opentui/react)
- **GitLab API**: @gitbeaker/rest
- **Config**: JSON at `~/.mr-rocket/`

See [AGENTS.md](AGENTS.md) for architecture details and patterns.

## Development

```bash
# Run CLI in watch mode
bun run cli --help

# Run TUI in dev mode
bun dev

# Direct execution
bun run src/cli.ts
bun run src/index.tsx
```

## History

All commands are automatically logged to `~/.mr-rocket/history.json` with:
- Timestamp
- Command arguments
- Output
- Duration
- Success/error status

## License

Private project
