import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '@common/decorators/public.decorator';
import { CacheService } from '@common/services/cache.service';
import { DataSource } from 'typeorm';
import { HealthCheckResponse, MetricsResponse } from './types/http-response.interface';

@ApiTags('Health & Monitoring')
@Controller()
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'API root endpoint' })
  @ApiResponse({
    status: 200,
    description: 'API information',
    type: 'object',
  })
  getRoot() {
    return {
      message: 'TaskFlow API is running',
      version: process.env.npm_package_version || '1.0.0',
      environment: this.configService.get('app.NODE_ENV') || 'development',
      timestamp: new Date().toISOString(),
      endpoints: {
        health: '/health',
        metrics: '/metrics',
        auth: '/auth',
        tasks: '/tasks',
        users: '/users',
      },
    };
  }

  @Get('health')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Service health status',
    type: 'object',
  })
  async getHealth(): Promise<HealthCheckResponse> {
    const startTime = Date.now();
    
    // Check database health
    const dbCheck = await this.checkDatabase();
    
    // Check Redis health
    const redisCheck = await this.checkRedis();
    
    // Check queue health (simplified)
    const queueCheck = await this.checkQueues();
    
    const overallStatus = 
      dbCheck.status === 'healthy' && 
      redisCheck.status === 'healthy' && 
      queueCheck.status === 'healthy' 
        ? 'ok' 
        : 'error';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: this.configService.get('app.NODE_ENV') || 'development',
      checks: {
        database: dbCheck,
        redis: redisCheck,
        queues: queueCheck,
      },
    };
  }

  @Get('metrics')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Application metrics endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Application performance metrics',
    type: 'object',
  })
  async getMetrics(): Promise<MetricsResponse> {
    const cacheStats = this.cacheService.getStats();
    
    return {
      requests: {
        total: 0, // This would be tracked by a metrics service
        successful: 0,
        failed: 0,
        averageResponseTime: 0,
      },
      system: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        cpuUsage: process.cpuUsage(),
      },
      database: {
        activeConnections: this.dataSource.isInitialized ? 1 : 0,
        queriesExecuted: 0, // This would be tracked by a metrics service
        averageQueryTime: 0,
      },
      cache: {
        hitRate: cacheStats.hitRate,
        missRate: cacheStats.missRate,
        keysCount: cacheStats.totalRequests,
      },
    };
  }

  private async checkDatabase(): Promise<{ status: 'healthy' | 'unhealthy'; responseTime: number; message?: string }> {
    const startTime = Date.now();
    
    try {
      await this.dataSource.query('SELECT 1');
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'unhealthy',
        responseTime,
        message: error instanceof Error ? error.message : 'Database connection failed',
      };
    }
  }

  private async checkRedis(): Promise<{ status: 'healthy' | 'unhealthy'; responseTime: number; message?: string }> {
    return await this.cacheService.healthCheck();
  }

  private async checkQueues(): Promise<{ status: 'healthy' | 'unhealthy'; responseTime: number; message?: string }> {
    const startTime = Date.now();
    
    try {
      // This is a simplified check - in a real app you'd check queue connectivity
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'unhealthy',
        responseTime,
        message: error instanceof Error ? error.message : 'Queue connection failed',
      };
    }
  }
}