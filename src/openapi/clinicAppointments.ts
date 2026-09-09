/**
 * OpenAPI fragments for Clinic Appointments — the Pet Owner ↔ Clinic "حجز موعد"
 * booking workflow.
 *
 *  - A Pet Owner books via `POST /organizations/{organizationId}/clinic-appointments`
 *    (authentication + pet ownership only — no org permission).
 *  - The owner's own list / details / history / cancel / reschedule-response
 *    live under `/clinic-appointments`.
 *  - The future Clinic Dashboard reads and decides under
 *    `/organizations/{organizationId}/clinic-appointments*`
 *    (`clinic.appointment.read` / `clinic.appointment.manage`).
 */
type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (slot not in the future, invalid transition)',
    401: 'Missing or invalid access token',
    403: 'Clinic is not active, or the caller lacks the clinic.appointment.* permission',
    404: 'Appointment / clinic / pet not found, or the caller has no relationship to it',
    409: 'The appointment status does not allow this action',
    422: 'Request failed validation',
  };
  const out: Obj = {};
  for (const c of codes) out[String(c)] = { description: map[c] ?? 'Error', content: jsonError };
  return out;
}
function ok(description: string, schema?: Obj): Obj {
  return schema ? { description, content: { 'application/json': { schema } } } : { description };
}
function dataOf(schema: Obj): Obj {
  return { type: 'object', properties: { data: schema } };
}
function listOf(ref: string): Obj {
  return {
    type: 'object',
    properties: { data: { type: 'array', items: { $ref: ref } }, meta: { type: 'object' } },
  };
}

const uuid = { type: 'string', format: 'uuid' };
const dateTime = { type: 'string', format: 'date-time' };
const orgIdParam = { name: 'organizationId', in: 'path', required: true, schema: uuid };
const apptIdParam = { name: 'appointmentId', in: 'path', required: true, schema: uuid };

const VISIT_TYPES = ['CHECKUP', 'VACCINATION', 'FOLLOW_UP', 'SURGERY', 'OTHER'];
const STATUSES = [
  'PENDING',
  'CONFIRMED',
  'RESCHEDULE_PROPOSED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
];

const schemas: Obj = {
  ClinicAppointmentAnimalRef: {
    type: 'object',
    properties: {
      id: uuid,
      name: { type: 'string' },
      species: { type: 'string' },
      breed: { type: 'string', nullable: true },
    },
  },
  ClinicAppointmentOrgRef: {
    type: 'object',
    properties: {
      id: uuid,
      name: { type: 'string' },
      phone: { type: 'string', nullable: true },
      address: { type: 'string', nullable: true },
    },
  },
  ClinicAppointment: {
    type: 'object',
    properties: {
      id: uuid,
      organizationId: uuid,
      organization: { $ref: '#/components/schemas/ClinicAppointmentOrgRef' },
      animalId: uuid,
      animal: { $ref: '#/components/schemas/ClinicAppointmentAnimalRef' },
      petOwnerUserId: uuid,
      visitType: { type: 'string', enum: VISIT_TYPES },
      scheduledFor: dateTime,
      proposedScheduledFor: { ...dateTime, nullable: true },
      note: { type: 'string', nullable: true },
      status: { type: 'string', enum: STATUSES },
      decisionReason: { type: 'string', nullable: true },
      decidedByUserId: { ...uuid, nullable: true },
      decidedAt: { ...dateTime, nullable: true },
      viewerSide: { type: 'string', enum: ['PET_OWNER', 'CLINIC'] },
      createdAt: dateTime,
      updatedAt: dateTime,
    },
  },
  ClinicAppointmentHistoryEntry: {
    type: 'object',
    properties: {
      id: uuid,
      kind: {
        type: 'string',
        enum: [
          'REQUESTED',
          'CONFIRMED',
          'REJECTED',
          'RESCHEDULE_PROPOSED',
          'RESCHEDULE_ACCEPTED',
          'RESCHEDULE_DECLINED',
          'CANCELLED',
          'COMPLETED',
        ],
      },
      actorSide: { type: 'string', enum: ['PET_OWNER', 'CLINIC'] },
      actorUserId: { ...uuid, nullable: true },
      fromScheduledFor: { ...dateTime, nullable: true },
      toScheduledFor: { ...dateTime, nullable: true },
      reason: { type: 'string', nullable: true },
      createdAt: dateTime,
    },
  },
};

const tags = [
  {
    name: 'Clinic Appointments',
    description: 'Pet Owner ↔ Clinic appointment booking ("حجز موعد").',
  },
];

const createBody = {
  'application/json': {
    schema: {
      type: 'object',
      required: ['animalId', 'visitType', 'scheduledFor'],
      properties: {
        animalId: uuid,
        visitType: { type: 'string', enum: VISIT_TYPES },
        scheduledFor: dateTime,
        note: { type: 'string', maxLength: 1000, nullable: true },
      },
    },
  },
};

const listParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
  { name: 'status', in: 'query', schema: { type: 'string', enum: STATUSES } },
  { name: 'from', in: 'query', schema: dateTime },
];

const paths: Obj = {
  '/clinic-appointments': {
    get: {
      tags: ['Clinic Appointments'],
      summary: "List the authenticated Pet Owner's appointments (own only)",
      security: bearer,
      parameters: listParams,
      responses: {
        200: ok('Appointment page', listOf('#/components/schemas/ClinicAppointment')),
        ...errs(401, 422),
      },
    },
  },
  '/clinic-appointments/{appointmentId}': {
    parameters: [apptIdParam],
    get: {
      tags: ['Clinic Appointments'],
      summary: 'Get one appointment — pet owner or an ACTIVE clinic member',
      security: bearer,
      responses: {
        200: ok('Appointment', dataOf({ $ref: '#/components/schemas/ClinicAppointment' })),
        ...errs(401, 404),
      },
    },
  },
  '/clinic-appointments/{appointmentId}/history': {
    parameters: [apptIdParam],
    get: {
      tags: ['Clinic Appointments'],
      summary: 'Appointment history timeline (oldest first)',
      security: bearer,
      responses: {
        200: ok(
          'History',
          {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: { $ref: '#/components/schemas/ClinicAppointmentHistoryEntry' },
              },
            },
          },
        ),
        ...errs(401, 404),
      },
    },
  },
  '/clinic-appointments/{appointmentId}/cancel': {
    parameters: [apptIdParam],
    post: {
      tags: ['Clinic Appointments'],
      summary: 'Pet owner withdraws an open appointment',
      security: bearer,
      responses: {
        200: ok('Cancelled', dataOf({ $ref: '#/components/schemas/ClinicAppointment' })),
        ...errs(401, 404, 409),
      },
    },
  },
  '/clinic-appointments/{appointmentId}/reschedule-response': {
    parameters: [apptIdParam],
    post: {
      tags: ['Clinic Appointments'],
      summary: 'Pet owner accepts (→ CONFIRMED) or declines (→ CANCELLED) a proposed reschedule',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['accept'],
              properties: { accept: { type: 'boolean' } },
            },
          },
        },
      },
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/ClinicAppointment' })),
        ...errs(401, 404, 409),
      },
    },
  },
  '/organizations/{organizationId}/clinic-appointments': {
    parameters: [orgIdParam],
    post: {
      tags: ['Clinic Appointments'],
      summary: 'Pet owner books a visit with a clinic (authentication + pet ownership only)',
      security: bearer,
      requestBody: { required: true, content: createBody },
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/ClinicAppointment' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
    get: {
      tags: ['Clinic Appointments'],
      summary: 'Clinic Dashboard — list appointment requests for this clinic (clinic.appointment.read)',
      security: bearer,
      parameters: [...listParams, { name: 'petOwnerUserId', in: 'query', schema: uuid }],
      responses: {
        200: ok('Appointment page', listOf('#/components/schemas/ClinicAppointment')),
        ...errs(401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/clinic-appointments/{appointmentId}/confirm': {
    parameters: [orgIdParam, apptIdParam],
    post: {
      tags: ['Clinic Appointments'],
      summary: 'Clinic Dashboard — confirm a pending appointment (clinic.appointment.manage)',
      security: bearer,
      responses: {
        200: ok('Confirmed', dataOf({ $ref: '#/components/schemas/ClinicAppointment' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/organizations/{organizationId}/clinic-appointments/{appointmentId}/reject': {
    parameters: [orgIdParam, apptIdParam],
    post: {
      tags: ['Clinic Appointments'],
      summary: 'Clinic Dashboard — reject an appointment (clinic.appointment.manage)',
      security: bearer,
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { reason: { type: 'string', maxLength: 500 } },
            },
          },
        },
      },
      responses: {
        200: ok('Rejected', dataOf({ $ref: '#/components/schemas/ClinicAppointment' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/organizations/{organizationId}/clinic-appointments/{appointmentId}/reschedule': {
    parameters: [orgIdParam, apptIdParam],
    post: {
      tags: ['Clinic Appointments'],
      summary: 'Clinic Dashboard — propose an alternative date/time (clinic.appointment.manage)',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['proposedScheduledFor'],
              properties: {
                proposedScheduledFor: dateTime,
                reason: { type: 'string', maxLength: 500 },
              },
            },
          },
        },
      },
      responses: {
        200: ok('Reschedule proposed', dataOf({ $ref: '#/components/schemas/ClinicAppointment' })),
        ...errs(400, 401, 403, 404, 409),
      },
    },
  },
  '/organizations/{organizationId}/clinic-appointments/{appointmentId}/complete': {
    parameters: [orgIdParam, apptIdParam],
    post: {
      tags: ['Clinic Appointments'],
      summary: 'Clinic Dashboard — mark a confirmed appointment completed (clinic.appointment.manage)',
      security: bearer,
      responses: {
        200: ok('Completed', dataOf({ $ref: '#/components/schemas/ClinicAppointment' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/organizations/{organizationId}/clinic-appointments/{appointmentId}/status': {
    parameters: [orgIdParam, apptIdParam],
    patch: {
      tags: ['Clinic Appointments'],
      summary: 'Clinic Dashboard — generic status update (clinic.appointment.manage)',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['status'],
              properties: {
                status: {
                  type: 'string',
                  enum: ['CONFIRMED', 'REJECTED', 'COMPLETED', 'CANCELLED'],
                },
                reason: { type: 'string', maxLength: 500 },
              },
            },
          },
        },
      },
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/ClinicAppointment' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
};

export const clinicAppointmentsOpenApi = { tags, paths, schemas };
