import { Injectable, ExecutionContext, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { AuthenticationException } from '@common/exceptions/taskflow.exceptions';
import { Observable } from 'rxjs';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<T = any>(err: any, user: any, info: any, context: ExecutionContext): T {
    // Enhanced error handling with detailed logging
    if (err || !user) {
      const request = context.switchToHttp().getRequest();
      const authHeader = request.headers.authorization;
      
      this.logger.warn('Authentication failed', {
        error: err?.message || 'No user found',
        info: info?.message,
        endpoint: `${request.method} ${request.url}`,
        ip: request.ip,
        userAgent: request.get('User-Agent'),
        hasAuthHeader: !!authHeader,
        authHeaderFormat: authHeader ? (authHeader.startsWith('Bearer ') ? 'valid' : 'invalid') : 'none',
      });

      // Provide specific error messages based on the type of authentication failure
      if (info?.name === 'TokenExpiredError') {
        throw new AuthenticationException('Access token has expired');
      }
      
      if (info?.name === 'JsonWebTokenError') {
        throw new AuthenticationException('Invalid access token');
      }
      
      if (info?.name === 'NotBeforeError') {
        throw new AuthenticationException('Access token not active yet');
      }
      
      if (info?.message === 'No auth token') {
        throw new AuthenticationException('Access token required');
      }
      
      throw new AuthenticationException(err?.message || 'Authentication failed');
    }

    // Log successful authentication for audit purposes
    const request = context.switchToHttp().getRequest();
    this.logger.debug('Authentication successful', {
      userId: user.id,
      email: user.email,
      role: user.role,
      endpoint: `${request.method} ${request.url}`,
      ip: request.ip,
    });

    return user;
  }
}