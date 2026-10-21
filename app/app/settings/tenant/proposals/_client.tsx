"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";

export { ModelosDeProposta, CHAVE_DO_MODELO_IMPORTADO } from "./modelos/_client";

interface ProposalsConfig {
  enabled: boolean;
  default_valid_days: number;
  default_conditions: string | null;
  followup_dias?: number;
  avisar_no_whatsapp?: boolean;
}

export function ProposalsSettingsClient() {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [enabled, setEnabled] = useState(false);
  const [defaultValidDays, setDefaultValidDays] = useState(15);
  const [defaultConditions, setDefaultConditions] = useState("");
  const [followupDias, setFollowupDias] = useState(3);
  const [avisarNoWhatsapp, setAvisarNoWhatsapp] = useState(true);

  useEffect(() => {
    let active = true;
    apiClient
      .get<ApiSuccess<ProposalsConfig>>("/api/v1/settings/proposals")
      .then((res) => {
        if (!active || !res?.data) return;
        setEnabled(Boolean(res.data.enabled));
        setDefaultValidDays(res.data.default_valid_days ?? 15);
        setDefaultConditions(res.data.default_conditions ?? "");
        if (typeof res.data.followup_dias === "number") {
          setFollowupDias(res.data.followup_dias);
        }
        if (typeof res.data.avisar_no_whatsapp === "boolean") {
          setAvisarNoWhatsapp(res.data.avisar_no_whatsapp);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        showApiError(err);
      });

    return () => {
      active = false;
    };
  }, []);

  function handleSalvar(e?: React.FormEvent) {
    if (e) e.preventDefault();
    startTransition(async () => {
      try {
        await apiClient.patch("/api/v1/settings/proposals", {
          enabled,
          default_valid_days: Number(defaultValidDays),
          default_conditions: defaultConditions.trim() ? defaultConditions.trim() : null,
          followup_dias: Number(followupDias),
          avisar_no_whatsapp: avisarNoWhatsapp,
        });
        toast.success(t("Configurações de propostas salvas."));
        router.refresh();
      } catch (err: unknown) {
        showApiError(err);
      }
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Propostas Comerciais")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Configure o envio de propostas, prazos de validade e termos padrão para os clientes.")}
        </p>
      </header>

      <form onSubmit={handleSalvar} className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">{t("Habilitar Propostas")}</CardTitle>
                <CardDescription>
                  {t("Ative a criação e o envio de propostas comerciais no CRM.")}
                </CardDescription>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label={t("Habilitar Propostas")}
              />
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Prazos e Regras")}</CardTitle>
            <CardDescription>
              {t("Prazos padrão aplicados ao gerar novas propostas.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="default_valid_days">{t("Validade padrão (dias)")}</Label>
              <Input
                id="default_valid_days"
                type="number"
                min={1}
                max={365}
                value={defaultValidDays}
                onChange={(e) => setDefaultValidDays(Number(e.target.value))}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="followup_dias">{t("Lembrete de follow-up (dias)")}</Label>
              <Input
                id="followup_dias"
                type="number"
                min={1}
                max={365}
                value={followupDias}
                onChange={(e) => setFollowupDias(Number(e.target.value))}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="space-y-0.5">
                <Label htmlFor="avisar_no_whatsapp">{t("Avisar no WhatsApp")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("Notificar cliente via WhatsApp quando a proposta for emitida.")}
                </p>
              </div>
              <Switch
                id="avisar_no_whatsapp"
                checked={avisarNoWhatsapp}
                onCheckedChange={setAvisarNoWhatsapp}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="default_conditions">{t("Condições e termos padrão")}</Label>
              <Textarea
                id="default_conditions"
                rows={4}
                value={defaultConditions}
                onChange={(e) => setDefaultConditions(e.target.value)}
                placeholder={t("Ex.: Condições de pagamento, prazos de entrega, validade da oferta...")}
                maxLength={4000}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button variant="outline" asChild>
            <Link href="/app/settings/tenant/proposals/modelos">
              {t("Gerenciar Modelos de Proposta")}
            </Link>
          </Button>

          <Button type="submit" disabled={isPending}>
            {isPending ? t("Salvando…") : t("Salvar")}
          </Button>
        </div>
      </form>
    </div>
  );
}
