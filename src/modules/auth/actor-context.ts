import { actorRoles, type ActorRole } from '../../domain/authorization.js';

export type AuthenticatedActor = {
  userId: string;
  role: ActorRole;
  email?: string;
  campusId?: string;
  vendorId?: string;
  riderId?: string;
};

export function isActorRole(value: unknown): value is ActorRole {
  return typeof value === 'string' && actorRoles.includes(value as ActorRole);
}
