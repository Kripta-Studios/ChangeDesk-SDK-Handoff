export const storefrontLogoutMiddlewares = <AuthenticationMiddleware, RevocationMiddleware>(
  authenticateSession: AuthenticationMiddleware,
  revokeStaffHostSession: RevocationMiddleware,
): Array<AuthenticationMiddleware | RevocationMiddleware> => [
  authenticateSession,
  revokeStaffHostSession,
];
