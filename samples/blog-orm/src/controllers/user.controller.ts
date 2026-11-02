import { ApiController, Body, Get, Param, Patch, Post, Query } from '@meghjs/core';
import { CreatePostDto, CreateUserDto, PageQuery, UpdateUserDto } from '../dtos/blog.dto';
import { PostService } from '../services/post.service';
import { UserService } from '../services/user.service';

@ApiController('/users')
export class UserController {
  constructor(
    private readonly users: UserService,
    private readonly posts: PostService,
  ) {}

  @Get()
  list(@Query() query: PageQuery) {
    return this.users.list(query);
  }

  @Get('/without-posts')
  withoutPosts() {
    return this.users.withoutPosts();
  }

  @Get('/:id')
  find(@Param('id') id: number) {
    return this.users.find(Number(id));
  }

  @Post()
  create(@Body() body: CreateUserDto) {
    return this.users.create(body);
  }

  @Patch('/:id')
  update(@Param('id') id: number, @Body() body: UpdateUserDto) {
    return this.users.update(Number(id), body);
  }

  /** Write a post as this user. */
  @Post('/:id/posts')
  createPost(@Param('id') id: number, @Body() body: CreatePostDto) {
    return this.posts.create(Number(id), body);
  }
}
