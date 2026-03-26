import React, { useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ListRenderItemInfo,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAuthStore } from '@/store/authStore';
import { FraudBadge } from './FraudBadge';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveCheckInEvent {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  avatar_url: string | null;
  event_type: 'checkin' | 'checkout' | 'break_start' | 'break_end';
  site_name: string;
  latitude: number;
  longitude: number;
  fraud_score: number;
  fraud_flags: string[];
  timestamp: string;
}

interface LiveFeedProps {
  /** Maximum number of events to display in the list */
  maxItems?: number;
  /** Called when the feed receives a new event */
  onNewEvent?: (event: LiveCheckInEvent) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const EVENT_ICON: Record<LiveCheckInEvent['event_type'], IconName> = {
  checkin: 'login',
  checkout: 'logout',
  break_start: 'coffee',
  break_end: 'coffee-off',
};

const EVENT_COLOR: Record<LiveCheckInEvent['event_type'], string> = {
  checkin: '#22C55E',
  checkout: '#6366F1',
  break_start: '#F59E0B',
  break_end: '#3B82F6',
};

const EVENT_LABEL: Record<LiveCheckInEvent['event_type'], string> = {
  checkin: 'Checked In',
  checkout: 'Checked Out',
  break_start: 'Break Started',
  break_end: 'Break Ended',
};

// ─── Animated Item ────────────────────────────────────────────────────────────

const AnimatedFeedItem = React.memo(
  ({ item }: { item: LiveCheckInEvent }) => {
    const color = EVENT_COLOR[item.event_type];
    const icon = EVENT_ICON[item.event_type];
    const label = EVENT_LABEL[item.event_type];
    const formattedTime = format(new Date(item.timestamp), 'hh:mm:ss a');
    const initials = item.user_name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    return (
      <View style={styles.feedItem}>
        {/* Avatar with initials */}
        <View style={[styles.avatar, { backgroundColor: color + '22' }]}>
          <Text style={[styles.avatarText, { color }]}>{initials}</Text>
        </View>

        {/* Details */}
        <View style={styles.itemContent}>
          <View style={styles.itemHeaderRow}>
            <Text style={styles.userName} numberOfLines={1}>
              {item.user_name}
            </Text>
            <Text style={styles.timestamp}>{formattedTime}</Text>
          </View>

          <View style={styles.itemSubRow}>
            <MaterialCommunityIcons name={icon} size={13} color={color} />
            <Text style={[styles.eventLabel, { color }]}>{label}</Text>
            <Text style={styles.separator}>·</Text>
            <Text style={styles.siteName} numberOfLines={1}>
              {item.site_name}
            </Text>
          </View>
        </View>

        {/* Fraud badge */}
        <FraudBadge score={item.fraud_score} flags={item.fraud_flags} />
      </View>
    );
  },
);
AnimatedFeedItem.displayName = 'AnimatedFeedItem';

// ─── Empty State ──────────────────────────────────────────────────────────────

const EmptyFeed: React.FC<{ isConnected: boolean }> = ({ isConnected }) => (
  <View style={styles.emptyContainer}>
    <MaterialCommunityIcons
      name={isConnected ? 'radio-tower' : 'wifi-off'}
      size={40}
      color="#52525B"
    />
    <Text style={styles.emptyTitle}>
      {isConnected ? 'Waiting for activity…' : 'Connecting to feed…'}
    </Text>
    <Text style={styles.emptySubtitle}>
      {isConnected
        ? 'Check-ins will appear here in real-time.'
        : 'Attempting to connect to the live feed.'}
    </Text>
  </View>
);

// ─── Connection Indicator ─────────────────────────────────────────────────────

const ConnectionDot: React.FC<{ isConnected: boolean }> = ({ isConnected }) => (
  <View
    style={[
      styles.dot,
      { backgroundColor: isConnected ? '#22C55E' : '#9CA3AF' },
    ]}
  />
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const LiveFeed: React.FC<LiveFeedProps> = ({
  maxItems = 50,
  onNewEvent,
}) => {
  const isDemoMode = useAuthStore(s => s.isDemoMode);
  const { messages, isConnected } = useWebSocket<LiveCheckInEvent>('feed');
  const flatListRef = useRef<FlatList<LiveCheckInEvent>>(null);
  const prevLengthRef = useRef<number>(0);

  // In demo mode, use static demo events instead of WebSocket
  const demoEvents: LiveCheckInEvent[] = React.useMemo(() => {
    if (!isDemoMode) return [];
    const now = new Date();
    return [
      { id: 'dl-1', user_id: 'demo-emp-002', user_name: 'Emily Chen', user_email: 'emily@demo', avatar_url: null, event_type: 'checkin' as const, site_name: 'HQ – Downtown Office', latitude: 28.6139, longitude: 77.2090, fraud_score: 0.02, fraud_flags: [], timestamp: new Date(now.getTime() - 120000).toISOString() },
      { id: 'dl-2', user_id: 'demo-emp-003', user_name: 'Raj Patel', user_email: 'raj@demo', avatar_url: null, event_type: 'checkin' as const, site_name: 'HQ – Downtown Office', latitude: 28.6140, longitude: 77.2091, fraud_score: 0.05, fraud_flags: [], timestamp: new Date(now.getTime() - 300000).toISOString() },
      { id: 'dl-3', user_id: 'demo-emp-004', user_name: 'Maria Garcia', user_email: 'maria@demo', avatar_url: null, event_type: 'checkin' as const, site_name: 'Warehouse – Industrial Zone', latitude: 28.5355, longitude: 77.3910, fraud_score: 0.01, fraud_flags: [], timestamp: new Date(now.getTime() - 600000).toISOString() },
      { id: 'dl-4', user_id: 'demo-emp-006', user_name: 'Lisa Wang', user_email: 'lisa@demo', avatar_url: null, event_type: 'checkout' as const, site_name: 'HQ – Downtown Office', latitude: 28.6139, longitude: 77.2090, fraud_score: 0.03, fraud_flags: [], timestamp: new Date(now.getTime() - 900000).toISOString() },
      { id: 'dl-5', user_id: 'demo-emp-007', user_name: 'David Brown', user_email: 'david@demo', avatar_url: null, event_type: 'checkin' as const, site_name: 'HQ – Downtown Office', latitude: 28.6145, longitude: 77.2085, fraud_score: 0.68, fraud_flags: ['vpn_detected'], timestamp: new Date(now.getTime() - 1500000).toISOString() },
    ];
  }, [isDemoMode]);

  const events = isDemoMode
    ? demoEvents.slice(0, maxItems)
    : (messages.map((m) => m.data).slice(0, maxItems) as LiveCheckInEvent[]);

  // Notify parent + auto-scroll on new events
  useEffect(() => {
    if (events.length > prevLengthRef.current && events.length > 0) {
      const newest = events[0];
      onNewEvent?.(newest);
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
    prevLengthRef.current = events.length;
  }, [events, onNewEvent]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<LiveCheckInEvent>) => (
      <AnimatedFeedItem item={item} />
    ),
    [],
  );

  const keyExtractor = useCallback(
    (item: LiveCheckInEvent) => item.id,
    [],
  );

  const effectiveConnected = isDemoMode ? true : isConnected;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Live Feed</Text>
        <View style={styles.statusRow}>
          <ConnectionDot isConnected={effectiveConnected} />
          <Text style={styles.statusText}>
            {isDemoMode ? 'Demo' : effectiveConnected ? 'Live' : 'Reconnecting'}
          </Text>
        </View>
      </View>

      {/* Feed list */}
      <FlatList
        ref={flatListRef}
        data={events}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListEmptyComponent={<EmptyFeed isConnected={effectiveConnected} />}
        contentContainerStyle={
          events.length === 0 ? styles.emptyList : styles.listContent
        }
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={15}
      />
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#18181B',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    color: '#A1A1AA',
    fontWeight: '500',
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 24,
  },
  emptyList: {
    flexGrow: 1,
  },
  feedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    marginHorizontal: 12,
    marginVertical: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '700',
  },
  itemContent: {
    flex: 1,
    gap: 3,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FAFAFA',
    flex: 1,
  },
  timestamp: {
    fontSize: 11,
    color: '#71717A',
    marginLeft: 8,
  },
  itemSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  eventLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  separator: {
    fontSize: 12,
    color: '#3F3F46',
  },
  siteName: {
    fontSize: 12,
    color: '#71717A',
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#71717A',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#52525B',
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default LiveFeed;
