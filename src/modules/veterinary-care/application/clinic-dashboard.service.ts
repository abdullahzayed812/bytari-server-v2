import type { ObjectStorage } from '../../../infra/storage/index.js';
import type { AnimalService } from '../../animals/application/animal.service.js';
import type { AnimalDTO } from '../../animals/domain/animal.types.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import type { OrganizationEngagementService } from '../../organizations/application/organization-engagement.service.js';
import type {
  ClinicPetActivity,
  ClinicPetRepository,
} from '../infrastructure/clinic-pet.repository.js';
import type {
  ClinicAnimalOwnerContact,
  ClinicAnimalStats,
  ClinicAppointmentStats,
  ClinicDashboardRepository,
  ClinicMedicalStats,
  OwnerAnimalClinicRow,
} from '../infrastructure/clinic-dashboard.repository.js';

/**
 * What the caller may do in this clinic — derived from the real organization
 * RBAC (role permissions ∪ supervisor grants, owner / ADMIN override), so the
 * dashboard never guesses from `myRole`. UI hint only: every action is still
 * re-authorized by its own route.
 */
export interface ClinicDashboardPermissions {
  canViewAnimals: boolean;
  canManageAnimalAccess: boolean;
  canViewMedicalRecords: boolean;
  canCreateMedicalRecords: boolean;
  canViewVaccinations: boolean;
  canCreateVaccinations: boolean;
  canViewAppointments: boolean;
  canManageAppointments: boolean;
  canSendBroadcast: boolean;
  canViewMembers: boolean;
  canViewSupervisors: boolean;
  canEditOrganization: boolean;
}

const PERMISSION_KEYS: Record<keyof ClinicDashboardPermissions, string> = {
  canViewAnimals: 'animal.veterinary.access.read',
  canManageAnimalAccess: 'animal.veterinary.access.manage',
  canViewMedicalRecords: 'medical_record.read',
  canCreateMedicalRecords: 'medical_record.create',
  canViewVaccinations: 'vaccination.read',
  canCreateVaccinations: 'vaccination.create',
  canViewAppointments: 'clinic.appointment.read',
  canManageAppointments: 'clinic.appointment.manage',
  canSendBroadcast: 'organization.broadcast.send',
  canViewMembers: 'member.read',
  canViewSupervisors: 'supervisor.read',
  canEditOrganization: 'organization.update',
};

/**
 * `GET /organizations/:organizationId/clinic-dashboard/summary`. A section is
 * `null` when the caller lacks the permission that guards the matching list
 * route — counts are never disclosed to someone who could not read the rows.
 */
export interface ClinicDashboardSummary {
  permissions: ClinicDashboardPermissions;
  /** `animal.veterinary.access.read` — pets this clinic has its own records for. */
  animals: { activeCount: number } | null;
  /** `medical_record.read` (vaccination counts additionally need `vaccination.read`). */
  medical: ClinicMedicalStats | null;
  /** `clinic.appointment.read` */
  appointments: ClinicAppointmentStats | null;
  followersCount: number;
  rating: number | null;
  reviewsCount: number;
}

/**
 * The clinic-visible projection of a pet — the profile a treating clinic
 * needs. Like the legacy clinic pet page it carries the CURRENT owner's name +
 * phone (needed to call the owner and to open the clinic ↔ owner chat). The
 * owner's private `notes`, `createdBy` and storage keys are never included,
 * and `stats` / `relationship` describe THIS clinic's own work only.
 */
export interface ClinicAnimalDTO {
  id: string;
  /** Short public pet ID. */
  publicCode: string;
  name: string;
  species: AnimalDTO['species'];
  breed: string | null;
  sex: AnimalDTO['sex'];
  dateOfBirth: string | null;
  ageEstimate: AnimalDTO['ageEstimate'];
  color: string | null;
  distinguishingFeatures: string | null;
  status: AnimalDTO['status'];
  galleryUrls: string[];
  weightKg: number | null;
  isNeutered: boolean | null;
  /** Legacy free-text medical history kept on the animal profile. */
  medicalHistory: string | null;
  owner: ClinicAnimalOwnerContact | null;
  /** This clinic's first / last record for the pet — `null` before it adds anything. */
  relationship: ClinicPetActivity | null;
  /** Counts / dates over THIS clinic's own records only. */
  stats: ClinicAnimalStats;
}

/** Clinic Dashboard read model — composes existing aggregates, no new tables. */
export class ClinicDashboardService {
  constructor(
    private readonly dashboard: ClinicDashboardRepository,
    private readonly pets: ClinicPetRepository,
    private readonly animals: AnimalService,
    private readonly engagement: OrganizationEngagementService,
    private readonly authz: AuthorizationService,
    private readonly storage: ObjectStorage,
  ) {}

  async permissionsFor(
    principal: AuthPrincipal,
    organizationId: string,
  ): Promise<ClinicDashboardPermissions> {
    const isAdmin = this.authz.isAdmin(principal);
    // One membership lookup for the whole set (canInOrganization would repeat it per key).
    const ctx = isAdmin
      ? null
      : await this.authz.getOrganizationMembershipContext(principal.userId, organizationId);
    const can = (permission: string): boolean =>
      isAdmin || ctx?.isOwner === true || (ctx?.permissions.includes(permission) ?? false);

    const out = {} as ClinicDashboardPermissions;
    for (const [flag, permission] of Object.entries(PERMISSION_KEYS)) {
      out[flag as keyof ClinicDashboardPermissions] = can(permission);
    }
    return out;
  }

  async getSummary(
    organizationId: string,
    principal: AuthPrincipal,
  ): Promise<ClinicDashboardSummary> {
    const permissions = await this.permissionsFor(principal, organizationId);

    const [animalsCount, medical, appointments, engagement] = await Promise.all([
      permissions.canViewAnimals ? this.pets.countForClinic(organizationId) : null,
      permissions.canViewMedicalRecords ? this.dashboard.medicalStats(organizationId) : null,
      permissions.canViewAppointments ? this.dashboard.appointmentStats(organizationId) : null,
      this.engagement.getSummary(organizationId, principal.userId),
    ]);

    return {
      permissions,
      animals: animalsCount === null ? null : { activeCount: animalsCount },
      medical:
        medical && !permissions.canViewVaccinations
          ? { ...medical, vaccinationsCount: 0, vaccinationsDueToday: 0 }
          : medical,
      appointments,
      followersCount: engagement.followersCount,
      rating: engagement.rating,
      reviewsCount: engagement.reviewsCount,
    };
  }

  /**
   * MUST be reached only through `withClinicAnimal` (registered pet) after the
   * clinic's membership + permission checks.
   */
  async getAnimal(organizationId: string, animalId: string): Promise<ClinicAnimalDTO> {
    const [animal, relationship, stats, owner] = await Promise.all([
      this.animals.getDTOById(animalId),
      this.pets.activityFor(organizationId, animalId),
      this.dashboard.animalStats(organizationId, animalId),
      this.dashboard.ownerContact(animalId),
    ]);
    return {
      id: animal.id,
      publicCode: animal.publicCode,
      name: animal.name,
      species: animal.species,
      breed: animal.breed,
      sex: animal.sex,
      dateOfBirth: animal.dateOfBirth,
      ageEstimate: animal.ageEstimate,
      color: animal.color,
      distinguishingFeatures: animal.distinguishingFeatures,
      status: animal.status,
      galleryUrls: animal.galleryUrls,
      weightKg: animal.weightKg,
      isNeutered: animal.isNeutered,
      medicalHistory: animal.medicalHistory,
      owner,
      relationship,
      stats,
    };
  }

  /** Owner-facing "العيادات" tab — MUST be reached through the owner guard. */
  async clinicsForAnimal(animalId: string): Promise<OwnerAnimalClinicDTO[]> {
    const rows = await this.dashboard.clinicsForAnimal(animalId);
    return Promise.all(
      rows.map(async ({ logoKey, ...row }) => ({
        ...row,
        logoUrl: logoKey
          ? (this.storage.getPublicUrl(logoKey) ??
            (await this.storage.getSignedUrl(logoKey, { operation: 'get', expiresIn: 3600 })))
          : null,
      })),
    );
  }
}

export type OwnerAnimalClinicDTO = Omit<OwnerAnimalClinicRow, 'logoKey'> & {
  logoUrl: string | null;
};
