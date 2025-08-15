import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Delete, 
  UseGuards, 
  Query, 
  HttpCode, 
  HttpStatus,
  ParseIntPipe,
  ParseUUIDPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { 
  ApiBearerAuth, 
  ApiOperation, 
  ApiQuery, 
  ApiTags, 
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { TasksService, TaskQueryOptions, TaskStatistics } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskFilterDto } from './dto/task-filter.dto';
import { Task } from './entities/task.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, UserRole } from '@common/guards/roles.guard';
import { RateLimitGuard } from '@common/guards/rate-limit.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { RateLimit } from '@common/decorators/rate-limit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginatedResult, BulkOperationResponse } from '../../types/pagination.interface';

@ApiTags('Tasks')
@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard, RateLimitGuard)
@ApiBearerAuth()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 20, windowMs: 60 * 1000 }) // 20 tasks per minute
  @ApiOperation({ summary: 'Create a new task' })
  @ApiResponse({
    status: 201,
    description: 'Task created successfully',
    type: Task,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication required',
  })
  async create(
    @Body() createTaskDto: CreateTaskDto,
    @CurrentUser() user: any,
  ): Promise<Task> {
    return this.tasksService.create(createTaskDto, user.id);
  }

  @Get()
  @RateLimit({ limit: 100, windowMs: 60 * 1000 }) // 100 requests per minute
  @ApiOperation({ summary: 'Get tasks with filtering and pagination' })
  @ApiQuery({ 
    name: 'page', 
    required: false, 
    type: Number, 
    description: 'Page number (starts from 1)',
    example: 1,
  })
  @ApiQuery({ 
    name: 'limit', 
    required: false, 
    type: Number, 
    description: 'Items per page (max 100)',
    example: 10,
  })
  @ApiQuery({ 
    name: 'status', 
    required: false, 
    enum: ['pending', 'in_progress', 'completed', 'cancelled'],
    description: 'Filter by task status',
  })
  @ApiQuery({ 
    name: 'priority', 
    required: false, 
    enum: ['low', 'medium', 'high', 'urgent'],
    description: 'Filter by task priority',
  })
  @ApiQuery({ 
    name: 'search', 
    required: false, 
    type: String, 
    description: 'Search in title and description',
  })
  @ApiQuery({ 
    name: 'dueDateFrom', 
    required: false, 
    type: String, 
    description: 'Filter tasks with due date from (ISO 8601)',
  })
  @ApiQuery({ 
    name: 'dueDateTo', 
    required: false, 
    type: String, 
    description: 'Filter tasks with due date until (ISO 8601)',
  })
  @ApiQuery({ 
    name: 'includeUser', 
    required: false, 
    type: Boolean, 
    description: 'Include user information in response',
  })
  @ApiResponse({
    status: 200,
    description: 'Tasks retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/Task' },
        },
        meta: {
          type: 'object',
          properties: {
            currentPage: { type: 'number', example: 1 },
            itemsPerPage: { type: 'number', example: 10 },
            totalItems: { type: 'number', example: 100 },
            totalPages: { type: 'number', example: 10 },
            hasPreviousPage: { type: 'boolean', example: false },
            hasNextPage: { type: 'boolean', example: true },
          },
        },
      },
    },
  })
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('search') search?: string,
    @Query('dueDateFrom') dueDateFrom?: string,
    @Query('dueDateTo') dueDateTo?: string,
    @Query('createdDateFrom') createdDateFrom?: string,
    @Query('createdDateTo') createdDateTo?: string,
    @Query('includeUser', new DefaultValuePipe(false)) includeUser?: boolean,
    @CurrentUser() user?: any,
  ): Promise<PaginatedResult<Task>> {
    const options: TaskQueryOptions = {
      pagination: { page, limit },
      filters: {
        status: status as any,
        priority: priority as any,
        search,
        dueDateFrom,
        dueDateTo,
        createdDateFrom,
        createdDateTo,
      },
      userId: user.id, // Only show user's own tasks
      includeUser,
    };

    return this.tasksService.findAll(options);
  }

  @Get('statistics')
  @RateLimit({ limit: 20, windowMs: 60 * 1000 })
  @ApiOperation({ summary: 'Get task statistics for current user' })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number', example: 50 },
        byStatus: {
          type: 'object',
          properties: {
            pending: { type: 'number', example: 10 },
            in_progress: { type: 'number', example: 15 },
            completed: { type: 'number', example: 20 },
            cancelled: { type: 'number', example: 5 },
          },
        },
        byPriority: {
          type: 'object',
          properties: {
            low: { type: 'number', example: 10 },
            medium: { type: 'number', example: 20 },
            high: { type: 'number', example: 15 },
            urgent: { type: 'number', example: 5 },
          },
        },
        overdue: { type: 'number', example: 3 },
        completedThisWeek: { type: 'number', example: 8 },
        completedThisMonth: { type: 'number', example: 25 },
      },
    },
  })
  async getStatistics(@CurrentUser() user: any): Promise<TaskStatistics> {
    return this.tasksService.getStatistics(user.id);
  }

  @Get('all')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RateLimit({ limit: 50, windowMs: 60 * 1000 })
  @ApiOperation({ summary: 'Get all tasks (admin/manager only)' })
  @ApiResponse({
    status: 200,
    description: 'All tasks retrieved successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions',
  })
  async findAllTasks(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('search') search?: string,
    @Query('dueDateFrom') dueDateFrom?: string,
    @Query('dueDateTo') dueDateTo?: string,
    @Query('includeUser', new DefaultValuePipe(true)) includeUser?: boolean,
  ): Promise<PaginatedResult<Task>> {
    const options: TaskQueryOptions = {
      pagination: { page, limit },
      filters: {
        status: status as any,
        priority: priority as any,
        search,
        dueDateFrom,
        dueDateTo,
      },
      // No userId filter - get all tasks
      includeUser,
    };

    return this.tasksService.findAll(options);
  }

  @Get('all/statistics')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RateLimit({ limit: 20, windowMs: 60 * 1000 })
  @ApiOperation({ summary: 'Get global task statistics (admin/manager only)' })
  @ApiResponse({
    status: 200,
    description: 'Global statistics retrieved successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions',
  })
  async getGlobalStatistics(): Promise<TaskStatistics> {
    return this.tasksService.getStatistics(); // No userId = global stats
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get task by ID' })
  @ApiParam({
    name: 'id',
    description: 'Task UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Task retrieved successfully',
    type: Task,
  })
  @ApiResponse({
    status: 404,
    description: 'Task not found',
  })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<Task> {
    return this.tasksService.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update task by ID' })
  @ApiParam({
    name: 'id',
    description: 'Task UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Task updated successfully',
    type: Task,
  })
  @ApiResponse({
    status: 404,
    description: 'Task not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTaskDto: UpdateTaskDto,
    @CurrentUser() user: any,
  ): Promise<Task> {
    return this.tasksService.update(id, updateTaskDto, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete task by ID' })
  @ApiParam({
    name: 'id',
    description: 'Task UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 204,
    description: 'Task deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Task not found',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<void> {
    return this.tasksService.remove(id, user.id);
  }

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: 60 * 1000 }) // 10 batch operations per minute
  @ApiOperation({ summary: 'Batch update multiple tasks' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        taskIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          description: 'Array of task UUIDs to update',
          example: ['123e4567-e89b-12d3-a456-426614174000', '987fcdeb-51a2-43d6-8765-123456789012'],
        },
        updateData: {
          type: 'object',
          description: 'Data to update for all specified tasks',
          example: { status: 'completed', priority: 'high' },
        },
      },
      required: ['taskIds', 'updateData'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Batch operation completed',
    schema: {
      type: 'object',
      properties: {
        successful: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              id: { type: 'string', example: '123e4567-e89b-12d3-a456-426614174000' },
              data: { $ref: '#/components/schemas/Task' },
            },
          },
        },
        failed: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              id: { type: 'string', example: '987fcdeb-51a2-43d6-8765-123456789012' },
              error: { type: 'string', example: 'Task not found or access denied' },
            },
          },
        },
        summary: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 2 },
            successful: { type: 'number', example: 1 },
            failed: { type: 'number', example: 1 },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data',
  })
  async batchUpdate(
    @Body() batchUpdateDto: { taskIds: string[]; updateData: Partial<UpdateTaskDto> },
    @CurrentUser() user: any,
  ): Promise<BulkOperationResponse<Task>> {
    const { taskIds, updateData } = batchUpdateDto;
    return this.tasksService.batchUpdate(taskIds, updateData, user.id);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 60 * 1000 }) // 5 batch delete operations per minute
  @ApiOperation({ summary: 'Batch delete multiple tasks' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        taskIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          description: 'Array of task UUIDs to delete',
          example: ['123e4567-e89b-12d3-a456-426614174000', '987fcdeb-51a2-43d6-8765-123456789012'],
        },
      },
      required: ['taskIds'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Batch delete operation completed',
    schema: {
      type: 'object',
      properties: {
        successful: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              id: { type: 'string', example: '123e4567-e89b-12d3-a456-426614174000' },
            },
          },
        },
        failed: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              id: { type: 'string', example: '987fcdeb-51a2-43d6-8765-123456789012' },
              error: { type: 'string', example: 'Task not found or access denied' },
            },
          },
        },
        summary: {
          type: 'object',
          properties: {
            total: { type: 'number', example: 2 },
            successful: { type: 'number', example: 1 },
            failed: { type: 'number', example: 1 },
          },
        },
      },
    },
  })
  async batchDelete(
    @Body() batchDeleteDto: { taskIds: string[] },
    @CurrentUser() user: any,
  ): Promise<BulkOperationResponse<void>> {
    const { taskIds } = batchDeleteDto;
    
    const results: BulkOperationResponse<void> = {
      successful: [],
      failed: [],
      summary: {
        total: taskIds.length,
        successful: 0,
        failed: 0,
      },
    };

    // Process deletions individually to provide detailed feedback
    for (const taskId of taskIds) {
      try {
        await this.tasksService.remove(taskId, user.id);
        results.successful.push({
          success: true,
          id: taskId,
        });
      } catch (error) {
        results.failed.push({
          success: false,
          id: taskId,
          error: error instanceof Error ? error.message : 'Delete operation failed',
        });
      }
    }

    results.summary.successful = results.successful.length;
    results.summary.failed = results.failed.length;

    return results;
  }
}