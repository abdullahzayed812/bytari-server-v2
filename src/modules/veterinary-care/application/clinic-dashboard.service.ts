import type { AnimalService } from '../../animals/application/animal.service.js';
import type { AnimalDTO } from '../../animals/domain/animal.types.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import type { OrganizationEngagementService } from '../../organizations/application/organization-engagement.service.js';
import type { AnimalClinicAccessRepository } from '../infrastructure/animal-clinic-access.repository.js';
import type {
  ClinicAnimalStats,
  ClinicAppointmentStats,
  ClinicDashboardRepository,
  ClinicMedicalStats,
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
  /** `animal.veterinary.access.read` */
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
 * The clinic-visible projection of an animal — the profile a treating clinic
 * needs, WITHOUT owner identity (`currentOwnerUserId` / `createdBy`), the
 * owner's private `notes`, or storage keys. Owner contact is not disclosed to
 * organizations (MOBILE_ARCHITECTURE §63).
 */
export interface ClinicAnimalDTO {
  id: string;
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
  /** This clinic's ACTIVE grant — `null` only for an ADMIN viewing without one. */
  access: { id: string; grantedAt: string } | null;
  stats: ClinicAnimalStats;
}

/** Clinic Dashboard read model — composes existing aggregates, no new tables. */
export class ClinicDashboardService {
  constructor(
    private readonly dashboard: ClinicDashboardRepository,
    private readonly access: AnimalClinicAccessRepository,
    private readonly animals: AnimalService,
    private readonly engagement: OrganizationEngagementService,
    private readonly authz: AuthorizationService,
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
      permissions.canViewAnimals ? this.dashboard.countActiveAnimals(organizationId) : null,
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
   * MUST be reached only through `withVeterinaryAnimalAccess` — the clinic's
   * ACTIVE grant (or ADMIN) is verified before this runs.
   */
  async getAnimal(organizationId: string, animalId: string): Promise<ClinicAnimalDTO> {
    const [animal, grant, stats] = await Promise.all([
      this.animals.getDTOById(animalId),
      this.access.findActive(animalId, organizationId),
      this.dashboard.animalStats(animalId),
    ]);
    return {
      id: animal.id,
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
      access: grant ? { id: grant.id, grantedAt: grant.createdAt } : null,
      stats,
    };
  }
}
