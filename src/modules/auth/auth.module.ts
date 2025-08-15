import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { CacheService } from '@common/services/cache.service';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const jwtConfig = configService.get('jwt');
        console.log('JWT Config Debug:', jwtConfig); // Debug log
        return {
          secret: jwtConfig?.JWT_SECRET || 'fallback-secret-key-for-development',
          signOptions: {
            expiresIn: jwtConfig?.JWT_ACCESS_TOKEN_EXPIRATION || '15m',
            // Remove issuer and audience from here since they're set in the payload
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, CacheService],
  exports: [AuthService],
})
export class AuthModule {}