import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MeghApplication } from "../core/application";
import { ApiController } from "./controller";
import { Get } from "./route-methods";
import { Param, Query } from "./params";

@ApiController("/cast")
class CastController {
  @Get("/str/:id")
  str(@Param("id") id: string, @Query("tag") tag: string) {
    return { id, idType: typeof id, tag, tagType: typeof tag };
  }

  @Get("/num/:id")
  num(@Param("id") id: number) {
    return { id, idType: typeof id };
  }

  @Get("/bool")
  bool(@Query("flag") flag: boolean) {
    return { flag, flagType: typeof flag };
  }
}

describe("path and query casting by declared type", () => {
  let app: MeghApplication;

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    app = MeghApplication.getInternalApp();
    app.useControllers([CastController]);
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
  });

  afterAll(async () => {
    await app.close();
    (console.log as any).mockRestore?.();
  });

  const get = (url: string) => app.inject({ method: "GET", url });

  it("keeps a numeric-looking string param and query as strings", async () => {
    const res = await get("/cast/str/42?tag=true");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: "42",
      idType: "string",
      tag: "true",
      tagType: "string",
    });
  });

  it("casts a number param", async () => {
    const res = await get("/cast/num/42");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 42, idType: "number" });
  });

  it("rejects a non-numeric number param", async () => {
    const res = await get("/cast/num/abc");
    expect(res.statusCode).toBe(400);
  });

  it("casts a boolean query", async () => {
    const res = await get("/cast/bool?flag=false");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ flag: false, flagType: "boolean" });
  });
});
