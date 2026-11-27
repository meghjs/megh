/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Container } from "../di";
import { internalLogger } from "../observability/internal-logger";
import {
  BaseHttpException,
  NotFoundException,
  ValidationErrorException,
} from "./http-exceptions";
import {
  CATCH_META_KEY,
  ErrorHandlerFunction,
  ErrorResponse,
  ErrorResponseBody,
  ExceptionFilter,
  ExceptionFilterLike,
} from "./exception-filter";

/** Route config key holding the filters from `@UseFilters`. */
export const ROUTE_FILTERS_CONFIG_KEY = "meghExceptionFilters";

const GENERIC_5XX = "Internal Server Error";

/** A filter normalised to a function plus the error classes it accepts. */
export interface ResolvedFilter {
  types: Function[];
  run: ErrorHandlerFunction;
}

function statusOf(error: any): number | undefined {
  const status = error?.statusCode ?? error?.status;
  return Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : undefined;
}

/**
 * The response Megh sends for `error` when no filter handles it.
 *
 * - `HttpException`s keep their status. Their message and payload are sent
 *   for 4xx; for 5xx only in development.
 * - Fastify's request validation errors become 400 with the AJV issues.
 * - Other errors with a 4xx/5xx `statusCode` (body too large, unsupported
 *   media type, rate limited...) keep that status.
 * - Anything else is a 500 whose details only show in development.
 */
export function defaultErrorResponse(
  error: any,
  isDevelopment: boolean,
): ErrorResponse {
  if (error instanceof BaseHttpException) {
    const statusCode = error.code || 500;
    const expose = isDevelopment || statusCode < 500;
    const body: ErrorResponseBody = {
      code: statusCode,
      status: "Error",
      message: expose ? error.message : GENERIC_5XX,
    };
    if (error instanceof ValidationErrorException && error.errors) {
      body.errors = error.errors;
    } else if (expose && error.payload !== undefined) {
      body.data = error.payload;
    }
    return { statusCode, headers: error.headers, body };
  }

  if (error?.validation) {
    const statusCode = statusOf(error) ?? 400;
    return {
      statusCode,
      body: {
        code: statusCode,
        status: "Error",
        message: error.message,
        errors: error.validation,
      },
    };
  }

  const known = statusOf(error);
  if (known !== undefined) {
    const expose = isDevelopment || known < 500;
    return {
      statusCode: known,
      body: {
        code: known,
        status: "Error",
        message: expose ? String(error.message ?? "") : GENERIC_5XX,
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      code: 500,
      status: "Error",
      message: isDevelopment ? String(error?.message ?? error) : GENERIC_5XX,
      ...(isDevelopment && {
        error: error?.name,
        stack: error?.stack?.split("\n").slice(0, 5),
      }),
    },
  };
}

/** Turn a filter class, instance or function into a {@link ResolvedFilter}. */
export function resolveFilter(filter: ExceptionFilterLike): ResolvedFilter {
  if (typeof filter === "function") {
    if (typeof filter.prototype?.catch === "function") {
      const instance = Container.get<ExceptionFilter>(filter as any);
      return {
        types: Reflect.getMetadata(CATCH_META_KEY, filter) ?? [],
        run: (error, ctx) => instance.catch(error, ctx),
      };
    }
    return { types: [], run: filter as ErrorHandlerFunction };
  }
  if (filter && typeof (filter as ExceptionFilter).catch === "function") {
    return {
      types: Reflect.getMetadata(CATCH_META_KEY, filter.constructor) ?? [],
      run: (error, ctx) => (filter as ExceptionFilter).catch(error, ctx),
    };
  }
  throw new TypeError(
    "[Megh] An exception filter must be a class or object with a catch() method, or a function.",
  );
}

function accepts(filter: ResolvedFilter, error: unknown): boolean {
  return (
    filter.types.length === 0 ||
    filter.types.some((t) => error instanceof (t as any))
  );
}

export type ErrorLogger = (
  error: unknown,
  request: FastifyRequest,
  response: ErrorResponse,
) => void;

/** Logs 4xx as warnings and everything else as errors with the stack. */
export const defaultErrorLogger: ErrorLogger = (
  error: any,
  request,
  response,
) => {
  const log = internalLogger("http");
  // Path only: query strings can carry tokens and other secrets.
  const route = `${request.method} ${request.url.split("?")[0]}`;
  if (response.statusCode < 500) {
    log.warn(
      { statusCode: response.statusCode, route },
      `HTTP ${response.statusCode} ${route} — ${error?.message ?? error}`,
    );
    return;
  }
  log.error(
    { err: error, statusCode: response.statusCode, route },
    `HTTP ${response.statusCode} ${route} — ${error?.name ?? "Error"}: ${error?.message ?? error}`,
  );
};

export interface ErrorHandlerOptions {
  /** Return true to expose 5xx details. Defaults to `NODE_ENV === "development"`. */
  isDevelopment?: () => boolean;
  /** Logs errors answered with the default response. `false` turns it off. */
  logger?: ErrorLogger | false;
}

/**
 * Megh's request error handler: runs the exception filters in order, then
 * falls back to {@link defaultErrorResponse}.
 *
 * Order: `@UseFilters` on the route, on the controller, then the global
 * filters in registration order.
 */
export class MeghErrorHandler {
  private readonly globalFilters: ResolvedFilter[] = [];
  /** Megh's own filters (the login redirect), after the app's. */
  private readonly fallbackFilters: ResolvedFilter[] = [];
  private readonly isDevelopment: () => boolean;
  private logger: ErrorLogger | false;

  constructor(options: ErrorHandlerOptions = {}) {
    this.isDevelopment =
      options.isDevelopment ?? (() => process.env.NODE_ENV === "development");
    this.logger = options.logger ?? defaultErrorLogger;
  }

  /** Append global filters. */
  addFilters(filters: ExceptionFilterLike[]) {
    for (const f of filters) this.globalFilters.push(resolveFilter(f));
    return this;
  }

  /** @internal Add a filter that runs after every app filter. */
  addFallbackFilter(filter: ExceptionFilterLike) {
    this.fallbackFilters.push(resolveFilter(filter));
    return this;
  }

  setLogger(logger: ErrorLogger | false) {
    this.logger = logger;
    return this;
  }

  /** Install on a Fastify instance as its error and not-found handler. */
  install(app: FastifyInstance) {
    app.setErrorHandler((error, request, reply) =>
      this.handle(error, request, reply),
    );
    try {
      app.setNotFoundHandler(async (request) => {
        throw new NotFoundException(
          `Route ${request.method} ${request.url.split("?")[0]} not found`,
        );
      });
    } catch {
      // The app already set its own not-found handler; keep it.
    }
  }

  async handle(error: unknown, request: FastifyRequest, reply: FastifyReply) {
    const isDevelopment = this.isDevelopment();
    const routeFilters: ResolvedFilter[] =
      (request.routeOptions?.config as any)?.[ROUTE_FILTERS_CONFIG_KEY] ?? [];

    let current = error;
    for (const filter of [
      ...routeFilters,
      ...this.globalFilters,
      ...this.fallbackFilters,
    ]) {
      if (!accepts(filter, current)) continue;

      const response = defaultErrorResponse(current, isDevelopment);
      reply.code(response.statusCode);
      let result: unknown;
      try {
        result = await filter.run(current, {
          request,
          reply,
          isDevelopment,
          response,
        });
      } catch (filterError) {
        internalLogger("http").error(
          { err: filterError },
          "Exception filter threw; answering with the default error response",
        );
        break;
      }

      if (reply.sent) return reply;
      if (result instanceof Error) {
        current = result;
        continue;
      }
      if (result !== undefined) return reply.send(result);
    }

    const response = defaultErrorResponse(current, isDevelopment);
    if (this.logger) {
      try {
        this.logger(current, request, response);
      } catch {
        // A broken logger must not break the response.
      }
    }
    if (response.headers) reply.headers(response.headers);
    return reply
      .code(response.statusCode)
      .type("application/json; charset=utf-8")
      .serializer((payload: unknown) => JSON.stringify(payload))
      .send(response.body);
  }
}
