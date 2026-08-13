# Mr-Rocket 🚀

An extensible CLI/TUI tool for daily workflow automation with GitLab integration.

## Features

- **Dual-mode operation**: Headless CLI for scripting and interactive TUI for browsing
- **GitLab integration**: Create, list, approve, and manage merge requests and issues
- **Command history**: Automatic logging of all operations with query support
- **Colored output**: Human-readable terminal output with color-coded messages
- **JSON mode**: Scriptable output with `--json` flag
- **Config management**: Single config file at `~/.mr-rocket/config.json`
- **Image workflow**: Prompt refinement, reference images, generation, visual review, iterative fixes, and cancellation

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
    "defaultBranch": "main",
    "tls": {
      "rejectUnauthorized": true,
      "caFile": ""
    }
  },
  "confluence": {
    "host": "https://your-domain.atlassian.net/wiki",
    "token": "YOUR_CONFLUENCE_PAT_HERE",
    "defaultSpaceKey": ""
  },
  "agents": {
    "claude": {
      "command": "claude",
      "capabilities": { "nonInteractiveArgs": ["--print"] },
      "enabled": true
    },
    "codex": {
      "command": "codex",
      "subcommand": "exec",
      "args": ["--disable", "plugins"],
      "capabilities": { "localImagePaths": true }
    },
    "cursor": {
      "command": "cursor-agent",
      "timeoutMs": 1200000,
      "capabilities": {
        "nonInteractiveArgs": ["--print", "--trust", "--force"],
        "workspaceArg": "--workspace",
        "resumeArgs": ["--continue"],
        "localImagePaths": true,
        "output": {
          "protocol": "json-lines",
          "args": ["--output-format", "stream-json", "--stream-partial-output"]
        }
      }
    },
    "agy": {
      "command": "agy",
      "capabilities": {
        "nonInteractiveArgs": ["--dangerously-skip-permissions", "--print"],
        "localImagePaths": true
      }
    },
    "gemini": { "command": "gemini", "args": ["-p"] }
  },
  "imageGeneration": {
    "mainAgent": "codex",
    "drawAgent": "agy",
    "maxIterations": 3,
    "maxDurationMs": 1200000,
    "outputDir": "~/.mr-rocket/generated-images"
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
4. If your GitLab uses a custom CA, set `gitlab.tls.caFile` to the PEM file path (or set `rejectUnauthorized` to `false` for local-only testing)

## Usage

### CLI Mode (Headless)

```bash
# Show help
bun run cli --help

# Create a merge request
bun run cli mr create --source feature/new --target main --title "Add new feature"

# Create a merge request with pasted images in the description
bun run cli mr create --source feature/new --target main --description-stdin

# List open merge requests
bun run cli mr list --state opened

# List with JSON output for scripting
bun run cli mr list --state opened --json

# Generate, review, and refine an image
bun run cli image generate "Realistic portrait in rainy Shanghai" --reference ./mood.jpg

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

### TUI Mode

```bash
# Launch TUI interface
bun run tui
```

Press `g` to open Image Studio. Enter a prompt, optional reference-image paths, and per-run limits for iterations and duration, then press `Ctrl+G`. The configured limits are only defaults: each run can use 1–30 iterations and 1–60 minutes. The phase log updates while the main and drawing agents work. Each run streams its complete transcript to a private file under `~/.mr-rocket/logs/`; use `tail -F ~/.mr-rocket/logs/image-workflow-current.log` to follow it externally, or `Ctrl+L` to reveal the path in the TUI. `Esc` or `Ctrl+C` cancels the active agent and workflow.

Agents can be local processes (the default transport) or remote HTTP endpoints:

```json
{
  "agents": {
    "remote-draw": {
      "transport": "http",
      "url": "https://agents.example.com/generate",
      "headers": { "authorization": "Bearer YOUR_TOKEN" },
      "timeoutMs": 600000
    }
  }
}
```

HTTP agents receive `{ "prompt": string, "attachments": [{ "name", "mimeType", "data" }] }`, where `data` is base64. They return `{ "output": string, "artifacts"?: [{ "name", "data"?: base64, "url"?: string }] }`. Local drawing agents write images into the requested output directory and return `{"images":["/absolute/path.png"]}`.

Local process integrations declare behavior in `capabilities`, so workflow code does not depend on agent names. `nonInteractiveArgs` are placed after ordinary `args`, `workspaceArg` binds the output workspace, `resumeArgs` enables refinement continuity, `localImagePaths` declares reference-image support, and `output.protocol: "json-lines"` extracts the final result event while still streaming progress. A custom or renamed drawing agent works when its capabilities describe the CLI correctly; omit unsupported capabilities and Mr-Rocket falls back to plain text without session resume.

The drawing agent must be authenticated and provide an image-generation tool. Mr-Rocket launches it from the configured image output root, so that single folder can be trusted once regardless of where Mr-Rocket is started. For the default path, run `mkdir -p ~/.mr-rocket/generated-images && cd ~/.mr-rocket/generated-images && agy`, sign in, trust the folder, then exit. Agy needs `--dangerously-skip-permissions` because print mode cannot display tool approval prompts; this grants the drawing agent broad host access. Keep `--print` last because it consumes the next argument as its prompt. Add `"--agent", "<draw-capable-agent>"` before `--print` when an explicit drawing agent is required.

Mr-Rocket runs Codex with `--disable plugins`, keeping plugin-provided skills such as Ponytail out of workflow planning and review without changing normal Codex sessions.

## Commands

### GitLab Merge Requests

| Command      | Description                      |
| ------------ | -------------------------------- |
| `mr create`  | Create a new merge request       |
| `mr list`    | List merge requests with filters |
| `mr approve` | Approve a merge request          |
| `mr merge`   | Merge a merge request            |
| `mr show`    | Show MR details                  |

### GitLab Issues

| Command        | Description              |
| -------------- | ------------------------ |
| `issue create` | Create a new issue       |
| `issue list`   | List issues with filters |

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
