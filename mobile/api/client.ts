import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import Constants from 'expo-constants';
import { useAuthStore } from '@/store/authStore';

// ─── Base URL ─────────────────────────────────────────────────────────────────

const API_URL: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://localhost:8000';

// ─── Shared Response Shape ────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  data: T;
  message: string;
  success: boolean;
}

export interface PaginatedResponse<T = unknown> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
}

export interface ApiError {
  detail: string;
  code?: string;
  field_errors?: Record<string, string[]>;
}

// ─── Refresh Token State ──────────────────────────────────────────────────────

let isRefreshing = false;
let pendingRequests: Array<(token: string) => void> = [];

function onRefreshed(token: string) {
  pendingRequests.forEach((resolve) => resolve(token));
  pendingRequests = [];
}

// ─── Axios Instance ───────────────────────────────────────────────────────────

const apiClient: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// ─── Request Interceptor ──────────────────────────────────────────────────────

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    const token = useAuthStore.getState().token;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// ─── Response Interceptor ─────────────────────────────────────────────────────

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // Only attempt refresh on 401 and if we have not already retried
    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    const { refreshToken, setTokens, logout } = useAuthStore.getState();

    // No refresh token available — log out immediately
    if (!refreshToken) {
      logout();
      return Promise.reject(error);
    }

    // If a refresh is already in flight, queue this request
    if (isRefreshing) {
      return new Promise<AxiosResponse>((resolve, reject) => {
        pendingRequests.push((newToken: string) => {
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          resolve(apiClient(originalRequest));
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const response = await axios.post<{
        access_token: string;
        refresh_token: string;
      }>(`${API_URL}/api/v1/auth/refresh`, { refresh_token: refreshToken });

      const { access_token, refresh_token: newRefresh } = response.data;
      setTokens(access_token, newRefresh);
      onRefreshed(access_token);

      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
      }

      return apiClient(originalRequest);
    } catch (refreshError) {
      pendingRequests = [];
      logout();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

export default apiClient;

// ─── Typed Helpers ────────────────────────────────────────────────────────────

/**
 * In demo mode, throw a special error so React Query hooks treat the call
 * as a "no-op" without hitting the network. Individual hooks can supply
 * their own demo data via queryFn overrides or initialData.
 */
function guardDemoMode(): void {
  if (useAuthStore.getState().isDemoMode) {
    throw Object.assign(new Error('Demo mode – network disabled'), { isDemo: true });
  }
}

export async function apiGet<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<T> {
  guardDemoMode();
  const res = await apiClient.get<T>(url, config);
  return res.data;
}

export async function apiPost<TData, TResponse>(
  url: string,
  data?: TData,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  guardDemoMode();
  const res = await apiClient.post<TResponse>(url, data, config);
  return res.data;
}

export async function apiPut<TData, TResponse>(
  url: string,
  data?: TData,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  guardDemoMode();
  const res = await apiClient.put<TResponse>(url, data, config);
  return res.data;
}

export async function apiPatch<TData, TResponse>(
  url: string,
  data?: TData,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  guardDemoMode();
  const res = await apiClient.patch<TResponse>(url, data, config);
  return res.data;
}

export async function apiDelete<TResponse>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<TResponse> {
  guardDemoMode();
  const res = await apiClient.delete<TResponse>(url, config);
  return res.data;
}

/** Extract a user-friendly message from an Axios error. */
export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const apiErr = error.response?.data as ApiError | undefined;
    if (apiErr?.detail) return apiErr.detail;
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}
