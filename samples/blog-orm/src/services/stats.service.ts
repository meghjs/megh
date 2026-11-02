import { AppService } from '@meghjs/core';
import { Post, drafts, published } from '../models/post.model';
import { Tag } from '../models/tag.model';
import { User } from '../models/user.model';

@AppService
export class StatsService {
  /** Aggregates, counts and relation filters in one dashboard. */
  async summary() {
    const [users, publishedPosts, draftPosts, trashed, totalViews, averageViews, mostViews, lastPublishedAt] =
      await Promise.all([
        User.count(),
        Post.scope(published).count(),
        Post.scope(drafts).count(),
        Post.onlyTrashed().count(),
        Post.sum('views'),
        Post.avg('views'),
        Post.max('views'),
        Post.max('published_at'), // a Date: the column's cast applies
      ]);

    const authors = await User.whereHas('posts', (q) => q.scope(published))
      .withCount('posts', (q) => q.scope(published))
      .get();
    const tags = await Tag.withCount('posts').get();

    return {
      users,
      posts: { published: publishedPosts, drafts: draftPosts, trashed },
      views: { total: totalViews, average: averageViews, max: mostViews },
      lastPublishedAt,
      topAuthors: authors
        .sort((a, b) => b.posts_count - a.posts_count)
        .slice(0, 3)
        .map((u) => ({ id: u.id, name: u.name, posts: u.posts_count })),
      tags: tags
        .filter((t) => t.posts_count > 0)
        .sort((a, b) => b.posts_count - a.posts_count)
        .map((t) => ({ name: t.name, posts: t.posts_count })),
    };
  }
}
