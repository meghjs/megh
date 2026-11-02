import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../src/app';

// Boots the real app (routing, validation, error handling) on a random port
// and sends requests in-process with Fastify's inject().
describe('Todo API (e2e)', () => {
  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await app.run(0);
  });

  afterAll(async () => {
    await app.close();
  });

  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.app.inject({ method, url, payload });

  it('creates, reads, updates and deletes a todo', async () => {
    const created = await request('POST', '/todos', { title: 'Write docs', priority: 'high' });
    // `@HttpCode(201)` is not applied by Megh yet, so success is always 200.
    expect(created.statusCode).toBe(200);
    const todo = created.json();
    expect(todo).toMatchObject({ title: 'Write docs', priority: 'high', completed: false });

    expect((await request('GET', `/todos/${todo.id}`)).json().title).toBe('Write docs');

    const updated = await request('PATCH', `/todos/${todo.id}`, { completed: true });
    expect(updated.json().completed).toBe(true);

    expect((await request('DELETE', `/todos/${todo.id}`)).json()).toEqual({ deleted: true });
    expect((await request('GET', `/todos/${todo.id}`)).statusCode).toBe(404);
  });

  it('lists with query-string filters and pagination', async () => {
    for (const title of ['Milk', 'Eggs', 'Bread']) await request('POST', '/todos', { title });
    await request('POST', '/todos', { title: 'Done already', completed: true });

    const open = (await request('GET', '/todos?completed=false&perPage=2')).json();
    expect(open.data.map((t: any) => t.title)).toEqual(['Milk', 'Eggs']);
    expect(open.meta).toMatchObject({ total: 3, perPage: 2, next: 2 });

    expect((await request('GET', '/todos/stats')).json()).toEqual({ total: 4, completed: 1, open: 3 });
    expect((await request('DELETE', '/todos/completed')).json()).toEqual({ removed: 1 });
  });

  it('rejects invalid input with 400', async () => {
    const missing = await request('POST', '/todos', { priority: 'urgent' });
    expect(missing.statusCode).toBe(400);
    expect(JSON.stringify(missing.json())).toContain('title');

    const unknown = await request('POST', '/todos', { title: 'x', owner: 'me' });
    expect(unknown.statusCode).toBe(400);

    expect((await request('GET', '/todos?perPage=500')).statusCode).toBe(400);
  });
});
