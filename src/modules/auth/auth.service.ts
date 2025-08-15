import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { CacheService } from '@common/services/cache.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtConfiguration } from '@config/jwt.config';
import { JwtPayload } from './strategies/jwt.strategy';
import { 
  AuthenticationException, 
  DuplicateResourceException,
  BusinessLogicException,
  ValidationException 
} from '@common/exceptions/taskflow.exceptions';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  tokens: AuthTokens;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenId: string;
  type: 'refresh';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtConfig: JwtConfiguration;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {
    this.jwtConfig = this.configService.get<JwtConfiguration>('jwt')!;
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const { email, password } = loginDto;

    try {
      // Check for brute force protection
      await this.checkBruteForceProtection(email);

      // Find user by email
      const user = await this.usersService.findByEmail(email);
      
      if (!user) {
        await this.recordFailedAttempt(email);
        throw new AuthenticationException('Invalid credentials');
      }

      // Validate password
      const passwordValid = await bcrypt.compare(password, user.password);
      
      if (!passwordValid) {
        await this.recordFailedAttempt(email);
        throw new AuthenticationException('Invalid credentials');
      }

      // Clear failed attempts on successful login
      await this.clearFailedAttempts(email);

      // Generate tokens
      const tokens = await this.generateTokens(user);

      // Log successful login for audit
      this.logger.log('User login successful', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        tokens,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Login failed', {
        email,
        error: errorMessage,
      });
      throw error;
    }
  }

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const { email, password, name } = registerDto;

    try {
      // Check if user already exists
      const existingUser = await this.usersService.findByEmail(email);
      
      if (existingUser) {
        throw new DuplicateResourceException('User', 'email', email);
      }

      // Validate password strength
      this.validatePasswordStrength(password);

      // Create user
      const user = await this.usersService.create({
        email,
        password,
        name,
        role: 'user', // Default role
      });

      // Generate tokens
      const tokens = await this.generateTokens(user);

      // Log successful registration for audit
      this.logger.log('User registration successful', {
        userId: user.id,
        email: user.email,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        tokens,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Registration failed', {
        email,
        error: errorMessage,
      });
      throw error;
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.jwtConfig.JWT_SECRET,
      }) as RefreshTokenPayload;

      // Validate refresh token payload
      if (payload.type !== 'refresh') {
        throw new AuthenticationException('Invalid token type');
      }

      // Check if refresh token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(payload.tokenId);
      if (isBlacklisted) {
        throw new AuthenticationException('Token has been revoked');
      }

      // Get user
      const user = await this.usersService.findOne(payload.sub);
      if (!user) {
        throw new AuthenticationException('User not found');
      }

      // Blacklist the old refresh token
      await this.blacklistToken(payload.tokenId, this.jwtConfig.JWT_REFRESH_TOKEN_TTL);

      // Generate new tokens
      const tokens = await this.generateTokens(user);

      this.logger.log('Token refresh successful', {
        userId: user.id,
        oldTokenId: payload.tokenId,
      });

      return tokens;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Token refresh failed', {
        error: errorMessage,
      });
      
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new AuthenticationException('Refresh token expired');
      }
      
      if (error instanceof Error && error.name === 'JsonWebTokenError') {
        throw new AuthenticationException('Invalid refresh token');
      }
      
      throw error;
    }
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    try {
      if (refreshToken) {
        // Extract token ID and blacklist it
        const payload = this.jwtService.decode(refreshToken) as RefreshTokenPayload;
        if (payload?.tokenId) {
          await this.blacklistToken(payload.tokenId, this.jwtConfig.JWT_REFRESH_TOKEN_TTL);
        }
      }

      // Clear any user-specific cache
      await this.cacheService.delPattern(`user:${userId}:*`);

      this.logger.log('User logout successful', { userId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Logout failed', {
        userId,
        error: errorMessage,
      });
      throw error;
    }
  }

  async validateUser(userId: string): Promise<any> {
    try {
      const user = await this.usersService.findOne(userId);
      
      if (!user) {
        return null;
      }
      
      return {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('User validation failed', {
        userId,
        error: errorMessage,
      });
      return null;
    }
  }

  private async generateTokens(user: any): Promise<AuthTokens> {
    const tokenId = uuidv4();
    
    // Access token payload
    const accessPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      iss: this.jwtConfig.JWT_ISSUER,
      aud: this.jwtConfig.JWT_AUDIENCE,
    };

    // Refresh token payload
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      tokenId,
      type: 'refresh',
    };

    // Generate tokens
    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: this.jwtConfig.JWT_ACCESS_TOKEN_EXPIRATION,
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: this.jwtConfig.JWT_REFRESH_TOKEN_EXPIRATION,
    });

    // Store refresh token metadata in cache for validation
    await this.cacheService.set(
      `refresh_token:${tokenId}`,
      {
        userId: user.id,
        issuedAt: Date.now(),
        userAgent: 'unknown', // You can pass this from request context
      },
      { ttl: this.jwtConfig.JWT_REFRESH_TOKEN_TTL, namespace: 'auth' }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.jwtConfig.JWT_ACCESS_TOKEN_TTL,
      tokenType: 'Bearer',
    };
  }

  private validatePasswordStrength(password: string): void {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    const errors: string[] = [];

    if (password.length < minLength) {
      errors.push(`Password must be at least ${minLength} characters long`);
    }

    if (!hasUpperCase) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (!hasLowerCase) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (!hasNumbers) {
      errors.push('Password must contain at least one number');
    }

    if (!hasSpecialChar) {
      errors.push('Password must contain at least one special character');
    }

    if (errors.length > 0) {
      throw new ValidationException('Password does not meet security requirements', errors);
    }
  }

  private async checkBruteForceProtection(email: string): Promise<void> {
    const failedAttempts = await this.cacheService.get<number>(`failed_attempts:${email}`, 'auth') || 0;
    const maxAttempts = 5;
    const lockoutDuration = 15 * 60; // 15 minutes

    if (failedAttempts >= maxAttempts) {
      const lockoutKey = `lockout:${email}`;
      const isLockedOut = await this.cacheService.exists(lockoutKey, 'auth');
      
      if (isLockedOut) {
        const ttl = await this.cacheService.ttl(lockoutKey, 'auth');
        throw new BusinessLogicException(
          `Account temporarily locked due to too many failed attempts. Try again in ${Math.ceil(ttl / 60)} minutes.`
        );
      }
    }
  }

  private async recordFailedAttempt(email: string): Promise<void> {
    const key = `failed_attempts:${email}`;
    const attempts = await this.cacheService.increment(key, 1, 'auth');
    
    // Set expiration for failed attempts counter (24 hours)
    if (attempts === 1) {
      await this.cacheService.expire(key, 24 * 60 * 60, 'auth');
    }

    // Lock account after max attempts
    if (attempts >= 5) {
      await this.cacheService.set(
        `lockout:${email}`,
        true,
        { ttl: 15 * 60, namespace: 'auth' } // 15 minutes lockout
      );
    }
  }

  private async clearFailedAttempts(email: string): Promise<void> {
    await this.cacheService.del(`failed_attempts:${email}`, 'auth');
    await this.cacheService.del(`lockout:${email}`, 'auth');
  }

  private async blacklistToken(tokenId: string, ttl: number): Promise<void> {
    await this.cacheService.set(
      `blacklist:${tokenId}`,
      true,
      { ttl, namespace: 'auth' }
    );
  }

  private async isTokenBlacklisted(tokenId: string): Promise<boolean> {
    return await this.cacheService.exists(`blacklist:${tokenId}`, 'auth');
  }
}