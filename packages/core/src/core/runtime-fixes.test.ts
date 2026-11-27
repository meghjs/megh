import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { MeghApplication } from "./application";
import { ApiController } from "../http/controller";
import { All, Get, HttpCode, Post } from "../http/route-methods";
import { UploadFile } from "../http/multipart";
import { Results } from "../http/results";
import { HttpResponse } from "../http/response";
import { CacheManager } from "../observability/cache";
import { resolveSourceDir } from "../common/utils/path-utils";

// ─── Fixtures ────────────────────────────────────────────────────────────────

@ApiController("/status")
class StatusController {
  @Post("/decorated")
  @HttpCode(201)
  decorated() {
    return { ok: true };
  }

  @Post("/decorated-but-result")
  @HttpCode(201)
  decoratedButResult() {
    return Results.NotFound("gone");
  }

  @Get("/created")
  created() {
    return Results.Created({ id: 1 });
  }

  @Get("/no-content")
  noContent() {
    return Results.NoContent();
  }

  @Get("/not-found")
  notFound() {
    return Results.NotFound("nope");
  }

  @Get("/http-created")
  httpCreated() {
    return HttpResponse.Created({ id: 2 });
  }

  @Get("/stream")
  stream() {
    return Results.OkStream(Readable.from(["a,b\n"]), {
      contentType: "text/csv",
      filename: "report.csv",
    });
  }

  @All("/any")
  any() {
    return { any: true };
  }
}

@ApiController("/uploads")
class UploadController {
  @Post("/")
  upload(@UploadFile("doc") file: any) {
    return { filename: file?.filename, field: file?.fieldname };
  }
}

// Two controller classes with the same name used to share cached metadata.
function makeNamedController(prefix: string, value: string) {
  @ApiController(prefix)
  class SameNameController {
    @Get("/")
    get() {
      return { value };
    }
  }
  return SameNameController;
}
const FirstSameName = makeNamedController("/first", "first");
const SecondSameName = makeNamedController("/second", "second");

// ─── Harness ─────────────────────────────────────────────────────────────────

const apps: MeghApplication[] = [];

async function boot(
  setup: (app: MeghApplication) => void,
  options?: Parameters<MeghApplication["run"]>[1],
) {
  const app = MeghApplication.getInternalApp();
  app.useErrorLogger(false);
  setup(app);
  apps.push(app);
  await app.run(0, options);
  return app;
}

function multipart(field: string, filename: string, content: string) {
  const boundary = "----megh-test-boundary";
  const payload =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
    "Content-Type: text/plain\r\n\r\n" +
    `${content}\r\n` +
    `--${boundary}--\r\n`;
  return {
    payload,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

// ─── Status codes ────────────────────────────────────────────────────────────

describe("status codes", () => {
  const get = async (method: "GET" | "POST", url: string) => {
    const app = await boot((a) => a.useControllers([StatusController]));
    return app.inject({ method, url });
  };

  it("@HttpCode sets the status of a plain result", async () => {
    const res = await get("POST", "/status/decorated");
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });
  });

  it("a returned result's status wins over @HttpCode", async () => {
    const res = await get("POST", "/status/decorated-but-result");
    expect(res.statusCode).toBe(404);
  });

  it("Results.Created sends 201 with its body", async () => {
    const res = await get("GET", "/status/created");
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ data: { id: 1 } });
  });

  it("Results.NoContent sends 204 with no body", async () => {
    const res = await get("GET", "/status/no-content");
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });

  it("Results.NotFound sends 404", async () => {
    const res = await get("GET", "/status/not-found");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 404, status: "Error", message: "nope" });
  });

  it("HttpResponse.Created sends 201 without leaking the marker", async () => {
    const res = await get("GET", "/status/http-created");
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ message: "created", data: { id: 2 } });
  });

  it("Results.OkStream streams with its content type and filename", async () => {
    const res = await get("GET", "/status/stream");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(String(res.headers["content-disposition"])).toContain("report.csv");
    expect(res.body).toBe("a,b\n");
  });
});

// ─── @All ────────────────────────────────────────────────────────────────────

describe("@All", () => {
  it("registers and answers every method", async () => {
    const app = await boot((a) => a.useControllers([StatusController]));
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = await app.inject({ method, url: "/status/any" });
      expect(res.statusCode, method).toBe(200);
    }
  });
});

// ─── Same-named controllers ──────────────────────────────────────────────────

describe("controllers with the same class name", () => {
  it("keep their own route metadata", async () => {
    expect(FirstSameName.name).toBe(SecondSameName.name);
    const app = await boot((a) =>
      a.useControllers([FirstSameName, SecondSameName]),
    );
    expect((await app.inject("/first")).json()).toEqual({
      value: "first",
    });
    expect((await app.inject("/second")).json()).toEqual({
      value: "second",
    });
  });
});

// ─── Uploads ─────────────────────────────────────────────────────────────────

describe("@UploadFile", () => {
  it("receives the saved file", async () => {
    const app = await boot((a) =>
      a.useMultipart().useControllers([UploadController]),
    );
    const res = await app.inject({
      method: "POST",
      url: "/uploads",
      ...multipart("doc", "notes.txt", "hello"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ filename: "notes.txt", field: "doc" });
  });
});

// ─── run() ───────────────────────────────────────────────────────────────────

describe("run()", () => {
  const savedHost = process.env.HOST;
  afterEach(() => {
    if (savedHost === undefined) delete process.env.HOST;
    else process.env.HOST = savedHost;
  });

  it("listens on 0.0.0.0 by default", async () => {
    delete process.env.HOST;
    const app = await boot(() => {});
    expect((app.address() as any).address).toBe("0.0.0.0");
  });

  it("takes the host from options, then HOST", async () => {
    process.env.HOST = "0.0.0.0";
    const app = await boot(() => {}, { host: "127.0.0.1" });
    expect((app.address() as any).address).toBe("127.0.0.1");

    process.env.HOST = "127.0.0.1";
    const fromEnv = await boot(() => {});
    expect((fromEnv.address() as any).address).toBe("127.0.0.1");
  });

  it("still accepts a callback as the second argument", async () => {
    const cb = vi.fn();
    await boot(() => {}, cb);
    expect(cb).toHaveBeenCalledOnce();
  });
});

// ─── Shutdown ────────────────────────────────────────────────────────────────

describe("shutdown", () => {
  it("exits 1 when close outlasts the shutdown timeout", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);
    const app = await boot((a) => a.onClose(() => new Promise(() => {})), {
      shutdownTimeout: 20,
    });
    process.emit("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    apps.splice(apps.indexOf(app), 1);
  });

  it("removes its signal handlers on close()", async () => {
    const before = process.listenerCount("SIGTERM");
    const app = await boot(() => {});
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    await app.close();
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("closes the cache", async () => {
    const close = vi.spyOn(CacheManager, "close");
    const app = await boot((a) => a.useCache({ provider: "memory" }));
    await app.close();
    expect(close).toHaveBeenCalledOnce();
  });
});

// ─── Directory resolution ────────────────────────────────────────────────────

describe("resolveSourceDir", () => {
  it("swaps only a leading src segment for dist", () => {
    expect(resolveSourceDir("src/controllers", false)).toBe(
      path.join(process.cwd(), "dist", "controllers"),
    );
    expect(resolveSourceDir("app/src/controllers", false)).toBe(
      path.join(process.cwd(), "app", "src", "controllers"),
    );
    expect(resolveSourceDir("src/controllers", true)).toBe(
      path.join(process.cwd(), "src", "controllers"),
    );
  });

  it("leaves absolute paths alone", () => {
    const abs = path.join(os.tmpdir(), "src", "tasks");
    expect(resolveSourceDir(abs, false)).toBe(abs);
  });
});

// ─── useScheduler({ path }) ──────────────────────────────────────────────────

describe("useScheduler({ path })", () => {
  let dir: string;
  const savedTsNode = process.env.TS_NODE_DEV;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "megh-tasks-"));
    process.env.TS_NODE_DEV = "1";
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (savedTsNode === undefined) delete process.env.TS_NODE_DEV;
    else process.env.TS_NODE_DEV = savedTsNode;
  });

  it("discovers task classes without crashing run()", async () => {
    const decorators = path
      .resolve(__dirname, "../scheduler/schedule-decorator")
      .replace(/\\/g, "/");
    fs.writeFileSync(
      path.join(dir, "report.task.ts"),
      // Decorators applied by hand: files outside the project are not
      // compiled with decorator support.
      `import { ScheduledTask, Interval } from "${decorators}";
export class ReportTask { run() {} }
const run = Object.getOwnPropertyDescriptor(ReportTask.prototype, "run");
Interval(60_000)(ReportTask.prototype, "run", run);
ScheduledTask()(ReportTask);
`,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = await boot((a) => a.useScheduler({ path: dir }));
    expect(warn).not.toHaveBeenCalled();
    expect((app as any).schedulerTasks.map((t: any) => t.name)).toEqual([
      "ReportTask",
    ]);
  });
});

describe("useControllers({ auto: true })", () => {
  let dir: string;
  const cwd = process.cwd();
  const savedTsNode = process.env.TS_NODE_DEV;

  const controller = (name: string) => {
    const container = path
      .resolve(__dirname, "../common/container")
      .replace(/\\/g, "/");
    return `import { API_CONTROLLER_METADATA_KEY } from "${container}";
export class ${name} {}
Reflect.defineMetadata(API_CONTROLLER_METADATA_KEY, true, ${name});
`;
  };
  const put = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "megh-controllers-"));
    process.env.TS_NODE_DEV = "1";
    process.chdir(dir);
    put("src/controllers/home.controller.ts", controller("HomeController"));
    put(
      "src/users/controllers/user.controller.ts",
      controller("UserController"),
    );
    put(
      "src/users/services/user.service.ts",
      controller("NotInControllersFolder"),
    );
    // Importing app.ts would start the app; the scan must leave it alone.
    put("src/app.ts", "throw new Error(\"app.ts was imported\");\n");
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
    if (savedTsNode === undefined) delete process.env.TS_NODE_DEV;
    else process.env.TS_NODE_DEV = savedTsNode;
  });

  const scan = async (path?: string) => {
    const app = MeghApplication.getInternalApp() as any;
    app.controllers = [];
    app.registerControllerPath = undefined;
    app.useControllers(path ? { auto: true, path } : { auto: true });
    await app.autoControllers();
    return app.controllers.map((c: any) => c.name).sort();
  };

  it("finds every controllers/ folder under src/ by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await scan()).toEqual(["HomeController", "UserController"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("scans everything in an explicit path", async () => {
    expect(await scan("src/users")).toEqual([
      "NotInControllersFolder",
      "UserController",
    ]);
  });
});
