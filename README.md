# AstroQuiz Authority Server

Servidor HTTP autoritativo do AstroQuiz para Render + PostgreSQL.

## O que foi endurecido

- Contrato **Asteios** com catálogo, preços, limites e recompensas definidos exclusivamente no servidor.
- Validação estrita de categoria, fase, modo, respostas e tempo. Valores fora do contrato são rejeitados em vez de serem "corrigidos".
- `/v1/round/start` cria uma rodada com 8 IDs de perguntas escolhidos pelo servidor.
- `/v1/round` aceita somente a rodada emitida pelo servidor e fecha a rodada após a validação.
- `SELECT ... FOR UPDATE` protege saldo/vidas contra duas operações concorrentes.
- `X-Request-Id` UUID v4 + tabela `request_receipts` evita duplicação acidental/reenvio da mesma operação.
- Limite básico por cliente e cabeçalhos HTTP de segurança.
- CORS deixa de ser `*` por padrão; configure `ALLOWED_ORIGIN` somente quando houver cliente web que precise dele.
- PostgreSQL aplica limites para moedas, vidas, tempo, respostas e duração.

## Integração do APK

O cliente deve enviar:

- `X-Player-Id`: ID persistente do jogador.
- `X-Request-Id`: UUID v4 novo para cada operação mutável.
- `X-AstroQuiz-Version: 8.1`.

Fluxo de partida:

1. `POST /v1/round/start` com `category`, `stage` e `hardMode`.
2. O servidor retorna `runId` e exatamente 8 `questionIds`.
3. O APK mostra essas perguntas.
4. `POST /v1/round` envia `runId` + as 8 respostas.
5. O servidor calcula acertos, combo, pontuação e moedas.

Fluxo de compra:

`POST /v1/purchase` recebe apenas `itemId`. Preço e valor **nunca** vêm do APK.

Consumo de vida:

`POST /v1/life/consume` recebe corpo JSON vazio. O servidor consome exatamente uma vida.

## Anúncios recompensados

O callback de vídeo concluído do SDK de anúncios acontece no cliente. Esta API não finge que esse callback é uma prova criptográfica de conclusão do anúncio. Para transformar a recompensa de anúncio em uma operação realmente autoritativa, é necessário um mecanismo de verificação fornecido pelo provedor de anúncios.

Por isso, o APK não deve colocar preço, quantidade ou recompensa no request.

## Render

- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Environment: `NODE_ENV=production` e `DATABASE_URL` com a Internal Database URL do PostgreSQL.
- Opcional: `ALLOWED_ORIGIN`.

## Banco

Execute `schema.sql` no PostgreSQL existente. O arquivo contém também os comandos de migração necessários para a tabela existente.

## Testes

```bash
npm test
```

Nunca coloque `DATABASE_URL`, keystore ou outras credenciais no APK, no repositório ou em arquivos públicos.
