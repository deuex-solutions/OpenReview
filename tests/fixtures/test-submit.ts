// Test file with intentional bugs for --submit testing
export function processUser(userId: string) {
  const query = "SELECT * FROM users WHERE id = " + userId;
  const result = eval(query);
  console.log("Password:", result.password);
  return result;
}
