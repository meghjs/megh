import "reflect-metadata";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeghApplication } from "./application";
import { fastifyOf } from "./internal";
import { LoggerService } from "../observability/logger";

const fakeLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

// A fresh app per test; getApp() would return a shared singleton.
const createApp = () => MeghApplication.getInternalApp();

describe("application lifecycle", () => {
  const apps: MeghApplication[] = [];
  const started = (app: MeghApplication) => (apps.push(app), app);

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.restoreAllMocks();
  });

  it("runs init hooks in order before listening, and ready hooks after", async () => {
    const app = started(createApp());
    const calls: string[] = [];
    const listening = () => fastifyOf(app).server.listening;

    app
      .onInit(() => {
        calls.push(`init1 listening=${listening()}`);
      })
      .onInit(async () => {
        calls.push(`init2 listening=${listening()}`);
      })
      .onReady(() => {
        calls.push(`ready listening=${listening()}`);
      });
    await app.run(0);

    expect(calls).toEqual([
      "init1 listening=false",
      "init2 listening=false",
      "ready listening=true",
    ]);
  });

  it("aborts run() when an init hook fails, without listening", async () => {
    const app = started(createApp());
    const ready = vi.fn();
    app.onInit(() => {
      throw new Error("db down");
    });
    app.onReady(ready);

    await expect(app.run(0)).rejects.toThrow("db down");

    expect(fastifyOf(app).server.listening).toBe(false);
    expect(ready).not.toHaveBeenCalled();
  });

  it("rejects init and ready hooks registered after run()", async () => {
    const app = started(createApp());
    await app.run(0);

    expect(() => app.onInit(() => {})).toThrow(
      "onInit() must be called before run()",
    );
    expect(() => app.onReady(() => {})).toThrow(
      "onReady() must be called before run()",
    );
  });

  it("closes the server, then runs close hooks in reverse order", async () => {
    const app = started(createApp());
    const calls: string[] = [];
    app
      .onClose(() => {
        calls.push(`first listening=${fastifyOf(app).server.listening}`);
      })
      .onClose(async () => {
        calls.push("second");
      });
    await app.run(0);

    await app.close();

    expect(calls).toEqual(["second", "first listening=false"]);
  });

  it("keeps running close hooks after one fails, and closes only once", async () => {
    const app = started(createApp());
    const log = fakeLogger();
    vi.spyOn(LoggerService, "child").mockReturnValue(log as any);
    const last = vi.fn();
    app.onClose(last).onClose(() => {
      throw new Error("flush failed");
    });
    await app.run(0);

    await Promise.all([app.close(), app.close()]);
    await app.close();

    expect(last).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "onClose hook failed",
    );
  });

  it("closes the app and exits on SIGTERM", async () => {
    const app = started(createApp());
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);
    const closed = vi.fn();
    app.onClose(closed);
    await app.run(0);

    process.emit("SIGTERM");

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe("run() port", () => {
  const savedPort = process.env.PORT;
  const apps: MeghApplication[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    if (savedPort === undefined) delete process.env.PORT;
    else process.env.PORT = savedPort;
  });

  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", reject);
      srv.listen(0, () => {
        const { port } = srv.address() as net.AddressInfo;
        srv.close(() => resolve(port));
      });
    });
  const boundPort = (app: MeghApplication) =>
    (app.address() as net.AddressInfo).port;

  it("listens on PORT when no port is passed", async () => {
    const port = await freePort();
    process.env.PORT = String(port);
    const app = createApp();
    apps.push(app);

    await app.run(undefined, { host: "127.0.0.1" });

    expect(boundPort(app)).toBe(port);
  });

  it("prefers an explicit port over PORT", async () => {
    process.env.PORT = String(await freePort());
    const app = createApp();
    apps.push(app);

    await app.run(0, { host: "127.0.0.1" });

    expect(boundPort(app)).not.toBe(Number(process.env.PORT));
  });

  it("rejects an invalid PORT before starting", async () => {
    process.env.PORT = "abc";
    const app = createApp();

    await expect(app.run()).rejects.toThrow("Invalid PORT \"abc\"");
    expect(fastifyOf(app).server.listening).toBe(false);
  });
});
