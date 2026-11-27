import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IsEmail, IsInt, IsOptional, IsString, Min } from "class-validator";
import { MeghApplication } from "../core/application";
import { ApiController } from "../http/controller";
import { Get, Post, Put } from "../http/route-methods";
import { Body, Param, Query } from "../http/params";
import { Authorized, CanAuthorize } from "../http/middleware";
import { Paginated } from "../collection/pagination";
import {
  AutoIncrement,
  Column,
  CreatedAt,
  DeletedAt,
  Model,
  PrimaryKey,
  Table,
} from "../orm";
import { OpenApi } from "./openapi";
import { ApiResponse } from "./responses";

class RsCreateUserDto {
  @IsString() name!: string;
  @IsEmail() email!: string;
}

class RsListQuery {
  @IsOptional() @IsInt() @Min(1) page?: number;
}

class RsUserDto {
  @IsInt() id!: number;
  @IsString() name!: string;
}

@Table("rs_users")
class RsUser extends Model {
  @PrimaryKey() @AutoIncrement() id?: number;
  @Column() name!: string;
  @Column({ nullable: true, length: 120 }) email!: string | null;
  @Column({ type: "boolean" }) active?: boolean;
  @Column({ type: "json", nullable: true }) settings!: Record<
    string,
    unknown
  > | null;
  @CreatedAt() created_at?: Date;
  @DeletedAt() deleted_at?: Date | null;
}

@CanAuthorize
class RsAuthorization {
  authorize() {
    return true;
  }
}

@ApiController("/rs")
@ApiResponse(500, { description: "Something broke" })
class RsController {
  @Get("/users")
  @ApiResponse(200, Paginated(RsUser))
  index(@Query() query: RsListQuery) {
    return { data: [], meta: query };
  }

  @Get("/users/:id")
  @ApiResponse(200, RsUser)
  @ApiResponse(404)
  show(@Param("id") id: number) {
    // Not in the RsUser schema: must still be sent.
    return { id: Number(id), name: "Ann", posts_count: 3 };
  }

  @Post("/users")
  @ApiResponse(201, { type: RsUserDto, description: "The new user" })
  create(@Body() body: RsCreateUserDto) {
    return { id: 1, ...body };
  }

  @Get("/dtos")
  @OpenApi({ response: { 200: [RsUserDto] } })
  list() {
    return [{ id: 1, name: "Ann", extra: true }];
  }

  @Get("/plain", {
    openapi: {
      summary: "From the route option",
      response: {
        200: { type: "object", properties: { ok: { type: "boolean" } } },
      },
    },
  })
  plain() {
    // A plain JSON schema still serializes the reply, as before.
    return { ok: true, dropped: "yes" };
  }

  @Get("/message")
  @ApiResponse(200, {
    type: "object",
    properties: { message: { type: "string" } },
  })
  message() {
    return { message: "hi" };
  }

  @Put("/secure")
  @Authorized()
  secure() {
    return {};
  }

  @Get("/open")
  open() {
    return {};
  }
}

describe("documented responses", () => {
  let app: MeghApplication;
  let spec: any;
  const op = (path: string, method: string) => spec.paths[path][method];

  beforeAll(async () => {
    app = MeghApplication.getInternalApp();
    app.useOpenApi({ info: { title: "t", version: "1" }, auth: "bearer" });
    app.useAuthorization(RsAuthorization);
    app.useControllers([RsController]);
    const before = {
      SIGTERM: process.listeners("SIGTERM"),
      SIGINT: process.listeners("SIGINT"),
    };
    await app.run(0);
    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      for (const l of process.listeners(sig))
        if (!before[sig].includes(l)) process.removeListener(sig, l);
    }
    spec = (await app.inject({ method: "GET", url: "/swagger/json" })).json();
  });

  afterAll(async () => {
    await app.close();
  });

  it("documents a model from its column decorators", () => {
    const res = op("/rs/users/{id}", "get").responses;
    expect(res["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/RsUser",
    });
    expect(spec.components.schemas.RsUser).toEqual({
      type: "object",
      properties: {
        id: { type: "integer" },
        name: { type: "string" },
        email: { type: "string", maxLength: 120, nullable: true },
        active: { type: "boolean" },
        settings: { nullable: true },
        created_at: { type: "string", format: "date-time" },
        deleted_at: { type: "string", format: "date-time", nullable: true },
      },
      required: [
        "id",
        "name",
        "email",
        "active",
        "settings",
        "created_at",
        "deleted_at",
      ],
    });
  });

  it("documents a page with Paginated()", () => {
    const schema = op("/rs/users", "get").responses["200"].content[
      "application/json"
    ].schema;
    expect(schema).toEqual({
      type: "object",
      properties: {
        data: { type: "array", items: { $ref: "#/components/schemas/RsUser" } },
        meta: { $ref: "#/components/schemas/PaginationMeta" },
      },
      required: ["data", "meta"],
    });
    expect(spec.components.schemas.PaginationMeta.required).toEqual([
      "total",
      "page",
      "perPage",
      "lastPage",
      "next",
      "prev",
    ]);
  });

  it("documents DTOs, arrays and inline schemas, with their descriptions", () => {
    const created = op("/rs/users", "post").responses;
    expect(created["201"]).toEqual({
      description: "The new user",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RsUserDto" },
        },
      },
    });
    // A declared 201 replaces @fastify/swagger's "200: Default Response".
    expect(created["200"]).toBeUndefined();
    expect(spec.components.schemas.RsUserDto.properties).toHaveProperty("name");

    expect(
      op("/rs/dtos", "get").responses["200"].content["application/json"].schema,
    ).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/RsUserDto" },
    });
    expect(
      op("/rs/message", "get").responses["200"].content["application/json"]
        .schema,
    ).toEqual({
      type: "object",
      properties: { message: { type: "string" } },
    });
  });

  it("adds the errors the controller can produce", () => {
    // A validated @Body() or @Query() DTO → 400 with the validation error shape.
    const validation = { $ref: "#/components/schemas/ValidationErrorResponse" };
    expect(
      op("/rs/users", "post").responses["400"].content["application/json"]
        .schema,
    ).toEqual(validation);
    expect(
      op("/rs/users", "get").responses["400"].content["application/json"]
        .schema,
    ).toEqual(validation);
    expect(
      spec.components.schemas.ValidationErrorResponse.properties.errors.type,
    ).toBe("array");
    // @ApiResponse(404) with no type → the error shape.
    expect(op("/rs/users/{id}", "get").responses["404"]).toEqual({
      description: "Not Found",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ErrorResponse" },
        },
      },
    });
    // A class-level @ApiResponse applies to every route.
    expect(op("/rs/open", "get").responses["500"].description).toBe(
      "Something broke",
    );
    // No DTO, not authorized: nothing invented.
    expect(Object.keys(op("/rs/open", "get").responses).sort()).toEqual([
      "200",
      "500",
    ]);
  });

  it("marks @Authorized routes with 401, 403 and the auth scheme", () => {
    const secure = op("/rs/secure", "put");
    expect(secure.responses["401"].description).toBe(
      "Missing or invalid credentials",
    );
    expect(secure.responses["403"].description).toBe("Not allowed to do this");
    expect(secure.security).toEqual([{ bearerAuth: [] }]);
    expect(op("/rs/open", "get").security).toBeUndefined();
    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    });
  });

  it("reads the route decorator's openapi option", () => {
    expect(op("/rs/plain", "get").summary).toBe("From the route option");
  });

  it("leaves no extension keys in the document", () => {
    expect(JSON.stringify(spec)).not.toMatch(/x-megh-/);
  });

  it("documents responses without changing what is sent", async () => {
    const inject = (url: string) => app.inject({ method: "GET", url });
    // Fields outside the documented schema are still sent.
    expect((await inject("/rs/users/7")).json()).toEqual({
      id: 7,
      name: "Ann",
      posts_count: 3,
    });
    expect((await inject("/rs/dtos")).json()).toEqual([
      { id: 1, name: "Ann", extra: true },
    ]);
    // A plain JSON schema on `response` still serializes, as before.
    expect((await inject("/rs/plain")).json()).toEqual({ ok: true });
  });
});

// ─── Compile-time checks (checked by `tsc -p tsconfig.test.json`) ───────────

export function typeChecks() {
  const ok: import("./openapi").OpenApiUiOptions = {
    info: { title: "Shop", version: "1.0.0" },
    routePrefix: "/docs",
    auth: "bearer",
    uiConfig: { docExpansion: "list", persistAuthorization: true },
    scalar: { layout: "modern" },
    logo: null,
  };
  // @ts-expect-error not a docExpansion value
  const badExpansion: import("./openapi").OpenApiUiOptions = {
    uiConfig: { docExpansion: "open" },
  };
  // @ts-expect-error info needs a version
  const noVersion: import("./openapi").OpenApiUiOptions = {
    info: { title: "x" },
  };
  // @ts-expect-error unknown option
  const typo: import("./openapi").OpenApiUiOptions = { routePrefx: "/docs" };
  // @ts-expect-error not an auth scheme
  const badAuth: import("./openapi").OpenApiUiOptions = { auth: "jwt" };
  return [ok, badExpansion, noVersion, typo, badAuth];
}
