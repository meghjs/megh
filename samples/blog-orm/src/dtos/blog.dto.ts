import { PartialType } from '@meghjs/core';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// ── Users ────────────────────────────────────────────────────────────────

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}

// ── Posts ────────────────────────────────────────────────────────────────

export class CreatePostDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(1)
  body: string;

  /** Tag names; missing tags are created. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tags?: string[];

  /** Publish right away instead of saving a draft. */
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class UpdatePostDto extends PartialType(CreatePostDto) {}

export class CreateCommentDto {
  @IsInt()
  userId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body: string;
}

// ── Query strings ────────────────────────────────────────────────────────

export class PageQuery {
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

/** `GET /posts?status=published&tag=orm&author=1&search=kysely&page=2` */
export class ListPostsQuery extends PageQuery {
  @IsOptional()
  @IsIn(['published', 'draft', 'all'])
  status?: 'published' | 'draft' | 'all';

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  author?: number;

  @IsOptional()
  @IsString()
  search?: string;
}

/** `GET /posts/feed?cursor=…&perPage=10` */
export class FeedQuery {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  perPage?: number;
}
