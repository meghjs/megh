import { Megh } from '@meghjs/core';
import { OpenApiConfig } from './config/openapi.config';
import { HomeController } from './controllers/home.controller';
import { PostController } from './controllers/post.controller';
import { StatsController } from './controllers/stats.controller';
import { UserController } from './controllers/user.controller';
import db from './database/connection';
import { CategoryController } from './controllers/category.controller';

const app = Megh.createApplication();

if (app.isDevelopment()) {
  app.useOpenApi(OpenApiConfig);
}

// Models use this connection; it is closed when the app shuts down.
app.useDatabase(db);

app.useControllers([HomeController, UserController, PostController, StatsController, CategoryController]);

export default app;
