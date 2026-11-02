import { ApiController, Body, Delete, Get, Param, Post, Put, Query } from '@meghjs/core';
import { CreateCategoryDto, ListCategoriesQuery, UpdateCategoryDto } from '../dtos/category.dto';
import { CategoryService } from '../services/category.service';

@ApiController('/categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  index(@Query() query: ListCategoriesQuery) {
    return this.categoryService.paginate(query);
  }

  @Get('/:id')
  show(@Param('id') id: number) {
    return this.categoryService.findOrFail(Number(id));
  }

  @Post()
  create(@Body() body: CreateCategoryDto) {
    return this.categoryService.create(body);
  }

  @Put('/:id')
  update(@Param('id') id: number, @Body() body: UpdateCategoryDto) {
    return this.categoryService.update(Number(id), body);
  }

  @Delete('/:id')
  async delete(@Param('id') id: number) {
    await this.categoryService.delete(Number(id));
    return { message: 'Category deleted.' };
  }
}
