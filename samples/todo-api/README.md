# Todo API

A REST API for todos, kept in memory. It shows the core of a Megh app without
a database: controllers, services with dependency injection, request
validation with DTOs, pagination, and tests.

## Run it

```bash
npm install
cp .env.example .env
npm run start:dev
```

Open http://localhost:4000/docs for the generated API docs.

```bash
curl -X POST localhost:4000/todos -H 'content-type: application/json' \
  -d '{"title": "Buy milk", "priority": "high"}'
curl 'localhost:4000/todos?completed=false&search=milk&page=1&perPage=10'
```

## Endpoints

| Method | Path | |
|---|---|---|
| `GET` | `/todos` | List: `?page`, `perPage` (≤ 100), `completed`, `priority`, `search`. Returns `{ data, meta }`. |
| `GET` | `/todos/stats` | Totals |
| `GET` | `/todos/:id` | One todo, or 404 |
| `POST` | `/todos` | Create: `title` (required), `completed`, `priority` (`low`/`medium`/`high`), `dueDate` (ISO date) |
| `PATCH` | `/todos/:id` | Update any of those fields |
| `DELETE` | `/todos/completed` | Delete every completed todo |
| `DELETE` | `/todos/:id` | Delete one todo |

Invalid input, including unknown fields, is rejected with 400 before the
handler runs.

## Where to look

```
src/
├── controllers/todo.controller.ts   # routes; @Body() / @Query() DTOs are validated
├── dtos/todo.dto.ts                 # class-validator rules, PartialType for updates
├── services/todo.service.ts         # logic + in-memory storage, paginated()
├── services/todo.service.spec.ts    # unit tests
└── app.ts                           # registers controllers and OpenAPI
test/todos.e2e-spec.ts               # boots the app and calls it over HTTP (inject)
```

## Scripts

| Script | |
|---|---|
| `start:dev` | Dev server with reload |
| `build` / `start` | Compile to `dist/` / run it |
| `test` | Unit tests |
| `test:e2e` | End-to-end tests |
