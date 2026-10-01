# Contributing

Thanks for helping with QV7 WebUI. The product site and the full guide are at [qv7.nl](https://qv7.nl). Install notes are in the [documentation](https://qv7.nl/docs).

## Before you start

- Open an issue for a large change so the approach can be agreed first.
- Small fixes, such as a typo or a clear bug, can go straight to a pull request.
- Read the [code of conduct](CODE_OF_CONDUCT.md).

## Local setup

You need Node.js 22 or newer, and Ollama if you want to talk to a model.

```bash
cp .env.example .env
npm install
npm run dev
```

Set `PORT=8787` in `.env` so the API matches the dev server proxy. The web app is at http://localhost:5173. Sign in with the admin account from `.env`.

Useful checks:

```bash
npm run typecheck
npm test
```

## Pull requests

- Keep the change focused on one thing.
- Match the style of the surrounding code.
- Describe what changed and how you checked it.
- Do not commit `.env`, databases, uploads, or archives. Those hold secrets and private chats.
- Do not add `GUIDE.md`, `DOCS.md`, or `.cursor/`. Those stay off the public repository. Put user-facing instructions on [qv7.nl/docs](https://qv7.nl/docs) when they belong there.

## Reporting bugs

Open an [issue](https://github.com/WLFV/qv7-webui/issues) with the steps to reproduce, what you expected, and what happened. Leave out passwords, session cookies, and private chat text.

Security problems go through the [security policy](SECURITY.md), not a public issue.
