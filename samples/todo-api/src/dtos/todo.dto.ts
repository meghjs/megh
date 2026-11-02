import { PartialType } from '@meghjs/core';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { Priority } from '../models/todo';

const PRIORITIES: Priority[] = ['low', 'medium', 'high'];

export class CreateTodoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: Priority;

  /** ISO date, e.g. `2026-12-31`. */
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

/** Every field optional, same rules. */
export class UpdateTodoDto extends PartialType(CreateTodoDto) {}

/** `GET /todos?page=1&perPage=20&completed=false&priority=high&search=milk` */
export class ListTodosQuery {
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

  // Query strings are text: "true"/"false" → boolean.
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: Priority;

  @IsOptional()
  @IsString()
  search?: string;
}
