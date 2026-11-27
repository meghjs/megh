import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeghApplication } from "../core/application";
import { MeghTest } from "../core/testing";
import { ApiController } from "../http/controller";
import { Get, Post } from "../http/route-methods";
import { Body } from "../http/params";
import { AppService } from "../common/decorators";
import {
  Catch,
  ErrorContext,
  ExceptionFilter,
  UseFilters,
} from "./exception-filter";
import { defaultErrorResponse } from "./error-handler";
import {
  ConflictException,
  HttpException,
  NotFoundException,
  TooManyRequestsException,
  ValidationErrorException,
} from "./http-exceptions";

// ─── Fixtures ────────────────────────────────────────────────────────────────

class EntityMissingError extends Error {}
class PaymentError extends Error {}

@Catch(EntityMissingError)
class EntityMissingFilter implements ExceptionFilter<EntityMissingError> {
  catch(error: EntityMissingError) {
    return new NotFoundException(error.message);
  }
}

@AppService
class Brand {
  name = "acme";
}

/** A catch-all filter with an injected service, rewriting the body shape. */
@Catch()
class ProblemJsonFilter implements ExceptionFilter {
  constructor(private brand: Brand) {}
  catch(_error: unknown, ctx: ErrorContext) {
    ctx.reply.type("application/problem+json");
    return {
      type: `${this.brand.name}:error`,
      status: ctx.response.statusCode,
      title: ctx.response.body.message,
    };
  }
}

@Catch(PaymentError)
class PaymentFilter implements ExceptionFilter {
  catch(_error: PaymentError, ctx: ErrorContext) {
    ctx.reply.code(402);
    return { scope: "controller" };
  }
}

@UseFilters(PaymentFilter)
@ApiController("/e")
class ErrorsController {
  @Get("/missing")
  missing() {
    throw new EntityMissingError("Order 7 not found");
  }

  @Get("/payment")
  payment() {
    throw new PaymentError("card declined");
  }

  @UseFilters((_e: unknown, ctx: ErrorContext) => {
    ctx.reply.code(409);
    return { scope: "route" };
  })
  @Get("/payment-route")
  paymentRoute() {
    throw new PaymentError("card declined");
  }

  @Get("/limited")
  limited() {
    throw new TooManyRequestsException("Slow down", {
      headers: { "Retry-After": 30 },
    });
  }

  @Get("/crash")
  crash() {
    throw new Error("db at 10.0.0.5 down");
  }

  @Get("/conflict")
  conflict() {
    throw new ConflictException("Email taken");
  }

  @Post("/echo")
  echo(@Body() body: any) {
    return body;
  }
}

async function boot(setup: (app: MeghApplication) => void = () => {}) {
  const app = MeghApplication.getInternalApp();
  app.useControllers([ErrorsController]);
  app.useErrorLogger(false);
  setup(app);
  const before = {
    SIGTERM: process.listeners("SIGTERM"),
    SIGINT: process.listeners("SIGINT"),
  };
  await app.run(0);
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    for (const l of process.listeners(sig)) {
      if (!before[sig].includes(l)) process.removeListener(sig, l);
    }
  }
  return app;
}

async function request(
  setup: (app: MeghApplication) => void,
  opts: Parameters<MeghApplication["app"]["inject"]>[0],
) {
  const app = await boot(setup);
  try {
    return await app.inject(opts as any);
  } finally {
    await app.close();
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("defaultErrorResponse", () => {
  it("keeps an HttpException's status and payload for 4xx", () => {
    const res = defaultErrorResponse(new HttpException(402, "Pay up"), false);
    expect(res).toEqual({
      statusCode: 402,
      headers: undefined,
      body: {
        code: 402,
        status: "Error",
        message: "Pay up",
        data: { message: "Pay up" },
      },
    });
  });

  it("sends validation issues as errors", () => {
    const issues = [{ path: "name", constraints: { isString: "bad" } }];
    const res = defaultErrorResponse(
      new ValidationErrorException("bad", issues),
      false,
    );
    expect(res.body).toEqual({
      code: 400,
      status: "Error",
      message: "bad",
      errors: issues,
    });
  });

  it("respects a framework error's statusCode", () => {
    const err = Object.assign(new Error("Request body is too large"), {
      statusCode: 413,
    });
    expect(defaultErrorResponse(err, false).statusCode).toBe(413);
    expect(defaultErrorResponse(err, false).body.message).toBe(
      "Request body is too large",
    );
  });

  it("hides 5xx framework error messages outside development", () => {
    const err = Object.assign(new Error("upstream secret"), {
      statusCode: 503,
    });
    expect(defaultErrorResponse(err, false).body.message).toBe(
      "Internal Server Error",
    );
    expect(defaultErrorResponse(err, true).body.message).toBe(
      "upstream secret",
    );
  });

  it("treats a non-error status as 500", () => {
    const err = Object.assign(new Error("odd"), { statusCode: 302 });
    expect(defaultErrorResponse(err, false).statusCode).toBe(500);
  });
});

describe("error handling", () => {
  const savedEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
    vi.restoreAllMocks();
  });

  describe("defaults", () => {
    it("answers unknown routes with a 404 in the Megh shape", async () => {
      const res = await request(() => {}, { method: "GET", url: "/nope?x=1" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        code: 404,
        status: "Error",
        message: "Route GET /nope not found",
      });
    });

    it("keeps Fastify's 415 instead of turning it into a 500", async () => {
      const res = await request(() => {}, {
        method: "POST",
        url: "/e/echo",
        headers: { "content-type": "application/x-unknown" },
        payload: "x",
      });
      expect(res.statusCode).toBe(415);
      expect(res.json()).toMatchObject({ code: 415, status: "Error" });
    });

    it("keeps Fastify's 400 for malformed JSON", async () => {
      const res = await request(() => {}, {
        method: "POST",
        url: "/e/echo",
        headers: { "content-type": "application/json" },
        payload: "{bad",
      });
      expect(res.statusCode).toBe(400);
    });

    it("sets the exception's headers", async () => {
      const res = await request(() => {}, { method: "GET", url: "/e/limited" });
      expect(res.statusCode).toBe(429);
      expect(res.headers["retry-after"]).toBe("30");
    });

    it("logs default responses through the error logger", async () => {
      const logger = vi.fn();
      const res = await request((a) => a.useErrorLogger(logger), {
        method: "GET",
        url: "/e/crash",
      });
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain("10.0.0.5");
      expect(logger).toHaveBeenCalledOnce();
      expect(logger.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(logger.mock.calls[0][2].statusCode).toBe(500);
    });
  });

  describe("global filters", () => {
    it("maps a domain error to an HttpException", async () => {
      const res = await request(
        (a) => a.useExceptionFilters([EntityMissingFilter]),
        { method: "GET", url: "/e/missing" },
      );
      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Order 7 not found");
    });

    it("skips filters whose @Catch types do not match", async () => {
      const res = await request(
        (a) => a.useExceptionFilters([EntityMissingFilter]),
        { method: "GET", url: "/e/conflict" },
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe("Email taken");
    });

    it("passes a mapped error on to later filters, with DI", async () => {
      const res = await request(
        (a) => a.useExceptionFilters([EntityMissingFilter, ProblemJsonFilter]),
        { method: "GET", url: "/e/missing" },
      );
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.json()).toEqual({
        type: "acme:error",
        status: 404,
        title: "Order 7 not found",
      });
    });

    it("keeps production redaction in ctx.response", async () => {
      const res = await request(
        (a) => a.useExceptionFilters(ProblemJsonFilter),
        {
          method: "GET",
          url: "/e/crash",
        },
      );
      expect(res.statusCode).toBe(500);
      expect(res.json().title).toBe("Internal Server Error");
    });

    it("runs the 404 for unknown routes through the filters", async () => {
      const res = await request(
        (a) => a.useExceptionFilters(ProblemJsonFilter),
        {
          method: "GET",
          url: "/nope",
        },
      );
      expect(res.statusCode).toBe(404);
      expect(res.json().status).toBe(404);
    });

    it("accepts a filter instance", async () => {
      const res = await request(
        (a) => a.useExceptionFilters(new EntityMissingFilter()),
        { method: "GET", url: "/e/missing" },
      );
      expect(res.statusCode).toBe(404);
    });

    it("falls through when a filter returns nothing", async () => {
      const seen = vi.fn();
      const res = await request(
        (a) =>
          a.useErrorHandler((error) => {
            seen(error);
          }),
        { method: "GET", url: "/e/conflict" },
      );
      expect(seen).toHaveBeenCalledOnce();
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 409, message: "Email taken" });
    });

    it("sends what useErrorHandler returns", async () => {
      const res = await request(
        (a) =>
          a.useErrorHandler((_e, { response }) => ({
            ok: false,
            error: response.body.message,
          })),
        { method: "GET", url: "/e/conflict" },
      );
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ ok: false, error: "Email taken" });
    });

    it("lets a handler send the reply itself", async () => {
      const res = await request(
        (a) =>
          a.useErrorHandler((_e, { reply }) => {
            reply.code(418).send("teapot");
          }),
        { method: "GET", url: "/e/conflict" },
      );
      expect(res.statusCode).toBe(418);
      expect(res.body).toBe("teapot");
    });

    it("falls back to the default response when a filter throws", async () => {
      const res = await request(
        (a) =>
          a.useErrorHandler(() => {
            throw new Error("filter bug");
          }),
        { method: "GET", url: "/e/conflict" },
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe("Email taken");
    });

    it("rejects filters added after run()", async () => {
      const app = await boot();
      try {
        expect(() => app.useErrorHandler(() => undefined)).toThrow(
          /before run/,
        );
      } finally {
        await app.close();
      }
    });

    it("rejects values that are not filters", () => {
      const app = MeghApplication.getInternalApp();
      expect(() => app.useExceptionFilters({} as any)).toThrow(/catch\(\)/);
    });
  });

  describe("@UseFilters", () => {
    it("applies controller filters", async () => {
      const res = await request(() => {}, { method: "GET", url: "/e/payment" });
      expect(res.statusCode).toBe(402);
      expect(res.json()).toEqual({ scope: "controller" });
    });

    it("runs route filters before controller and global ones", async () => {
      const res = await request(
        (a) => a.useExceptionFilters(ProblemJsonFilter),
        {
          method: "GET",
          url: "/e/payment-route",
        },
      );
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ scope: "route" });
    });
  });

  describe("MeghTest", () => {
    it("uses the production error handler", async () => {
      const app = MeghApplication.getInternalApp();
      app.useControllers([ErrorsController]);
      app.useErrorLogger(false);
      app.useExceptionFilters(EntityMissingFilter);
      const testApp = MeghTest.from(app);
      // MeghTest.from maps controllers without awaiting; let it settle.
      await new Promise((r) => setTimeout(r, 0));
      try {
        const missing = await testApp.get("/e/missing");
        expect(missing.statusCode).toBe(404);
        const crash = await testApp.get("/e/crash");
        expect(crash.statusCode).toBe(500);
        expect(crash.body).not.toContain("10.0.0.5");
      } finally {
        await app.close();
      }
    });
  });
});
