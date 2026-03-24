import React, { useState, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface SiteGeo {
  center_lat: number;
  center_lng: number;
  radius_meters: number;
  name: string;
}

interface Props {
  site: SiteGeo;
  onUpdate: (lat: number, lng: number, radius: number) => void;
}

// ─── Web / unsupported platform fallback ──────────────────────────────────────

function WebFallback({ site, onUpdate }: Props) {
  const [radius, setRadius] = useState(site.radius_meters);
  return (
    <View style={styles.webFallback}>
      <MaterialCommunityIcons name="map-marker-radius" size={64} color="#CBD5E1" />
      <Text style={styles.webTitle}>Map editor available on native app</Text>
      <Text style={styles.webSub}>
        Center: {site.center_lat.toFixed(5)}, {site.center_lng.toFixed(5)}
      </Text>
      <Text style={styles.webSub}>Current radius: {site.radius_meters}m</Text>
      <View style={styles.radiusRow}>
        <Text style={styles.radiusLabel}>New radius: {radius}m</Text>
      </View>
      <Button mode="contained" onPress={() => onUpdate(site.center_lat, site.center_lng, radius)}>
        Save Radius
      </Button>
    </View>
  );
}

// ─── Native map editor ────────────────────────────────────────────────────────

function NativeMapEditor({ site, onUpdate }: Props) {
  const [center, setCenter] = useState({ lat: site.center_lat, lng: site.center_lng });
  const [radius, setRadius] = useState(site.radius_meters);
  const [saving, setSaving] = useState(false);

  // Lazy-load react-native-maps to avoid web crashes
  let MapView: any, Circle: any, Marker: any;
  try {
    const maps = require('react-native-maps');
    MapView = maps.default;
    Circle = maps.Circle;
    Marker = maps.Marker;
  } catch {
    return <WebFallback site={site} onUpdate={onUpdate} />;
  }

  const region = {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: Math.max(0.005, (radius / 111000) * 3),
    longitudeDelta: Math.max(0.005, (radius / 111000) * 3),
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(center.lat, center.lng, radius);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.nativeContainer}>
      <MapView
        style={styles.map}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton
      >
        <Circle
          center={{ latitude: center.lat, longitude: center.lng }}
          radius={radius}
          fillColor="rgba(79, 70, 229, 0.15)"
          strokeColor="#4F46E5"
          strokeWidth={2}
        />
        <Marker
          coordinate={{ latitude: center.lat, longitude: center.lng }}
          draggable
          onDragEnd={(e: any) => setCenter({
            lat: e.nativeEvent.coordinate.latitude,
            lng: e.nativeEvent.coordinate.longitude,
          })}
          title={site.name}
          pinColor="#4F46E5"
        />
      </MapView>

      <View style={styles.controls}>
        <View style={styles.radiusRow}>
          <Text style={styles.radiusLabel}>Radius: {radius}m</Text>
        </View>
        <View style={styles.sliderRow}>
          <Text style={styles.sliderBound}>10m</Text>
          <View style={styles.sliderTrack}>
            <View style={[styles.sliderFill, { width: `${((radius - 10) / 4990) * 100}%` }]} />
          </View>
          <Text style={styles.sliderBound}>5000m</Text>
        </View>
        <View style={styles.btnRow}>
          {[10, 50, 100, 200, 500, 1000].map(r => (
            <Button
              key={r}
              compact
              mode={radius === r ? 'contained' : 'outlined'}
              onPress={() => setRadius(r)}
              style={styles.presetBtn}
              labelStyle={styles.presetLabel}
            >
              {r >= 1000 ? `${r / 1000}km` : `${r}m`}
            </Button>
          ))}
        </View>
        <Button
          mode="contained"
          onPress={handleSave}
          loading={saving}
          style={styles.saveBtn}
          icon="content-save"
        >
          Save Changes
        </Button>
      </View>
    </View>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function MapGeofenceEditor(props: Props) {
  if (Platform.OS === 'web') {
    return <WebFallback {...props} />;
  }
  return <NativeMapEditor {...props} />;
}

const styles = StyleSheet.create({
  webFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  webTitle: { fontSize: 16, fontWeight: '600', color: '#64748B', textAlign: 'center' },
  webSub: { fontSize: 13, color: '#94A3B8' },
  nativeContainer: { flex: 1 },
  map: { flex: 1 },
  controls: { backgroundColor: '#FFFFFF', padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  radiusRow: { alignItems: 'center' },
  radiusLabel: { fontSize: 16, fontWeight: '700', color: '#1E293B' },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sliderBound: { fontSize: 11, color: '#94A3B8' },
  sliderTrack: { flex: 1, height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, overflow: 'hidden' },
  sliderFill: { height: 6, backgroundColor: '#4F46E5', borderRadius: 3 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  presetBtn: { borderRadius: 8 },
  presetLabel: { fontSize: 11 },
  saveBtn: { borderRadius: 10, marginTop: 4 },
});
