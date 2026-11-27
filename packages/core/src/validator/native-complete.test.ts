import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as classValidator from "class-validator";
import * as classTransformer from "class-transformer";
import * as megh from "./index";
import { transformAndValidate } from "../common/utils/validation-utils";
import { generateClassSchema } from "../openapi/swagger-schema";
import { HttpResponse } from "../http/response";
import { IsArrayNotEmpty } from "../http/validator-extend";
import { PartialType } from "../http/map-types";
import { MeghApplication } from "../core/application";
import { ApiController } from "../http/controller";
import { Post } from "../http/route-methods";
import { Body } from "../http/params";

/**
 * The decorators that used to need class-validator / class-transformer, on the
 * same DTOs written with either library. Class names match so `$target`
 * messages match.
 */
function defineDtos(L: any) {
  const {
    ArrayContains,
    ArrayNotContains,
    ArrayUnique,
    Contains,
    Equals,
    IsAlpha,
    IsAlphanumeric,
    IsAscii,
    IsBase64,
    IsBooleanString,
    IsCreditCard,
    IsDateString,
    IsDecimal,
    IsDivisibleBy,
    IsFQDN,
    IsHexColor,
    IsHexadecimal,
    IsIP,
    IsISO8601,
    IsInstance,
    IsJSON,
    IsJWT,
    IsLatLong,
    IsLowercase,
    IsMongoId,
    IsNotEmptyObject,
    IsNumberString,
    IsOptional,
    IsPhoneNumber,
    IsPostalCode,
    IsSemVer,
    IsString,
    IsTimeZone,
    IsUUID,
    IsUppercase,
    IsMobilePhone,
    IsStrongPassword,
    IsCurrency,
    MaxDate,
    MinDate,
    NotContains,
    NotEquals,
    IsBoolean,
    IsIn,
    ValidateNested,
    Validate,
    ValidatorConstraint,
    registerDecorator,
    Expose,
    Type,
  } = L;

  class Marker {}

  class ExtrasDto {
    @IsOptional() @ArrayUnique() unique?: any[];
    @IsOptional() @ArrayUnique((o: any) => o.id) uniqueBy?: any[];
    @IsOptional() @ArrayContains([1, 2]) has?: any[];
    @IsOptional() @ArrayNotContains(["x"]) hasNot?: any[];
    @IsOptional() @Equals("yes") yes?: string;
    @IsOptional() @NotEquals("no") notNo?: string;
    @IsOptional() @IsNotEmptyObject() obj?: object;
    @IsOptional() @IsNotEmptyObject({ nullable: false }) objNN?: object;
    @IsOptional() @IsInstance(Marker) marker?: Marker;
    @IsOptional() @MinDate(new Date("2020-01-01")) after?: Date;
    @IsOptional() @MaxDate(() => new Date("2030-01-01")) before?: Date;
    @IsOptional() @IsDivisibleBy(3) triple?: number;
    @IsOptional() @IsTimeZone() tz?: string;
    @IsOptional() @IsNumberString() numStr?: string;
    @IsOptional() @IsBooleanString() boolStr?: string;
    @IsOptional() @IsDateString() date?: string;
    @IsOptional() @IsISO8601({ strict: true }) iso?: string;
    @IsOptional() @IsAlpha() alpha?: string;
    @IsOptional() @IsAlphanumeric() alnum?: string;
    @IsOptional() @IsAscii() ascii?: string;
    @IsOptional() @IsLowercase() lower?: string;
    @IsOptional() @IsUppercase() upper?: string;
    @IsOptional() @Contains("megh") contains?: string;
    @IsOptional() @NotContains("bad") notContains?: string;
    @IsOptional() @IsJSON() json?: string;
    @IsOptional() @IsJWT() jwt?: string;
    @IsOptional() @IsHexColor() color?: string;
    @IsOptional() @IsHexadecimal() hex?: string;
    @IsOptional() @IsMongoId() mongo?: string;
    @IsOptional() @IsIP() ip?: string;
    @IsOptional() @IsIP(4) ip4?: string;
    @IsOptional() @IsBase64() b64?: string;
    @IsOptional() @IsCreditCard() card?: string;
    @IsOptional() @IsCurrency() money?: string;
    @IsOptional() @IsDecimal() dec?: string;
    @IsOptional() @IsFQDN() host?: string;
    @IsOptional() @IsLatLong() latlong?: string;
    @IsOptional() @IsPostalCode("US") zip?: string;
    @IsOptional() @IsSemVer() semver?: string;
    @IsOptional() @IsMobilePhone("en-US") mobile?: string;
    @IsOptional() @IsStrongPassword() password?: string;
    @IsOptional() @IsPhoneNumber("BD") phone?: string;
    @IsOptional() @IsUUID() uuid?: string;
    @IsOptional() @IsUUID(4) uuid4?: string;
    @IsOptional() @IsUUID("7") uuid7?: string;
    @IsOptional()
    @IsString({ each: true })
    @Contains("a", { each: true })
    eachContains?: string[];
  }

  // ── Custom validators ────────────────────────────────────────────────────

  @ValidatorConstraint({ name: "isSlug" })
  class IsSlugConstraint {
    validate(value: any) {
      return typeof value === "string" && /^[a-z0-9-]+$/.test(value);
    }
    defaultMessage(args: any) {
      return `${args.property} must be a slug ($value)`;
    }
  }

  @ValidatorConstraint()
  class LongerThan {
    validate(value: any, args: any) {
      const [field] = args.constraints;
      return (
        typeof value === "string" &&
        value.length > String(args.object[field] ?? "").length
      );
    }
    defaultMessage(args: any) {
      return `$property must be longer than ${args.constraints[0]} on ${args.targetName}`;
    }
  }

  @ValidatorConstraint({ name: "noMessage" })
  class NoMessage {
    validate(value: any) {
      return value !== "bad";
    }
  }

  @ValidatorConstraint({ name: "isFree", async: true })
  class IsFree {
    async validate(value: any) {
      await new Promise((r) => setTimeout(r, 1));
      return value !== "taken";
    }
    defaultMessage() {
      return "$property is taken";
    }
  }

  function IsEven(options?: any) {
    return (object: object, propertyName: string) =>
      registerDecorator({
        name: "isEven",
        target: object.constructor,
        propertyName,
        options,
        validator: {
          validate: (v: any) => typeof v === "number" && v % 2 === 0,
          defaultMessage: (args: any) => `${args.property} must be even`,
        },
      });
  }

  function IsEvenAsync(options?: any) {
    return (object: object, propertyName: string) =>
      registerDecorator({
        name: "isEvenAsync",
        target: object.constructor,
        propertyName,
        options,
        async: true,
        validator: {
          validate: async (v: any) => typeof v === "number" && v % 2 === 0,
        },
      });
  }

  class CustomDto {
    @Validate(IsSlugConstraint) slug!: string;
    @IsOptional() @IsString() title?: string;
    @IsOptional() @Validate(LongerThan, ["title"]) body?: string;
    @IsOptional() @Validate(NoMessage) plain?: string;
    @IsOptional() @IsEven() even?: number;
    @IsOptional()
    @IsEven({ each: true, message: "all even please" })
    evens?: number[];
    @IsOptional() @Validate(IsSlugConstraint, { each: true }) slugs?: string[];
  }

  class AsyncDto {
    @IsOptional() @Validate(IsFree) first?: string;
    @IsOptional() @IsString() middle?: string;
    @IsOptional() @IsString() @Validate(IsFree) last?: string;
    @IsOptional() @IsEvenAsync({ each: true }) numbers?: number[];
  }

  // ── Expose and discriminators in request DTOs ─────────────────────────────

  class RenamedDto {
    @Expose({ name: "first_name" }) @IsString() firstName!: string;
    @IsOptional() @IsString() lastName?: string;
  }

  class CatDto {
    @IsString() name!: string;
  }
  class DogDto {
    @IsString() name!: string;
    @IsBoolean() goodBoy!: boolean;
  }
  class KeptDto {
    @IsIn(["kept"]) kind!: string;
    @IsString() name!: string;
  }
  const subTypes = [
    { name: "cat", value: CatDto },
    { name: "dog", value: DogDto },
  ];
  class PetDto {
    @ValidateNested()
    @Type(() => Object, { discriminator: { property: "kind", subTypes } })
    pet!: CatDto | DogDto;

    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => Object, { discriminator: { property: "kind", subTypes } })
    pets?: (CatDto | DogDto)[];

    @IsOptional()
    @ValidateNested()
    @Type(() => Object, {
      discriminator: {
        property: "kind",
        subTypes: [{ name: "kept", value: KeptDto }],
      },
      keepDiscriminatorProperty: true,
    })
    kept?: KeptDto;
  }

  return { ExtrasDto, CustomDto, AsyncDto, RenamedDto, PetDto, Marker };
}

const CV = defineDtos({ ...classValidator, ...classTransformer });
const MG = defineDtos(megh);
type DtoName = Exclude<keyof typeof CV, "Marker">;

function normalize(v: any): any {
  if (v instanceof Date)
    return { $date: isNaN(v.getTime()) ? "Invalid" : v.toISOString() };
  if (Array.isArray(v)) return v.map(normalize);
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

/** `payload` may hold `Marker` instances, built per library. */
async function expectParity(name: DtoName, payload: (L: any) => unknown) {
  const slow = await transformAndValidate(CV[name] as any, payload(CV));
  const fast = await megh.validateDtoAsync(MG[name] as any, payload(MG));
  expect(JSON.stringify(fast.errors)).toBe(JSON.stringify(slow.errors));
  expect(normalize(fast.value)).toStrictEqual(normalize(slow.value));
  return fast;
}

describe("new decorators: same results as class-validator", () => {
  const valid = {
    unique: [1, 2, 3],
    uniqueBy: [{ id: 1 }, { id: 2 }, null],
    has: [1, 2, 3],
    hasNot: ["y"],
    yes: "yes",
    notNo: "maybe",
    obj: { a: 1 },
    objNN: { a: 1 },
    triple: 9,
    tz: "Asia/Dhaka",
    numStr: "-12.5",
    boolStr: "true",
    date: "2024-01-02T03:04:05Z",
    iso: "2024-01-02",
    alpha: "Megh",
    alnum: "Megh07",
    ascii: "plain text",
    lower: "megh",
    upper: "MEGH",
    contains: "i like megh",
    notContains: "all good",
    json: "{\"a\":[1]}",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
    color: "#ff00aa",
    hex: "deadBEEF",
    mongo: "507f1f77bcf86cd799439011",
    ip: "::1",
    ip4: "10.0.0.1",
    b64: "bWVnaA==",
    card: "4111111111111111",
    money: "$1,000.00",
    dec: "3.14",
    host: "megh.dev",
    latlong: "23.8,90.4",
    zip: "94105",
    semver: "1.2.3-beta.1",
    mobile: "+12025550123",
    password: "Str0ng!Pass",
    phone: "+8801712345678",
    uuid: "550e8400-e29b-41d4-a716-446655440000",
    uuid4: "550e8400-e29b-41d4-a716-446655440000",
    uuid7: "01890a5d-ac96-774b-bcce-b302099a8057",
    eachContains: ["ab", "ca"],
  };
  const invalid = {
    unique: [1, 1],
    uniqueBy: [{ id: 1 }, { id: 1 }],
    has: [1],
    hasNot: ["x"],
    yes: "no",
    notNo: "no",
    obj: {},
    objNN: { a: null },
    triple: 10,
    tz: "Mars/Olympus",
    numStr: "12a",
    boolStr: "yes",
    date: "yesterday",
    iso: "2024-02-30",
    alpha: "Megh1",
    alnum: "Megh!",
    ascii: "ভাষা",
    lower: "Megh",
    upper: "Megh",
    contains: "nothing",
    notContains: "so bad",
    json: "{a}",
    jwt: "nope",
    color: "#ggg",
    hex: "xyz",
    mongo: "123",
    ip: "300.1.1.1",
    ip4: "::1",
    b64: "%%%",
    card: "1234",
    money: "1.2.3",
    dec: "pi",
    host: "-bad-",
    latlong: "200,200",
    zip: "ABCDE",
    semver: "1.2",
    mobile: "12",
    password: "weak",
    phone: "+12025550123",
    uuid: "123",
    uuid4: "01890a5d-ac96-774b-bcce-b302099a8057",
    uuid7: "550e8400-e29b-41d4-a716-446655440000",
    eachContains: ["ab", "zz"],
  };
  const wrongTypes = Object.fromEntries(Object.keys(valid).map((k) => [k, 12]));

  it("accepts valid values", async () => {
    const result = await expectParity("ExtrasDto", (L) => ({
      ...valid,
      marker: new L.Marker(),
      after: new Date("2024-01-01"),
      before: new Date("2024-01-01"),
    }));
    expect(result.errors).toBeNull();
  });

  it("rejects invalid values", async () => {
    const result = await expectParity("ExtrasDto", () => ({
      ...invalid,
      marker: {},
      after: new Date("2010-01-01"),
      before: new Date("2040-01-01"),
    }));
    expect(result.errors!.length).toBe(Object.keys(invalid).length + 3);
  });

  it("rejects wrong types", async () => {
    await expectParity("ExtrasDto", () => ({
      ...wrongTypes,
      marker: 1,
      after: "2024-01-01",
      before: 1,
    }));
  });

  it("checks NaN in ArrayUnique like class-validator", async () => {
    await expectParity("ExtrasDto", () => ({ unique: [NaN] }));
  });
});

describe("custom validators: same results as class-validator", () => {
  it("passes valid values", async () => {
    const r = await expectParity("CustomDto", () => ({
      slug: "my-post",
      title: "Hi",
      body: "Hello",
      plain: "fine",
      even: 2,
      evens: [2, 4],
      slugs: ["a", "b-c"],
    }));
    expect(r.errors).toBeNull();
  });

  it("reports names, class-name keys, constraints, args and messages", async () => {
    const r = await expectParity("CustomDto", () => ({
      slug: "Not A Slug",
      title: "Long title",
      body: "Hi",
      plain: "bad",
      even: 3,
      evens: [2, 3],
      slugs: ["ok", "NOT OK"],
    }));
    expect(r.errors).toEqual([
      {
        path: "slug",
        constraints: { isSlug: "slug must be a slug (Not A Slug)" },
      },
      {
        path: "body",
        constraints: {
          LongerThan: "body must be longer than title on CustomDto",
        },
      },
      { path: "plain", constraints: { noMessage: "" } },
      { path: "even", constraints: { isEven: "even must be even" } },
      { path: "evens", constraints: { isEven: "all even please" } },
      {
        path: "slugs",
        // class-validator leaves $value as is for arrays.
        constraints: { isSlug: "slugs must be a slug ($value)" },
      },
    ]);
  });

  it("waits for async validators and keeps property order", async () => {
    const r = await expectParity("AsyncDto", () => ({
      first: "taken",
      middle: 1,
      last: 2,
      numbers: [2, 3],
    }));
    expect(r.errors!.map((e) => e.path)).toEqual([
      "first",
      "middle",
      "last",
      "numbers",
    ]);
  });

  it("passes async validators", async () => {
    const r = await expectParity("AsyncDto", () => ({
      first: "free",
      last: "free",
      numbers: [2, 4],
    }));
    expect(r.errors).toBeNull();
  });

  it("makes validateDto throw for async DTOs", () => {
    expect(() => megh.validateDto(MG.AsyncDto as any, { first: "x" })).toThrow(
      /async validators; use validateDtoAsync/,
    );
  });

  it("keeps validateDto synchronous when no async validator runs", () => {
    const r = megh.validateDto(MG.CustomDto as any, { slug: "ok" });
    expect(r.errors).toBeNull();
  });

  it("supports ValidateBy and buildMessage", () => {
    const IsTen = (options?: any) =>
      megh.ValidateBy(
        {
          name: "isTen",
          validator: {
            validate: (v: any) => v === 10,
            defaultMessage: megh.buildMessage(
              (each) => each + "$property must be ten",
              options,
            ),
          },
        },
        options,
      );
    class TenDto {
      @IsTen() one!: number;
      @IsTen({ each: true }) many!: number[];
    }
    const { errors } = megh.validateDto(TenDto, { one: 1, many: [10, 1] });
    expect(errors).toEqual([
      { path: "one", constraints: { isTen: "one must be ten" } },
      {
        path: "many",
        constraints: { isTen: "each value in many must be ten" },
      },
    ]);
  });
});

describe("custom validator arguments", () => {
  it("passes the whole array as args.value with each, as class-validator", async () => {
    function argsOf(L: any) {
      const seen: any[] = [];
      @L.ValidatorConstraint({ name: "spy" })
      class Spy {
        validate(_v: any, args: any) {
          seen.push(args.value);
          return true;
        }
      }
      class SpyDto {
        @L.Validate(Spy, { each: true }) list!: number[];
      }
      return { SpyDto, seen };
    }
    const cv = argsOf({ ...classValidator, ...classTransformer });
    const mg = argsOf(megh);
    await transformAndValidate(cv.SpyDto as any, { list: [1, 2] });
    await megh.validateDtoAsync(mg.SpyDto as any, { list: [1, 2] });
    expect(mg.seen).toStrictEqual(cv.seen);
  });
});

describe("@Expose and @Type discriminators in request DTOs", () => {
  it("reads a property from its exposed name", async () => {
    const r = await expectParity("RenamedDto", () => ({
      first_name: "Ada",
      lastName: "Lovelace",
    }));
    expect(r.errors).toBeNull();
    expect((r.value as any).firstName).toBe("Ada");
  });

  it("validates a missing exposed property", async () => {
    await expectParity("RenamedDto", () => ({ firstName: "Ada" }));
  });

  it("documents the exposed name in OpenAPI", () => {
    const schema = generateClassSchema(MG.RenamedDto);
    expect(Object.keys(schema.properties)).toEqual(["first_name", "lastName"]);
    expect(schema.required ?? []).not.toContain("firstName");
  });

  const pets: [string, unknown][] = [
    ["a cat", { pet: { kind: "cat", name: "Tom" } }],
    ["a dog", { pet: { kind: "dog", name: "Rex", goodBoy: true } }],
    ["a bad dog", { pet: { kind: "dog", name: "Rex", goodBoy: "yes" } }],
    ["an unknown kind", { pet: { kind: "fish", name: "Nemo" } }],
    ["no kind", { pet: { name: "Tom" } }],
    [
      "an array",
      {
        pet: { kind: "cat", name: "Tom" },
        pets: [
          { kind: "dog", name: "Rex", goodBoy: false },
          { kind: "cat", name: 1 },
          { kind: "dog", name: "Fido" },
        ],
      },
    ],
    [
      "a kept discriminator",
      { pet: { kind: "cat", name: "Tom" }, kept: { kind: "kept", name: "K" } },
    ],
  ];
  it.each(pets)("picks the class for %s", async (_label, payload) => {
    await expectParity("PetDto", () => structuredClone(payload));
  });
});

describe("plainToInstance / instanceToPlain: same results as class-transformer", () => {
  function defineViews(L: any) {
    const { Expose, Exclude, Type, Transform } = L;

    class AuthorView {
      @Expose() name!: string;
      email!: string;
    }

    class BaseView {
      @Expose() id!: number;
      @Exclude({ toPlainOnly: true }) @Expose() internal?: string;
    }

    class PostView extends BaseView {
      @Expose({ name: "post_title" }) title!: string;
      @Expose() @Type(() => AuthorView) author!: AuthorView;
      @Expose() @Type(() => AuthorView) editors!: AuthorView[];
      @Expose() createdAt!: Date;
      @Expose() views!: number;
      @Expose()
      @Transform(({ value }) => String(value).toUpperCase(), {
        toPlainOnly: true,
      })
      status!: string;
      @Expose({ groups: ["admin"] }) secret?: string;
      @Expose() get summary() {
        return `${(this as any).title}!`;
      }
    }

    @Exclude()
    class Account {
      @Expose() id!: number;
      password!: string;
    }

    class Shape {
      kind!: string;
    }
    class Circle extends Shape {
      radius!: number;
    }
    class Square extends Shape {
      side!: number;
    }
    class Drawing {
      @Type(() => Shape, {
        discriminator: {
          property: "kind",
          subTypes: [
            { name: "circle", value: Circle },
            { name: "square", value: Square },
          ],
        },
      })
      shapes!: Shape[];
    }

    return { PostView, Account, Drawing, Circle, Square };
  }

  const CTV = defineViews(classTransformer);
  const MGV = defineViews(megh);

  const post = () => ({
    id: "7",
    internal: "x",
    post_title: "Hello",
    title: "ignored",
    author: { name: "Ada", email: "ada@example.com" },
    editors: [{ name: "Bob", email: "b@example.com" }],
    createdAt: "2024-01-02T00:00:00.000Z",
    views: "12",
    status: "draft",
    secret: "s",
    extra: true,
  });

  const optionsList = [
    undefined,
    { excludeExtraneousValues: true },
    { excludeExtraneousValues: true, enableImplicitConversion: true },
    { enableImplicitConversion: true, exposeUnsetFields: false },
  ];

  it.each(optionsList.map((o) => [JSON.stringify(o), o]))(
    "converts a response class with options %s",
    (_label, options: any) => {
      const fromCt = classTransformer.instanceToPlain(
        classTransformer.plainToInstance(CTV.PostView, post(), options),
      );
      const fromMegh = megh.instanceToPlain(
        megh.plainToInstance(MGV.PostView, post(), options),
      );
      expect(fromMegh).toStrictEqual(fromCt);
    },
  );

  it("converts arrays and class-level @Exclude", () => {
    const rows = [
      { id: 1, password: "p" },
      { id: 2, password: "q" },
    ];
    expect(
      megh.instanceToPlain(megh.plainToInstance(MGV.Account, rows)),
    ).toStrictEqual(
      classTransformer.instanceToPlain(
        classTransformer.plainToInstance(CTV.Account, rows),
      ),
    );
  });

  it("round-trips discriminated arrays", () => {
    const plain = () => ({
      shapes: [
        { kind: "circle", radius: 1 },
        { kind: "square", side: 2 },
      ],
    });
    const viaCt = classTransformer.plainToInstance(CTV.Drawing, plain());
    const viaMegh = megh.plainToInstance(MGV.Drawing, plain());
    expect(normalize(viaMegh)).toStrictEqual(normalize(viaCt));
    expect(megh.instanceToPlain(viaMegh)).toStrictEqual(
      classTransformer.instanceToPlain(viaCt),
    );
  });

  it("shapes HttpResponse.Ok and Created with Megh's decorators", () => {
    const ok = HttpResponse.Ok(post(), MGV.PostView);
    expect(ok.data).toStrictEqual(
      classTransformer.instanceToPlain(
        classTransformer.plainToInstance(CTV.PostView, post(), {
          enableImplicitConversion: true,
          excludeExtraneousValues: true,
        }),
      ),
    );
    const page = HttpResponse.Ok(
      { data: [post()], total: 1 },
      MGV.PostView,
    ) as any;
    expect(page.total).toBe(1);
    expect(page.data[0].post_title).toBe("Hello");
    expect(HttpResponse.Created(post(), MGV.PostView).data).toStrictEqual(
      ok.data,
    );
  });

  it("keeps class-transformer for classes that only use its decorators", () => {
    expect(HttpResponse.Ok(post(), CTV.PostView).data).toStrictEqual(
      HttpResponse.Ok(post(), MGV.PostView).data,
    );
  });

  it("carries @Expose and @Exclude through PartialType", () => {
    class Source {
      @megh.Expose({ name: "full_name" }) @megh.IsString() name!: string;
      @megh.Exclude() @megh.IsOptional() hidden?: string;
    }
    class Derived extends PartialType(Source) {}
    const out = megh.instanceToPlain(
      megh.plainToInstance(Derived, { full_name: "Ada", hidden: "x" }),
    );
    expect(out).toStrictEqual({ full_name: "Ada" });
  });
});

describe("IsArrayNotEmpty", () => {
  it("is a Megh decorator with its own key and message", () => {
    class OrderDto {
      @IsArrayNotEmpty() items!: number[];
      @IsArrayNotEmpty({ message: "need tags" }) tags!: string[];
    }
    expect(megh.isMeghValidatorClass(OrderDto)).toBe(true);
    const { errors } = megh.validateDto(OrderDto, { items: [], tags: "x" });
    expect(errors).toEqual([
      {
        path: "items",
        constraints: {
          isArrayWithAtLeastOneElement: "items must contain at least one item.",
        },
      },
      {
        path: "tags",
        constraints: { isArrayWithAtLeastOneElement: "need tags" },
      },
    ]);
  });
});

describe("async validators over HTTP", () => {
  let app: MeghApplication;

  @megh.ValidatorConstraint({ name: "isFree", async: true })
  class IsFree {
    async validate(value: any) {
      return value !== "taken";
    }
    defaultMessage() {
      return "$property is taken";
    }
  }

  class SignupDto {
    @megh.IsString() @megh.Validate(IsFree) username!: string;
  }

  @ApiController("/signup")
  class SignupController {
    @Post() create(@Body({ type: SignupDto } as any) body: SignupDto) {
      return { username: body.username };
    }
  }

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    app = MeghApplication.getInternalApp();
    app.useControllers([SignupController]);
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
    vi.restoreAllMocks();
  });

  it("rejects a taken name with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/signup",
      payload: { username: "taken" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([
      { path: "username", constraints: { isFree: "username is taken" } },
    ]);
  });

  it("accepts a free name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/signup",
      payload: { username: "free" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ username: "free" });
  });
});
