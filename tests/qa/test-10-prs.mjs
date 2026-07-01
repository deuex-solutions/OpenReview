/* eslint-disable no-undef, no-console */
import { runFastReview } from '../../core/dist/index.mjs';

const testPRs = [
  {
    name: '1. TypeScript — Logic bug (off-by-one + assignment in condition)',
    expectedBugs: ['off-by-one', 'assignment'],
    pr: {
      owner: 'test', repo: 'test', prNumber: 1,
      metadata: { title: 'Fix pagination', body: '', headSha: 'a', baseSha: 'b', author: 'dev' },
      diff: `diff --git a/src/paginator.ts b/src/paginator.ts
--- a/src/paginator.ts
+++ b/src/paginator.ts
@@ -1,5 +1,12 @@
 export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
-  return items;
+  const start = page * pageSize;
+  const end = start + pageSize + 1;
+  const result = items.slice(start, end);
+  let total;
+  if (total = items.length) {
+    console.log('Total:', total);
+  }
+  return result;
 }
`,
      files: ['src/paginator.ts'], instructions: '', learnings: [],
    },
  },
  {
    name: '2. TypeScript — Security (SQL injection + eval)',
    expectedBugs: ['sql', 'eval'],
    pr: {
      owner: 'test', repo: 'test', prNumber: 2,
      metadata: { title: 'Add user lookup', body: '', headSha: 'a', baseSha: 'b', author: 'dev' },
      diff: `diff --git a/src/users.ts b/src/users.ts
--- a/src/users.ts
+++ b/src/users.ts
@@ -1,3 +1,8 @@
 import { db } from './db';
+
+export async function getUser(id: string) {
+  const result = await db.query('SELECT * FROM users WHERE id = ' + id);
+  const transform = eval(result.transform);
+  return transform(result.rows);
+}
`,
      files: ['src/users.ts'], instructions: '', learnings: [],
    },
  },
  {
    name: '3. Python — Logic bug (mutable default + is vs ==)',
    expectedBugs: ['mutable', 'is '],
    pr: {
      owner: 'test', repo: 'test', prNumber: 3,
      metadata: { title: 'Add cache', body: '', headSha: 'a', baseSha: 'b', author: 'dev' },
      diff: `diff --git a/utils/cache.py b/utils/cache.py
--- a/utils/cache.py
+++ b/utils/cache.py
@@ -1,2 +1,10 @@
-pass
+def get_or_create(key, cache={}):
+    if key is 'default':
+        return None
+    if key in cache:
+        return cache[key]
+    value = expensive_compute(key)
+    cache[key] = value
+    return value
`,
      files: ['utils/cache.py'], instructions: '', learnings: [],
    },
  },
  {
    name: '4. Python — Security (hardcoded API key)',
    expectedBugs: ['hardcoded', 'key'],
    pr: {
      owner: 'test', repo: 'test', prNumber: 4,
      metadata: { title: 'Add API client', body: '', headSha: 'a', baseSha: 'b', author: 'dev' },
      diff: `diff --git a/api/client.py b/api/client.py
--- a/api/client.py
+++ b/api/client.py
@@ -1,2 +1,8 @@
 import requests
+
+API_KEY = 'sk-prod-a8f3b2c1d4e5f6789012345678901234'
+
+def fetch_data(endpoint):
+    url = 'https://api.example.com/' + endpoint
+    response = requests.get(url, headers={'Authorization': API_KEY})
+    return response.json()
`,
      files: ['api/client.py'], instructions: '', learnings: [],
    },
  },
  {
    name: '5. Shell — Bash bug (unquoted vars + rm -rf)',
    expectedBugs: ['unquoted', 'rm'],
    pr: {
      owner: 'test', repo: 'test', prNumber: 5,
      metadata: { title: 'Deploy script', body: '', headSha: 'a', baseSha: 'b', author: 'dev' },
      diff: `diff --git a/deploy.sh b/deploy.sh
--- a/deploy.sh
+++ b/deploy.sh
@@ -1,2 +1,7 @@
 #!/bin/bash
+DEPLOY_DIR=/opt/app/$1
+rm -rf $DEPLOY_DIR/*
+cp -r build/* $DEPLOY_DIR
+cd $DEPLOY_DIR
+./restart.sh
`,
      files: ['deploy.sh'], instructions: '', learnings: [],
    },
  },
  {
    name: '6. Shell — Security (eval + chmod 777)',
    expectedBugs: ['eval', '777'],
    pr: {
      owner: 'test', repo: 'test', prNumber: 6,
      metadata: { title: 'Setup script', body: '', headSha: 'a', baseSha: 'b', author: 'dev' },
      diff: `diff --git a/setup.sh b/setup.sh
--- a/setup.sh
+++ b/setup.sh
@@ -1,2 +1,7 @@
 #!/bin/bash
+USER_INPUT=$1
+eval "echo Processing $USER_INPUT"
+echo "DB_PASSWORD=supersecret123" > /etc/app/config
+chmod 777 /etc/app/config
+curl -s "https://api.example.com/setup?name=$USER_INPUT" | bash
`,
      files: ['setup.sh'], instructions: '', learnings: [],
    },
  },
  {
    name: '7. Terraform — public S3 bucket',
    expectedBugs: ['public', 'acl'],
    pr: {
      owner: 'test', repo: 'test', prNumber: 7,
      metadata: { title: 'Add S3 bucket', body: '', headSha: 'a', baseSha: 'b', author: 'dev' },
      diff: `diff --git a/infra/s3.tf b/infra/s3.tf
--- a/infra/s3.tf
+++ b/infra/s3.tf
@@ -0,0 +1,8 @@
+resource "aws_s3_bucket" "data" {
+  bucket = "company-data-prod"
+  acl    = "public-read"
+}
+
+resource "aws_s3_bucket_policy" "data" {
+  bucket = aws_s3_bucket.data.id
+}
`,
      files: ['infra/s3.tf'], instructions: '', learnings: [],
    },
  },
  {
    name: '8. Terraform — overly permissive IAM (Action: *, Resource: *)',
    expectedBugs: ['permissive', 'wildcard'],
    pr: {
      owner: 'test', repo: 'test', prNumber: 8,
      metadata: { title: 'Add IAM role', body: '', headSha: 'a', baseSha: 'b', author: 'dev' },
      diff: `diff --git a/infra/iam.tf b/infra/iam.tf
--- a/infra/iam.tf
+++ b/infra/iam.tf
@@ -0,0 +1,10 @@
+resource "aws_iam_role_policy" "app" {
+  name = "app-policy"
+  role = aws_iam_role.app.id
+  policy = jsonencode({
+    Statement = [{
+      Effect   = "Allow"
+      Action   = "*"
+      Resource = "*"
+    }]
+  })
+}
`,
      files: ['infra/iam.tf'], instructions: '', learnings: [],
    },
  },
  {
    name: '9. Multi-file — moved code with type safety regression (any)',
    expectedBugs: ['any', 'type'],
    pr: {
      owner: 'test', repo: 'test', prNumber: 9,
      metadata: { title: 'Refactor utils', body: '', headSha: 'a', baseSha: 'b', author: 'dev' },
      diff: `diff --git a/src/utils.ts b/src/utils.ts
deleted file mode 100644
--- a/src/utils.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function formatName(user: { first: string; last: string }): string {
-  return user.first + ' ' + user.last;
-}
diff --git a/src/helpers/format.ts b/src/helpers/format.ts
new file mode 100644
--- /dev/null
+++ b/src/helpers/format.ts
@@ -0,0 +1,3 @@
+export function formatName(user: any): string {
+  return user.first.toUpperCase() + ' ' + user.last.toUpperCase();
+}
`,
      files: ['src/utils.ts', 'src/helpers/format.ts'], instructions: '', learnings: [],
    },
  },
  {
    name: '10. Multi-file — string vs number type mismatch across files',
    expectedBugs: ['string', 'number'],
    pr: {
      owner: 'test', repo: 'test', prNumber: 10,
      metadata: { title: 'Add order endpoint', body: '', headSha: 'a', baseSha: 'b', author: 'dev' },
      diff: `diff --git a/src/routes.ts b/src/routes.ts
--- a/src/routes.ts
+++ b/src/routes.ts
@@ -1,3 +1,4 @@
 import { getOrder } from './handlers';
+app.get('/order/:id', (req, res) => getOrder(req.params.id, res));

diff --git a/src/handlers.ts b/src/handlers.ts
--- a/src/handlers.ts
+++ b/src/handlers.ts
@@ -1,3 +1,6 @@
-export function getOrder() {}
+export function getOrder(orderId: number, res: any) {
+  const order = db.orders.find(o => o.id === orderId);
+  res.json(order);
+}
`,
      files: ['src/routes.ts', 'src/handlers.ts'], instructions: '', learnings: [],
    },
  },
];

console.log('=== SECTION 14: 10 TEST PR VALIDATION ===');
console.log();

let totalCaught = 0;

for (const test of testPRs) {
  const start = Date.now();
  try {
    const { findings, trace } = await runFastReview(test.pr);
    const dur = Date.now() - start;
    const caught = findings.length > 0;
    if (caught) totalCaught++;

    console.log((caught ? '✅' : '❌') + ' ' + test.name);
    console.log('   Findings: ' + findings.length + ' | Path: ' + trace.path + ' | ' + dur + 'ms');
    for (const f of findings) {
      console.log('   [' + f.severity + '] ' + f.file + ':' + f.startLine + ' — ' + f.title);
    }

    const allText = findings.map(f => (f.title + ' ' + f.explanation).toLowerCase());
    for (const expected of test.expectedBugs) {
      const found = allText.some(t => t.includes(expected.toLowerCase()));
      console.log('   ' + (found ? '🎯' : '⚠️') + ' Expected: "' + expected + '" → ' + (found ? 'CAUGHT' : 'MISSED'));
    }
    console.log();
  } catch (e) {
    console.log('❌ ' + test.name + ' — ERROR: ' + e.message?.slice(0, 150));
    console.log();
  }
}

console.log('========================================');
console.log('RESULT: ' + totalCaught + '/10 bugs caught (' + (totalCaught >= 8 ? '✅ PASS' : '❌ FAIL') + ' — target: ≥ 8)');
console.log('========================================');
