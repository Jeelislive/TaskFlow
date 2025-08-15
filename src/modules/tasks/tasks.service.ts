import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, FindManyOptions, In } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Task } from './entities/task.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskFilterDto } from './dto/task-filter.dto';
import { TaskStatus } from './enums/task-status.enum';
import { TaskPriority } from './enums/task-priority.enum';
import { CacheService } from '@common/services/cache.service';
import { 
  ResourceNotFoundException,
  DatabaseException,
  QueueException,
  BusinessLogicException
} from '@common/exceptions/taskflow.exceptions';
import { 
  PaginatedResult, 
  PaginationOptions, 
  BulkOperationResponse, 
  BatchOperationResult 
} from '../../types/pagination.interface';

export interface TaskQueryOptions {
  pagination?: PaginationOptions;
  filters?: TaskFilterDto;
  userId?: string;
  includeUser?: boolean;
  includeStats?: boolean;
}

export interface TaskStatistics {
  total: number;
  byStatus: Record<TaskStatus, number>;
  byPriority: Record<TaskPriority, number>;
  overdue: number;
  completedThisWeek: number;
  completedThisMonth: number;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    @InjectQueue('task-processing')
    private readonly taskQueue: Queue,
    private readonly cacheService: CacheService,
    private readonly dataSource: DataSource,
  ) {}

  async create(createTaskDto: CreateTaskDto, userId: string): Promise<Task> {
    return await this.dataSource.transaction(async (manager) => {
      try {
        const taskRepository = manager.getRepository(Task);
        
        const task = taskRepository.create({
          ...createTaskDto,
          userId,
          status: createTaskDto.status || TaskStatus.PENDING,
          priority: createTaskDto.priority || TaskPriority.MEDIUM,
        });

        const savedTask = await taskRepository.save(task);

        setImmediate(async () => {
          try {
            await this.taskQueue.add('task-created', {
              taskId: savedTask.id,
              userId: savedTask.userId,
              status: savedTask.status,
              priority: savedTask.priority,
            });
          } catch (queueError) {
            const errorMessage = queueError instanceof Error ? queueError.message : 'Unknown error';
            this.logger.error('Failed to add task to queue', {
              taskId: savedTask.id,
              error: errorMessage,
            });
          }
        });

        await this.invalidateTaskCache(userId);

        this.logger.log('Task created successfully', {
          taskId: savedTask.id,
          userId,
          title: savedTask.title,
        });

        return savedTask;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error('Failed to create task', {
          error: errorMessage,
          userId,
          title: createTaskDto.title,
        });
        throw new DatabaseException('Failed to create task', error instanceof Error ? error : undefined);
      }
    });
  }

  async findAll(options: TaskQueryOptions = {}): Promise<PaginatedResult<Task>> {
    try {
      const { pagination, filters, userId, includeUser = false } = options;
      
      const cacheKey = this.generateCacheKey('tasks:list', { pagination, filters, userId, includeUser });
      
      const cached = await this.cacheService.get<PaginatedResult<Task>>(cacheKey, 'tasks');
      if (cached) {
        this.logger.debug('Cache hit for tasks list', { cacheKey });
        return cached;
      }

      const queryBuilder = this.tasksRepository.createQueryBuilder('task');

      if (includeUser) {
        queryBuilder.leftJoinAndSelect('task.user', 'user');
      }

      if (filters) {
        this.applyFilters(queryBuilder, filters);
      }

      if (userId) {
        queryBuilder.andWhere('task.userId = :userId', { userId });
      }

      queryBuilder.orderBy('task.createdAt', 'DESC');

      const page = pagination?.page || 1;
      const limit = Math.min(pagination?.limit || 10, 100);
      const skip = (page - 1) * limit;

      queryBuilder.skip(skip).take(limit);

      const [tasks, total] = await queryBuilder.getManyAndCount();

      const result: PaginatedResult<Task> = {
        data: tasks,
        meta: {
          currentPage: page,
          itemsPerPage: limit,
          totalItems: total,
          totalPages: Math.ceil(total / limit),
          hasPreviousPage: page > 1,
          hasNextPage: page < Math.ceil(total / limit),
        },
      };

      await this.cacheService.set(cacheKey, result, { ttl: 300, namespace: 'tasks' });

      this.logger.debug('Tasks retrieved successfully', {
        total,
        page,
        limit,
        hasFilters: !!filters,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to retrieve tasks', {
        error: errorMessage,
        options,
      });
      throw new DatabaseException('Failed to retrieve tasks', error instanceof Error ? error : undefined);
    }
  }

  async findOne(id: string, userId?: string): Promise<Task> {
    try {
      const cacheKey = `task:${id}`;
      const cached = await this.cacheService.get<Task>(cacheKey, 'tasks');
      if (cached) {
        if (userId && cached.userId !== userId) {
          throw new ResourceNotFoundException('Task', id);
        }
        return cached;
      }

      const queryBuilder = this.tasksRepository.createQueryBuilder('task')
        .leftJoinAndSelect('task.user', 'user')
        .where('task.id = :id', { id });

      if (userId) {
        queryBuilder.andWhere('task.userId = :userId', { userId });
      }

      const task = await queryBuilder.getOne();

      if (!task) {
        throw new ResourceNotFoundException('Task', id);
      }

      await this.cacheService.set(cacheKey, task, { ttl: 600, namespace: 'tasks' });

      return task;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to retrieve task', {
        taskId: id,
        userId,
        error: errorMessage,
      });
      throw new DatabaseException('Failed to retrieve task', error instanceof Error ? error : undefined);
    }
  }

  async update(id: string, updateTaskDto: UpdateTaskDto, userId?: string): Promise<Task> {
    return await this.dataSource.transaction(async (manager) => {
      try {
        const taskRepository = manager.getRepository(Task);

        const existingTask = await this.findOne(id, userId);
        const originalStatus = existingTask.status;

        const updatedTask = taskRepository.merge(existingTask, updateTaskDto);
        const savedTask = await taskRepository.save(updatedTask);

        if (originalStatus !== savedTask.status) {
          setImmediate(async () => {
            try {
              await this.taskQueue.add('task-status-updated', {
                taskId: savedTask.id,
                oldStatus: originalStatus,
                newStatus: savedTask.status,
                userId: savedTask.userId,
              });
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              this.logger.error('Failed to add task status update to queue', {
                taskId: savedTask.id,
                error: errorMessage,
              });
            }
          });
        }

        await this.invalidateTaskCache(savedTask.userId, id);

        this.logger.log('Task updated successfully', {
          taskId: id,
          userId: savedTask.userId,
          statusChanged: originalStatus !== savedTask.status,
        });

        return savedTask;
      } catch (error) {
        if (error instanceof ResourceNotFoundException) {
          throw error;
        }
        
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error('Failed to update task', {
          taskId: id,
          userId,
          error: errorMessage,
        });
        throw new DatabaseException('Failed to update task', error instanceof Error ? error : undefined);
      }
    });
  }

  async remove(id: string, userId?: string): Promise<void> {
    return await this.dataSource.transaction(async (manager) => {
      try {
        const taskRepository = manager.getRepository(Task);

        const task = await this.findOne(id, userId);

        await taskRepository.remove(task);

        setImmediate(async () => {
          try {
            await this.taskQueue.add('task-deleted', {
              taskId: id,
              userId: task.userId,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to add task deletion to queue', {
              taskId: id,
              error: errorMessage,
            });
          }
        });

        await this.invalidateTaskCache(task.userId, id);

        this.logger.log('Task deleted successfully', {
          taskId: id,
          userId: task.userId,
        });
      } catch (error) {
        if (error instanceof ResourceNotFoundException) {
          throw error;
        }
        
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error('Failed to delete task', {
          taskId: id,
          userId,
          error: errorMessage,
        });
        throw new DatabaseException('Failed to delete task', error instanceof Error ? error : undefined);
      }
    });
  }

  async batchUpdate(taskIds: string[], updateData: Partial<UpdateTaskDto>, userId?: string): Promise<BulkOperationResponse<Task>> {
    const results: BulkOperationResponse<Task> = {
      successful: [],
      failed: [],
      summary: {
        total: taskIds.length,
        successful: 0,
        failed: 0,
      },
    };

    return await this.dataSource.transaction(async (manager) => {
      try {
        const taskRepository = manager.getRepository(Task);

        const queryBuilder = taskRepository.createQueryBuilder('task')
          .where('task.id IN (:...taskIds)', { taskIds });

        if (userId) {
          queryBuilder.andWhere('task.userId = :userId', { userId });
        }

        const existingTasks = await queryBuilder.getMany();
        const foundTaskIds = existingTasks.map(task => task.id);
        const notFoundTaskIds = taskIds.filter(id => !foundTaskIds.includes(id));

        notFoundTaskIds.forEach(id => {
          results.failed.push({
            success: false,
            id,
            error: 'Task not found or access denied',
          });
        });

        if (existingTasks.length > 0) {
          await taskRepository.update(
            { id: In(foundTaskIds) },
            updateData
          );

          const updatedTasks = await taskRepository.find({
            where: { id: In(foundTaskIds) },
            relations: ['user'],
          });

          updatedTasks.forEach(task => {
            results.successful.push({
              success: true,
              id: task.id,
              data: task,
            });
          });

          setImmediate(async () => {
            try {
              await this.taskQueue.add('tasks-batch-updated', {
                taskIds: foundTaskIds,
                updateData,
                userId,
              });
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              this.logger.error('Failed to add batch update to queue', {
                taskIds: foundTaskIds,
                error: errorMessage,
              });
            }
          });

          const affectedUserIds = [...new Set(updatedTasks.map(task => task.userId))];
          for (const affectedUserId of affectedUserIds) {
            await this.invalidateTaskCache(affectedUserId);
          }
        }

        results.summary.successful = results.successful.length;
        results.summary.failed = results.failed.length;

        this.logger.log('Batch update completed', {
          total: taskIds.length,
          successful: results.summary.successful,
          failed: results.summary.failed,
        });

        return results;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error('Batch update failed', {
          taskIds,
          error: errorMessage,
        });
        throw new DatabaseException('Batch update failed', error instanceof Error ? error : undefined);
      }
    });
  }

  async getStatistics(userId?: string): Promise<TaskStatistics> {
    try {
      const cacheKey = userId ? `stats:user:${userId}` : 'stats:global';
      
      const cached = await this.cacheService.get<TaskStatistics>(cacheKey, 'tasks');
      if (cached) {
        return cached;
      }

      const queryBuilder = this.tasksRepository.createQueryBuilder('task');
      
      if (userId) {
        queryBuilder.where('task.userId = :userId', { userId });
      }

      const [
        total,
        statusCounts,
        priorityCounts,
        overdue,
        completedThisWeek,
        completedThisMonth,
      ] = await Promise.all([
        queryBuilder.getCount(),
        this.getStatusCounts(userId),
        this.getPriorityCounts(userId),
        this.getOverdueTasks(userId),
        this.getCompletedTasksInPeriod('week', userId),
        this.getCompletedTasksInPeriod('month', userId),
      ]);

      const statistics: TaskStatistics = {
        total,
        byStatus: statusCounts,
        byPriority: priorityCounts,
        overdue,
        completedThisWeek,
        completedThisMonth,
      };

      await this.cacheService.set(cacheKey, statistics, { ttl: 900, namespace: 'tasks' });

      return statistics;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to get task statistics', {
        userId,
        error: errorMessage,
      });
      throw new DatabaseException('Failed to get task statistics', error instanceof Error ? error : undefined);
    }
  }

  private applyFilters(queryBuilder: any, filters: TaskFilterDto): void {
    if (filters.status) {
      queryBuilder.andWhere('task.status = :status', { status: filters.status });
    }

    if (filters.priority) {
      queryBuilder.andWhere('task.priority = :priority', { priority: filters.priority });
    }

    if (filters.search) {
      queryBuilder.andWhere(
        '(task.title ILIKE :search OR task.description ILIKE :search)',
        { search: `%${filters.search}%` }
      );
    }

    if (filters.dueDateFrom) {
      queryBuilder.andWhere('task.dueDate >= :dueDateFrom', { dueDateFrom: filters.dueDateFrom });
    }

    if (filters.dueDateTo) {
      queryBuilder.andWhere('task.dueDate <= :dueDateTo', { dueDateTo: filters.dueDateTo });
    }

    if (filters.createdDateFrom) {
      queryBuilder.andWhere('task.createdAt >= :createdDateFrom', { createdDateFrom: filters.createdDateFrom });
    }

    if (filters.createdDateTo) {
      queryBuilder.andWhere('task.createdAt <= :createdDateTo', { createdDateTo: filters.createdDateTo });
    }
  }

  private async getStatusCounts(userId?: string): Promise<Record<TaskStatus, number>> {
    const queryBuilder = this.tasksRepository.createQueryBuilder('task')
      .select('task.status', 'status')
      .addSelect('COUNT(*)', 'count');

    if (userId) {
      queryBuilder.where('task.userId = :userId', { userId });
    }

    const results = await queryBuilder
      .groupBy('task.status')
      .getRawMany();

    const counts: Record<TaskStatus, number> = {
      [TaskStatus.PENDING]: 0,
      [TaskStatus.IN_PROGRESS]: 0,
      [TaskStatus.COMPLETED]: 0,
      [TaskStatus.CANCELLED]: 0,
    };

    results.forEach(result => {
      counts[result.status as TaskStatus] = parseInt(result.count, 10);
    });

    return counts;
  }

  private async getPriorityCounts(userId?: string): Promise<Record<TaskPriority, number>> {
    const queryBuilder = this.tasksRepository.createQueryBuilder('task')
      .select('task.priority', 'priority')
      .addSelect('COUNT(*)', 'count');

    if (userId) {
      queryBuilder.where('task.userId = :userId', { userId });
    }

    const results = await queryBuilder
      .groupBy('task.priority')
      .getRawMany();

    const counts: Record<TaskPriority, number> = {
      [TaskPriority.LOW]: 0,
      [TaskPriority.MEDIUM]: 0,
      [TaskPriority.HIGH]: 0,
      [TaskPriority.URGENT]: 0,
    };

    results.forEach(result => {
      counts[result.priority as TaskPriority] = parseInt(result.count, 10);
    });

    return counts;
  }

  private async getOverdueTasks(userId?: string): Promise<number> {
    const queryBuilder = this.tasksRepository.createQueryBuilder('task')
      .where('task.dueDate < :now', { now: new Date() })
      .andWhere('task.status != :completedStatus', { completedStatus: TaskStatus.COMPLETED })
      .andWhere('task.status != :cancelledStatus', { cancelledStatus: TaskStatus.CANCELLED });

    if (userId) {
      queryBuilder.andWhere('task.userId = :userId', { userId });
    }

    return await queryBuilder.getCount();
  }

  private async getCompletedTasksInPeriod(period: 'week' | 'month', userId?: string): Promise<number> {
    const now = new Date();
    const startDate = new Date();

    if (period === 'week') {
      startDate.setDate(now.getDate() - 7);
    } else {
      startDate.setMonth(now.getMonth() - 1);
    }

    const queryBuilder = this.tasksRepository.createQueryBuilder('task')
      .where('task.status = :status', { status: TaskStatus.COMPLETED })
      .andWhere('task.updatedAt >= :startDate', { startDate });

    if (userId) {
      queryBuilder.andWhere('task.userId = :userId', { userId });
    }

    return await queryBuilder.getCount();
  }

  private generateCacheKey(prefix: string, params: any): string {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((result, key) => {
        result[key] = params[key];
        return result;
      }, {} as any);

    return `${prefix}:${Buffer.from(JSON.stringify(sortedParams)).toString('base64')}`;
  }

  private async invalidateTaskCache(userId: string, taskId?: string): Promise<void> {
    try {
      await this.cacheService.delPattern(`tasks:list:*user*${userId}*`, 'tasks');
      await this.cacheService.delPattern(`stats:user:${userId}`, 'tasks');
      
      await this.cacheService.delPattern('tasks:list:*', 'tasks');
      await this.cacheService.delPattern('stats:global', 'tasks');

      if (taskId) {
        await this.cacheService.del(`task:${taskId}`, 'tasks');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn('Failed to invalidate task cache', {
        userId,
        taskId,
        error: errorMessage,
      });
    }
  }
}
