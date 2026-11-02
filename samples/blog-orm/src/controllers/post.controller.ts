import { ApiController, Body, Delete, Get, Param, Patch, Post, Query } from '@meghjs/core';
import { CreateCommentDto, FeedQuery, ListPostsQuery, UpdatePostDto } from '../dtos/blog.dto';
import { PostService } from '../services/post.service';

@ApiController('/posts')
export class PostController {
  constructor(private readonly posts: PostService) {}

  /** `?status=published|draft|all&tag=&author=&search=&page=&perPage=` */
  @Get()
  list(@Query() query: ListPostsQuery) {
    return this.posts.list(query);
  }

  /** Cursor-paginated feed: pass `meta.nextCursor` back as `cursor`. */
  @Get('/feed')
  feed(@Query() query: FeedQuery) {
    return this.posts.feed(query);
  }

  /** Soft-deleted posts. */
  @Get('/trash')
  trash() {
    return this.posts.trash();
  }

  @Get('/:id')
  find(@Param('id') id: number) {
    return this.posts.find(Number(id));
  }

  @Patch('/:id')
  update(@Param('id') id: number, @Body() body: UpdatePostDto) {
    return this.posts.update(Number(id), body);
  }

  @Delete('/:id')
  remove(@Param('id') id: number) {
    return this.posts.remove(Number(id));
  }

  @Post('/:id/restore')
  restore(@Param('id') id: number) {
    return this.posts.restore(Number(id));
  }

  @Post('/:id/comments')
  comment(@Param('id') id: number, @Body() body: CreateCommentDto) {
    return this.posts.comment(Number(id), body);
  }
}
