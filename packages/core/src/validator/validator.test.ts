import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as classValidator from "class-validator";
import * as classTransformer from "class-transformer";
import * as megh from "./index";
import { transformAndValidate } from "../common/utils/validation-utils";
import { generateClassSchema } from "../openapi/swagger-schema";
import { MeghApplication } from "../core/application";
import { ApiController } from "../http/controller";
import { Get, Post } from "../http/route-methods";
import { Body, Query } from "../http/params";

enum Role {
  Admin = "admin",
  User = "user",
}

/**
 * The same DTOs, decorated either with class-validator + class-transformer or
 * with Megh's decorators. Class names match so `$target` messages match.
 */
function defineDtos(L: any) {
  const {
    Allow,
    ArrayMaxSize,
    ArrayMinSize,
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsDate,
    IsDefined,
    IsEmail,
    IsEmpty,
    IsEnum,
    IsIn,
    IsInt,
    IsNegative,
    IsNotEmpty,
    IsNotIn,
    IsNumber,
    IsObject,
    IsOptional,
    IsPositive,
    IsString,
    IsUrl,
    IsUUID,
    Length,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
    Transform,
    Type,
    ValidateIf,
    ValidateNested,
  } = L;

  class AddressDto {
    @IsString() @MinLength(2) city!: string;
    @IsOptional() @Matches(/^\d{4}$/) zip?: string;
  }

  class TagDto {
    @IsString() @Length(2, 5) name!: string;
  }

  class BaseDto {
    @IsString() @MaxLength(10) name!: string;
    @IsOptional() @IsInt() version?: number;
  }

  class UserDto extends BaseDto {
    @IsEmail({}, { message: "email: $value is not an email" }) email!: string;
    @IsOptional() @IsInt() @Min(0) @Max(150) age?: number;
    @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) score?: number;
    @IsOptional() @IsNumber() ratio?: number;
    @IsOptional() @IsBoolean() active?: boolean;
    @IsOptional() @IsEnum(Role) role?: Role;
    @IsOptional()
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(3)
    @IsString({ each: true })
    @MinLength(2, { each: true })
    tags?: string[];
    @IsOptional()
    @ValidateNested()
    @Type(() => AddressDto)
    address?: AddressDto;
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => TagDto)
    items?: TagDto[];
    @ValidateIf((o: any) => o.role === "admin")
    @IsNotEmpty({ message: (a: any) => `${a.property} is required for admins` })
    adminCode?: string;
    @Allow() note?: unknown;
    @IsDefined() @Matches("^[a-z-]+$", "i") slug!: string;
    @IsOptional() @IsUrl() website?: string;
    @IsOptional() @IsUUID("4") id?: string;
    @IsOptional() @IsNotIn(["root"]) @IsString() login?: string;
    @IsOptional()
    @IsEmpty({ message: "$property: $value must be empty for $target" })
    nickname?: string;
    @IsOptional() @IsObject() meta?: object;
    @IsOptional() @IsPositive() level?: number;
    @IsOptional() @IsNegative() debt?: number;
    @IsOptional() @Type(() => Date) @IsDate() birthday?: Date;
    @IsOptional()
    @Transform(({ value }: any) =>
      typeof value === "string" ? value.trim() : value,
    )
    @IsString()
    @Length(1, 8)
    trimmed?: string;
    @IsOptional() @IsIn(["a", "b"], { each: true }) letters?: string[];

    get display() {
      return this.name;
    }
    greet() {
      return `hi ${this.name}`;
    }
  }

  class QueryDto {
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
    @IsOptional()
    @Transform(({ value }: any) =>
      typeof value === "string" ? value.toLowerCase() : value,
    )
    @IsIn(["id", "name"])
    sort: string = "id";
    @IsOptional() @Type(() => Boolean) @IsBoolean() active?: boolean;
    @IsOptional() @Type(() => String) @IsString() q?: string;
  }

  // A subclass rule of the same kind replaces the inherited ones.
  class ParentDto {
    @IsString() @MinLength(3) code!: string;
    @IsOptional() @IsString() label?: string;
  }
  class ChildDto extends ParentDto {
    @IsInt() code!: any;
  }

  return {
    AddressDto,
    TagDto,
    BaseDto,
    UserDto,
    QueryDto,
    ParentDto,
    ChildDto,
  };
}

const CV = defineDtos({ ...classValidator, ...classTransformer });
const MG = defineDtos(megh);
type DtoName = keyof typeof CV;

/** Instances as plain data plus class names, for comparing across the two sets of classes. */
function normalize(v: any): any {
  if (v instanceof Date)
    return { $date: isNaN(v.getTime()) ? "Invalid" : v.toISOString() };
  if (Array.isArray(v)) return v.map(normalize);
  if (v instanceof Set) return { $set: [...v].map(normalize) };
  if (v instanceof Map)
    return { $map: [...v].map(([k, x]) => [k, normalize(x)]) };
  if (v && typeof v === "object") {
    const out: any = {};
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null)
      out.$class = v.constructor?.name;
    for (const k of Object.keys(v)) out[k] = normalize(v[k]);
    return out;
  }
  return v;
}

async function expectParity(name: DtoName, payload: unknown) {
  const clone = () =>
    payload === undefined ? undefined : structuredClone(payload);
  const slow = await transformAndValidate(CV[name] as any, clone());
  const fast = megh.validateDto(MG[name] as any, clone());
  // Order matters: the response message joins constraints in this order.
  expect(JSON.stringify(fast.errors)).toBe(JSON.stringify(slow.errors));
  expect(normalize(fast.value)).toStrictEqual(normalize(slow.value));
  return fast;
}

const validUser = { name: "Ada", email: "ada@example.com", slug: "ada" };

describe("Megh validator: same results as class-validator + class-transformer", () => {
  const cases: [DtoName, string, unknown][] = [
    ["UserDto", "a valid payload", validUser],
    [
      "UserDto",
      "every field valid",
      {
        ...validUser,
        version: 2,
        age: 36,
        score: 9.75,
        ratio: 0.5,
        active: true,
        role: "user",
        tags: ["ab", "cd"],
        address: { city: "Dhaka", zip: "1207" },
        items: [{ name: "abc" }],
        note: { any: ["thing"] },
        website: "https://megh.dev",
        id: "550e8400-e29b-41d4-a716-446655440000",
        login: "ada",
        meta: {},
        level: 1,
        debt: -1,
        birthday: "2024-01-02T00:00:00.000Z",
        trimmed: "  hi  ",
        letters: ["a", "b"],
      },
    ],
    ["UserDto", "an empty object", {}],
    ["UserDto", "undefined", undefined],
    ["UserDto", "null", null],
    ["UserDto", "an array", [validUser]],
    ["UserDto", "a string", "hello"],
    [
      "UserDto",
      "wrong types everywhere",
      {
        name: 42,
        email: "nope",
        slug: "Not Valid!",
        age: "36",
        score: 1.234,
        ratio: "1",
        active: "yes",
        role: "root",
        tags: "a",
        address: "Dhaka",
        items: "x",
        website: "nope",
        id: "123",
        login: "root",
        nickname: "bob",
        meta: [],
        level: -1,
        debt: 1,
        birthday: "not a date",
        trimmed: "   ",
        letters: ["a", "c"],
      },
    ],
    [
      "UserDto",
      "inherited rule failures",
      { ...validUser, name: "x".repeat(11), version: 1.5 },
    ],
    ["UserDto", "each-item failures", { ...validUser, tags: ["ok", "x", 3] }],
    [
      "UserDto",
      "too many and empty arrays",
      { ...validUser, tags: [], items: [] },
    ],
    [
      "UserDto",
      "nested object failures",
      { ...validUser, address: { city: 1, zip: "12", extra: true } },
    ],
    [
      "UserDto",
      "nested array failures",
      {
        ...validUser,
        items: [
          { name: "x" },
          "str",
          null,
          [{ name: "y" }],
          { name: "okay", bad: 1 },
        ],
      },
    ],
    ["UserDto", "a nested null", { ...validUser, address: null }],
    ["UserDto", "admin without code", { ...validUser, role: "admin" }],
    [
      "UserDto",
      "admin with code",
      { ...validUser, role: "admin", adminCode: "x1" },
    ],
    [
      "UserDto",
      "unknown properties",
      { ...validUser, isAdmin: true, extra: 1 },
    ],
    [
      "UserDto",
      "getter and method names",
      { ...validUser, display: "x", greet: "x" },
    ],
    [
      "UserDto",
      "Object.prototype names",
      { ...validUser, toString: "x", hasOwnProperty: 1 },
    ],
    ["UserDto", "a constructor key", { ...validUser, constructor: "x" }],
    [
      "UserDto",
      "$tokens in values",
      { ...validUser, email: "$property $target $value" },
    ],
    [
      "UserDto",
      "null fields",
      { ...validUser, age: null, name: null, slug: null },
    ],
    [
      "UserDto",
      "astral characters count once",
      { ...validUser, name: "😀".repeat(10) },
    ],
    [
      "UserDto",
      "nested plain values are copied",
      {
        ...validUser,
        note: { a: [1, { b: 2 }], toString: "skipped" },
        meta: { x: { y: [] } },
      },
    ],
    ["QueryDto", "defaults", {}],
    [
      "QueryDto",
      "query strings",
      { page: "2", sort: "NAME", active: "false", q: 5 },
    ],
    [
      "QueryDto",
      "bad query strings",
      { page: "abc", sort: "age", active: "", evil: "1" },
    ],
    ["QueryDto", "a zero page", { page: "0" }],
    ["ChildDto", "an overridden rule (valid)", { code: 7 }],
    ["ChildDto", "an overridden rule (invalid)", { code: "abcd", label: 3 }],
    ["AddressDto", "a nested class on its own", { city: "D" }],
  ];

  it.each(cases)("%s: %s", async (name, _label, payload) => {
    await expectParity(name, payload);
  });

  it("matches for a __proto__ key from JSON.parse", async () => {
    await expectParity(
      "UserDto",
      JSON.parse(
        "{\"name\":\"Ada\",\"email\":\"a@b.co\",\"slug\":\"a\",\"__proto__\":{\"x\":1}}",
      ),
    );
  });

  it("matches for a null-prototype payload (query strings)", async () => {
    const payload = Object.assign(Object.create(null), {
      page: "3",
      sort: "id",
      x: "1",
    });
    const slow = await transformAndValidate(CV.QueryDto as any, payload);
    const fast = megh.validateDto(MG.QueryDto as any, payload);
    expect(JSON.stringify(fast.errors)).toBe(JSON.stringify(slow.errors));
    expect(normalize(fast.value)).toStrictEqual(normalize(slow.value));
  });

  it("matches on 3000 random payloads", async () => {
    // Small seeded PRNG, so a failure is reproducible.
    let seed = 0x5eed;
    const rand = () =>
      (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
    const pool: unknown[] = [
      undefined,
      null,
      "",
      "a",
      "ab",
      "Ada",
      "admin",
      "user",
      "root",
      "hello-world",
      " padded ",
      "x".repeat(12),
      "ada@example.com",
      "not-an-email",
      "https://megh.dev",
      "550e8400-e29b-41d4-a716-446655440000",
      "2024-01-02",
      "12",
      "1.5",
      "true",
      "NAME",
      "😀😀",
      0,
      1,
      -1,
      1.5,
      1.234,
      151,
      true,
      false,
      [],
      ["ab"],
      ["a", "bc"],
      ["ab", "cd", "ef", "gh"],
      [1, 2],
      ["a", "b"],
      [{ name: "ab" }],
      [{ name: "x" }, "s"],
      {},
      { city: "Dhaka" },
      { city: 1, zip: "12" },
      { city: "Dh", extra: 1 },
      { nested: { deep: [1] } },
      [[{ name: "abc" }]],
    ];
    const fields: Record<DtoName, string[]> = {
      UserDto: [
        "name",
        "version",
        "email",
        "age",
        "score",
        "ratio",
        "active",
        "role",
        "tags",
        "address",
        "items",
        "adminCode",
        "note",
        "slug",
        "website",
        "id",
        "login",
        "nickname",
        "meta",
        "level",
        "debt",
        "birthday",
        "trimmed",
        "letters",
        "extra",
      ],
      QueryDto: ["page", "sort", "active", "q", "extra"],
      ChildDto: ["code", "label", "extra"],
      ParentDto: ["code", "label"],
      AddressDto: ["city", "zip", "extra"],
      TagDto: ["name"],
      BaseDto: ["name", "version"],
    };
    const names = Object.keys(fields) as DtoName[];
    for (let i = 0; i < 3000; i++) {
      const name = pick(names);
      const payload: Record<string, unknown> = {};
      for (const field of fields[name]) {
        if (rand() < 0.35) continue;
        const value = pick(pool);
        if (value !== undefined) payload[field] = value;
      }
      await expectParity(name, payload);
    }
  });

  it("documents a Megh DTO like the class-validator one (OpenAPI)", () => {
    for (const name of ["UserDto", "QueryDto", "ChildDto"] as DtoName[]) {
      expect(generateClassSchema(MG[name], { inline: true })).toStrictEqual(
        generateClassSchema(CV[name], { inline: true }),
      );
    }
  });

  it("is detected as a validator class", () => {
    expect(megh.isMeghValidatorClass(MG.UserDto)).toBe(true);
    expect(megh.isMeghValidatorClass(CV.UserDto)).toBe(false);
    expect(megh.isMeghValidatorClass(class {})).toBe(false);
  });
});

// ─── HTTP ───────────────────────────────────────────────────────────────────

@ApiController("/cv")
class CvController {
  @Post("/users") create(@Body({ type: CV.UserDto } as any) body: any) {
    return normalize(body);
  }
  @Get("/list") list(@Query({ type: CV.QueryDto } as any) query: any) {
    return normalize(query);
  }
}

function meghController() {
  @ApiController("/megh")
  class MeghController {
    @Post("/users") create(@Body({ type: MG.UserDto } as any) body: any) {
      return normalize(body);
    }
    @Get("/list") list(@Query({ type: MG.QueryDto } as any) query: any) {
      return normalize(query);
    }
  }
  return MeghController;
}

async function boot(controllers: any[]) {
  const app = MeghApplication.getInternalApp();
  app.useControllers(controllers);
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

describe("Megh DTOs over HTTP", () => {
  let app: MeghApplication;

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    app = await boot([CvController, meghController()]);
  });

  afterAll(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const requests: [string, any][] = [
    ["valid body", { method: "POST", url: "/users", payload: validUser }],
    [
      "invalid body",
      {
        method: "POST",
        url: "/users",
        payload: {
          name: 1,
          email: "x",
          slug: "A B",
          tags: ["a"],
          address: { city: 2 },
        },
      },
    ],
    [
      "unknown property",
      {
        method: "POST",
        url: "/users",
        payload: { ...validUser, isAdmin: true },
      },
    ],
    ["array body", { method: "POST", url: "/users", payload: [validUser] }],
    ["query with defaults", { method: "GET", url: "/list" }],
    [
      "query conversion",
      { method: "GET", url: "/list?page=4&sort=NAME&active=1" },
    ],
    ["bad query", { method: "GET", url: "/list?page=x&evil=1" }],
  ];

  it.each(requests)(
    "answers %s like the class-validator DTO",
    async (_label, request) => {
      const viaCv = await app.inject({
        ...request,
        url: "/cv" + request.url,
      });
      const viaMegh = await app.inject({
        ...request,
        url: "/megh" + request.url,
      });
      expect(viaMegh.statusCode).toBe(viaCv.statusCode);
      expect(viaMegh.json()).toStrictEqual(viaCv.json());
    },
  );

  it("refuses a DTO that mixes Megh and class-validator decorators", async () => {
    class MixedDto {
      @megh.IsString() name!: string;
      @classValidator.IsInt() age!: number;
    }
    @ApiController("/mixed")
    class MixedController {
      @Post() create(@Body({ type: MixedDto } as any) body: any) {
        return body;
      }
    }
    const mixed = MeghApplication.getInternalApp();
    mixed.useControllers([MixedController]);
    await expect(mixed.run(0)).rejects.toThrow(
      /mixes @meghjs\/core validation decorators with class-validator/,
    );
    await mixed.close().catch(() => {});
  });
});
