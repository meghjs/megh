---
title: Sessions
description: Cookie sessions, flash messages and login state for server-rendered apps.
---

# Sessions

<!-- v-pre: the page shows {{ }} template syntax, which Vue would otherwise evaluate. -->

:::: v-pre

Sessions keep per-visitor state between requests, such as who is logged in,
a cart, or a message to show after a redirect. Use them with
[views](/advanced/views). An API with token authentication doesn't need them.

The browser gets one cookie holding a random session ID, signed with
HMAC-SHA256. The data stays on the server.

## Setup

```ts [app.ts]
app.useSession({ secret: process.env.SESSION_SECRET });
```

The secret must be at least 32 characters. Leave `secret` out and Megh reads
`SESSION_SECRET`. To generate one:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Option       | Default          | Meaning                                                                                |
| ------------ | ---------------- | -------------------------------------------------------------------------------------- |
| `secret`     | `SESSION_SECRET` | Signs the cookie. An array rotates keys: the first signs, all of them verify           |
| `cookieName` | `megh_session`   | Cookie name                                                                            |
| `maxAge`     | `'2h'`           | Lifetime after the last change: milliseconds or `'30m'`, `'7 days'`                    |
| `rolling`    | `false`          | Save on every request, so the session expires after inactivity instead                 |
| `cookie`     | see below        | `path` (`/`), `domain`, `httpOnly` (`true`), `sameSite` (`'lax'`), `secure` (`'auto'`) |
| `store`      | memory           | A `SessionStore`, see [Stores](#stores)                                                |
| `redis`      |                  | Shortcut for `store: new RedisSessionStore(redis)`                                     |
| `loginPath`  |                  | Send browsers that need to log in here instead of a 401, see [Protecting pages](#protecting-pages) |

With `secure: 'auto'` the cookie is `Secure` when the request came over HTTPS.
Behind a proxy that ends TLS, set `server.trustProxy` so Megh can tell.

A visitor gets a cookie only once something is stored in their session.

## Using the session

Inject it with `@Session()`:

```ts [controllers/cart.controller.ts]
import {
  ApiController,
  MeghSession,
  Param,
  Post,
  Results,
  Session,
} from "@meghjs/core";

@ApiController("/cart")
export class CartController {
  @Post("/add/:id")
  add(@Param("id") id: number, @Session() session: MeghSession) {
    const items = session.get<number[]>("cart") ?? [];
    session.set("cart", [...items, id]);
    session.flash("status", "Added to your cart.");
    return Results.Redirect("/cart");
  }
}
```

| Method                    | Does                                                                         |
| ------------------------- | ---------------------------------------------------------------------------- |
| `get(key)` / `has(key)`   | Read a value, or one flashed by the previous request                         |
| `set(key, value)`         | Store a value. It must survive `JSON.stringify`                              |
| `pull(key)`               | Read and remove                                                              |
| `delete(key)` / `clear()` | Remove one value / all of them                                               |
| `all()`                   | Every value                                                                  |
| `flash(key, value)`       | Store a value for the **next** request only, e.g. a message after a redirect |
| `reflash()`               | Keep this request's flashed values for one more request                      |
| `regenerate()`            | Move to a new session ID, keeping the data. Call it on login                 |
| `destroy()`               | Delete the session and clear the cookie. Call it on logout                   |
| `intended(fallback)`      | The page a guest asked for before being sent to log in, else `fallback`      |
| `id` / `isNew`            | The session ID; `true` if the visitor had no session before this request     |

Changes are saved when the response is sent. Outside a controller,
`currentSession()` returns the current request's session. Keys starting with
`__` are reserved for Megh.

## Logging in

Store the user's ID in the session, and read it back in an
[authentication handler](/core-concept/authentication). Then `@AuthUser()`,
`@Authorized()` and the `@auth` directive all work as usual:

```ts [auth/session.authentication.ts]
import {
  AppService,
  IRequest,
  MeghAuthentication,
  currentSession,
} from "@meghjs/core";

@AppService
export class SessionAuthentication extends MeghAuthentication<User> {
  constructor(private readonly users: UserRepository) {
    super();
  }

  async authenticate(_request: IRequest) {
    const id = currentSession()?.get<number>("userId");
    return id ? this.users.find(id) : null;
  }
}
```

```ts [app.ts]
app.useSession();
app.useAuthentication(SessionAuthentication);
```

```ts [controllers/auth.controller.ts]
@Post("/login")
async login(@Body() form: LoginForm, @Session() session: MeghSession) {
  const user = await this.users.verify(form.email, form.password);
  if (!user) {
    session.flash("error", "Wrong email or password.");
    return Results.Redirect("/login");
  }
  session.regenerate().set("userId", user.id);
  return Results.Redirect(session.intended("/"));
}

@Post("/logout")
logout(@Session() session: MeghSession) {
  session.destroy();
  return Results.Redirect("/");
}
```

Always call `regenerate()` on login. Without it, someone who planted a session
ID in the victim's browser before login (session fixation) would share the
logged-in session.

## Protecting pages

Route protection is the usual [authorization](/core-concept/authentication):
`useAuthorization()` with `default: "authenticated"` protects every route,
`@Public()` opens the login page, and `@Authorized({ roles: ["admin"] })`
runs your handler. For a browser, a 401 JSON body is no use, so set
`loginPath`:

```ts [app.ts]
app.useSession({ loginPath: "/login" });
app.useAuthentication(SessionAuthentication);
app.useAuthorization(RoleAuthorization, { default: "authenticated" });
```

When a route answers 401 and the request accepts HTML, the browser is
redirected to `/login` instead:

- A GET remembers its URL, and `session.intended("/")` returns it after login.
  It is always a path on your site, so it can't send users elsewhere.
- A form POST gets a 303 and isn't remembered, because it can't be replayed.
- JSON requests (`Accept: application/json`), XHR (`X-Requested-With:
  XMLHttpRequest`) and clients that don't ask for HTML keep the 401.
- A 403 stays a 403: the user is logged in, just not allowed.

Your own exception filters run first, so one that handles 401 itself wins.

## Gates

A gate is a named permission check, defined once and used in views and code:

```ts [app.ts]
app.defineGate("edit-post", (user: User, post: Post) =>
  user.role === "admin" || user.id === post.authorId,
);
```

```ts [controllers/posts.controller.ts]
import { gate } from "@meghjs/core";

@Post("/:id")
async update(@Param("id") id: number, @Body() form: PostForm) {
  const post = await this.posts.find(id);
  gate.authorize("edit-post", post); // 401 for a guest, 403 when denied
  // ...
}
```

| Method                                 | Does                                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| `gate.allows(name, ...args)`           | `true` when the current user passes. Guests never do         |
| `gate.denies(name, ...args)`           | The opposite                                                 |
| `gate.authorize(name, ...args)`        | Throws `UnauthorizedException` / `ForbiddenException`        |
| `gate.forUser(user).allows(name, ...)` | Check another user, e.g. in a job                            |

The check gets the user from `useAuthentication()`, then your arguments.
Guests are denied without calling it. It must return `true` or `false`
synchronously, because views render synchronously: load the post before
checking, and pass it in. `Gate` can also be injected.

## In views

Views get the session as `session`. Values you pass to `Results.View` take
precedence.

```html [views/layouts/app.megh.html]
<nav>
  @auth
    <form method="post" action="/logout"><button>Log out</button></form>
  @else
    <a href="/login">Log in</a>
  @endauth
</nav>

@session('status')
  <p class="status">{{ value }}</p>
@endsession

<p>{{ session.get('cart')?.length ?? 0 }} items</p>

@can('edit-post', post)
  <a href="/posts/{{ post.id }}/edit">Edit</a>
@else
  <span>Read only</span>
@endcan
```

- `@auth` … `@endauth` renders when the request has an authenticated user,
  meaning whatever `useAuthentication()` resolved. `@else` works inside it.
  It checks the request, not the view data, so a `user` you pass to a profile
  page doesn't count.
- `@guest` … `@endguest` is the opposite.
- `@session('key')` … `@endsession` renders only when the session has the key,
  flashed values included, with the value as `value`.
- `@can('gate', ...args)` … `@endcan` renders when the user passes the
  [gate](#gates); `@cannot` … `@endcannot` when they don't. Both take `@else`.

## Stores

The default `MemorySessionStore` keeps sessions in the process. Sessions are
lost on restart and not shared between replicas. In production, use Redis:

```ts
import Redis from "ioredis";

app.useSession({ redis: new Redis(process.env.REDIS_URL!) });
```

Keys are `megh:session:<id>`, each with a TTL of `maxAge`. For another
database, implement `SessionStore`:

```ts
import type { SessionData, SessionStore } from "@meghjs/core";

class PgSessionStore implements SessionStore {
  async get(id: string): Promise<SessionData | null> {
    /* ... */
  }
  async set(id: string, data: SessionData, ttlMs: number) {
    /* ... */
  }
  async destroy(id: string) {
    /* ... */
  }
}

app.useSession({ store: new PgSessionStore() });
```

A store Megh created is closed when the app shuts down. One you pass in is
yours to close.

::::
