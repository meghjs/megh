import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyPluginAsync, FastifyPluginCallback } from "fastify";
import { MeghApplication } from "./application";

const apps: MeghApplication[] = [];

function createApp() {
  const app = MeghApplication.getInternalApp();
  app.useErrorLogger(false);
  apps.push(app);
  return app;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Fastify instance", () => {
  it("is not exposed on the application", () => {
    const app = createApp();
    expect((app as any).app).toBeUndefined();
    expect(Object.keys(app)).not.toContain("app");
  });
});

describe("registerFastifyPlugin", () => {
  it("registers a callback plugin with its options", async () => {
    const plugin: FastifyPluginCallback<{ value: string }> = (
      fastify,
      opts,
      done,
    ) => {
      fastify.addHook("onSend", async (_req, reply) => {
        reply.header("x-plugin", opts.value);
      });
      done();
    };
    (plugin as any)[Symbol.for("skip-override")] = true;
    const app = createApp();
    app.mapGet("/ping", () => "pong");
    expect(app.registerFastifyPlugin(plugin, { value: "hi" })).toBe(app);

    vi.spyOn(console, "log").mockImplementation(() => {});
    await app.run(0, { host: "127.0.0.1" });

    const res = await app.inject({ method: "GET", url: "/ping" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-plugin"]).toBe("hi");
  });

  it("loads the plugin before routes are added, so onRoute hooks see them", async () => {
    const seen: string[] = [];
    const plugin: FastifyPluginAsync = async (fastify) => {
      fastify.addHook("onRoute", (route) => {
        seen.push(route.url);
      });
    };
    // Not wrapped with fastify-plugin, so mark it to skip encapsulation.
    (plugin as any)[Symbol.for("skip-override")] = true;
    const app = createApp();
    app.mapGet("/late", () => "ok");
    app.registerFastifyPlugin(plugin);

    await app.run(0, { host: "127.0.0.1" });
    expect(seen).toContain("/late");
  });

  it("can be called from an onInit hook", async () => {
    const app = createApp();
    const plugin: FastifyPluginAsync = async (fastify) => {
      fastify.get("/from-plugin", async () => "plugin");
    };
    app.onInit(() => {
      app.registerFastifyPlugin(plugin);
    });

    await app.run(0, { host: "127.0.0.1" });
    const res = await app.inject("/from-plugin");
    expect(res.body).toBe("plugin");
  });

  it("throws once routes are mapped", async () => {
    const app = createApp();
    await app.run(0, { host: "127.0.0.1" });
    expect(() => app.registerFastifyPlugin(async () => {})).toThrow(
      /before run\(\) or inside an onInit\(\) hook/,
    );
  });
});

describe("address", () => {
  it("is null before run() and the bound address after", async () => {
    const app = createApp();
    expect(app.address()).toBeNull();
    await app.run(0, { host: "127.0.0.1" });
    const address = app.address();
    expect(typeof address === "object" && address?.port).toBeGreaterThan(0);
    await app.close();
    expect(app.address()).toBeNull();
  });
});
