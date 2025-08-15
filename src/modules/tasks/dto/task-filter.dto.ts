import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsString, IsDateString } from 'class-validator';
import { TaskStatus } from '../enums/task-status.enum';
import { TaskPriority } from '../enums/task-priority.enum';

export class TaskFilterDto {
  @ApiPropertyOptional({
    enum: TaskStatus,
    description: 'Filter tasks by status',
    example: TaskStatus.IN_PROGRESS,
  })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({
    enum: TaskPriority,
    description: 'Filter tasks by priority',
    example: TaskPriority.HIGH,
  })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({
    description: 'Search in task title and description',
    example: 'important project',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter tasks with due date from this date',
    example: '2023-12-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  dueDateFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter tasks with due date until this date',
    example: '2023-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  dueDateTo?: string;

  @ApiPropertyOptional({
    description: 'Filter tasks created from this date',
    example: '2023-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  createdDateFrom?: string;

  @ApiPropertyOptional({
    description: 'Filter tasks created until this date',
    example: '2023-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  createdDateTo?: string;
}