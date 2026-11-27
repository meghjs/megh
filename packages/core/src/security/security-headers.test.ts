import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeghApplication } from "../core/application";
import { ApiController } from "../http/controller";
import { Get } from "../http/route-methods";
import { BadRequestException } from "../errors/http-exceptions";
import { buildSecurityHeaders } from "./headers";

@ApiController("/sh")
class HeadersController {
  @Get("/")
  ok() {
    return { ok: true };
  }

  @Get("/fail")
  fail() {
    throw new BadRequestException("nope");
  }
}

const apps: MeghApplication[] = [];
async function boot(setup: (app: MeghApplication) => void) {
  const app = MeghApplication.getInternalApp({ autoloadPlugins: false });
  app.useErrorLogger(false);
  app.useControllers([HeadersController]);
  setup(app);
  apps.push(app);
  await app.run(0);
  return app;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  vi.restoreAllMocks();
});

const asObject = (headers: [string, string][]) =>
  Object.fromEntries(headers.map(([k, v]) => [k.toLowerCase(), v]));

describe("buildSecurityHeaders", () => {
  it("has safe defaults", () => {
    const h = asObject(buildSecurityHeaders());
    expect(h["content-security-policy"]).toBe(
      "default-src 'self'; base-uri 'self'; font-src 'self' https: data:; " +
        "form-action 'self'; frame-ancestors 'self'; img-src 'self' data:; " +
        "object-src 'none'; script-src 'self'; script-src-attr 'none'; " +
        "style-src 'self' https: 'unsafe-inline'; upgrade-insecure-requests",
    );
    expect(h["strict-transport-security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(h["x-frame-options"]).toBe("SAMEORIGIN");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin");
    expect(h["cross-origin-resource-policy"]).toBe("same-origin");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-xss-protection"]).toBe("0");
    expect(h["cross-origin-embedder-policy"]).toBeUndefined();
  });

  it("merges CSP directives, camelCase or kebab-case, and drops false ones", () => {
    const h = asObject(
      buildSecurityHeaders({
        contentSecurityPolicy: {
          directives: {
            imgSrc: ["'self'", "https://cdn.example.com"],
            "connect-src": "'self'",
            upgradeInsecureRequests: false,
          },
        },
      }),
    );
    const csp = h["content-security-policy"];
    expect(csp).toContain("img-src 'self' https://cdn.example.com");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("can start CSP from scratch and send it report-only", () => {
    const h = asObject(
      buildSecurityHeaders({
        contentSecurityPolicy: {
          useDefaults: false,
          reportOnly: true,
          directives: { defaultSrc: "'none'" },
        },
      }),
    );
    expect(h["content-security-policy"]).toBeUndefined();
    expect(h["content-security-policy-report-only"]).toBe("default-src 'none'");
  });

  it("turns headers off with false and adds custom ones", () => {
    const h = asObject(
      buildSecurityHeaders({
        contentSecurityPolicy: false,
        strictTransportSecurity: { maxAge: 60, preload: true },
        frameOptions: "DENY",
        referrerPolicy: ["no-referrer", "strict-origin-when-cross-origin"],
        crossOriginEmbedderPolicy: "require-corp",
        headers: {
          "Permissions-Policy": "camera=()",
          "x-dns-prefetch-control": false,
        },
      }),
    );
    expect(h["content-security-policy"]).toBeUndefined();
    expect(h["strict-transport-security"]).toBe(
      "max-age=60; includeSubDomains; preload",
    );
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe(
      "no-referrer,strict-origin-when-cross-origin",
    );
    expect(h["cross-origin-embedder-policy"]).toBe("require-corp");
    expect(h["permissions-policy"]).toBe("camera=()");
    expect(h["x-dns-prefetch-control"]).toBeUndefined();
  });

  it("rejects values that could inject headers or directives", () => {
    expect(() =>
      buildSecurityHeaders({ headers: { "X-Test": "a\r\nSet-Cookie: x" } }),
    ).toThrow(/Invalid value/);
    expect(() =>
      buildSecurityHeaders({
        contentSecurityPolicy: { directives: { scriptSrc: "'self'; evil" } },
      }),
    ).toThrow(/invalid source/);
    expect(() =>
      buildSecurityHeaders({ strictTransportSecurity: { maxAge: -1 } }),
    ).toThrow(/maxAge/);
  });
});

describe("useSecurityHeaders", () => {
  it("sets the headers on success, error and 404 responses", async () => {
    const app = await boot((a) => a.useSecurityHeaders());
    for (const url of ["/sh", "/sh/fail", "/missing"]) {
      const res = await app.inject({ url });
      expect(res.headers["x-content-type-options"], url).toBe("nosniff");
      expect(res.headers["content-security-policy"], url).toContain(
        "default-src 'self'",
      );
    }
    expect((await app.inject({ url: "/sh/fail" })).statusCode).toBe(400);
  });

  it("lets a route override a header", async () => {
    const app = await boot((a) => {
      a.useSecurityHeaders();
      a.mapGet("/own", (_req: unknown, res: any) => {
        res.header("X-Frame-Options", "DENY");
        return { ok: true };
      });
    });
    const res = await app.inject({ url: "/own" });
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("leaves the API docs page its own CSP, so Swagger UI and Scalar load", async () => {
    for (const provider of ["swagger", "scalar"] as const) {
      const app = await boot((a) =>
        a.useSecurityHeaders().useOpenApi({ provider, routePrefix: "/docs" }),
      );
      const docs = await app.inject({ url: "/docs/" });
      expect(docs.statusCode, provider).toBe(200);
      const csp = docs.headers["content-security-policy"];
      // Swagger UI sends its own policy; Scalar gets none from Megh.
      if (provider === "swagger") expect(csp).not.toContain("form-action");
      else expect(csp).toBeUndefined();
      expect(docs.headers["x-content-type-options"]).toBe("nosniff");
      // Everything else keeps Megh's policy, including look-alike paths.
      for (const url of ["/sh", "/docsx"]) {
        const res = await app.inject({ url });
        expect(res.headers["content-security-policy"], url).toContain(
          "form-action 'self'",
        );
      }
      await app.close();
    }
  });

  it("sends nothing extra without it", async () => {
    const app = await boot(() => {});
    const res = await app.inject({ url: "/sh" });
    expect(res.headers["content-security-policy"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBeUndefined();
  });

  it("can only be turned on once, before run()", async () => {
    const app = await boot((a) => a.useSecurityHeaders());
    expect(() => app.useSecurityHeaders()).toThrow(/before run/);
    const fresh = MeghApplication.getInternalApp({ autoloadPlugins: false });
    fresh.useSecurityHeaders();
    expect(() => fresh.useSecurityHeaders()).toThrow(/already on/);
  });
});
