import { BadRequestException } from '@nestjs/common';

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function parsePagination(page?: string, pageSize?: string): Pagination {
  if ((page !== undefined && !/^\d+$/.test(page)) ||
      (pageSize !== undefined && !/^\d+$/.test(pageSize))) {
    throw new BadRequestException('Page and page size must be whole numbers.');
  }
  const parsedPage = page === undefined ? 1 : Number(page);
  const parsedPageSize = pageSize === undefined ? 25 : Number(pageSize);
  const offset=(parsedPage-1)*parsedPageSize;
  if (!Number.isSafeInteger(parsedPage) || parsedPage < 1 || !Number.isSafeInteger(offset)) {
    throw new BadRequestException('Page must be a positive integer.');
  }
  if (!Number.isSafeInteger(parsedPageSize) || parsedPageSize < 1 || parsedPageSize > 100) {
    throw new BadRequestException('Page size must be between 1 and 100.');
  }
  return {
    page: parsedPage,
    pageSize: parsedPageSize,
    offset
  };
}

export function pageResult<T>(items: T[], total: number, page: number, pageSize: number): PageResult<T> {
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}
