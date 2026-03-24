import React, { useMemo } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface HeatmapPoint {
  lat: number;
  lng: number;
  weight: number;
}

interface Props {
  points: HeatmapPoint[];
}

function weightToColor(weight: number, maxWeight: number): string {
  const ratio = Math.min(weight / Math.max(maxWeight, 1), 1);
  if (ratio < 0.33) return `rgba(59, 130, 246, ${0.4 + ratio * 0.6})`; // blue
  if (ratio < 0.66) return `rgba(245, 158, 11, ${0.5 + ratio * 0.5})`; // amber
  return `rgba(239, 68, 68, ${0.6 + ratio * 0.4})`;  // red
}

function clusterPoints(points: HeatmapPoint[], threshold = 0.001): HeatmapPoint[] {
  const clusters: HeatmapPoint[] = [];
  const used = new Set<number>();
  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    let sumLat = points[i].lat;
    let sumLng = points[i].lng;
    let totalWeight = points[i].weight;
    let count = 1;
    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue;
      const dLat = Math.abs(points[i].lat - points[j].lat);
      const dLng = Math.abs(points[i].lng - points[j].lng);
      if (dLat < threshold && dLng < threshold) {
        sumLat += points[j].lat;
        sumLng += points[j].lng;
        totalWeight += points[j].weight;
        count++;
        used.add(j);
      }
    }
    clusters.push({ lat: sumLat / count, lng: sumLng / count, weight: totalWeight });
    used.add(i);
  }
  return clusters;
}

// ─── Native component (renders markers on parent MapView) ─────────────────────

function NativeHeatmap({ points }: Props) {
  let Marker: any;
  try {
    Marker = require('react-native-maps').Marker;
  } catch {
    return null;
  }

  const maxWeight = useMemo(() => Math.max(...points.map(p => p.weight), 1), [points]);
  const clustered = useMemo(() => clusterPoints(points), [points]);

  if (clustered.length === 0) return null;

  return (
    <>
      {clustered.map((point, i) => {
        const color = weightToColor(point.weight, maxWeight);
        const size = 8 + Math.round((point.weight / maxWeight) * 24);
        return (
          <Marker
            key={i}
            coordinate={{ latitude: point.lat, longitude: point.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]} />
          </Marker>
        );
      })}
    </>
  );
}

// ─── Web / fallback component ─────────────────────────────────────────────────

function HeatmapFallback({ points }: Props) {
  if (points.length === 0) {
    return (
      <View style={styles.empty}>
        <MaterialCommunityIcons name="map-search-outline" size={32} color="#CBD5E1" />
        <Text style={styles.emptyText}>No location data available</Text>
      </View>
    );
  }
  return (
    <View style={styles.statsContainer}>
      <Text style={styles.statsText}>{points.length} location clusters recorded</Text>
      <Text style={styles.statsSubtext}>Heatmap available on mobile app</Text>
    </View>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function HeatmapLayer({ points }: Props) {
  if (Platform.OS === 'web') {
    return <HeatmapFallback points={points} />;
  }
  return <NativeHeatmap points={points} />;
}

const styles = StyleSheet.create({
  dot: {
    opacity: 0.75,
  },
  empty: {
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: '#94A3B8',
  },
  statsContainer: {
    padding: 12,
    alignItems: 'center',
  },
  statsText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4F46E5',
  },
  statsSubtext: {
    fontSize: 11,
    color: '#94A3B8',
  },
});
