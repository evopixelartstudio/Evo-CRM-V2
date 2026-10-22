"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api/client";
import { formatValorDoNegocio, MOEDA_PADRAO } from "@/lib/money";
import { rotuloDoMotivoDePerda } from "@/lib/schemas/leads";
import type { Lead } from "@/lib/types/leads";
import { LeadDossier } from "./LeadDossier";
import type { Stage } from "@/lib/kanban/types";
import { ArrowsClockwise, ClockCounterClockwise, MagnifyingGlass } from "@/lib/ui/icons";

interface ArchivedLeadItem {
  id: string;
  title: string;
  status: "lost" | "won" | "archived";
  value_cents: number | null;
  currency: string;
  closed_at: string;
  created_at: string;
  lost_reason: string | null;
  won_reason: string | null;
  closure_notes: string | null;
  closure_reason: string | null;
  contact: {
    id: string;
    name: string | null;
    company: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  stage_name: string;
  owner_name: string;
}

interface ArchivedApiResponse {
  items: ArchivedLeadItem[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

interface Props {
  pipelineId: string;
  stages: Stage[];
  onReativado?: () => void;
}

export function ArquivadosTable({ pipelineId, stages, onReativado }: Props) {
  const t = useT();

  const [items, setItems] = useState<ArchivedLeadItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  // Filtros
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Ações
  const [dossierState, setDossierState] = useState<{
    lead: Lead;
    stageName: string;
  } | null>(null);
  const [leadToReactivate, setLeadToReactivate] = useState<ArchivedLeadItem | null>(null);
  const [reactivateStageId, setReactivateStageId] = useState("");
  const [reactivateNotes, setReactivateNotes] = useState("");
  const [isReactivating, setIsReactivating] = useState(false);

  // Etapas ativas para retorno
  const activeStages = useMemo(
    () => stages.filter((s) => !s.is_won && !s.is_lost && !s.is_archived),
    [stages],
  );

  const fetchArchived = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("per_page", "20");
      if (search.trim()) params.set("q", search.trim());
      if (reasonFilter !== "all") params.set("reason", reasonFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await apiClient.get<ArchivedApiResponse>(
        `/api/v1/pipelines/${pipelineId}/archived?${params.toString()}`,
      );

      if (res?.items) {
        setItems(res.items);
        setTotal(res.total);
        setTotalPages(res.total_pages);
      }
    } catch (err) {
      console.error("Erro ao carregar leads arquivados:", err);
    } finally {
      setIsLoading(false);
    }
  }, [pipelineId, page, search, reasonFilter, statusFilter]);

  useEffect(() => {
    fetchArchived();
  }, [fetchArchived]);

  const handleOpenDossier = async (item: ArchivedLeadItem) => {
    try {
      const res = await apiClient.get<Lead>(`/api/v1/leads/${item.id}`);
      if (res) {
        setDossierState({ lead: res, stageName: item.stage_name });
      }
    } catch (err) {
      console.error("Erro ao carregar dossiê do lead:", err);
    }
  };

  const handleOpenReactivate = (lead: ArchivedLeadItem) => {
    setLeadToReactivate(lead);
    setReactivateStageId(activeStages[0]?.id ?? "");
    setReactivateNotes("");
  };

  const handleConfirmReactivate = async () => {
    if (!leadToReactivate || !reactivateStageId) return;
    setIsReactivating(true);
    try {
      await apiClient.post(`/api/v1/leads/${leadToReactivate.id}/reactivate`, {
        stage_id: reactivateStageId,
        notes: reactivateNotes.trim() || undefined,
      });
      setLeadToReactivate(null);
      await fetchArchived();
      onReativado?.();
    } catch (err) {
      console.error("Erro ao reativar lead:", err);
    } finally {
      setIsReactivating(false);
    }
  };

  const formatData = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden">
      {/* Barra de Filtros */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-3 shadow-xs">
        <div className="relative min-w-[220px] flex-1">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder={t("Buscar por oportunidade ou contato...")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9 text-sm"
          />
        </div>

        <div className="w-[180px]">
          <Select
            value={reasonFilter}
            onValueChange={(val) => {
              setReasonFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="text-xs">
              <SelectValue placeholder={t("Motivo")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Todos os motivos")}</SelectItem>
              <SelectItem value="sem_interesse">{t("Sem interesse")}</SelectItem>
              <SelectItem value="sem_resposta">{t("Sem resposta após follow-ups")}</SelectItem>
              <SelectItem value="numero_invalido">{t("Número inválido")}</SelectItem>
              <SelectItem value="servico_incompativel">{t("Serviço incompatível")}</SelectItem>
              <SelectItem value="contato_duplicado">{t("Contato duplicado")}</SelectItem>
              <SelectItem value="price">{t("Preço")}</SelectItem>
              <SelectItem value="other">{t("Outro motivo")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-[160px]">
          <Select
            value={statusFilter}
            onValueChange={(val) => {
              setStatusFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="text-xs">
              <SelectValue placeholder={t("Desfecho")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Todos os desfechos")}</SelectItem>
              <SelectItem value="lost">{t("Perdidos / Encerrados")}</SelectItem>
              <SelectItem value="won">{t("Ganhos")}</SelectItem>
              <SelectItem value="archived">{t("Arquivados")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchArchived()}
          disabled={isLoading}
          title={t("Atualizar")}
        >
          <ArrowsClockwise size={14} className={isLoading ? "animate-spin" : ""} />
        </Button>
      </div>

      {/* Tabela de Leads */}
      <div className="flex-1 overflow-auto rounded-lg border bg-surface shadow-xs">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 border-b bg-muted/60 text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-3">{t("Oportunidade / Contato")}</th>
              <th className="px-4 py-3">{t("Empresa")}</th>
              <th className="px-4 py-3">{t("Desfecho e Motivo")}</th>
              <th className="px-4 py-3">{t("Etapa")}</th>
              <th className="px-4 py-3">{t("Data de Encerramento")}</th>
              <th className="px-4 py-3">{t("Responsável")}</th>
              <th className="px-4 py-3 text-right">{t("Valor")}</th>
              <th className="px-4 py-3 text-center">{t("Ações")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                  <div className="flex items-center justify-center gap-2">
                    <ArrowsClockwise size={16} className="animate-spin text-accent" />
                    {t("Carregando oportunidades arquivadas...")}
                  </div>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                  {t("Nenhuma oportunidade arquivada encontrada com os filtros selecionados.")}
                </td>
              </tr>
            ) : (
              items.map((lead) => {
                const isWon = lead.status === "won";
                const motivoExibido = lead.closure_reason ?? lead.lost_reason ?? lead.won_reason;

                return (
                  <tr key={lead.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-text">{lead.title}</div>
                      {lead.contact?.name && (
                        <div className="text-xs text-muted-foreground">
                          {lead.contact.name}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-text-muted">
                      {lead.contact?.company || "—"}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isWon
                              ? "bg-success/15 text-success"
                              : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {isWon ? t("Ganho") : t("Encerrado")}
                        </span>
                        {motivoExibido && (
                          <span className="text-xs text-text-muted">
                            {t(rotuloDoMotivoDePerda(motivoExibido))}
                          </span>
                        )}
                        {lead.closure_notes && (
                          <span
                            className="max-w-[200px] truncate text-[11px] italic text-muted-foreground"
                            title={lead.closure_notes}
                          >
                            “{lead.closure_notes}”
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-text-muted">
                      {lead.stage_name}
                    </td>

                    <td className="px-4 py-3 text-xs tabular-nums text-text-muted">
                      {formatData(lead.closed_at)}
                    </td>

                    <td className="px-4 py-3 text-xs text-text-muted">
                      {lead.owner_name}
                    </td>

                    <td className="px-4 py-3 text-right font-medium tabular-nums text-text">
                      {lead.value_cents != null
                        ? formatValorDoNegocio(lead.value_cents, lead.currency ?? MOEDA_PADRAO)
                        : "—"}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => handleOpenDossier(lead)}
                          title={t("Visualizar histórico completo")}
                        >
                          <ClockCounterClockwise size={14} className="mr-1" />
                          {t("Histórico")}
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs text-accent hover:text-accent"
                          onClick={() => handleOpenReactivate(lead)}
                          title={t("Reativar lead no funil ativo")}
                        >
                          <ArrowsClockwise size={14} className="mr-1" />
                          {t("Reativar")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 text-xs text-muted-foreground">
          <div>
            {t("Total de oportunidades:")}{" "}
            <span className="font-medium text-text">{total}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("Anterior")}
            </Button>
            <span>
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {t("Próximo")}
            </Button>
          </div>
        </div>
      )}

      {/* Modal de Reativação */}
      <Dialog
        open={!!leadToReactivate}
        onOpenChange={(open) => !open && setLeadToReactivate(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Reativar Oportunidade")}</DialogTitle>
            <DialogDescription>
              {t("Escolha em qual etapa do funil ativo a oportunidade deve retornar.")}
            </DialogDescription>
          </DialogHeader>

          {leadToReactivate && (
            <div className="grid gap-4 py-2">
              <div className="rounded-md bg-muted/40 p-3 text-xs">
                <div className="font-semibold text-text">{leadToReactivate.title}</div>
                {leadToReactivate.contact?.name && (
                  <div className="text-muted-foreground">
                    {leadToReactivate.contact.name}
                  </div>
                )}
              </div>

              <div className="grid gap-1.5">
                <Label>{t("Etapa de Destino")}</Label>
                <Select
                  value={reactivateStageId}
                  onValueChange={setReactivateStageId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("Selecione uma etapa...")} />
                  </SelectTrigger>
                  <SelectContent>
                    {activeStages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="reactivate-notes">{t("Observações da Reativação (opcional)")}</Label>
                <Textarea
                  id="reactivate-notes"
                  value={reactivateNotes}
                  onChange={(e) => setReactivateNotes(e.target.value)}
                  placeholder={t("Motivo da reativação ou novo contexto comercial...")}
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLeadToReactivate(null)}
              disabled={isReactivating}
            >
              {t("Cancelar")}
            </Button>
            <Button
              onClick={handleConfirmReactivate}
              disabled={!reactivateStageId || isReactivating}
            >
              {isReactivating ? t("Reativando...") : t("Confirmar Reativação")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dossiê Lateral do Lead */}
      {dossierState && (
        <LeadDossier
          lead={dossierState.lead}
          open={!!dossierState}
          onOpenChange={(open) => !open && setDossierState(null)}
          pipelineId={pipelineId}
          stageName={dossierState.stageName}
        />
      )}
    </div>
  );
}
