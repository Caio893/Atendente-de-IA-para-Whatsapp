# Deployment

Este guia descreve um deploy generico em VPS com Docker. Nao coloque IP real, tokens, chaves, `.env`, sessoes do WhatsApp ou banco de dados no repositorio publico.

## Preparar ambiente

```bash
sudo apt update
sudo apt install -y git ca-certificates curl
```

Instale Docker conforme a documentacao oficial da Docker para a sua distribuicao Linux.

## Clonar o projeto

```bash
sudo mkdir -p /opt/atendente-ia-whatsapp
sudo chown "$USER":"$USER" /opt/atendente-ia-whatsapp
cd /opt/atendente-ia-whatsapp
git clone git@github.com:Caio893/Atendente-de-IA-para-Whatsapp.git .
```

## Configurar variaveis

```bash
cp .env.example .env
nano .env
```

Preencha os valores reais apenas no servidor:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
ADMIN_PHONE_NUMBER=5511999999999
PORT=3001
```

## Pastas persistentes

```bash
mkdir -p data media .wwebjs_auth models bin
```

- `data`: banco SQLite.
- `.wwebjs_auth`: sessao local do WhatsApp.
- `media`: midias opcionais usadas pelo bot.
- `models`: modelos do Whisper.
- `bin`: binarios auxiliares, como `whisper-cli`.

Essas pastas nao devem receber arquivos reais no Git.

## Subir o container

```bash
docker compose up -d --build
docker compose logs -f whatsapp-bot
```

Escaneie o QR code exibido nos logs na primeira execucao.

## Healthcheck

```bash
curl http://127.0.0.1:3001/health
```

## Atualizar deploy

```bash
cd /opt/atendente-ia-whatsapp
git pull --ff-only
docker compose up -d --build
docker compose logs -f whatsapp-bot
```

## Checklist de seguranca

- Commitar `.env.example`, nunca `.env`.
- Nao commitar `.wwebjs_auth`.
- Nao commitar `data/database.sqlite`.
- Nao commitar tokens, senhas, chaves privadas ou arquivos de credenciais.
- Revogar e recriar qualquer credencial que tenha sido exposta em Git, logs, prints ou mensagens.
