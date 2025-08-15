import { Injectable, ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { ValidationException } from '@common/exceptions/taskflow.exceptions';

@Injectable()
export class ValidationPipe implements PipeTransform<any> {
  async transform(value: any, { metatype }: ArgumentMetadata) {
    // Skip validation for certain parameter types
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    try {
      const object = plainToClass(metatype, value, {
        enableImplicitConversion: true,
      });
      
      const errors = await validate(object, {
        whitelist: true,
        forbidNonWhitelisted: true,
        validateCustomDecorators: true,
      });

      if (errors.length > 0) {
        const validationErrors = errors.map(error => ({
          field: error.property,
          value: error.value,
          constraints: error.constraints ? Object.values(error.constraints) : [],
        }));

        throw new ValidationException(
          'Validation failed',
          validationErrors
        );
      }

      return object;
    } catch (error) {
      if (error instanceof ValidationException) {
        throw error;
      }
      
      // Handle other validation errors
      const errorMessage = error instanceof Error ? error.message : 'Validation failed';
      throw new ValidationException('Invalid request data', [
        {
          field: 'unknown',
          value,
          constraints: [errorMessage],
        },
      ]);
    }
  }

  private toValidate(metatype: any): boolean {
    const types = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}