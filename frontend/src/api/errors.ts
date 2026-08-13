import { AxiosError } from "axios";

export interface ApiErrorBody {
  error: string;
  details?: unknown;
}

export function isApiError(err: unknown): err is AxiosError<ApiErrorBody> {
  return err instanceof AxiosError;
}
