import { phase2OpenApi } from './phase2.js';
import { phase3OpenApi } from './phase3.js';
import { phase4OpenApi } from './phase4.js';
import { phase5OpenApi } from './phase5.js';
import { phase6OpenApi } from './phase6.js';
import { phase7OpenApi } from './phase7.js';
import { phase8OpenApi } from './phase8.js';
import { phase10OpenApi } from './phase10.js';
import { phase12OpenApi } from './phase12.js';
import { phase13OpenApi } from './phase13.js';
import { phase14OpenApi } from './phase14.js';
import { phase15OpenApi } from './phase15.js';
import { advertisementsOpenApi } from './advertisements.js';
import { tipsOpenApi } from './tips.js';
import { newsOpenApi } from './news.js';
import { poultryOpsOpenApi } from './poultryOps.js';
import { phase17OpenApi } from './phase17.js';

/**
 * OpenAPI 3.1 document. Assembled from a small base (health endpoints) plus
 * per-phase fragments. Phase 2 adds identity/authorization/audit; Phase 3 adds
 * organizations, memberships and organization-scoped authorization; Phase 4 adds
 * the Animal Core and ownership history / transfer.
 */
export interface OpenApiDocument {
  openapi: string;
  info: Record<string, unknown>;
  servers: { url: string; description?: string }[];
  tags: { name: string; description?: string }[];
  paths: Record<string, unknown>;
  components: Record<string, unknown>;
}

const errorEnvelope = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', example: 'NOT_FOUND' },
        message: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              message: { type: 'string' },
              rule: { type: 'string' },
            },
          },
        },
        requestId: { type: 'string', format: 'uuid' },
      },
    },
  },
};

export function buildOpenApiDocument(version: string): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Bytari — Veterinary Platform API',
      version,
      description:
        'Central backend for the Veterinary Platform. Phase 2 adds identity, authentication, ' +
        'authorization, the veterinarian approval workflow, system supervisor assignments and the audit log. ' +
        'Phase 3 adds organizations, memberships and organization-scoped authorization. ' +
        'Phase 4 adds the Animal Core (owner-scoped) with a dedicated ownership history and ownership transfer. ' +
        'Phase 5 adds veterinary care: a CLINIC ↔ animal veterinary-access grant plus clinic-scoped medical records and vaccinations, with owner-facing read-only history. ' +
        'Phase 6 adds the Farm-ID join-code flow (multi-farm veterinarian membership) and poultry flock management for FARM organizations. Phase 7 adds the animal lifecycle publications (Lost / Adoption / Mating) with a PENDING → APPROVED / REJECTED moderation lifecycle. Phase 8 adds the composed Medical History timeline over the Phase 5 medical records and vaccinations. Phase 10 adds Veterinary Store product management. Phase 12 adds Chat & real-time messaging (Pet Owner ↔ Clinic + Farm Owner ↔ member; relationship-scoped; WebSocket delivery over /realtime). Phase 13 adds Consultations & Inquiries (Pet Owner / Veterinarian support threads answered by the responsible CONSULTATION/INQUIRY system supervisor or Admin; admin AI-enablement flags with a provider seam — no real provider yet). Phase 14 adds Content Management (Articles / Books / Magazines with a DRAFT → PUBLISHED → ARCHIVED lifecycle, publish/archive gated to approved CONTENT supervisors and admins, media via the Object Storage abstraction). Phase 15 adds Notifications & Firebase FCM (in-app notifications as the source of truth, device (FCM) token registration, per-user push preference, EventBus-driven recipient resolution, admin broadcast, realtime notification.created on user:<id>; Firebase service-account details are never exposed). Phase 16 is a production-hardening pass — no new endpoints; it adds a WebSocket connection cap, a database statement timeout, a container health check and an operations runbook. (Phase 9 Appointments and Phase 11 Veterinary Jobs / Doctor Offers were each assessed and deferred — neither is in the confirmed spec.)',
    },
    servers: [{ url: '/api/v1', description: 'Version 1' }],
    tags: [
      { name: 'Health', description: 'Liveness and readiness probes' },
      ...phase2OpenApi.tags,
      ...phase3OpenApi.tags,
      ...phase4OpenApi.tags,
      ...phase5OpenApi.tags,
      ...phase6OpenApi.tags,
      ...phase7OpenApi.tags,
      ...phase8OpenApi.tags,
      ...phase10OpenApi.tags,
      ...phase12OpenApi.tags,
      ...phase13OpenApi.tags,
      ...phase14OpenApi.tags,
      ...phase15OpenApi.tags,
      ...advertisementsOpenApi.tags,
      ...tipsOpenApi.tags,
      ...newsOpenApi.tags,
      ...poultryOpsOpenApi.tags,
      ...phase17OpenApi.tags,
    ],
    paths: {
      ...phase2OpenApi.paths,
      ...phase3OpenApi.paths,
      ...phase4OpenApi.paths,
      ...phase5OpenApi.paths,
      ...phase6OpenApi.paths,
      ...phase7OpenApi.paths,
      ...phase8OpenApi.paths,
      ...phase10OpenApi.paths,
      ...phase12OpenApi.paths,
      ...phase13OpenApi.paths,
      ...phase14OpenApi.paths,
      ...phase15OpenApi.paths,
      ...advertisementsOpenApi.paths,
      ...tipsOpenApi.paths,
      ...newsOpenApi.paths,
      ...poultryOpsOpenApi.paths,
      ...phase17OpenApi.paths,
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Liveness probe',
          description: 'Returns 200 while the process is running. Does not touch dependencies.',
          responses: {
            '200': {
              description: 'Process is alive',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          status: { type: 'string', enum: ['ok'] },
                          uptimeSeconds: { type: 'integer' },
                          timestamp: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/health/ready': {
        get: {
          tags: ['Health'],
          summary: 'Readiness probe',
          description:
            'Returns 200 when all required dependencies (database) are reachable, otherwise 503.',
          responses: {
            '200': { description: 'Ready to serve traffic' },
            '503': { description: 'One or more dependencies are unavailable' },
          },
        },
      },
    },
    components: {
      securitySchemes: phase2OpenApi.securitySchemes,
      schemas: {
        ErrorEnvelope: errorEnvelope,
        ...phase2OpenApi.schemas,
        ...phase3OpenApi.schemas,
        ...phase4OpenApi.schemas,
        ...phase5OpenApi.schemas,
        ...phase6OpenApi.schemas,
        ...phase7OpenApi.schemas,
        ...phase8OpenApi.schemas,
        ...phase10OpenApi.schemas,
        ...phase12OpenApi.schemas,
        ...phase13OpenApi.schemas,
        ...phase14OpenApi.schemas,
        ...phase15OpenApi.schemas,
        ...advertisementsOpenApi.schemas,
        ...tipsOpenApi.schemas,
        ...newsOpenApi.schemas,
        ...poultryOpsOpenApi.schemas,
        ...phase17OpenApi.schemas,
      },
      responses: {
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
          },
        },
        ValidationError: {
          description: 'Request failed validation',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
          },
        },
      },
    },
  };
}
