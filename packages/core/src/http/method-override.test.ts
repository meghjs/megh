import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IsString, MinLength } from "class-validator";
import { MeghApplication } from "../core/application";
import { ApiController } from "./controller";
import { Delete, Get, Patch, Post, Put } from "./route-methods";
import { Body, Param } from "./params";
import { UploadFile } from "./multipart";
import { parseForm } from "./method-override";

class TitleDto {
  @IsString()
  @MinLength(1)
  title!: string;
}

@ApiController("/items")
class ItemsController {
  @Post()
  create(@Body() body: TitleDto) {
    return { method: "POST", title: body.title };
  }

  @Put("/:id")
  replace(@Param("id") id: number, @Body() body: TitleDto) {
    return { method: "PUT", id, title: body.title };
  }

  @Patch("/:id")
  patch(@Param("id") id: number) {
    return { method: "PATCH", id };
  }

  @Post("/upload")
  upload(@UploadFile("photo") file: any) {
    return { method: "POST", file: file?.filename };
  }

  @Put("/:id/photo")
  photo(
    @Param("id") id: number,
    @Body() body: any,
    @UploadFile("photo") file: any,
  ) {
    return {
      method: "PUT",
      id,
      caption: body?.caption?.value,
      file: file && { name: file.filename, type: file.mimetype },
    };
  }

  @Delete("/:id")
  remove(@Param("id") id: number) {
    return { method: "DELETE", id };
  }

  @Get("/:id")
  show(@Param("id") id: number) {
    return { method: "GET", id };
  }
}

async function boot(setup: (app: MeghApplication) => void) {
  const app = MeghApplication.getInternalApp();
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

const FORM = { "content-type": "application/x-www-form-urlencoded" };

describe("useMethodOverride", () => {
  let app: MeghApplication;
  let spies: ReturnType<typeof vi.spyOn>[] = [];

  const post = (
    url: string,
    payload: string,
    headers: Record<string, string> = FORM,
  ) => app.inject({ method: "POST", url, headers, payload });

  beforeEach(async () => {
    spies = (["log", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    app = await boot((a) => {
      a.useMethodOverride();
      a.useMultipart();
      a.useControllers([ItemsController]);
    });
  });

  afterEach(async () => {
    await app.close();
    spies.forEach((s) => s.mockRestore());
  });

  it("routes a form POST by its _method field, keeping the body", async () => {
    const put = await post("/items/1", "_token=x&_method=PUT&title=Renamed");
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ method: "PUT", id: 1, title: "Renamed" });

    expect((await post("/items/2", "_method=patch")).json()).toEqual({
      method: "PATCH",
      id: 2,
    });
    expect((await post("/items/3", "_method=DELETE")).json()).toEqual({
      method: "DELETE",
      id: 3,
    });
  });

  it("validates the overridden route's body", async () => {
    expect((await post("/items/1", "_method=PUT&title=")).statusCode).toBe(400);
  });

  it("leaves a plain form POST and a JSON POST as POST", async () => {
    expect((await post("/items", "title=New")).json()).toEqual({
      method: "POST",
      title: "New",
    });
    const json = await app.inject({
      method: "POST",
      url: "/items",
      payload: { title: "Json" },
    });
    expect(json.json()).toEqual({ method: "POST", title: "Json" });
    // _method in a JSON body is not an override: still a POST, and /items/:id has none.
    const notForm = await app.inject({
      method: "POST",
      url: "/items/1",
      payload: { _method: "PUT", title: "x" },
    });
    expect(notForm.statusCode).toBe(404);
  });

  it("ignores _method values other than PUT, PATCH and DELETE", async () => {
    // No POST route on /items/:id, so staying a POST means 404.
    expect((await post("/items/1", "_method=GET")).statusCode).toBe(404);
    expect((await post("/items/1", "_method=OPTIONS")).statusCode).toBe(404);
  });

  it("does not touch GET requests", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/items/5?_method=DELETE",
    });
    expect(res.json()).toEqual({ method: "GET", id: 5 });
  });

  it("works over a real socket", async () => {
    const { port } = app.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/items/7`, {
      method: "POST",
      headers: FORM,
      body: "_method=PUT&title=Live",
    });
    expect(await res.json()).toEqual({ method: "PUT", id: 7, title: "Live" });
  });

  /** Serialize like a browser: multipart, parts in the given order. */
  const multipart = async (url: string, parts: [string, string | File][]) => {
    const fd = new FormData();
    for (const [k, v] of parts) {
      if (typeof v === "string") fd.append(k, v);
      else fd.append(k, v, v.name);
    }
    const req = new Request("http://localhost", { method: "POST", body: fd });
    return app.inject({
      method: "POST",
      url,
      headers: { "content-type": req.headers.get("content-type")! },
      payload: Buffer.from(await req.arrayBuffer()),
    });
  };
  const png = (size = 8) =>
    new File([new Uint8Array(size)], "a.png", { type: "image/png" });

  it("routes a multipart POST by _method, keeping fields and the file", async () => {
    const res = await multipart("/items/4/photo", [
      ["_token", "t"],
      ["_method", "PUT"],
      ["caption", "Hi"],
      ["photo", png()],
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      method: "PUT",
      id: 4,
      caption: "Hi",
      file: { name: "a.png", type: "image/png" },
    });
  });

  it("reroutes an upload larger than bodyLimit, reading only its start", async () => {
    // Fastify's default bodyLimit is 1 MB; the file has its own limit.
    const res = await multipart("/items/4/photo", [
      ["_method", "PUT"],
      ["photo", png(3 * 1024 * 1024)],
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().file.name).toBe("a.png");
  });

  it("ignores a multipart _method that comes after a file", async () => {
    const res = await multipart("/items/4/photo", [
      ["photo", png()],
      ["_method", "PUT"],
    ]);
    expect(res.statusCode).toBe(404); // stayed a POST
  });

  it("leaves a multipart POST without _method as POST", async () => {
    const res = await multipart("/items/upload", [
      ["title", "Multi"],
      ["photo", png()],
    ]);
    expect(res.json()).toEqual({ method: "POST", file: "a.png" });
    expect((await multipart("/items/1", [["title", "x"]])).statusCode).toBe(
      404,
    );
  });

  it("can only be turned on once", () => {
    const fresh = MeghApplication.getInternalApp().useMethodOverride();
    expect(() => fresh.useMethodOverride()).toThrow(/already on/);
  });
});

describe("parseForm", () => {
  it("collects repeated fields into an array", () => {
    expect(parseForm("a=1&tags=x&tags=y&tags=z")).toEqual({
      a: "1",
      tags: ["x", "y", "z"],
    });
  });

  it("does not let __proto__ reach the prototype", () => {
    const out = parseForm("__proto__=polluted");
    expect(({} as any).polluted).toBeUndefined();
    expect(out.__proto__).toBe("polluted");
  });
});
