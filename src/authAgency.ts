import type { ActionRequestInput } from "@absolutejs/agency";
import type {
  AgentDelegation,
  AgentDelegationStore,
} from "@absolutejs/auth/agents";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const AUTH_AGENCY_AUTHORIZATION_DETAIL_TYPE =
  "urn:absolutejs:authorization-detail:agency-delegation";

export const AuthAgencyAuthorizationDetailSchema = Type.Object(
  {
    actions: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    audience: Type.String({ minLength: 1 }),
    effects: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    resourceIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    ),
    resourceTypes: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    type: Type.Literal(AUTH_AGENCY_AUTHORIZATION_DETAIL_TYPE),
  },
  { additionalProperties: false },
);

export type AuthAgencyAuthorizationDetail = Static<
  typeof AuthAgencyAuthorizationDetailSchema
>;

export const authAgencyAuthorizationDetail = (
  detail: Omit<AuthAgencyAuthorizationDetail, "type">,
): AuthAgencyAuthorizationDetail => ({
  ...detail,
  type: AUTH_AGENCY_AUTHORIZATION_DETAIL_TYPE,
});

const subset = (required: readonly string[], available: readonly string[]) =>
  required.every((value) => available.includes(value));

const audienceOf = (action: ActionRequestInput) => {
  const audience = action.context?.audience;

  return typeof audience === "string" ? audience : undefined;
};

const activeDelegation = async (
  store: AgentDelegationStore,
  action: ActionRequestInput,
  now: number,
) => {
  const { delegationId } = action.actor;

  if (!delegationId) throw new Error("Agency action requires a delegation");
  const delegation = await store.findByDelegationId(delegationId);

  if (!delegation) throw new Error("Unknown authenticated delegation");
  if (delegation.status !== "active")
    throw new Error("Authenticated delegation is revoked");
  if (delegation.expiresAt !== undefined && delegation.expiresAt <= now)
    throw new Error("Authenticated delegation is expired");

  return delegation;
};

const assertActor = (
  action: ActionRequestInput,
  delegation: AgentDelegation,
) => {
  if (
    action.actor.agentId !== delegation.agentId ||
    action.actor.userId !== delegation.userId ||
    action.actor.organizationId !== delegation.organizationId
  )
    throw new Error("Agency actor does not match authenticated delegation");
  if (!subset(action.actor.scopes, delegation.scopes))
    throw new Error("Agency actor scopes exceed authenticated delegation");
};

const authorizationDetails = (delegation: AgentDelegation) =>
  (delegation.authorizationDetails ?? []).filter(
    (detail): detail is AuthAgencyAuthorizationDetail =>
      Value.Check(AuthAgencyAuthorizationDetailSchema, detail),
  );

const detailAllows = (
  detail: AuthAgencyAuthorizationDetail,
  action: ActionRequestInput,
) =>
  detail.audience === audienceOf(action) &&
  detail.actions.includes(action.action) &&
  subset(action.effects, detail.effects) &&
  detail.resourceTypes.includes(action.resource.type) &&
  (!detail.resourceIds || detail.resourceIds.includes(action.resource.id));

/** Bridges Absolute Auth's verified principal grant directly into Agency.
 * The same delegation ID is re-read at request, lease, and execution time; no
 * shadow grant or manual synchronization is required. */
export const createAuthAgencyDelegationAuthority = (options: {
  now?: () => number;
  store: AgentDelegationStore;
}) => ({
  assertAllows: async (action: ActionRequestInput) => {
    const delegation = await activeDelegation(
      options.store,
      action,
      (options.now ?? Date.now)(),
    );
    assertActor(action, delegation);
    if (
      !authorizationDetails(delegation).some((detail) =>
        detailAllows(detail, action),
      )
    )
      throw new Error("Agency action is outside authenticated delegation");

    return {
      ...(delegation.expiresAt === undefined
        ? {}
        : { expiresAt: delegation.expiresAt }),
    };
  },
});
