/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 */
import Fastify, {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyPluginCallback,
  FastifyPluginOptions,
  FastifyRegisterOptions,
  InjectOptions,
  LightMyRequestResponse,
} from "fastify";
import type { AddressInfo } from "node:net";
import { MeghRouter } from "./router";
import { Container } from "../di";
import {
  IMeghApplication,
  MeghApplicationOptions,
  CorsOptions,
  GlobalOptions,
  CacheOptions,
  LifecycleHook,
  RunOptions,
  SchedulerScanOptions,
  CompressionOptions,
} from "./interfaces";
import {
  MeghErrorHandler,
  ErrorLogger,
  ExceptionFilterLike,
  ErrorHandlerFunction,
} from "../errors";
import { SystemUseError } from "../common/exceptions/system-exception";
import { Constructor } from "../common/helpers";
import { generateSwaggerSchema } from "../openapi/swagger-schema";
import { applyResponseExtensions } from "../openapi/responses";
import { applyRequestBodyExtensions } from "../openapi/request-body";
import { applyQueryParamExtensions } from "../openapi/query-params";
import { swaggerUiBranding } from "../openapi/branding";
import { OpenApiUiOptions } from "../openapi/openapi";
import {
  MeghMiddleware,
  type UseAuthorizationOptions,
} from "../http/middleware";
import { installMethodOverride } from "../http/method-override";
import {
  installSession,
  loginRedirectFilter,
  type SessionOptions,
  type SessionStore,
} from "../http/session";
import { defineGate, type GateCheck } from "../security/gate";
import { MeghScheduler } from "../scheduler";
import { isScheduledTask } from "../scheduler/schedule-registry";
import { isApiController } from "../common/container";
import { AutoControllerOptions, IResponse } from "./types";

import { CacheManager } from "../observability/cache";
import { Mailer } from "../mail/mailer";
import type { MailConfig } from "../mail/config";
import {
  HealthCheck,
  HealthOptions,
  HealthRegistry,
  SKIP_GLOBAL_MIDDLEWARE,
} from "../observability/health";
import {
  GetConfig,
  MeghConfig,
  validateConfigSchemas,
  validateEnv,
} from "../config/config";
import type { VersioningOptions } from "../http/versioning";
import { MeghAuthentication } from "../security/authentication";
import {
  SecurityHeadersOptions,
  installSecurityHeaders,
} from "../security/headers";
import {
  RateLimitOptions,
  RateLimitStore,
  installRateLimit,
} from "../security/rate-limit";
import { registerPlugins } from "../plugins/registry";
import { internalLogger } from "../observability/internal-logger";
import { ViewEngine, setViewEngine, type ViewEngineOptions } from "../view";
import {
  isTypeScriptRuntime,
  resolveSourceDir,
} from "../common/utils/path-utils";
import { requireOptional } from "../common/utils/optional-peer";
import { scanModules } from "./discovery";
import {
  DEFAULT_REQUEST_ID_HEADER,
  createRequestIdGenerator,
  installRequestContext,
} from "../observability/request-context";
// ---------------------------------------------------------------------------
// Lazy loaders for optional peer dependencies
// ---------------------------------------------------------------------------

const requireSocketIo = () =>
  requireOptional("fastify-socket.io", {
    install: ["fastify-socket.io", "socket.io"],
  });
const requireSwagger = () =>
  requireOptional("@fastify/swagger", {
    install: ["@fastify/swagger", "@fastify/swagger-ui"],
  });
const requireSwaggerUi = () => requireOptional("@fastify/swagger-ui");
const requireScalar = () => requireOptional("@scalar/fastify-api-reference");
const requireCors = () => requireOptional("@fastify/cors");
const requireMultipart = () => requireOptional("@fastify/multipart");
const requireStatic = () => requireOptional("@fastify/static");
const requireCompress = () => requireOptional("@fastify/compress");

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export class MeghApplication implements IMeghApplication {
  private readonly fastify: FastifyInstance;
  private router: MeghRouter;
  private static instance: MeghApplication;
  private alreadyRun = false;
  /** Set once routes are being mapped; Fastify plugins can no longer be added. */
  private routesMapped = false;
  private hasSwagger = false;
  private globalSwaggerOptions: OpenApiUiOptions | undefined;
  private registerControllerAuto = false;
  /** Set by useControllers({ auto: true, path }). Unset: every `controllers/` folder under src/. */
  private registerControllerPath: string | undefined;
  private controllers: any[] = [];
  private _hasWebsocket = false;
  private scheduler: MeghScheduler = new MeghScheduler();
  private schedulerTasks: any[] = [];
  private registerSchedulerAuto = false;
  private registerSchedulerPath = "src/tasks";
  private _workers: any[] = [];
  private lifecycleHooks: Record<"init" | "ready" | "close", LifecycleHook[]> =
    {
      init: [],
      ready: [],
      close: [],
    };
  private closing: Promise<void> | null = null;
  private signalHandler: ((signal: NodeJS.Signals) => void) | null = null;
  private pluginNames: string[] = [];
  private viewEngine: ViewEngine | undefined;
  private usesCache = false;
  private usesMail = false;
  private usesSecurityHeaders = false;
  private usesCompression = false;
  private usesMethodOverride = false;
  /** The session store Megh created, closed on shutdown. */
  private ownedSessionStore: SessionStore | null = null;
  private usesSession = false;
  private envSchemas: Constructor<object>[] = [];
  private rateLimitOptions: RateLimitOptions | undefined;
  /** The rate limit store Megh created, closed on shutdown. */
  private ownedRateLimitStore: RateLimitStore | null = null;
  /** `server.trustProxy`, which Fastify doesn't expose after construction. */
  private readonly trustProxy: unknown;
  private health = new HealthRegistry();
  private errorHandler = new MeghErrorHandler({
    isDevelopment: () => this.isDevelopment(),
  });

  private constructor(options?: MeghApplicationOptions) {
    const requestId = options?.requestId ?? {};
    const requestIdHeader =
      (requestId && requestId.header) || DEFAULT_REQUEST_ID_HEADER;
    this.trustProxy = options?.server?.trustProxy;
    this.fastify = Fastify({
      ...(requestId && {
        // genReqId decides; Fastify's own header lookup would trust any value.
        requestIdHeader: false,
        genReqId: createRequestIdGenerator(requestIdHeader, requestId.generate),
      }),
      ...options?.server,
      ajv: {
        customOptions: {
          strict: false,
          ...options?.server?.ajv?.customOptions,
        },
      },
    }) as FastifyInstance;
    this.router = new MeghRouter(this.fastify, {
      compiledValidation:
        options?.experimental?.compiledValidation ??
        /^(1|true)$/i.test(process.env.MEGH_COMPILED_VALIDATION ?? ""),
    });
    installRequestContext(this.fastify, requestId ? requestIdHeader : null);

    this.pluginNames = registerPlugins(this, options);
    if (this.pluginNames.length) {
      internalLogger("plugins").info(
        { plugins: this.pluginNames },
        "Plugins registered",
      );
    }
  }

  /** Names of the registered plugins, in registration order. */
  getPlugins(): readonly string[] {
    return this.pluginNames;
  }

  /**
   * The application. The first call creates it with `options`; later calls
   * return the same instance, and options passed to them are ignored (with a
   * warning).
   */
  public static getApp(options?: MeghApplicationOptions) {
    if (!MeghApplication.instance) {
      MeghApplication.instance = new MeghApplication(options);
    } else if (options !== undefined) {
      internalLogger("app").warn(
        "getApp(options) was called after the app was created; these options are ignored. " +
          "Pass options only to the first getApp() call.",
      );
    }
    return MeghApplication.instance;
  }

  /** @deprecated Use `getApp` instead. This is internal. */
  public static getInternalApp(options?: MeghApplicationOptions) {
    return new MeghApplication(options);
  }

  // ── Fastify plugins ──────────────────────────────────────────────────────

  /**
   * Register a Fastify plugin, for anything Megh doesn't cover with a `use*`
   * method. Call it before `run()` or inside an `onInit()` hook; Megh loads it
   * before adding routes, so plugins that hook into routes see all of them.
   * Errors from the plugin surface when the app starts.
   *
   *   import etag from "@fastify/etag";
   *   app.registerFastifyPlugin(etag);
   *   app.registerFastifyPlugin(etag, { weak: true });
   */
  registerFastifyPlugin<Options extends FastifyPluginOptions>(
    plugin:
      | FastifyPluginCallback<Options>
      | FastifyPluginAsync<Options>
      | Promise<{
          default: FastifyPluginCallback<Options> | FastifyPluginAsync<Options>;
        }>,
    options?: FastifyRegisterOptions<Options>,
  ) {
    if (this.routesMapped) {
      throw new SystemUseError(
        "registerFastifyPlugin() must be called before run() or inside an onInit() hook",
      );
    }
    this.fastify.register(
      plugin as FastifyPluginCallback<Options>,
      options ?? ({} as FastifyRegisterOptions<Options>),
    );
    return this;
  }

  /**
   * Send a request to the app in-process, without opening a socket. For
   * tests; `run()` the app first so its routes are mapped.
   *
   *   const res = await app.inject({ method: "GET", url: "/health" });
   *   res.statusCode; res.json();
   */
  inject(options: InjectOptions | string): Promise<LightMyRequestResponse> {
    return this.fastify.inject(options);
  }

  /**
   * The address the server listens on, or `null` before `run()` and after
   * `close()`. Handy after `run(0)` to find the port the OS picked.
   */
  address(): AddressInfo | string | null {
    return this.fastify.server.address();
  }

  // ── Feature methods ──────────────────────────────────────────────────────

  useCors(options: CorsOptions) {
    this.fastify.register(requireCors(), options); // ✅ lazy
    return this;
  }

  /**
   * Send security headers on every response: a Content Security Policy,
   * HSTS, `X-Frame-Options`, `X-Content-Type-Options: nosniff` and more.
   * Pass `false` for a header to leave it out. The API docs page from
   * `useOpenApi()` keeps its own CSP.
   *
   *   app.useSecurityHeaders()
   *   app.useSecurityHeaders({ contentSecurityPolicy: false })
   *   app.useSecurityHeaders({
   *     contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'https://cdn.example.com'] } },
   *   })
   */
  useSecurityHeaders(options?: SecurityHeadersOptions) {
    this.assertNotStarted("useSecurityHeaders");
    if (this.usesSecurityHeaders) {
      throw new SystemUseError("[Megh] useSecurityHeaders() is already on.");
    }
    installSecurityHeaders(this.fastify, options, () =>
      this.hasSwagger
        ? (this.globalSwaggerOptions?.routePrefix ?? "/swagger")
        : undefined,
    );
    this.usesSecurityHeaders = true;
    return this;
  }

  /**
   * Limit how many requests each client can make per window, answering 429
   * with `Retry-After` when it is over. Defaults to 100 a minute per IP,
   * counted in memory. Give a route its own limit with `@RateLimit()`.
   *
   *   app.useRateLimit()
   *   app.useRateLimit({ max: 300, window: '5m' })
   *   app.useRateLimit({ redis }) // share counts between replicas
   */
  useRateLimit(options: RateLimitOptions = {}) {
    this.assertNotStarted("useRateLimit");
    if (this.rateLimitOptions) {
      throw new SystemUseError("[Megh] useRateLimit() is already on.");
    }
    this.rateLimitOptions = { ...options };
    return this;
  }

  /** Install the rate limiter once routes are known. */
  private installRateLimiting() {
    const options =
      this.rateLimitOptions ??
      // Only @RateLimit() / .rateLimit() routes are limited.
      (this.router.hasRouteRateLimits ? { global: false } : undefined);
    if (!options) return;
    const { store, ownsStore } = installRateLimit(this.fastify, options, {
      trustProxy: this.trustProxy,
    });
    if (ownsStore) this.ownedRateLimitStore = store;
  }

  useCache(options?: CacheOptions) {
    CacheManager.configure(options);
    this.usesCache = true;

    if (!Container.has(CacheManager)) {
      Container.set(CacheManager, new CacheManager());
    }
    return this;
  }

  /**
   * Turn on mail: inject `Mailer` to send `Mailable`s. Settings come from
   * `MEGH_MAIL_*` in `.env`; anything passed here overrides them.
   *
   *   app.useMail()
   *   app.useMail({ from: 'hello@x.io', mailers: { audit: myTransport } })
   *   app.useMail(MailSettings) // an @AppConfig class returning MailConfig
   *
   * Throws at startup when the settings are invalid, e.g. in production with
   * no mailer set.
   */
  useMail(options?: MailConfig | Constructor<MeghConfig<MailConfig>>) {
    if (
      typeof options === "function" &&
      options.prototype != null &&
      typeof options.prototype.config === "function"
    ) {
      Mailer.configure(
        GetConfig(options as Constructor<MeghConfig<MailConfig>>),
      );
    } else {
      Mailer.configure(options as MailConfig | undefined);
    }
    this.usesMail = true;
    return this;
  }

  useMultipart(options?: any) {
    this.fastify.register(requireMultipart(), {
      // ✅ lazy
      attachFieldsToBody: true,
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
      ...options,
    });
    return this;
  }

  useOpenApi(
    options?: OpenApiUiOptions | Constructor<MeghConfig<OpenApiUiOptions>>,
  ) {
    this.hasSwagger = true;
    if (
      typeof options === "function" &&
      options.prototype != null &&
      typeof options.prototype.config === "function"
    ) {
      const { GetConfig } = require("../config/config");
      this.globalSwaggerOptions = GetConfig(options);
    } else {
      this.globalSwaggerOptions = options as OpenApiUiOptions;
    }

    return this;
  }

  private async initSwagger(options?: OpenApiUiOptions) {
    const safeControllers = (this.controllers ?? []).filter(
      (c) => c != null && typeof c === "function",
    );
    const baseSchema = generateSwaggerSchema(safeControllers);

    const security = openApiSecurity(options?.auth);
    await this.fastify.register(requireSwagger(), {
      // ✅ lazy
      openapi: {
        ...baseSchema,
        ...(options?.openapi ? { openapi: options.openapi } : {}),
        info: options?.info || { title: "API", version: "1.0.0" },
        servers: options?.servers,
        tags: options?.tags,
        components: {
          ...baseSchema?.components,
          ...options?.components,
          schemas: {
            ...baseSchema?.components?.schemas,
            ...options?.components?.schemas,
          },
        },
        security: options?.security,
        externalDocs: options?.externalDocs,
      },
      transformObject: ({ openapiObject }: { openapiObject: any }) => {
        const document = applyResponseExtensions(
          applyQueryParamExtensions(applyRequestBodyExtensions(openapiObject)),
          security,
        );
        if (options?.paths)
          document.paths = { ...options.paths, ...document.paths };
        return document;
      },
    });

    const routePrefix = options?.routePrefix || "/swagger";

    if ((options?.provider ?? options?.ui) === "scalar") {
      await this.fastify.register(requireScalar(), {
        // ✅ lazy
        routePrefix,
        // No `content`: with @fastify/swagger registered (above), Scalar
        // serves `fastify.swagger()`, the generated document. A `url` or
        // `content` in the options below still takes precedence.
        configuration: {
          ...options?.uiConfig,
          ...options?.configuration,
          ...options?.scalar,
        },
      });
    } else {
      await this.fastify.register(requireSwaggerUi(), {
        // ✅ lazy
        routePrefix,
        ...swaggerUiBranding({ logo: options?.logo, theme: options?.theme }),
        uiConfig: {
          docExpansion: "full",
          deepLinking: false,
          ...options?.uiConfig,
        },
        uiHooks: {
          onRequest: function (request: any, reply: any, next: any) {
            next();
          },
          preHandler: function (request: any, reply: any, next: any) {
            next();
          },
        },
        staticCSP: true,
        transformSpecificationClone: true,
      });
    }
  }

  useMiddlewares(middlewares: Constructor<MeghMiddleware>[]) {
    middlewares.forEach((m) => {
      const cls = Container.get<MeghMiddleware>(m);
      this.fastify.addHook("preHandler", async (req, res) => {
        // Health probes must answer even when global middleware would reject
        // the request (an API key check, an IP allowlist).
        if ((req.routeOptions?.config as any)?.[SKIP_GLOBAL_MIDDLEWARE]) return;
        await cls.invoke(req as any, res as IResponse);
      });
    });
    return this;
  }

  /**
   * Register the global authentication handler.
   *
   * The handler runs once per request, before any authorization handler, and
   * whatever its `authenticate` method returns becomes `request.user` — the
   * value injected by `@AuthUser()`.
   *
   *   app.useAuthentication(JwtAuthentication)
   *
   * @see MeghAuthentication
   */
  useAuthentication(authentication: Constructor<MeghAuthentication>) {
    if (typeof authentication !== "function") {
      throw new SystemUseError(
        "[Megh] useAuthentication expects an authentication class, e.g. app.useAuthentication(JwtAuthentication).",
      );
    }
    this.router.setAuthenticationHandler(authentication);
    return this;
  }

  /**
   * Register one or more authorization handlers.
   *
   * Single handler:
   *   app.useAuthorization(JwtAuthorization)
   *
   * Named map (multi-strategy):
   *   app.useAuthorization({ jwt: JwtAuthorization, oauth: OAuthV2 })
   *
   * Then in controllers:
   *   @Authorized()                    // uses the first/default handler
   *   @Authorized("jwt")               // uses the "jwt" handler
   *   @Authorized({ name: "oauth" })   // uses the "oauth" handler
   */
  useAuthorization(
    authorization: Constructor<any> | Record<string, Constructor<any>>,
    options: UseAuthorizationOptions = {},
  ) {
    if (typeof authorization === "function") {
      this.router.setAuthorizeMiddleware(authorization);
    } else {
      this.router.setAuthorizeMiddlewareMap(authorization);
    }
    if (options.default !== undefined) {
      this.router.setAuthorizationDefault(options.default);
    }
    return this;
  }

  /**
   * Register global exception filters. They run in order, after any
   * `@UseFilters` on the route or controller, and before Megh's default
   * error response.
   *
   *   app.useExceptionFilters([EntityNotFoundFilter, ProblemJsonFilter])
   *
   * Each entry can be a filter class (resolved through DI), a filter
   * instance or a function `(error, ctx) => ...`.
   *
   * @see ExceptionFilter
   */
  useExceptionFilters(filters: ExceptionFilterLike | ExceptionFilterLike[]) {
    this.assertNotStarted("useExceptionFilters");
    this.errorHandler.addFilters(Array.isArray(filters) ? filters : [filters]);
    return this;
  }

  /**
   * Register a function that handles request errors. It is a global filter
   * that sees every error: return a body to send it, return an `Error` to
   * hand it on, or return nothing to fall back to the default response.
   *
   *   app.useErrorHandler((error, { response }) => ({
   *     ok: false,
   *     message: response.body.message,
   *   }))
   */
  useErrorHandler(handler: ErrorHandlerFunction) {
    return this.useExceptionFilters([handler]);
  }

  /**
   * Replace how errors answered with the default response are logged, or
   * pass `false` to stop logging them.
   */
  useErrorLogger(logger: ErrorLogger | false) {
    this.errorHandler.setLogger(logger);
    return this;
  }

  /** Install the error and not-found handlers on the Fastify instance. @internal */
  installErrorHandling() {
    this.errorHandler.install(this.fastify);
  }

  /**
   * Serve health routes: `GET /health` (liveness, always 200) and
   * `GET /ready` (readiness: runs every health check, 503 if one fails).
   * Plugins register their own checks, such as Megh ORM's `database`.
   *
   *   app.useHealth({ checks: { redis: () => redis.ping() } })
   */
  useHealth(options: HealthOptions = {}) {
    this.assertNotStarted("useHealth");
    for (const [name, check] of Object.entries(options.checks ?? {})) {
      this.health.add(name, check);
    }
    this.health.install(this.fastify, options, () => this.isDevelopment());
    return this;
  }

  /**
   * Add a readiness check, reported by `GET /ready` once `useHealth()` is on.
   * It passes unless it throws, rejects or returns `false`.
   */
  addHealthCheck(name: string, check: HealthCheck) {
    this.health.add(name, check);
    return this;
  }

  /**
   * Register scheduled task classes.
   *
   * Explicit list:
   *   app.useScheduler([ReportTask, CleanupTask])
   *
   * Auto-scan a directory (mirrors useControllers):
   *   app.useScheduler({ path: "src/tasks" })
   */
  useScheduler(tasks: Constructor[] | SchedulerScanOptions = {}) {
    if (Array.isArray(tasks)) {
      for (const task of tasks) {
        if (!this.schedulerTasks.includes(task)) this.schedulerTasks.push(task);
      }
      this.scheduler.addTaskClasses(tasks);
    } else {
      this.registerSchedulerAuto = true;
      if (tasks.path) this.registerSchedulerPath = tasks.path;
    }
    return this;
  }

  /**
   * Register controller classes, or `{ auto: true }` to scan for them.
   * Calling it again adds to the earlier list.
   */
  useControllers(controllers: Constructor[] | AutoControllerOptions) {
    if (Array.isArray(controllers)) {
      for (const controller of controllers) {
        if (!this.controllers.includes(controller)) {
          this.controllers.push(controller);
        }
      }
    } else {
      this.registerControllerAuto = true;
      if (controllers.path) {
        this.registerControllerPath = controllers.path;
      }
    }
    return this;
  }

  useStaticFiles(options?: any) {
    this.fastify.register(requireStatic(), options); // ✅ lazy
    return this;
  }

  /**
   * Configure the view engine used by `Results.View()` / `view()`.
   *
   *   app.useViews({ root: "views" });       // views/pages/home.megh.html
   *   app.useViews(engine);                  // an engine you built yourself
   *
   * Templates are cached unless `NODE_ENV` is `"development"`, where a file
   * is recompiled when it changes.
   */
  useViews(options: ViewEngineOptions | ViewEngine = {}) {
    this.viewEngine =
      options instanceof ViewEngine ? options : new ViewEngine(options);
    setViewEngine(this.viewEngine);
    return this;
  }

  /** The engine set by `useViews()`, for `share()` and `directive()`. */
  getViews(): ViewEngine {
    if (!this.viewEngine) this.useViews();
    return this.viewEngine!;
  }

  /**
   * Compress responses (gzip, deflate, brotli) for clients that accept it,
   * with `@fastify/compress`. Options are passed to it; by default bodies
   * under 1024 bytes are sent as they are.
   *
   *   app.useCompression()
   *   app.useCompression({ encodings: ['gzip'] })
   */
  useCompression(options: CompressionOptions = {}) {
    this.assertNotStarted("useCompression");
    if (this.usesCompression) {
      throw new SystemUseError("[Megh] useCompression() is already on.");
    }
    this.usesCompression = true;
    this.fastify.register(requireCompress(), { global: true, ...options });
    return this;
  }

  /**
   * Let HTML forms send PUT, PATCH and DELETE. The form POSTs with a hidden
   * `_method` field, which `@method('PUT')` renders in a view, and the
   * request goes to the route for that method:
   *
   *   <form method="post" action="/todos/1">
   *     @method('DELETE')
   *     <button>Delete</button>
   *   </form>
   *
   * Only urlencoded form POSTs are rerouted. Also parses
   * `application/x-www-form-urlencoded` bodies for `@Body()`, unless a parser
   * for that type is already registered.
   */
  /**
   * Cookie sessions for server-rendered apps. The cookie carries only a
   * signed random ID; the data stays on the server, in memory by default.
   * Inject the session with `@Session()`; views get it as `session`.
   *
   *   app.useSession({ secret: process.env.SESSION_SECRET })
   *   app.useSession({ maxAge: "7 days", redis: new Redis() })
   *
   * Call `session.regenerate()` when a user logs in and `session.destroy()`
   * when they log out.
   */
  useSession(options: SessionOptions = {}) {
    this.assertNotStarted("useSession");
    if (this.usesSession) {
      throw new SystemUseError("[Megh] useSession() is already on.");
    }
    const { store, ownsStore } = installSession(this.app, options);
    this.usesSession = true;
    if (ownsStore) this.ownedSessionStore = store;
    if (options.loginPath !== undefined) {
      this.errorHandler.addFallbackFilter(
        loginRedirectFilter(options.loginPath),
      );
    }
    return this;
  }

  /**
   * Define a gate: a named permission check for the authenticated user,
   * used with `@can` / `@cannot` in views and `gate` in code. Guests are
   * denied without calling it.
   *
   *   app.defineGate("edit-post", (user: User, post: Post) => user.id === post.authorId)
   *
   *   @can('edit-post', post) <a href="/posts/{{ post.id }}/edit">Edit</a> @endcan
   *   gate.authorize("edit-post", post) // in a controller: 401 / 403 when denied
   */
  defineGate<TUser = any, TArgs extends unknown[] = any[]>(
    name: string,
    check: GateCheck<TUser, TArgs>,
  ) {
    defineGate(name, check as GateCheck);
    return this;
  }

  useMethodOverride() {
    this.assertNotStarted("useMethodOverride");
    if (this.usesMethodOverride) {
      throw new SystemUseError("[Megh] useMethodOverride() is already on.");
    }
    this.usesMethodOverride = true;
    installMethodOverride(this.fastify);
    return this;
  }

  /**
   * Put `prefix` in front of every controller and inline route:
   * `setGlobalPrefix('/api')` serves `@Get('/users')` at `/api/users`.
   * Health routes and the API docs page keep their own paths; `exclude`
   * lists more routes to leave alone (paths as declared, or RegExps).
   */
  setGlobalPrefix(
    prefix: string,
    options: { exclude?: (string | RegExp)[] } = {},
  ) {
    this.assertNotStarted("setGlobalPrefix");
    this.router.setGlobalPrefix(prefix, options.exclude);
    return this;
  }

  /**
   * Version controller routes with `@Version()`, in the path
   * (`{ type: 'uri' }`: `/v1/users`) or from a header
   * (`{ type: 'header' }`: `X-API-Version: 1`).
   */
  useVersioning(options: VersioningOptions) {
    this.assertNotStarted("useVersioning");
    this.router.setVersioning(options);
    return this;
  }

  /**
   * Validate environment variables against a DTO class when the app starts,
   * so a missing or malformed variable fails at boot with every problem
   * listed. Numbers and booleans are converted before validating.
   *
   *   class Env {
   *     @IsInt() PORT: number;
   *     @IsString() DATABASE_URL: string;
   *   }
   *   app.useEnvSchema(Env)
   *
   * `validateEnv(Env)` returns the converted values anywhere else.
   */
  useEnvSchema(schema: Constructor<object>) {
    this.assertNotStarted("useEnvSchema");
    this.envSchemas.push(schema);
    return this;
  }

  useGlobal(options: GlobalOptions) {
    if (options.cors) this.useCors(options.cors);
    if (options.openApi) this.useOpenApi(options.openApi);
    if (options.controllers) this.useControllers(options.controllers);
    if (options.middlewares) this.useMiddlewares(options.middlewares);
    if (options.authorization) this.useAuthorization(options.authorization);
    if (options.multipart) this.useMultipart(options.multipart);
    if (options.staticFiles) this.useStaticFiles(options.staticFiles);
    if (options.views) this.useViews(options.views);
    if (options.methodOverride) this.useMethodOverride();
    if (options.compression)
      this.useCompression(
        options.compression === true ? {} : options.compression,
      );
    if (options.securityHeaders)
      this.useSecurityHeaders(
        options.securityHeaders === true ? {} : options.securityHeaders,
      );
    if (options.rateLimit)
      this.useRateLimit(options.rateLimit === true ? {} : options.rateLimit);
    if (options.scheduler) this.useScheduler(options.scheduler);
    return this;
  }

  useSocketIo(options?: any) {
    this._hasWebsocket = true;
    this.fastify.register(requireSocketIo(), options); // ✅ lazy
    return this;
  }

  /**
   * Register queue workers.
   *
   * Resolving each class through the container is what starts it: `@Queue`
   * boots its worker in the constructor, and `@MeghWorker` starts on
   * resolution unless `autoStart: false` was set.
   *
   *   app.useWorker([EmailQueue, ReportWorker])
   *
   * Workers are closed automatically when the application shuts down.
   */
  useWorker(workers: Constructor<any>[]) {
    if (!Array.isArray(workers)) {
      throw new SystemUseError(
        "[Megh] useWorker expects an array of queue or worker classes, e.g. app.useWorker([EmailQueue]).",
      );
    }

    for (const worker of workers) {
      const instance = Container.get(worker) as any;
      // @MeghWorker({ autoStart: false }) defers starting until now.
      if (typeof instance?.start === "function" && !instance.getWorker?.()) {
        instance.start();
      }
      this._workers.push(instance);
    }

    return this;
  }

  /** Close every registered worker, releasing their Redis connections. */
  private async _closeWorkers() {
    await Promise.all(
      this._workers.map(async (w) => {
        try {
          await w?.close?.();
        } catch (err) {
          internalLogger("queue").error({ err }, "Failed to close worker");
        }
      }),
    );
    this._workers = [];
  }

  /**
   * True only when `NODE_ENV` is exactly `"development"`. An unset
   * `NODE_ENV` counts as production, so dev-only features (API docs,
   * detailed errors) stay off unless explicitly enabled.
   */
  isDevelopment() {
    return process.env.NODE_ENV === "development";
  }

  private async _mapControllers() {
    this.routesMapped = true;
    // Load the plugins registered so far (compression, CORS, ...) first:
    // some, like @fastify/compress, hook into routes as they are added.
    await this.fastify.after();
    const safeControllers = (this.controllers ?? []).filter(
      (c) => c != null && typeof c === "function",
    );
    if (safeControllers.length > 0) {
      for (const controller of safeControllers) {
        if (isApiController(controller)) {
          await this.router.buildController(controller);
        } else {
          throw new SystemUseError("Not an API controller.");
        }
      }
    }
  }

  private _resolveControllerDir(dir?: string) {
    return resolveSourceDir(
      dir ?? this.registerControllerPath ?? "src",
      isTypeScriptRuntime(),
    );
  }

  private async autoControllers(controllersPath?: string) {
    const conDir = this._resolveControllerDir(controllersPath);
    // Without a path, look in every folder named `controllers` under src/:
    // src/controllers/** and module folders such as src/users/controllers/**.
    const inControllersFolder = (file: string) =>
      file.split(/[\\/]/).slice(0, -1).includes("controllers");
    const scanAll =
      controllersPath !== undefined ||
      this.registerControllerPath !== undefined;

    await scanModules(conDir, "controllers", {
      include: (file) => scanAll || inControllersFolder(file),
      visit: (exports) => this.collectControllers(exports),
    });
  }

  private collectControllers(exports: unknown[]) {
    for (const exported of exports) {
      if (
        typeof exported === "function" &&
        isApiController(exported) &&
        !this.controllers.includes(exported)
      ) {
        this.controllers.push(exported);
      }
    }
  }

  private handleSocket(socket: any) {
    // ✅ lazy — only resolve socket services when socket actually connects
    try {
      const { SocketContextService } = require("../events/socket-dispatcher");
      const { EventSubscriberRegistry } = require("../events/event-subscriber");
      const contextService = Container.get(SocketContextService) as any;
      const subscriberRegistry = Container.get(EventSubscriberRegistry) as any;

      subscriberRegistry.register(socket);

      const originalOn = socket.on.bind(socket);
      socket.on = (event: string, handler: Function) => {
        return originalOn(event, (...args: any[]) => {
          contextService.run(socket, () => handler(...args));
        });
      };
    } catch (e) {
      internalLogger("realtime").warn({ err: e }, "Socket handler error");
    }
  }

  // ── Functional routing proxies ───────────────────────────────────────────

  mapGet<T extends (...args: any[]) => any>(path: string = "", fn: T) {
    return this.router.mapGet(path, fn);
  }
  mapPost<T extends (...args: any[]) => any>(path: string = "", fn: T) {
    return this.router.mapPost(path, fn);
  }
  mapPut<T extends (...args: any[]) => any>(path: string = "", fn: T) {
    return this.router.mapPut(path, fn);
  }
  mapPatch<T extends (...args: any[]) => any>(path: string = "", fn: T) {
    return this.router.mapPatch(path, fn);
  }
  mapDelete<T extends (...args: any[]) => any>(path: string = "", fn: T) {
    return this.router.mapDelete(path, fn);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Run `hook` during `run()`, after the database connects and before routes
   * are mapped and the server listens. A rejected hook aborts startup.
   */
  onInit(hook: LifecycleHook) {
    this.assertNotStarted("onInit");
    this.lifecycleHooks.init.push(hook);
    return this;
  }

  /** Run `hook` once the server is listening. */
  onReady(hook: LifecycleHook) {
    this.assertNotStarted("onReady");
    this.lifecycleHooks.ready.push(hook);
    return this;
  }

  /**
   * Run `hook` when the app shuts down: on `close()`, SIGTERM or SIGINT.
   * Close hooks run in reverse registration order, after the server has
   * stopped accepting requests. A failing hook is logged and the rest still run.
   */
  onClose(hook: LifecycleHook) {
    this.lifecycleHooks.close.push(hook);
    return this;
  }

  /**
   * Shut the app down: stop the HTTP server (waiting for in-flight requests),
   * stop scheduled tasks and queue workers, then run the `onClose` hooks.
   * Calling it again returns the same shutdown.
   */
  close(): Promise<void> {
    this.closing ??= this._close();
    return this.closing;
  }

  private async _close() {
    if (this.signalHandler) {
      process.removeListener("SIGTERM", this.signalHandler);
      process.removeListener("SIGINT", this.signalHandler);
      this.signalHandler = null;
    }
    await this.fastify.close();
    // Stops every job and waits for runs already in progress.
    await this.scheduler.stopAll();
    await this._closeWorkers();
    if (this.usesCache) {
      try {
        await CacheManager.close();
      } catch (err) {
        internalLogger("app").error({ err }, "Closing the cache failed");
      }
    }
    if (this.ownedRateLimitStore) {
      try {
        await this.ownedRateLimitStore.close?.();
      } catch (err) {
        internalLogger("app").error({ err }, "Closing the rate limiter failed");
      }
      this.ownedRateLimitStore = null;
    }
    if (this.ownedSessionStore) {
      try {
        await this.ownedSessionStore.close?.();
      } catch (err) {
        internalLogger("app").error(
          { err },
          "Closing the session store failed",
        );
      }
      this.ownedSessionStore = null;
    }
    if (this.usesMail) {
      try {
        await Mailer.close();
      } catch (err) {
        internalLogger("app").error(
          { err },
          "Closing the mail transports failed",
        );
      }
    }
    for (const hook of [...this.lifecycleHooks.close].reverse()) {
      try {
        await hook();
      } catch (err) {
        internalLogger("app").error({ err }, "onClose hook failed");
      }
    }
  }

  private assertNotStarted(method: string) {
    if (this.alreadyRun) {
      throw new SystemUseError(`${method}() must be called before run()`);
    }
  }

  private async runHooks(hooks: LifecycleHook[]) {
    for (const hook of hooks) {
      await hook();
    }
  }

  // ── Run ──────────────────────────────────────────────────────────────────

  private async _autoSchedulerTasks(): Promise<void> {
    const resolvedDir = resolveSourceDir(
      this.registerSchedulerPath,
      isTypeScriptRuntime(),
    );
    await scanModules(resolvedDir, "tasks", {
      visit: (exports) => this.collectTasks(exports),
    });
  }

  private collectTasks(exports: unknown[]) {
    for (const exported of exports) {
      if (
        typeof exported === "function" &&
        isScheduledTask(exported) &&
        !this.schedulerTasks.includes(exported)
      ) {
        this.schedulerTasks.push(exported);
        this.scheduler.addTaskClasses([exported as Constructor]);
      }
    }
  }

  /** Rate limiting, error handling, Fastify `ready()` and Socket.IO. */
  private async finishStartup() {
    this.installRateLimiting();
    this.installErrorHandling();

    await this.fastify.ready();

    if (this._hasWebsocket) {
      // @ts-ignore
      if (!this.fastify.io) {
        throw new Error(
          "Socket.IO not initialized. Make sure fastify-socket.io is registered correctly.",
        );
      }
      // ✅ lazy — resolve SocketIoServer token only when websocket is ready
      try {
        const { SocketIoServer } = require("../realtime/websocket");
        // @ts-ignore
        Container.set(SocketIoServer, this.fastify.io);
        // The app's authentication handler runs on the handshake and sets
        // socket.data.user, which @PrivateChannel listeners require.
        const authentication = this.router.getAuthenticationHandler();
        if (authentication) {
          const { handshakeAuthentication } = require("../realtime/handshake");
          // @ts-ignore
          this.fastify.io.use(
            handshakeAuthentication(Container.get(authentication) as any),
          );
        }
        // @ts-ignore
        await this.fastify.io.on("connection", this.handleSocket.bind(this));
      } catch (e) {
        internalLogger("realtime").warn({ err: e }, "WebSocket setup error");
      }
    }
  }

  /**
   * Start the server.
   *
   *   await app.run(3000)
   *   await app.run(3000, { host: "127.0.0.1" })
   *
   * The port defaults to the `PORT` environment variable, else `4000`. The
   * host defaults to the `HOST` environment variable, else `0.0.0.0` so the
   * app is reachable inside containers.
   */
  async run(
    port?: number,
    options?: RunOptions | CallableFunction,
  ): Promise<void> {
    const fn = typeof options === "function" ? options : options?.onListen;
    const runOptions: RunOptions = typeof options === "object" ? options : {};
    if (this.alreadyRun) throw new SystemUseError("App already running");
    const listenPort = port ?? portFromEnv();
    this.alreadyRun = true;

    // Settings first: a bad environment or config fails before anything starts.
    for (const schema of this.envSchemas) validateEnv(schema);
    validateConfigSchemas();

    if (this.hasSwagger) {
      await this.initSwagger(this.globalSwaggerOptions);
    }

    await this.runHooks(this.lifecycleHooks.init);

    if (this.registerControllerAuto) {
      await this.autoControllers();
    }

    await this._mapControllers();
    this.router.processFunctionalRoutes();

    // Start scheduler after DB is ready and controllers are mapped,
    // but before the HTTP server starts accepting traffic.
    if (this.registerSchedulerAuto) {
      await this._autoSchedulerTasks();
    }
    if (this.schedulerTasks.length > 0) {
      this.scheduler.start();
    }

    try {
      await this.finishStartup();
    } catch (err) {
      // Startup failed after the jobs started: stop them, or their timers
      // keep running (and the process alive) for an app that never served.
      await this.scheduler.stopAll();
      throw err;
    }

    const timeout = runOptions.shutdownTimeout ?? 10_000;
    const gracefulStop = async (signal: NodeJS.Signals) => {
      const log = internalLogger("app");
      log.info({ signal }, "Shutting down");
      // A hung close (open keep-alive sockets, a stuck hook) must not keep
      // the process alive forever.
      const timer = setTimeout(() => {
        log.error({ timeout }, "Shutdown timed out; exiting");
        process.exit(1);
      }, timeout);
      timer.unref();
      try {
        await this.close();
        process.exit(0);
      } catch (err) {
        log.error({ err }, "Shutdown failed");
        process.exit(1);
      }
    };
    this.signalHandler = gracefulStop;
    process.once("SIGTERM", gracefulStop);
    process.once("SIGINT", gracefulStop);

    const host = runOptions.host ?? process.env.HOST ?? "0.0.0.0";
    let address: string;
    try {
      address = await this.fastify.listen({ port: listenPort, host });
    } catch (err) {
      process.removeListener("SIGTERM", gracefulStop);
      process.removeListener("SIGINT", gracefulStop);
      this.signalHandler = null;
      await this.scheduler.stopAll();
      throw err;
    }
    internalLogger("app").info(
      { address },
      `Application running on ${address}`,
    );
    await this.runHooks(this.lifecycleHooks.ready);
    if (fn) fn();
  }
}

/** The port from the `PORT` environment variable, else 4000. */
function portFromEnv(): number {
  const raw = process.env.PORT?.trim();
  if (!raw) return 4000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new SystemUseError(
      `Invalid PORT "${process.env.PORT}": expected a whole number from 0 to 65535.`,
    );
  }
  return port;
}

/** The security scheme and requirement for `useOpenApi({ auth })`. */
function openApiSecurity(
  auth: OpenApiUiOptions["auth"],
):
  { requirement: Record<string, string[]>; scheme: [string, any] } | undefined {
  if (!auth) return undefined;
  const [name, scheme] =
    auth === "bearer"
      ? ["bearerAuth", { type: "http", scheme: "bearer", bearerFormat: "JWT" }]
      : auth === "apiKey"
        ? ["apiKey", { type: "apiKey", in: "header", name: "X-API-Key" }]
        : ["auth", auth];
  return { requirement: { [name]: [] }, scheme: [name, scheme] };
}
