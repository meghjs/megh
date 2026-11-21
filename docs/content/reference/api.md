---
title: API Reference
description: Every public export of @meghjs/core, grouped by area, with signatures for the application methods and decorators.
outline: [2, 3]
---

# API Reference

This page lists the public exports of `@meghjs/core`, grouped by area. Each
group links to the guide that explains it in depth. Everything here is
imported from the package root:

```ts
import { Megh, ApiController, Get, Results } from "@meghjs/core";
```

The command-line tool, `@meghjs/cli`, is documented separately under
[CLI](/cli/basic).

Signatures are shown as TypeScript. Optional parameters end in `?`, and
`Constructor<T>` means a class that builds a `T`.

## Application

Guides: [Usage](/getting-started/usage), [Application](/getting-started/application).

### Creating an application

| Export | Kind | Description |
| --- | --- | --- |
| `Megh` | class | Entry point. `Megh.createApplication(options?)` returns the application; `Megh.createTestApplication(options)` returns a test client. |
| `MeghApplication` | class | The application object returned by `Megh.createApplication()`. Its methods are listed below. |

```ts
Megh.createApplication(options?: MeghApplicationOptions): MeghApplication
Megh.createTestApplication(options: TestAppOptions): TestApplication
```

`Megh.createApplication()` returns the same instance every time it's called in
a process.

`MeghApplicationOptions` fields:

| Option | Type | Description |
| --- | --- | --- |
| `server` | `FastifyServerOptions` | Options passed to the Fastify instance. |
| `requestId` | `RequestIdOptions` | Request ID header and generator, or `false` to turn request IDs off. |
| `experimental` | `ExperimentalOptions` | `{ compiledValidation?: boolean }`. Defaults to the `MEGH_COMPILED_VALIDATION` environment variable. |
| `plugins` | `MeghPlugin[]` | Plugins to register explicitly. |
| `autoloadPlugins` | `boolean` | Find plugins among the app's dependencies. Defaults to `true`. |

### MeghApplication methods

Every `use*`, `on*` and `addHealthCheck` method returns the application, so
calls chain.

#### Features

| Method | Description |
| --- | --- |
| `useControllers(controllers: Constructor[] \| { auto: true; path?: string })` | Register controller classes, or scan a directory for them. |
| `useCors(options: CorsOptions)` | Enable CORS through `@fastify/cors`. |
| `useSecurityHeaders(options?: SecurityHeadersOptions)` | Send CSP, HSTS, `X-Frame-Options`, `nosniff` and other security headers on every response. Throws if called twice. See [Security](/production/security#add-security-headers). |
| `useRateLimit(options?: RateLimitOptions)` | Limit requests per client per window (default 100 a minute per IP, in memory) and answer 429 over it. Throws if called twice. See [Security](/production/security#add-rate-limits). |
| `useMultipart(options?: any)` | Enable multipart bodies through `@fastify/multipart`. Defaults: `attachFieldsToBody: true`, 10 MB file size limit. |
| `useStaticFiles(options?: any)` | Serve static files through `@fastify/static`. |
| `useCompression(options?: CompressionOptions)` | Compress responses through `@fastify/compress`. |
| `setGlobalPrefix(prefix: string, options?: { exclude?: (string \| RegExp)[] })` | Serve controller and inline routes under `prefix`. |
| `useVersioning(options: VersioningOptions)` | Version controller routes by URI (`/v1/...`) or header. |
| `useEnvSchema(schema: Constructor)` | Validate environment variables against a DTO class at boot. |
| `useOpenApi(options?: OpenApiUiOptions \| Constructor<MeghConfig<OpenApiUiOptions>>)` | Generate the OpenAPI document and serve the docs page. |
| `useMiddlewares(middlewares: Constructor<MeghMiddleware>[])` | Register global middleware, run before every route. |
| `useAuthentication(authentication: Constructor<MeghAuthentication>)` | Register the authentication handler that sets `request.user`. |
| `useAuthorization(authorization: Constructor<any> \| Record<string, Constructor<any>>)` | Register one authorization handler, or several by name. |
| `useExceptionFilters(filters: ExceptionFilterLike \| ExceptionFilterLike[])` | Register global exception filters, run in order before the default error response. |
| `useErrorHandler(handler: ErrorHandlerFunction)` | Register a function filter that sees every error. |
| `useErrorLogger(logger: ErrorLogger \| false)` | Replace how default error responses are logged, or turn logging off. |
| `useHealth(options?: HealthOptions)` | Serve `GET /health` (liveness) and `GET /ready` (readiness). |
| `addHealthCheck(name: string, check: HealthCheck)` | Add a readiness check reported by `GET /ready`. |
| `useCache(options?: CacheOptions)` | Configure `CacheManager` and register it in the container. |
| `useScheduler(tasks: Constructor[] \| { path: string })` | Register `@ScheduledTask` classes, or scan a directory for them. |
| `useWorker(workers: Constructor<any>[])` | Resolve and start `@Queue` and `@MeghWorker` classes. They close on shutdown. |
| `useMail(options?: MailConfig \| Constructor<MeghConfig<MailConfig>>)` | Configure `Mailer` over `MEGH_MAIL_*`, and start the mail queue's worker when `queue` is set. Throws when the default mailer is misconfigured. See [Mail](/advanced/mail). |
| `useSocketIo(options?: any)` | Enable Socket.IO through `fastify-socket.io`. |
| `useGlobal(options: GlobalOptions)` | Call several `use*` methods from one object (`cors`, `openApi`, `controllers`, `middlewares`, `authorization`, `multipart`, `staticFiles`, `securityHeaders`, `rateLimit`). |
| `useMeghORM(options?: DatabaseOptions \| MeghConfigClass<DatabaseOptions>)` | Connect Megh ORM. Added by the built-in ORM plugin. See [ORM](/advanced/orm). |
| `useDatabase(db: Kysely<any>)` | Deprecated. Use an existing Kysely instance as the ORM connection. Use `useMeghORM()` instead. |

#### Functional routes

| Method | Description |
| --- | --- |
| `mapGet(path: string, fn)` | Register a `GET` route handled by a function. |
| `mapPost(path: string, fn)` | Register a `POST` route handled by a function. |
| `mapPut(path: string, fn)` | Register a `PUT` route handled by a function. |
| `mapPatch(path: string, fn)` | Register a `PATCH` route handled by a function. |
| `mapDelete(path: string, fn)` | Register a `DELETE` route handled by a function. |

Each `map*` method returns a route builder with three chainable methods:
`useMiddleware(middleware | middleware[])`, `authorized(options?: string | { name?: string })`
and `useOpenApi(options: OpenApiOptions)`.

#### Lifecycle

| Method | Description |
| --- | --- |
| `run(port?: number, options?: RunOptions \| CallableFunction): Promise<void>` | Start the server. `port` defaults to `4000`. A function as the second argument is called once the server is listening. |
| `close(): Promise<void>` | Stop the server, scheduled tasks and workers, then run the `onClose` hooks. Calling it again returns the same promise. |
| `onInit(hook: LifecycleHook)` | Run `hook` during `run()`, after the database connects and before the server listens. |
| `onReady(hook: LifecycleHook)` | Run `hook` once the server is listening. |
| `onClose(hook: LifecycleHook)` | Run `hook` on shutdown (`close()`, SIGTERM or SIGINT), in reverse registration order. |

`RunOptions`:

| Option | Type | Description |
| --- | --- | --- |
| `host` | `string` | Interface to listen on. Defaults to `process.env.HOST`, else `0.0.0.0`. |
| `onListen` | `CallableFunction` | Called once the server is listening. |
| `shutdownTimeout` | `number` | Milliseconds to wait for a graceful shutdown before exiting with code 1. Defaults to `10000`. |

#### Other members

| Member | Description |
| --- | --- |
| `app: FastifyInstance` | The underlying Fastify instance. |
| `getPlugins(): readonly string[]` | Names of the registered plugins, in registration order. |
| `isDevelopment(): boolean` | `true` only when `NODE_ENV` is exactly `"development"`. |
| `installErrorHandling()` | Internal. Installs the error and not-found handlers. `run()` calls it. |
| `MeghApplication.getApp(options?)` | Static. Returns the shared instance, creating it on first call. Options passed to later calls are ignored, with a warning. `Megh.createApplication()` calls it. |
| `MeghApplication.getInternalApp(options?)` | Static, deprecated, internal. Creates a new, unshared instance. |

### Application types

| Export | Kind | Description |
| --- | --- | --- |
| `MeghApplicationOptions` | type | Options for `Megh.createApplication()`. |
| `IMeghApplication` | interface | The core method set of `MeghApplication`. |
| `RunOptions` | type | Options for `app.run()`. |
| `LifecycleHook` | type | `() => void \| Promise<void>`. |
| `ExperimentalOptions` | type | `{ compiledValidation?: boolean }`. |
| `CorsOptions` | type | Options for `useCors()`. |
| `GlobalOptions` | type | Options for `useGlobal()`. |
| `AutoControllerOptions` | type | `{ auto: true; path?: string }` for `useControllers()`. |
| `CacheOptions` | type | `{ provider: "memory" \| "redis"; redisOptions?: RedisOptions }` for `useCache()`. |

## Controllers and routing

Guide: [Controllers](/core-concept/controller).

### Decorators

| Export | Kind | Signature | Description |
| --- | --- | --- | --- |
| `ApiController` | decorator | `@ApiController`, `@ApiController(path: string, options?: ControllerOptions)`, `@ApiController(options: ControllerOptions)` | Mark a class as a controller and register it for DI. Path defaults to `/`. |
| `Get` | decorator | `@Get(pathOrOptions?: string \| RouteMethodOptions, options?: RouteMethodOptions)` | Handle `GET` requests. Path defaults to `/`. |
| `Post` | decorator | same as `Get` | Handle `POST` requests. |
| `Put` | decorator | same as `Get` | Handle `PUT` requests. |
| `Patch` | decorator | same as `Get` | Handle `PATCH` requests. |
| `Delete` | decorator | same as `Get` | Handle `DELETE` requests. |
| `Options` | decorator | same as `Get` | Handle `OPTIONS` requests. |
| `All` | decorator | same as `Get` | Handle every HTTP method Fastify supports. |
| `Route` | decorator | `@Route(method: RouteMethods, pathOrOptions?, options?)` | Generic form of the method decorators above. |
| `HttpCode` | decorator | `@HttpCode(statusCode: number)` | Status code for a successful response. A returned `Results.*` or `HttpResponse.*` status wins. Throws for codes outside 100–599. |
| `Redirect` | decorator | `@Redirect(url: string, statusCode = 302)` | Redirect instead of sending the return value. Returning `{ url, statusCode }` overrides both. Throws for non-3xx codes. |
| `ResponseHeader` | decorator | `@ResponseHeader(name: string, value: string)` | Set a response header on the route. Stackable. |
| `Version` | decorator | `@Version(version: string \| string[])` | API version(s) of a controller or route, with `useVersioning()`. |
| `VersioningOptions` | type | `{ type: 'uri'; prefix?; defaultVersion? } \| { type: 'header'; header?; defaultVersion? }` | Options for `useVersioning()`. |

### Types

| Export | Kind | Description |
| --- | --- | --- |
| `ControllerOptions` | type | `{ name?: string; path?: string }`. `name` is the OpenAPI tag; it defaults to the class name without `Controller`. |
| `RouteMethodOptions` | type | `{ method?: RouteMethods; path?: string; openapi?: OpenApiOptions; name?: string }`. |
| `RouteMethods` | type | `"GET" \| "POST" \| "PUT" \| "PATCH" \| "DELETE" \| "OPTIONS" \| "ALL"`. |

## Parameters

Guide: [Controllers](/core-concept/controller).

The parameter decorators take an optional key and an optional options object,
in either order of presence:

```ts
(key?: string | ParameterOptions, options?: ParameterOptions) => ParameterDecorator
// ParameterOptions: { required?: boolean; validate?: boolean; type?: any }
```

`required` and `validate` default to `true`. `type` is only needed when the
compiler doesn't emit decorator metadata (tsx, esbuild, SWC).

| Export | Kind | Description |
| --- | --- | --- |
| `Param` | decorator | A route parameter (`@Param("id")`), or all of them with no key. |
| `Query` | decorator | A query string value, or the whole query (often a DTO) with no key. |
| `Body` | decorator | The request body, usually a DTO, or one field with a key. |
| `Header` | decorator | A request header, or all headers with no key. |
| `AuthUser` | decorator | `request.user`, as set by the authentication handler. |
| `MeghRequest` | decorator | `@MeghRequest()`. The request object itself. |
| `UploadFile` | decorator | `@UploadFile(fieldName: string)`. One uploaded file from a multipart field. |
| `UploadFiles` | decorator | `@UploadFiles(fieldName?: string)`. Uploaded files from a field, or from every field with no name. |

## Responses

Guide: [Controllers](/core-concept/controller).

### Results

| Export | Kind | Description |
| --- | --- | --- |
| `Results` | class | Static factories for route results (below). |
| `HttpResult` | abstract class | Base class for values that control status, headers and body. |
| `Ok` | class | `200 { data }`. |
| `Created` | class | `201 { data }`. |
| `NoContent` | class | `204` with an empty body. |
| `NotFound` | class | `404 { code, status, message }`. |
| `OkStream` | class | `200` with a stream body. |
| `RedirectResult` | class | A 3xx with `Location`; made by `Results.Redirect(url, statusCode?)`. |
| `OkStreamOptions` | type | `{ contentType?: string; filename?: string }`. With `filename`, the stream is sent as an attachment. |
| `RouteResult` | type | `typeof Results.Ok<T>`. |

```ts
Results.Ok<T>(data: T): Ok<T>
Results.Created<T>(data: T): Created<T>
Results.NoContent(): NoContent
Results.NotFound<T>(message: T): NotFound<T>
Results.Redirect(url: string, statusCode = 302): RedirectResult
Results.OkStream(stream: Readable, options?: OkStreamOptions): OkStream
```

### HttpResponse

| Export | Kind | Description |
| --- | --- | --- |
| `HttpResponse` | class | Static factories that return `{ message, data }` bodies. |
| `IHttpResponse` | interface | `{ message: string; data: T \| null }`. |
| `withStatus` | function | `withStatus(body, statusCode)`. Attach a status code to a plain object without changing its JSON. |
| `HTTP_STATUS_KEY` | const | Symbol `withStatus` uses to store the status. |

```ts
HttpResponse.Ok<T>(obj: any, dto?: ClassConstructor<T>): IHttpResponse<T>       // 200
HttpResponse.Created<T>(obj: any, dto?: ClassConstructor<T>): IHttpResponse<T>  // 201
HttpResponse.NoContent(): IHttpResponse<null>                                   // 204
```

With a DTO class, `Ok` and `Created` keep only the DTO's exposed fields
(class-transformer `excludeExtraneousValues`).

### Pagination and collections

| Export | Kind | Description |
| --- | --- | --- |
| `paginated` | function | `paginated(data: T[], total, page, perPage): Paginated<T>`. Wrap a page of data with its `meta`. |
| `Paginated` | function and interface | As a type, `{ data: T[]; meta: PaginationMeta }`. As a function, `Paginated(Item)` marks a page of `Item` for OpenAPI: `@ApiResponse(200, Paginated(User))`. |
| `PaginationMeta` | interface | `{ total, page, perPage, lastPage, next, prev }`. |
| `PageRequest` | interface | `{ page?, perPage? }`, plus the deprecated `limit`, `take` and `skip`. |
| `normalizePageRequest` | function | Resolve a `PageRequest` into `{ page, perPage, offset }`. |
| `buildPaginationMeta` | function | `buildPaginationMeta(total, page, perPage): PaginationMeta`. |
| `DEFAULT_PER_PAGE` | const | `10`. |
| `PAGINATED_ITEM` | const | Symbol used by `Paginated(Item)`. |
| `PaginationResult` | type | Deprecated alias of `Paginated<T>`. |
| `List` | class | Small in-memory list with async `Find` and `FindOne`. `List.from(items)`. |
| `IList` | interface | The `List` surface. |
| `Collection` | class | In-memory collection: `Collection.from(items)` with `find`, `findOne`, their async forms and `clear`. |
| `BasicCollection` | interface | The `Collection` surface. |
| `IFindOneOptions` | interface | `{ where }` argument for `Collection.findOne`. |

## Exceptions and error handling

Guide: [Error handling](/core-concept/error-handling).

### HTTP exceptions

Every exception takes `(message?: any, options?: HttpExceptionOptions)`. A
string message is sent as `message`; an object is sent as `data`.
`HttpExceptionOptions` is `{ cause?: unknown; headers?: Record<string, string | number | string[]> }`.

| Export | Kind | Status |
| --- | --- | --- |
| `BaseHttpException` | abstract class | Base class. `code`, `statusCode`, `payload`, `headers`. |
| `HttpException` | class | Any status: `new HttpException(status: number, message?, options?)`. |
| `BadRequestException` | class | 400 |
| `ValidationErrorException` | class | 400. `new ValidationErrorException(message?, errors?: unknown[], options?)`; `errors` is sent in the response. |
| `UnauthorizedException` | class | 401 |
| `ForbiddenException` | class | 403 |
| `NotFoundException` | class | 404 |
| `MethodNotAllowedException` | class | 405 |
| `NotAcceptableException` | class | 406 |
| `RequestTimeoutException` | class | 408 |
| `ConflictException` | class | 409 |
| `GoneException` | class | 410 |
| `PayloadTooLargeException` | class | 413 |
| `UnsupportedMediaTypeException` | class | 415 |
| `UnprocessableEntityException` | class | 422 |
| `TooManyRequestsException` | class | 429 |
| `InternalErrorException` | class | 500 |
| `NotImplementedException` | class | 501 |
| `BadGatewayException` | class | 502 |
| `ServiceUnavailableException` | class | 503 |
| `GatewayTimeoutException` | class | 504 |
| `HttpExceptions` | const | Factory shortcuts, such as `HttpExceptions.notFound("User not found")` and `HttpExceptions.status(402, "Payment required")`. |
| `HttpExceptionOptions` | interface | `{ cause?, headers? }`. |
| `HttpExceptionTypes` | type | Union of the not-found, bad-request, unauthorized, internal-error and forbidden exceptions. |

### Exception filters

| Export | Kind | Signature / description |
| --- | --- | --- |
| `Catch` | decorator | `@Catch(...types: ErrorClass[])`. Limit a filter class to these error classes and register it for DI. |
| `UseFilters` | decorator | `@UseFilters(...filters: ExceptionFilterLike[])`. Apply filters to a controller or route. They run before the global filters. |
| `ExceptionFilter` | interface | `{ catch(error: E, ctx: ErrorContext): unknown }`. |
| `ErrorHandlerFunction` | type | `(error: E, ctx: ErrorContext) => unknown`. |
| `ExceptionFilterLike` | type | A filter class, a filter instance or an `ErrorHandlerFunction`. |
| `ErrorContext` | interface | `{ request, reply, isDevelopment, response }`. |
| `ErrorResponse` | interface | `{ statusCode, headers?, body }`. |
| `ErrorResponseBody` | interface | The default JSON error body: `{ code, status, message, data?, errors?, error?, stack? }`. |
| `ErrorLogger` | type | `(error, request, response) => void`, for `useErrorLogger()`. |
| `ErrorHandlerOptions` | interface | `{ isDevelopment?: () => boolean; logger?: ErrorLogger \| false }`. |
| `defaultErrorResponse` | function | `defaultErrorResponse(error, isDevelopment): ErrorResponse`. The response Megh sends when no filter handles an error. |
| `defaultErrorLogger` | const | The default `ErrorLogger`: 4xx as warnings, others as errors with the stack. |
| `MeghErrorHandler` | class | Megh's request error handler. The application creates one; you don't normally construct it. |

## Validation

Guide: [Validation](/core-concept/validation).

### Validation decorators

Every decorator takes an optional last argument, `options?: ValidationOptions`
(`message`, `each`, `groups`, and so on, as in class-validator).

| Export | Kind | Signature |
| --- | --- | --- |
| `IsOptional` | decorator | `@IsOptional(options?)` |
| `ValidateIf` | decorator | `@ValidateIf(condition: (object, value) => boolean, options?)` |
| `Allow` | decorator | `@Allow(options?)` |
| `ValidateNested` | decorator | `@ValidateNested(options?)` |
| `IsDefined` | decorator | `@IsDefined(options?)` |
| `IsNotEmpty` | decorator | `@IsNotEmpty(options?)` |
| `IsEmpty` | decorator | `@IsEmpty(options?)` |
| `IsIn` | decorator | `@IsIn(values: readonly any[], options?)` |
| `IsNotIn` | decorator | `@IsNotIn(values: readonly any[], options?)` |
| `IsString` | decorator | `@IsString(options?)` |
| `IsNumber` | decorator | `@IsNumber(numberOptions?: IsNumberOptions, options?)` |
| `IsInt` | decorator | `@IsInt(options?)` |
| `IsBoolean` | decorator | `@IsBoolean(options?)` |
| `IsDate` | decorator | `@IsDate(options?)` |
| `IsArray` | decorator | `@IsArray(options?)` |
| `IsObject` | decorator | `@IsObject(options?)` |
| `IsEnum` | decorator | `@IsEnum(entity: object, options?)` |
| `Min` | decorator | `@Min(minValue: number, options?)` |
| `Max` | decorator | `@Max(maxValue: number, options?)` |
| `IsPositive` | decorator | `@IsPositive(options?)` |
| `IsNegative` | decorator | `@IsNegative(options?)` |
| `MinLength` | decorator | `@MinLength(min: number, options?)` |
| `MaxLength` | decorator | `@MaxLength(max: number, options?)` |
| `Length` | decorator | `@Length(min: number, max?: number, options?)` |
| `Matches` | decorator | `@Matches(pattern: RegExp, options?)` or `@Matches(pattern: string \| RegExp, modifiers?: string, options?)` |
| `IsEmail` | decorator | `@IsEmail(emailOptions?: object, options?)` |
| `IsUUID` | decorator | `@IsUUID(version?, options?)` |
| `IsUrl` | decorator | `@IsUrl(urlOptions?: object, options?)` |
| `ArrayMinSize` | decorator | `@ArrayMinSize(min: number, options?)` |
| `ArrayMaxSize` | decorator | `@ArrayMaxSize(max: number, options?)` |
| `ArrayNotEmpty` | decorator | `@ArrayNotEmpty(options?)` |
| `IsArrayNotEmpty` | decorator | `@IsArrayNotEmpty(validationOptions?)`. A class-validator decorator (requires `class-validator`). Prefer `ArrayNotEmpty`. |

### Transformation

| Export | Kind | Signature / description |
| --- | --- | --- |
| `Type` | decorator | `@Type(typeFunction?: (options?: TypeHelpOptions) => Function, options?: TypeOptions)`. The class a property's value is converted to. Needed for `@ValidateNested` and for query values. |
| `Transform` | decorator | `@Transform(transformFn: (params: TransformFnParams) => any, options?: TransformDecoratorOptions)`. Change a property's value while the body becomes the DTO. |
| `TransformationType` | enum | The direction passed to a `@Transform` function, as in class-transformer. |

### Mapped types

| Export | Kind | Signature |
| --- | --- | --- |
| `PartialType` | function | `PartialType(Base: Constructor<T>): Constructor<Partial<T>>` |
| `PickType` | function | `PickType(Base: Constructor<T>, keys: K[]): Constructor<Pick<T, K>>` |
| `OmitType` | function | `OmitType(Base: Constructor<T>, keys: K[]): Constructor<Omit<T, K>>` |

### Running validation yourself

| Export | Kind | Description |
| --- | --- | --- |
| `validateDto` | function | `validateDto(target, value): DtoValidationResult<T>`. Convert and validate a value with Megh's decorators. |
| `transformAndValidate` | function | `transformAndValidate(target, value, options?): Promise<RequestValidationResult<T>>`. The same with class-validator and class-transformer. |
| `Validator` | class | Rule-based validator for plain objects: `new Validator(rules: ValidationProps, options?).validate(obj)` returns `[issues, obj]`. |
| `validateOrThrow` | function | `validateOrThrow(obj, rules: ValidationProps, options?)`. Validate with `Validator` and throw `BadRequestException` on failure. |
| `isMeghValidatorClass` | function | Whether a class uses Megh's validation decorators. |

### Validation types

| Export | Kind | Description |
| --- | --- | --- |
| `ValidationOptions` | type | Options every validation decorator takes. |
| `ValidationArguments` | type | What a message function receives. |
| `IsNumberOptions` | type | `{ allowNaN?, allowInfinity?, maxDecimalPlaces? }`. |
| `TypeOptions` | type | Options for `@Type`. `discriminator` isn't supported yet. |
| `TypeHelpOptions` | type | What a `@Type` function receives. |
| `TransformFnParams` | type | What a `@Transform` function receives. |
| `TransformDecoratorOptions` | type | Options for `@Transform`. |
| `ValidationIssue` | type | One issue from `validateDto`. |
| `DtoValidationResult` | type | Result of `validateDto`. |
| `RequestValidationIssue` | type | One issue from `transformAndValidate`. |
| `RequestValidationResult` | type | Result of `transformAndValidate`. |
| `ValidationRule` | type | A `Validator` rule: `{ type: "string" \| "number" \| "boolean", required?, optional?, message?, min?, max?, exact? }`. |
| `ValidationProps` | type | `Record<string, ValidationRule>`. |
| `ValidateOptons` | type | `{ location?: "header" \| "queryparam" \| "param" \| "body" \| "custom" }`, for `Validator`. |
| `ValidatorIssue` | type | One issue from `Validator`. |

## Dependency injection

Guide: [Dependency injection](/core-concept/dependency-injection).

| Export | Kind | Signature / description |
| --- | --- | --- |
| `Injectable` | decorator | `@Injectable()`. Make a class resolvable by the container. Constructor parameters are injected from their types. |
| `AppService` | decorator | `@AppService` or `@AppService()`. Same as `@Injectable()`, for service classes. |
| `Utility` | decorator | Alias of `Injectable`: `@Utility()`. |
| `Helper` | decorator | Alias of `Injectable`: `@Helper()`. |
| `inject` | function | `inject<T>(id: ServiceIdentifier<T>, options?: InjectOptions): T`. Resolve a dependency, usually in a field initializer. With `{ optional: true }` it returns `undefined` when nothing is registered. |
| `createInjectDecorator` | function | `createInjectDecorator(factory: () => unknown)`. Build a property or parameter decorator that injects `factory()`. |
| `MeghContainer` | const | The container: `get(id)`, `set(id, value)`, `has(id)`, `reset()`. |
| `Token` | class | `new Token<T>(name?: string)`. A typed identifier for values that aren't classes. |
| `ContainerError` | class | Thrown when the container can't resolve or construct a service. |
| `ContainerApi` | interface | The `MeghContainer` surface. |
| `ServiceIdentifier` | type | A class, abstract class, `Token` or string. |
| `Constructable` | type | `new (...args: any[]) => T`. |
| `InjectOptions` | type | `{ optional?: boolean }`. |

## Middleware

Guide: [Middleware](/core-concept/middleware).

| Export | Kind | Signature / description |
| --- | --- | --- |
| `MeghMiddleware` | abstract class | `invoke(req: IRequest, res?: IResponse): Promise<IRequest \| HttpException>`. |
| `AppMiddleware` | decorator | `@AppMiddleware`. Register a middleware class for DI. Throws if it has no `invoke` method. |
| `UseMiddleware` | decorator | `@UseMiddleware(middleware \| middleware[])`. Apply middleware classes or instances to a controller or route. |

Global middleware is registered with `app.useMiddlewares([...])`.

## Authentication and authorization

Guide: [Authentication](/core-concept/authentication).

| Export | Kind | Signature / description |
| --- | --- | --- |
| `MeghAuthentication` | abstract class | `authenticate(request: IRequest): TUser \| null \| undefined \| Promise<...>`. The return value becomes `request.user`. Register with `app.useAuthentication()`. |
| `CanAuthorize` | decorator | `@CanAuthorize`. Mark a class with an `authorize(req, options?)` method as an authorization handler and register it for DI. |
| `Authorized` | decorator | `@Authorized()`, `@Authorized(name: string)` or `@Authorized({ name?, ...options })`. Require authorization on a controller or route. Extra options are passed to `authorize()`. |
| `AuthorizeClass` | interface | `{ authorize(req: IRequest, options?: any): unknown }`. Return `false` or throw to deny with 403. |
| `AuthorizedOptions` | type | `string \| { name?: string; [key: string]: any }`. |

## Security headers and rate limiting

Guide: [Security Hardening](/production/security#add-security-headers).

| Export | Kind | Signature / description |
| --- | --- | --- |
| `SecurityHeadersOptions` | type | `{ contentSecurityPolicy?, strictTransportSecurity?, frameOptions?, referrerPolicy?, crossOriginOpenerPolicy?, crossOriginResourcePolicy?, crossOriginEmbedderPolicy?, headers? }` for `useSecurityHeaders()`. `false` leaves a header out. |
| `ContentSecurityPolicyOptions` | type | `{ directives?: Record<string, CspDirectiveValue>; useDefaults?: boolean; reportOnly?: boolean }`. |
| `CspDirectiveValue` | type | `string \| string[] \| boolean`. `true` is a bare directive, `false` removes it. |
| `StrictTransportSecurityOptions` | type | `{ maxAge?: number; includeSubDomains?: boolean; preload?: boolean }`. |
| `ReferrerPolicy` | type | A `Referrer-Policy` token, such as `"no-referrer"`. |
| `RateLimit` | decorator | `@RateLimit(options: RouteRateLimitOptions \| false)`. A controller's or route's own limit and counter, or `false` for none. Works without `useRateLimit()`. |
| `RateLimitOptions` | type | `{ max?, window?, key?, ipv6Subnet?, skip?, store?, redis?, headers?, message?, failOpen?, global? }` for `useRateLimit()`. `ipv6Subnet` (default 64) groups IPv6 clients by prefix with the default key. |
| `RouteRateLimitOptions` | type | `{ max?: number; window?: RateLimitWindow; key?: (req) => string \| Promise<string> }`. |
| `RateLimitWindow` | type | `number \| string`. Milliseconds, or a duration such as `'30s'`, `'15m'`, `'1 hour'`. |
| `RateLimitStore` | interface | `{ hit(key, windowMs): RateLimitHit \| Promise<RateLimitHit>; reset?(key); close?() }`. Where counts live. |
| `RateLimitHit` | type | `{ count: number; resetAt: number }`. `resetAt` is epoch milliseconds. |
| `MemoryRateLimitStore` | class | The default store: fixed-window counts in memory, per process. `new MemoryRateLimitStore({ sweepIntervalMs?, maxKeys? })`; past `maxKeys` (default 100,000) the oldest windows are dropped. |
| `rateLimitIpKey` | function | `rateLimitIpKey(ip, ipv6Subnet = 64)`. The default key: IPv4 per address, IPv6 per prefix. Use it in a custom `key` that falls back to the IP. |
| `RedisRateLimitStore` | class | `new RedisRateLimitStore(redis, { prefix? })`. Counts in Redis, shared by replicas. Takes an ioredis client, which it does not close. |
| `RedisEvalClient` | interface | The part of an ioredis client the Redis store uses: `eval` and `del`. |

## Configuration and environment

Guide: [Configuration](/core-concept/configuration).

| Export | Kind | Signature / description |
| --- | --- | --- |
| `MeghConfig` | abstract class | `config(env: Environment): T`. Base class for a config class. |
| `AppConfig` | decorator | `@AppConfig` or `@AppConfig({ schema })`. Register a `MeghConfig` subclass for DI; with `schema`, its `config()` result is validated against that DTO class on first use and at boot. |
| `AppConfigOptions` | type | `{ schema?: Constructor }`. |
| `validateEnv` | function | `validateEnv(EnvDto, source?)` validates environment variables against a DTO class and returns them converted. |
| `ConfigValidationError` | class | Thrown for an invalid environment or config; `source` and `issues` say what failed. |
| `GetConfig` | function | `GetConfig(ConfigClass)` returns the class's `config()` result; `GetConfig(token: string \| symbol)` returns the value registered for the token. |
| `MeghConfigClass` | type | A `MeghConfig` subclass. |
| `Environment` | class | Reads `.env` merged with `process.env` (which wins): `get(key)`, `getOrThrow(key)`, `getAll()`, and static `reload()` to re-read `.env`. |
| `EnvironmentVariableNotFound` | class | Error thrown by `getOrThrow()` for a missing variable; the name is in `key`. |

## ORM

Guides: [ORM](/advanced/orm), [Models](/advanced/orm/models), [Queries](/advanced/orm/queries),
[Relations](/advanced/orm/relations), [Migrations](/advanced/orm/migrations),
[Seeding](/advanced/orm/seeding), [Query builder](/advanced/orm/query-builder).

The ORM ships inside `@meghjs/core` as a built-in plugin. Connect it with
`app.useMeghORM()`.

### Models

| Export | Kind | Description |
| --- | --- | --- |
| `Model` | abstract class | Base class for models. Static query methods (`query`, `find`, `findOrFail`, `where`, `with`, `create`, `paginate`, `transaction`, …) and instance methods (`save`, `fill`, `delete`, `restore`, `related`, …). |
| `ModelQuery` | class | A query on a model. Nothing runs until `get()`, `first()`, `count()`, `paginate()`, `update()` or `delete()`. |
| `HasRelation` | class | A `hasMany` / `hasOne` relation of one model instance: `user.related("posts")`. |
| `PivotRelation` | class | The pivot rows of a `belongsToMany` relation: `user.related("roles").attach([1, 2])`. |
| `ORM_CONNECTION` | const | `Token<Kysely<any>>` holding the ORM's root Kysely instance. |
| `modelSchema` | function | `modelSchema(cls): SchemaObject \| undefined`. JSON schema for a model's columns. |
| `getModelMetadata` | function | `getModelMetadata(cls): ModelMetadata \| undefined`. Column and table metadata from the decorators. |

### Model decorators

| Export | Kind | Signature |
| --- | --- | --- |
| `Table` | decorator | `@Table(name?: string)`. Defaults to the plural snake_case class name. |
| `Column` | decorator | `@Column(typeOrOptions?: ColumnType \| ColumnOptions, options?: ColumnOptions)` |
| `PrimaryKey` | decorator | `@PrimaryKey(options?: ColumnOptions)` |
| `AutoIncrement` | decorator | `@AutoIncrement()`. A generated integer column. |
| `Identity` | decorator | Alias of `AutoIncrement`. |
| `CreatedAt` | decorator | Set to the current time on insert. |
| `UpdatedAt` | decorator | Set to the current time on every insert and update. |
| `DeletedAt` | decorator | Soft deletes: `delete()` sets this column instead of removing the row. |
| `HasMany` | decorator and type | `@HasMany(related: () => C, options?: HasOptions)`. As a type, the field type of a one-to-many relation. |
| `HasOne` | decorator and type | `@HasOne(related: () => C, options?: HasOptions)`. |
| `BelongsTo` | decorator and type | `@BelongsTo(related: () => C, options?: BelongsToOptions)`. |
| `BelongsToMany` | decorator and type | `@BelongsToMany(related: () => C, options?: BelongsToManyDecoratorOptions)`. |

### Relation functions

For models that declare relations as fields instead of decorators.

| Export | Kind | Signature |
| --- | --- | --- |
| `hasMany` | function | `hasMany(related: () => C, foreignKey?: string, localKey?: string)` |
| `hasOne` | function | `hasOne(related: () => C, foreignKey?: string, localKey?: string)` |
| `belongsTo` | function | `belongsTo(related: () => C, foreignKey?: string, ownerKey?: string)` |
| `belongsToMany` | function | `belongsToMany(related: () => C, options?: BelongsToManyOptions)` |

### Connection and configuration

| Export | Kind | Description |
| --- | --- | --- |
| `createDatabase` | function | `createDatabase(options: ResolvedDatabaseOptions): Kysely<any>`. |
| `resolveDatabaseOptions` | function | `resolveDatabaseOptions(options?, env?)`. Apply environment variables and the URL to database options. |
| `DatabaseConfigError` | class | Thrown for invalid database settings. |
| `ormPlugin` | const | The ORM as a Megh plugin. Registered automatically. |
| `setNamingStrategy` | function | `setNamingStrategy("preserve" \| "snake_case")`. |
| `getNamingStrategy` | function | The current naming strategy. |
| `DatabaseOptions` | interface | Settings for `useMeghORM()`. |
| `ResolvedDatabaseOptions` | interface | Settings after the environment and URL are applied. |
| `Dialect` | type | `"postgres" \| "mysql" \| "sqlite" \| "mssql"`. |
| `PoolOptions` | interface | Connection pool settings. |
| `NamingStrategy` | type | `"preserve" \| "snake_case"`. |

### Query builder

| Export | Kind | Description |
| --- | --- | --- |
| `DB` | const | Table queries without models: `DB.table(name)`, `DB.transaction(fn)`. |
| `TableQuery` | class | A query on one table, built with `DB.table()`. |
| `WhereClauses` | class | `where` conditions shared by queries and groups. |
| `WhereGroup` | class | The conditions inside `where((q) => …)`. |
| `Operator` | type | Comparison operators accepted by `TableQuery`. |

### Schema and migrations

| Export | Kind | Description |
| --- | --- | --- |
| `Schema` | class | Creates, changes and drops tables. Migrations defined with `defineMigration` receive one. |
| `Blueprint` | class | The columns and indexes of a table being created or changed. |
| `ColumnDefinition` | class | A column being added. Columns are NOT NULL unless `nullable()`. |
| `ForeignKeyDefinition` | class | A foreign key: `table.foreign("user_id").references("users.id")`. |
| `SchemaError` | class | Thrown for invalid schema operations. |
| `Migrations` | class | `new Migrations(db, options)`. Runs and rolls back migrations. |
| `MigrationError` | class | Thrown when a migration fails. Carries the migration name and those completed. |
| `defineMigration` | function | `defineMigration({ up, down? })`. A migration written with the schema builder. |
| `readMigrationFolder` | function | `readMigrationFolder(folder): Promise<Record<string, Migration>>`. |
| `Migration` | interface | A migration as the runner calls it. |
| `SchemaMigration` | interface | A migration written with the schema builder. |
| `MigrationsOptions` | interface | Options for `Migrations`. |
| `MigrationStatus` | interface | One migration's status. |
| `ReferentialAction` | type | `ON DELETE` / `ON UPDATE` actions. |
| `SchemaDialect` | type | `"postgres" \| "mysql" \| "sqlite" \| "mssql"`. |

### Seeders and factories

| Export | Kind | Description |
| --- | --- | --- |
| `Seeders` | class | `new Seeders(db, options?)`. Runs seeders. |
| `SeedError` | class | Thrown when a seeder fails. |
| `defineSeeder` | function | Identity helper that type-checks a seeder. |
| `readSeederFolder` | function | `readSeederFolder(folder): Promise<Record<string, Seeder>>`. |
| `seederName` | function | A seeder's name from its file name. |
| `ENTRY_SEEDER` | const | `"database"`, the seeder `run()` starts from when given no name. |
| `Seeder` | interface | A seeder. |
| `SeedContext` | interface | What a seeder's `run()` receives. |
| `SeedersOptions` | interface | Options for `Seeders`. |
| `Factory` | class | Builds and creates model instances from a definition. |
| `defineFactory` | function | `defineFactory(model, definition: (ctx: FactoryContext) => FactoryAttributes<C>): Factory<C>`. |
| `useFaker` | function | `useFaker(faker)`. Set the Faker instance factories use. |
| `getFaker` | function | `getFaker(): Promise<Faker>`. The Faker instance, loaded from the app on first use. |
| `FactoryAttributes` | type | Attributes a factory definition returns. |
| `FactoryContext` | interface | What a factory definition receives. |

### ORM types

| Export | Kind | Description |
| --- | --- | --- |
| `ColumnType` | type | Column types, which pick the SQL type and value conversion. |
| `ColumnOptions` | interface | Options for `@Column`. |
| `ColumnMetadata` | interface | A column's metadata. |
| `ModelMetadata` | interface | A model's metadata. |
| `HasOptions` | interface | Options for `@HasMany` and `@HasOne`. |
| `BelongsToOptions` | interface | Options for `@BelongsTo`. |
| `BelongsToManyOptions` | interface | Options for `belongsToMany()`. |
| `BelongsToManyDecoratorOptions` | interface | Options for `@BelongsToMany`, including `pivotColumns`. |
| `Cast` | type | A column cast: a built-in name or a `CustomCast`. |
| `CustomCast` | interface | `{ get, set }` conversion between database and model values. |
| `Columns` | type | A model's column fields. |
| `ColumnKeys` | type | Names of a model's columns. |
| `RelationKeys` | type | Names of a model's relations. |
| `RelationPaths` | type | Relation paths for `with()`, up to three levels. |
| `BelongsToManyKeys` | type | Names of `belongsToMany` relations. |
| `HasRelationKeys` | type | Names of `hasMany` / `hasOne` relations. |
| `PivotOf` | type | Pivot columns of a `belongsToMany` relation. |
| `TimestampKeys` | type | Timestamp columns when `timestamps = true`. |
| `Row` | type | A model's row as loaded from the database. |
| `ModelClass` | interface | The static side of a model class. |
| `CreateInput` | type | `create()` input. |
| `UpdateInput` | type | `update()` / `fill()` input. |
| `PrimaryKeyValue` | type | Value type of a model's primary key. |
| `TableOf` | type | Kysely table interface for a model. |
| `DatabaseOf` | type | Kysely database interface for a set of models. |
| `ComparisonOperator` | type | Operators accepted by `where`. |
| `Counted` | type | The `<relation>_count` field `withCount()` adds. |
| `CursorPageRequest` | interface | Request for `cursorPaginate()`. |
| `CursorPaginated` | interface | Result of `cursorPaginate()`. |
| `SimplePaginated` | interface | Result of `simplePaginate()` (no total). |
| `ModelAt` | type | The model at the end of a relation path. |
| `RelationConstraint` | type | A function that narrows a related query. |
| `Scope` | type | A reusable query scope. |
| `RelatedRef` | type | A related row's key, or the related model itself. |

## Events

Guide: [Events](/advanced/events).

| Export | Kind | Signature / description |
| --- | --- | --- |
| `MeghEvent` | abstract class | `new MyEvent(payload)`. Base class for events; sets `name` and `timestamp`. |
| `MeghEventListener` | abstract class | `handler(event: TEvent): void \| Promise<void>`. Base class for listeners. |
| `EventDispatcher` | class | `dispatch(event: MeghEvent, option?: DispatchOption): Promise<void>`. |
| `EventRegistry` | class | `EventRegistry.getInstance()`, then `register(EventClass, listener)`, `once`, `unregister`, `getListeners`, `clear`. |
| `EventQueue` | class | The in-memory queue for `queue: true` dispatches. `EventQueue.getInstance()`, `getFailedJobs()`, `clearFailed()`, `whenIdle()`. |
| `DispatchOption` | type | `{ queue?, delay?, retry?, retryDelay?, broadcast? }`. `delay` is ms or `"500ms"`, `"5s"`, `"2m"`, `"1h"`, `"1d"`. |
| `BroadcastOption` | type | `SocketBroadcastOption \| false`. |
| `SocketBroadcastOption` | type | `{ type: "socket"; channel: string; room?: string }`. |
| `MeghEventInterface` | interface | `{ name: string; timestamp: number }`. |
| `MeghEventListenerInterface` | interface | `{ handler(event): void \| Promise<void> }`. |
| `FailedEventJob` | interface | A listener that kept failing after its retries. |
| `Broadcast` | interface | `{ to: string; private?: boolean; payload: any }`. |
| `parseDelay` | function | `parseDelay(input: string \| number): number`. Parse a delay into milliseconds. |

## Queue

Guide: [Queue](/advanced/queue).

| Export | Kind | Signature / description |
| --- | --- | --- |
| `Queue` | decorator | `@Queue(config: QueueConfig)`. Register a `MeghQueue` subclass for DI and start its worker unless `worker: false`. |
| `JobHandler` | decorator | `@JobHandler(name: string)`. Mark a method as the processor for a named job. |
| `MeghQueue` | abstract class | Produces and consumes jobs: `add`, `delay`, `dispatch`, `getJob`, `getJobs`, `clean`, `pause`, `resume`, `close`, `getQueue`, `getWorker`, `on`, `startWorker`. |
| `MeghWorker` | decorator | `@MeghWorker(config: WorkerConfig)`. Register a standalone worker class. Doesn't start it. |
| `MeghWorkerBase` | abstract class | `process(job: Job<T>): Promise<any>`. Base class for standalone workers; `start()`, `close()`, `getWorker()`. |
| `QueueConfig` | interface | `{ name, adapter?, worker?, handler?, driver? }`. |
| `WorkerConfig` | interface | `{ queue, connection?, concurrency?, options?, autoStart?, driver? }`. |
| `Job` | type | BullMQ's `Job`, re-exported. |
| `JobsOptions` | type | BullMQ's `JobsOptions`, re-exported. |
| `setQueueDriver` | function | `setQueueDriver(driver: QueueDriver \| undefined)`. Set the default driver. |
| `resolveQueueDriver` | function | `resolveQueueDriver(explicit?)`. The driver in effect: explicit, then `setQueueDriver()`, then `MEGH_QUEUE_DRIVER`, then `"bullmq"`. |
| `QueueDriver` | type | `"bullmq" \| "memory" \| "sync"`. |
| `waitForMemoryQueues` | function | Resolve when every in-memory queue is idle. For tests. |
| `resetMemoryQueues` | function | Clear every in-memory queue. For tests. |
| `MemoryJob` | class | A job in the in-memory driver. |
| `MemoryJobState` | type | `"waiting" \| "delayed" \| "active" \| "completed" \| "failed"`. |
| `getRegisteredWorkers` | function | Every `@MeghWorker` class, in declaration order. |
| `startRegisteredWorkers` | function | Resolve and start every `@MeghWorker` whose `autoStart` isn't `false`. The application calls it at boot. |
| `attachWorkerLogging` | function | `attachWorkerLogging(worker, queue)`. Log failed jobs and worker errors. |

```ts
add(data: T, options?: JobsOptions): Promise<Job<T>>
add(name: string, data: T, options?: JobsOptions): Promise<Job<T>>
delay(data: T, delayMs: number, options?: JobsOptions): Promise<Job<T>>
delay(name: string, data: T, delayMs: number, options?: JobsOptions): Promise<Job<T>>
dispatch(name: string, data: T, delayMs?: number, options?: JobsOptions): Promise<Job<T>>
```

## Mail

Guide: [Mail](/advanced/mail).

| Export | Kind | Signature / description |
| --- | --- | --- |
| `Mailable` | abstract class | One kind of email. `envelope()`, `content()` (required), `attachments()`; each may be async. |
| `Mailer` | class | Injectable. `to()`, `cc()`, `bcc()`, `send()`, `queue()`, `later(delay, mail)`, `mailer(name)`. Static: `configure()`, `fake()`, `restore()`, `close()`, `reset()`. |
| `PendingMail` | class | Returned by `mailer.to()`: add recipients, then `send()`, `queue()` or `later()`. |
| `MailFake` | class | Returned by `Mailer.fake()`. `assertSent`, `assertNotSent`, `assertNothingSent`, `assertSentCount`, `assertQueued`, `assertNotQueued`, `assertNothingQueued`, `sentOf`, `queuedOf`, `sent`, `queued`, `restore`. |
| `SentMail` | class | A recorded message: `mailer`, `mailable`, `message`, `delay`, `hasTo()`, `hasCc()`, `hasBcc()`, `hasFrom()`. |
| `MailConfig` | interface | `{ default?, from?, mailers?, queue? }` for `useMail()`. |
| `MailQueueConfig` | interface | `{ name?, adapter?, driver?, worker?, jobOptions? }`. |
| `MailerConfig` | type | One mailer's settings: `{ transport: "smtp" \| "sendgrid" \| "mailgun" \| "postmark" \| "resend" \| "failover" \| "log" \| "array", ... }`, or a `MailTransport`. |
| `MailTransport` | interface | `{ send(message: MailMessage): Promise<{ messageId?, response? } \| void>; close?() }`. Implement it for your own mailer. |
| `MailMessage` | interface | A built message: `from`, `to`, `cc`, `bcc`, `replyTo`, `subject`, `html?`, `text?`, `attachments`, `headers`. |
| `MailEnvelope`, `MailContent`, `MailAttachment`, `MailAddress`, `MailAddressLike` | types | What a `Mailable` returns, and address forms. |
| `SentMessage`, `QueuedMessage` | types | What `send()` and `queue()`/`later()` resolve to. |
| `SmtpTransport`, `SendGridTransport`, `MailgunTransport`, `PostmarkTransport`, `ResendTransport`, `FailoverTransport`, `LogTransport`, `ArrayTransport` | classes | The built-in transports. |
| `MailQueue` | class | The `MeghQueue` behind `queue()` and `later()`. |
| `MailError` | class | A misconfiguration, or a mailable that cannot be built. |
| `MailTransportError` | class | A provider refused the message: `provider`, `status`, `body`. |
| `mailConfigFromEnv`, `resolveMailConfig`, `mailerProblem` | functions | Read `MEGH_MAIL_*`, merge options over it, and check a mailer's settings. |

## Scheduler

Guide: [Scheduler](/advanced/scheduler).

| Export | Kind | Signature / description |
| --- | --- | --- |
| `ScheduledTask` | decorator | `@ScheduledTask()`. Mark a class as holding scheduled jobs and register it for DI. |
| `Cron` | decorator | `@Cron(expression: string, options?: { name?, disabled?, timezone?, runOnInit? })`. Run the method on a cron expression (node-cron). |
| `Interval` | decorator | `@Interval(ms: number, options?: { name?, disabled? })`. Run the method every `ms` milliseconds. |
| `Timeout` | decorator | `@Timeout(ms: number, options?: { name?, disabled? })`. Run the method once, `ms` milliseconds after start. |
| `MeghScheduler` | class | Runs the jobs of registered task classes: `addTaskClasses(tasks)`, `start()`, `stopAll()`. The application creates one for `useScheduler()`. |

Register task classes with `app.useScheduler([...])`.

## Cache

Guide: [Caching](/advanced/caching).

| Export | Kind | Signature / description |
| --- | --- | --- |
| `CacheManager` | class | Key/value cache with tag invalidation, backed by memory or Redis. TTLs are in seconds. |
| `CacheManagerOptions` | type | `CacheOptions` fields plus `redis?` (an ioredis client) and `sweepIntervalMs?`. |

```ts
CacheManager.configure(options?: CacheManagerOptions): void   // defaults for new instances
CacheManager.close(): Promise<void>                           // static: close every instance
get<T>(key: string): Promise<T | null>
set<T>(key: string, value: T, ttl?: number, tags?: string[]): Promise<void>  // ttl defaults to 3600
delete(key: string): Promise<void>
invalidateTags(tags: string | string[]): Promise<void>
sweep(): number
close(): Promise<void>
```

Enable it with `app.useCache(options?)`.

## Storage and uploads

Guide: [File uploads](/advanced/file-uploads).

| Export | Kind | Description |
| --- | --- | --- |
| `FileStorage` | class | Saves uploaded files under a root directory (`<cwd>/public` by default) with an upload policy. Injectable. |
| `UploadFileFromRequest` | function | `UploadFileFromRequest(req: IRequest, options?)`. Save the request's file. Options: `saveAs?`, `dest?`, `preserveFilename?`, `allowedExtensions?`. |
| `MultipartFile` | type | An uploaded file from `@fastify/multipart`. |
| `FileStorageInterface` | interface | `transform`, `save`, `saveAll`, `remove`. |
| `FileStorageOptions` | interface | `UploadPolicy` plus `baseDir?`. |
| `UploadPolicy` | interface | `{ allowedExtensions?, allowedMimeTypes?, maxFileSize? }`. `maxFileSize` defaults to 50 MB. |
| `SaveOptions` | interface | `UploadPolicy` plus `overwrite?`, `to?`, `transform?`. |
| `SaveOptionsSingle` | interface | `SaveOptions` for `save()`. |
| `SavedFileInfo` | interface | `{ filename, originalFilename, size, uploadPath, staticPath }`. |
| `TransformOptions` | interface | Image transform: `{ resize?, format?, quality? }`. |

```ts
configure(options: FileStorageOptions): this
transform(options: TransformOptions): FileStorage
save(file: MultipartFile, options?: SaveOptionsSingle): Promise<SavedFileInfo>
saveAll(files: MultipartFile[], options?: SaveOptions): Promise<SavedFileInfo[]>
remove(filepath: string): Promise<void>
getUploadFile(filePath: string)
download(filepath: PathLike)
downloadAs(filepath: PathLike, filename: string)
```

Upload parameters are declared with [`@UploadFile` and `@UploadFiles`](#parameters).

## Realtime

Guide: [WebSocket](/microservices/websocket).

| Export | Kind | Signature / description |
| --- | --- | --- |
| `SocketIoServer` | const | `Token<Server>`. The Socket.IO server, registered by `useSocketIo()`. |
| `Subscribe` | decorator | `@Subscribe(event: string)`. Handle a Socket.IO event. |
| `PrivateChannel` | decorator | `@PrivateChannel(channelResolver?: (socket) => string)`. Mark a subscriber method as private. |
| `DispatchNow` | decorator | `@DispatchNow(event: string, options?: DispatchOptions)`. Emit the method's return value as `event` after it runs. |
| `SocketEventDispatcher` | class | `dispatch(event: string, data, options?: DispatchOptions)`. Emit an event over Socket.IO. |
| `SocketContextService` | class | The socket of the event being handled: `getSocket()`. |
| `DispatchOptions` | type | `{ room?, broadcast?, transports?, retry?, retryDelay? }`. |

## OpenAPI

Guide: [OpenAPI](/microservices/openapi).

### Decorators

| Export | Kind | Signature / description |
| --- | --- | --- |
| `OpenApi` | decorator | `@OpenApi(options: OpenApiOptions)`. Document a controller, route or property. |
| `ApiResponse` | decorator | `@ApiResponse(status: number, type?: ResponseType \| ApiResponseOptions, description?: string)`. Document a response of a route or every route of a controller. |
| `OpenApiProperty` | decorator | `@OpenApiProperty(options?)`. Document a DTO property (`ParamSchema` fields plus `isArray`, `items`, `nullable`, `readOnly`, …). |
| `OpenApiSchema` | decorator | `@OpenApiSchema()`. Add the class to `components.schemas`. |
| `OpenApiResponse` | function | Deprecated. `OpenApiResponse(code, model, description?)`. Documents a `{ code, status, data }` wrapper Megh doesn't send. Use `@ApiResponse`. |
| `OpenApiOk` | function | Deprecated. `OpenApiResponse(200, model, "Success")`. |

### Functions

| Export | Kind | Description |
| --- | --- | --- |
| `registerSchemaProvider` | function | `registerSchemaProvider(provider: SchemaProvider)`. Describe classes the DTO reader doesn't. |
| `generateClassSchema` | function | `generateClassSchema(classType, options?: ClassSchemaOptions)`. JSON schema for a DTO class. |
| `generateSwaggerSchema` | function | `generateSwaggerSchema(classes, extraClasses?)`. `components.schemas` for `@OpenApiSchema` classes. |
| `GetSchema` | function | Alias of `generateSwaggerSchema`. |
| `inlineSchemaRefs` | function | Replace `#/components/schemas/*` refs with inline schemas. |
| `normalizeParamsToJsonSchema` | function | `normalizeParamsToJsonSchema(params, requiredKeys?)`. Turn a `ParamsSchemaMap` into an object schema. |

### Options

| Export | Kind | Description |
| --- | --- | --- |
| `OpenApiUiOptions` | type | Options for `useOpenApi()`: `info`, `routePrefix` (default `/swagger`), `provider` (`"default"` or `"scalar"`), `auth`, `servers`, `tags`, `security`, `components`, `uiConfig`, `scalar`, `logo`, `theme`, `openapi`, `paths`. |
| `OpenApiOptions` | type | Options for `@OpenApi()` on a route: `summary`, `description`, `tags`, `params`, `query`, `headers`, `requestBody`, `response`, `exclude`, `deprecated`, `security`, … |
| `OpenApiAuth` | type | `"bearer" \| "apiKey" \| SecuritySchemeObject`. |
| `ApiResponseOptions` | interface | `{ type?, description?, contentType?, example? }`. |
| `ResponseType` | type | A DTO class, `[Class]`, `Paginated(Class)`, a JSON schema or a `$ref`. |
| `PaginatedType` | interface | What `Paginated(Class)` returns. |
| `SchemaProvider` | type | `(cls) => SchemaObject \| undefined`. |
| `ClassSchemaOptions` | type | `{ inline?, components? }` for `generateClassSchema`. |
| `SchemaClass` | type | A DTO class. |
| `ParamSchema` | type | Schema of one parameter. |
| `ParamsSchemaMap` | type | `Record<string, ParamSchema>`. |
| `RequestBodyOptions` | type | Options for `requestBody`. |
| `RequestBodyMediaTypeOptions` | type | A media type whose `schema` may be a DTO class. |
| `ResponseBodyOptions` | type | A response described as a JSON schema. |
| `ResponsesOptions` | type | Responses keyed by status code. |
| `SwaggerUiConfig` | interface | Swagger UI settings. |
| `SwaggerUiLogo` | interface | Swagger UI top-bar logo. |
| `SwaggerUiTheme` | interface | Swagger UI page title, CSS, scripts and favicon. |
| `SwaggerUiThemeFile` | interface | A theme file. |
| `SwaggerUiFavicon` | interface | A favicon file. |
| `ScalarConfig` | interface | Scalar settings. |

### OpenAPI document types

Types for the OpenAPI 3 document: `InfoObject`, `ContactObject`,
`LicenseObject`, `ServerObject`, `ServerVariableObject`, `PathsObject`,
`PathItemObject`, `OperationObject`, `ExternalDocumentationObject`,
`ParameterObject`, `ParameterBaseObject`, `HeaderObject`, `SchemaObject`,
`ArraySchemaObject`, `NonArraySchemaObject`, `BaseSchemaObject`,
`ArraySchemaObjectType`, `NonArraySchemaObjectType`, `DiscriminatorObject`,
`XMLObject`, `ReferenceObject`, `ExampleObject`, `MediaTypeObject`,
`EncodingObject`, `RequestBodyObject`, `ResponsesObject`, `ResponseObject`,
`LinkObject`, `CallbackObject`, `SecurityRequirementObject`,
`ComponentsObject`, `SecuritySchemeObject`, `HttpSecurityScheme`,
`ApiKeySecurityScheme`, `OAuth2SecurityScheme`, `OpenIdSecurityScheme` and
`TagObject`.

## Logging

Guide: [Logging](/advanced/logging).

| Export | Kind | Signature / description |
| --- | --- | --- |
| `LoggerService` | class | Application logger backed by one shared pino instance. Injectable. `info`, `error`, `warn`, `debug`, `fatal`, `trace` take `(message: string, obj?: any)`; `getLogger()` returns the pino logger. |
| `LoggerConfig` | interface | `{ level?, pretty?, destination? }`. |
| `buildLoggerOptions` | function | `buildLoggerOptions(config?, env?): pino.LoggerOptions`. The pino options Megh uses. |
| `getRequestId` | function | `getRequestId(): string \| undefined`. The ID of the request being handled. |
| `DEFAULT_REQUEST_ID_HEADER` | const | `"x-request-id"`. |
| `RequestIdOptions` | type | `false \| { header?, generate? }`, for the `requestId` application option. |

```ts
LoggerService.getPino(): pino.Logger                       // the shared instance
LoggerService.configure(config?: LoggerConfig): pino.Logger // replace it
LoggerService.child(bindings: pino.Bindings): pino.Logger
```

## Health

Guide: [Health checks](/advanced/health).

| Export | Kind | Description |
| --- | --- | --- |
| `HealthCheck` | type | `() => unknown \| Promise<unknown>`. Passes unless it throws, rejects or returns `false`. |
| `HealthOptions` | interface | `{ path?, readyPath?, checks?, timeout? }`. Defaults: `/health`, `/ready`, 5000 ms. |
| `HealthCheckResult` | interface | `{ status: "up" \| "down"; durationMs; error? }`. |
| `ReadinessReport` | interface | `{ status: "ok" \| "error"; checks }`. |
| `HealthRegistry` | class | Runs readiness checks and serves the health routes. The application creates one. |
| `SKIP_GLOBAL_MIDDLEWARE` | const | Route config flag that makes `useMiddlewares` skip a route. |

Enable with `app.useHealth(options?)` and add checks with `app.addHealthCheck(name, check)`.

## Plugins

Guide: [Plugins](/advanced/plugins).

| Export | Kind | Description |
| --- | --- | --- |
| `definePlugin` | function | `definePlugin(plugin: MeghPlugin): MeghPlugin`. Identity helper that type-checks a plugin. |
| `MeghPlugin` | interface | `{ name: string; dependsOn?: string[]; register(ctx: PluginContext): void }`. |
| `PluginContext` | interface | `{ app, container, http, logger, extend(name, method), onInit, onReady, onClose, addHealthCheck }`. |
| `PluginOptions` | type | `{ plugins?: MeghPlugin[]; autoloadPlugins?: boolean }`, part of `MeghApplicationOptions`. |

## Testing

Guide: [Testing](/advanced/testing).

| Export | Kind | Description |
| --- | --- | --- |
| `MeghTest` | class | Static test helpers (below). |
| `TestApplication` | interface | Test client: `get`, `post`, `put`, `patch`, `delete`, `options` take `(url, options?: InjectOptions)`; plus `getController(controller, deps?)`. |
| `TestAppOptions` | type | `{ controllers: Constructor[] }`. |
| `TestResponse` | type | The Fastify inject response, or a promise of it. |

```ts
MeghTest.createTestApplication(options: TestAppOptions): TestApplication
MeghTest.from(app: MeghApplication): TestApplication
MeghTest.getController<T>(controller: Constructor<T>, deps?: any[]): T
MeghTest.getProvider<T>(service: Constructor<T>, deps?: any[]): T
MeghTest.clean(): void   // reset the container
```

`getController` and `getProvider` register `deps` in place of the class's
constructor dependencies, in order. `Megh.createTestApplication(options)` is the
same as `MeghTest.createTestApplication(options)`.

## Types

| Export | Kind | Description |
| --- | --- | --- |
| `IRequest` | interface | The request type handlers and middleware receive: Fastify's request with Megh's additions. |
| `IResponse` | interface | Fastify's reply. |
| `Constructor` | type | `new (...args: any[]) => T`. |

## Other exports

These are exported but are mostly used by Megh itself. They may change or be
removed in a minor release, so prefer the APIs above.

### Metadata keys

| Export | Kind |
| --- | --- |
| `ROUTE_META_KEY`, `CONTROLLER_META_KEY`, `PARAM_META_KEY`, `QUERY_META_KEY`, `REQUEST_BODY_META_KEY`, `REQUEST_BODY_FILE_KEY`, `REQUEST_BODY_FILES_KEY`, `REQUEST_USER_META_KEY`, `REQUEST_HEADER_META_KEY`, `DATASOURCE_META_KEY`, `AUTHORIZATION_META_KEY`, `API_CONTROLLER_METADATA_KEY` | const (symbols) |
| `REQUEST_METADATA_KEY`, `HTTP_CODE_META_KEY` | const (symbols) |
| `CATCH_META_KEY`, `FILTERS_META_KEY` | const (strings) |

### Registries and internals

| Export | Kind | Description |
| --- | --- | --- |
| `registerController`, `getRegisteredControllers`, `isApiController` | function | The controller registry. |
| `registerService`, `getRegisteredServices` | function | A service registry. |
| `createControllerDecorator` | function | Factory behind `@ApiController`. |
| `getDeclaredFilters` | function | Filters declared with `@UseFilters` for a route. |
| `registerSocketSubscriber`, `getSocketSubscribers`, `isPrivate`, `getPrivateChannelResolver` | function | Socket subscriber registry. |
| `EventSubscriberRegistry` | class | Wires `@Subscribe` methods to a socket. |
| `checkHelpers`, `stringLength`, `isLength` | const / function | Helpers called by compiled validation code. |
| `ParamMetaOptions`, `ParamMetaFilesOptions`, `MethodParamMeta`, `IRoute`, `FuncRoute`, `StaticFileOptions` | type | Router metadata shapes. |

### Utility functions

| Export | Kind | Description |
| --- | --- | --- |
| `loadPackageFromClient` | function | Load an optional dependency from the app's `node_modules`. |
| `PackageLoader` | type | Type of `loadPackageFromClient`. |
| `isConstructor` | function | Whether a value is a class. |
| `formatUrl`, `parsedPath`, `normalizePath` | function | Path helpers used by the router. |
| `sleep` | function | `sleep(ms)`: a promise that resolves after `ms`. |
| `pick`, `exclude` | function | Copy an object with only, or without, the given paths. |
| `autoCast`, `normalizeQueryDeep` | function | Convert query and parameter strings to typed values. |
| `transformObjectByInstanceToObject`, `jsonToJs`, `jsonToInstance` | function | class-transformer and JSON helpers. |
| `getDataType`, `isValidType`, `isValidJsonString` | function | Type checks used for parameters. |
| `isClassValidatorClass`, `validateObjectByInstance` | function | class-validator helpers. |
| `REQUEST_VALIDATION_OPTIONS` | const | class-validator options Megh uses for request DTOs. |
| `formatValidationMessage` | function | One-line summary of validation issues. |
