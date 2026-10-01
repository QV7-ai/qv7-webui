# Security policy

QV7 WebUI holds accounts, chats, and files on the server that runs it. Please report a vulnerability in private.

## Supported versions

Security fixes go to the latest code on the `main` branch of [WLFV/qv7-webui](https://github.com/WLFV/qv7-webui).

## Reporting a vulnerability

Use a [GitHub security advisory](https://github.com/WLFV/qv7-webui/security/advisories/new).

Include:

- What is affected
- Steps to reproduce
- The impact you can see
- Whether the issue is already public

Do not open a public issue for a vulnerability, and do not include live passwords, session cookies, or private chats.

## What to expect

You should receive an acknowledgement within 7 days. A fix or a clear next step should follow as soon as the report is confirmed. You will be credited in the release notes if you want to be.

## Out of scope

- A missing model, a slow reply, or Ollama being unreachable
- Exposure of Ollama itself when an operator publishes it on the internet
- Issues that require an already stolen `.env`, database, or server login
