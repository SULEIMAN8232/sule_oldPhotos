import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

const interestCategories = [
  'Suleban', 'MD subane', 'Boxer', 'Shebaa', 'Adesh', 'Abdalla', 'Maqhrib_labiste', 'Others'
];

interface SuggestedCreator {
  id: string;
  username: string;
  profile: {
    displayName: string;
    avatarUrl: string;
    bio: string;
  };
  isFollowing?: boolean;
}

export default function OnboardingSetup() {
  const router = useRouter();
  const { apiUrl, token, user } = useAuth();
  const { colors } = useTheme();

  const [step, setStep] = useState(1); // 1 = Interests, 2 = Follow Creators, 3 = Tutorial
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [creators, setCreators] = useState<SuggestedCreator[]>([]);
  const [loadingCreators, setLoadingCreators] = useState(false);
  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});

  // Fetch suggested creators on mount
  useEffect(() => {
    if (step === 2) {
      fetchSuggestedCreators();
    }
  }, [step]);

  const fetchSuggestedCreators = async () => {
    setLoadingCreators(true);
    try {
      // Get all seeded users except self
      const response = await fetch(`${apiUrl}/api/admin/users`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      const data = await response.json();
      
      if (response.ok) {
        // Filter out current user and map structure
        const suggestions = data
          .filter((u: any) => u.id !== user?.id && u.username !== 'Sule_Old_Photos_admin')
          .map((u: any) => ({
            id: u.id,
            username: u.username,
            profile: {
              displayName: u.profile?.displayName || u.username,
              avatarUrl: u.profile?.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?q=80&w=200',
              bio: u.profile?.bio || 'Visual Creator on Sule_Old_Photos',
            },
          }));
        setCreators(suggestions);
      }
    } catch (err) {
      console.warn('Failed to fetch suggestions:', err);
    } finally {
      setLoadingCreators(false);
    }
  };

  const toggleInterest = (interest: string) => {
    setSelectedInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  };

  const handleFollow = async (creatorId: string) => {
    // Optimistic toggle
    setFollowingMap((prev) => ({ ...prev, [creatorId]: !prev[creatorId] }));

    try {
      const response = await fetch(`${apiUrl}/api/users/${creatorId}/follow`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Revert on error
        setFollowingMap((prev) => ({ ...prev, [creatorId]: !prev[creatorId] }));
      }
    } catch (err) {
      setFollowingMap((prev) => ({ ...prev, [creatorId]: !prev[creatorId] }));
    }
  };

  const handleNext = () => {
    if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else {
      router.replace('/home');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.stepText, { color: colors.accent }]}>STEP {step} OF 3</Text>
        <Text style={[styles.title, { color: colors.text }]}>
          {step === 1 && 'Whom photos do you prefer?'}
          {step === 2 && 'Meet the Curators'}
          {step === 3 && 'Publish Your Work'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {step === 1 && 'Select creators whose styles you want to follow.'}
          {step === 2 && 'Follow initial curators to shape your home feed.'}
          {step === 3 && 'Learn how to publish your first high-resolution photo.'}
        </Text>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {step === 1 && (
          <ScrollView contentContainerStyle={styles.interestsGrid}>
            {interestCategories.map((interest) => {
              const isSelected = selectedInterests.includes(interest);
              return (
                <Pressable
                  key={interest}
                  style={[
                    styles.interestCard,
                    {
                      borderColor: isSelected ? colors.accent : colors.border,
                      backgroundColor: isSelected ? `${colors.accent}12` : colors.card,
                    },
                  ]}
                  onPress={() => toggleInterest(interest)}
                >
                  <Text
                    style={[
                      styles.interestText,
                      { color: isSelected ? colors.accent : colors.text },
                    ]}
                  >
                    {interest}
                  </Text>
                  {isSelected && <Text style={[styles.checkIcon, { color: colors.accent }]}>✓</Text>}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {step === 2 && (
          <View style={{ flex: 1 }}>
            {loadingCreators ? (
              <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 40 }} />
            ) : (
              <ScrollView contentContainerStyle={styles.creatorList}>
                {creators.map((creator) => {
                  const isFollowing = !!followingMap[creator.id];
                  return (
                    <View key={creator.id} style={[styles.creatorCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
                      <Image source={{ uri: creator.profile.avatarUrl }} style={styles.creatorAvatar} />
                      <View style={styles.creatorDetails}>
                        <Text style={[styles.creatorName, { color: colors.text }]}>
                          {creator.profile.displayName}
                        </Text>
                        <Text style={[styles.creatorUsername, { color: colors.textMuted }]}>
                          @{creator.username}
                        </Text>
                        <Text style={[styles.creatorBio, { color: colors.textMuted }]} numberOfLines={2}>
                          {creator.profile.bio}
                        </Text>
                      </View>
                      <Pressable
                        style={[
                          styles.followBtn,
                          {
                            backgroundColor: isFollowing ? colors.border : colors.accent,
                          },
                        ]}
                        onPress={() => handleFollow(creator.id)}
                      >
                        <Text style={[styles.followBtnText, { color: isFollowing ? colors.text : '#FFF' }]}>
                          {isFollowing ? 'Following' : 'Follow'}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}

        {step === 3 && (
          <View style={styles.tutorialContainer}>
            <View style={[styles.tutorialStep, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={styles.tutorialNumber}>1</Text>
              <Text style={[styles.tutorialLabel, { color: colors.text }]}>Tap the upload (➕) button in the navigation bar.</Text>
            </View>

            <View style={[styles.tutorialStep, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={styles.tutorialNumber}>2</Text>
              <Text style={[styles.tutorialLabel, { color: colors.text }]}>Pick photos, apply filters, and tag curators or locations.</Text>
            </View>

            <View style={[styles.tutorialStep, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={styles.tutorialNumber}>3</Text>
              <Text style={[styles.tutorialLabel, { color: colors.text }]}>Add hashtags and hit publish! Your photo will be distributed globally.</Text>
            </View>

            <View style={[styles.tipContainer, { borderColor: colors.accent }]}>
              <Text style={[styles.tipTitle, { color: colors.accent }]}>LUXURY UPLOAD TIP</Text>
              <Text style={[styles.tipBody, { color: colors.text }]}>Sule_Old_Photos automatically compresses and generates multiple resolution crops. Share your highest quality original photos.</Text>
            </View>
          </View>
        )}
      </View>

      {/* Footer Nav */}
      <View style={styles.footer}>
        <Pressable style={[styles.nextBtn, { backgroundColor: colors.accent }]} onPress={handleNext}>
          <Text style={styles.nextBtnText}>
            {step === 3 ? 'Enter' : 'Continue'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 32,
  },
  stepText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontFamily: 'serif',
    fontWeight: '300',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  content: {
    flex: 1,
    marginBottom: 24,
  },
  interestsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingVertical: 8,
  },
  interestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'space-between',
    minWidth: '45%',
  },
  interestText: {
    fontSize: 15,
    fontWeight: '600',
  },
  checkIcon: {
    fontSize: 16,
    fontWeight: '700',
  },
  creatorList: {
    gap: 16,
  },
  creatorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  creatorAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  creatorDetails: {
    flex: 1,
    marginRight: 8,
  },
  creatorName: {
    fontSize: 15,
    fontWeight: '600',
  },
  creatorUsername: {
    fontSize: 12,
    marginBottom: 4,
  },
  creatorBio: {
    fontSize: 12,
    lineHeight: 16,
  },
  followBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 80,
  },
  followBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  tutorialContainer: {
    gap: 16,
  },
  tutorialStep: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  tutorialNumber: {
    fontSize: 20,
    fontWeight: '800',
    color: '#8B5CF6',
    marginRight: 16,
    width: 24,
    textAlign: 'center',
  },
  tutorialLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  tipContainer: {
    marginTop: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 16,
    borderRadius: 12,
  },
  tipTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  tipBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    width: '100%',
  },
  nextBtn: {
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
