import { Megh } from '@meghjs/core';
import { HomeController } from './controllers/home.controller';
import { TodoController } from './controllers/todo.controller';
import { OpenApiConfig } from './config/openapi.config';

const app = Megh.createApplication();

if (app.isDevelopment()) {
  app.useOpenApi(OpenApiConfig);
}

app.useControllers([HomeController, TodoController]);

export default app;
