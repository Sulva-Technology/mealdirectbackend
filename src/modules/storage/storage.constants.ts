/**
 * Private Supabase Storage buckets. Reads are served only via short-lived signed
 * URLs minted with the service-role key; there are no anon/authenticated Storage
 * policies, so keys stored in *_url columns are opaque paths, never public URLs.
 */
export const StorageBuckets = {
  vendorLogos: 'vendor-logos',
  menuItemImages: 'menu-item-images',
  avatars: 'avatars'
} as const;

export type StorageBucket = (typeof StorageBuckets)[keyof typeof StorageBuckets];

/** Allowed image content types mapped to their canonical file extension. */
export const AllowedImageContentTypes: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

export const allowedImageContentTypes = Object.keys(AllowedImageContentTypes);

/** Upload size ceilings in bytes, per surface. */
export const MaxLogoBytes = 2 * 1024 * 1024;
export const MaxAvatarBytes = 2 * 1024 * 1024;
export const MaxMenuImageBytes = 5 * 1024 * 1024;

/**
 * True when a stored value is an opaque Storage key (needs signing) rather than a
 * pre-existing absolute URL. Legacy rows and externally-hosted images pass through
 * unchanged so the read side never breaks on non-key values.
 */
export function isStorageKey(value: string): boolean {
  return !/^https?:\/\//i.test(value) && !value.startsWith('data:');
}
