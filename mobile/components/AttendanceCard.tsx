import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { format, formatDistanceStrict } from 'date-fns';
import type { AttendanceRecord, EventType, AttendanceStatus } from '@/store/attendanceStore';
import { FraudBadge } from './FraudBadge';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttendanceCardProps {
  record: AttendanceRecord;
  onPress?: () => void;
  style?: ViewStyle;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const EVENT_META: Record<
  EventType,
  { icon: IconName; label: string; color: string }
> = {
  checkin: { icon: 'login', label: 'Check In', color: '#22C55E' },
  checkout: { icon: 'logout', label: 'Check Out', color: '#6366F1' },
  break_start: { icon: 'coffee', label: 'Break Start', color: '#F59E0B' },
  break_end: { icon: 'coffee-off', label: 'Break End', color: '#3B82F6' },
};

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  present: '#22C55E',
  absent: '#EF4444',
  late: '#F59E0B',
  half_day: '#8B5CF6',
  on_leave: '#6B7280',
  pending: '#9CA3AF',
};

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const AttendanceCard: React.FC<AttendanceCardProps> = ({
  record,
  onPress,
  style,
}) => {
  const meta = EVENT_META[record.event_type];
  const statusColor = STATUS_COLORS[record.status];
  const formattedTime = format(new Date(record.timestamp), 'hh:mm a');
  const formattedDate = format(new Date(record.timestamp), 'EEE, dd MMM yyyy');

  const hasDuration =
    record.work_duration_minutes !== null &&
    record.work_duration_minutes > 0;

  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      style={[styles.card, style]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {/* Left accent bar coloured by status */}
      <View style={[styles.accent, { backgroundColor: statusColor }]} />

      {/* Event icon */}
      <View style={[styles.iconContainer, { backgroundColor: meta.color + '1A' }]}>
        <MaterialCommunityIcons name={meta.icon} size={24} color={meta.color} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.eventLabel}>{meta.label}</Text>
          <Text style={[styles.statusPill, { color: statusColor }]}>
            {record.status.replace('_', ' ')}
          </Text>
        </View>

        <Text style={styles.time}>{formattedTime}</Text>
        <Text style={styles.date}>{formattedDate}</Text>

        {hasDuration && (
          <Text style={styles.duration}>
            Duration: {formatDuration(record.work_duration_minutes!)}
          </Text>
        )}

        {record.notes ? (
          <Text style={styles.notes} numberOfLines={1}>
            {record.notes}
          </Text>
        ) : null}
      </View>

      {/* Fraud badge */}
      <View style={styles.badgeContainer}>
        <FraudBadge
          score={record.fraud_score}
          flags={record.fraud_flags}
        />
        {onPress && (
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color="#52525B"
            style={styles.chevron}
          />
        )}
      </View>
    </Wrapper>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderRadius: 12,
    marginVertical: 6,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  accent: {
    width: 4,
    alignSelf: 'stretch',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 12,
  },
  content: {
    flex: 1,
    paddingVertical: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: 8,
  },
  eventLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FAFAFA',
  },
  statusPill: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  time: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FAFAFA',
    marginTop: 2,
  },
  date: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 1,
  },
  duration: {
    fontSize: 12,
    color: '#A1A1AA',
    marginTop: 4,
    fontWeight: '500',
  },
  notes: {
    fontSize: 12,
    color: '#52525B',
    marginTop: 4,
    fontStyle: 'italic',
  },
  badgeContainer: {
    alignItems: 'center',
    paddingRight: 12,
    gap: 6,
  },
  chevron: {
    marginTop: 2,
  },
});

export default AttendanceCard;
