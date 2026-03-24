import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FraudBadgeProps {
  score: number;  // 0–1
  flags: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type RiskLevel = 'low' | 'medium' | 'high';

function getRiskLevel(score: number): RiskLevel {
  if (score < 0.3) return 'low';
  if (score < 0.6) return 'medium';
  return 'high';
}

const RISK_CONFIG: Record<
  RiskLevel,
  { color: string; bg: string; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] }
> = {
  low: {
    color: '#16A34A',
    bg: '#DCFCE7',
    label: 'Low Risk',
    icon: 'shield-check',
  },
  medium: {
    color: '#D97706',
    bg: '#FEF3C7',
    label: 'Medium Risk',
    icon: 'shield-alert',
  },
  high: {
    color: '#DC2626',
    bg: '#FEE2E2',
    label: 'High Risk',
    icon: 'shield-off',
  },
};

function formatFlagLabel(flag: string): string {
  return flag
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FraudBadge: React.FC<FraudBadgeProps> = ({ score, flags }) => {
  const [modalVisible, setModalVisible] = useState(false);

  const clampedScore = Math.max(0, Math.min(1, score));
  const risk = getRiskLevel(clampedScore);
  const config = RISK_CONFIG[risk];
  const scorePercent = Math.round(clampedScore * 100);

  // Only show tappable tooltip if there are flags or score is non-trivial
  const hasFlagInfo = flags.length > 0 || clampedScore >= 0.3;

  return (
    <>
      <TouchableOpacity
        onPress={() => hasFlagInfo && setModalVisible(true)}
        activeOpacity={hasFlagInfo ? 0.7 : 1}
        accessibilityLabel={`Fraud score: ${scorePercent}%. ${config.label}. ${flags.length} flags.`}
        accessibilityRole="button"
      >
        <View style={[styles.badge, { backgroundColor: config.bg }]}>
          <MaterialCommunityIcons
            name={config.icon}
            size={12}
            color={config.color}
          />
          <Text style={[styles.scoreText, { color: config.color }]}>
            {scorePercent}%
          </Text>
        </View>
      </TouchableOpacity>

      {/* Flags detail modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
        statusBarTranslucent
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setModalVisible(false)}
        >
          <Pressable style={styles.modal} onPress={(e) => e.stopPropagation()}>
            {/* Header */}
            <View
              style={[styles.modalHeader, { backgroundColor: config.bg }]}
            >
              <MaterialCommunityIcons
                name={config.icon}
                size={22}
                color={config.color}
              />
              <View style={styles.modalHeaderText}>
                <Text style={[styles.modalTitle, { color: config.color }]}>
                  {config.label}
                </Text>
                <Text style={styles.modalScore}>
                  Fraud Score: {scorePercent}%
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={20}
                  color="#6B7280"
                />
              </TouchableOpacity>
            </View>

            {/* Flags list */}
            <ScrollView
              style={styles.flagsList}
              contentContainerStyle={styles.flagsContent}
              showsVerticalScrollIndicator={false}
            >
              {flags.length === 0 ? (
                <Text style={styles.noFlagsText}>No specific flags detected.</Text>
              ) : (
                flags.map((flag, index) => (
                  <View key={`${flag}-${index}`} style={styles.flagItem}>
                    <MaterialCommunityIcons
                      name="alert-circle-outline"
                      size={16}
                      color={config.color}
                    />
                    <Text style={styles.flagText}>{formatFlagLabel(flag)}</Text>
                  </View>
                ))
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.closeButton, { borderColor: config.color }]}
              onPress={() => setModalVisible(false)}
            >
              <Text style={[styles.closeButtonText, { color: config.color }]}>
                Close
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 3,
  },
  scoreText: {
    fontSize: 11,
    fontWeight: '700',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  modalHeaderText: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  modalScore: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 1,
  },
  flagsList: {
    maxHeight: 240,
  },
  flagsContent: {
    padding: 16,
    gap: 10,
  },
  flagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  flagText: {
    fontSize: 14,
    color: '#374151',
    flex: 1,
  },
  noFlagsText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 12,
  },
  closeButton: {
    margin: 16,
    marginTop: 8,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default FraudBadge;
