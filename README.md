# AstroQuiz v7 — PostgreSQL / Render Authority Server

Servidor HTTP autoritativo para o AstroQuiz v7.

## Render

- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Environment: `NODE_ENV=production` e `DATABASE_URL` com a Internal Database URL do PostgreSQL do Render.
- Health: `/health`

## Banco

Execute `schema.sql` uma vez no PostgreSQL.

## Importante

Nunca coloque `DATABASE_URL` no APK ou em arquivo público. O APK usa somente a URL HTTPS pública do Web Service.
