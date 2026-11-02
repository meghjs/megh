import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Migrations, type Migration } from '@meghjs/core';
import app from '../src/app';
import db from '../src/database/connection';
import { seed } from '../src/database/seed';

// The real migration files, bundled by Vite, keyed by name.
const migrationModules = import.meta.glob<Migration>('../src/database/migrations/*.ts', { eager: true });
const migrations = Object.fromEntries(
  Object.entries(migrationModules).map(([file, mod]) => [file.split('/').pop()!.replace(/\.ts$/, ''), mod]),
);

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = async (method: Method, url: string, payload?: object) => {
  const res = await app.app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
};

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await new Migrations(db, { migrations }).latest(); // DB_FILE=:memory: (vitest.e2e.config.mts)
  await seed(db);
  await app.run(0);
});

afterAll(async () => {
  await app.close(); // also destroys the database connection
});

describe('posts', () => {
  it('lists published posts with author, tags and comment counts', async () => {
    const { status, body } = await call('GET', '/posts?perPage=2');
    expect(status).toBe(200);
    expect(body.meta).toMatchObject({ total: 4, page: 1, perPage: 2, lastPage: 2 });
    const [first] = body.data;
    expect(first).toMatchObject({ title: 'Soft deletes in practice', comments_count: 1 });
    expect(first.author).toMatchObject({ name: 'Linus' });
    expect(first.tags.map((t: any) => t.name)).toEqual(['orm']);
    expect(first.tags[0].pivot.tagged_at).toBeTruthy();
  });

  it('filters by status, tag, author and title', async () => {
    const titles = async (qs: string) => (await call('GET', `/posts?${qs}`)).body.data.map((p: any) => p.title);
    expect(await titles('status=draft')).toEqual(['Draft: transactions and savepoints']);
    expect(await titles('tag=performance')).toEqual(['Cursor pagination explained', 'Eager loading without N+1 queries']);
    expect(await titles('author=1&search=Megh')).toEqual(['Getting started with the Megh ORM']);
    expect((await call('GET', '/posts?status=everything')).status).toBe(400);
  });

  it('walks the feed by cursor', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const qs: string = cursor ? `?perPage=3&cursor=${cursor}` : '?perPage=3';
      const { body } = await call('GET', `/posts/feed${qs}`);
      seen.push(...body.data.map((p: any) => p.title));
      cursor = body.meta.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(4);
    expect(seen[0]).toBe('Soft deletes in practice');
  });

  it('shows a post with nested comments and counts the view', async () => {
    const first = await call('GET', '/posts/1');
    expect(first.body.comments[0]).toMatchObject({ body: 'Nice write-up!', author: { name: 'Linus' } });
    const again = await call('GET', '/posts/1');
    expect(again.body.views).toBe(first.body.views + 1);
    expect((await call('GET', '/posts/999')).status).toBe(404);
  });

  it('creates a post with tags for a user, then updates and publishes it', async () => {
    const created = await call('POST', '/users/3/posts', {
      title: 'Hello from Grace',
      body: 'First post.',
      tags: ['Intro', 'megh'],
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ user_id: 3, published_at: null, comments_count: 0 });
    expect(created.body.tags.map((t: any) => t.name).sort()).toEqual(['intro', 'megh']);

    const updated = await call('PATCH', `/posts/${created.body.id}`, { tags: ['megh'], publish: true });
    expect(updated.body.tags.map((t: any) => t.name)).toEqual(['megh']);
    expect(updated.body.published_at).not.toBeNull();

    expect((await call('POST', '/users/999/posts', { title: 'x', body: 'y' })).status).toBe(404);
    expect((await call('POST', '/users/1/posts', { title: '' })).status).toBe(400);
  });

  it('soft-deletes and restores', async () => {
    expect((await call('DELETE', '/posts/2')).body).toEqual({ deleted: true });
    expect((await call('GET', '/posts/2')).status).toBe(404);
    expect((await call('GET', '/posts/trash')).body.map((p: any) => p.id)).toEqual([2]);

    const restored = await call('POST', '/posts/2/restore');
    expect(restored.body).toMatchObject({ id: 2, deleted_at: null });
    expect((await call('GET', '/posts/trash')).body).toEqual([]);
  });

  it('adds comments', async () => {
    const res = await call('POST', '/posts/1/comments', { userId: 3, body: 'Thanks!' });
    expect(res.body).toMatchObject({ post_id: 1, user_id: 3, body: 'Thanks!' });
  });
});

describe('users and stats', () => {
  it('lists users with published post counts', async () => {
    const { body } = await call('GET', '/users');
    expect(body.data.map((u: any) => [u.name, u.posts_count])).toEqual([
      ['Ada', 2],
      ['Linus', 2],
      ['Grace', 1],
    ]);
    expect(body.data[0].is_admin).toBe(false); // boolean cast
  });

  it('creates and updates users', async () => {
    const created = await call('POST', '/users', { name: 'Alan', email: 'alan@example.com' });
    expect(created.body).toMatchObject({ name: 'Alan', bio: null, is_admin: false });
    const updated = await call('PATCH', `/users/${created.body.id}`, { bio: 'Hi' });
    expect(updated.body.bio).toBe('Hi');
    expect((await call('GET', '/users/without-posts')).body.map((u: any) => u.name)).toEqual(['Alan']);
    expect((await call('POST', '/users', { name: 'Bad', email: 'not-an-email' })).status).toBe(400);
  });

  it('summarizes with aggregates', async () => {
    const { body } = await call('GET', '/stats');
    expect(body.users).toBe(4);
    expect(body.posts).toEqual({ published: 5, drafts: 1, trashed: 0 });
    expect(body.views.total).toBeGreaterThanOrEqual(257);
    expect(body.topAuthors[0]).toMatchObject({ name: expect.any(String), posts: 2 });
    expect(body.tags[0]).toEqual({ name: 'orm', posts: 4 });
    expect(typeof body.lastPublishedAt).toBe('string'); // a Date, serialized
  });
});
