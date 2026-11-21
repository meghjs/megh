---
title: Security Hardening
description: What Megh protects by default, and the checklist for running an app in production.
---

# Security Hardening

Megh ships with safe defaults for the parts it owns. The rest, such as CORS,
security headers and rate limits, depends on your app, so you turn it on
yourself. The checklist below shows how.

## What Megh does by default

### `@Authorized` fails closed

A route marked `@Authorized` (or `.authorized()` on an inline route) is never
served without an authorization handler. If you forget
`app.useAuthorization(...)`, every request gets **403**, and startup logs a
warning:

```text
GET /admin uses @Authorized but no authorization handler is registered;
every request will be denied (403). Call app.useAuthorization(YourAuthorization).
```

An `authorize` method that returns `false` also answers 403. See
[Authentication](/core-concept/authentication).

### DTOs reject unknown properties

`@Body()` and `@Query()` DTOs are validated with `whitelist` and
`forbidNonWhitelisted`. A property the DTO doesn't declare fails with 400, so
a client can't slip `isAdmin: true` into a model. See
[Validation](/core-concept/validation).

### 5xx details stay on the server

Unless `NODE_ENV=development`, a 5xx response is only:

```json
{ "code": 500, "status": "Error", "message": "Internal Server Error" }
```

The real message, payload and stack are logged, not sent. 4xx messages are
sent as written, so don't put internal details in them. `/ready` likewise
hides why a health check failed outside development.

### Uploads stay in their folder

`FileStorage` treats uploads as untrusted. By default it:

- saves files under a random UUID name that keeps the extension;
- rejects filenames containing `/`, `\`, `..` or null bytes;
- keeps every path, including `to`, inside `baseDir`. When saving or reading
  it checks this again after following symlinks;
- accepts only an allowlist of extensions (images, PDF, office files,
  text/CSV, zip, audio and video). HTML, SVG and JS are rejected;
- never overwrites an existing file.

The MIME type is not checked unless you set `allowedMimeTypes`. See
[File Uploads](/advanced/file-uploads).

### Download headers are escaped

`Results.OkStream(stream, { filename })` builds `Content-Disposition` so a
filename can't inject headers: the plain `filename` keeps only safe ASCII and
the real name goes in the RFC 5987 `filename*` parameter.

### Logs leave out credentials

- Error logs record the method, URL, status and error. Request headers and
  bodies are not logged.
- Database passwords are replaced by `***` in connection log lines and
  connection errors.
- A client's `x-request-id` is only reused if it matches
  `^[\w.:-]{1,128}$`; anything else is replaced by a generated ID, so it
  can't forge log lines.

The URL includes the query string, so keep tokens out of query parameters.

## Checklist

### Restrict CORS

`useCors` passes its options to `@fastify/cors`. The scaffold uses
`origin: '*'`; list your front-ends instead:

```ts
app.useCors({
  origin: ['https://app.example.com', /\.example\.com$/],
  credentials: true,
});
```

Browsers refuse credentialed requests when the allowed origin is `*`.

### Add security headers

`app.useSecurityHeaders()` sends these headers on every response, including
errors and 404s:

| Header | Default |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'`, no plugins, no inline script, no framing by other sites |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `Origin-Agent-Cluster`, `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Permitted-Cross-Domain-Policies` | `?1`, `off`, `noopen`, `none` |
| `X-XSS-Protection` | `0`, which turns off the old XSS filter (it caused more holes than it closed) |

```ts [src/app.ts]
app.useSecurityHeaders();
```

Pass `false` to leave a header out, or change it:

```ts
app.useSecurityHeaders({
  contentSecurityPolicy: {
    directives: {
      imgSrc: ["'self'", 'https://cdn.example.com'], // camelCase or 'img-src'
      upgradeInsecureRequests: false,                 // drop a default
    },
  },
  strictTransportSecurity: { maxAge: 63072000, preload: true },
  frameOptions: 'DENY',
  crossOriginResourcePolicy: 'cross-origin', // a public asset API
  headers: { 'Permissions-Policy': 'camera=(), microphone=()' },
});
```

- `contentSecurityPolicy: { reportOnly: true }` sends
  `Content-Security-Policy-Report-Only`, so you can try a policy before
  enforcing it. `useDefaults: false` starts from an empty policy.
- `crossOriginEmbedderPolicy` is off unless you set it, since it blocks
  cross-origin images and scripts.
- `headers` adds any other header, or removes a default with `false`.
- A header a route sets itself wins over the default.
- The API docs page from `useOpenApi()` keeps its own CSP. Swagger UI sends
  a policy that fits it, and Scalar needs inline script, so both still load.

Megh checks the options at startup and throws on a value that could break or
inject a header, such as a newline or a `;` in a CSP source.

### Add rate limits

`app.useRateLimit()` limits each client to 100 requests a minute, counted per
IP in memory. Over the limit, the client gets **429** in Megh's error shape,
with `Retry-After`:

```ts [src/app.ts]
app.useRateLimit();                           // 100 a minute
app.useRateLimit({ max: 300, window: '5m' }); // window: ms, '30s', '15m', '1 hour'
```

Every limited response carries `RateLimit-Limit`, `RateLimit-Remaining` and
`RateLimit-Reset` (seconds left in the window). Pass `headers: false` to hide
them.

Give a sensitive route a tighter limit with `@RateLimit()`, on a method or a
whole controller. It gets its own counter, so login attempts don't use up the
app-wide allowance. `@RateLimit(false)` takes a route out:

```ts [src/controllers/auth.controller.ts]
import { ApiController, Get, Post, RateLimit } from '@meghjs/core';

@ApiController('/auth')
export class AuthController {
  @Post('/login')
  @RateLimit({ max: 5, window: '15m' })
  login() {}

  @Get('/status')
  @RateLimit(false)
  status() {}
}
```

Inline routes take `.rateLimit({ ... })`. `@RateLimit()` works without
`useRateLimit()`: then only the routes that declare a limit are limited, as
with `useRateLimit({ global: false })`.

More options:

```ts
app.useRateLimit({
  key: (req) => String(req.headers['x-api-key'] ?? req.ip), // count per API key
  skip: (req) => req.ip === '10.0.0.5',                     // internal callers
  message: 'Slow down',
});
```

Things to know:

- **Behind a proxy**, `request.ip` is the proxy's address unless you set
  `trustProxy` (next section). Without it, every client shares one counter.
  Set it to a hop count or the proxy's address, never `true`: with `true`,
  clients can send their own `X-Forwarded-For` and get a fresh counter on
  every request. Megh warns at boot when rate limiting runs with
  `trustProxy: true`.
- **Several replicas** each count on their own with the memory store. Pass
  an ioredis client so they share one count:

  ```ts
  import Redis from 'ioredis';

  app.useRateLimit({ redis: new Redis(process.env.REDIS_URL!) });
  ```

  Megh does not close a client you pass in. For another backend, implement
  `RateLimitStore` (`hit(key, windowMs)` returns `{ count, resetAt }`) and pass
  it as `store`.
- **IPv6 clients** are counted per `/64` network, because one host usually
  owns a whole `/64` and could rotate addresses inside it to dodge the limit.
  Change it with `ipv6Subnet` (`128` counts each address). IPv4 is counted
  per address.
- **The memory store holds at most 100,000 clients.** Past that it drops the
  oldest windows first and logs a warning once, so a flood of new addresses
  can't exhaust memory. Dropped clients start a fresh count. Raise the cap
  with `store: new MemoryRateLimitStore({ maxKeys: 500_000 })`, or use Redis.
- **If the store fails** (Redis is down), requests get 500. Set
  `failOpen: true` to let them through instead; the error is still logged.
- `/health` and `/ready` from `useHealth()` are never limited, so probes keep
  answering. Unknown URLs are limited, so scanning for paths counts.
- Limits use a fixed window: a client can send up to `max` at the end of one
  window and `max` more at the start of the next.

### Terminate HTTPS at a proxy

Serve HTTPS from a load balancer, ingress or reverse proxy, and keep the app
on plain HTTP inside the network. Tell Fastify to trust the proxy so
`request.ip`, `request.protocol` and `request.hostname` come from the
`X-Forwarded-*` headers:

```ts
const app = Megh.createApplication({
  server: { trustProxy: 1 }, // one proxy in front; or its address, e.g. '10.0.0.0/8'
});
```

Don't use `trustProxy: true`. Common proxies, such as nginx with
`$proxy_add_x_forwarded_for` and AWS ALB, **append** the client's address to
`X-Forwarded-For` instead of replacing it. With `true`, Fastify takes the
leftmost entry, which the client wrote, so clients can spoof their IP and
dodge rate limits. A hop count (the number of proxies you run) or the
proxies' addresses make Fastify read the entry your own proxy added. Bind to `127.0.0.1` (`HOST=127.0.0.1`) when the proxy runs on the same
machine. To terminate TLS in Node instead, pass `server.https`.

### Limit body sizes

Fastify rejects JSON bodies over 1 MiB with 413. Lower it if your API takes
small payloads:

```ts
Megh.createApplication({ server: { bodyLimit: 100 * 1024 } }); // 100 KB
```

`useMultipart()` limits each file to 10 MB by default. Set `limits` to
change it, and cap the number of files and fields too:

```ts
app.useMultipart({ limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 } });
```

### Keep secrets in the environment

- Read secrets from environment variables or your platform's secret store.
  The scaffold's `.gitignore` already leaves out `.env` and `.env.local`.
- Don't bake `.env` into images. Add it to `.dockerignore`.
- Fail fast when a secret is missing: `env.getOrThrow('JWT_SECRET')`. See
  [Configuration](/core-concept/configuration).

### Keep the OpenAPI docs in development

`useOpenApi()` serves the docs whenever you call it. Gate it, as the scaffold
does:

```ts
if (app.isDevelopment()) {
  app.useOpenApi(OpenApiConfig);
}
```

If you need public docs, put them behind authentication at the proxy.

### Set `NODE_ENV=production`

Everything above that depends on production mode (hidden 5xx details, hidden
health errors, docs off) needs `NODE_ENV` to be anything but `development`.
See [Deployment](/production/deployment#environment).

### Audit dependencies

```bash
npm audit --omit=dev
npx megh doctor
```

`npm audit` reports known vulnerabilities. `megh doctor` checks that Node,
`@meghjs/core` and the CLI versions line up. Keep Megh, Fastify and the
`@fastify/*` plugins current, and run the audit in CI.
