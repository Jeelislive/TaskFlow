import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { OverdueTasksService } from './overdue-tasks.service';
import { Task } from '../../modules/tasks/entities/task.entity';
import { CacheService } from '@common/services/cache.service';
import { TasksModule } from '../../modules/tasks/tasks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task]),
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: 'task-processing',
    }),
    TasksModule,
  ],
  providers: [OverdueTasksService, CacheService],
  exports: [OverdueTasksService],
})
export class ScheduledTasksModule {}