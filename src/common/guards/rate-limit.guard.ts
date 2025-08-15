import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CacheService } from '@common/services/cache.service';
import { RateLimitException } from '@common/exceptions/taskflow.exceptions';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  skipIf?: (context: ExecutionContext) => boolean;
  keyGenerator?: (context: ExecutionContext) => string;
  message?: string;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cacheService: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rateLimitOptions = this.reflector.getAllAndOverride<RateLimitOptions>('rateLimit', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!rateLimitOptions) {
      return true;
    }

    // Allow skipping rate limit based on custom logic
    if (rateLimitOptions.skipIf && rateLimitOptions.skipIf(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Generate cache key for rate limiting
    const key = this.generateKey(context, rateLimitOptions);
    const windowStart = Math.floor(Date.now() / rateLimitOptions.windowMs) * rateLimitOptions.windowMs;
    const cacheKey = `rate_limit:${key}:${windowStart}`;

    try {
      // Get current request count
      const currentCount = await this.cacheService.get<number>(cacheKey, 'rate_limit') || 0;

      // Check if limit exceeded
      if (currentCount >= rateLimitOptions.limit) {
        const retryAfter = Math.ceil((windowStart + rateLimitOptions.windowMs - Date.now()) / 1000);
        
        // Set rate limit headers
        response.setHeader('X-RateLimit-Limit', rateLimitOptions.limit);
        response.setHeader('X-RateLimit-Remaining', 0);
        response.setHeader('X-RateLimit-Reset', new Date(windowStart + rateLimitOptions.windowMs).toISOString());
        response.setHeader('Retry-After', retryAfter);

        this.logger.warn('Rate limit exceeded', {
          key,
          currentCount,
          limit: rateLimitOptions.limit,
          windowMs: rateLimitOptions.windowMs,
          ip: request.ip,
          userAgent: request.get('User-Agent'),
          endpoint: `${request.method} ${request.url}`,
          userId: request.user?.id || 'anonymous',
        });

        throw new RateLimitException(
          rateLimitOptions.limit,
          rateLimitOptions.windowMs,
          retryAfter,
        );
      }

      // Increment request count
      const newCount = await this.incrementCounter(cacheKey, rateLimitOptions.windowMs);
      
      // Set rate limit headers
      const remaining = Math.max(0, rateLimitOptions.limit - newCount);
      response.setHeader('X-RateLimit-Limit', rateLimitOptions.limit);
      response.setHeader('X-RateLimit-Remaining', remaining);
      response.setHeader('X-RateLimit-Reset', new Date(windowStart + rateLimitOptions.windowMs).toISOString());

      this.logger.debug('Rate limit check passed', {
        key,
        currentCount: newCount,
        limit: rateLimitOptions.limit,
        remaining,
        endpoint: `${request.method} ${request.url}`,
      });

      return true;
    } catch (error) {
      if (error instanceof RateLimitException) {
        throw error;
      }

      this.logger.error('Rate limit check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
        endpoint: `${request.method} ${request.url}`,
      });

      // Fail open - allow request if rate limiting fails
      return true;
    }
  }

  private generateKey(context: ExecutionContext, options: RateLimitOptions): string {
    if (options.keyGenerator) {
      return options.keyGenerator(context);
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    // Use user ID if authenticated, otherwise use IP
    return user ? `user:${user.id}` : `ip:${request.ip}`;
  }

  private async incrementCounter(key: string, windowMs: number): Promise<number> {
    try {
      // Use Redis INCR for atomic increment
      const count = await this.cacheService.increment(key, 1, 'rate_limit');
      
      // Set expiration if this is the first increment
      if (count === 1) {
        await this.cacheService.expire(key, Math.ceil(windowMs / 1000), 'rate_limit');
      }
      
      return count;
    } catch (error) {
      this.logger.error('Failed to increment rate limit counter', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
      });
      throw error;
    }
  }
}