export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  timestamp: string;
  path: string;
  statusCode: number;
}

export interface ErrorResponse {
  success: false;
  error: string;
  message: string;
  details?: any;
  timestamp: string;
  path: string;
  statusCode: number;
  correlationId?: string;
}

export interface ValidationErrorDetail {
  field: string;
  value: any;
  constraints: string[];
}

export interface ValidationErrorResponse extends ErrorResponse {
  validationErrors: ValidationErrorDetail[];
}

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    database: HealthCheckResult;
    redis: HealthCheckResult;
    queues: HealthCheckResult;
  };
}

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  responseTime: number;
  message?: string;
}

export interface MetricsResponse {
  requests: {
    total: number;
    successful: number;
    failed: number;
    averageResponseTime: number;
  };
  system: {
    memoryUsage: NodeJS.MemoryUsage;
    uptime: number;
    cpuUsage: NodeJS.CpuUsage;
  };
  database: {
    activeConnections: number;
    queriesExecuted: number;
    averageQueryTime: number;
  };
  cache: {
    hitRate: number;
    missRate: number;
    keysCount: number;
  };
}