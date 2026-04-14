import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { sitesApi } from '@/services/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAuthStore } from '@/store/authStore';
import type { Site } from '@/types';
import type { LiveCheckInEvent } from '@/components/LiveFeed';
import { FraudBadge } from '@/components/FraudBadge';

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg: '#09090B', surface: '#18181B', surface2: '#27272A',
  border: 'rgba(255,255,255,0.06)', borderStrong: 'rgba(255,255,255,0.12)',
  primary: '#6366F1', primaryDark: '#4F46E5',
  success: '#22C55E', warning: '#F59E0B', danger: '#EF4444',
  textPrimary: '#FAFAFA', textSecondary: '#A1A1AA', textMuted: '#71717A',
};

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_SITES: Site[] = [
  { id: 's1', org_id: 'o1', name: 'HQ – Downtown Office', address: 'Connaught Place, New Delhi', center_lat: 28.6315, center_lng: 77.2167, radius_meters: 150, is_active: true, employee_count: 8, created_at: '', updated_at: '' },
  { id: 's2', org_id: 'o1', name: 'Warehouse – Industrial Zone', address: 'Sector 63, Noida', center_lat: 28.6126, center_lng: 77.3672, radius_meters: 200, is_active: true, employee_count: 4, created_at: '', updated_at: '' },
  { id: 's3', org_id: 'o1', name: 'Branch – South Delhi', address: 'Saket, New Delhi', center_lat: 28.5244, center_lng: 77.2066, radius_meters: 100, is_active: true, employee_count: 3, created_at: '', updated_at: '' },
];

const DEMO_EVENTS: LiveCheckInEvent[] = [
  { id: 'e1', user_id: 'u1', user_name: 'Emily Chen', user_email: 'emily@demo', avatar_url: null, event_type: 'checkin', site_name: 'HQ – Downtown Office', latitude: 28.6318, longitude: 77.2170, fraud_score: 0.02, fraud_flags: [], timestamp: new Date(Date.now() - 120000).toISOString() },
  { id: 'e2', user_id: 'u2', user_name: 'Raj Patel', user_email: 'raj@demo', avatar_url: null, event_type: 'checkin', site_name: 'HQ – Downtown Office', latitude: 28.6312, longitude: 77.2163, fraud_score: 0.05, fraud_flags: [], timestamp: new Date(Date.now() - 300000).toISOString() },
  { id: 'e3', user_id: 'u3', user_name: 'David Brown', user_email: 'david@demo', avatar_url: null, event_type: 'checkin', site_name: 'Warehouse – Industrial Zone', latitude: 28.6130, longitude: 77.3675, fraud_score: 0.68, fraud_flags: ['vpn_detected'], timestamp: new Date(Date.now() - 900000).toISOString() },
  { id: 'e4', user_id: 'u4', user_name: 'Maria Garcia', user_email: 'maria@demo', avatar_url: null, event_type: 'checkout', site_name: 'Branch – South Delhi', latitude: 28.5248, longitude: 77.2069, fraud_score: 0.01, fraud_flags: [], timestamp: new Date(Date.now() - 1800000).toISOString() },
];

// ─── Web-only Leaflet map ─────────────────────────────────────────────────────

function WebMap({
  sites,
  events,
  selectedEvent,
  onSelectEvent,
}: {
  sites: Site[];
  events: LiveCheckInEvent[];
  selectedEvent: LiveCheckInEvent | null;
  onSelectEvent: (e: LiveCheckInEvent | null) => void;
}) {
  const mapRef = useRef<any>(null);
  const [MapComponents, setMapComponents] = useState<any>(null);

  // Inject Leaflet CSS into <head> once
  useEffect(() => {
    if (document.querySelector('link[data-leaflet-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.setAttribute('data-leaflet-css', '1');
    document.head.appendChild(link);
  }, []);

  // Lazy-load react-leaflet to avoid SSR issues
  useEffect(() => {
    import('react-leaflet').then((rl) => {
      import('leaflet').then((L) => {
        // Fix default marker icons (broken in webpack/metro builds)
        delete (L.default.Icon.Default.prototype as any)._getIconUrl;
        L.default.Icon.Default.mergeOptions({
          iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        });
        setMapComponents({ ...rl, L: L.default });
      });
    });
  }, []);

  // Default center: average of all sites, fallback to New Delhi
  const center = useMemo(() => {
    if (sites.length === 0) return [28.6139, 77.2090] as [number, number];
    const avgLat = sites.reduce((s, x) => s + x.center_lat, 0) / sites.length;
    const avgLng = sites.reduce((s, x) => s + x.center_lng, 0) / sites.length;
    return [avgLat, avgLng] as [number, number];
  }, [sites]);

  if (!MapComponents) {
    return (
      <View style={webStyles.loading}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={webStyles.loadingText}>Loading map…</Text>
      </View>
    );
  }

  const { MapContainer, TileLayer, Circle, Marker, Popup, CircleMarker, useMap } = MapComponents;
  const L = MapComponents.L;

  const eventColor = (e: LiveCheckInEvent) => {
    if (e.fraud_score > 0.6) return C.danger;
    if (e.event_type === 'checkout') return C.primary;
    return C.success;
  };

  const makeIcon = (color: string) =>
    L.divIcon({
      html: `<div style="
        width:14px;height:14px;border-radius:50%;
        background:${color};border:2.5px solid white;
        box-shadow:0 0 6px ${color}88;
      "></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      className: '',
    });

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <MapContainer
        center={center}
        zoom={12}
        style={{ width: '100%', height: '100%', background: '#1a1a2e' }}
        ref={mapRef}
        zoomControl
      >
        {/* Dark tile layer */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={19}
        />

        {/* Geofence circles */}
        {sites.map((site) => (
          <React.Fragment key={site.id}>
            <Circle
              center={[site.center_lat, site.center_lng]}
              radius={site.radius_meters}
              pathOptions={{
                color: site.is_active ? C.primary : C.textMuted,
                fillColor: site.is_active ? C.primary : C.textMuted,
                fillOpacity: 0.08,
                weight: 2,
                dashArray: site.is_active ? undefined : '6 4',
              }}
            />
            <CircleMarker
              center={[site.center_lat, site.center_lng]}
              radius={5}
              pathOptions={{ color: C.primary, fillColor: C.primary, fillOpacity: 1, weight: 0 }}
            >
              <Popup>
                <div style={{ fontFamily: 'sans-serif', minWidth: 140 }}>
                  <b style={{ color: '#4F46E5' }}>{site.name}</b>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{site.address || '—'}</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Radius: {site.radius_meters}m</div>
                  {site.employee_count != null && (
                    <div style={{ fontSize: 12 }}>Employees: {site.employee_count}</div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          </React.Fragment>
        ))}

        {/* Check-in / checkout event markers */}
        {events.map((ev) => (
          <Marker
            key={ev.id}
            position={[ev.latitude, ev.longitude]}
            icon={makeIcon(eventColor(ev))}
            eventHandlers={{ click: () => onSelectEvent(ev) }}
          >
            <Popup>
              <div style={{ fontFamily: 'sans-serif', minWidth: 160 }}>
                <b>{ev.user_name}</b>
                <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{ev.event_type === 'checkin' ? '✅ Checked In' : '🚪 Checked Out'}</div>
                <div style={{ fontSize: 12, marginTop: 2 }}>{ev.site_name}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{format(new Date(ev.timestamp), 'hh:mm:ss a')}</div>
                {ev.fraud_score > 0.3 && (
                  <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>⚠ Fraud score: {Math.round(ev.fraud_score * 100)}%</div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

// ─── Event Row ─────────────────────────────────────────────────────────────────

function EventRow({ event, onPress }: { event: LiveCheckInEvent; onPress: () => void }) {
  const color = event.fraud_score > 0.6 ? C.danger : event.event_type === 'checkout' ? C.primary : C.success;
  const icon = event.event_type === 'checkin' ? 'login' : event.event_type === 'checkout' ? 'logout' : 'coffee';
  const initials = event.user_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <Pressable style={panelStyles.row} onPress={onPress}>
      <View style={[panelStyles.avatar, { backgroundColor: color + '22' }]}>
        <Text style={[panelStyles.avatarText, { color }]}>{initials}</Text>
      </View>
      <View style={panelStyles.rowContent}>
        <Text style={panelStyles.name} numberOfLines={1}>{event.user_name}</Text>
        <View style={panelStyles.meta}>
          <MaterialCommunityIcons name={icon as any} size={11} color={color} />
          <Text style={[panelStyles.metaText, { color }]}>
            {event.event_type === 'checkin' ? 'In' : 'Out'}
          </Text>
          <Text style={panelStyles.dot}>·</Text>
          <Text style={panelStyles.metaText} numberOfLines={1}>{format(new Date(event.timestamp), 'HH:mm')}</Text>
        </View>
      </View>
      {event.fraud_score > 0.1 && (
        <FraudBadge score={event.fraud_score} flags={event.fraud_flags} />
      )}
    </Pressable>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function MapScreen() {
  const isDemoMode = useAuthStore(s => s.isDemoMode);
  const user = useAuthStore(s => s.user);
  const [selectedEvent, setSelectedEvent] = useState<LiveCheckInEvent | null>(null);
  const [liveEvents, setLiveEvents] = useState<LiveCheckInEvent[]>([]);

  // Fetch geofence sites
  const { data: sitesData, isLoading: sitesLoading } = useQuery({
    queryKey: ['sites', 'map'],
    queryFn: () => sitesApi.list(user?.org_id ?? '').then(r => r.data ?? []),
    enabled: !isDemoMode && !!user?.org_id,
    staleTime: 5 * 60_000,
  });

  const sites: Site[] = isDemoMode ? DEMO_SITES : (sitesData ?? []);

  // Live WebSocket feed
  const { messages, isConnected } = useWebSocket<LiveCheckInEvent>('feed');

  // Accumulate real-time events (max 100)
  useEffect(() => {
    if (isDemoMode) {
      setLiveEvents(DEMO_EVENTS);
      return;
    }
    const rawEvents = (messages as unknown as LiveCheckInEvent[])
      .filter(e => e && typeof e.id === 'string' && e.event_type && e.latitude && e.longitude);
    if (rawEvents.length > 0) {
      setLiveEvents(prev => {
        const existing = new Set(prev.map(e => e.id));
        const fresh = rawEvents.filter(e => !existing.has(e.id));
        return [...fresh, ...prev].slice(0, 100);
      });
    }
  }, [messages, isDemoMode]);

  const effectiveConnected = isDemoMode ? true : isConnected;
  const sortedEvents = useMemo(
    () => [...liveEvents].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [liveEvents],
  );

  if (Platform.OS !== 'web') {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <MaterialCommunityIcons name="map-outline" size={48} color={C.textMuted} />
        <Text style={{ color: C.textMuted, marginTop: 12 }}>Map available on web only.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Live Map</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: effectiveConnected ? C.success : '#9CA3AF' }]} />
          <Text style={styles.statusText}>{isDemoMode ? 'Demo' : effectiveConnected ? 'Live' : 'Reconnecting'}</Text>
          <Text style={styles.countText}>{sortedEvents.length} events</Text>
        </View>
      </View>

      {/* Body: map + sidebar */}
      <View style={styles.body}>
        {/* Map */}
        <View style={styles.mapArea}>
          {sitesLoading ? (
            <View style={styles.mapLoading}>
              <ActivityIndicator size="large" color={C.primary} />
            </View>
          ) : (
            <WebMap
              sites={sites}
              events={sortedEvents}
              selectedEvent={selectedEvent}
              onSelectEvent={setSelectedEvent}
            />
          )}

          {/* Legend overlay */}
          <View style={styles.legend}>
            <LegendItem color={C.success} label="Check-in" />
            <LegendItem color={C.primary} label="Check-out" />
            <LegendItem color={C.danger} label="High risk" />
            <LegendItem color={C.primary} label="Geofence" circle />
          </View>
        </View>

        {/* Sidebar: event list */}
        <View style={styles.sidebar}>
          <Text style={styles.sidebarTitle}>Recent Events</Text>
          {sortedEvents.length === 0 ? (
            <View style={styles.emptyPanel}>
              <MaterialCommunityIcons name="radio-tower" size={28} color={C.textMuted} />
              <Text style={styles.emptyText}>
                {effectiveConnected ? 'Waiting for check-ins…' : 'Connecting…'}
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {sortedEvents.map(ev => (
                <EventRow
                  key={ev.id}
                  event={ev}
                  onPress={() => setSelectedEvent(ev === selectedEvent ? null : ev)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </View>

      {/* Selected event detail drawer */}
      {selectedEvent && (
        <View style={styles.detailBar}>
          <View style={styles.detailContent}>
            <MaterialCommunityIcons
              name={selectedEvent.event_type === 'checkin' ? 'login' : 'logout'}
              size={18}
              color={selectedEvent.event_type === 'checkin' ? C.success : C.primary}
            />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.detailName}>{selectedEvent.user_name}</Text>
              <Text style={styles.detailMeta}>
                {selectedEvent.site_name} · {format(new Date(selectedEvent.timestamp), 'hh:mm:ss a')}
              </Text>
            </View>
            {selectedEvent.fraud_score > 0 && (
              <FraudBadge score={selectedEvent.fraud_score} flags={selectedEvent.fraud_flags} />
            )}
            <Pressable onPress={() => setSelectedEvent(null)} style={styles.detailClose}>
              <MaterialCommunityIcons name="close" size={16} color={C.textMuted} />
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function LegendItem({ color, label, circle }: { color: string; label: string; circle?: boolean }) {
  return (
    <View style={legendStyles.item}>
      {circle ? (
        <View style={[legendStyles.ring, { borderColor: color }]} />
      ) : (
        <View style={[legendStyles.dot, { backgroundColor: color }]} />
      )}
      <Text style={legendStyles.label}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: C.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, color: C.textSecondary, fontWeight: '500' },
  countText: { fontSize: 12, color: C.textMuted, marginLeft: 4 },
  body: { flex: 1, flexDirection: 'row' },
  mapArea: { flex: 1, position: 'relative' },
  mapLoading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  sidebar: {
    width: 230, backgroundColor: C.surface,
    borderLeftWidth: 1, borderLeftColor: C.border,
  },
  sidebarTitle: {
    fontSize: 13, fontWeight: '700', color: C.textSecondary,
    paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  emptyPanel: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 8 },
  emptyText: { fontSize: 12, color: C.textMuted, textAlign: 'center' },
  legend: {
    position: 'absolute', bottom: 16, left: 12,
    backgroundColor: 'rgba(9,9,11,0.85)',
    borderRadius: 10, padding: 10, gap: 6,
    borderWidth: 1, borderColor: C.border,
    flexDirection: 'column',
  },
  detailBar: {
    backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  detailContent: { flexDirection: 'row', alignItems: 'center' },
  detailName: { fontSize: 14, fontWeight: '600', color: C.textPrimary },
  detailMeta: { fontSize: 12, color: C.textSecondary, marginTop: 1 },
  detailClose: { padding: 4, marginLeft: 8 },
});

const legendStyles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  ring: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  label: { fontSize: 11, color: C.textSecondary },
});

const panelStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: C.border, gap: 8,
  },
  avatar: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 11, fontWeight: '700' },
  rowContent: { flex: 1, gap: 2 },
  name: { fontSize: 13, fontWeight: '600', color: C.textPrimary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: C.textMuted },
  dot: { fontSize: 11, color: C.textMuted },
});

const webStyles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: '#1a1a2e' },
  loadingText: { fontSize: 14, color: C.textSecondary },
});
