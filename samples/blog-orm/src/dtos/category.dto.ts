import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** `POST /categories` body. Columns the database fills in are optional. */
export class CreateCategoryDto {
  @IsString()
  name!: string;
}

/** `PUT /categories/:id` body: only the columns sent are changed. */
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;
}

/** `GET /categories?page=1&perPage=10` */
export class ListCategoriesQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;
}
