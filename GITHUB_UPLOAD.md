# Public GitHub Upload Guide

This folder is the public portfolio copy. It intentionally excludes `.env`, `.git`, `node_modules`, WhatsApp auth data, SQLite databases, logs, private keys, tokens and private media files.

## Before Publishing

Run a quick local check:

```bash
npm install
npm run check
```

Run a final secret search with your preferred scanner, such as GitHub secret scanning, Gitleaks or TruffleHog. Only placeholders such as `.env.example` should appear. Real credentials must never be committed.

## Initialize A Fresh Public Repository

From this folder:

```bash
cd "C:\Users\caio_\OneDrive\Documentos\whatsapp-scheduling-portfolio-public"
git init
git branch -M main
git status --short
```

Commit:

```bash
git add .
git commit -m "Prepare WhatsApp scheduling bot portfolio project"
```

Add your public repository remote:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USER/whatsapp-visit-scheduler-bot.git
git push -u origin main
```

## Important Security Note

If any private key, deploy key, GitHub token or API key from the original local folder was ever used, rotate or revoke it before publishing. Removing it from this copy prevents GitHub exposure, but it does not make an already-used credential safe to keep.
