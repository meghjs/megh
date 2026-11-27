/**
 * Framework-internal access to the Fastify instance behind an application.
 * Not exported from the package: apps use `registerFastifyPlugin()`,
 * `inject()` and `address()`; plugins get it as `ctx.http`.
 */
import type { FastifyInstance } from "fastify";
import type { MeghApplication } from "./application";

export function fastifyOf(app: MeghApplication): FastifyInstance {
  return (app as unknown as { fastify: FastifyInstance }).fastify;
}
