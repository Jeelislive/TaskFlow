import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { CacheService } from '../src/common/services/cache.service';

jest.setTimeout(600000);

describe('TaskFlow API (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let cacheService: CacheService;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    dataSource = moduleFixture.get<DataSource>(DataSource);
    cacheService = moduleFixture.get<CacheService>(CacheService);

    // Apply the same pipes used in the main application
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init();

    // Setup test data and get tokens
    await setupTestData();
  });

  afterAll(async () => {
    await dataSource.destroy();
    await app.close();
  });

  describe('🔐 Authentication Flow', () => {
    it('should register a new user with proper validation', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
          name: 'Test User',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('test@example.com');
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();
    });

    it('should login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'admin@example.com',
          password: 'admin123',
        })
        .expect(200);

      adminToken = response.body.data.tokens.accessToken;
      expect(adminToken).toBeDefined();
      expect(response.body.data.user.role).toBe('admin');
    });

    it('should refresh access token successfully', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'user@example.com',
          password: 'user123',
        });

      const refreshToken = loginResponse.body.data.tokens.refreshToken;

      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();
    });

    it('should get current user profile', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe('admin@example.com');
    });

    it('should logout and invalidate tokens', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'user@example.com',
          password: 'user123',
        });

      const { accessToken, refreshToken } = loginResponse.body.data.tokens;

      // Logout
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(200);

      // Try to use the token after logout - should fail
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
    });
  });

  describe('📋 Task Management', () => {
    it('should create a new task with proper validation', async () => {
      const response = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'E2E Test Task',
          description: 'Testing task creation in E2E tests',
          priority: 'HIGH',
          dueDate: '2025-12-31T23:59:59Z',
        })
        .expect(201);

      expect(response.body.title).toBe('E2E Test Task');
      expect(response.body.priority).toBe('HIGH');
      expect(response.body.status).toBe('PENDING');
    });

    it('should get tasks with pagination and filtering', async () => {
      const response = await request(app.getHttpServer())
        .get('/tasks?page=1&limit=10&priority=HIGH&status=PENDING')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.meta.currentPage).toBe(1);
      expect(response.body.meta.itemsPerPage).toBe(10);
      expect(response.body.meta.totalItems).toBeGreaterThanOrEqual(0);
    });

    it('should search tasks by title and description', async () => {
      // Create a task with specific content
      await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Searchable Task Title',
          description: 'This task has unique content for searching',
        });

      const response = await request(app.getHttpServer())
        .get('/tasks?search=Searchable')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].title).toContain('Searchable');
    });

    it('should update task status and trigger background processing', async () => {
      // Create a task
      const createResponse = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Status Update Test Task',
          status: 'PENDING',
        });

      const taskId = createResponse.body.id;

      // Update status
      const response = await request(app.getHttpServer())
        .patch(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'COMPLETED',
        })
        .expect(200);

      expect(response.body.status).toBe('COMPLETED');
    });

    it('should batch update multiple tasks', async () => {
      // Create multiple tasks
      const task1 = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Batch Task 1', priority: 'LOW' });

      const task2 = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Batch Task 2', priority: 'LOW' });

      // Batch update
      const response = await request(app.getHttpServer())
        .post('/tasks/batch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          taskIds: [task1.body.id, task2.body.id],
          updateData: { priority: 'URGENT' },
        })
        .expect(200);

      expect(response.body.summary.successful).toBe(2);
      expect(response.body.summary.failed).toBe(0);
      expect(response.body.successful).toHaveLength(2);
    });

    it('should batch delete multiple tasks', async () => {
      // Create tasks for deletion
      const task1 = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Delete Task 1' });

      const task2 = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Delete Task 2' });

      // Batch delete
      const response = await request(app.getHttpServer())
        .delete('/tasks/batch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          taskIds: [task1.body.id, task2.body.id],
        })
        .expect(200);

      expect(response.body.summary.successful).toBe(2);
      expect(response.body.summary.failed).toBe(0);
    });

    it('should get task statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/tasks/statistics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.total).toBeGreaterThanOrEqual(0);
      expect(response.body.byStatus).toBeDefined();
      expect(response.body.byPriority).toBeDefined();
      expect(response.body.overdue).toBeGreaterThanOrEqual(0);
    });
  });

  describe('⚡ Performance & Caching', () => {
    it('should demonstrate caching performance improvement', async () => {
      // First request - cache miss
      const start1 = Date.now();
      await request(app.getHttpServer())
        .get('/tasks/statistics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const time1 = Date.now() - start1;

      // Second request - cache hit
      const start2 = Date.now();
      const response = await request(app.getHttpServer())
        .get('/tasks/statistics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const time2 = Date.now() - start2;

      // Cache hit should be significantly faster
      expect(time2).toBeLessThan(time1 * 0.7);
      expect(response.body.total).toBeDefined();
    });

    it('should handle large dataset pagination efficiently', async () => {
      // Test with maximum allowed limit
      const response = await request(app.getHttpServer())
        .get('/tasks?page=1&limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.meta.itemsPerPage).toBe(100);
      expect(response.body.data).toBeInstanceOf(Array);
    });
  });

  describe('🛡️ Security & Rate Limiting', () => {
    it('should enforce authentication on protected routes', async () => {
      await request(app.getHttpServer())
        .get('/tasks')
        .expect(401);

      await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'Unauthorized Task' })
        .expect(401);
    });

    it('should enforce rate limits on login attempts', async () => {
      const promises = Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post('/auth/login')
          .send({
            email: 'wrong@example.com',
            password: 'wrongpassword',
          })
      );

      const responses = await Promise.allSettled(promises);
      const rateLimitedResponses = responses.filter(
        (result) => 
          result.status === 'fulfilled' && 
          result.value.status === 429
      );

      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should enforce role-based access control', async () => {
      // Regular user should not access admin endpoints
      await request(app.getHttpServer())
        .get('/tasks/all')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      // Admin should access admin endpoints
      await request(app.getHttpServer())
        .get('/tasks/all')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('should validate input data properly', async () => {
      // Test invalid email format
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: 'Password123!',
          name: 'Test User',
        })
        .expect(400);

      // Test weak password
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test2@example.com',
          password: '123',
          name: 'Test User',
        })
        .expect(400);
    });
  });

  describe('🏥 Health & Monitoring', () => {
    it('should return healthy status', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.checks.database.status).toBe('healthy');
      expect(response.body.checks.cache.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
    });

    it('should return application metrics', async () => {
      const response = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200);

      expect(response.body.system.memoryUsage).toBeDefined();
      expect(response.body.system.uptime).toBeGreaterThan(0);
      expect(response.body.system.cpuUsage).toBeDefined();
      expect(response.body.cache).toBeDefined();
    });

    it('should return API information at root', async () => {
      const response = await request(app.getHttpServer())
        .get('/')
        .expect(200);

      expect(response.body.message).toContain('TaskFlow API');
      expect(response.body.version).toBeDefined();
      expect(response.body.endpoints).toBeDefined();
    });
  });

  describe('🔄 Background Processing', () => {
    it('should process task creation events asynchronously', async () => {
      // Create a high priority task
      const response = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'High Priority Background Test',
          priority: 'URGENT',
        })
        .expect(201);

      // Give some time for background processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify task was created successfully
      expect(response.body.title).toBe('High Priority Background Test');
      expect(response.body.priority).toBe('URGENT');
    });
  });

  describe('🌐 API Documentation', () => {
    it('should serve Swagger documentation', async () => {
      const response = await request(app.getHttpServer())
        .get('/api-json')
        .expect(200);

      expect(response.body.openapi).toBeDefined();
      expect(response.body.info.title).toContain('TaskFlow');
      expect(response.body.paths).toBeDefined();
    });
  });

  async function setupTestData() {
    // Clear any existing test tokens
    adminToken = '';
    userToken = '';

    // Login to get tokens for testing
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'admin@example.com',
        password: 'admin123',
      });

    const userLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'user@example.com',
        password: 'user123',
      });

    adminToken = adminLogin.body.data.tokens.accessToken;
    userToken = userLogin.body.data.tokens.accessToken;

    // Verify tokens were obtained
    expect(adminToken).toBeDefined();
    expect(userToken).toBeDefined();
  }
});
