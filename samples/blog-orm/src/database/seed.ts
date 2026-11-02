import 'reflect-metadata';
import { Model } from '@meghjs/core';
import { sql, type Kysely } from 'kysely';
import { Post } from '../models/post.model';
import { Tag } from '../models/tag.model';
import { User } from '../models/user.model';

/**
 * Fill the database with sample data, replacing what is there.
 * Run after `npm run db:migrate`: `npm run db:seed`.
 */
export async function seed(db: Kysely<any>): Promise<void> {
  Model.useConnection(db);
  await Model.transaction(async () => {
    for (const table of ['post_tag', 'comments', 'posts', 'tags', 'users']) {
      await sql`delete from ${sql.table(table)}`.execute(Model.db());
    }

    const ada = await User.create({ name: 'Ada', email: 'ada@example.com', bio: 'Writes about databases.' });
    const linus = await User.create({ name: 'Linus', email: 'linus@example.com' });
    await User.create({ name: 'Grace', email: 'grace@example.com', bio: 'Lurks, reads everything.' });

    const posts = [
      { author: ada, title: 'Getting started with the Megh ORM', tags: ['orm', 'megh'], views: 120, days: 30 },
      { author: ada, title: 'Eager loading without N+1 queries', tags: ['orm', 'performance'], views: 80, days: 20 },
      { author: linus, title: 'Cursor pagination explained', tags: ['performance', 'api'], views: 45, days: 10 },
      { author: linus, title: 'Soft deletes in practice', tags: ['orm'], views: 12, days: 2 },
      { author: ada, title: 'Draft: transactions and savepoints', tags: ['orm'], views: 0, days: null },
    ];

    for (const p of posts) {
      const post = await p.author.related('posts').create({
        title: p.title,
        body: `${p.title}. Lorem ipsum dolor sit amet.`,
        views: p.views,
        published_at: p.days === null ? null : new Date(Date.now() - p.days * 86_400_000),
      });
      const tagIds: number[] = [];
      for (const name of p.tags) {
        const tag = (await Tag.findBy('name', name)) ?? (await Tag.create({ name }));
        tagIds.push(tag.id);
      }
      await post.related('tags').attach(tagIds);
      await post.related('comments').create({ user_id: linus.id, body: 'Nice write-up!' });
    }
  });
}

// `node dist/database/seed.js`
if (require.main === module) {
  // Loaded here, not at the top, so tests can import seed() with their own database.
  if (require('fs').existsSync('.env')) process.loadEnvFile('.env');
  const db: Kysely<any> = require('./connection').default;
  seed(db)
    .then(async () => {
      console.log(`Seeded: ${await User.count()} users, ${await Post.count()} posts.`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => db.destroy());
}
