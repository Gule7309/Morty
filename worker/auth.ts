import { createRemoteJWKSet, jwtVerify } from 'jose'
import { ApiError } from './errors'
import type { Env, UserIdentity } from './types'

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
)

export async function authenticateRequest(
  request: Request,
  env: Env,
): Promise<UserIdentity> {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw new ApiError('UNAUTHORIZED', '請先使用 Google 登入。')
  }

  const token = authorization.slice('Bearer '.length).trim()

  try {
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
      audience: env.GOOGLE_CLIENT_ID,
      issuer: ['accounts.google.com', 'https://accounts.google.com'],
      algorithms: ['RS256'],
    })

    if (!payload.sub) {
      throw new Error('Google ID token has no subject')
    }

    return {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    }
  } catch {
    throw new ApiError(
      'UNAUTHORIZED',
      'Google 登入資訊無效或已過期，請重新登入。',
    )
  }
}

