export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = page * pageSize;
  const end = start + pageSize + 1; // BUG: off-by-one, should not have + 1
  const result = items.slice(start, end);

  let total;
  if (total = items.length) { // BUG: assignment instead of comparison
    console.log('Total:', total);
  }
  return result;
}
