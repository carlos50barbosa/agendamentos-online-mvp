## Rotas reais de autenticacao

Entry point: `backend/src/index.js`

Auth publica:
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/forgot`
- `POST /auth/reset`

Auth publica via alias `/api`:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/forgot`
- `POST /api/auth/reset`

Auth autenticada:
- `GET /auth/me`
- `PUT /auth/me`
- `POST /auth/me/email-confirm`
- `POST /auth/link-phone`

Aliases autenticados:
- `GET /api/auth/me`
- `PUT /api/auth/me`
- `POST /api/auth/me/email-confirm`
- `POST /api/auth/link-phone`

Observacoes:
- o backend atual nao expoe `/api/v1/*`
- `POST /api/v1/login` e `POST /api/v1/auth/force-reset-password` nao fazem parte do fluxo real
- o frontend do repositorio usa `frontend/src/utils/api.js` e chama `/auth/login`, `/auth/forgot` e `/auth/reset`
