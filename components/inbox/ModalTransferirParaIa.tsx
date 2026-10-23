"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useResumeAiAttendance } from "@/hooks/inbox/useResumeAiAttendance";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Robot, Sparkle, Warning, CircleNotch } from "@/lib/ui/icons";
import { toast } from "sonner";

interface AssignableAgent {
  agent_id: string;
  name: string;
  version_number: number | null;
}

interface ModalTransferirParaIaProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactName?: string | null;
  activeAgentId?: string | null;
}

const OBJETIVOS_PADRAO = [
  "Continuar atendimento",
  "Tirar dúvidas",
  "Qualificar lead",
  "Realizar follow-up",
  "Atendimento pós-venda",
  "Outro objetivo",
] as const;

export function ModalTransferirParaIa({
  open,
  onOpenChange,
  conversationId,
  contactName,
  activeAgentId,
}: ModalTransferirParaIaProps) {
  const t = useT();
  const retomar = useResumeAiAttendance();

  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [contextNote, setContextNote] = useState<string>("");
  const [objective, setObjective] = useState<string>("Continuar atendimento");
  const [summary, setSummary] = useState<string>("");
  const [gerandoResumo, setGerandoResumo] = useState<boolean>(false);

  // Busca agentes reais habilitados e disponíveis para atribuição nesta org
  const { data: agentsData, isLoading: loadingAgents } = useQuery({
    queryKey: ["assignable-ai-agents"],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { agents: AssignableAgent[] } }>(
        "/api/v1/ai/agents/assignable",
      );
      return res.data.agents ?? [];
    },
    enabled: open,
  });

  const agents = agentsData ?? [];

  // Seleciona o agente ativo ou o primeiro disponível ao abrir
  useEffect(() => {
    if (!open) return;
    if (activeAgentId && agents.some((a) => a.agent_id === activeAgentId)) {
      setSelectedAgentId(activeAgentId);
    } else if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0]?.agent_id ?? "");
    }
  }, [open, activeAgentId, agents, selectedAgentId]);

  // Limpa campos ao fechar
  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setContextNote("");
      setSummary("");
      setObjective("Continuar atendimento");
    }
    onOpenChange(nextOpen);
  };

  // Gerar resumo automático do histórico recente
  async function handleGerarResumo() {
    setGerandoResumo(true);
    try {
      const res = await apiClient.post<{ data: { summary: string } }>(
        `/api/v1/conversations/${conversationId}/summarize`,
        {},
      );
      if (res.data?.summary) {
        setSummary(res.data.summary);
        toast.success(t("Resumo da conversa gerado com sucesso."));
      }
    } catch (err) {
      showApiError(err);
    } finally {
      setGerandoResumo(false);
    }
  }

  // Executar transferência
  async function handleConfirmar() {
    if (!selectedAgentId) {
      toast.error(t("Selecione um agente de IA para assumir o atendimento."));
      return;
    }

    try {
      await retomar.mutateAsync({
        conversation_id: conversationId,
        agent_id: selectedAgentId,
        context_note: contextNote.trim() || null,
        objective: objective.trim() || null,
        summary: summary.trim() || null,
      });

      toast.success(t("Atendimento transferido para a IA com sucesso."));
      handleClose(false);
    } catch {
      // Erro já tratado pelo hook
    }
  }

  const semAgentes = !loadingAgents && agents.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg sm:max-w-xl" data-testid="modal-transferir-para-ia">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Robot size={20} className="text-primary" aria-hidden />
            {t("Transferir atendimento para IA")}
          </DialogTitle>
          <DialogDescription>
            {contactName
              ? t(`Defina as instruções para o agente de IA que continuará o atendimento de ${contactName}.`)
              : t("Defina as instruções para o agente de IA que continuará o atendimento.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Campo 1 — Selecionar agente */}
          <div className="space-y-1.5">
            <Label htmlFor="select-agente-ia" className="text-xs font-semibold">
              {t("Selecionar agente")} <span className="text-destructive">*</span>
            </Label>

            {loadingAgents ? (
              <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                <CircleNotch size={16} className="animate-spin" />
                {t("Carregando agentes disponíveis…")}
              </div>
            ) : semAgentes ? (
              <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                <Warning size={16} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">{t("Nenhum agente de IA ativo disponível")}</p>
                  <p className="mt-0.5 text-muted-foreground">
                    {t(
                      "É necessário ter pelo menos um agente com versão publicada e não pausado na organização para transferir o atendimento.",
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger id="select-agente-ia" className="w-full">
                  <SelectValue placeholder={t("Escolha um agente…")} />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.agent_id} value={agent.agent_id}>
                      {agent.name} {agent.version_number ? `(v${agent.version_number})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Campo 3 — Objetivo da transferência */}
          <div className="space-y-1.5">
            <Label htmlFor="select-objetivo-transferencia" className="text-xs font-semibold">
              {t("Objetivo da transferência")}
            </Label>
            <Select value={objective} onValueChange={setObjective}>
              <SelectTrigger id="select-objetivo-transferencia" className="w-full">
                <SelectValue placeholder={t("Selecione o objetivo principal…")} />
              </SelectTrigger>
              <SelectContent>
                {OBJETIVOS_PADRAO.map((obj) => (
                  <SelectItem key={obj} value={obj}>
                    {t(obj)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Campo 2 — Contexto para o agente */}
          <div className="space-y-1.5">
            <Label htmlFor="contexto-agente-ia" className="text-xs font-semibold">
              {t("O que o agente precisa saber?")}
            </Label>
            <Textarea
              id="contexto-agente-ia"
              value={contextNote}
              onChange={(e) => setContextNote(e.target.value)}
              placeholder={t(
                "Explique o que já foi conversado, quais decisões foram tomadas e o que a IA deve fazer a partir de agora.",
              )}
              rows={3}
              maxLength={2000}
              className="resize-y text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              {t(
                "Instrução interna para a IA. O cliente nunca visualiza este texto diretamente.",
              )}
            </p>
          </div>

          {/* Campo 4 — Resumo da conversa */}
          <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                {t("Resumo da conversa")}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={gerandoResumo}
                onClick={handleGerarResumo}
              >
                {gerandoResumo ? (
                  <>
                    <CircleNotch size={12} className="animate-spin" />
                    {t("Gerando…")}
                  </>
                ) : (
                  <>
                    <Sparkle size={12} className="text-primary" />
                    {t("Gerar Resumo da Conversa")}
                  </>
                )}
              </Button>
            </div>

            {summary ? (
              <div className="mt-2 space-y-1">
                <Textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={4}
                  className="bg-background text-xs"
                  placeholder={t("Resumo gerado das últimas mensagens…")}
                />
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t(
                  "Clique no botão acima para sintetizar os pontos principais, pendências e solicitações das mensagens recentes.",
                )}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={retomar.isPending}
            onClick={() => handleClose(false)}
          >
            {t("Cancelar")}
          </Button>
          <Button
            type="button"
            variant="default"
            disabled={semAgentes || !selectedAgentId || retomar.isPending}
            onClick={handleConfirmar}
            data-testid="confirmar-transferencia-ia"
          >
            {retomar.isPending ? (
              <>
                <CircleNotch size={14} className="mr-1.5 animate-spin" />
                {t("Transferindo…")}
              </>
            ) : (
              t("Confirmar transferência")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}