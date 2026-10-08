import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, isAppError } from '../../domain/errors.js';
import type { AppDependencies } from '../types.js';

interface FastifyLikeError {
  readonly statusCode?: number;
  readonly validation?: unknown;
  readonly message?: string;
}

/**
 * Single error boundary. Converts typed domain errors into a consistent
 * envelope, maps framework validation errors, and — crucially — turns any
 * unknown error into a generic 500 so no stack trace or internal detail leaks
 * to a client. The full error is always logged with the request id.
 */
export function registerErrorHandler(app: FastifyInstance, deps: AppDependencies): void {
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    if (isAppError(error)) {
      if (error.httpStatus >= 500) {
        deps.logger.error({ requestId, code: error.code, err: error }, 'application error');
      }
      return reply.status(error.httpStatus).send({
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          requestId,
          details: { issues: error.issues },
        },
      });
    }

    const fastifyError = error as FastifyLikeError;
    if (fastifyError.validation) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: fastifyError.message ?? 'Request validation failed',
          requestId,
          details: { validation: fastifyError.validation },
        },
      });
    }

    const statusCode = fastifyError.statusCode ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code: statusCode === 429 ? 'rate_limited' : 'request_error',
          message: fastifyError.message ?? 'Request error',
          requestId,
        },
      });
    }

    deps.logger.error({ requestId, err: error }, 'unhandled error');
    return reply.status(500).send({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred',
        requestId,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: { code: 'not_found', message: 'Route not found', requestId: request.id },
    });
  });
}

export function isOperational(error: unknown): error is AppError {
  return error instanceof AppError;
}
