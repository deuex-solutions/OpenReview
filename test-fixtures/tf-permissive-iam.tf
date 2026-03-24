resource "aws_iam_role_policy" "app" {
  name = "app-policy"
  role = aws_iam_role.app.id
  policy = jsonencode({
    Statement = [{
      Effect   = "Allow"
      Action   = "*"       # BUG: wildcard action
      Resource = "*"       # BUG: wildcard resource
    }]
  })
}
