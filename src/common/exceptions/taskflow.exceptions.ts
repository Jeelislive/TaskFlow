import { HttpException, HttpStatus } from '@nestjs/common';

export class TaskFlowException extends HttpException {
  constructor(
    message: string,
    statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    public readonly errorCode?: string,
    public readonly details?: any,
  ) {
    super(message, statusCode);
    this.name = 'TaskFlowException';
  }
}

export class ValidationException extends TaskFlowException {
  constructor(message: string, validationErrors: any[] = []) {
    super(message, HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', validationErrors);
    this.name = 'ValidationException';
  }
}

export class AuthenticationException extends TaskFlowException {
  constructor(message: string = 'Authentication failed') {
    super(message, HttpStatus.UNAUTHORIZED, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationException';
  }
}

export class AuthorizationException extends TaskFlowException {
  constructor(message: string = 'Access denied') {
    super(message, HttpStatus.FORBIDDEN, 'AUTHORIZATION_ERROR');
    this.name = 'AuthorizationException';
  }
}

export class ResourceNotFoundException extends TaskFlowException {
  constructor(resource: string, identifier?: string) {
    const message = identifier 
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message, HttpStatus.NOT_FOUND, 'RESOURCE_NOT_FOUND');
    this.name = 'ResourceNotFoundException';
  }
}

export class DuplicateResourceException extends TaskFlowException {
  constructor(resource: string, field: string, value: string) {
    super(
      `${resource} with ${field} '${value}' already exists`,
      HttpStatus.CONFLICT,
      'DUPLICATE_RESOURCE',
    );
    this.name = 'DuplicateResourceException';
  }
}

export class BusinessLogicException extends TaskFlowException {
  constructor(message: string, errorCode?: string) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, errorCode || 'BUSINESS_LOGIC_ERROR');
    this.name = 'BusinessLogicException';
  }
}

export class DatabaseException extends TaskFlowException {
  constructor(message: string, originalError?: Error) {
    super(
      'Database operation failed',
      HttpStatus.INTERNAL_SERVER_ERROR,
      'DATABASE_ERROR',
      { originalMessage: message, originalError: originalError?.message },
    );
    this.name = 'DatabaseException';
  }
}

export class CacheException extends TaskFlowException {
  constructor(message: string, operation?: string) {
    super(
      'Cache operation failed',
      HttpStatus.INTERNAL_SERVER_ERROR,
      'CACHE_ERROR',
      { originalMessage: message, operation },
    );
    this.name = 'CacheException';
  }
}

export class QueueException extends TaskFlowException {
  constructor(message: string, queueName?: string) {
    super(
      'Queue operation failed',
      HttpStatus.INTERNAL_SERVER_ERROR,
      'QUEUE_ERROR',
      { originalMessage: message, queueName },
    );
    this.name = 'QueueException';
  }
}

export class RateLimitException extends TaskFlowException {
  constructor(limit: number, windowMs: number, retryAfter?: number) {
    super(
      `Rate limit exceeded. Maximum ${limit} requests per ${windowMs}ms`,
      HttpStatus.TOO_MANY_REQUESTS,
      'RATE_LIMIT_EXCEEDED',
      { limit, windowMs, retryAfter },
    );
    this.name = 'RateLimitException';
  }
}

export class CircuitBreakerException extends TaskFlowException {
  constructor(serviceName: string) {
    super(
      `Service ${serviceName} is temporarily unavailable`,
      HttpStatus.SERVICE_UNAVAILABLE,
      'CIRCUIT_BREAKER_OPEN',
      { serviceName },
    );
    this.name = 'CircuitBreakerException';
  }
}

export class TimeoutException extends TaskFlowException {
  constructor(operation: string, timeoutMs: number) {
    super(
      `Operation ${operation} timed out after ${timeoutMs}ms`,
      HttpStatus.REQUEST_TIMEOUT,
      'OPERATION_TIMEOUT',
      { operation, timeoutMs },
    );
    this.name = 'TimeoutException';
  }
}