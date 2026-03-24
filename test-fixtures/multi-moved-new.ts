// Moved from multi-moved-original.ts with type safety regression
export function formatName(user: any): string {  // BUG: typed params → any
  return user.first.toUpperCase() + ' ' + user.last.toUpperCase();
}
