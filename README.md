# Stash

> One ordered drawer for everything you save for later, end-to-end encrypted.

Stash collects the links you save while browsing (social networks, forums, blogs, any website) in a
single place, ordered by category, priority and status, with a preview and, when possible, the
content to read it inside the app. The server only stores encrypted data it cannot read.

## Tech stack

- PWA: Svelte 5 + Vite, with a Workbox service worker (vite-plugin-pwa, `injectManifest`)
- Browser extension: WXT + Svelte, Manifest V3 for Chrome/Chromium and Firefox
- API: Cloudflare Workers + D1
- Language: TypeScript
- Tooling: pnpm workspaces, Vitest, ESLint, Prettier, Lefthook

## Repository layout

| Path             | What                                                  |
| ---------------- | ----------------------------------------------------- |
| `packages/core`  | Domain model and logic in plain TypeScript            |
| `packages/ui`    | Svelte components shared by the PWA and the extension |
| `apps/pwa`       | Progressive web app                                   |
| `apps/extension` | Browser extension                                     |
| `apps/api`       | Cloudflare Worker                                     |

## Local development

### Requirements

- Node.js 26.13.0 (see `.nvmrc`)
- pnpm 12 (the exact version is pinned in `package.json`)

### Install

```bash
pnpm install
```

### Environment variables

None yet. See `.env.example`.

## Scripts

| Command                              | Description                                                       |
| ------------------------------------ | ----------------------------------------------------------------- |
| `pnpm lint`                          | ESLint over the whole repository                                  |
| `pnpm format` / `pnpm format:check`  | Prettier                                                          |
| `pnpm typecheck`                     | TypeScript and `svelte-check` in every package                    |
| `pnpm test`                          | Vitest with coverage (85 % threshold) in every package            |
| `pnpm build`                         | Builds the PWA, the extension (Chrome and Firefox) and the Worker |
| `pnpm --filter @stash/pwa dev`       | PWA dev server                                                    |
| `pnpm --filter @stash/extension dev` | Extension in development mode (Chrome)                            |
| `pnpm --filter @stash/api dev`       | Worker running locally                                            |
| `pnpm --filter @stash/core bench`    | Argon2id benchmark page, reachable from a phone (see below)       |

### Argon2id benchmark on a phone

`pnpm --filter @stash/core bench` serves a page that times Argon2id with the production
parameters. Open it on the phone and press **Run**:

- Same Wi-Fi: `http://<computer-ip>:5173`.
- USB: run `adb reverse tcp:5173 tcp:5173`, then open `http://localhost:5173` in Chrome on the
  phone. `chrome://inspect` on the computer shows its console.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[AGPL-3.0](./LICENSE)
