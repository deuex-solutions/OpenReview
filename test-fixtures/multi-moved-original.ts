// This file will be "deleted" in the PR
export function formatName(user: { first: string; last: string }): string {
  return user.first + ' ' + user.last;
}
