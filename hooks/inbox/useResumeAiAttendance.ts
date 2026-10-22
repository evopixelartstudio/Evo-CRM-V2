"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

interface ResumeArgs {
  conversation_id: string;
  agent_id?: string | null;
  context_note?: string | null;
  objective?: string | null;
  summary?: string | null;
}

/** O que a pessoa fez, devolvido junto com o controle — nunca só o controle. */
export interface ContinuidadeDaRetomada {
  houve_atendimento_humano: boolean;
  resumo: string;
  decisoes: number;
  notas: number;
}

interface ResumeResponse {
  data: { reactivated: boolean; continuidade: ContinuidadeDaRetomada };
}

/**
 * Devolve a conversa ao atendimento automático com suporte a escolha de agente,
 * contexto personalizado e objetivo da transferência.
 */
export function useResumeAiAttendance() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: ResumeArgs) =>
      apiClient.post<ResumeResponse>(
        `/api/v1/conversations/${args.conversation_id}/reactivate-bot`,
        {
          agent_id: args.agent_id ?? null,
          context_note: args.context_note ?? null,
          objective: args.objective ?? null,
          summary: args.summary ?? null,
        },
      ),
    onError: (err) => showApiError(err),
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
      qc.invalidateQueries({ queryKey: ["conversation-counts"] });
    },
  });
}
