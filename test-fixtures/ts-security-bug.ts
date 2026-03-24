import { db } from './db';

export async function getUser(id: string) {
  const result = await db.query('SELECT * FROM users WHERE id = ' + id); // BUG: SQL injection
  const transform = eval(result.transform); // BUG: eval with untrusted input
  return transform(result.rows);
}
