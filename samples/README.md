# Megh samples

Small, complete apps built with Megh. Each one is a normal Megh project,
scaffolded with `megh new`, with its own `package.json`, tests and README.

| Sample | Shows |
|---|---|
| [`todo-api`](./todo-api) | Controllers, services, DTO validation (body and query string), pagination, OpenAPI docs, unit and e2e tests. No database. |
| [`blog-orm`](./blog-orm) | The Megh ORM on SQLite: migrations, models generated from them with `megh make:model`, relations, eager loading, `whereHas`, `withCount`, scopes, offset and cursor pagination, aggregates, soft deletes, transactions, seeding. |

## Running a sample

```bash
cd samples/todo-api
npm install
npm run start:dev      # http://localhost:4000, API docs at /docs
npm test && npm run test:e2e
```

Build the packages once first (`npm install && npm run build` in the repo
root): the samples depend on this repo's `@meghjs/core` and `@meghjs/cli`
through `file:` links, so they always run against the current source.

## Using a sample outside this repo

Copy the folder, then in its `package.json` replace the `file:` versions of
`@meghjs/core` and `@meghjs/cli` with a published version (e.g. `^0.6.0`).
In `blog-orm`, also drop the `baseUrl` / `paths` entries from
`tsconfig.json`; they only work around the linked package.
