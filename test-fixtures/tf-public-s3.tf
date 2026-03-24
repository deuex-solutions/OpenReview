resource "aws_s3_bucket" "data" {
  bucket = "company-data-prod"
  acl    = "public-read"  # BUG: publicly accessible
}

resource "aws_s3_bucket_policy" "data" {
  bucket = aws_s3_bucket.data.id
  # BUG: no encryption, no versioning, no logging
}
