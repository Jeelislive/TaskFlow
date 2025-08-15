import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { JwtConfiguration } from '@config/jwt.config';
import { AuthenticationException, ResourceNotFoundException } from '@common/exceptions/taskflow.exceptions';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly jwtConfig: JwtConfiguration;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const jwtConfig = configService.get<JwtConfiguration>('jwt');
    
    if (!jwtConfig) {
      throw new Error('JWT configuration not found');
    }
    
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.JWT_SECRET,
      issuer: jwtConfig.JWT_ISSUER,
      audience: jwtConfig.JWT_AUDIENCE,
      algorithms: ['HS256'],
    });

    this.jwtConfig = jwtConfig;
  }

  async validate(payload: JwtPayload) {
    try {
      // Validate payload structure
      if (!payload.sub || !payload.email || !payload.role) {
        this.logger.warn('Invalid JWT payload structure', { payload });
        throw new AuthenticationException('Invalid token payload');
      }

      // Verify token issuer and audience for additional security
      if (payload.iss && payload.iss !== this.jwtConfig.JWT_ISSUER) {
        this.logger.warn('Invalid JWT issuer', { expected: this.jwtConfig.JWT_ISSUER, received: payload.iss });
        throw new AuthenticationException('Invalid token issuer');
      }

      if (payload.aud && payload.aud !== this.jwtConfig.JWT_AUDIENCE) {
        this.logger.warn('Invalid JWT audience', { expected: this.jwtConfig.JWT_AUDIENCE, received: payload.aud });
        throw new AuthenticationException('Invalid token audience');
      }

      // Fetch user from database to ensure they still exist and are active
      const user = await this.usersService.findOne(payload.sub);
      
      if (!user) {
        this.logger.warn('User not found for valid JWT token', { userId: payload.sub });
        throw new ResourceNotFoundException('User', payload.sub);
      }

      // Check if user is active (if you have an active field)
      // if (!user.isActive) {
      //   throw new AuthenticationException('User account is deactivated');
      // }

      // Return user object that will be attached to request
      return {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        // Add any other user properties you need in the request context
      };
    } catch (error) {
      this.logger.error('JWT validation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: payload?.sub,
        email: payload?.email,
      });
      
      if (error instanceof AuthenticationException || error instanceof ResourceNotFoundException) {
        throw error;
      }
      
      throw new AuthenticationException('Token validation failed');
    }
  }
}