import { EntityRole } from './entities.js';

export const ROLE_HIERARCHY: Record<EntityRole, number> = {
  [EntityRole.OWNER]: 5,
  [EntityRole.ADMIN]: 4,
  [EntityRole.MEMBER]: 3,
  [EntityRole.GUEST]: 2,
  [EntityRole.OBSERVER]: 1,
};

export function hasPermission(userRole: EntityRole, required: EntityRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[required];
}

export function canSendMessages(role: EntityRole): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[EntityRole.MEMBER];
}

export function canManageChannel(role: EntityRole): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[EntityRole.ADMIN];
}

export function isObserver(role: EntityRole): boolean {
  return role === EntityRole.OBSERVER;
}
