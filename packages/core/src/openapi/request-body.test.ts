import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { MeghApplication } from "../core/application";
import { ApiController } from "../http/controller";
import { Get, Post } from "../http/route-methods";
import { Body } from "../http/params";
import { OpenApi } from "./openapi";
import { OpenApiProperty } from "./swagger-schema";
import {
  applyRequestBodyExtensions,
  buildRequestBody,
  REQUEST_BODY_EXTENSION,
} from "./request-body";

class RbAddressDto {
  @IsString()
  city!: string;
}

class RbCreateUserDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  @ValidateNested()
  @Type(() => RbAddressDto)
  address!: RbAddressDto;
}

class RbUploadDto {
  @IsString()
  title!: string;

  @OpenApiProperty({ format: "binary" })
  file!: any;
}

describe("buildRequestBody", () => {
  it("returns undefined when nothing documents a body", () => {
    expect(buildRequestBody({})).toBeUndefined();
  });

  it("documents the @Body() DTO as a required JSON body with $refs", () => {
    const out = buildRequestBody({ bodyClass: RbCreateUserDto })!;
    expect(out.requestBody).toEqual({
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RbCreateUserDto" },
        },
      },
    });
    expect(out.schemas.RbCreateUserDto.properties.name).toEqual({
      type: "string",
    });
    expect(out.schemas.RbCreateUserDto.properties.address).toEqual({
      $ref: "#/components/schemas/RbAddressDto",
    });
    expect(out.schemas.RbAddressDto.properties.city).toEqual({
      type: "string",
    });
  });

  it("keeps description/required and uses the DTO when no schema is given", () => {
    const out = buildRequestBody({
      requestBody: { description: "New user", required: false },
      bodyClass: RbCreateUserDto,
    })!;
    expect(out.requestBody).toMatchObject({
      description: "New user",
      required: false,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RbCreateUserDto" },
        },
      },
    });
  });

  it("accepts an inline schema with example(s) and several media types", () => {
    const schema = {
      type: "object" as const,
      properties: { q: { type: "string" as const } },
    };
    const out = buildRequestBody({
      requestBody: {
        schema,
        contentType: ["application/json", "application/x-www-form-urlencoded"],
        example: { q: "x" },
        examples: { basic: { value: { q: "y" } } },
      },
    })!;
    const media = {
      schema,
      example: { q: "x" },
      examples: { basic: { value: { q: "y" } } },
    };
    expect(out.requestBody).toEqual({
      required: true,
      content: {
        "application/json": media,
        "application/x-www-form-urlencoded": media,
      },
    });
  });

  it("accepts full per-media-type content, resolving DTO classes", () => {
    const out = buildRequestBody({
      requestBody: {
        content: {
          "application/json": { schema: RbCreateUserDto },
          "text/plain": { schema: { type: "string" }, example: "hi" },
        },
      },
    })!;
    expect((out.requestBody as any).content).toEqual({
      "application/json": {
        schema: { $ref: "#/components/schemas/RbCreateUserDto" },
      },
      "text/plain": { schema: { type: "string" }, example: "hi" },
    });
    expect(out.schemas).toHaveProperty("RbCreateUserDto");
  });

  it("accepts a DTO class or a $ref directly", () => {
    expect(
      (buildRequestBody({ requestBody: RbCreateUserDto })!.requestBody as any)
        .content["application/json"].schema,
    ).toEqual({ $ref: "#/components/schemas/RbCreateUserDto" });
    expect(
      buildRequestBody({
        requestBody: { $ref: "#/components/requestBodies/User" },
      })!.requestBody,
    ).toEqual({ $ref: "#/components/requestBodies/User" });
  });

  it("uses multipart/form-data for schemas with a binary field", () => {
    const out = buildRequestBody({ bodyClass: RbUploadDto })!;
    expect(Object.keys((out.requestBody as any).content)).toEqual([
      "multipart/form-data",
    ]);
  });

  it("applyRequestBodyExtensions moves the extension into requestBody", () => {
    const ext = buildRequestBody({ bodyClass: RbCreateUserDto })!;
    const doc: any = {
      paths: {
        "/u": { post: { [REQUEST_BODY_EXTENSION]: ext, responses: {} } },
      },
      components: { schemas: { RbAddressDto: { kept: true } } },
    };
    applyRequestBodyExtensions(doc);
    expect(doc.paths["/u"].post[REQUEST_BODY_EXTENSION]).toBeUndefined();
    expect(doc.paths["/u"].post.requestBody).toEqual(ext.requestBody);
    expect(doc.components.schemas.RbCreateUserDto).toBeDefined();
    // Existing component schemas are not overwritten.
    expect(doc.components.schemas.RbAddressDto).toEqual({ kept: true });
  });
});

@ApiController("/rb")
class RbController {
  @Post("/dto")
  createFromDto(@Body() body: RbCreateUserDto) {
    return body;
  }

  @OpenApi({
    requestBody: {
      description: "Search filter",
      required: false,
      schema: { type: "object", properties: { q: { type: "string" } } },
      example: { q: "megh" },
    },
  })
  @Post("/inline")
  inline() {
    return {};
  }

  @OpenApi({ requestBody: { description: "Upload" } })
  @Post("/upload")
  upload(@Body() body: RbUploadDto) {
    return body;
  }

  @OpenApi({ exclude: true })
  @Get("/hidden")
  hidden() {
    return {};
  }

  @Get("/nobody")
  noBody() {
    return {};
  }
}

describe("generated OpenAPI document", () => {
  let app: MeghApplication;
  let spec: any;

  beforeAll(async () => {
    app = MeghApplication.getInternalApp();
    app.useOpenApi({ info: { title: "t", version: "1" } });
    app.useControllers([RbController]);
    app
      .mapPost("/rb/functional", () => ({}))
      .useOpenApi({
        requestBody: { schema: RbAddressDto, description: "Address" },
      });
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

  it("documents a @Body() DTO with resolvable $refs", () => {
    const op = spec.paths["/rb/dto"].post;
    expect(op[REQUEST_BODY_EXTENSION]).toBeUndefined();
    expect(op.requestBody).toEqual({
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RbCreateUserDto" },
        },
      },
    });
    expect(spec.components.schemas.RbCreateUserDto).toBeDefined();
    expect(spec.components.schemas.RbAddressDto).toBeDefined();
  });

  it("documents @OpenApi requestBody as given", () => {
    expect(spec.paths["/rb/inline"].post.requestBody).toEqual({
      description: "Search filter",
      required: false,
      content: {
        "application/json": {
          schema: { type: "object", properties: { q: { type: "string" } } },
          example: { q: "megh" },
        },
      },
    });
  });

  it("documents file uploads as multipart/form-data", () => {
    const rb = spec.paths["/rb/upload"].post.requestBody;
    expect(rb.description).toBe("Upload");
    expect(Object.keys(rb.content)).toEqual(["multipart/form-data"]);
  });

  it("documents functional routes", () => {
    expect(spec.paths["/rb/functional"].post.requestBody).toMatchObject({
      description: "Address",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RbAddressDto" },
        },
      },
    });
  });

  it("omits requestBody when the route has none, and hides excluded routes", () => {
    expect(spec.paths["/rb/nobody"].get.requestBody).toBeUndefined();
    expect(spec.paths["/rb/hidden"]).toBeUndefined();
  });

  it("does not change request handling", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/rb/inline",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });
});
