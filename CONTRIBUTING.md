# Contributing

## Development setup

Use Node.js 22 or 24 and pnpm 10. Run `./start.sh` for an isolated local setup, or follow the manual setup in `README.md`.

Before opening a pull request, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Pull requests

- Keep changes focused and include tests for behavior changes.
- Update public documentation when configuration or deployment behavior changes.
- Do not commit `.env` files, credentials, private keys, database dumps, Docker image archives, logs, or real infrastructure identifiers.
- Use placeholders such as `gitlab.example.com` in tests and documentation.
- Describe database migration and rollback considerations when changing the Prisma schema.

## Security reports

Do not open a public Issue for a vulnerability. Follow `SECURITY.md` instead.
