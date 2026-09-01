import type { Knex } from 'knex';
import {
  rowToApplicationDocument,
  type VetApplicationDocumentKind,
  type VeterinarianApplicationDocumentRecord,
  type VeterinarianApplicationDocumentRow,
} from './veterinarian.types.js';

const TABLE = 'veterinarian_application_documents';

export interface CreateVeterinarianApplicationDocumentData {
  applicationId: string;
  kind: VetApplicationDocumentKind;
  storageKey: string;
  storageProvider: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum?: string | null;
  uploadedByUserId: string | null;
}

/** Data access for `veterinarian_application_documents`. No business rules here. */
export class VeterinarianDocumentRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async create(
    data: CreateVeterinarianApplicationDocumentData,
    trx?: Knex.Transaction,
  ): Promise<VeterinarianApplicationDocumentRecord> {
    const [row] = await this.conn(trx)<VeterinarianApplicationDocumentRow>(TABLE)
      .insert({
        application_id: data.applicationId,
        kind: data.kind,
        storage_key: data.storageKey,
        storage_provider: data.storageProvider,
        original_filename: data.originalFilename,
        mime_type: data.mimeType,
        size_bytes: data.sizeBytes,
        checksum: data.checksum ?? null,
        uploaded_by_user_id: data.uploadedByUserId,
      })
      .returning('*');
    return rowToApplicationDocument(row as VeterinarianApplicationDocumentRow);
  }

  async listForApplication(
    applicationId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinarianApplicationDocumentRecord[]> {
    const rows = await this.conn(trx)<VeterinarianApplicationDocumentRow>(TABLE)
      .where({ application_id: applicationId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'asc');
    return rows.map(rowToApplicationDocument);
  }

  async listForApplications(
    applicationIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Map<string, VeterinarianApplicationDocumentRecord[]>> {
    const map = new Map<string, VeterinarianApplicationDocumentRecord[]>();
    if (applicationIds.length === 0) return map;
    const rows = await this.conn(trx)<VeterinarianApplicationDocumentRow>(TABLE)
      .whereIn('application_id', applicationIds)
      .whereNull('deleted_at')
      .orderBy('created_at', 'asc');
    for (const row of rows) {
      const doc = rowToApplicationDocument(row);
      const list = map.get(doc.applicationId) ?? [];
      list.push(doc);
      map.set(doc.applicationId, list);
    }
    return map;
  }
}
