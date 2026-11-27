import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { MeghApplication } from "../core/application";
import { ApiController } from "../http/controller";
import { Get } from "../http/route-methods";
import { Query } from "../http/params";
import { OpenApi } from "./openapi";
import { QUERY_PARAMS_EXTENSION } from "./query-params";

class QpListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Max(100)
  perPage?: number;

  @IsNotEmpty()
  @IsString()
  sort!: string;
}

@ApiController("/qp")
class QpController {
  @Get("/dto")
  dto(@Query() query: QpListQuery, @Query("user_id") userId: number) {
    return { query, userId };
  }

  @Get("/keys")
  keys(
    @Query("q") q: string,
    @Query("active", { required: false }) active: boolean,
  ) {
    return { q, active };
  }

  @OpenApi({ query: { q: { type: "string", description: "Search text" } } })
  @Get("/override")
  override(@Query("q") q: string, @Query("limit") limit: number) {
    return { q, limit };
  }

  @Get("/none")
  none() {
    return {};
  }
}

describe("@Query() in the generated OpenAPI document", () => {
  let app: MeghApplication;
  let spec: any;

  const query = (path: string) =>
    (spec.paths[path].get.parameters ?? []).filter(
      (p: any) => p.in === "query",
    );

  beforeAll(async () => {
    app = MeghApplication.getInternalApp();
    app.useOpenApi({ info: { title: "t", version: "1" } });
    app.useControllers([QpController]);
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
    const res = await app.inject({
      method: "GET",
      url: "/swagger/json",
    });
    spec = res.json();
  });

  afterAll(async () => {
    await app.close();
  });

  it("documents each property of a @Query() DTO, plus @Query('key')", () => {
    const params = query("/qp/dto");
    expect(params.map((p: any) => p.name)).toEqual([
      "page",
      "perPage",
      "sort",
      "user_id",
    ]);
    const byName = Object.fromEntries(params.map((p: any) => [p.name, p]));
    expect(byName.page.required).toBe(false);
    expect(byName.page.schema).toMatchObject({ type: "integer", minimum: 1 });
    expect(byName.perPage.schema).toMatchObject({ maximum: 100 });
    expect(byName.sort).toMatchObject({
      required: true,
      schema: { type: "string" },
    });
    expect(byName.user_id).toMatchObject({
      required: true,
      schema: { type: "number" },
    });
    expect(spec.paths["/qp/dto"].get[QUERY_PARAMS_EXTENSION]).toBeUndefined();
  });

  it("documents @Query('key') with its type and required option", () => {
    expect(query("/qp/keys")).toEqual([
      { name: "q", in: "query", required: true, schema: { type: "string" } },
      {
        name: "active",
        in: "query",
        required: false,
        schema: { type: "boolean" },
      },
    ]);
  });

  it("keeps @OpenApi({ query }) and adds the rest", () => {
    const params = query("/qp/override");
    expect(params.map((p: any) => p.name)).toEqual(["q", "limit"]);
    expect(params[0].description).toBe("Search text");
  });

  it("adds no query parameters to routes without @Query()", () => {
    expect(query("/qp/none")).toEqual([]);
  });

  it("does not change request handling", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/qp/keys?q=hi",
    });
    expect(res.statusCode).toBe(200);
  });
});
