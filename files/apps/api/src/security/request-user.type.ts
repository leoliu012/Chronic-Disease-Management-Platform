import { UserRole } from '@prisma/client';

export type RequestUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  /** Resolved from the database during JWT verification; never trusted from request input. */
  hospitalTenantId: string | null;
};
