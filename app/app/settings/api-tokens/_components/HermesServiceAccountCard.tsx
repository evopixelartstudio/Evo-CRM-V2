"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface HermesStatus {
  configured: boolean;
  service_account_name: string;
  mcp_endpoint: string;
  token: {
    id: string;
    prefix: string;
    scopes: string[];
    created_at: string;
    last_used_at: string | null;
  } | null;
  domains: Array<{ domain: string; name: string; permissions: string[] }>;
  recent_operations: Array<{
    id: string;
    action: string;
    resource_type: string;
    created_at: string;
  }>;
}

export function HermesServiceAccountCard() {
  const [status, setStatus] = useState<HermesStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionedData, setProvisionedData] = useState<{
    plaintext_token: string;
    mcp_config_snippet: unknown;
  } | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/v1/settings/hermes/status");
      if (res.ok) {
        const json = await res.json();
        setStatus(json.data);
      }
    } catch {
      // noop
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleProvision = async () => {
    try {
      setProvisioning(true);
      const res = await fetch("/api/v1/settings/hermes/provision", {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message || "Erro ao provisionar Hermes.");
        return;
      }
      setProvisionedData(json.data);
      toast.success("Credencial do Hermes provisionada com sucesso!");
      fetchStatus();
    } catch {
      toast.error("Falha na requisição de provisionamento.");
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/20 bg-card p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight">
              Hermes — Gerente Técnico EvoPixel (MCP)
            </h2>
            {status?.configured ? (
              <Badge variant="default" className="bg-emerald-600 text-white hover:bg-emerald-700">
                Operacional
              </Badge>
            ) : (
              <Badge variant="secondary">Não Configurado</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Conexão mestre via Model Context Protocol (MCP) com autonomia operacional ampla,
            auditoria universal e salvaguardas estritas de segurança.
          </p>
        </div>

        <Button
          onClick={handleProvision}
          disabled={provisioning}
          variant={status?.configured ? "outline" : "default"}
          className="w-full sm:w-auto"
        >
          {provisioning
            ? "Processando…"
            : status?.configured
              ? "Rotacionar Chave do Hermes"
              : "Configurar Acesso Hermes"}
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-xs font-medium text-muted-foreground">Endpoint MCP</div>
          <div className="mt-1 font-mono text-xs font-semibold">/api/mcp</div>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-xs font-medium text-muted-foreground">Identidade de Ator</div>
          <div className="mt-1 text-xs font-semibold">
            {status?.service_account_name || "Hermes Gerente Técnico EvoPixel"}
          </div>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-xs font-medium text-muted-foreground">Token Ativo</div>
          <div className="mt-1 font-mono text-xs font-semibold">
            {status?.token ? `${status.token.prefix}…` : "Nenhum token ativo"}
          </div>
        </div>
      </div>

      {/* Domínios e Permissões */}
      <div className="mt-6">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Domínios de Atuação Operacional (12 Áreas)
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            "Contatos e Clientes",
            "Oportunidades (Leads)",
            "Funis e Etapas",
            "Catálogo de Produtos",
            "Tarefas Operacionais",
            "Agenda e Compromissos",
            "Notas Internas (Privadas)",
            "Atendimento e Conversas",
            "Agentes de IA",
            "Automações e Gatilhos",
            "Equipe e Membros",
            "Trilha de Auditoria",
          ].map((d) => (
            <Badge key={d} variant="outline" className="text-xs bg-background/50">
              ✓ {d}
            </Badge>
          ))}
        </div>
      </div>

      {/* Salvaguardas de Segurança */}
      <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
        <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
          Salvaguardas Ativas de Segurança:
        </div>
        <ul className="mt-1.5 list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
          <li><strong>Imutabilidade:</strong> Hermes está tecnicamente impedido de alterar ou revogar a própria credencial.</li>
          <li><strong>Sigilo de Notas:</strong> Observações internas de clientes nunca são expostas em mensagens de saída.</li>
          <li><strong>Sanitização:</strong> Tokens, senhas criptografadas e segredos são mascarados em todas as saídas de ferramentas.</li>
          <li><strong>Isolamento Multi-Tenant:</strong> Toda operação é escopada exclusivamente à organização proprietária.</li>
        </ul>
      </div>

      {/* Logs Recentes */}
      {status?.recent_operations && status.recent_operations.length > 0 && (
        <div className="mt-5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Últimas Operações Executadas pelo Hermes
          </div>
          <div className="divide-y rounded-md border bg-background/50 text-xs">
            {status.recent_operations.map((op) => (
              <div key={op.id} className="flex items-center justify-between p-2">
                <span className="font-mono text-primary">{op.action}</span>
                <span className="text-muted-foreground">
                  {new Date(op.created_at).toLocaleString("pt-BR")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de Exibição da Chave Gerada */}
      <Dialog open={!!provisionedData} onOpenChange={() => setProvisionedData(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Credencial do Hermes MCP Gerada</DialogTitle>
            <DialogDescription>
              Copie o token e a configuração abaixo. Por motivos de segurança, esta chave
              <strong> nunca mais será exibida</strong>.
            </DialogDescription>
          </DialogHeader>

          {provisionedData && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold">Token de Acesso (Bearer)</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    readOnly
                    value={provisionedData.plaintext_token}
                    className="w-full rounded border bg-muted p-2 font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      copyToClipboard(provisionedData.plaintext_token);
                      toast.success("Token copiado!");
                    }}
                  >
                    Copiar
                  </Button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold">Configuração MCP (mcpServers)</label>
                <pre className="mt-1 max-h-48 overflow-auto rounded border bg-muted p-3 font-mono text-xs">
                  {JSON.stringify(provisionedData.mcp_config_snippet, null, 2)}
                </pre>
                <div className="mt-1 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      copyToClipboard(JSON.stringify(provisionedData.mcp_config_snippet, null, 2));
                      toast.success("Configuração copiada!");
                    }}
                  >
                    Copiar JSON
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setProvisionedData(null)}>Concluir e Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

