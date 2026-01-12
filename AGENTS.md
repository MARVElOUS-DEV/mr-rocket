# AGENTS.md

This file provides guidance for agentic coding tools working in this repository.

## Project Structure (Current)

```
mr-rocket/
├── src/              # CLI/TUI application (currently lives at repo root)
├── packages/
│   ├── extension/     # Chrome extension with WXT (@mr-rocket/extension)
│   └── shared/        # Shared types and utilities (@mr-rocket/shared)
├── scripts/           # Installation and setup scripts
├── docs/              # Documentation
├── config/            # Configuration examples
└── package.json       # Root workspace configuration
```

**Note**: A future migration may move the root CLI/TUI app into `packages/cli/`. See `docs/MONOREPO_MIGRATION.md`.

## Build & Development Commands

```bash
# Install all dependencies (from root)
bun install

# CLI Commands (from root)
bun run cli --help              # Run CLI help
bun run cli mr list --state opened
bun run tui                     # Run TUI mode
bun run dev                     # Run CLI in watch mode
bun run build:cli               # Build standalone CLI binary
bun run build:tui               # Build standalone TUI binary

# Extension Commands (from root)
bun run --filter @mr-rocket/extension dev    # Start extension dev server with HMR
bun run --filter @mr-rocket/extension build  # Build extension for production
bun run --filter @mr-rocket/extension zip    # Build and zip extension

# Direct package execution
bun run --filter @mr-rocket/extension dev
```

**Note**: This project uses Bun workspaces. TypeScript files are executed directly by Bun.

## Testing

No test framework is currently configured in this project.

## Project Overview

Mr-Rocket is an extensible CLI/TUI tool for daily workflow automation. It supports both headless mode (scriptable, JSON output) and TUI mode (interactive, history viewing, real-time status).

### Packages

- **Root CLI/TUI app**: Main CLI/TUI application (not yet moved into a workspace package)
  - Tech: Bun, TypeScript, React 19 + OpenTUI
  - Entry: `src/cli.ts` (CLI), `src/index.tsx` (TUI)

- **@mr-rocket/extension**: Chrome extension for CDP authentication
  - Tech: WXT framework, React, TypeScript
  - Entry: `packages/extension/src/entrypoints/`

- **@mr-rocket/shared**: Shared types between CLI and extension
  - Contains: CDP auth types, common interfaces

## Code Style Guidelines

### TypeScript Configuration
- Strict mode enabled
- No unchecked indexed access (`noUncheckedIndexedAccess: true`)
- No implicit override (`noImplicitOverride: true`)
- No fallthrough cases in switch
- Verbatim module syntax enabled (`verbatimModuleSyntax: true`)

### Imports
- Prefer extensionless relative imports (current codebase convention, works with Bun + TS bundler resolution)
- Import from workspace packages: `import { Type } from "@mr-rocket/shared"`
- CLI uses OpenTUI: `import { createCliRenderer } from "@opentui/core"`
- Extension uses React: `import { useState } from "react"`

### Component Structure
- Functional components only
- CLI: Lowercase tag names for OpenTUI primitives (`<box>`, `<text>`)
- Extension: Standard React components with JSX

### Naming Conventions
- Component names: PascalCase
- Variables/functions: camelCase
- File names: kebab-case for modules, PascalCase for component files
- Constants: UPPER_SNAKE_CASE for exported constants

### File Organization
- CLI source: `src/`
- Extension source: `packages/extension/src/`
- Shared types: `packages/shared/src/types/`

## Architecture Patterns

### Command System (CLI)
All commands extend `BaseCommand` and implement:
- `name`: Command identifier (e.g., "mr create")
- `description`: Human-readable description
- `category`: Command category (e.g., "GitLab")
- `executeInternal(args)`: Main execution logic

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
1. Create command file in `src/commands/<category>/`
2. Extend `BaseCommand` and implement required methods
3. Register command in `src/cli.ts`

### Service Layer
Services wrap external APIs and provide type-safe interfaces:
- `src/services/gitlab.service.ts` - GitLab API
- `src/services/confluence.service.ts` - Confluence API
- Future: `cdp.service.ts` - CDP integration using extension auth

### Extension Architecture (WXT)
- Background script: `packages/extension/src/entrypoints/background.ts` - Cookie monitoring, native messaging
- Popup: `packages/extension/src/entrypoints/popup/` - React UI for configuration
- Config: `packages/extension/wxt.config.ts` - Manifest and build configuration

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

### CDP Auth Flow
1. Extension monitors cookies for configured CDP domain
2. On cookie change, syncs to native messaging host
3. Native host writes encrypted cookies to `~/.mr-rocket/cdp-auth.json`
4. CLI CDPService reads auth file for authenticated requests

### CLI Syntax
```bash
mr-rocket mr create --source feature --target main --title "Fix"
mr-rocket mr list --state opened --author @me
mr-rocket issue create --title "New feature"
```
