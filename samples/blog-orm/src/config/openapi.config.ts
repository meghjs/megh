import { AppConfig, MeghConfig, Environment, OpenApiUiOptions } from '@meghjs/core';

@AppConfig
export class OpenApiConfig extends MeghConfig<OpenApiUiOptions> {
  config(env: Environment): OpenApiUiOptions {
    return {
      info: {
        title: 'Blog Orm API',
        version: '0.0.1',
        description: 'API documentation for Blog Orm',
      },
      routePrefix: '/docs',
    };
  }
}
