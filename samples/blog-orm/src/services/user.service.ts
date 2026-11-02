import { AppService } from '@meghjs/core';
import type { CreateUserDto, PageQuery, UpdateUserDto } from '../dtos/blog.dto';
import { published } from '../models/post.model';
import { User } from '../models/user.model';

@AppService
export class UserService {
  /** Users with how many posts each has published: `posts_count`. */
  list(query: PageQuery) {
    return User.withCount('posts', (q) => q.scope(published))
      .orderBy('id')
      .paginate(query);
  }

  /** A user with their posts (newest first is up to the client) and comment count. */
  find(id: number) {
    return User.with('posts').withCount('comments').where('id', id).firstOrFail();
  }

  async create(input: CreateUserDto) {
    return User.create({ name: input.name, email: input.email, bio: input.bio ?? null });
  }

  /** `save()` writes only the columns that changed (and `updated_at`). */
  async update(id: number, changes: UpdateUserDto) {
    const user = await User.findOrFail(id);
    return user.fill(changes).save();
  }

  /** Users who have not written anything yet. */
  withoutPosts() {
    return User.whereDoesntHave('posts').orderBy('id').get();
  }
}
