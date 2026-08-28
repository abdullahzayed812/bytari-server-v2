import type { Knex } from 'knex';
import {
  rowToContentFile,
  type ContentFile,
  type ContentFileRow,
} from '../domain/content.types.js';
import type { ContentFileKind } from '../domain/content.constants.js';

const T = 'content_files';

export interface CreateContentFileData {
  contentId: string;
  kind: ContentFileKind;
  storageKey: string;
  storageProvider: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  uploadedByUserId: string;
}

export class ContentFileRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async listActiveForContent(contentId: string, trx?: Knex.Transaction): Promise<ContentFile[]> {
    const rows: ContentFileRow[] = await this.conn(trx)<ContentFileRow>(T)
      .where({ content_id: contentId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'asc');
    return rows.map(rowToContentFile);
  }

  async listActiveForContents(
    contentIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Map<string, ContentFile[]>> {
    const out = new Map<string, ContentFile[]>();
    if (contentIds.length === 0) return out;
    const rows: ContentFileRow[] = await this.conn(trx)<ContentFileRow>(T)
      .whereIn('content_id', contentIds)
      .whereNull('deleted_at')
      .orderBy('created_at', 'asc');
    for (const row of rows) {
      const f = rowToContentFile(row);
      const arr = out.get(f.contentId) ?? [];
      arr.push(f);
      out.set(f.contentId, arr);
    }
    return out;
  }

  async findByIdForContent(
    id: string,
    contentId: string,
    trx?: Knex.Transaction,
  ): Promise<ContentFile | null> {
    const row = await this.conn(trx)<ContentFileRow>(T)
      .where({ id, content_id: contentId })
      .first();
    return row ? rowToContentFile(row) : null;
  }

  async findActiveByKind(
    contentId: string,
    kind: ContentFileKind,
    trx?: Knex.Transaction,
  ): Promise<ContentFile | null> {
    const row = await this.conn(trx)<ContentFileRow>(T)
      .where({ content_id: contentId, kind })
      .whereNull('deleted_at')
      .first();
    return row ? rowToContentFile(row) : null;
  }

  async create(data: CreateContentFileData, trx: Knex.Transaction): Promise<ContentFile> {
    const [row] = (await trx(T)
      .insert({
        content_id: data.contentId,
        kind: data.kind,
        storage_key: data.storageKey,
        storage_provider: data.storageProvider,
        original_filename: data.originalFilename,
        mime_type: data.mimeType,
        size_bytes: data.sizeBytes,
        checksum: data.checksum,
        uploaded_by_user_id: data.uploadedByUserId,
      })
      .returning('*')) as ContentFileRow[];
    if (!row) throw new Error('content_file insert returned no row');
    return rowToContentFile(row);
  }

  async softDelete(id: string, trx: Knex.Transaction): Promise<ContentFile> {
    const [row] = (await trx(T)
      .where({ id })
      .whereNull('deleted_at')
      .update({ deleted_at: trx.fn.now(), updated_at: trx.fn.now() })
      .returning('*')) as ContentFileRow[];
    if (row) return rowToContentFile(row);
    const existing = await this.conn(trx)<ContentFileRow>(T).where({ id }).first();
    if (existing) return rowToContentFile(existing); // already deleted — idempotent
    throw new Error('content_file not found on delete');
  }
}
