# AGENTS.md

This file provides guidance for agentic coding tools working in this repository.

## Build & Development Commands

```bash
# Install dependencies
bun install

# Run CLI (headless mode)
bun run cli --help
bun run cli mr list --state opened

# Run TUI (interactive mode)
bun run tui
bun dev

# Direct execution (no build step)
bun run src/cli.ts
bun run src/index.tsx
```

**Note**: This project uses Bun runtime with no separate build step. TypeScript files are executed directly.

## Testing

No test framework is currently configured in this project.

## Project Overview

Mr-Rocket is an extensible CLI/TUI tool for daily workflow automation. It supports both headless mode (scriptable, JSON output) and TUI mode (interactive, history viewing, real-time status).

**Tech Stack:**
- Runtime: Bun
- Language: TypeScript (ESNext target)
- CLI Parsing: Built-in `bun.argv` + custom parser
- UI Framework: React 19 + OpenTUI (@opentui/react, @opentui/core)
- GitLab API: @gitbeaker/rest
- Config: JSON (stored in ~/.mr-rocket/)
- JSX: react-jsx transformation with @opentui/react as import source

**Architecture:**
- Command Pattern: Each workflow action is a self-contained command
- Service Layer: API integrations (GitLab, future Confluence)
- Shared Core: Same business logic for CLI and TUI
- History Management: Command execution logging with query support

## Code Style Guidelines

### TypeScript Configuration
- Strict mode enabled
- No unchecked indexed access (`noUncheckedIndexedAccess: true`)
- No implicit override (`noImplicitOverride: true`)
- No fallthrough cases in switch
- Verbatim module syntax: explicit file extensions required in imports

### Imports
- Use `.tsx` or `.ts` extensions in imports (verbatimModuleSyntax)
- Import OpenTUI components from `@opentui/core` and `@opentui/react`
- Example:
  ```tsx
  import { createCliRenderer, TextAttributes } from "@opentui/core";
  import { createRoot } from "@opentui/react";
  ```

### Component Structure
- Functional components only
- Lowercase tag names for OpenTUI primitives (e.g., `<box>`, `<text>`, `<ascii-font>`)
- Components are rendered using `createRoot(renderer).render(<Component />)`
- Use async/await for `createCliRenderer()` initialization

### Formatting & Types
- No linting/formatting tools configured - follow existing patterns
- Use explicit TypeScript types
- Leverage strict type checking (no `any`, implicit `any` prohibited)
- Use ESNext features

### Error Handling
- Follow strict TypeScript practices
- Handle async operations with proper error handling
- Use runtime checks for external data

### Naming Conventions
- Component names: PascalCase
- Variables/functions: camelCase
- File names: kebab-case for modules, PascalCase for component files
- Constants: UPPER_SNAKE_CASE for exported constants

### File Organization
- Source files in `src/` directory
- Entry point: `src/index.tsx`
- Use logical grouping by feature or component type

### React/OpenTUI Specifics
- JSX with `react-jsx` transformation
- Import source for JSX: `@opentui/react`
- Use OpenTUI layout primitives: `<box>`, `<text>`, `<ascii-font>`
- Attributes like `alignItems`, `justifyContent` use React-like naming (camelCase)
- Use `TextAttributes` enum for text styling

### Performance Considerations
- Bun provides fast execution - no build optimization needed
- Use `--watch` flag for development hot reload
- Avoid unnecessary re-renders in TUI context

## Development Notes

- No separate build/dist process - Bun executes TSX directly
- Watch mode available via `--watch` flag
- No ESLint/Prettier configured - maintain consistent style manually
- Code coverage not implemented

## Architecture Patterns

### Command System
All commands extend `BaseCommand` and implement:
- `name`: Command identifier (e.g., "mr create")
- `description`: Human-readable description
- `category`: Command category (e.g., "GitLab")
- `executeInternal(args)`: Main execution logic
- `printHelp()`: Command-specific help text

Example:
```typescript
import { BaseCommand } from "../base-command";

class MyCommand extends BaseCommand {
  name = "my command";
  description = "Does something";
  category = "Category";

  async executeInternal(args: ParsedArgs): Promise<CommandOutput> {
    const value = args.options.get("option");
    return { success: true, data: value, message: "Done" };
  }
}
```

### Adding New Commands
1. Create command file in appropriate directory (e.g., `src/commands/gitlab/mr/my-command.ts`)
2. Extend `BaseCommand` and implement required methods
3. Register command in `src/cli.ts`:
   ```typescript
   commandRegistry.register(new MyCommand());
   ```

### Service Layer
Services wrap external APIs and provide type-safe interfaces:
- Initialize API clients with config
- Transform API responses to internal types
- Handle errors uniformly

Example (GitLab):
```typescript
const gitlab = new GitLabService(host, token);
const mrs = await gitlab.listMergeRequests(projectId, { state: "opened" });
```

### Config Management
Config stored at `~/.mr-rocket/config.json`:
```json
{
  "version": "1.0.0",
  "gitlab": {
    "host": "https://gitlab.com",
    "token": "YOUR_TOKEN",
    "defaultProjectId": "",
    "defaultBranch": "main"
  },
  "ui": {
    "refreshInterval": 10000,
    "maxHistoryItems": 1000
  }
}
```

### History Management
History stored at `~/.mr-rocket/history.json`:
- Each command execution is logged automatically
- Includes timestamp, args, output, duration, status
- Query by command, status, date range
- Rotates after maxHistoryItems (default: 1000)

### Output Format
Commands support dual output:
- Default: Human-readable with colored text (green=success, red=error, etc.)
- `--json` flag: Structured JSON for scripting

### CLI Syntax
Flat subcommand structure (Option A):
```bash
mr-rocket mr create --source feature --target main --title "Fix"
mr-rocket mr list --state opened --author @me
mr-rocket issue create --title "New feature"
mr-rocket ui  # Launch TUI (coming in Phase 3)
```
