# Deployment Notes

This project is ready for Docker deployment on a Linux VPS. It reads secrets from `.env`, persists runtime data through Docker volumes and exposes a lightweight health endpoint on `/health`.

No real server IP, token, key or WhatsApp session is included in this public copy.

## VPS Target Template

```text
IP: YOUR_SERVER_IP
OS: Ubuntu 24.04 or compatible Linux distribution
Port: 3001
```

## First-Time VPS Setup

Install Docker and Git:

```bash
sudo apt update
sudo apt install -y git ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc > /dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in after `usermod`, or run Docker commands with `sudo`.

## Clone And Configure

```bash
sudo mkdir -p /opt/whatsapp-scheduling
sudo chown "$USER":"$USER" /opt/whatsapp-scheduling
cd /opt/whatsapp-scheduling
git clone https://github.com/YOUR_GITHUB_USER/whatsapp-visit-scheduler-bot.git .
cp .env.example .env
nano .env
```

Set at least:

```bash
HOST=0.0.0.0
PORT=3001
OPENAI_API_KEY=your_real_openai_api_key
OPENAI_MODEL=gpt-4o-mini
ADMIN_PHONE_NUMBER=5511987654321
MARK_BOT_REPLIES_UNREAD=true
```

If you want to send an institutional video in the welcome flow, place it on the host at:

```bash
/opt/whatsapp-scheduling/media/company-presentation.mp4
```

Keep this value in `.env`:

```bash
FACTORY_VIDEO_PATH=/app/media/company-presentation.mp4
```

## Docker Commands

Build and start:

```bash
docker compose up -d --build
```

Follow logs and scan the QR code:

```bash
docker compose logs -f whatsapp-bot
```

Health check:

```bash
curl http://127.0.0.1:3001/health
```

Restart:

```bash
docker compose restart whatsapp-bot
```

Stop:

```bash
docker compose down
```

## Future Updates

```bash
cd /opt/whatsapp-scheduling
git pull --ff-only
docker compose up -d --build
docker compose logs -f whatsapp-bot
```

## Secrets Checklist

- Keep the real OpenAI key only in `.env` on your machine or VPS.
- Commit `.env.example`, never `.env`.
- Keep `.wwebjs_auth`, SQLite files, logs, caches, tokens, passwords and runtime media out of Git.
- Rotate any key that was ever pasted into GitHub, chat, logs or screenshots.
