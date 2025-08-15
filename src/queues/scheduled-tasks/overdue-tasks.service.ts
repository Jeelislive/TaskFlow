import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Not } from 'typeorm';
import { Task } from '../../modules/tasks/entities/task.entity';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';
import { CacheService } from '@common/services/cache.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class OverdueTasksService {
  private readonly logger = new Logger(OverdueTasksService.name);

  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    private readonly cacheService: CacheService,
    @InjectQueue('task-processing')
    private readonly taskQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkOverdueTasks(): Promise<void> {
    try {
      this.logger.log('Starting overdue tasks check');
      
      const overdueCount = await this.processOverdueTasks();
      
      this.logger.log(`Overdue tasks check completed`, {
        processedCount: overdueCount,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('Failed to check overdue tasks', {
        error: errorMessage,
        stack: errorStack,
      });
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOldTasks(): Promise<void> {
    try {
      this.logger.log('Starting old tasks cleanup');
      
      const cleanedCount = await this.cleanupCompletedTasks();
      
      this.logger.log(`Old tasks cleanup completed`, {
        cleanedCount,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('Failed to cleanup old tasks', {
        error: errorMessage,
        stack: errorStack,
      });
    }
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async updateTaskMetrics(): Promise<void> {
    try {
      this.logger.log('Starting task metrics update');
      
      await this.calculateAndCacheTaskMetrics();
      
      this.logger.log('Task metrics update completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('Failed to update task metrics', {
        error: errorMessage,
        stack: errorStack,
      });
    }
  }

  @Cron('0 2 * * *') // Daily at 2 AM
  async cleanupExpiredCacheEntries(): Promise<void> {
    this.logger.log('Starting cleanup of expired cache entries');

    try {
      // This would typically be handled by Redis TTL, but we can manually clean up
      // any application-specific cache patterns that need cleanup
      
      const patterns = [
        'temp:*',
        'session:*',
        'rate_limit:*',
      ];

      let totalCleaned = 0;
      for (const pattern of patterns) {
        const cleaned = await this.cacheService.delPattern(pattern);
        totalCleaned += cleaned;
      }

      this.logger.log(`Cache cleanup completed. Cleaned ${totalCleaned} entries`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('Failed to cleanup expired cache entries', {
        error: errorMessage,
        stack: errorStack,
      });
    }
  }

  private async processOverdueTasks(): Promise<number> {
    const now = new Date();
      
    // Find tasks that are overdue and not completed/cancelled
    const overdueTasks = await this.tasksRepository.find({
      where: {
        dueDate: LessThan(now),
        status: Not(TaskStatus.COMPLETED) && Not(TaskStatus.CANCELLED),
      },
      relations: ['user'],
      take: 1000, // Process in batches
    });

    this.logger.log(`Found ${overdueTasks.length} overdue tasks`);

    // Process overdue tasks
    for (const task of overdueTasks) {
      await this.processOverdueTask(task);
    }

    // Update overdue task metrics
    await this.updateOverdueMetrics(overdueTasks.length);

    return overdueTasks.length;
  }

  private async cleanupCompletedTasks(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Find old completed tasks
    const oldCompletedTasks = await this.tasksRepository.find({
      where: {
        status: TaskStatus.COMPLETED,
        updatedAt: LessThan(thirtyDaysAgo),
      },
      select: ['id', 'userId', 'title'],
      take: 1000,
    });

    this.logger.log(`Found ${oldCompletedTasks.length} old completed tasks to archive`);

    // Archive old tasks (in a real application, you might move to archive table)
    for (const task of oldCompletedTasks) {
      await this.archiveTask(task);
    }

    return oldCompletedTasks.length;
  }

  private async calculateAndCacheTaskMetrics(): Promise<void> {
    // Update global task statistics
    const [total, pending, inProgress, completed, cancelled] = await Promise.all([
      this.tasksRepository.count(),
      this.tasksRepository.count({ where: { status: TaskStatus.PENDING } }),
      this.tasksRepository.count({ where: { status: TaskStatus.IN_PROGRESS } }),
      this.tasksRepository.count({ where: { status: TaskStatus.COMPLETED } }),
      this.tasksRepository.count({ where: { status: TaskStatus.CANCELLED } }),
    ]);

    const stats = {
      total,
      byStatus: {
        [TaskStatus.PENDING]: pending,
        [TaskStatus.IN_PROGRESS]: inProgress,
        [TaskStatus.COMPLETED]: completed,
        [TaskStatus.CANCELLED]: cancelled,
      },
      lastUpdated: new Date().toISOString(),
    };

    // Cache global statistics
    await this.cacheService.set(
      'global_task_stats',
      stats,
      { ttl: 6 * 60 * 60, namespace: 'stats' } // 6 hours
    );

    // Update user-specific statistics
    await this.updateUserStatistics();

    this.logger.log('Task statistics update completed', { stats });
  }

  private async processOverdueTask(task: Task): Promise<void> {
    try {
      // Add overdue task to processing queue
      await this.taskQueue.add('task-overdue', {
        taskId: task.id,
        userId: task.userId,
        title: task.title,
        dueDate: task.dueDate,
        daysPastDue: Math.floor((Date.now() - task.dueDate.getTime()) / (1000 * 60 * 60 * 24)),
      });

      // Update overdue flag in cache
      await this.cacheService.set(
        `task_overdue:${task.id}`,
        {
          taskId: task.id,
          userId: task.userId,
          daysPastDue: Math.floor((Date.now() - task.dueDate.getTime()) / (1000 * 60 * 60 * 24)),
          flaggedAt: new Date().toISOString(),
        },
        { ttl: 24 * 60 * 60, namespace: 'overdue' } // 24 hours
      );

      this.logger.debug(`Processed overdue task`, {
        taskId: task.id,
        userId: task.userId,
        title: task.title,
      });
    } catch (error) {
      this.logger.warn(`Failed to process overdue task`, {
        taskId: task.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async archiveTask(task: Partial<Task>): Promise<void> {
    try {
      // In a real application, you might move to an archive table
      // For now, we'll just add to queue for processing
      await this.taskQueue.add('task-archive', {
        taskId: task.id,
        userId: task.userId,
        title: task.title,
        archivedAt: new Date().toISOString(),
      });

      this.logger.debug(`Archived task`, {
        taskId: task.id,
        userId: task.userId,
        title: task.title,
      });
    } catch (error) {
      this.logger.warn(`Failed to archive task`, {
        taskId: task.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async updateOverdueMetrics(overdueCount: number): Promise<void> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      
      await this.cacheService.set(
        `overdue_metrics:${today}`,
        {
          count: overdueCount,
          checkedAt: new Date().toISOString(),
        },
        { ttl: 25 * 60 * 60, namespace: 'metrics' } // 25 hours
      );
    } catch (error) {
      this.logger.warn('Failed to update overdue metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async updateUserStatistics(): Promise<void> {
    try {
      // Get unique user IDs with tasks
      const users = await this.tasksRepository
        .createQueryBuilder('task')
        .select('DISTINCT task.userId', 'userId')
        .getRawMany();

      this.logger.log(`Updating statistics for ${users.length} users`);

      // Update statistics for each user in batches
      const batchSize = 50;
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        await Promise.all(
          batch.map(user => this.updateSingleUserStatistics(user.userId))
        );
      }
    } catch (error) {
      this.logger.warn('Failed to update user statistics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async updateSingleUserStatistics(userId: string): Promise<void> {
    try {
      const [total, pending, inProgress, completed, cancelled] = await Promise.all([
        this.tasksRepository.count({ where: { userId } }),
        this.tasksRepository.count({ where: { userId, status: TaskStatus.PENDING } }),
        this.tasksRepository.count({ where: { userId, status: TaskStatus.IN_PROGRESS } }),
        this.tasksRepository.count({ where: { userId, status: TaskStatus.COMPLETED } }),
        this.tasksRepository.count({ where: { userId, status: TaskStatus.CANCELLED } }),
      ]);

      const stats = {
        total,
        byStatus: {
          [TaskStatus.PENDING]: pending,
          [TaskStatus.IN_PROGRESS]: inProgress,
          [TaskStatus.COMPLETED]: completed,
          [TaskStatus.CANCELLED]: cancelled,
        },
        completionRate: total > 0 ? (completed / total) * 100 : 0,
        lastUpdated: new Date().toISOString(),
      };

      await this.cacheService.set(
        `user_task_stats:${userId}`,
        stats,
        { ttl: 6 * 60 * 60, namespace: 'stats' } // 6 hours
      );
    } catch (error) {
      this.logger.warn(`Failed to update statistics for user ${userId}`, {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}