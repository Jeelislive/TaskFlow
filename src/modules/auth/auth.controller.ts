import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Request, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AuthService, AuthResponse, AuthTokens } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from '@common/decorators/public.decorator';
import { RateLimit } from '@common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '@common/guards/rate-limit.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@ApiTags('Authentication')
@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authentication endpoints information' })
  @ApiResponse({
    status: 200,
    description: 'Available authentication endpoints',
    type: 'object',
  })
  getAuthInfo() {
    return {
      message: 'Authentication API',
      endpoints: {
        login: 'POST /auth/login',
        register: 'POST /auth/register',
        refresh: 'POST /auth/refresh',
        logout: 'POST /auth/logout',
        profile: 'GET /auth/me',
      },
      documentation: '/api',
    };
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 15 * 60 * 1000 }) // 5 attempts per 15 minutes
  @ApiOperation({ summary: 'Authenticate user and receive tokens' })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', example: 'uuid' },
                email: { type: 'string', example: 'user@example.com' },
                name: { type: 'string', example: 'John Doe' },
                role: { type: 'string', example: 'user' },
              },
            },
            tokens: {
              type: 'object',
              properties: {
                accessToken: { type: 'string', example: 'jwt-access-token' },
                refreshToken: { type: 'string', example: 'jwt-refresh-token' },
                expiresIn: { type: 'number', example: 900 },
                tokenType: { type: 'string', example: 'Bearer' },
              },
            },
          },
        },
        timestamp: { type: 'string', example: '2023-01-01T00:00:00.000Z' },
        path: { type: 'string', example: '/auth/login' },
        statusCode: { type: 'number', example: 200 },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication failed',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'AUTHENTICATION_ERROR' },
        message: { type: 'string', example: 'Invalid credentials' },
        timestamp: { type: 'string', example: '2023-01-01T00:00:00.000Z' },
        path: { type: 'string', example: '/auth/login' },
        statusCode: { type: 'number', example: 401 },
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'RATE_LIMIT_EXCEEDED' },
        message: { type: 'string', example: 'Rate limit exceeded. Maximum 5 requests per 900000ms' },
        timestamp: { type: 'string', example: '2023-01-01T00:00:00.000Z' },
        path: { type: 'string', example: '/auth/login' },
        statusCode: { type: 'number', example: 429 },
      },
    },
  })
  async login(@Body() loginDto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(loginDto);
  }

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 3, windowMs: 60 * 60 * 1000 }) // 3 registrations per hour
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({
    status: 201,
    description: 'Registration successful',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', example: 'uuid' },
                email: { type: 'string', example: 'user@example.com' },
                name: { type: 'string', example: 'John Doe' },
                role: { type: 'string', example: 'user' },
              },
            },
            tokens: {
              type: 'object',
              properties: {
                accessToken: { type: 'string', example: 'jwt-access-token' },
                refreshToken: { type: 'string', example: 'jwt-refresh-token' },
                expiresIn: { type: 'number', example: 900 },
                tokenType: { type: 'string', example: 'Bearer' },
              },
            },
          },
        },
        timestamp: { type: 'string', example: '2023-01-01T00:00:00.000Z' },
        path: { type: 'string', example: '/auth/register' },
        statusCode: { type: 'number', example: 201 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'VALIDATION_ERROR' },
        message: { type: 'string', example: 'Validation failed' },
        validationErrors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', example: 'email' },
              value: { type: 'string', example: 'invalid-email' },
              constraints: { type: 'array', items: { type: 'string' }, example: ['email must be a valid email'] },
            },
          },
        },
        timestamp: { type: 'string', example: '2023-01-01T00:00:00.000Z' },
        path: { type: 'string', example: '/auth/register' },
        statusCode: { type: 'number', example: 400 },
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'User already exists',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'DUPLICATE_RESOURCE' },
        message: { type: 'string', example: 'User with email \'user@example.com\' already exists' },
        timestamp: { type: 'string', example: '2023-01-01T00:00:00.000Z' },
        path: { type: 'string', example: '/auth/register' },
        statusCode: { type: 'number', example: 409 },
      },
    },
  })
  async register(@Body() registerDto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(registerDto);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: 15 * 60 * 1000 }) // 10 refresh attempts per 15 minutes
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        refreshToken: {
          type: 'string',
          description: 'Valid refresh token',
          example: 'jwt-refresh-token',
        },
      },
      required: ['refreshToken'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Token refresh successful',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            accessToken: { type: 'string', example: 'new-jwt-access-token' },
            refreshToken: { type: 'string', example: 'new-jwt-refresh-token' },
            expiresIn: { type: 'number', example: 900 },
            tokenType: { type: 'string', example: 'Bearer' },
          },
        },
        timestamp: { type: 'string', example: '2023-01-01T00:00:00.000Z' },
        path: { type: 'string', example: '/auth/refresh' },
        statusCode: { type: 'number', example: 200 },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired refresh token',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'AUTHENTICATION_ERROR' },
        message: { type: 'string', example: 'Refresh token expired' },
        timestamp: { type: 'string', example: '2023-01-01T00:00:00.000Z' },
        path: { type: 'string', example: '/auth/refresh' },
        statusCode: { type: 'number', example: 401 },
      },
    },
  })
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto): Promise<AuthTokens> {
    return this.authService.refreshToken(refreshTokenDto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout user and invalidate refresh token' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        refreshToken: {
          type: 'string',
          description: 'Refresh token to invalidate (optional)',
          example: 'jwt-refresh-token',
        },
      },
    },
    required: false,
  })
  @ApiResponse({
    status: 204,
    description: 'Logout successful',
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication required',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'AUTHENTICATION_ERROR' },
        message: { type: 'string', example: 'Access token required' },
        timestamp: { type: 'string', example: '2023-01-01T00:00:00.000Z' },
        path: { type: 'string', example: '/auth/logout' },
        statusCode: { type: 'number', example: 401 },
      },
    },
  })
  async logout(
    @CurrentUser() user: any,
    @Body() body?: { refreshToken?: string },
  ): Promise<void> {
    await this.authService.logout(user.id, body?.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'uuid' },
            email: { type: 'string', example: 'user@example.com' },
            name: { type: 'string', example: 'John Doe' },
            role: { type: 'string', example: 'user' },
          },
        },
        timestamp: { type: 'string', example: '2023-01-01T00:00:00.000Z' },
        path: { type: 'string', example: '/auth/me' },
        statusCode: { type: 'number', example: 200 },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication required',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        error: { type: 'string', example: 'AUTHENTICATION_ERROR' },
        message: { type: 'string', example: 'Access token required' },
        timestamp: { type: 'string', example: '2023-01-01T00:00:00.000Z' },
        path: { type: 'string', example: '/auth/me' },
        statusCode: { type: 'number', example: 401 },
      },
    },
  })
  async getProfile(@CurrentUser() user: any) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }
}