# Pocket PDF cloud storage

## Quota and reservation model

The database row in `users` is the source of truth for each user's quota. New users receive 2,000,000,000 bytes and 100 documents, but an administrator can change one account without changing frontend code:

```sql
UPDATE users
SET storage_quota_bytes = 5000000000
WHERE id = ?;
```

`documents.size_bytes` is an integer. While a document is `pending` or `uploading`, it contributes to `storage_reserved_bytes` and `reserved_document_count`. A D1 trigger checks quota and updates those counters in the same SQLite `INSERT`, so concurrent upload intents cannot spend the same remaining capacity. Completion changes that document to `ready`; another trigger atomically converts reserved size to the actual R2 object size. A repeated completion sees `ready` and does not increment counters again.

Deletion first changes `ready` to `deleting`. The Worker then deletes the R2 object and only afterwards removes D1 metadata; the delete trigger releases used bytes. If R2 fails, `deleting` metadata remains available for retry.

## Cloudflare resources

1. Authenticate Wrangler and create the resources:

   ```bash
   npx wrangler login
   npx wrangler d1 create pocket-pdf
   npx wrangler r2 bucket create pocket-pdf
   ```

2. Replace the D1 database ID, Google web client ID and Cloudflare account ID placeholders in `wrangler.jsonc`.

3. In Cloudflare R2, create an S3 API token scoped to Object Read & Write for only the `pocket-pdf` bucket. Store the credentials as Worker secrets, never as `VITE_*` variables:

   ```bash
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   npx wrangler secret put ADMIN_SECRET
   ```

4. Replace the production origin in `r2-cors.json`, then apply and verify browser CORS:

   ```bash
   npx wrangler r2 bucket cors set pocket-pdf --file r2-cors.json
   npx wrangler r2 bucket cors list pocket-pdf
   ```

5. Apply the migration. Use `--local` for local Miniflare and `--remote` only after reviewing the migration and backup plan:

   ```bash
   npx wrangler d1 migrations apply pocket-pdf --local
   npx wrangler d1 migrations apply pocket-pdf --remote
   ```

6. Start the API and frontend in separate terminals:

   ```bash
   npx wrangler dev
   npm run dev
   ```

   Local `wrangler dev` simulates the D1/R2 bindings, but an S3 presigned URL points at Cloudflare's remote R2 endpoint. Therefore it is suitable for non-upload routes only. For an end-to-end browser PUT/GET, create dedicated staging D1 and R2 resources, use a staging Wrangler config whose `DB`, `PDF_BUCKET`, `R2_BUCKET_NAME`, credentials, and CORS all reference those same staging resources, apply migrations there, and run/deploy that staging Worker. Do not point development at production customer data.

The bindings are `DB` for D1 and `PDF_BUCKET` for the private R2 bucket. `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `GOOGLE_CLIENT_ID`, and `ALLOWED_ORIGIN` are non-secret Worker variables. The R2 keys and `ADMIN_SECRET` are secrets.

## API contract

All user routes require `Authorization: Bearer <Google ID token>`. The Worker verifies signature, issuer, expiry and audience, and uses the token `sub` as `user_id`.

- `GET /api/storage/usage` returns cached used/reserved bytes, counts, per-user limits, remaining bytes, ratio, warning, and `canUpload`.
- `GET /api/documents` lists the authenticated user's ready documents.
- `POST /api/documents/upload-intent` validates `{ name, sizeBytes, mimeType }`, creates the reservation, and returns a 10-minute PUT URL restricted to one object key, `application/pdf`, and `If-None-Match: *` so the URL cannot overwrite a completed object.
- `POST /api/documents/:id/upload-complete` performs R2 HEAD, verifies content type and `%PDF-` signature, then accounts for the actual R2 size.
- `DELETE /api/documents/:id/pending` cancels an unfinished upload and releases its reservation.
- `GET /api/documents/:id/download-url` returns a five-minute private R2 GET URL.
- `DELETE /api/documents/:id` performs retryable deletion and releases used quota only after R2 succeeds.
- `POST /api/admin/storage/reconcile` requires `X-Admin-Secret`; `{ "userId": "...", "apply": false }` is dry-run. Only literal `apply: true` repairs cached counters.

Typed upload errors are `INVALID_FILE_TYPE`, `INVALID_FILE_SIZE`, `FILE_TOO_LARGE`, `DOCUMENT_LIMIT_REACHED`, `STORAGE_QUOTA_EXCEEDED`, and `UPLOAD_NOT_FOUND`. Quota error bodies include the actual user limit and current counters.

## Expiration and operations

Upload reservations expire after 30 minutes. The cron trigger runs every 10 minutes and atomically claims an expired row as `canceling` before deleting R2, so it cannot race a completion into deleting a ready object. Cancellation replaces the old object with a zero-byte private tombstone before releasing quota; combined with signed `If-None-Match: *`, this prevents the still-live PUT URL from recreating unaccounted data. The tombstone is deleted after the reservation's 30-minute expiry, which is longer than the 10-minute URL lifetime. A failed R2 operation keeps the reservation and retry state, and repeating cleanup is safe.

Normal reads use cached counters and do not scan all documents. Reconciliation scans one requested user, supports dry-run, and treats `deleting` documents as still used until R2 deletion completes.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx wrangler deploy --dry-run
```

The Worker suite runs on Cloudflare's Vitest pool with local D1 and R2 bindings. Production readiness still requires manual Google Sign-In, R2 CORS, real presigned PUT/GET, cron, and rollback/monitoring checks against a non-production Cloudflare environment.
