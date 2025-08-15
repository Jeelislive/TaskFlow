import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { TaskProcessorService } from './task-processor.service';
import { Task } from '../../modules/tasks/entities/task.entity';
import { CacheService } from '@common/services/cache.service';
import { TasksModule } from '../../modules/tasks/tasks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task]),
    BullModule.registerQueue({
      name: 'task-processing',
    }),
    TasksModule,
  ],
  providers: [TaskProcessorService, CacheService],
  exports: [TaskProcessorService],
})
export class TaskProcessorModule {}