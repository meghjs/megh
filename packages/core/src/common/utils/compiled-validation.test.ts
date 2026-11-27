import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { Expose, Transform, Type } from "class-transformer";
import { compileValidator } from "./compiled-validation";
import { transformAndValidate } from "./validation-utils";
import { MeghApplication } from "../../core/application";
import { ApiController } from "../../http/controller";
import { Post, Get } from "../../http/route-methods";
import { Body, Query } from "../../http/params";

// ─── DTOs the compiled path handles ─────────────────────────────────────────

@ValidatorConstraint({ name: "isEven" })
class IsEven implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === "number" && value % 2 === 0;
  }
  defaultMessage() {
    return "$property must be even, got $value";
  }
}

class BaseDto {
  @IsString()
  @MaxLength(10)
  name!: string;
}

class UserDto extends BaseDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(150)
  age?: number;

  @IsEmail({}, { message: "email: $value is not an email" })
  email!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsIn(["admin", "user"])
  role?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MinLength(2, { each: true })
  tags?: string[];

  @IsOptional()
  @Validate(IsEven)
  luckyNumber?: number;

  @ValidateIf((o) => o.role === "admin")
  @IsNotEmpty({ message: (args) => `${args.property} is required for admins` })
  adminCode?: string;

  @Allow()
  note?: unknown;

  @IsDefined()
  @Matches(/^[a-z]+$/)
  slug!: string;

  /** Getters and methods are never assigned by plainToInstance. */
  get display() {
    return this.name;
  }
  greet() {
    return `hi ${this.name}`;
  }
}

class DefaultsDto {
  @IsOptional()
  @IsInt()
  page: number = 1;

  @IsOptional()
  @IsString()
  sort: string = "id";
}

/** Not declared `async`, but returns a promise anyway. */
@ValidatorConstraint({ name: "sneakyAsync" })
class SneakyAsync implements ValidatorConstraintInterface {
  validate() {
    return Promise.resolve(true) as any;
  }
}

class PromiseLikeDto {
  @Validate(SneakyAsync)
  value!: string;
}

// ─── DTOs that must fall back to class-validator ────────────────────────────

class AddressDto {
  @IsString()
  city!: string;
}

class NestedDto {
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

class TypedQueryDto {
  @Type(() => Number)
  @IsInt()
  page!: number;
}

class TransformDto {
  @Transform(({ value }) => String(value).trim())
  @IsString()
  name!: string;
}

class ExposeDto {
  @Expose({ name: "user_name" })
  @IsString()
  name!: string;
}

@ValidatorConstraint({ name: "slowCheck", async: true })
class SlowCheck implements ValidatorConstraintInterface {
  async validate() {
    return true;
  }
}

class AsyncDto {
  @Validate(SlowCheck)
  value!: string;
}

class NoMetadataDto {
  value!: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Both paths must agree on the errors and on the value handed to the handler. */
async function expectSameAsClassValidator(target: any, payload: unknown) {
  const compiled = compileValidator(target);
  expect(compiled, `${target.name} should compile`).toBeTypeOf("function");
  const fast = compiled!(payload);
  expect(fast, "compiled path bailed out").toBeDefined();
  const slow = await transformAndValidate(target, payload);
  expect(fast!.errors).toStrictEqual(slow.errors);
  expect(fast!.value).toStrictEqual(slow.value);
  return fast!;
}

const valid = { name: "Ada", email: "ada@example.com", slug: "ada" };

// ─── Unit: compiled output equals class-validator output ────────────────────

describe("compileValidator", () => {
  const cases: [string, unknown][] = [
    ["a valid payload", valid],
    [
      "a full valid payload",
      {
        ...valid,
        age: 36,
        active: true,
        role: "user",
        tags: ["ab", "cd"],
        luckyNumber: 4,
        note: { any: ["thing"] },
      },
    ],
    ["an empty object", {}],
    ["undefined", undefined],
    ["null", null],
    [
      "wrong types everywhere",
      {
        name: 42,
        age: "36",
        email: "nope",
        active: "yes",
        role: "root",
        tags: "a",
        luckyNumber: 3,
        slug: "Not Valid",
      },
    ],
    ["out-of-range numbers", { ...valid, age: -1 }],
    ["a float for an int", { ...valid, age: 1.5 }],
    ["too long a name (inherited rule)", { ...valid, name: "x".repeat(11) }],
    ["each-item failures", { ...valid, tags: ["ok", "x", 3] }],
    ["too many items", { ...valid, tags: ["aa", "bb", "cc", "dd"] }],
    [
      "admin without code (ValidateIf + message fn)",
      { ...valid, role: "admin" },
    ],
    ["admin with code", { ...valid, role: "admin", adminCode: "x1" }],
    ["unknown properties", { ...valid, isAdmin: true, extra: 1 }],
    ["only unknown properties", { isAdmin: true }],
    [
      "a getter and a method name in the body",
      { ...valid, display: "x", greet: "x" },
    ],
    [
      "inherited Object methods as keys",
      { ...valid, toString: "x", hasOwnProperty: 1 },
    ],
    ["a constructor key", { ...valid, constructor: "x" }],
    ["$tokens in values", { ...valid, email: "$property $target" }],
    ["null fields", { ...valid, age: null, name: null }],
    [
      "nested plain values are copied",
      {
        ...valid,
        note: { a: [1, { b: 2 }], toString: "skipped" },
      },
    ],
  ];

  it.each(cases)("matches class-validator for %s", async (_label, payload) => {
    await expectSameAsClassValidator(UserDto, payload);
  });

  it("matches class-validator for a __proto__ key from JSON.parse", async () => {
    await expectSameAsClassValidator(
      UserDto,
      JSON.parse(
        "{\"name\":\"Ada\",\"email\":\"ada@example.com\",\"slug\":\"ada\",\"__proto__\":{\"x\":1}}",
      ),
    );
  });

  it("matches class-validator for a null-prototype payload (query strings)", async () => {
    const payload = Object.assign(Object.create(null), valid, { extra: "1" });
    await expectSameAsClassValidator(UserDto, payload);
  });

  it("keeps class field defaults", async () => {
    const { value } = await expectSameAsClassValidator(DefaultsDto, {});
    expect(value).toBeInstanceOf(DefaultsDto);
    expect({ ...value }).toEqual({ page: 1, sort: "id" });
    await expectSameAsClassValidator(DefaultsDto, { page: 2 });
    await expectSameAsClassValidator(DefaultsDto, { page: "2" });
  });

  it.each([
    ["an array", [1, 2]],
    ["a string", "hello"],
    ["a number", 7],
  ])("rejects %s like transformAndValidate", async (_label, payload) => {
    const fast = compileValidator(UserDto)!(payload);
    const slow = await transformAndValidate(UserDto, payload);
    expect(fast).toStrictEqual(slow);
  });

  it("does not share nested objects with the request body", () => {
    const body = { ...valid, note: { list: [1] } };
    const { value } = compileValidator(UserDto)!(body)!;
    expect((value as any).note).toEqual(body.note);
    expect((value as any).note).not.toBe(body.note);
  });

  it("bails out when a constraint returns a promise", () => {
    const compiled = compileValidator(PromiseLikeDto);
    expect(compiled).toBeTypeOf("function");
    expect(compiled!({ value: "x" })).toBeUndefined();
  });

  it("bails out on objects plainToInstance would treat specially", () => {
    const compiled = compileValidator(UserDto)!;
    expect(compiled({ ...valid, note: new Map() })).toBeUndefined();
    expect(compiled({ ...valid, note: [new Set([1])] })).toBeUndefined();
    // class-transformer itself throws on this one; the slow path keeps that.
    expect(compiled({ ...valid, note: { constructor: 1 } })).toBeUndefined();
  });

  it.each([
    ["@ValidateNested + @Type", NestedDto],
    ["@Type on a query field", TypedQueryDto],
    ["@Transform", TransformDto],
    ["@Expose", ExposeDto],
    ["an async constraint", AsyncDto],
    ["no validation metadata", NoMetadataDto],
  ])("does not compile a DTO with %s", (_label, target) => {
    expect(compileValidator(target as any)).toBeUndefined();
  });

  it("caches the compiled function per class", () => {
    expect(compileValidator(UserDto)).toBe(compileValidator(UserDto));
  });
});

// ─── HTTP: the same requests answer the same with the flag on and off ───────

@ApiController("/compiled")
class CompiledController {
  @Post("/users")
  create(@Body() body: UserDto) {
    return { isInstance: body instanceof UserDto, body };
  }

  @Post("/nested")
  nested(@Body() body: NestedDto) {
    return { isAddress: body.address instanceof AddressDto, body };
  }

  @Get("/list")
  list(@Query() query: DefaultsDto) {
    return { isInstance: query instanceof DefaultsDto, query };
  }

  @Get("/typed")
  typed(@Query() query: TypedQueryDto) {
    return { query, type: typeof query.page };
  }
}

async function boot(compiledValidation: boolean) {
  const app = MeghApplication.getInternalApp({
    experimental: { compiledValidation },
  });
  app.useControllers([CompiledController]);
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

describe("experimental.compiledValidation", () => {
  let fast: MeghApplication;
  let slow: MeghApplication;

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    fast = await boot(true);
    slow = await boot(false);
  });

  afterAll(async () => {
    await fast.close();
    await slow.close();
    vi.restoreAllMocks();
  });

  const requests: [string, any][] = [
    ["valid body", { method: "POST", url: "/compiled/users", payload: valid }],
    [
      "invalid body",
      {
        method: "POST",
        url: "/compiled/users",
        payload: { name: 1, email: "x", slug: "A", tags: ["a"] },
      },
    ],
    [
      "unknown property",
      {
        method: "POST",
        url: "/compiled/users",
        payload: { ...valid, isAdmin: true },
      },
    ],
    [
      "array body",
      { method: "POST", url: "/compiled/users", payload: [valid] },
    ],
    ["empty body", { method: "POST", url: "/compiled/users" }],
    [
      "nested DTO (fallback), valid",
      {
        method: "POST",
        url: "/compiled/nested",
        payload: { address: { city: "Dhaka" } },
      },
    ],
    [
      "nested DTO (fallback), invalid",
      {
        method: "POST",
        url: "/compiled/nested",
        payload: { address: { city: 1 } },
      },
    ],
    ["query DTO with defaults", { method: "GET", url: "/compiled/list" }],
    [
      "query DTO, string for int",
      { method: "GET", url: "/compiled/list?page=2&sort=name" },
    ],
    ["query DTO, unknown key", { method: "GET", url: "/compiled/list?evil=1" }],
    [
      "@Type query (fallback)",
      { method: "GET", url: "/compiled/typed?page=3" },
    ],
  ];

  it.each(requests)("answers %s the same", async (_label, request) => {
    const a = await fast.inject(request);
    const b = await slow.inject(request);
    expect(a.statusCode).toBe(b.statusCode);
    expect(a.json()).toStrictEqual(b.json());
  });

  it("skips class-validator's validate() for compiled DTOs", async () => {
    const classValidator = require("class-validator");
    const spy = vi.spyOn(classValidator, "validate");
    await fast.inject(requests[0][1]);
    expect(spy).not.toHaveBeenCalled();
    await slow.inject(requests[0][1]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
