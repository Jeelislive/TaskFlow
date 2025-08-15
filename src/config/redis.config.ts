import { registerAs } from '@nestjs/config';
import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class RedisConfiguration {
  @IsString()
  @Transform(({ value }) => value || 'localhost')
  REDIS_HOST: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(65535)
  @Transform(({ value }) => parseInt(value, 10) || 6379)
  REDIS_PORT: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(15)
  @Transform(({ value }) => parseInt(value, 10) || 0)
  REDIS_DB: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1000)
  @Transform(({ value }) => parseInt(value, 10) || 10000)
  REDIS_CONNECT_TIMEOUT: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1000)
  @Transform(({ value }) => parseInt(value, 10) || 30000)  // Increased from 5000 to 30000
  REDIS_COMMAND_TIMEOUT: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 3)
  REDIS_RETRY_ATTEMPTS: number;

  @Type(() => Number)
  @IsNumber()
  @Min(100)
  @Transform(({ value }) => parseInt(value, 10) || 1000)
  REDIS_RETRY_DELAY: number;

  @Type(() => Number)
  @IsNumber()
  @Min(300)
  @Transform(({ value }) => parseInt(value, 10) || 3600)
  REDIS_DEFAULT_TTL: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 10)
  REDIS_MAX_CONNECTIONS: number;
}

export default registerAs('redis', () => {
  const config = new RedisConfiguration();
  
  config.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
  config.REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
  config.REDIS_PASSWORD = process.env.REDIS_PASSWORD;
  config.REDIS_DB = parseInt(process.env.REDIS_DB || '0', 10);
  config.REDIS_CONNECT_TIMEOUT = parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000', 10);
  config.REDIS_COMMAND_TIMEOUT = parseInt(process.env.REDIS_COMMAND_TIMEOUT || '30000', 10);  // Increased default
  config.REDIS_RETRY_ATTEMPTS = parseInt(process.env.REDIS_RETRY_ATTEMPTS || '3', 10);
  config.REDIS_RETRY_DELAY = parseInt(process.env.REDIS_RETRY_DELAY || '1000', 10);
  config.REDIS_DEFAULT_TTL = parseInt(process.env.REDIS_DEFAULT_TTL || '3600', 10);
  config.REDIS_MAX_CONNECTIONS = parseInt(process.env.REDIS_MAX_CONNECTIONS || '10', 10);
  
  return config;
});