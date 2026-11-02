import { AppService, Model, type Row } from '@meghjs/core';
import type { CreateCommentDto, CreatePostDto, FeedQuery, ListPostsQuery, UpdatePostDto } from '../dtos/blog.dto';
import { Post, byAuthor, drafts, published, tagged } from '../models/post.model';
import { Tag } from '../models/tag.model';
import { User } from '../models/user.model';

@AppService
export class PostService {
  /**
   * Filterable, paginated list. Each post carries its author and tags
   * (eager-loaded: one query per relation) and `comments_count`.
   */
  list(query: ListPostsQuery) {
    const posts = Post.with('author', 'tags').withCount('comments').orderBy('id', 'desc');
    const status = query.status ?? 'published';
    if (status === 'published') posts.scope(published);
    if (status === 'draft') posts.scope(drafts);
    if (query.tag) posts.scope(tagged, query.tag);
    if (query.author) posts.scope(byAuthor, query.author);
    if (query.search) posts.where('title', 'like', `%${query.search}%`);
    return posts.paginate(query);
  }

  /** Infinite-scroll feed of published posts, newest first, by cursor. */
  feed(query: FeedQuery) {
    return Post.scope(published)
      .with('author')
      .cursorPaginate({ cursor: query.cursor, perPage: query.perPage ?? 10, direction: 'desc' });
  }

  /** One post with everything a post page needs. Counts the view. */
  async find(id: number) {
    const post = await Post.with('author', 'tags', 'comments.author').where('id', id).firstOrFail();
    post.views += 1;
    await post.save(); // UPDATE posts SET views = ?, updated_at = ? WHERE id = ?
    return post;
  }

  /**
   * Create a post for a user, with its tags, in one transaction: if tagging
   * fails, the post is not created either.
   */
  async create(userId: number, input: CreatePostDto) {
    const id = await Model.transaction(async () => {
      const user = await User.findOrFail(userId);
      // related() fills in posts.user_id.
      const post = await user.related('posts').create({
        title: input.title,
        body: input.body,
        published_at: input.publish ? new Date() : null,
      });
      if (input.tags) await this.syncTags(post, input.tags);
      return post.id;
    });
    return this.load(id);
  }

  async update(id: number, changes: UpdatePostDto) {
    await Model.transaction(async () => {
      const post = await Post.findOrFail(id);
      if (changes.title !== undefined) post.title = changes.title;
      if (changes.body !== undefined) post.body = changes.body;
      if (changes.publish !== undefined) post.published_at = changes.publish ? (post.published_at ?? new Date()) : null;
      await post.save();
      if (changes.tags) await this.syncTags(post, changes.tags);
    });
    return this.load(id);
  }

  /** Soft delete: the row stays, with `deleted_at` set, and drops out of queries. */
  async remove(id: number) {
    const post = await Post.findOrFail(id);
    await post.delete();
    return { deleted: true };
  }

  trash() {
    return Post.onlyTrashed().orderBy('deleted_at', 'desc').get();
  }

  async restore(id: number) {
    const post = await Post.onlyTrashed().where('id', id).firstOrFail();
    await post.restore();
    return this.load(id);
  }

  async comment(postId: number, input: CreateCommentDto) {
    const post = await Post.findOrFail(postId);
    await User.findOrFail(input.userId);
    return post.related('comments').create({ user_id: input.userId, body: input.body });
  }

  /** Make the post's tags exactly `names`, creating tags that don't exist. */
  private async syncTags(post: Row<Post>, names: string[]) {
    const ids: number[] = [];
    for (const name of [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))]) {
      const tag = (await Tag.findBy('name', name)) ?? (await Tag.create({ name }));
      ids.push(tag.id);
    }
    await post.related('tags').sync(ids); // attaches the missing, detaches the rest
  }

  private load(id: number) {
    return Post.with('author', 'tags').withCount('comments').where('id', id).firstOrFail();
  }
}
