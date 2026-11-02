import { AppService, type CreateInput, type PageRequest, type UpdateInput } from '@meghjs/core';
import { Category } from '../models/category.model';

@AppService
export class CategoryService {
  /** Every category, ordered by id. */
  findAll() {
    return Category.query().orderBy('id').get();
  }

  /** One page of category rows: `{ data, meta }`. */
  paginate(request: PageRequest = {}) {
    return Category.query().orderBy('id').paginate(request);
  }

  /** The category with this id, or `undefined`. */
  find(id: number) {
    return Category.find(id);
  }

  /** The category with this id; throws a 404 when there is none. */
  findOrFail(id: number) {
    return Category.findOrFail(id);
  }

  create(input: CreateInput<typeof Category>) {
    return Category.create(input);
  }

  /** `save()` writes only the columns that changed. */
  async update(id: number, changes: UpdateInput<Category>) {
    const category = await Category.findOrFail(id);
    // A DTO instance holds `undefined` for every field that was not sent.
    const sent = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    return category.fill(sent).save();
  }

  async delete(id: number) {
    const category = await Category.findOrFail(id);
    await category.delete();
  }
}
