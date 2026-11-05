# API v2
Toutes les routes métier demandent `Authorization: Bearer <JWT>`.
- POST `/api/auth/login`
- GET `/api/auth/me`
- GET `/api/dashboard`
- GET/POST `/api/products`
- PUT `/api/products/:id`
- GET `/api/stock/movements`
- POST `/api/stock/movements`
- GET/PUT `/api/settings`
- GET `/api/settings/qr/:text`
- GET `/api/subscription`
- GET `/api/platform/overview` (SUPER_ADMIN)
Réponses JSON. Erreurs `{ "error": "..." }`.
