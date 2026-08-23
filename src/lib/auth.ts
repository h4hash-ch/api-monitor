import { createClient } from '@supabase/supabase-js';
import type { Env } from '../env';
import { AppError } from './errors';

export const serviceClient = (env: Env) =>
  createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

export async function authenticatedUser(
  request: Request,
  env: Env
) {
  const token = request.headers
    .get('Authorization')
    ?.replace(/^Bearer\s+/i, '');

  if (!token) {
    throw new AppError(
      401,
      'UNAUTHORIZED',
      'Authentication is required.'
    );
  }

  const client = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  const { data, error } = await client.auth.getUser(token);

  if (error || !data.user) {
    throw new AppError(
      401,
      'UNAUTHORIZED',
      'Authentication is invalid or expired.'
    );
  }

  return data.user;
}