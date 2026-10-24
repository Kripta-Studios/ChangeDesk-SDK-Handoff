export const AUTH_MUTATION_EXEMPTIONS = new Set(["/auth/user/emailpass", "/auth/session"])

export const mustRevokeStaffHostSession = (actorType: string | undefined): boolean => actorType === "user"

export const mustDenyAuthMutation = (path: string) => !AUTH_MUTATION_EXEMPTIONS.has(path)

export const mustDenyAdminMutation = (path: string, managedDemoActor: boolean) =>
  managedDemoActor && path !== "/admin/changedesk/session"
