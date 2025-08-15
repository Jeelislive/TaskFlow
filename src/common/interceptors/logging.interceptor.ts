import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const correlationId = uuidv4();
    
    // Add correlation ID to request for tracing
    request.correlationId = correlationId;
    response.setHeader('X-Correlation-ID', correlationId);

    const { method, url, ip, headers } = request;
    const userAgent = headers['user-agent'] || '';
    const userId = request.user?.id || 'anonymous';
    
    const startTime = Date.now();

    this.logger.log(`Incoming Request: ${method} ${url}`, {
      correlationId,
      method,
      url,
      ip,
      userAgent,
      userId,
      timestamp: new Date().toISOString(),
    });

    return next.handle().pipe(
      tap((data) => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;
        
        this.logger.log(`Outgoing Response: ${method} ${url} - ${statusCode}`, {
          correlationId,
          method,
          url,
          statusCode,
          duration: `${duration}ms`,
          userId,
          timestamp: new Date().toISOString(),
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        const statusCode = error.status || 500;
        
        this.logger.error(`Error Response: ${method} ${url} - ${statusCode}`, {
          correlationId,
          method,
          url,
          statusCode,
          duration: `${duration}ms`,
          userId,
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString(),
        });
        
        throw error;
      }),
    );
  }
}