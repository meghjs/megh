# Blog API (Megh ORM)

A blog with users, posts, comments and tags, on the Megh ORM and SQLite.
It covers the whole ORM workflow: write migrations, generate models from
them, add relations, and query.

## Run it

```bash
npm install
cp .env.example .env
npm run db:migrate     # creates database.sqlite
npm run db:seed        # sample users, posts, tags and comments
npm run start:dev
```

Open http://localhost:4000/docs for the API docs.

```bash
curl 'localhost:4000/posts?tag=orm&perPage=5'
curl 'localhost:4000/posts/feed?perPage=2'        # then ?cursor=<meta.nextCursor>
curl localhost:4000/stats
```

## How it was built

```bash
megh new blog-orm
npm i kysely better-sqlite3

# 1. Migrations (then fill in the columns)
megh make:migration create_users_table
megh make:migration create_posts_table
megh make:migration create_comments_table
megh make:migration create_tags_table
megh make:migration create_post_tag_table
megh migrate

# 2. Models: columns, casts, timestamps and soft deletes read from the migrations
megh make:model user
megh make:model post
megh make:model comment
megh make:model tag
```

Then relations and scopes were added to the generated models by hand; see
`src/models/post.model.ts`.

## What to look at

| Feature | Where |
|---|---|
| Connection, used by the app and by `megh migrate` | `src/database/connection.ts`, `app.useDatabase(db)` in `src/app.ts` |
| Migrations (a pivot table with a composite key) | `src/database/migrations/` |
| `hasMany`, `belongsTo`, `belongsToMany` with pivot columns | `src/models/*.model.ts` |
| Reusable query scopes | `published`, `tagged`, … in `src/models/post.model.ts` |
| Eager loading, nested (`comments.author`) | `PostService.find` |
| `whereHas` / `whereDoesntHave` | `tagged` scope, `UserService.withoutPosts`, `StatsService` |
| `withCount`, with a constraint | `UserService.list`, `PostService.list` |
| `paginate()` and `cursorPaginate()` | `PostService.list`, `PostService.feed` |
| `related().create()` and `related().sync()` | `PostService.create`, `syncTags` |
| Transactions | `PostService.create` / `update` |
| Soft deletes, trash and restore | `PostService.remove` / `trash` / `restore` |
| `sum`, `avg`, `max`, `count` | `StatsService` |
| `findBy`, `findOrFail`, `firstOrFail` (404s) | services |
| Seeding | `src/database/seed.ts` |
| E2E tests on an in-memory database, using the real migrations | `test/blog.e2e-spec.ts` |

## Endpoints

| Method | Path | |
|---|---|---|
| `GET` | `/users` | Users with `posts_count` (published), paginated |
| `GET` | `/users/without-posts` | Users who haven't posted |
| `GET` | `/users/:id` | A user with their posts and `comments_count` |
| `POST` | `/users` | `{ name, email, bio? }` |
| `PATCH` | `/users/:id` | Any of those |
| `POST` | `/users/:id/posts` | `{ title, body, tags?, publish? }` |
| `GET` | `/posts` | `?status=published\|draft\|all`, `tag`, `author`, `search`, `page`, `perPage` |
| `GET` | `/posts/feed` | Published posts by cursor: `?cursor`, `perPage` |
| `GET` | `/posts/trash` | Soft-deleted posts |
| `GET` | `/posts/:id` | A post with author, tags and comments (counts a view) |
| `PATCH` | `/posts/:id` | `{ title?, body?, tags?, publish? }` |
| `DELETE` | `/posts/:id` | Soft delete |
| `POST` | `/posts/:id/restore` | Undo the delete |
| `POST` | `/posts/:id/comments` | `{ userId, body }` |
| `GET` | `/stats` | Counts, view aggregates, top authors, tags |

## Scripts

| Script | |
|---|---|
| `start:dev` | Dev server with reload |
| `db:migrate` / `db:status` / `db:fresh` | Run, inspect, or redo the migrations |
| `db:seed` | Replace the data with the sample data |
| `test` / `test:e2e` | Unit / end-to-end tests |
