import { ApiController, Body, Delete, Get, Param, Patch, Post, Query } from '@meghjs/core';
import { CreateTodoDto, ListTodosQuery, UpdateTodoDto } from '../dtos/todo.dto';
import { TodoService } from '../services/todo.service';

@ApiController('/todos')
export class TodoController {
  constructor(private readonly todos: TodoService) {}

  /** Paginated, filterable list: `{ data, meta }`. */
  @Get()
  list(@Query() query: ListTodosQuery) {
    return this.todos.list(query);
  }

  @Get('/stats')
  stats() {
    return this.todos.stats();
  }

  @Get('/:id')
  find(@Param('id') id: number) {
    return this.todos.find(Number(id));
  }

  @Post()
  create(@Body() body: CreateTodoDto) {
    return this.todos.create(body);
  }

  @Patch('/:id')
  update(@Param('id') id: number, @Body() body: UpdateTodoDto) {
    return this.todos.update(Number(id), body);
  }

  @Delete('/completed')
  clearCompleted() {
    return this.todos.clearCompleted();
  }

  @Delete('/:id')
  remove(@Param('id') id: number) {
    this.todos.remove(Number(id));
    return { deleted: true };
  }
}
