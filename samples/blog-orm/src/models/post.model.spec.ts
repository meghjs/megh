import { describe, expect, it } from 'vitest';
import { Post } from './post.model';

// Model instances work without a database until you query or save.
describe('Post', () => {
  it('knows whether it is published', () => {
    expect(new Post().fill({ published_at: null }).isPublished).toBe(false);
    expect(new Post().fill({ published_at: new Date() }).isPublished).toBe(true);
  });

  it('serializes columns only, not unloaded relations', () => {
    const post = new Post().fill({ title: 'Hello', views: 3 });
    expect(post.toJSON()).toEqual({ title: 'Hello', views: 3 });
    expect(post.isPersisted()).toBe(false);
  });
});
