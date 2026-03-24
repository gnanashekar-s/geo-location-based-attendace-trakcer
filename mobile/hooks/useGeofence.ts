import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sitesApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useLocation } from './useLocation';
import type { Site } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseGeofenceResult {
  isWithinGeofence: boolean;
  distanceMeters: number | null;
  site: Site | null;
  isLoading: boolean;
  error: string | null;
}

// ─── Haversine Formula ────────────────────────────────────────────────────────

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Calculate the great-circle distance between two coordinates in metres
 * using the haversine formula.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGeofence(siteId: string): UseGeofenceResult {
  const [isWithinGeofence, setIsWithinGeofence] = useState<boolean>(false);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [geofenceError, setGeofenceError] = useState<string | null>(null);

  const orgId = useAuthStore((s) => s.user?.org_id ?? '');

  // Fetch site data via the sites API (was previously broken apiGet call)
  const {
    data: site,
    isLoading: isSiteLoading,
    error: siteQueryError,
  } = useQuery<Site, Error>({
    queryKey: ['site', orgId, siteId],
    queryFn: () => sitesApi.get(orgId, siteId).then((r) => r.data),
    enabled: Boolean(siteId) && Boolean(orgId),
    staleTime: 5 * 60_000,
  });

  // Subscribe to current location
  const { location, isLoading: isLocationLoading, error: locationError } =
    useLocation();

  // Track the previous distance to avoid redundant state updates
  const prevDistanceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!site || !location) {
      return;
    }

    try {
      const dist = haversineDistance(
        location.coords.latitude,
        location.coords.longitude,
        site.center_lat,
        site.center_lng,
      );

      // Only update state when distance changes meaningfully (>1 m)
      if (
        prevDistanceRef.current === null ||
        Math.abs(prevDistanceRef.current - dist) > 1
      ) {
        prevDistanceRef.current = dist;
        setDistanceMeters(dist);
        setIsWithinGeofence(dist <= site.radius_meters);
        setGeofenceError(null);
      }
    } catch (err) {
      setGeofenceError(
        err instanceof Error ? err.message : 'Geofence calculation failed.',
      );
    }
  }, [location, site]);

  const isLoading = isSiteLoading || isLocationLoading;

  const error =
    geofenceError ??
    locationError ??
    (siteQueryError ? siteQueryError.message : null);

  return {
    isWithinGeofence,
    distanceMeters,
    site: site ?? null,
    isLoading,
    error,
  };
}
