import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { TaskFlowException } from '../exceptions/taskflow.exceptions';
import { ErrorResponse, ValidationErrorResponse } from '../../types/http-response.interface';
import { ValidationError } from 'class-validator';
import { v4 as uuidv4 } from 'uuid';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = uuidv4();

    // Set correlation ID header for request tracing
    response.setHeader('X-Correlation-ID', correlationId);

    let status: HttpStatus;
    let message: string;
    let errorCode: string;
    let details: any = null;
    let validationErrors: any[] = [];

    // Handle different types of exceptions
    if (exception instanceof TaskFlowException) {
      // Handle our custom exceptions
      status = exception.getStatus();
      message = exception.message;
      errorCode = exception.errorCode || 'UNKNOWN_ERROR';
      details = exception.details;
    } else if (exception instanceof HttpException) {
      // Handle standard NestJS HTTP exceptions
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as any;
        message = responseObj.message || exception.message;
        errorCode = responseObj.error || 'HTTP_EXCEPTION';
        
        // Handle validation errors specifically
        if (responseObj.message && Array.isArray(responseObj.message)) {
          validationErrors = this.formatValidationErrors(responseObj.message);
          message = 'Validation failed';
          errorCode = 'VALIDATION_ERROR';
        }
      } else {
        message = exceptionResponse as string || exception.message;
        errorCode = 'HTTP_EXCEPTION';
      }
    } else if (exception instanceof QueryFailedError) {
      // Handle database errors
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Database operation failed';
      errorCode = 'DATABASE_ERROR';
      
      // Parse specific database errors
      const dbError = exception as any;
      if (dbError.code === '23505') {
        status = HttpStatus.CONFLICT;
        message = 'Resource already exists';
        errorCode = 'DUPLICATE_RESOURCE';
      } else if (dbError.code === '23503') {
        status = HttpStatus.BAD_REQUEST;
        message = 'Foreign key constraint violation';
        errorCode = 'FOREIGN_KEY_VIOLATION';
      } else if (dbError.code === '23502') {
        status = HttpStatus.BAD_REQUEST;
        message = 'Required field missing';
        errorCode = 'NOT_NULL_VIOLATION';
      }
      
      // Don't expose sensitive database details in production
      if (process.env.NODE_ENV !== 'development') {
        details = { hint: 'Check your request data and try again' };
      } else {
        details = {
          query: dbError.query,
          parameters: dbError.parameters,
          constraint: dbError.constraint,
        };
      }
    } else if (exception instanceof Error) {
      // Handle generic errors
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = process.env.NODE_ENV === 'development' 
        ? exception.message 
        : 'Internal server error';
      errorCode = 'INTERNAL_ERROR';
      
      if (process.env.NODE_ENV === 'development') {
        details = {
          stack: exception.stack,
          name: exception.name,
        };
      }
    } else {
      // Handle unknown exceptions
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unexpected error occurred';
      errorCode = 'UNKNOWN_ERROR';
    }

    // Create error response
    const errorResponse: ErrorResponse = {
      success: false,
      error: errorCode,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      statusCode: status,
      correlationId,
    };

    // Add details if available
    if (details) {
      errorResponse.details = details;
    }

    // Handle validation errors specially
    if (validationErrors.length > 0) {
      const validationResponse: ValidationErrorResponse = {
        ...errorResponse,
        validationErrors,
      };
      
      this.logError(exception, request, correlationId, status);
      response.status(status).json(validationResponse);
      return;
    }

    // Log the error with appropriate level
    this.logError(exception, request, correlationId, status);

    // Send error response
    response.status(status).json(errorResponse);
  }

  /**
   * Format validation errors for consistent response structure
   */
  private formatValidationErrors(errors: any[]): any[] {
    const formattedErrors: any[] = [];

    for (const error of errors) {
      if (error instanceof ValidationError) {
        formattedErrors.push({
          field: error.property,
          value: error.value,
          constraints: error.constraints ? Object.values(error.constraints) : [],
        });
      } else if (typeof error === 'string') {
        // Handle string-based validation errors
        formattedErrors.push({
          field: 'unknown',
          value: null,
          constraints: [error],
        });
      } else if (error.property && error.constraints) {
        // Handle object-based validation errors
        formattedErrors.push({
          field: error.property,
          value: error.value,
          constraints: Object.values(error.constraints),
        });
      }
    }

    return formattedErrors;
  }

  /**
   * Log error with appropriate level based on status code
   */
  private logError(
    exception: unknown,
    request: Request,
    correlationId: string,
    status: HttpStatus,
  ): void {
    const errorInfo = {
      correlationId,
      method: request.method,
      url: request.url,
      userAgent: request.get('User-Agent'),
      ip: request.ip,
      status,
      userId: (request as any).user?.id || 'anonymous',
    };

    const message = `HTTP ${status} - ${request.method} ${request.url}`;

    // Log based on severity
    if (status >= 500) {
      this.logger.error(message, {
        exception: exception instanceof Error ? exception.stack : exception,
        ...errorInfo,
      });
    } else if (status >= 400) {
      this.logger.warn(message, {
        exception: exception instanceof Error ? exception.message : exception,
        ...errorInfo,
      });
    } else {
      this.logger.debug(message, errorInfo);
    }
  }
}