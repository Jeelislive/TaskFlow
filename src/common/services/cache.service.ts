import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisConfiguration } from '@config/redis.config';

export interface CacheOptions {
  ttl?: number;
  namespace?: string;
}

export interface CacheKey {
  key: string;
  namespace?: string;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis;
  private readonly config: RedisConfiguration;
  private readonly defaultTtl: number;
  private readonly keyPrefix: string;

  // Cache statistics for monitoring
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
  };

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get<RedisConfiguration>('redis')!;
    this.defaultTtl = this.config.REDIS_DEFAULT_TTL;
    this.keyPrefix = 'taskflow:cache:';
  }

  async onModuleInit(): Promise<void> {
    try {
      this.redis = new Redis({
        host: this.config.REDIS_HOST,
        port: this.config.REDIS_PORT,
        password: this.config.REDIS_PASSWORD,
        db: this.config.REDIS_DB,
        connectTimeout: this.config.REDIS_CONNECT_TIMEOUT,
        commandTimeout: this.config.REDIS_COMMAND_TIMEOUT,
        maxRetriesPerRequest: this.config.REDIS_RETRY_ATTEMPTS,
        lazyConnect: true,
        keyPrefix: this.keyPrefix,
        enableReadyCheck: true,
        enableOfflineQueue: false,
        // Connection pool settings
        family: 4, // Force IPv4
        keepAlive: 30000,
      });

      // Connection event handlers
      this.redis.on('connect', () => {
        this.logger.log('Redis connection established');
      });

      this.redis.on('ready', () => {
        this.logger.log('Redis client ready');
      });

      this.redis.on('error', (error) => {
        this.logger.error('Redis connection error:', error);
        this.stats.errors++;
      });

      this.redis.on('close', () => {
        this.logger.warn('Redis connection closed');
      });

      this.redis.on('reconnecting', () => {
        this.logger.log('Redis reconnecting...');
      });

      await this.redis.connect();
      this.logger.log('Cache service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize cache service:', error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.logger.log('Cache service destroyed');
    }
  }

  /**
   * Generate a cache key with optional namespace
   */
  private generateKey(key: string, namespace?: string): string {
    return namespace ? `${namespace}:${key}` : key;
  }

  /**
   * Set a value in cache with optional TTL
   */
  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    try {
      const cacheKey = this.generateKey(key, options?.namespace);
      const serializedValue = JSON.stringify(value);
      const ttl = options?.ttl || this.defaultTtl;

      await this.redis.setex(cacheKey, ttl, serializedValue);
      this.stats.sets++;
      
      this.logger.debug(`Cache SET: ${cacheKey} (TTL: ${ttl}s)`);
    } catch (error) {
      this.logger.error(`Cache SET failed for key ${key}:`, error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string, namespace?: string): Promise<T | null> {
    try {
      const cacheKey = this.generateKey(key, namespace);
      const value = await this.redis.get(cacheKey);

      if (value === null) {
        this.stats.misses++;
        this.logger.debug(`Cache MISS: ${cacheKey}`);
        return null;
      }

      this.stats.hits++;
      this.logger.debug(`Cache HIT: ${cacheKey}`);
      return JSON.parse(value);
    } catch (error) {
      this.logger.error(`Cache GET failed for key ${key}:`, error);
      this.stats.errors++;
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Delete a value from cache
   */
  async del(key: string, namespace?: string): Promise<number> {
    try {
      const cacheKey = this.generateKey(key, namespace);
      const result = await this.redis.del(cacheKey);
      this.stats.deletes++;
      
      this.logger.debug(`Cache DEL: ${cacheKey}`);
      return result;
    } catch (error) {
      this.logger.error(`Cache DEL failed for key ${key}:`, error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async delPattern(pattern: string, namespace?: string): Promise<number> {
    try {
      const searchPattern = this.generateKey(pattern, namespace);
      const keys = await this.redis.keys(searchPattern);
      
      if (keys.length === 0) {
        return 0;
      }

      // Remove the key prefix since Redis.del expects unprefixed keys
      const unprefixedKeys = keys.map(key => key.replace(this.keyPrefix, ''));
      const result = await this.redis.del(...unprefixedKeys);
      this.stats.deletes += result;
      
      this.logger.debug(`Cache DEL PATTERN: ${searchPattern} (${result} keys deleted)`);
      return result;
    } catch (error) {
      this.logger.error(`Cache DEL PATTERN failed for pattern ${pattern}:`, error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string, namespace?: string): Promise<boolean> {
    try {
      const cacheKey = this.generateKey(key, namespace);
      const result = await this.redis.exists(cacheKey);
      return result === 1;
    } catch (error) {
      this.logger.error(`Cache EXISTS failed for key ${key}:`, error);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Set TTL for existing key
   */
  async expire(key: string, ttl: number, namespace?: string): Promise<boolean> {
    try {
      const cacheKey = this.generateKey(key, namespace);
      const result = await this.redis.expire(cacheKey, ttl);
      return result === 1;
    } catch (error) {
      this.logger.error(`Cache EXPIRE failed for key ${key}:`, error);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Get remaining TTL for a key
   */
  async ttl(key: string, namespace?: string): Promise<number> {
    try {
      const cacheKey = this.generateKey(key, namespace);
      return await this.redis.ttl(cacheKey);
    } catch (error) {
      this.logger.error(`Cache TTL failed for key ${key}:`, error);
      this.stats.errors++;
      return -1;
    }
  }

  /**
   * Increment a numeric value atomically
   */
  async increment(key: string, amount = 1, namespace?: string): Promise<number> {
    try {
      const cacheKey = this.generateKey(key, namespace);
      return await this.redis.incrby(cacheKey, amount);
    } catch (error) {
      this.logger.error(`Cache INCREMENT failed for key ${key}:`, error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Set with advanced options (NX, EX, etc.)
   */
  async setAdvanced(key: string, value: any, options: {
    ttl?: number;
    namespace?: string;
    onlyIfNotExists?: boolean;
    onlyIfExists?: boolean;
  }): Promise<boolean> {
    try {
      const cacheKey = this.generateKey(key, options.namespace);
      const serializedValue = JSON.stringify(value);
      
      if (options.onlyIfNotExists) {
        const result = await this.redis.set(cacheKey, serializedValue, 'EX', options.ttl || this.defaultTtl, 'NX');
        this.stats.sets++;
        return result === 'OK';
      } else if (options.onlyIfExists) {
        const result = await this.redis.set(cacheKey, serializedValue, 'EX', options.ttl || this.defaultTtl, 'XX');
        this.stats.sets++;
        return result === 'OK';
      } else {
        await this.redis.setex(cacheKey, options.ttl || this.defaultTtl, serializedValue);
        this.stats.sets++;
        return true;
      }
    } catch (error) {
      this.logger.error(`Cache SET ADVANCED failed for key ${key}:`, error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    const missRate = total > 0 ? (this.stats.misses / total) * 100 : 0;

    return {
      ...this.stats,
      hitRate: Number(hitRate.toFixed(2)),
      missRate: Number(missRate.toFixed(2)),
      totalRequests: total,
    };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
    };
  }

  /**
   * Flush all cache data
   */
  async flush(): Promise<void> {
    try {
      await this.redis.flushdb();
      this.logger.warn('Cache flushed');
    } catch (error) {
      this.logger.error('Cache FLUSH failed:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get Redis client for advanced operations
   */
  getClient(): Redis {
    return this.redis;
  }

  /**
   * Health check for cache service
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; responseTime: number; message?: string }> {
    const startTime = Date.now();
    
    try {
      await this.redis.ping();
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
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}