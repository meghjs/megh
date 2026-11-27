/**
 * @copyright 2024
 * @author Tareq Hossain
 * @email xtrinsic96@gmail.com
 * @url https://github.com/xtareq
 */
import { MeghApplication } from "./application";
import { Container } from "../di";
import { constructWith } from "../di/container";
import { Constructor } from "../common/helpers";
import {
  MeghApplicationOptions,
  TestApplication,
  TestAppOptions,
} from "./interfaces";
import { InjectOptions } from "fastify";

export class MeghTest {
  private constructor() {
    process.env.NODE_ENV = "test";
  }

  /**
   * A new controller instance. `deps[i]` replaces constructor parameter `i`;
   * the rest are resolved from the container. Nothing is registered, so the
   * doubles don't leak into other tests.
   */
  static getController<T>(controller: Constructor<T>, deps: any[] = []): T {
    return constructWith(controller, deps);
  }

  /** A new service instance, built like {@link MeghTest.getController}. */
  static getProvider<T>(service: Constructor<T>, deps: any[] = []): T {
    return constructWith(service, deps);
  }

  static createTestApplication(options: TestAppOptions) {
    const app = MeghApplication.getInternalApp();
    // We need to cast options.controllers to any or Constructor[] for compatibility
    if (options.controllers) {
      app.useControllers(options.controllers as Constructor[]);
    }
    return MeghTest.from(app);
  }

  static from(app: MeghApplication): TestApplication {
    // Controller routes are registered asynchronously; every request waits
    // for that, so none can reach Fastify before its route exists. A mapping
    // error is rethrown by each request.
    const mapped: Promise<void> = (app as any)._mapControllers();
    mapped.catch(() => {}); // reported through the requests, not as unhandled

    // Same error handling as production, filters included.
    app.installErrorHandling();

    const request =
      (method: InjectOptions["method"]) =>
      async (url: string, options?: InjectOptions) => {
        await mapped;
        return app.inject({ method, url, ...options });
      };

    return {
      get: request("GET"),
      post: request("POST"),
      put: request("PUT"),
      patch: request("PATCH"),
      delete: request("DELETE"),
      options: request("OPTIONS"),
      getController: <T>(controller: Constructor<T>, deps: any[] = []) => {
        return MeghTest.getController(controller, deps);
      },
    };
  }

  static clean() {
    Container.reset();
  }
}

export class Megh {
  static createApplication(options?: MeghApplicationOptions) {
    const app = MeghApplication.getApp(options);
    return app;
  }
  static createTestApplication(options: TestAppOptions) {
    const app = MeghTest.createTestApplication(options);
    return app;
  }
}
