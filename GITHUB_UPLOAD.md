# Public Repository Safety Checklist

Antes de publicar alteracoes neste repositorio, confirme:

```bash
git status --short
npm run check
```

Arquivos que devem ficar fora do Git:

- `.env` real;
- `.wwebjs_auth`;
- bancos SQLite reais;
- logs;
- tokens;
- chaves privadas;
- modelos e binarios pesados;
- midias privadas.

O arquivo `.env.example` deve conter apenas nomes de variaveis e valores ficticios ou vazios.
