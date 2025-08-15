export interface PaginationOptions {
  page: number;
  limit: number;
  skip?: number;
}

export interface PaginationMeta {
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface SortOptions {
  field: string;
  direction: 'ASC' | 'DESC';
}

export interface FilterOptions {
  [key: string]: any;
}

export interface QueryOptions {
  pagination?: PaginationOptions;
  sort?: SortOptions[];
  filter?: FilterOptions;
  search?: string;
}

export interface BatchOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  id?: string;
}

export interface BulkOperationResponse<T = any> {
  successful: BatchOperationResult<T>[];
  failed: BatchOperationResult<T>[];
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
}