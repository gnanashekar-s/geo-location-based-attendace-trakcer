import { useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { useAuthStore } from '@/store/authStore';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WebSocketEndpoint = 'feed' | 'approvals';

export interface WebSocketMessage<T = unknown> {
  type: string;
  data: T;
  timestamp: string;
}

export interface UseWebSocketResult<T = unknown> {
  messages: WebSocketMessage<T>[];
  isConnected: boolean;
  lastMessage: WebSocketMessage<T> | null;
  /** Manually send a JSON-serialisable payload */
  sendMessage: (payload: unknown) => void;
  /** Manually trigger a reconnect */
  reconnect: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_MESSAGES = 50;
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;

// Mirror the same URL logic used in services/api.ts so WS works on phone too
const TUNNEL_URL = '';
const HTTP_BASE =
  Platform.OS === 'web'
    ? 'http://localhost:8000'
    : TUNNEL_URL || 'http://192.168.1.69:8000';

function getWsUrl(endpoint: WebSocketEndpoint, token: string): string {
  const wsBase = HTTP_BASE.replace(/^http/, 'ws');
  return `${wsBase}/ws/${endpoint}?token=${encodeURIComponent(token)}`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWebSocket<T = unknown>(
  endpoint: WebSocketEndpoint,
): UseWebSocketResult<T> {
  const [messages, setMessages] = useState<WebSocketMessage<T>[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage<T> | null>(
    null,
  );

  const wsRef = useRef<WebSocket | null>(null);
  const retryDelayRef = useRef<number>(INITIAL_RETRY_DELAY_MS);
  const retryCountRef = useRef<number>(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const manualDisconnectRef = useRef<boolean>(false);

  const token = useAuthStore.getState().token;

  const clearRetryTimeout = () => {
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  };

  const connect = useCallback(() => {
    if (!token) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Clean up any existing socket before creating a new one
    wsRef.current?.close();

    try {
      const url = getWsUrl(endpoint, token);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        setIsConnected(true);
        retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
        retryCountRef.current = 0;
      };

      ws.onmessage = (event: any) => {
        if (!isMountedRef.current) return;
        try {
          const parsed = JSON.parse(event.data as string) as WebSocketMessage<T>;
          setLastMessage(parsed);
          setMessages((prev) =>
            [parsed, ...prev].slice(0, MAX_MESSAGES),
          );
        } catch {
          // Non-JSON frames (e.g. ping text) — silently ignore
        }
      };

      ws.onerror = () => {
        // onerror is always followed by onclose; handle reconnect there
      };

      ws.onclose = (event: any) => {
        if (!isMountedRef.current) return;
        setIsConnected(false);

        // 1000 = Normal closure, 1001 = Going Away — don't retry
        if (
          manualDisconnectRef.current ||
          event.code === 1000 ||
          event.code === 1001
        ) {
          return;
        }

        if (retryCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
          return;
        }

        // Exponential back-off with jitter
        const jitter = Math.random() * 500;
        const delay = Math.min(retryDelayRef.current + jitter, MAX_RETRY_DELAY_MS);
        retryDelayRef.current = Math.min(
          retryDelayRef.current * 2,
          MAX_RETRY_DELAY_MS,
        );
        retryCountRef.current += 1;

        retryTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current && !manualDisconnectRef.current) {
            connect();
          }
        }, delay);
      };
    } catch {
      // WebSocket constructor may throw in some environments
      setIsConnected(false);
    }
  }, [endpoint, token]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    clearRetryTimeout();
    wsRef.current?.close(1000, 'Component unmounted');
    wsRef.current = null;
    setIsConnected(false);
  }, []);

  const reconnect = useCallback(() => {
    manualDisconnectRef.current = false;
    retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
    retryCountRef.current = 0;
    clearRetryTimeout();
    connect();
  }, [connect]);

  const sendMessage = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  // Initial connect and cleanup
  useEffect(() => {
    isMountedRef.current = true;
    manualDisconnectRef.current = false;

    if (token) {
      connect();
    }

    return () => {
      isMountedRef.current = false;
      disconnect();
    };
  }, [connect, disconnect, token]);

  return { messages, isConnected, lastMessage, sendMessage, reconnect };
}
