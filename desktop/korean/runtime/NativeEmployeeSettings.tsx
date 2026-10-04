import { useCommunities } from "@/features/communities/useCommunities";
import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import { canManageCommunityMembers } from "@/shared/api/relayMembers";
import { NativeAccount } from "./NativeAccount";
import { t, useLocale } from "./locale";

/** Employee IDs belong only to the configured KOVAR home server. */
export function isEmployeeHomeServer(relayUrl: string | undefined): boolean {
  if (!relayUrl) return false;
  try {
    return new URL(relayUrl).origin === "wss://buzz.kovar.kr";
  } catch {
    return false;
  }
}

/** Native settings page; the account service still authorizes every operation. */
export function NativeEmployeeSettings({
  currentPubkey,
}: {
  currentPubkey?: string;
}) {
  useLocale();
  const { activeCommunity } = useCommunities();
  const membership = useMyRelayMembershipLookupQuery();
  if (membership.isPending)
    return <p role="status">{t("Checking invite permissions…")}</p>;
  if (
    !isEmployeeHomeServer(activeCommunity?.relayUrl) ||
    !canManageCommunityMembers(membership.data)
  ) {
    return (
      <p role="alert">
        {t("Employee accounts are available to KOVAR administrators.")}
      </p>
    );
  }
  return (
    <section data-testid="settings-employee-accounts" className="min-w-0">
      <h1 className="text-2xl font-semibold">{t("Employee accounts")}</h1>
      <p className="mb-6 mt-2 text-sm text-muted-foreground">
        {t(
          "Create employee logins, choose their channels, and manage their accounts here in the app.",
        )}
      </p>
      <NativeAccount
        key={`${activeCommunity?.id}:${currentPubkey}`}
        manage
        employeePage
      />
    </section>
  );
}
