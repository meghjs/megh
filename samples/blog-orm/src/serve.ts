import { Environment, inject } from '@meghjs/core';
import app from './app';

async function serve() {
  const env = inject(Environment);
  const port = Number(env.get('PORT')) || 4000;
  await app.run(port);
}

serve();
