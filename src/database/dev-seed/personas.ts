import type { OrganizationType } from '../../modules/organizations/domain/organization.types.js';
import type { RoleKey } from '../../modules/rbac/rbac.constants.js';
import type { VeterinarianStatus } from '../../modules/users/user.types.js';
import type { AnimalSex, AnimalSpecies } from '../../modules/animals/domain/animal.constants.js';

/**
 * Deterministic development personas — LOCAL DEVELOPMENT ONLY.
 *
 * Every persona logs in through the NORMAL `POST /api/v1/auth/login` flow with
 * {@link DEV_PASSWORD}. Nothing here bypasses authentication: the seed hashes
 * this password with the same `PasswordService` (Argon2id) the API uses and
 * writes ordinary `users` rows.
 *
 * ⚠️  These credentials are well-known. They MUST NEVER be created in a
 *     production database — see `runDevSeed` for the environment guard.
 */

/** Shared password for every development persona. Development-only. */
export const DEV_PASSWORD = 'DevPassword123!';

export interface DevPersona {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Extra roles beyond the PET_OWNER every persona gets. */
  roles: RoleKey[];
  /** Target veterinarian workflow state, converged to by `runDevSeed`. */
  vet: VeterinarianStatus | 'NONE';
}

// --- personas --------------------------------------------------------

export const DEV_PERSONAS = {
  admin: {
    key: 'admin',
    email: 'admin@example.test',
    firstName: 'Development',
    lastName: 'Admin',
    roles: ['ADMIN'],
    vet: 'NONE',
  },
  owner: {
    key: 'owner',
    email: 'owner@example.test',
    firstName: 'Pet',
    lastName: 'Owner',
    roles: [],
    vet: 'NONE',
  },
  vet: {
    key: 'vet',
    email: 'vet@example.test',
    firstName: 'Approved',
    lastName: 'Veterinarian',
    roles: [],
    vet: 'APPROVED',
  },
  vetPending: {
    key: 'vetPending',
    email: 'vet.pending@example.test',
    firstName: 'Pending',
    lastName: 'Veterinarian',
    roles: [],
    vet: 'PENDING',
  },
  vetRejected: {
    key: 'vetRejected',
    email: 'vet.rejected@example.test',
    firstName: 'Rejected',
    lastName: 'Veterinarian',
    roles: [],
    vet: 'REJECTED',
  },
  moderator: {
    key: 'moderator',
    email: 'moderator@example.test',
    firstName: 'Content',
    lastName: 'Moderator',
    roles: ['MODERATOR'],
    vet: 'NONE',
  },
  clinicOwner: {
    key: 'clinicOwner',
    email: 'clinic.owner@example.test',
    firstName: 'Clinic',
    lastName: 'Owner',
    roles: [],
    vet: 'APPROVED',
  },
  farmOwner: {
    key: 'farmOwner',
    email: 'farm.owner@example.test',
    firstName: 'Farm',
    lastName: 'Owner',
    roles: [],
    vet: 'APPROVED',
  },
  officeOwner: {
    key: 'officeOwner',
    email: 'office.owner@example.test',
    firstName: 'Veterinary Office',
    lastName: 'Owner',
    roles: [],
    vet: 'NONE',
  },
  storeOwner: {
    key: 'storeOwner',
    email: 'store.owner@example.test',
    firstName: 'Veterinary Store',
    lastName: 'Owner',
    roles: [],
    vet: 'NONE',
  },
  orgVet: {
    key: 'orgVet',
    email: 'org.vet@example.test',
    firstName: 'Organization',
    lastName: 'Veterinarian',
    roles: [],
    vet: 'APPROVED',
  },
  supervisor: {
    key: 'supervisor',
    email: 'supervisor@example.test',
    firstName: 'Organization',
    lastName: 'Supervisor',
    roles: [],
    vet: 'APPROVED',
  },
  staff: {
    key: 'staff',
    email: 'staff@example.test',
    firstName: 'Organization',
    lastName: 'Staff',
    roles: [],
    vet: 'NONE',
  },
  multiOrg: {
    key: 'multiOrg',
    email: 'multi.org@example.test',
    firstName: 'Multi Organization',
    lastName: 'User',
    roles: [],
    vet: 'APPROVED',
  },
} satisfies Record<string, DevPersona>;

export type DevPersonaKey = keyof typeof DEV_PERSONAS;

export const DEV_PERSONA_LIST: DevPersona[] = Object.values(DEV_PERSONAS);

// --- organizations ----------------------------------------------------

export interface DevOrganization {
  key: string;
  ownerKey: DevPersonaKey;
  type: OrganizationType;
  name: string;
  description: string;
}

export const DEV_ORGANIZATIONS = {
  clinic: {
    key: 'clinic',
    ownerKey: 'clinicOwner',
    type: 'CLINIC',
    name: 'Bytari Dev Clinic',
    description: 'Development clinic used to exercise clinic owner / member flows.',
  },
  farm: {
    key: 'farm',
    ownerKey: 'farmOwner',
    type: 'FARM',
    name: 'Bytari Dev Farm',
    description: 'Development farm used to exercise farm owner / poultry / join-code flows.',
  },
  office: {
    key: 'office',
    ownerKey: 'officeOwner',
    type: 'VETERINARY_OFFICE',
    name: 'Bytari Dev Veterinary Office',
    description: 'Development veterinary office.',
  },
  store: {
    key: 'store',
    ownerKey: 'storeOwner',
    type: 'VETERINARY_STORE',
    name: 'Bytari Dev Veterinary Store',
    description: 'Development veterinary store used to exercise the product catalogue.',
  },
} satisfies Record<string, DevOrganization>;

export type DevOrganizationKey = keyof typeof DEV_ORGANIZATIONS;

export const DEV_ORGANIZATION_LIST: DevOrganization[] = Object.values(DEV_ORGANIZATIONS);

// --- memberships (generic VETERINARIAN / STAFF) -----------------------

export interface DevMembership {
  orgKey: DevOrganizationKey;
  personaKey: DevPersonaKey;
  role: 'VETERINARIAN' | 'STAFF';
}

export const DEV_MEMBERSHIPS: DevMembership[] = [
  { orgKey: 'clinic', personaKey: 'orgVet', role: 'VETERINARIAN' },
  { orgKey: 'clinic', personaKey: 'staff', role: 'STAFF' },
  // Multi-organization user: different role in each org so organization
  // isolation can be verified from the mobile app.
  { orgKey: 'clinic', personaKey: 'multiOrg', role: 'VETERINARIAN' },
  { orgKey: 'farm', personaKey: 'multiOrg', role: 'STAFF' },
];

// --- supervisors (explicitly-selected, LIMITED permission set) --------

export interface DevSupervisor {
  orgKey: DevOrganizationKey;
  personaKey: DevPersonaKey;
  permissions: string[];
}

export const DEV_SUPERVISORS: DevSupervisor[] = [
  {
    orgKey: 'clinic',
    personaKey: 'supervisor',
    // Deliberately read-only oversight — NOT the full catalogue.
    permissions: [
      'organization.read',
      'member.read',
      'animal.veterinary.access.read',
      'medical_record.read',
      'vaccination.read',
    ],
  },
];

// --- pet owner's animals -----------------------------------------------

export interface DevAnimal {
  ownerKey: DevPersonaKey;
  name: string;
  species: AnimalSpecies;
  sex: AnimalSex;
  breed: string;
  dateOfBirth: string;
  notes: string;
}

export const DEV_ANIMALS: DevAnimal[] = [
  {
    ownerKey: 'owner',
    name: 'Max',
    species: 'DOG',
    sex: 'MALE',
    breed: 'Labrador Retriever',
    dateOfBirth: '2021-06-01',
    notes: 'Friendly, up to date on core vaccines.',
  },
  {
    ownerKey: 'owner',
    name: 'Luna',
    species: 'CAT',
    sex: 'FEMALE',
    breed: 'Domestic Shorthair',
    dateOfBirth: '2022-03-15',
    notes: 'Indoor cat.',
  },
  {
    ownerKey: 'owner',
    name: 'Kiwi',
    species: 'BIRD',
    sex: 'UNKNOWN',
    breed: 'Budgerigar',
    dateOfBirth: '2023-01-10',
    notes: 'Hand-raised.',
  },
];
