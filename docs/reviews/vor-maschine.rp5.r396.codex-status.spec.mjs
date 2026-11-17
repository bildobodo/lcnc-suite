import { test, expect } from '@playwright/test';
test('expected assertion failure is not a passing assertion', () => {
  test.fail();
  expect(false).toBe(true);
});
test('both repeated instances must pass', ({}, info) => {
  expect(info.repeatEachIndex).toBe(1);
});
