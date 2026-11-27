---
title: Authentication
description: Identifying callers and protecting routes.
---

# Authentication

Megh splits access control into two steps:

- **Authentication** works out *who* the caller is and sets `request.user`.
- **Authorization** decides whether that caller may use a route marked
  `@Authorized`.

## Authentication

Extend `MeghAuthentication` and return the user, or `null` for an anonymous
request. Whatever you return becomes `request.user`:

```ts [auth/jwt.authentication.ts]
import { MeghAuthentication, AppService, IRequest } from '@meghjs/core';

@AppService
export class JwtAuthentication extends MeghAuthentication<User> {
  async authenticate(request: IRequest) {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    return verifyToken(header.slice(7));
  }
}
```

Register it once:

```ts [app.ts]
app.useAuthentication(JwtAuthentication);
```

Read the user in a handler with `@AuthUser()`:

```ts
@ApiController('/me')
export class MeController {
  @Get()
  whoami(@AuthUser() user: User) {
    return user;
  }
}
```

Authentication never rejects a request by itself. Use authorization for that.

## Authorization

Authorization is **deny-by-default**. Write a class with an `authorize` method
and mark it `@CanAuthorize`:

```ts [auth/jwt.authorization.ts]
import { CanAuthorize, IRequest, HttpExceptions } from '@meghjs/core';

@CanAuthorize
export class JwtAuthorization {
  async authorize(req: IRequest, options?: { roles?: string[] }) {
    if (!req.user) throw HttpExceptions.unauthorized('Login required'); // 401
    if (options?.roles && !options.roles.includes(req.user.role)) {
      return false; // 403
    }
  }
}
```

| `authorize` result | Response |
|--------------------|----------|
| returns `false` | 403 |
| throws an `HttpExceptions` error | that error's status |
| returns anything else (including nothing) | request continues |

Register it:

```ts [app.ts]
app.useAuthorization(JwtAuthorization);
```

### Protecting routes

```ts
// every route in the controller
@Authorized()
@ApiController('/admin')
export class AdminController {
  @Get()
  dashboard(@AuthUser() user: User) {
    return user;
  }
}

// one route, with options passed to authorize()
@ApiController('/reports')
export class ReportsController {
  @Authorized({ roles: ['admin'] })
  @Get('/stats')
  stats() {}
}
```

::: warning
If no authorizer is registered, Megh logs a warning at boot and every
`@Authorized` route answers **403**.
:::

### Multiple strategies

Register several authorizers by name and choose one per route:

```ts
app.useAuthorization({ jwt: JwtAuthorization, apiKey: ApiKeyAuthorization });

@Authorized('apiKey')                            // by name
@Authorized({ name: 'jwt', roles: ['admin'] })  // by name, with options
```

`@Authorized()` with no name uses the first registered handler. Naming a
handler that is not registered makes `app.run()` fail at boot.

### Deny by default

A route without `@Authorized` is public, so forgetting it on one handler
leaves that endpoint open. To flip this, set a default with
`useAuthorization`, and mark the routes that stay open with `@Public()`:

```ts
app.useAuthentication(JwtAuthentication);
app.useAuthorization(JwtAuthorization, { default: 'authenticated' });

@Public()
@ApiController('/auth')
export class AuthController {
  @Post('/login')
  login() {}
}

app.mapGet('/status', () => ({ ok: true })).public();
```

| `default` | Every route without `@Authorized` or `@Public` needs |
|---|---|
| `'authenticated'` | A user from `useAuthentication()`, else **401** |
| `true` | The default authorizer, like a bare `@Authorized()` |
| `'jwt'`, `{ name: 'jwt', roles: ['user'] }` | That authorizer and options, like `@Authorized('jwt')` |

- An explicit `@Authorized` on a route or its controller always wins over the
  default, and over `@Public`. A route marked with both logs a warning at boot.
- `@Public()` works on a controller or a route. Inline routes use `.public()`.
- Health probes (`useHealth()`), the OpenAPI UI and static files aren't routes
  Megh authorizes, so they stay public.
- The default is off unless you set it. `megh route:list` shows each route as
  `authorized`, `public` or `default` (protected only when a default is set).

## Order of checks

Middleware runs first (global, then `@UseMiddleware`), then authentication,
then the class and method `@Authorized` checks, then validation. See
[Middleware](/core-concept/middleware#pipeline-order).

## Server-rendered apps

For an app with views, keep the logged-in user in a
[session](/advanced/sessions#logging-in). With `loginPath`, browsers are
redirected to the login page instead of getting a 401, and
[gates](/advanced/sessions#gates) add permission checks you can use in views
with `@can`.
