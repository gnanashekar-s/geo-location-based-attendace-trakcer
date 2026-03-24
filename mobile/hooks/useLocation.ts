import { useEffect, useRef, useState, useCallback } from 'react';
import * as Location from 'expo-location';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LocationCoords {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
}

export interface LocationData {
  coords: LocationCoords;
  timestamp: number;
  /** True when the OS reports this position came from a mock/emulated provider */
  isMocked: boolean;
}

export interface UseLocationResult {
  location: LocationData | null;
  error: string | null;
  isLoading: boolean;
  hasPermission: boolean | null;
  /** Manually request permission again (e.g. after user goes to Settings) */
  requestPermission: () => Promise<void>;
  /** Last known position stored in a ref — always available without re-render */
  lastKnownRef: React.MutableRefObject<LocationData | null>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCATION_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 5_000,   // ms between updates
  distanceInterval: 5,   // meters
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLocation(): UseLocationResult {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const lastKnownRef = useRef<LocationData | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);

  const handleLocationUpdate = useCallback(
    (raw: Location.LocationObject) => {
      const data: LocationData = {
        coords: {
          latitude: raw.coords.latitude,
          longitude: raw.coords.longitude,
          accuracy: raw.coords.accuracy ?? null,
          altitude: raw.coords.altitude ?? null,
          altitudeAccuracy: raw.coords.altitudeAccuracy ?? null,
          heading: raw.coords.heading ?? null,
          speed: raw.coords.speed ?? null,
        },
        timestamp: raw.timestamp,
        // expo-location exposes `mocked` on the coords object on Android
        isMocked: (raw.coords as Location.LocationObjectCoords & { mocked?: boolean }).mocked === true,
      };

      lastKnownRef.current = data;
      setLocation(data);
      setError(null);
    },
    [],
  );

  const startWatching = useCallback(async () => {
    // Stop any existing subscription first
    subscriptionRef.current?.remove();

    try {
      subscriptionRef.current = await Location.watchPositionAsync(
        LOCATION_OPTIONS,
        handleLocationUpdate,
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to start location tracking.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [handleLocationUpdate]);

  const requestPermission = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const granted = status === Location.PermissionStatus.GRANTED;
      setHasPermission(granted);

      if (granted) {
        await startWatching();
      } else {
        setError(
          'Location permission denied. Please enable it in your device settings.',
        );
        setIsLoading(false);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Permission request failed.';
      setError(message);
      setHasPermission(false);
      setIsLoading(false);
    }
  }, [startWatching]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Check existing permission status before requesting
        const { status } = await Location.getForegroundPermissionsAsync();

        if (cancelled) return;

        if (status === Location.PermissionStatus.GRANTED) {
          setHasPermission(true);
          await startWatching();
        } else {
          // Request if not yet determined
          await requestPermission();
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Location initialisation failed.',
          );
          setIsLoading(false);
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, [startWatching, requestPermission]);

  return {
    location,
    error,
    isLoading,
    hasPermission,
    requestPermission,
    lastKnownRef,
  };
}
