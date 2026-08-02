import { AwsClient } from 'aws4fetch'
import {
  DOWNLOAD_URL_TTL_SECONDS,
  PDF_MIME_TYPE,
  UPLOAD_URL_TTL_SECONDS,
} from './constants'
import type { Env } from './types'

function objectUrl(env: Env, objectKey: string): URL {
  const encodedKey = objectKey
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  return new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(env.R2_BUCKET_NAME)}/${encodedKey}`,
  )
}

function createR2Client(env: Env): AwsClient {
  return new AwsClient({
    service: 's3',
    region: 'auto',
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  })
}

export async function createPresignedUploadUrl(
  env: Env,
  objectKey: string,
): Promise<string> {
  const url = objectUrl(env, objectKey)
  url.searchParams.set('X-Amz-Expires', String(UPLOAD_URL_TTL_SECONDS))
  const signed = await createR2Client(env).sign(
    new Request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': PDF_MIME_TYPE,
        'If-None-Match': '*',
      },
    }),
    { aws: { signQuery: true } },
  )
  return signed.url
}

export async function createPresignedDownloadUrl(
  env: Env,
  objectKey: string,
): Promise<string> {
  const url = objectUrl(env, objectKey)
  url.searchParams.set('X-Amz-Expires', String(DOWNLOAD_URL_TTL_SECONDS))
  const signed = await createR2Client(env).sign(new Request(url), {
    aws: { signQuery: true },
  })
  return signed.url
}
