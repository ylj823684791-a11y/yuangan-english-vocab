# Yuangan Vocab API

Python 3.6+ stdlib-only HTTP API for username/password auth and progress sync.

## Endpoints

- `POST /api/register` `{username, password}` → `{token, username}`
- `POST /api/login` `{username, password}` → `{token, username}`
- `POST /api/logout` (Bearer) → `{ok}`
- `GET /api/me` (Bearer) → `{username, id}`
- `GET /api/progress` (Bearer) → `{progress, updatedAt}`
- `PUT /api/progress` (Bearer) `{progress}` → `{ok, updatedAt}`
- `GET /api/health` → `{ok}`

Data file: `$YG_DATA/vocab.db` (default `./data/vocab.db`).
