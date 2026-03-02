# Contributing

Thanks for contributing to R2 Explorer.

## Development Setup
1. Install dependencies:
```bash
bun install
```

2. Build and iterate:
```bash
bun run watch
```

Press `F5` in VS Code to launch the Extension Development Host.

One-off checks:
```bash
bun run compile
bun run lint
bun run typecheck
bun run test
```

Fast unit test:
```bash
bun run test:unit
```

3. Package locally (optional):
```bash
bun run package
```

## Local Wrangler Explorer
If you want to work on the local Wrangler explorer features, seed the sample environment:
```bash
cd scripts/local-wrangler-env
bun ./populate-wrangler.ts
```

## Pull Requests
- Keep changes focused and include tests when behavior changes.
- Update documentation for user-facing changes.
- Make sure CI passes before requesting review.
- Add the `automerge` label to eligible PRs if you want GitHub to merge automatically once checks pass.

## Code of Conduct
This project follows the Contributor Code of Conduct in `CODE_OF_CONDUCT.md`.
