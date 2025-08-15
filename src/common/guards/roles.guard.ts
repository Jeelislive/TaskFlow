import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationException } from '@common/exceptions/taskflow.exceptions';

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  MANAGER = 'manager',
}

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      this.logger.warn('No user found in request for role authorization', {
        endpoint: `${request.method} ${request.url}`,
        requiredRoles,
      });
      throw new AuthorizationException('User not authenticated');
    }

    const hasRole = requiredRoles.some((role) => user.role === role);

    if (!hasRole) {
      this.logger.warn('Access denied - insufficient permissions', {
        userId: user.id,
        userRole: user.role,
        requiredRoles,
        endpoint: `${request.method} ${request.url}`,
        ip: request.ip,
      });
      
      throw new AuthorizationException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}. User role: ${user.role}`
      );
    }

    this.logger.debug('Role authorization successful', {
      userId: user.id,
      userRole: user.role,
      requiredRoles,
      endpoint: `${request.method} ${request.url}`,
    });

    return true;
  }
}