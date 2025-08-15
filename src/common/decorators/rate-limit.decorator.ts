import { SetMetadata } from '@nestjs/common';
import { RateLimitOptions } from '@common/guards/rate-limit.guard';

export const RATE_LIMIT_KEY = 'rateLimit';
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);