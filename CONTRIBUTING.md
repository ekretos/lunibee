# Contributing to Lunibee

First off, thank you for considering contributing to Lunibee! It's people like you that make Lunibee such a great tool.

## Where do I go from here?

If you've noticed a bug or have a feature request, make sure to check if there's already an issue for it. If not, feel free to open a new one!

## Setting up your environment

1. Fork the repo and create your branch from `master`.
2. Ensure you have [Bun](https://bun.sh/) installed.
3. Run `bun install` to install dependencies.
4. Run `bun run build` to build the packages.
5. If you've added code that should be tested, add tests.
6. If you've changed APIs, update the documentation.
7. Ensure the test suite passes: `bun test`.
8. Make sure your code passes the typescript checks: `bun run typecheck`.

## Code Guidelines

- We use TypeScript and strict mode is enabled.
- Ensure your code is formatted correctly using our prettier config: `bun run format`.
- Write clear, concise commit messages.
- Keep the public API surface clean and documented with TSDoc.

## Pull Requests

1. Keep PRs focused on a single issue or feature.
2. Link any relevant issues in the PR description.
3. Your PR will be reviewed by maintainers, and we might request some changes before merging.

Thanks again for your contribution!
