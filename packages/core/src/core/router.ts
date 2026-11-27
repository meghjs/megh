/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 */
import {
  Constructor,
  formatUrl,
  autoCast,
  normalizeQueryDeep,
  validateOrThrow,
  transformAndValidate,
  formatValidationMessage,
} from "../common/helpers";
import { Container } from "../di";
import { internalLogger } from "../observability/internal-logger";
import { setRequestUser } from "../observability/request-context";
import {
  CONTROLLER_META_KEY,
  ROUTE_META_KEY,
  PARAM_META_KEY,
  QUERY_META_KEY,
  REQUEST_BODY_META_KEY,
  REQUEST_HEADER_META_KEY,
  REQUEST_USER_META_KEY,
  REQUEST_SESSION_META_KEY,
  AUTHORIZATION_META_KEY,
  PUBLIC_META_KEY,
  REQUEST_BODY_FILE_KEY,
  REQUEST_BODY_FILES_KEY,
} from "../common/container";
import { SystemUseError } from "../common/exceptions/system-exception";
import { sessionOf } from "../http/session";
import { MethodParamMeta, IRequest, FuncRoute } from "./types";
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  ValidationErrorException,
} from "../errors/http-exceptions";
import type { AuthorizationDefault } from "../http/middleware";
import { getDeclaredFilters } from "../errors/exception-filter";
import {
  RATE_LIMIT_CONFIG_KEY,
  RATE_LIMIT_ROUTE_ID_KEY,
  nextRateLimitRouteId,
  RouteRateLimitOptions,
  assertRouteRateLimit,
  getDeclaredRateLimit,
} from "../security/rate-limit";
import {
  compileValidator,
  CompiledValidator,
} from "../common/utils/compiled-validation";
import { isMeghValidatorClass } from "../validator/metadata";
import { runValidation } from "../validator/compiler";
import { assertMeghOnly } from "../validator/compat";
import {
  resolveFilter,
  ROUTE_FILTERS_CONFIG_KEY,
} from "../errors/error-handler";
import { contentDisposition } from "../common/utils/path-utils";
import { MeghMiddleware } from "../http/middleware";
import { REQUEST_METADATA_KEY } from "../http/controller";
import { HTTP_CODE_META_KEY } from "../http/route-methods";
import { HTTP_STATUS_KEY, HttpResult, OkStream } from "../http/results";
import { OpenApiOptions } from "../openapi/openapi";
import {
  AUTHORIZED_EXTENSION,
  RESPONSES_EXTENSION,
  buildResponses,
  declaredResponses,
  isResponseType,
} from "../openapi/responses";
import {
  buildRequestBody,
  REQUEST_BODY_EXTENSION,
} from "../openapi/request-body";
import {
  buildQueryParameters,
  QUERY_PARAMS_EXTENSION,
} from "../openapi/query-params";
import mime from "mime";
import { HTTPMethods, FastifyInstance } from "fastify";
import { ViewResult, sendView } from "../view/result";
import { assertParamTypes } from "../http/params";
import {
  ROUTE_DESCRIPTOR_CONFIG_KEY,
  createRouteDescriptor,
} from "../plugins/route-descriptor";
import {
  REDIRECT_META_KEY,
  RESPONSE_HEADERS_META_KEY,
} from "../http/route-methods";
import {
  VERSION_META_KEY,
  VersioningOptions,
  normalizeVersions,
} from "../http/versioning";

const log = internalLogger("router");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a flat params/query map like:
 *   { id: { type: "string", example: "abc-123" } }
 * into a valid AJV/JSON Schema object:
 *   { type: "object", properties: { id: { type: "string", example: "abc-123" } } }
 */
function normalizeParamsToJsonSchema(
  map: Record<string, any>,
  requiredKeys: string[] = [],
): any {
  const properties: Record<string, any> = {};
  for (const [key, val] of Object.entries(map)) {
    const { required, ...rest } = val;
    properties[key] = { type: "string", ...rest };
  }
  const schema: any = { type: "object", properties };
  if (requiredKeys.length > 0) schema.required = requiredKeys;
  return schema;
}

/**
 * Take a raw @OpenApi schema object and return a Fastify-compatible
 * route schema — normalizing params, query → querystring, and headers.
 */
function buildRouteSchema(
  raw: any,
  bodyClass?: Function,
  route: {
    declared?: ReturnType<typeof declaredResponses>;
    validates?: boolean;
    authorized?: boolean;
  } = {},
): any {
  const { requestBody, responseBody, exclude, ...rest } = raw ?? {};
  const schema: any = rest;

  // Responses given as a class, `[Class]` or `Paginated(Class)` are
  // documented only: a Fastify `response` schema would also serialize the
  // reply. Plain JSON schemas stay on `response`, as before.
  const declared = [...(route.declared ?? [])];
  if (raw?.response && typeof raw.response === "object") {
    const fastifyResponse: Record<string, any> = {};
    for (const [status, value] of Object.entries<any>(raw.response)) {
      if (isResponseType(value))
        declared.push({ status: Number(status), type: value });
      else fastifyResponse[status] = value;
    }
    if (Object.keys(fastifyResponse).length) schema.response = fastifyResponse;
    else delete schema.response;
  }
  const responses = buildResponses({
    declared,
    validates: !!route.validates,
    authorized: !!route.authorized,
  });
  if (responses) schema[RESPONSES_EXTENSION] = responses;
  if (route.authorized) schema[AUTHORIZED_EXTENSION] = true;

  // @OpenApi({ exclude: true }) → hidden from the generated document.
  if (exclude) schema.hide = true;

  // Request body documentation: see openapi/request-body.ts. Without one,
  // a Fastify `body` schema is documented by @fastify/swagger itself.
  const docBody = buildRequestBody({
    requestBody: requestBody ?? responseBody,
    bodyClass,
    consumes: raw.consumes,
  });
  if (docBody) schema[REQUEST_BODY_EXTENSION] = docBody;

  // ✅ Normalize path params
  if (raw.params && typeof raw.params === "object" && !raw.params.type) {
    const required = Object.entries(raw.params)
      .filter(([, v]: [string, any]) => v.required !== false)
      .map(([k]) => k);
    schema.params = normalizeParamsToJsonSchema(raw.params, required);
  }

  // ✅ Normalize query → Fastify uses "querystring", not "query"
  if (raw.query && typeof raw.query === "object" && !raw.query.type) {
    const required = Object.entries(raw.query)
      .filter(([, v]: [string, any]) => v.required === true)
      .map(([k]) => k);
    schema.querystring = normalizeParamsToJsonSchema(raw.query, required);
    delete schema.query;
  }

  // ✅ Normalize headers
  if (raw.headers && typeof raw.headers === "object" && !raw.headers.type) {
    schema.headers = normalizeParamsToJsonSchema(raw.headers);
  }

  return schema;
}

/**
 * A DTO validation failure, answered by the error handler as a 400 with the
 * issues in `errors`.
 */
function validationError(
  errors: { path: string; constraints: Record<string, string> }[],
) {
  return new ValidationErrorException(formatValidationMessage(errors), errors);
}

/**
 * Methods `@All` routes answer. Fastify has no `ALL` method; HEAD comes
 * with GET automatically.
 */
const ALL_METHODS: HTTPMethods[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

/** Fastify route constraint used by header versioning. */
const VERSION_CONSTRAINT = "meghVersion";

function toFastifyMethod(method: string): HTTPMethods | HTTPMethods[] {
  const upper = method.toUpperCase();
  return upper === "ALL" ? ALL_METHODS : (upper as HTTPMethods);
}

/**
 * Send what a route returned: an `HttpResult` with its status and headers,
 * a body marked by `withStatus`, a download or stream, or a plain value.
 * `httpCode` comes from `@HttpCode` and loses to the result's own status.
 */
function sendResult(res: any, result: any, httpCode?: number) {
  // The handler answered itself, e.g. after `reply.hijack()` to stream.
  if (res.sent) return res;
  if (result instanceof ViewResult) return sendView(res, result);
  if (result instanceof HttpResult) {
    res.code(result.statusCode);
    for (const [name, value] of Object.entries(result.headers)) {
      res.header(name, value);
    }
    if (result instanceof OkStream) {
      const { contentType, filename } = result.options;
      res.header(
        "Content-Type",
        contentType ||
          (filename && mime.getType(filename)) ||
          "application/octet-stream",
      );
      if (filename) {
        res.header("Content-Disposition", contentDisposition(filename));
      }
    }
    const body = result.body;
    return body === undefined ? res.send() : res.send(body);
  }

  const status =
    (result !== null && typeof result === "object"
      ? (result as any)[HTTP_STATUS_KEY]
      : undefined) ?? httpCode;
  if (status !== undefined) res.code(status);

  if (result && result.download) {
    const { stream, filename } = result;
    if (!stream || typeof stream.pipe !== "function") {
      return res.code(500).send({
        code: 500,
        error: "INTERNAL_ERROR",
        message: "Invalid stream object",
      });
    }
    const contentType =
      result.contentType ||
      mime.getType(filename) ||
      "application/octet-stream";
    res.header("Content-Type", contentType);
    res.header("Content-Disposition", contentDisposition(filename));
    stream.on("error", (err: any) => {
      log.error({ err }, "Stream error");
      if (!res.sent) {
        res.code(500).send({
          code: 500,
          error: "StreamError",
          message: "Error while streaming file.",
        });
      }
    });
    return res.send(stream);
  }

  if (result && result.pipe) {
    result.on("error", (err: any) => {
      log.error({ err }, "Stream error");
      if (!res.sent) {
        res.code(500).send({
          code: 500,
          error: "StreamError",
          message: "Error while streaming file.",
        });
      }
    });
    res.header("Content-Type", "application/octet-stream");
    return res.send(result);
  }

  return res.send(result);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class MeghRouter {
  // Keyed on the prototype itself: two controllers can share a class name.
  private metaCache = new WeakMap<object, Map<string, MethodParamMeta>>();
  private rMap = new Map<string, FuncRoute>();
  private app: FastifyInstance;
  private authorizeMiddleware?: Constructor<any>;
  private authorizeMiddlewareMap = new Map<string, Constructor<any>>();
  private authenticationHandler?: Constructor<any>;
  /** Set by `useAuthorization(handler, { default })`. */
  private authorizationDefault?: AuthorizationDefault;

  private compiledValidation: boolean;
  /** True once a mapped route declares its own rate limit. */
  hasRouteRateLimits = false;
  private globalPrefix = "";
  private prefixExclude: (string | RegExp)[] = [];
  private versioning?: VersioningOptions;

  /** Prefix every controller and inline route, e.g. `/api`. */
  setGlobalPrefix(prefix: string, exclude: (string | RegExp)[] = []) {
    const clean = prefix.trim() === "" ? "" : formatUrl(prefix);
    this.globalPrefix = clean === "/" ? "" : clean;
    this.prefixExclude = exclude.map((e) =>
      typeof e === "string" ? formatUrl(e) || "/" : e,
    );
  }

  /** Turn on URI or header versioning for controller routes. */
  setVersioning(options: VersioningOptions) {
    if (this.versioning) {
      throw new Error("[Megh] useVersioning() is already on.");
    }
    if (options.defaultVersion !== undefined) {
      normalizeVersions(options.defaultVersion);
    }
    this.versioning = options;
    if (options.type === "header") {
      const header = (options.header ?? "x-api-version").toLowerCase();
      const fallback =
        options.defaultVersion === undefined
          ? undefined
          : normalizeVersions(options.defaultVersion)[0];
      // A route constraint: routes registered with { version: "2" } only
      // match requests that ask for 2 (or the default version, when the
      // header is missing). Routes without @Version match any request.
      this.app.addConstraintStrategy({
        name: VERSION_CONSTRAINT,
        storage() {
          const routes = new Map<string, unknown>();
          return {
            get: (version: string) => (routes.get(version) ?? null) as any,
            set: (version: string, store: unknown) => {
              routes.set(version, store);
            },
          };
        },
        deriveConstraint: (req: any) => {
          const value = req.headers[header];
          const version = Array.isArray(value) ? value[0] : value;
          return typeof version === "string" && version.trim() !== ""
            ? version.trim()
            : fallback;
        },
        mustMatchWhenDerived: false,
      } as any);
    }
  }

  /** The URL(s) and constraints to register a route under. */
  private routeTargets(
    path: string,
    versions: string[] | undefined,
  ): { url: string; constraints?: Record<string, string> }[] {
    const normalizedPath = formatUrl(path) || "/";
    const excluded = this.prefixExclude.some((e) =>
      typeof e === "string" ? e === normalizedPath : e.test(path),
    );
    const prefix = excluded ? "" : this.globalPrefix;
    const join = (...parts: string[]) => formatUrl(parts.join("/")) || "/";
    const v = this.versioning;
    if (!v || !versions) return [{ url: join(prefix, path) }];
    if (v.type === "uri") {
      return versions.map((version) => ({
        url: join(prefix, `${v.prefix ?? "v"}${version}`, path),
      }));
    }
    return versions.map((version) => ({
      url: join(prefix, path),
      constraints: { [VERSION_CONSTRAINT]: version },
    }));
  }

  /** Version(s) of a controller route: method, then class, then the default. */
  private routeVersions(
    controller: Function,
    prototype: object,
    method: string,
  ): string[] | undefined {
    if (!this.versioning) return undefined;
    const own =
      Reflect.getMetadata(VERSION_META_KEY, prototype, method) ??
      Reflect.getMetadata(VERSION_META_KEY, controller) ??
      Reflect.getMetadata(CONTROLLER_META_KEY, controller)?.options?.version;
    const versions = own ?? this.versioning.defaultVersion;
    return versions === undefined ? undefined : normalizeVersions(versions);
  }

  constructor(
    app: FastifyInstance,
    options: { compiledValidation?: boolean } = {},
  ) {
    this.app = app;
    this.compiledValidation = !!options.compiledValidation;
  }

  /**
   * Register the global authentication handler. It runs before authorization
   * on every route and populates `request.user`.
   */
  setAuthenticationHandler(handler: Constructor<any>) {
    this.authenticationHandler = handler;
  }

  /** The class registered with `useAuthentication`, if any. */
  getAuthenticationHandler(): Constructor<any> | undefined {
    return this.authenticationHandler;
  }

  setAuthorizationDefault(value: AuthorizationDefault | undefined) {
    this.authorizationDefault = value;
  }

  /**
   * What a route needs once the global default is applied.
   *
   * - `authorize`: `@Authorized` options to run, or `undefined`.
   * - `requireUser`: the `"authenticated"` default, which needs a user.
   *
   * An explicit `@Authorized` / `.authorized()` always wins; `@Public` /
   * `.public()` only skips the default.
   */
  private _applyAuthorizationDefault(
    declared: boolean,
    isPublic: boolean,
    label: string,
  ): {
    authorize?: { name?: string; [key: string]: any };
    requireUser: boolean;
  } {
    if (isPublic && declared) {
      log.warn(
        `${label} is marked both public and authorized; @Authorized wins and the route stays protected.`,
      );
    }
    const def = this.authorizationDefault;
    if (declared || isPublic || def === undefined)
      return { requireUser: false };
    if (def === "authenticated") {
      if (!this.authenticationHandler) {
        log.warn(
          `${label} requires an authenticated user (useAuthorization default "authenticated") ` +
            "but no authentication handler is registered; every request will get 401. " +
            "Call app.useAuthentication(YourAuthentication).",
        );
      }
      return { requireUser: true };
    }
    if (def === true) return { authorize: {}, requireUser: false };
    return {
      authorize: typeof def === "string" ? { name: def } : def,
      requireUser: false,
    };
  }

  setAuthorizeMiddleware(middleware: Constructor<any>) {
    this.authorizeMiddleware = middleware;
  }

  setAuthorizeMiddlewareMap(map: Record<string, Constructor<any>>) {
    for (const [name, cls] of Object.entries(map)) {
      this.authorizeMiddlewareMap.set(name, cls);
    }
    // First entry also becomes the default for bare @Authorized()
    if (!this.authorizeMiddleware) {
      this.authorizeMiddleware = Object.values(map)[0];
    }
  }

  /**
   * Resolve the correct authorizer class from @Authorized options.
   *   @Authorized("jwt")            -> map.get("jwt")
   *   @Authorized({ name: "oauth"}) -> map.get("oauth")
   *   @Authorized()                 -> default authorizeMiddleware
   */
  private _resolveAuthorizer(options?: {
    name?: string;
  }): Constructor<any> | undefined {
    if (options?.name) {
      const named = this.authorizeMiddlewareMap.get(options.name);
      if (!named) {
        throw new Error(
          `[Megh] No authorization handler registered under the name "${options.name}". ` +
            `Did you call useAuthorization({ ${options.name}: YourClass })?`,
        );
      }
      return named;
    }
    return this.authorizeMiddleware;
  }

  private _processMeta(prototype: any, method: string): MethodParamMeta {
    let perClass = this.metaCache.get(prototype);
    if (!perClass) {
      perClass = new Map();
      this.metaCache.set(prototype, perClass);
    }
    const cached = perClass.get(method);
    if (cached) return cached;

    const meta: MethodParamMeta = {
      request:
        Reflect.getMetadata(REQUEST_METADATA_KEY, prototype, method) || [],
      params: Reflect.getMetadata(PARAM_META_KEY, prototype, method) || [],
      query: Reflect.getMetadata(QUERY_META_KEY, prototype, method) || [],
      body: Reflect.getMetadata(REQUEST_BODY_META_KEY, prototype, method) || [],
      file: Reflect.getMetadata(REQUEST_BODY_FILE_KEY, prototype, method) || [],
      files:
        Reflect.getMetadata(REQUEST_BODY_FILES_KEY, prototype, method) || [],
      headers:
        Reflect.getMetadata(REQUEST_HEADER_META_KEY, prototype, method) || [],
      currentUser:
        Reflect.getMetadata(REQUEST_USER_META_KEY, prototype, method) || [],
      session:
        Reflect.getMetadata(REQUEST_SESSION_META_KEY, prototype, method) || [],
    };

    // Pre-compute args array size once at boot (avoids 8x .map + spread + Math.max per request).
    let _maxIdx = -1;
    const _groups = [
      meta.params,
      meta.query,
      meta.body,
      meta.currentUser,
      meta.session ?? [],
      meta.headers,
      meta.request ?? [],
      meta.file ?? [],
      meta.files ?? [],
    ];
    for (const group of _groups) {
      for (const item of group) {
        if (item.index > _maxIdx) _maxIdx = item.index;
      }
    }
    (meta as any)._argCount = _maxIdx + 1;

    // Pre-compute branch flags so the handler can skip entire loop bodies
    // in the common case where no files/validation are involved.
    (meta as any)._needsFiles =
      (meta.file?.length ?? 0) > 0 || (meta.files?.length ?? 0) > 0;
    (meta as any)._hasRequiredParams = meta.params.some((p: any) => p.required);
    (meta as any)._hasValidatorQuery = meta.query.some(
      (q: any) => q.validatorClass || q.required,
    );
    (meta as any)._hasValidatorBody = meta.body.some(
      (b: any) => b.validatorClass,
    );

    perClass.set(method, meta);
    return meta;
  }

  private executeMiddlewares(target: any, propertyKey?: string) {
    const classMiddlewares =
      Reflect.getMetadata("controller:middleware", target.constructor) || [];
    const methodMiddlewares = propertyKey
      ? Reflect.getMetadata("route:middleware", target, propertyKey) || []
      : [];
    return [...classMiddlewares, ...methodMiddlewares];
  }

  async buildController(controller: any) {
    const ctrl: any = Container.get(controller);
    const controllerMeta = Reflect.getMetadata(
      CONTROLLER_META_KEY,
      ctrl.constructor,
    );
    if (!controllerMeta) return;

    const prototype = Object.getPrototypeOf(ctrl);
    const methods = Object.getOwnPropertyNames(prototype).filter(
      (name) => name !== "constructor",
    );
    const tag = ctrl.constructor.name.replace("Controller", "");
    const swaggerControllerMeta =
      Reflect.getMetadata("controller:openapi", ctrl.constructor) || {};
    const authClsMeata = Reflect.getMetadata(
      AUTHORIZATION_META_KEY,
      ctrl.constructor,
    ) || { authorize: false, options: undefined };

    for await (const method of methods) {
      const methodMeta = Reflect.getMetadata(ROUTE_META_KEY, prototype, method);
      if (!methodMeta) continue;
      assertParamTypes(prototype, method, ctrl.constructor.name);

      const methodmetaOptions = {
        method: methodMeta.method.toLowerCase(),
        path: formatUrl(controllerMeta.path + methodMeta.path),
      };
      const classMiddlewares = this.executeMiddlewares(ctrl, method);
      // `@OpenApi()` on the method, over the route decorator's `openapi` option.
      const swaggerMeta = {
        ...(methodMeta.openapi ?? {}),
        ...(Reflect.getMetadata("route:openapi", prototype, method) || {}),
      };
      let authClsMethodMeata = Reflect.getMetadata(
        AUTHORIZATION_META_KEY,
        ctrl.constructor,
        method,
      ) || { authorize: false, options: undefined };
      // useAuthorization(handler, { default }) for routes with neither
      // @Authorized nor @Public.
      const _isPublic = !!(
        Reflect.getMetadata(PUBLIC_META_KEY, ctrl.constructor, method) ||
        Reflect.getMetadata(PUBLIC_META_KEY, ctrl.constructor)
      );
      const _authDefault = this._applyAuthorizationDefault(
        !!(authClsMeata.authorize || authClsMethodMeata.authorize),
        _isPublic,
        `${methodMeta.method.toUpperCase()} ${formatUrl(controllerMeta.path + methodMeta.path)}`,
      );
      if (_authDefault.authorize) {
        authClsMethodMeata = {
          authorize: true,
          options: _authDefault.authorize,
        };
      }
      const _requireUser = _authDefault.requireUser;

      const allMeta = this._processMeta(prototype, method);

      // --- Build body schema from @Body() decorator ---
      let bodySchema: any = null;
      allMeta.body.forEach((r) => {
        if (r.schema) {
          bodySchema = { ...r.schema };
        }
      });

      // --- Build base schema (single declaration) ---
      let schema: any = {
        ...swaggerControllerMeta,
        ...swaggerMeta,
        tags: [tag],
      };

      // Apply body schema if not manually set in @OpenApi
      if (!swaggerMeta.body && bodySchema) {
        schema = { ...schema, body: bodySchema };
      }

      // ✅ Auto-detect body from @Body() DTO if still not set
      if (!swaggerMeta.body && !bodySchema) {
        for (const bodyMeta of allMeta.body) {
          if (bodyMeta.validatorClass && bodyMeta.schema) {
            schema = { ...schema, body: bodyMeta.schema };
            break;
          }
        }
      }

      const routePath =
        methodmetaOptions.path === "" ? "/" : methodmetaOptions.path;
      const routeTargets = this.routeTargets(
        routePath,
        this.routeVersions(ctrl.constructor, prototype, method),
      );

      // --- Handle multipart ---
      const isMultipart =
        schema?.consumes?.includes("multipart/form-data") ||
        Object.values(schema?.body?.properties || {}).some(
          (p: any) => p.format === "binary",
        );

      if (isMultipart) {
        schema.consumes = ["multipart/form-data"];
        if (!schema.body) {
          schema.body = { type: "object", properties: {} };
        }
        for (const param of allMeta.body) {
          if (param.type === "route:file") {
            schema.body.properties[param.key] = {
              type: "string",
              format: "binary",
            };
          } else if (param.key !== "all") {
            // A whole-body DTO (`@Body() dto`) has no single field to add, and
            // its class is not a JSON schema type.
            schema.body.properties[param.key] = {
              type:
                typeof param.dataType === "string" ? param.dataType : "string",
            };
          }
        }
      }

      // DTO of the route's @Body() parameter, documented as the request body
      // unless @OpenApi supplies a raw Fastify `body` schema.
      const bodyClass = swaggerMeta.body
        ? undefined
        : allMeta.body.find(
            (b) => b.validatorClass && typeof b.dataType === "function",
          )?.dataType;

      // ✅ Normalize params/query/headers into valid JSON Schema
      const routeSchema = buildRouteSchema(schema, bodyClass, {
        declared: declaredResponses(ctrl.constructor, method),
        validates: [...allMeta.body, ...allMeta.query].some(
          (p) => p.validatorClass,
        ),
        authorized: !!(
          authClsMeata.authorize ||
          authClsMethodMeata.authorize ||
          _requireUser
        ),
      });

      // @Query() parameters, documented only (Megh validates them itself).
      const queryParams = buildQueryParameters(allMeta.query as any);
      if (queryParams.length > 0)
        routeSchema[QUERY_PARAMS_EXTENSION] = queryParams;

      // Resolve DI singletons once at route-registration time, not per request.
      // _resolveAuthorizer picks the named handler when @Authorized("jwt") is used,
      // or falls back to the default handler for bare @Authorized().
      const _clsAuthCls = authClsMeata.authorize
        ? this._resolveAuthorizer(authClsMeata.options)
        : null;
      const _mthdAuthCls = authClsMethodMeata.authorize
        ? this._resolveAuthorizer(authClsMethodMeata.options)
        : null;
      const _clsAuthInst = _clsAuthCls
        ? (Container.get(_clsAuthCls) as any)
        : null;
      const _mthdAuthInst = _mthdAuthCls
        ? (Container.get(_mthdAuthCls) as any)
        : null;
      // @Authorized with no authorizer registered must never serve the route.
      const _authMissing =
        (authClsMeata.authorize && !_clsAuthInst) ||
        (authClsMethodMeata.authorize && !_mthdAuthInst);
      if (_authMissing) {
        log.warn(
          `${methodmetaOptions.method.toUpperCase()} ${routePath} uses @Authorized ` +
            "but no authorization handler is registered; every request will be denied (403). " +
            "Call app.useAuthorization(YourAuthorization).",
        );
      }
      // Global authentication handler, resolved once. Runs before authorization
      // so authorizers (and @AuthUser()) can rely on request.user being set.
      const _authnInst = this.authenticationHandler
        ? (Container.get(this.authenticationHandler) as any)
        : null;
      // @UseMiddleware accepts classes (resolved through DI) or instances.
      const _resolvedMw: MeghMiddleware[] = classMiddlewares.map((m: any) =>
        typeof m === "function" ? Container.get<MeghMiddleware>(m) : m,
      );

      // @HttpCode on the route; a returned result's own status wins.
      const _httpCode: number | undefined = Reflect.getMetadata(
        HTTP_CODE_META_KEY,
        prototype,
        method,
      );

      // @UseFilters on the route, then the controller, resolved once.
      const _routeFilters = getDeclaredFilters(ctrl.constructor, method).map(
        resolveFilter,
      );

      const _rateLimit = getDeclaredRateLimit(ctrl.constructor, method);
      if (_rateLimit) this.hasRouteRateLimits = true;
      // Shared by every URL this handler is registered under.
      const _rateLimitId = _rateLimit
        ? nextRateLimitRouteId(`${ctrl.constructor.name}.${method}`)
        : undefined;

      // DTOs with Megh's decorators use Megh's validator. class-validator
      // DTOs use class-validator, or (experimental flag) a validator compiled
      // from its metadata; see common/utils/compiled-validation.ts.
      // `undefined` = transformAndValidate.
      // A Megh validator returns its result synchronously unless a custom
      // validator returned a promise.
      const _compile = (meta: any): CompiledValidator | undefined => {
        if (!meta.validatorClass) return undefined;
        if (isMeghValidatorClass(meta.dataType)) {
          assertMeghOnly(meta.dataType);
          return ((value: unknown) =>
            runValidation(meta.dataType, value)) as CompiledValidator;
        }
        return this.compiledValidation
          ? compileValidator(meta.dataType)
          : undefined;
      };
      const _queryValidators = allMeta.query.map(_compile);
      const _bodyValidators = allMeta.body.map(_compile);

      // @Redirect and @ResponseHeader on the route.
      const _redirect: { url: string; statusCode: number } | undefined =
        Reflect.getMetadata(REDIRECT_META_KEY, prototype, method);
      const _responseHeaders: Record<string, string> | undefined =
        Reflect.getMetadata(RESPONSE_HEADERS_META_KEY, prototype, method);

      // Read by plugins (e.g. @meghjs/ai) in Fastify's onRoute hook.
      const _descriptor = createRouteDescriptor({
        controller: ctrl.constructor,
        handler: method,
        url: routePath,
        paramMeta: allMeta.params as any,
        query: queryParams,
        rawBody: swaggerMeta.body ? routeSchema.body : undefined,
        bodyClass,
        authorized: !!(
          authClsMeata.authorize ||
          authClsMethodMeata.authorize ||
          _requireUser
        ),
      });

      for (const target of routeTargets)
        this.app.route({
          url: target.url,
          ...(target.constraints && { constraints: target.constraints }),
          method: toFastifyMethod(methodmetaOptions.method),
          schema: routeSchema,
          attachValidation: isMultipart,
          config: {
            [ROUTE_DESCRIPTOR_CONFIG_KEY]: _descriptor,
            [ROUTE_FILTERS_CONFIG_KEY]: _routeFilters,
            ...(_rateLimit !== undefined && {
              [RATE_LIMIT_CONFIG_KEY]: _rateLimit,
            }),
            ...(_rateLimitId && { [RATE_LIMIT_ROUTE_ID_KEY]: _rateLimitId }),
          },
          handler: async (req, res) => {
            let reqClone = req as unknown as IRequest;

            // Order: middleware (controller, then route) → authentication →
            // @Authorized (controller, then route) → validation → handler.
            // Global middleware already ran as a preHandler hook.
            if (_resolvedMw.length > 0) {
              for (const mInst of _resolvedMw) {
                reqClone = ((await mInst.invoke(reqClone, res)) ??
                  reqClone) as IRequest;
                if (res.sent) return;
              }
            }

            if (_authnInst) {
              const user = await _authnInst.authenticate(reqClone);
              if (res.sent) return;
              if (user !== null && user !== undefined) {
                setRequestUser(reqClone, user);
              }
            }

            if (_requireUser && (reqClone as any).user == null) {
              throw new UnauthorizedException("Unauthorized");
            }

            if (_authMissing) {
              throw new ForbiddenException("Forbidden");
            }

            if (_clsAuthInst) {
              const allowed = await _clsAuthInst.authorize(
                reqClone,
                authClsMeata.options,
              );
              if (res.sent) return;
              if (allowed === false) throw new ForbiddenException("Forbidden");
            }

            if (_mthdAuthInst) {
              const allowed = await _mthdAuthInst.authorize(
                reqClone,
                authClsMethodMeata.options,
              );
              if (res.sent) return;
              if (allowed === false) throw new ForbiddenException("Forbidden");
            }

            const _argsResult = this._mapArgs(reqClone, allMeta);
            const args =
              _argsResult !== null &&
              typeof (_argsResult as any).then === "function"
                ? await (_argsResult as Promise<any[]>)
                : (_argsResult as any[]);

            if ((allMeta as any)._hasRequiredParams) {
              for (let i = 0; i < allMeta.params.length; i++) {
                const paramMeta = allMeta.params[i];
                if (paramMeta.required) {
                  validateOrThrow(
                    { [paramMeta.key]: args[paramMeta.index] },
                    { [paramMeta.key]: { type: paramMeta.dataType } },
                    { location: "param" },
                  );
                }
              }
            }

            if ((allMeta as any)._hasValidatorQuery) {
              for (let i = 0; i < allMeta.query.length; i++) {
                const queryMeta = allMeta.query[i];
                if (queryMeta.validatorClass) {
                  let result: any = _queryValidators[i]?.(
                    args[queryMeta.index],
                  );
                  if (result && typeof result.then === "function")
                    result = await result;
                  const { value, errors } =
                    result ??
                    (await transformAndValidate(
                      queryMeta.dataType,
                      args[queryMeta.index],
                    ));
                  if (errors) throw validationError(errors);
                  args[queryMeta.index] = value;
                }
                if (queryMeta.required) {
                  validateOrThrow(
                    { [queryMeta.key]: args[queryMeta.index] },
                    { [queryMeta.key]: { type: queryMeta.dataType } },
                    { location: "queryparam" },
                  );
                }
              }
            }

            if (!isMultipart && (allMeta as any)._hasValidatorBody) {
              for (let i = 0; i < allMeta.body.length; i++) {
                const bodyMeta = allMeta.body[i];
                if (bodyMeta.validatorClass) {
                  let result: any = _bodyValidators[i]?.(args[bodyMeta.index]);
                  if (result && typeof result.then === "function")
                    result = await result;
                  const { value, errors } =
                    result ??
                    (await transformAndValidate(
                      bodyMeta.dataType,
                      args[bodyMeta.index],
                    ));
                  if (errors) throw validationError(errors);
                  args[bodyMeta.index] = value;
                }
              }
            }

            const result = await prototype[method].apply(ctrl, args);

            if (_responseHeaders) {
              for (const [name, value] of Object.entries(_responseHeaders)) {
                res.header(name, value);
              }
            }
            if (_redirect && !(result instanceof HttpResult)) {
              // `{ url, statusCode }` from the handler overrides the decorator.
              const url =
                typeof result?.url === "string" ? result.url : _redirect.url;
              const code = Number.isInteger(result?.statusCode)
                ? result.statusCode
                : _redirect.statusCode;
              return res.code(code).header("location", url).send();
            }
            return sendResult(res, result, _httpCode);
          },
        });
    }
  }

  private _mapArgs(
    req: IRequest,
    meta: MethodParamMeta,
  ): any[] | Promise<any[]> {
    // _argCount pre-computed at boot in _processMeta; no allocations here.
    const args: any[] = new Array((meta as any)._argCount);

    for (let i = 0; i < meta.params.length; i++) {
      const p = meta.params[i];
      const raw =
        p.key === "all" ? { ...req.params } : (req.params[p.key] ?? null);
      args[p.index] = autoCast(raw, p.dataType, p.schema);
    }

    for (let i = 0; i < meta.query.length; i++) {
      const q = meta.query[i];
      const raw =
        q.key === "all"
          ? normalizeQueryDeep({ ...req.query })
          : req.query[q.key];
      args[q.index] = autoCast(raw, q.dataType, q.schema);
    }

    for (let i = 0; i < meta.body.length; i++) {
      const _fd = (req as any).formData;
      args[meta.body[i].index] = _fd ? { ...req.body, ..._fd } : req.body;
    }

    for (let i = 0; i < meta.currentUser.length; i++) {
      args[meta.currentUser[i].index] = (req as any).user;
    }

    const sessions = meta.session ?? [];
    for (let i = 0; i < sessions.length; i++) {
      const session = sessionOf(req);
      if (!session) {
        throw new SystemUseError(
          "[Megh] @Session() needs sessions: call app.useSession() first.",
        );
      }
      args[sessions[i].index] = session;
    }

    for (let i = 0; i < meta.headers.length; i++) {
      const header = meta.headers[i];
      args[header.index] =
        header.key === "all" ? { ...req.headers } : req.headers[header.key];
    }

    for (let i = 0; i < meta.request.length; i++) {
      args[meta.request[i].index] = req;
    }

    if (!(meta as any)._needsFiles) return args;
    return this._mapFiles(req, meta, args);
  }

  /** Save the uploaded files and fill the `@UploadFile(s)` arguments. */
  private async _mapFiles(
    req: IRequest,
    meta: MethodParamMeta,
    args: any[],
  ): Promise<any[]> {
    if (
      req.headers["content-type"]?.startsWith("multipart/form-data") &&
      (req as any).saveRequestFiles
    ) {
      const files = await (req as any).saveRequestFiles();

      if (!files || files.length === 0) {
        if (meta.files && meta.files.length > 0) {
          throw new BadRequestException({ error: "No files uploaded" });
        }
        if (meta.file && meta.file.length > 0) {
          meta.file.forEach((f) => {
            args[f.index] = null;
          });
        }
      } else {
        const fileInfo = files.map((file: any) => ({
          type: file.type,
          filepath: file.filepath,
          fieldname: file.fieldname,
          filename: file.filename,
          encoding: file.encoding,
          mimetype: file.mimetype,
          fields: file.fields,
          toBuffer: file.toBuffer,
        }));

        if (meta.file && meta.file.length > 0) {
          meta.file.forEach((f) => {
            if (f.fieldName === "all") {
              args[f.index] = fileInfo[0] || null;
            } else {
              const file = fileInfo.find(
                (x: any) => x.fieldname === f.fieldName,
              );
              if (!file) {
                throw new BadRequestException(
                  `File field "${f.fieldName}" not found in uploaded files`,
                );
              }
              args[f.index] = file;
            }
          });
        }

        if (meta.files && meta.files.length > 0) {
          meta.files.forEach((f) => {
            if (f.fieldName === "all") {
              args[f.index] = fileInfo;
            } else {
              const matchingFiles = fileInfo.filter(
                (x: any) => x.fieldname === f.fieldName,
              );
              if (matchingFiles.length === 0) {
                throw new BadRequestException(
                  `No files found for field "${f.fieldName}"`,
                );
              }
              args[f.index] = matchingFiles;
            }
          });
        }
      }
    } else {
      throw new BadRequestException({
        error:
          "Invalid content type. Expected multipart/form-data for file uploads",
      });
    }

    return args;
  }

  private _routeHandler<T extends (...args: any[]) => any>(
    routePath: string,
    method: string,
    fn: T,
  ) {
    const routeKey = method + ":" + routePath;
    this.rMap.set(routeKey, {
      handler: fn,
      middlewares: [],
      schema: {},
    });
    const entry = () => this.rMap.get(routeKey)!;

    const route = {
      /** Run middleware (classes or instances) before the handler. */
      useMiddleware: (
        middlewares:
          | MeghMiddleware
          | Constructor<MeghMiddleware>
          | (MeghMiddleware | Constructor<MeghMiddleware>)[],
      ) => {
        const list = Array.isArray(middlewares) ? middlewares : [middlewares];
        entry().middlewares.push(...list);
        return route;
      },

      /**
       * Leave this route out of the default set with
       * `useAuthorization(handler, { default })`, like `@Public()`.
       */
      public: () => {
        entry().public = true;
        return route;
      },

      /**
       * Require authorization, like `@Authorized()` on a controller route.
       * Pass a name to pick a handler from `useAuthorization({ ... })`.
       */
      authorized: (
        options?: string | { name?: string; [key: string]: unknown },
      ) => {
        entry().authorize =
          typeof options === "string" ? { name: options } : (options ?? {});
        return route;
      },

      /**
       * Give this route its own rate limit, like `@RateLimit()`, or pass
       * `false` to leave it unlimited.
       */
      rateLimit: (options: RouteRateLimitOptions | false) => {
        assertRouteRateLimit(options);
        entry().rateLimit = options;
        return route;
      },

      useOpenApi: (options: OpenApiOptions) => {
        entry().schema = options;
        return route;
      },
    };

    return route;
  }

  mapGet<T extends (...args: any[]) => any>(path: string = "", fn: T) {
    return this._routeHandler(path, "GET", fn);
  }

  mapPost<T extends (...args: any[]) => any>(path: string = "", fn: T) {
    return this._routeHandler(path, "POST", fn);
  }

  mapPut<T extends (...args: any[]) => any>(path: string = "", fn: T) {
    return this._routeHandler(path, "PUT", fn);
  }

  mapPatch<T extends (...args: any[]) => any>(path: string = "", fn: T) {
    return this._routeHandler(path, "PATCH", fn);
  }

  mapDelete<T extends (...args: any[]) => any>(path: string = "", fn: T) {
    return this._routeHandler(path, "DELETE", fn);
  }

  processFunctionalRoutes() {
    this.rMap.forEach((value, key) => {
      const colonIdx = key.indexOf(":");
      const m = key.slice(0, colonIdx);
      const r = key.slice(colonIdx + 1); // handles paths containing ":"

      const authDefault = this._applyAuthorizationDefault(
        !!value.authorize,
        !!value.public,
        `${m} ${r}`,
      );
      const authorize = value.authorize ?? authDefault.authorize;
      const requireUser = authDefault.requireUser;
      const routeSchema = buildRouteSchema(value.schema || {}, undefined, {
        authorized: !!authorize || requireUser,
      });

      // Resolved once, like controller routes.
      const middlewares: MeghMiddleware[] = value.middlewares.map((m: any) =>
        typeof m === "function" ? Container.get<MeghMiddleware>(m) : m,
      );
      const authn = this.authenticationHandler
        ? (Container.get(this.authenticationHandler) as any)
        : null;
      const authzCls = authorize
        ? this._resolveAuthorizer(authorize)
        : undefined;
      const authz = authzCls ? (Container.get(authzCls) as any) : null;
      if (authorize && !authz) {
        log.warn(
          `${m} ${r} uses .authorized() but no authorization handler is registered; ` +
            "every request will be denied (403). Call app.useAuthorization(YourAuthorization).",
        );
      }

      if (value.rateLimit) this.hasRouteRateLimits = true;

      this.app.route({
        method: toFastifyMethod(m),
        url: this.routeTargets(r, undefined)[0].url,
        schema: routeSchema,
        ...(value.rateLimit !== undefined && {
          config: {
            [RATE_LIMIT_CONFIG_KEY]: value.rateLimit,
            ...(value.rateLimit && {
              [RATE_LIMIT_ROUTE_ID_KEY]: nextRateLimitRouteId(`${m} ${r}`),
            }),
          },
        }),
        // Same order as controller routes: middleware → authentication →
        // authorization → handler.
        handler: async (req, res) => {
          let request = req as unknown as IRequest;
          for (const mw of middlewares) {
            request = ((await mw.invoke(request, res)) ?? request) as IRequest;
            if (res.sent) return;
          }
          if (authn) {
            const user = await authn.authenticate(request);
            if (res.sent) return;
            if (user !== null && user !== undefined) {
              setRequestUser(request, user);
            }
          }
          if (requireUser && (request as any).user == null) {
            throw new UnauthorizedException("Unauthorized");
          }
          if (authorize) {
            if (!authz) throw new ForbiddenException("Forbidden");
            const allowed = await authz.authorize(request, authorize);
            if (res.sent) return;
            if (allowed === false) throw new ForbiddenException("Forbidden");
          }
          const result = await value.handler(request, res);
          if (res.sent) return;
          return sendResult(res, result);
        },
      });
    });
  }
}
