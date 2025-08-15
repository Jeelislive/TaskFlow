import { registerAs } from '@nestjs/config';
import { IsString, IsNumber, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class JwtConfiguration {
  @IsString()
  JWT_SECRET: string;

  @IsString()
  @Transform(({ value }) => value || '15m')
  JWT_ACCESS_TOKEN_EXPIRATION: string;

  @IsString()
  @Transform(({ value }) => value || '7d')
  JWT_REFRESH_TOKEN_EXPIRATION: string;

  @IsString()
  @Transform(({ value }) => value || 'taskflow')
  JWT_ISSUER: string;

  @IsString()
  @Transform(({ value }) => value || 'taskflow-client')
  JWT_AUDIENCE: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10) || 5)
  JWT_MAX_REFRESH_ATTEMPTS: number;

  @Type(() => Number)
  @IsNumber()
  @Min(300)
  @Transform(({ value }) => parseInt(value, 10) || 900)
  JWT_ACCESS_TOKEN_TTL: number;

  @Type(() => Number)
  @IsNumber()
  @Min(86400)
  @Transform(({ value }) => parseInt(value, 10) || 604800)
  JWT_REFRESH_TOKEN_TTL: number;
}

export default registerAs('jwt', () => {
  const config = new JwtConfiguration();
  
  config.JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
  config.JWT_ACCESS_TOKEN_EXPIRATION = process.env.JWT_ACCESS_TOKEN_EXPIRATION || '15m';
  config.JWT_REFRESH_TOKEN_EXPIRATION = process.env.JWT_REFRESH_TOKEN_EXPIRATION || '7d';
  config.JWT_ISSUER = process.env.JWT_ISSUER || 'taskflow';
  config.JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'taskflow-client';
  config.JWT_MAX_REFRESH_ATTEMPTS = parseInt(process.env.JWT_MAX_REFRESH_ATTEMPTS || '5', 10);
  config.JWT_ACCESS_TOKEN_TTL = parseInt(process.env.JWT_ACCESS_TOKEN_TTL || '900', 10); // 15 minutes
  config.JWT_REFRESH_TOKEN_TTL = parseInt(process.env.JWT_REFRESH_TOKEN_TTL || '604800', 10); // 7 days
  
  return config;
});