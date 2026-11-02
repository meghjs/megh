import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@meghjs/core';
import { TodoService } from './todo.service';

describe('TodoService', () => {
  let service: TodoService;

  beforeEach(() => {
    service = new TodoService();
  });

  it('creates todos with defaults', () => {
    const todo = service.create({ title: 'Buy milk' });
    expect(todo).toMatchObject({ id: 1, title: 'Buy milk', completed: false, priority: 'medium', dueDate: null });
  });

  it('filters, searches and paginates', () => {
    service.create({ title: 'Buy milk', priority: 'high' });
    service.create({ title: 'Walk dog', completed: true });
    service.create({ title: 'Buy bread' });

    expect(service.list({ search: 'buy' }).data.map((t) => t.title)).toEqual(['Buy milk', 'Buy bread']);
    expect(service.list({ completed: true }).data).toHaveLength(1);
    expect(service.list({ priority: 'high' }).data[0].title).toBe('Buy milk');

    const page = service.list({ page: 2, perPage: 2 });
    expect(page.data.map((t) => t.id)).toEqual([3]);
    expect(page.meta).toMatchObject({ total: 3, page: 2, lastPage: 2, prev: 1, next: null });
  });

  it('updates, removes and clears completed todos', () => {
    const a = service.create({ title: 'A' });
    service.create({ title: 'B', completed: true });

    expect(service.update(a.id, { completed: true }).completed).toBe(true);
    expect(service.stats()).toEqual({ total: 2, completed: 2, open: 0 });
    expect(service.clearCompleted()).toEqual({ removed: 2 });
    expect(() => service.remove(a.id)).toThrow(NotFoundException);
  });
});
