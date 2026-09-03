export const TRANSFER_REQUEST_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'] as const;
export type TransferRequestStatus = (typeof TRANSFER_REQUEST_STATUSES)[number];

export interface TransferRequestUserSummary {
  id: string;
  firstName: string;
  lastName: string;
}

export interface TransferRequestAnimalSummary {
  id: string;
  name: string;
  species: string;
  breed: string | null;
}

/** Internal aggregate — no joined summaries. */
export interface AnimalTransferRequest {
  id: string;
  animalId: string;
  fromUserId: string;
  toUserId: string;
  status: TransferRequestStatus;
  reason: string | null;
  responseReason: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Client-safe DTO — the animal + counterpart (the "other side") summaries joined in. */
export interface AnimalTransferRequestDTO {
  id: string;
  animal: TransferRequestAnimalSummary;
  fromUser: TransferRequestUserSummary;
  toUser: TransferRequestUserSummary;
  status: TransferRequestStatus;
  reason: string | null;
  responseReason: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransferRequestInput {
  toUserId: string;
  reason?: string;
}

export interface TransferRequestRow {
  id: string;
  animal_id: string;
  from_user_id: string;
  to_user_id: string;
  status: string;
  reason: string | null;
  response_reason: string | null;
  responded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToTransferRequest(row: TransferRequestRow): AnimalTransferRequest {
  return {
    id: row.id,
    animalId: row.animal_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    status: row.status as TransferRequestStatus,
    reason: row.reason,
    responseReason: row.response_reason,
    respondedAt: row.responded_at ? row.responded_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
