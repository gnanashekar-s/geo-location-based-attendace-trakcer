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
      color="#D1D5DB"
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
  const { messages, isConnected } = useWebSocket<LiveCheckInEvent>('feed');
  const flatListRef = useRef<FlatList<LiveCheckInEvent>>(null);
  const prevLengthRef = useRef<number>(0);

  const events = messages
    .map((m) => m.data)
    .slice(0, maxItems) as LiveCheckInEvent[];

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

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Live Feed</Text>
        <View style={styles.statusRow}>
          <ConnectionDot isConnected={isConnected} />
          <Text style={styles.statusText}>
            {isConnected ? 'Live' : 'Reconnecting'}
          </Text>
        </View>
      </View>

      {/* Feed list */}
      <FlatList
        ref={flatListRef}
        data={events}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListEmptyComponent={<EmptyFeed isConnected={isConnected} />}
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
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
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
    color: '#6B7280',
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
    backgroundColor: '#FFFFFF',
    marginHorizontal: 12,
    marginVertical: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
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
    color: '#1F2937',
    flex: 1,
  },
  timestamp: {
    fontSize: 11,
    color: '#9CA3AF',
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
    color: '#D1D5DB',
  },
  siteName: {
    fontSize: 12,
    color: '#6B7280',
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
    color: '#6B7280',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default LiveFeed;
