/**
 * Regression tests for the core issues fixed together: #51 #52 #53 #55 #69
 * #97 #98 #99 #100 #104 #105 #106.
 */
import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import {
  IsInt as CvIsInt,
  IsString as CvIsString,
  MinLength as CvMinLength,
  validateSync,
} from "class-validator";
import { plainToInstance } from "class-transformer";
import { MeghApplication } from "./application";
import { MeghTest } from "./testing";
import { ApiController } from "../http/controller";
import { Get, Post } from "../http/route-methods";
import { Body } from "../http/params";
import { OmitType, PartialType, PickType } from "../http/map-types";
import { IsInt, IsString, MinLength } from "../validator/decorators";
import { validateDto } from "../validator/compiler";
import { AppConfig, GetConfig, MeghConfig } from "../config/config";
import { Environment } from "../config/environment-variables";
import { EnvironmentVariableNotFound } from "../config";
import * as core from "../index";
import { Injectable } from "../di";
import { MeghScheduler } from "../scheduler/scheduler";
import { Interval, ScheduledTask } from "../scheduler/schedule-decorator";
import { resolveSourceDir } from "../common/utils/path-utils";
import { requireOptional } from "../common/utils/optional-peer";
import { FileStorage } from "../storage/file-storage";
import { MultipartFile } from "../http/multipart";
import { defaultErrorLogger } from "../errors/error-handler";
import * as internal from "../observability/internal-logger";

// ─── #51 mapped types ────────────────────────────────────────────────────────

class MeghUserDto {
  @IsString()
  @MinLength(3)
  name: string;

  @IsInt()
  age: number;

  @IsString()
  role: string = "member";
}

class CvUserDto {
  @CvIsString()
  @CvMinLength(3)
  name: string;

  @CvIsInt()
  age: number;
}

describe("PartialType / PickType / OmitType (#51)", () => {
  it("PartialType keeps Megh rules and makes every field optional", () => {
    class UpdateDto extends PartialType(MeghUserDto) {}
    expect(validateDto(UpdateDto, {}).errors).toBeNull();
    const bad = validateDto(UpdateDto, { name: "ab" }).errors ?? [];
    expect(bad.map((e) => e.path)).toEqual(["name"]);
  });

  it("PartialType keeps class-validator rules and makes fields optional", () => {
    class UpdateDto extends PartialType(CvUserDto) {}
    expect(validateSync(plainToInstance(UpdateDto, {}))).toEqual([]);
    const errors = validateSync(plainToInstance(UpdateDto, { age: "x" }));
    expect(errors.map((e) => e.property)).toEqual(["age"]);
  });

  it("PickType keeps only the picked rules", () => {
    class NameDto extends PickType(MeghUserDto, ["name"]) {}
    const errors = (validateDto(NameDto, {}).errors ?? []).map((e) => e.path);
    expect(errors).toEqual(["name"]);
  });

  it("OmitType drops the omitted rules", () => {
    class NoAgeDto extends OmitType(CvUserDto, ["age"]) {}
    const errors = validateSync(plainToInstance(NoAgeDto, { name: "abc" }));
    expect(errors).toEqual([]);
    expect(
      validateSync(plainToInstance(NoAgeDto, {})).map((e) => e.property),
    ).toEqual(["name"]);
  });

  it("keeps property defaults", () => {
    class RoleDto extends PickType(MeghUserDto, ["role"]) {}
    expect(new RoleDto().role).toBe("member");
  });
});

// ─── #52 decorator metadata ──────────────────────────────────────────────────

describe("missing decorator metadata (#52)", () => {
  it("fails at boot when @Body() has no type", async () => {
    class Dto {}
    @ApiController("/no-meta")
    class NoMetaController {
      @Post("/")
      create(body: Dto) {
        return body;
      }
    }
    // Simulate a compiler without emitDecoratorMetadata.
    Reflect.deleteMetadata(
      "design:paramtypes",
      NoMetaController.prototype,
      "create",
    );
    Body()(NoMetaController.prototype, "create", 0);

    const app = MeghApplication.getInternalApp();
    app.useControllers([NoMetaController]);
    await expect((app as any)._mapControllers()).rejects.toThrow(
      /NoMetaController\.create: @Body\(\) .*emitDecoratorMetadata/,
    );
  });
});

// ─── #53 useControllers / getApp ─────────────────────────────────────────────

describe("useControllers and getApp (#53)", () => {
  it("adds to the list instead of replacing it", () => {
    @ApiController("/a")
    class AController {}
    @ApiController("/b")
    class BController {}
    const app = MeghApplication.getInternalApp();
    app.useControllers([AController]).useControllers([BController]);
    expect((app as any).controllers).toEqual([AController, BController]);
  });

  it("warns when getApp(options) comes after the app exists", () => {
    const warn = vi.fn();
    const spy = vi
      .spyOn(internal, "internalLogger")
      .mockReturnValue({ warn } as any);
    MeghApplication.getApp();
    MeghApplication.getApp({ requestId: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ignored"));
    spy.mockRestore();
  });
});

// ─── #55 optional peers ──────────────────────────────────────────────────────

describe("requireOptional (#55)", () => {
  it("names the package to install", () => {
    expect(() =>
      requireOptional("megh-not-a-real-package", {
        install: ["megh-not-a-real-package", "other"],
      }),
    ).toThrow(
      "[Megh] megh-not-a-real-package is not installed.\nRun: npm install megh-not-a-real-package other",
    );
  });

  it("loads an installed package", () => {
    expect(requireOptional("path")).toBe(path);
  });
});

// ─── #69 MeghTest ────────────────────────────────────────────────────────────

describe("MeghTest (#69)", () => {
  @Injectable()
  class Mailer {
    send() {
      return "real";
    }
  }
  @Injectable()
  class SignupService {
    constructor(private readonly mailer: Mailer) {}
    run() {
      return this.mailer.send();
    }
  }

  it("uses stand-ins without registering them globally", () => {
    const fake = { send: () => "fake" };
    expect(MeghTest.getProvider(SignupService, [fake]).run()).toBe("fake");
    expect(core.MeghContainer.get(Mailer).send()).toBe("real");
    expect(core.MeghContainer.get(SignupService).run()).toBe("real");
  });

  it("waits for controller mapping before requests", async () => {
    @ApiController("/mt")
    class MtController {
      @Get("/")
      index() {
        return { ok: true };
      }
    }
    const http = MeghTest.createTestApplication({
      controllers: [MtController],
    });
    const res = await http.get("/mt");
    expect(res.statusCode).toBe(200);
  });
});

// ─── #97 GetConfig ───────────────────────────────────────────────────────────

describe("GetConfig (#97)", () => {
  it("passes on errors thrown inside config()", () => {
    @AppConfig
    class StrictConfig extends MeghConfig<string> {
      config(env: Environment) {
        return env.getOrThrow("MEGH_TEST_SURELY_MISSING");
      }
    }
    expect(() => GetConfig(StrictConfig)).toThrow(EnvironmentVariableNotFound);
  });

  it("caches config() until Environment.reload()", () => {
    const calls = vi.fn(() => ({ n: 1 }));
    @AppConfig
    class CountedConfig extends MeghConfig<{ n: number }> {
      config() {
        return calls();
      }
    }
    GetConfig(CountedConfig);
    GetConfig(CountedConfig);
    expect(calls).toHaveBeenCalledTimes(1);
    Environment.reload();
    GetConfig(CountedConfig);
    expect(calls).toHaveBeenCalledTimes(2);
  });
});

// ─── #99 export ──────────────────────────────────────────────────────────────

describe("EnvironmentVariableNotFound (#99)", () => {
  it("is exported and carries the key", () => {
    expect(core.EnvironmentVariableNotFound).toBe(EnvironmentVariableNotFound);
    const err = new EnvironmentVariableNotFound("X");
    expect(err.key).toBe("X");
    expect(err.name).toBe("EnvironmentVariableNotFound");
  });
});

// ─── #100 scheduler ──────────────────────────────────────────────────────────

describe("scheduler (#100)", () => {
  it("stopAll() waits for a run in progress", async () => {
    vi.useFakeTimers();
    let finished = false;
    let release!: () => void;
    @ScheduledTask()
    class SlowTask {
      @Interval(10)
      async tick() {
        await new Promise<void>((r) => (release = r));
        finished = true;
      }
    }
    const scheduler = new MeghScheduler();
    scheduler.addTaskClasses([SlowTask]);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);
    vi.useRealTimers();

    const stopped = scheduler.stopAll();
    let done = false;
    void stopped.then(() => (done = true));
    await new Promise((r) => setImmediate(r));
    expect(done).toBe(false);
    release();
    await stopped;
    expect(finished).toBe(true);
  });

  it("registers two task classes that share a name", async () => {
    const make = () => {
      @ScheduledTask()
      class SameName {}
      return SameName;
    };
    const app = MeghApplication.getInternalApp();
    const [a, b] = [make(), make()];
    (app as any).collectTasks([a, b]);
    expect((app as any).schedulerTasks).toEqual([a, b]);
  });

  it("stops started tasks when startup fails", async () => {
    @ScheduledTask()
    class Ticker {
      @Interval(60_000)
      tick() {}
    }
    const app = MeghApplication.getInternalApp();
    app.useScheduler([Ticker]);
    const stop = vi.spyOn((app as any).scheduler, "stopAll");
    vi.spyOn(app.app, "ready").mockRejectedValue(new Error("boom"));
    await expect(app.run(0, { host: "127.0.0.1" })).rejects.toThrow("boom");
    expect(stop).toHaveBeenCalled();
  });
});

// ─── #104 source dir ─────────────────────────────────────────────────────────

describe("resolveSourceDir (#104)", () => {
  it("maps rootDir to outDir from the tsconfig layout", () => {
    expect(
      resolveSourceDir("src/controllers", false, {
        rootDir: "src",
        outDir: "build",
      }),
    ).toBe(path.join(process.cwd(), "build", "controllers"));
  });

  it("uses MEGH_BUILD_DIR (megh serve's .megh/build) when set (#119)", () => {
    const dev = path.join(process.cwd(), ".megh", "build");
    process.env.MEGH_BUILD_DIR = dev;
    try {
      expect(
        resolveSourceDir("src/controllers", false, { outDir: "dist" }),
      ).toBe(path.join(dev, "controllers"));
      // TypeScript run directly still reads the sources.
      expect(resolveSourceDir("src/controllers", true)).toBe(
        path.join(process.cwd(), "src", "controllers"),
      );
    } finally {
      delete process.env.MEGH_BUILD_DIR;
    }
    expect(resolveSourceDir("src/controllers", false, { outDir: "dist" })).toBe(
      path.join(process.cwd(), "dist", "controllers"),
    );
  });

  it("keeps src under outDir when rootDir is the project root", () => {
    expect(
      resolveSourceDir("src/tasks", false, { rootDir: ".", outDir: "out" }),
    ).toBe(path.join(process.cwd(), "out", "src", "tasks"));
  });
});

// ─── #105 symlinks on save ───────────────────────────────────────────────────

describe("FileStorage save through a symlink (#105)", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "megh-fix-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("rejects a symlinked directory that points outside baseDir", async () => {
    const baseDir = path.join(root, "public");
    const outside = path.join(root, "outside");
    fs.mkdirSync(baseDir);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(baseDir, "link"), "junction");
    const storage = new FileStorage().configure({ baseDir });
    const file = {
      type: "file",
      filename: "a.txt",
      mimetype: "text/plain",
      file: Readable.from([Buffer.from("x")]),
    } as unknown as MultipartFile;
    await expect(storage.save(file, { to: "link" })).rejects.toThrow(
      "Invalid upload directory",
    );
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

// ─── #106 query strings in logs ──────────────────────────────────────────────

describe("default error logger (#106)", () => {
  it("logs the path without the query string", () => {
    const warn = vi.fn();
    const spy = vi
      .spyOn(internal, "internalLogger")
      .mockReturnValue({ warn, error: vi.fn() } as any);
    defaultErrorLogger(
      new Error("nope"),
      { method: "GET", url: "/a?token=secret" } as any,
      { statusCode: 404 } as any,
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
    expect(warn.mock.calls[0][0].route).toBe("GET /a");
    spy.mockRestore();
  });
});
