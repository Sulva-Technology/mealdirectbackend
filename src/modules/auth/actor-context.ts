import { actorRoles, type ActorRole } from '../../domain/authorization.js';

export type AuthenticatedActor = {
  userId: string;
  role: ActorRole;
  email?: string;
  campusId?: string;
  vendorId?: string;
  riderId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  gender?: 'Male' | 'Female';
};

export function isActorRole(value: unknown): value is ActorRole {
  return typeof value === 'string' && actorRoles.includes(value as ActorRole);
}
