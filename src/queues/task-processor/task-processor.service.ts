import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../../modules/tasks/entities/task.entity';
import { TaskStatus } from '../../modules/tasks/enums/task-status.enum';
import { CacheService } from '@common/services/cache.service';
import { QueueException } from '@common/exceptions/taskflow.exceptions';

export interface TaskCreatedJobData {
  taskId: string;
  userId: string;
  status: TaskStatus;
  priority: string;
}

export interface TaskStatusUpdatedJobData {
  taskId: string;
  oldStatus: TaskStatus;
  newStatus: TaskStatus;
  userId: string;
}

export interface TaskDeletedJobData {
  taskId: string;
  userId: string;
}

export interface TasksBatchUpdatedJobData {
  taskIds: string[];
  updateData: any;
  userId?: string;
}

@Injectable()
@Processor('task-processing')
export class TaskProcessorService extends WorkerHost {
  private readonly logger = new Logger(TaskProcessorService.name);

  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
    private readonly cacheService: CacheService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { name, data } = job;
    
    this.logger.debug(`Processing job: ${name}`, {
      jobId: job.id,
      name,
      data,
      attempts: job.attemptsMade,
    });

    try {
      switch (name) {
        case 'task-created':
          return await this.handleTaskCreated(job.data as TaskCreatedJobData);
        
        case 'task-status-updated':
          return await this.handleTaskStatusUpdated(job.data as TaskStatusUpdatedJobData);
        
        case 'task-deleted':
          return await this.handleTaskDeleted(job.data as TaskDeletedJobData);
        
        case 'tasks-batch-updated':
          return await this.handleTasksBatchUpdated(job.data as TasksBatchUpdatedJobData);
        
        default:
          throw new QueueException(`Unknown job type: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error(`Job processing failed: ${name}`, {
        jobId: job.id,
        name,
        error: errorMessage,
        stack: errorStack,
        attempts: job.attemptsMade,
        data,
      });
      throw error;
    }
  }

  private async handleTaskCreated(data: TaskCreatedJobData): Promise<void> {
    const { taskId, userId, status, priority } = data;

    try {
      // Perform any post-creation processing
      this.logger.log(`Task created processing started`, {
        taskId,
        userId,
        status,
        priority,
      });

      // Example: Send notifications, update analytics, etc.
      await this.updateUserTaskStats(userId);
      
      // Example: Trigger workflow if high priority
      if (priority === 'urgent' || priority === 'high') {
        await this.notifyManagersOfHighPriorityTask(taskId, userId);
      }

      // Invalidate related caches
      await this.invalidateUserCaches(userId);

      this.logger.log(`Task created processing completed`, { taskId, userId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to process task creation`, {
        taskId,
        userId,
        error: errorMessage,
      });
      throw error;
    }
  }

  private async handleTaskStatusUpdated(data: TaskStatusUpdatedJobData): Promise<void> {
    const { taskId, oldStatus, newStatus, userId } = data;

    try {
      this.logger.log(`Task status update processing started`, {
        taskId,
        oldStatus,
        newStatus,
        userId,
      });

      // Update task analytics
      await this.updateTaskStatusMetrics(oldStatus, newStatus, userId);

      // Handle completion
      if (newStatus === TaskStatus.COMPLETED) {
        await this.handleTaskCompletion(taskId, userId);
      }

      // Handle cancellation
      if (newStatus === TaskStatus.CANCELLED) {
        await this.handleTaskCancellation(taskId, userId);
      }

      // Invalidate related caches
      await this.invalidateUserCaches(userId);

      this.logger.log(`Task status update processing completed`, { taskId, userId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to process task status update`, {
        taskId,
        userId,
        error: errorMessage,
      });
      throw error;
    }
  }

  private async handleTaskDeleted(data: TaskDeletedJobData): Promise<void> {
    const { taskId, userId } = data;

    try {
      this.logger.log(`Task deletion processing started`, { taskId, userId });

      // Clean up any related data
      await this.cleanupTaskRelatedData(taskId);

      // Update user statistics
      await this.updateUserTaskStats(userId);

      // Invalidate related caches
      await this.invalidateUserCaches(userId);

      this.logger.log(`Task deletion processing completed`, { taskId, userId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to process task deletion`, {
        taskId,
        userId,
        error: errorMessage,
      });
      throw error;
    }
  }

  private async handleTasksBatchUpdated(data: TasksBatchUpdatedJobData): Promise<void> {
    const { taskIds, updateData, userId } = data;

    try {
      this.logger.log(`Batch update processing started`, {
        taskCount: taskIds.length,
        updateData,
        userId,
      });

      // Process batch updates
      for (const taskId of taskIds) {
        await this.processIndividualTaskUpdate(taskId, updateData);
      }

      // Update statistics if user specified
      if (userId) {
        await this.updateUserTaskStats(userId);
        await this.invalidateUserCaches(userId);
      } else {
        // Invalidate global caches
        await this.invalidateGlobalCaches();
      }

      this.logger.log(`Batch update processing completed`, {
        taskCount: taskIds.length,
        userId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to process batch update`, {
        taskIds,
        updateData,
        userId,
        error: errorMessage,
      });
      throw error;
    }
  }

  private async updateUserTaskStats(userId: string): Promise<void> {
    try {
      // Implement user task statistics update logic
      const userTaskCount = await this.tasksRepository.count({
        where: { userId },
      });

      const completedTaskCount = await this.tasksRepository.count({
        where: { userId, status: TaskStatus.COMPLETED },
      });

      // Store updated stats in cache
      await this.cacheService.set(
        `user_stats:${userId}`,
        {
          totalTasks: userTaskCount,
          completedTasks: completedTaskCount,
          completionRate: userTaskCount > 0 ? (completedTaskCount / userTaskCount) * 100 : 0,
          lastUpdated: new Date().toISOString(),
        },
        { ttl: 3600, namespace: 'stats' }
      );
    } catch (error) {
      this.logger.warn(`Failed to update user task stats`, {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async notifyManagersOfHighPriorityTask(taskId: string, userId: string): Promise<void> {
    try {
      // Implement notification logic for high priority tasks
      this.logger.log(`High priority task notification triggered`, {
        taskId,
        userId,
      });

      // This could integrate with email service, Slack, etc.
      // For now, just log the event
    } catch (error) {
      this.logger.warn(`Failed to notify managers of high priority task`, {
        taskId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async handleTaskCompletion(taskId: string, userId: string): Promise<void> {
    try {
      // Implement task completion logic
      this.logger.log(`Task completion processing`, { taskId, userId });

      // Example: Award points, send completion notification, etc.
      const task = await this.tasksRepository.findOne({
        where: { id: taskId },
        relations: ['user'],
      });

      if (task) {
        // Update completion metrics
        await this.cacheService.increment(
          `user_completions:${userId}:${new Date().toISOString().slice(0, 7)}`,
          1,
          'metrics'
        );
      }
    } catch (error) {
      this.logger.warn(`Failed to process task completion`, {
        taskId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async handleTaskCancellation(taskId: string, userId: string): Promise<void> {
    try {
      // Implement task cancellation logic
      this.logger.log(`Task cancellation processing`, { taskId, userId });

      // Example: Clean up related resources, notify stakeholders, etc.
    } catch (error) {
      this.logger.warn(`Failed to process task cancellation`, {
        taskId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async cleanupTaskRelatedData(taskId: string): Promise<void> {
    try {
      // Clean up any task-related data
      await this.cacheService.delPattern(`task_related:${taskId}:*`);
      
      // Remove any task-specific metrics
      await this.cacheService.delPattern(`task_metrics:${taskId}:*`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup task related data`, {
        taskId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async processIndividualTaskUpdate(taskId: string, updateData: any): Promise<void> {
    try {
      // Process individual task update in batch
      this.logger.debug(`Processing individual task update`, { taskId, updateData });

      // Example: Update search indices, trigger webhooks, etc.
    } catch (error) {
      this.logger.warn(`Failed to process individual task update`, {
        taskId,
        updateData,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async updateTaskStatusMetrics(
    oldStatus: TaskStatus,
    newStatus: TaskStatus,
    userId: string,
  ): Promise<void> {
    try {
      const month = new Date().toISOString().slice(0, 7);
      
      // Increment new status counter
      await this.cacheService.increment(
        `status_metrics:${userId}:${newStatus}:${month}`,
        1,
        'metrics'
      );

      // Decrement old status counter (if it exists)
      const oldCount = await this.cacheService.get<number>(
        `status_metrics:${userId}:${oldStatus}:${month}`,
        'metrics'
      );
      
      if (oldCount && oldCount > 0) {
        await this.cacheService.increment(
          `status_metrics:${userId}:${oldStatus}:${month}`,
          -1,
          'metrics'
        );
      }
    } catch (error) {
      this.logger.warn(`Failed to update task status metrics`, {
        oldStatus,
        newStatus,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async invalidateUserCaches(userId: string): Promise<void> {
    try {
      await Promise.all([
        this.cacheService.delPattern(`tasks:list:*user*${userId}*`, 'tasks'),
        this.cacheService.delPattern(`stats:user:${userId}`, 'tasks'),
        this.cacheService.delPattern(`user_stats:${userId}`, 'stats'),
      ]);
    } catch (error) {
      this.logger.warn(`Failed to invalidate user caches`, {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async invalidateGlobalCaches(): Promise<void> {
    try {
      await Promise.all([
        this.cacheService.delPattern('tasks:list:*', 'tasks'),
        this.cacheService.delPattern('stats:global', 'tasks'),
      ]);
    } catch (error) {
      this.logger.warn(`Failed to invalidate global caches`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    const duration = job.processedOn ? `${Date.now() - job.processedOn}ms` : 'unknown';
    this.logger.log(`Job completed successfully`, {
      jobId: job.id,
      name: job.name,
      duration,
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job failed`, {
      jobId: job.id,
      name: job.name,
      error: err.message,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts,
    });
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job stalled`, { jobId });
  }

  @OnWorkerEvent('progress')
  onProgress(job: Job, progress: number | object) {
    this.logger.debug(`Job progress updated`, {
      jobId: job.id,
      name: job.name,
      progress,
    });
  }
}