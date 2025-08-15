import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

// Configuration imports
import appConfig from '@config/app.config';
import databaseConfig from '@config/database.config';
import jwtConfig from '@config/jwt.config';
import redisConfig from '@config/redis.config';

// Module imports
import { UsersModule } from './modules/users/users.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { AuthModule } from './modules/auth/auth.module';
import { TaskProcessorModule } from './queues/task-processor/task-processor.module';
import { ScheduledTasksModule } from './queues/scheduled-tasks/scheduled-tasks.module';

// Controllers
import { HealthController } from './health.controller';

// Common services and infrastructure
import { CacheService } from './common/services/cache.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ValidationPipe } from './common/pipes/validation.pipe';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';

@Module({
  imports: [
    // Configuration with validation
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig, databaseConfig, jwtConfig, redisConfig],
      envFilePath: ['.env.local', '.env'],
    }),
    
    // Database with enhanced configuration
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbConfig = configService.get('database');
        return {
          type: 'postgres',
          host: dbConfig.DB_HOST,
          port: dbConfig.DB_PORT,
          username: dbConfig.DB_USERNAME,
          password: dbConfig.DB_PASSWORD,
          database: dbConfig.DB_DATABASE,
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: false, // Always use migrations in production
          logging: configService.get('app.NODE_ENV') === 'development' ? ['query', 'error'] : ['error'],
          maxQueryExecutionTime: 1000, // Log slow queries
          // Connection pool configuration
          extra: {
            max: dbConfig.DB_CONNECTION_POOL_SIZE,
            connectionTimeoutMillis: dbConfig.DB_CONNECTION_TIMEOUT,
            idleTimeoutMillis: dbConfig.DB_IDLE_TIMEOUT,
          },
          // Database performance optimizations
          cache: {
            duration: 30000, // 30 seconds cache for TypeORM query results
          },
        };
      },
    }),
    
    // Scheduling for background tasks
    ScheduleModule.forRoot(),
    
    // Queue system with enhanced configuration
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisConf = configService.get('redis');
        return {
          connection: {
            host: redisConf.REDIS_HOST,
            port: redisConf.REDIS_PORT,
            password: redisConf.REDIS_PASSWORD,
            db: 1, // Use different DB for queues
            connectTimeout: redisConf.REDIS_CONNECT_TIMEOUT,
            commandTimeout: redisConf.REDIS_COMMAND_TIMEOUT,
            retryDelayOnFailover: redisConf.REDIS_RETRY_DELAY,
            maxRetriesPerRequest: redisConf.REDIS_RETRY_ATTEMPTS,
            // Queue-specific optimizations
            enableReadyCheck: true,
            lazyConnect: true,
            keepAlive: 30000,
          },
          defaultJobOptions: {
            removeOnComplete: 50, // Keep last 50 completed jobs
            removeOnFail: 100, // Keep last 100 failed jobs
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          },
        };
      },
    }),
    
    // Feature modules
    UsersModule,
    TasksModule,
    AuthModule,
    
    // Queue processing modules
    TaskProcessorModule,
    ScheduledTasksModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global cache service
    CacheService,
    
    // Global exception filter
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    
    // Global validation pipe
    {
      provide: APP_PIPE,
      useClass: ValidationPipe,
    },
    
    // Global logging interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    
    // Global authentication guard (with public route support)
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [CacheService],
})
export class AppModule {}