# Contributing

Thanks for your interest in Stash.

## Setup

Requirements: Node.js 26.13.0 (see `.nvmrc`) and pnpm 12.

```bash
pnpm install
```

`pnpm install` also installs the Git hooks (Lefthook), which lint and format staged files.

## Workflow

1. Create a branch from `main`: `feat/short-name` or `fix/short-name`.
2. Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`.
3. Keep commits atomic and add tests for every change. Coverage must stay at or above 85 %.
4. Before opening a pull request, run:

   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   ```

5. Open a pull request against `main` using the template.

## Security

Stash is end-to-end encrypted. Never log user content, URLs or credentials, and never commit
secrets. Please report vulnerabilities privately to the maintainer instead of opening a public
issue.

## License

By contributing, you agree that your contributions are licensed under the
[AGPL-3.0](./LICENSE).
