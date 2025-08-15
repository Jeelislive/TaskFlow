import { registerAs } from '@nestjs/config';
import { IsString, IsNumber, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class DatabaseConfiguration {
  @IsString()
  DB_HOST: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(65535)
  DB_PORT: number;

  @IsString()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  DB_DATABASE: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 10)
  DB_CONNECTION_POOL_SIZE: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1000)
  @Transform(({ value }) => parseInt(value, 10) || 30000)
  DB_CONNECTION_TIMEOUT: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1000)
  @Transform(({ value }) => parseInt(value, 10) || 600000)
  DB_IDLE_TIMEOUT: number;
}

export default registerAs('database', () => {
  const config = new DatabaseConfiguration();
  
  config.DB_HOST = process.env.DB_HOST || 'localhost';
  config.DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
  config.DB_USERNAME = process.env.DB_USERNAME || 'postgres';
  config.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
  config.DB_DATABASE = process.env.DB_DATABASE || 'taskflow';
  config.DB_CONNECTION_POOL_SIZE = parseInt(process.env.DB_CONNECTION_POOL_SIZE || '10', 10);
  config.DB_CONNECTION_TIMEOUT = parseInt(process.env.DB_CONNECTION_TIMEOUT || '30000', 10);
  config.DB_IDLE_TIMEOUT = parseInt(process.env.DB_IDLE_TIMEOUT || '600000', 10);
  
  return config;
});