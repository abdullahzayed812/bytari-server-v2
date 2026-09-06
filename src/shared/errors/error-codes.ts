/**
 * Stable, machine-readable error codes returned in the API error envelope.
 * Clients should branch on these, never on human-readable messages.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  CONFLICT: 'CONFLICT',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  RATE_LIMITED: 'RATE_LIMITED',
  /** Request body exceeded the configured `BODY_LIMIT`. */
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  /** Request `Content-Type` / charset / encoding is not accepted. */
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // --- Identity & authorization (Phase 2) ---
  /** Wrong email/password on login. Deliberately generic. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** Access token missing, malformed, expired or signature-invalid. */
  INVALID_TOKEN: 'INVALID_TOKEN',
  /** Refresh token unknown, expired, revoked or replayed. */
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  /** Authenticated but the account is SUSPENDED or DEACTIVATED. */
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  /** Caller lacks the permission required for the route. */
  PERMISSION_DENIED: 'PERMISSION_DENIED',

  // --- Organizations (Phase 3) ---
  /** Creating/owning a CLINIC or FARM requires an APPROVED veterinarian. */
  VETERINARIAN_APPROVAL_REQUIRED: 'VETERINARIAN_APPROVAL_REQUIRED',
  /** Organization is not ACTIVE — normal operations are restricted (ADMIN exempt). */
  ORGANIZATION_NOT_ACTIVE: 'ORGANIZATION_NOT_ACTIVE',

  // --- Animals (Phase 4) ---
  /** The animal is DEACTIVATED — updates and ownership transfers are refused. */
  ANIMAL_NOT_ACTIVE: 'ANIMAL_NOT_ACTIVE',
  /** Ownership transfer target is invalid (missing, inactive, or already the owner). */
  INVALID_TRANSFER_TARGET: 'INVALID_TRANSFER_TARGET',
  /** An open (PENDING) transfer request already exists for this animal. */
  TRANSFER_REQUEST_ALREADY_OPEN: 'TRANSFER_REQUEST_ALREADY_OPEN',
  /** Accept/reject/cancel attempted on a request that is not PENDING. */
  TRANSFER_REQUEST_NOT_PENDING: 'TRANSFER_REQUEST_NOT_PENDING',

  // --- Veterinary care (Phase 5) ---
  /**
   * The organization's type does not support this operation — veterinary access /
   * medical records require a CLINIC; poultry requires a FARM.
   */
  ORGANIZATION_TYPE_NOT_SUPPORTED: 'ORGANIZATION_TYPE_NOT_SUPPORTED',

  // --- Farms & poultry (Phase 6) ---
  /** The join code did not resolve to a farm. Deliberately generic. */
  INVALID_JOIN_CODE: 'INVALID_JOIN_CODE',
  /** The poultry flock is CLOSED — updates are refused. */
  POULTRY_FLOCK_NOT_ACTIVE: 'POULTRY_FLOCK_NOT_ACTIVE',
  /** A daily record already exists for that flock + calendar day. */
  POULTRY_DAILY_RECORD_DUPLICATE_DATE: 'POULTRY_DAILY_RECORD_DUPLICATE_DATE',

  // --- Sheep & Cattle Farms ---
  /** The sheep batch is CLOSED — updates are refused. */
  SHEEP_BATCH_NOT_ACTIVE: 'SHEEP_BATCH_NOT_ACTIVE',
  /** A daily record already exists for that sheep batch + calendar day. */
  SHEEP_DAILY_RECORD_DUPLICATE_DATE: 'SHEEP_DAILY_RECORD_DUPLICATE_DATE',
  /** The cattle batch is CLOSED — updates are refused. */
  CATTLE_BATCH_NOT_ACTIVE: 'CATTLE_BATCH_NOT_ACTIVE',
  /** A daily record already exists for that cattle batch + calendar day. */
  CATTLE_DAILY_RECORD_DUPLICATE_DATE: 'CATTLE_DAILY_RECORD_DUPLICATE_DATE',

  // --- Farm subscription (Poultry Farm Approval & Subscription module) ---
  /** Subscription dates are missing/invalid (end not after start). */
  INVALID_SUBSCRIPTION_DATES: 'INVALID_SUBSCRIPTION_DATES',
  /** A renewal request requires the subscription to currently be EXPIRED. */
  SUBSCRIPTION_NOT_EXPIRED: 'SUBSCRIPTION_NOT_EXPIRED',
  /** An open (PENDING) renewal request already exists for this farm. */
  RENEWAL_REQUEST_ALREADY_PENDING: 'RENEWAL_REQUEST_ALREADY_PENDING',
  /** Approve/reject attempted on a renewal request that is not PENDING. */
  RENEWAL_REQUEST_NOT_PENDING: 'RENEWAL_REQUEST_NOT_PENDING',
  /** Farm operations are restricted — the subscription is EXPIRED or NOT_STARTED. */
  FARM_SUBSCRIPTION_NOT_ACTIVE: 'FARM_SUBSCRIPTION_NOT_ACTIVE',

  // --- Animal publications / lifecycle (Phase 7) ---
  /** A moderation action was attempted on a publication that is not PENDING. */
  PUBLICATION_NOT_PENDING: 'PUBLICATION_NOT_PENDING',
  /** An open (PENDING) publication of this kind already exists for the animal. */
  PUBLICATION_ALREADY_OPEN: 'PUBLICATION_ALREADY_OPEN',

  // --- Veterinary store & products (Phase 10) ---
  /** A stock adjustment would take the product's stock below zero. */
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',

  // --- Consultations & inquiries (Phase 13) ---
  /** The consultation / inquiry is CLOSED, or the sender has been blocked. */
  THREAD_NOT_WRITABLE: 'THREAD_NOT_WRITABLE',

  // --- Content management (Phase 14) ---
  /** Uploaded / declared file is larger than the allowed maximum. */
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  /** File MIME type is not on the allow-list for its kind. */
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  /** A storage key was submitted that the server did not issue for this content. */
  STORAGE_KEY_MISMATCH: 'STORAGE_KEY_MISMATCH',
  /** No object exists at the storage key being registered. */
  STORAGE_OBJECT_MISSING: 'STORAGE_OBJECT_MISSING',

  // --- Notifications & FCM (Phase 15) ---
  /** Admin broadcast would target more users than the synchronous limit allows. */
  BROADCAST_TOO_LARGE: 'BROADCAST_TOO_LARGE',

  // --- Organization directory & engagement (Clinic Details) ---
  /** A gallery upload would exceed the per-organization photo cap. */
  GALLERY_LIMIT_EXCEEDED: 'GALLERY_LIMIT_EXCEEDED',

  // --- Poultry Markets (trader registration / offers / exchange rates) ---
  /** Market-only action requires an APPROVED trader account. */
  TRADER_APPROVAL_REQUIRED: 'TRADER_APPROVAL_REQUIRED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
