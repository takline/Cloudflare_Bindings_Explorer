## Contributing

[fork]: https://github.com/takline/vs-code-prettier-eslint/fork
[pr]: https://github.com/takline/vs-code-prettier-eslint/pulls
[style]: https://github.com/airbnb/javascript
[code-of-conduct]: CODE_OF_CONDUCT.md

Hi there! I'm thrilled that you'd like to contribute to this project. Your help is essential for keeping it great.

Please note that this project is released with a [Contributor Code of Conduct][code-of-conduct]. By participating in this project you agree to abide by its terms.

## Issues and Pull Requests

If you have suggestions for how this project could be improved, or want to report a bug, open an issue! I'd love all and any contributions. If you have questions, too, I'd love to hear them.

Feel free to look at [issues](https://github.com/takline/vs-code-prettier-eslint/issues) to find outstanding issues. I've marked some as "Good first issue" for those wanting to get their feet wet.

I'd also love Pull Requests. If you're thinking of a large pull request, please consider opening up an issue first to talk about it!

## Add yourself as a contributor

This project follows the all contributors specification. To add yourself to the table of contributors on the README.md, please run the automated scripts as part of your pull request:

`bun run contributors:add`

followed by

`bun run contributors:generate`

Commit `.all-contributorsrc` and `README.md` in the pull request.

## Submitting a pull request

1. [Fork][fork] and clone the repository.
2. Configure and install the dependencies: `bun install`.
3. Make sure the tests pass on your machine: `bun test` (or `bun run test`).
4. Create a new branch: `git checkout -b my-branch-name`.
5. Make your change, add tests, and make sure the tests still pass.
6. Push to your fork and [submit a pull request][pr].
7. Pat yourself on the back and wait for your pull request to be reviewed and merged.

Here are a few things you can do that will increase the likelihood of your pull request being accepted:

- Follow the [style guide][style].
- Write and update tests.
- Keep your changes as focused as possible. If there are multiple changes you would like to make that are not dependent upon each other, consider submitting them as separate pull requests.

This project uses [auto](https://github.com/intuit/auto) to do automatic releases and generate a changelog based on the commit history. Commit messages should follow the [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/#summary) convention.

## Architecture

This extension uses a **Worker Thread** architecture to ensure formatting does not block the main VS Code process.
- `src/extension.ts`: The entry point. Activates the extension and registers the formatter provider.
- `src/PrettierEditProvider.ts`: Handles format requests from VS Code and delegates them to the `WorkerManager`.
- `src/WorkerManager.ts`: Manages the worker thread lifecycle.
- `src/worker.ts`: Runs inside the worker. It loads `prettier`, `eslint`, and `prettier-eslint`, resolves configuration, and performs the actual formatting.

When making changes, please ensure that heavy operations remain in `worker.ts` or are otherwise non-blocking.

## Resources

- [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/)
- [Using Pull Requests](https://docs.github.com/ee/user/project/merge_requests/getting_started.html)
- [GitHub Help](https://about.github.com/get-help/)