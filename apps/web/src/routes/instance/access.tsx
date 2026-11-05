import type { Instance } from "@bc-launcher-server/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { ChoiceCard } from "@/components/choice-card";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/i18n";
import { api, instanceQuery, instancesQuery, invalidateAccess, settingsQuery } from "@/lib/queries";
import { BlacklistCard, WhitelistCard } from "../access-lists";

export function InstanceAccessPage({ id }: { id: string }) {
  const instance = useQuery(instanceQuery(id));
  return instance.data ? <AccessTab instance={instance.data} /> : null;
}

function AccessTab({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const settings = useQuery(settingsQuery);
  const headingId = useId();

  const change = useMutation({
    mutationFn: (access: Instance["access"]) => api.updateInstanceAccess(instance.id, access),
    onSuccess: ({ access }) => {
      queryClient.setQueryData(instanceQuery(instance.id).queryKey, { ...instance, access });
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: instancesQuery.queryKey }),
        invalidateAccess(queryClient),
      ]),
  });
  const access = change.isPending ? change.variables : instance.access;
  const everyoneHint =
    settings.data?.visibility === "private"
      ? t("instanceAccess.everyoneHint.private")
      : t("instanceAccess.everyoneHint.public");

  return (
    <div className="flex flex-col gap-5">
      <Card role="region" aria-labelledby={headingId} className="flex flex-col gap-3.5 p-[22px]">
        <h2 id={headingId} className="m-0 text-base font-semibold">
          {t("instanceAccess.who")}
        </h2>
        <fieldset className="m-0 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-2.5 border-0 p-0">
          <legend className="sr-only">{t("instanceAccess.who")}</legend>
          <ChoiceCard
            name="access"
            value="everyone"
            checked={access === "everyone"}
            disabled={change.isPending}
            onChange={() => change.mutate("everyone")}
            title={t("instanceAccess.everyone")}
            description={everyoneHint}
          />
          <ChoiceCard
            name="access"
            value="whitelist"
            checked={access === "whitelist"}
            disabled={change.isPending}
            onChange={() => change.mutate("whitelist")}
            title={t("instanceAccess.whitelist")}
            description={t("instanceAccess.whitelistHint")}
          />
        </fieldset>
        {change.isError ? (
          <p role="alert" className="m-0 text-[13px] text-destructive-foreground">
            {t("common.unexpectedError")}
          </p>
        ) : null}
        <p className="m-0 text-[13px] text-muted-foreground">{t("instanceAccess.blacklistWins")}</p>
      </Card>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(440px,100%),1fr))] items-start gap-5">
        <WhitelistCard
          scope={instance.id}
          note={access === "everyone" ? t("instanceAccess.whitelistUnused") : undefined}
        />
        <BlacklistCard scope={instance.id} />
      </div>
    </div>
  );
}
