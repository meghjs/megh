/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 */
import type { RouteRateLimitOptions } from "../security/rate-limit";
import { FastifyRequest, FastifyReply } from "fastify";
import { MultipartFile } from "../http/multipart";
import { OpenApiUiOptions } from "../openapi/openapi";
import type {
  IMeghApplication,
  MeghApplicationOptions,
  CorsOptions,
  GlobalOptions,
  AutoControllerOptions,
  SchedulerScanOptions,
  CompressionOptions,
  TestApplication,
  TestResponse,
} from "./interfaces";

// Re-export types imported from interfaces
export {
  IMeghApplication,
  MeghApplicationOptions,
  CorsOptions,
  GlobalOptions,
  AutoControllerOptions,
  SchedulerScanOptions,
  CompressionOptions,
  TestApplication,
  TestResponse,
};

// IRequest
// We Omit properties that might conflict with FastifyRequest augmentation
// specifically files and formData from @fastify/multipart
export interface IRequest extends Omit<
  FastifyRequest,
  "files" | "formData" | "file" | "saveRequestFiles"
> {
  params: any;
  query: any;
  body: any;
  headers: any;
  user?: any;

  // Multipart extensions overriding default fastify-multipart types
  // We treat them as optional properties for our framework logic
  formData?: any;
  file?: MultipartFile;
  files?: MultipartFile[];

  // saveRequestFiles comes from @fastify/multipart augmentation.
  // We declare it here to ensure it's available.
  // It returns Promise<SavedMultipartFile[]> usually.
  // We use 'any' or strict type if known.
  saveRequestFiles?: (options?: any) => Promise<MultipartFile[]>;

  // Add _argsCache definition to avoid casting to any in code
  _argsCache?: Map<string, any[]>;
}

// IResponse
export interface IResponse extends FastifyReply {}

// ParamMetaOptions
export interface ParamMetaOptions {
  index: number;
  key: string;
  name: string;
  required: boolean;
  validate: boolean;
  dataType: any;
  validatorClass: boolean;
  schema?: any;
  type:
    | "route:param"
    | "route:query"
    | "route:body"
    | "route:header"
    | "route:user"
    | "route:session"
    | "route:file"
    | "route:files";
}

export interface ParamMetaFilesOptions {
  index: number;
  type: "route:files";
  files: MultipartFile[];
  fieldName: string;
}

// Method Param Meta options
export interface MethodParamMeta {
  request: any[];
  params: ParamMetaOptions[];
  query: ParamMetaOptions[];
  body: ParamMetaOptions[];
  headers: ParamMetaOptions[];
  currentUser: ParamMetaOptions[];
  session?: ParamMetaOptions[];
  swagger?: OpenApiUiOptions;
  file?: any[];
  files?: ParamMetaFilesOptions[];
}

export interface IRoute {
  url: string;
  method: string;
  controller: string;
}

export type FuncRoute = {
  handler: Function;
  /** Middleware classes or instances, resolved when routes are mapped. */
  middlewares: any[];
  schema: any;
  /** Set by `.authorized()`: the `@Authorized` options for this route. */
  authorize?: { name?: string; [key: string]: unknown };
  /** Set by `.public()`: skip the `useAuthorization` default. */
  public?: boolean;
  /** Set by `.rateLimit()`: this route's own limit, or `false` for none. */
  rateLimit?: RouteRateLimitOptions | false;
};

export type StaticFileOptions = {
  path?: string;
  prefix?: string;
};
