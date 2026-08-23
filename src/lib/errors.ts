export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export const errorResponse = (error: unknown) => {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
        },
      },
    };
  }

  // Supabase/PostgREST errors are plain objects rather than Error instances.
  // Log only their safe diagnostic fields; never dump request headers, tokens,
  // or arbitrary payloads into Worker logs.
  const diagnostic =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : typeof error === 'object' && error !== null
        ? {
            code:
              'code' in error && typeof error.code === 'string'
                ? error.code
                : undefined,
            message:
              'message' in error && typeof error.message === 'string'
                ? error.message
                : undefined,
            hint:
              'hint' in error && typeof error.hint === 'string'
                ? error.hint
                : undefined,
          }
        : { message: 'Unknown non-object error' };

  console.error('Unexpected application error', diagnostic);

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      },
    },
  };
};
