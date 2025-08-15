import { registerAs } from '@nestjs/config';
import { IsEnum, IsNumber, IsString, IsOptional, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class AppConfiguration {
  @IsEnum(Environment)
  @Transform(({ value }) => value || Environment.Development)
  NODE_ENV: Environment;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(65535)
  @Transform(({ value }) => parseInt(value, 10) || 3000)
  PORT: number;

  @IsString()
  @Transform(({ value }) => value || 'taskflow-api')
  APP_NAME: string;

  @IsString()
  @Transform(({ value }) => value || '1.0.0')
  APP_VERSION: string;

  @IsOptional()
  @IsString()
  CORS_ORIGIN?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 10)
  DEFAULT_PAGE_SIZE: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  @Transform(({ value }) => parseInt(value, 10) || 100)
  MAX_PAGE_SIZE: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1000)
  @Transform(({ value }) => parseInt(value, 10) || 30000)
  REQUEST_TIMEOUT: number;
}

export default registerAs('app', () => {
  const config = new AppConfiguration();
  
  config.NODE_ENV = process.env.NODE_ENV as Environment || Environment.Development;
  config.PORT = parseInt(process.env.PORT || '3000', 10);
  config.APP_NAME = process.env.APP_NAME || 'taskflow-api';
  config.APP_VERSION = process.env.APP_VERSION || '1.0.0';
  config.CORS_ORIGIN = process.env.CORS_ORIGIN;
  config.DEFAULT_PAGE_SIZE = parseInt(process.env.DEFAULT_PAGE_SIZE || '10', 10);
  config.MAX_PAGE_SIZE = parseInt(process.env.MAX_PAGE_SIZE || '100', 10);
  config.REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '30000', 10);
  
  return config;
});