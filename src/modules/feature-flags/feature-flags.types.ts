export const featureFlagModes = ['off', 'test', 'on'] as const;
export type FeatureFlagMode = (typeof featureFlagModes)[number];

export const featureTesterSubjectTypes = ['user', 'vendor'] as const;
export type FeatureTesterSubjectType = (typeof featureTesterSubjectTypes)[number];

// Known flag keys. A key must also exist as a public.feature_flags row; a missing row reads
// as 'off'.
export const FeatureFlagKeys = {
  CLOUD_PRINTING: 'cloud_printing'
} as const;
export type FeatureFlagKey = (typeof FeatureFlagKeys)[keyof typeof FeatureFlagKeys];

export type FeatureFlag = {
  key: string;
  mode: FeatureFlagMode;
  description: string | null;
  updatedAt: string;
};

export type FeatureTester = {
  id: string;
  subjectType: FeatureTesterSubjectType;
  subjectId: string;
  note: string | null;
  createdAt: string;
};

/** Who a flag is being evaluated for. Either id may be absent. */
export type FeatureSubject = {
  userId?: string;
  vendorId?: string;
};

export type FeatureFlagsRepositoryContract = {
  listFlags: () => Promise<FeatureFlag[]>;
  findFlag: (key: string) => Promise<FeatureFlag | undefined>;
  updateFlagMode: (
    key: string,
    mode: FeatureFlagMode,
    actorUserId: string
  ) => Promise<FeatureFlag | undefined>;
  isTester: (subject: FeatureSubject) => Promise<boolean>;
  listTesters: () => Promise<FeatureTester[]>;
  addTester: (
    subjectType: FeatureTesterSubjectType,
    subjectId: string,
    note: string | null,
    actorUserId: string
  ) => Promise<FeatureTester>;
  removeTester: (testerId: string) => Promise<FeatureTester | undefined>;
  subjectExists: (subjectType: FeatureTesterSubjectType, subjectId: string) => Promise<boolean>;
};
