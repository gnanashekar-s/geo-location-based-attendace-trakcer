import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from './client';
import { useAuthStore } from '@/store/authStore';
import type { User } from '@/store/authStore';

// ─── Request / Response Interfaces ───────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
  /** Optional: device push token for notifications */
  push_token?: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  user: User;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
  employee_id?: string;
  department?: string;
}

export interface RegisterResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  user: User;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
}

export interface LogoutRequest {
  refresh_token?: string;
}

export interface LogoutResponse {
  message: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface ChangePasswordResponse {
  message: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ForgotPasswordResponse {
  message: string;
}

export interface ResetPasswordRequest {
  token: string;
  new_password: string;
}

export interface ResetPasswordResponse {
  message: string;
}

// ─── Raw API Functions ────────────────────────────────────────────────────────

export async function loginApi(payload: LoginRequest): Promise<LoginResponse> {
  return apiPost<LoginRequest, LoginResponse>('/api/v1/auth/login', payload);
}

export async function registerApi(
  payload: RegisterRequest,
): Promise<RegisterResponse> {
  return apiPost<RegisterRequest, RegisterResponse>(
    '/api/v1/auth/register',
    payload,
  );
}

export async function refreshTokenApi(
  payload: RefreshTokenRequest,
): Promise<RefreshTokenResponse> {
  return apiPost<RefreshTokenRequest, RefreshTokenResponse>(
    '/api/v1/auth/refresh',
    payload,
  );
}

export async function logoutApi(
  payload?: LogoutRequest,
): Promise<LogoutResponse> {
  return apiPost<LogoutRequest | undefined, LogoutResponse>(
    '/api/v1/auth/logout',
    payload,
  );
}

export async function changePasswordApi(
  payload: ChangePasswordRequest,
): Promise<ChangePasswordResponse> {
  return apiPost<ChangePasswordRequest, ChangePasswordResponse>(
    '/api/v1/auth/change-password',
    payload,
  );
}

export async function forgotPasswordApi(
  payload: ForgotPasswordRequest,
): Promise<ForgotPasswordResponse> {
  return apiPost<ForgotPasswordRequest, ForgotPasswordResponse>(
    '/api/v1/auth/forgot-password',
    payload,
  );
}

export async function resetPasswordApi(
  payload: ResetPasswordRequest,
): Promise<ResetPasswordResponse> {
  return apiPost<ResetPasswordRequest, ResetPasswordResponse>(
    '/api/v1/auth/reset-password',
    payload,
  );
}

// ─── React Query Mutations ────────────────────────────────────────────────────

/**
 * Login mutation.
 * On success: persists tokens + user into authStore.
 */
export function useLoginMutation() {
  const { setTokens, setUser } = useAuthStore();

  return useMutation<LoginResponse, Error, LoginRequest>({
    mutationFn: loginApi,
    onSuccess: (data) => {
      setTokens(data.access_token, data.refresh_token);
      setUser(data.user);
    },
  });
}

/**
 * Register mutation.
 * On success: persists tokens + user into authStore.
 */
export function useRegisterMutation() {
  const { setTokens, setUser } = useAuthStore();

  return useMutation<RegisterResponse, Error, RegisterRequest>({
    mutationFn: registerApi,
    onSuccess: (data) => {
      setTokens(data.access_token, data.refresh_token);
      setUser(data.user);
    },
  });
}

/**
 * Refresh token mutation.
 * Typically called by the Axios interceptor, but exposed for manual use.
 */
export function useRefreshTokenMutation() {
  const { setTokens } = useAuthStore();

  return useMutation<RefreshTokenResponse, Error, RefreshTokenRequest>({
    mutationFn: refreshTokenApi,
    onSuccess: (data) => {
      setTokens(data.access_token, data.refresh_token);
    },
  });
}

/**
 * Logout mutation.
 * Clears server-side session then wipes local auth state.
 */
export function useLogoutMutation() {
  const { logout, refreshToken } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation<LogoutResponse, Error, void>({
    mutationFn: () => logoutApi({ refresh_token: refreshToken ?? undefined }),
    onSettled: () => {
      // Always clear local state regardless of server response
      logout();
      queryClient.clear();
    },
  });
}

/**
 * Change password mutation.
 */
export function useChangePasswordMutation() {
  return useMutation<ChangePasswordResponse, Error, ChangePasswordRequest>({
    mutationFn: changePasswordApi,
  });
}

/**
 * Forgot password mutation.
 */
export function useForgotPasswordMutation() {
  return useMutation<ForgotPasswordResponse, Error, ForgotPasswordRequest>({
    mutationFn: forgotPasswordApi,
  });
}

/**
 * Reset password mutation.
 */
export function useResetPasswordMutation() {
  return useMutation<ResetPasswordResponse, Error, ResetPasswordRequest>({
    mutationFn: resetPasswordApi,
  });
}
