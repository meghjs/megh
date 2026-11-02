import { AppService, HttpExceptions, normalizePageRequest, paginated } from '@meghjs/core';
import type { CreateTodoDto, ListTodosQuery, UpdateTodoDto } from '../dtos/todo.dto';
import type { Todo } from '../models/todo';

/**
 * Todos kept in memory. Swap the array for a database (see the blog-orm
 * sample) without changing the controller.
 */
@AppService
export class TodoService {
  private todos: Todo[] = [];
  private nextId = 1;

  list(query: ListTodosQuery = {}) {
    const search = query.search?.toLowerCase();
    const matches = this.todos.filter(
      (t) =>
        (query.completed === undefined || t.completed === query.completed) &&
        (query.priority === undefined || t.priority === query.priority) &&
        (!search || t.title.toLowerCase().includes(search)),
    );
    const { page, perPage, offset } = normalizePageRequest(query);
    return paginated(matches.slice(offset, offset + perPage), matches.length, page, perPage);
  }

  find(id: number): Todo {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) throw HttpExceptions.notFound(`Todo ${id} not found`);
    return todo;
  }

  create(input: CreateTodoDto): Todo {
    const todo: Todo = {
      id: this.nextId++,
      title: input.title,
      completed: input.completed ?? false,
      priority: input.priority ?? 'medium',
      dueDate: input.dueDate ?? null,
      createdAt: new Date().toISOString(),
    };
    this.todos.push(todo);
    return todo;
  }

  update(id: number, changes: UpdateTodoDto): Todo {
    const todo = this.find(id);
    Object.assign(todo, changes);
    return todo;
  }

  remove(id: number): void {
    this.find(id);
    this.todos = this.todos.filter((t) => t.id !== id);
  }

  /** Delete every completed todo; returns how many were removed. */
  clearCompleted(): { removed: number } {
    const before = this.todos.length;
    this.todos = this.todos.filter((t) => !t.completed);
    return { removed: before - this.todos.length };
  }

  stats() {
    const done = this.todos.filter((t) => t.completed).length;
    return { total: this.todos.length, completed: done, open: this.todos.length - done };
  }
}
