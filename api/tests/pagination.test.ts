import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { pageResult, parsePagination } from '../src/pagination';

test('pagination defaults to the first 25 records', () => {
  assert.deepEqual(parsePagination(), { page: 1, pageSize: 25, offset: 0 });
});

test('pagination computes an offset for a valid requested page', () => {
  assert.deepEqual(parsePagination('3', '50'), { page: 3, pageSize: 50, offset: 100 });
});

test('pagination rejects malformed or oversized requests', () => {
  for (const [page, pageSize] of [['0', '25'], ['1.5', '25'], ['1', '101'], ['1', '-1'], ['1e2', '25']]) {
    assert.throws(() => parsePagination(page, pageSize), BadRequestException);
  }
});

test('page results include accurate metadata for an empty page', () => {
  assert.deepEqual(pageResult([], 51, 3, 25), {
    items: [],
    total: 51,
    page: 3,
    pageSize: 25,
    totalPages: 3
  });
});
