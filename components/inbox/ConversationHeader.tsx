"use client";
import { useState, type RefObject } from "react";
import { useT } from "@/hooks/i18n/useT";
import Link from "next/link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { JanelaSelo } from "@/components/inbox/JanelaSelo";
import { ChannelLogo } from "@/components/inbox/ChannelLogo";
import { Phone, ArrowRight, MagnifyingGlass, DotsThree, IdentificationCard } from "@/lib/ui/icons";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModalTransferirParaIa } from "./ModalTransferirParaIa";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useClaimConversation } from "@/hooks/inbox/useClaimConversation";
import { useReleaseConversation } from "@/hooks/inbox/useReleaseConversation";
import {
  useMarkPersonalContact,
  useUnmarkPersonalContact,
} from "@/hooks/contacts/usePersonalContact";
import { ROLE_RANK } from "@/lib/auth/types";
import {
  useArchiveConversation,
  useCloseConversation,
  useReopenConversation,
} from "@/hooks/inbox/useCloseConversation";
import { useResumeAiAttendance } from "@/hooks/inbox/useResumeAiAttendance";
import { usePauseAiAttendance } from "@/hooks/inbox/usePauseAiAttendance";
import { useAutomaticoAtivo } from "@/hooks/ai/useAutomaticoAtivo";
import { OwnerBadge } from "@/components/kanban/OwnerBadge";
import { FaixaDaCarteira } from "@/components/inbox/FaixaDaCarteira";
import { comandoDaConversa, ROTULO_DO_MOTIVO } from "@/lib/inbox/comando-da-conversa";
import { ReassignDialog } from "@/components/inbox/ReassignDialog";
import { SnoozeButton } from "@/components/inbox/SnoozeButton";
import { DialButton } from "@/components/voice/DialButton";
import { VideoCallButton } from "@/components/inbox/VideoCallButton";
import { motivoDoContato } from "@/lib/inbox/motivo-do-envio-bloqueado";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import { rotuloParaAEquipe } from "@/lib/contacts/rotulo-do-contato";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { rotuloDoCanalDaConversa } from "@/lib/channels/estado";

interface Props {
  conversation: ConversationWithContact;
  /**
   * A busca DENTRO da conversa (#1793): abre um campo que filtra só as
   * mensagens já carregadas. O ref devolve o foco a este botão quando o campo
   * fecha — senão o Esc largava o foco no `body`.
   */
  onBuscar?: () => void;
  buscaAberta?: boolean;
  botaoBuscaRef?: RefObject<HTMLButtonElement | null>;
  /** Seleciona outra conversa no Inbox — a aba Número do Transferir abre a do outro número. */
  onAbrirConversa?: (id: string) => void;
  /** Alterna o recolhimento do painel lateral de CRM/dados do contato */
  onAlternarPainelDoContato?: () => void;
  painelRecolhido?: boolean;
}

/**
 * O CHIP NOMEIA CICLO DE VIDA, NÃO COMANDO.
 *
 * Ele afirmava quem manda — "Automático atendendo", "Aguardando atendente" — a
 * 20px de um selo que responde a MESMA pergunta por outra fonte, e as duas se
 * contradiziam na tela: `conversations.status` não acompanha silêncio, trava de
 * contato nem atribuição, e o motor nunca o lê. Medido em 2026-08-30 num print
 * do dono: "Aguardando atendente" e "Automático" no mesmo cabeçalho.
 *
 * Quem responde "quem manda" é o `OwnerBadge`, que vem de `comandoDaConversa`.
 * Aqui fica só o que o status realmente sabe: o episódio está aberto ou acabou.
 *
 * Cobre os SETE valores do CHECK de propósito — o call site é
 * `t(STATUS_LABEL[status] ?? status)`, e um buraco imprime o token cru em inglês
 * no rosto do atendente. Vigiado pelo invariante de espelho.
 */
const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  pending: "Aberta",
  claimed: "Aberta",
  ai_handling: "Aberta",
  resolved: "Resolvida",
  closed: "Fechada",
  archived: "Arquivada",
};

export function ConversationHeader({
  conversation,
  onAbrirConversa,
  onBuscar,
  buscaAberta,
  botaoBuscaRef,
  onAlternarPainelDoContato,
  painelRecolhido,
}: Props) {
  const t = useT();
  const { user, activeOrg } = useAuth();
  const claim = useClaimConversation();
  const release = useReleaseConversation();
  const close = useCloseConversation();
  const reopen = useReopenConversation();
  const arquivar = useArchiveConversation();
  const retomar = useResumeAiAttendance();
  const pausar = usePauseAiAttendance();
  // "Existe automático nesta org?" — sem isto o selo afirmava que o robô estava
  // atendendo em instalação que nunca configurou agente nenhum.
  const automaticoDaOrg = useAutomaticoAtivo();
  const [reassignOpen, setReassignOpen] = useState(false);
  const [confirmFecharOpen, setConfirmFecharOpen] = useState(false);
  const [confirmArquivarOpen, setConfirmArquivarOpen] = useState(false);
  const [confirmPessoalOpen, setConfirmPessoalOpen] = useState(false);
  const [transferIaOpen, setTransferIaOpen] = useState(false);

  const c = conversation.contacts ?? null;
  const displayName = rotuloParaAEquipe(c, t);
  /**
   * POR ONDE ESTA CONVERSA ENTROU — o mesmo rótulo da lista e da tela de
   * canais (#2383). `null` quando não há canal, e aí o badge não existe.
   */
  const rotuloCanal = rotuloDoCanalDaConversa(conversation.channel_sessions, t);
  const phone = c?.phone_number ? phoneForDisplay(c.phone_number) : null;
  const status = conversation.status;
  const isMineAssigned = conversation.assigned_to_user_id === user.id;
  const isOpen = status === "open" || conversation.assigned_to_user_id == null;

  // Marcar/desmarcar pessoal (spec 21, etapa 15 — botão no cabeçalho).
  //
  // GERENTE pode (spec decisão 1, D3): pessoal é decisão operacional — esconder
  // uma conversa da operação. Desbloquear exige ADMIN porque reabre um canal
  // que o cliente fechou (direito do titular, LGPD): dois gestos parecidos,
  // dois gates diferentes, cada um com seu motivo.
  //
  // Os hooks ficam AQUI, antes de qualquer early return (a ordem dos hooks não
  // pode mudar entre renderizações); com contato ausente o id vazio nunca
  // dispara porque o botão nem é desenhado.
  const ehPessoal = c?.is_personal === true;
  const podeMarcarPessoal =
    (user.is_platform_admin && !user.support) ||
    (activeOrg != null && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager);
  const marcarPessoal = useMarkPersonalContact(c?.id ?? "");
  const desmarcarPessoal = useUnmarkPersonalContact(c?.id ?? "");

  /**
   * QUEM MANDA, uma pergunta com uma resposta.
   *
   * Este bloco era três leituras parciais. O selo e o botão de volta liam duas
   * travas (`bot_silenced_until || force_human`); a linha da lista lia uma, por
   * COR; o painel não lia nenhuma. Desde a 0173 há uma quarta situação —
   * "alguém assumiu" — e continuar somando condições à mão aqui é como as três
   * leituras divergiram em primeiro lugar. A regra mora em `lib/inbox`,
   * espelhando os gates que o MOTOR lê, e esta tela só a consome.
   */
  const fatosDoComando = {
    status,
    assigned_to_user_id: conversation.assigned_to_user_id,
    assigned_to_user_name: conversation.assigned_to_user_name ?? null,
    assignee_kind: conversation.assignee_kind ?? null,
    bot_silenced_until: conversation.bot_silenced_until ?? null,
    last_handoff_reason: conversation.last_handoff_reason ?? null,
    force_human: c?.force_human ?? null,
    is_blocked: conversation.contacts?.is_blocked ?? null,
    is_group: conversation.is_group ?? false,
    automaticoDaOrg: automaticoDaOrg.data,
  };
  const { comando, automaticoAtivo, travaVigente, motivo } = comandoDaConversa(fatosDoComando);
  /**
   * O QUE "LIBERAR" FAZ DEPENDE DO ESTADO, e a guia do botão (#3003) não pode
   * prometer o automático de volta quando ele não volta.
   *
   * `fn_conversation_assign` com dono `null` deixa a conversa aberta e sem dono,
   * mas só limpa `bot_silenced_until` quando NÃO houve escalação
   * (`last_handoff_at is null`). Depois de uma escalação, com o contato travado
   * (`force_human`), descadastrado, em grupo ou numa org sem automático, a
   * conversa cai na fila esperando gente. A pergunta é a mesma regra de quem
   * manda, aplicada ao estado que a RPC vai gravar.
   */
  const _liberarDevolveAoAutomatico =
    comandoDaConversa({
      ...fatosDoComando,
      status: "open",
      assigned_to_user_id: null,
      assigned_to_user_name: null,
      assignee_kind: null,
      bot_silenced_until: conversation.last_handoff_at ? fatosDoComando.bot_silenced_until : null,
    }).comando.quem === "automatico";

  const encerrada = status === "closed" || status === "archived" || status === "resolved";
  /**
   * A VOLTA aparece sempre que há algo a devolver — inclusive em conversa
   * ENCERRADA. Antes ela era condicionada a `status !== "closed"`, e o resultado
   * era um beco sem saída medido: atendente assume, fecha, sai de férias; a
   * conversa fica com o automático parado e, para qualquer colega, sem NENHUMA
   * porta — "Liberar" só existe para o próprio dono e a rota recusa quem não é.
   * `devolverAtendimentoAoAgente` funciona nesse estado (o status fechado está na
   * lista de reativáveis), então esconder o botão escondia uma ação que existe.
   *
   * A condição é `travaVigente`, e NÃO `!automaticoAtivo`: conversa encerrada tem
   * o automático inativo sem ter trava nenhuma, e sair do segundo faria o botão
   * aparecer em toda conversa fechada — clicá-lo REABRIRIA uma conversa que
   * ninguém pediu para reabrir. Oferecer uma ação que não deveria acontecer é
   * pior que não oferecer nenhuma.
   */
  const podeDevolver = travaVigente;
  /**
   * PAUSAR só aparece quando pausar é um gesto DIFERENTE de assumir.
   *
   * Desde a 0173 "Assumir" já cala o automático (a RPC grava o silêncio). Numa
   * conversa sem dono, portanto, "Assumir" e "Pausar o automático" teriam
   * exatamente o mesmo efeito — dois botões para um ato é a confusão que esta
   * entrega existe para acabar, não para dobrar.
   *
   * Sobra o caso em que ele é próprio: a conversa JÁ tem dono e o automático
   * continua de pé. Isso é real e não é raro — o rodízio (`reason='routing'`)
   * distribui sem calar, de propósito, senão uma org em round_robin ficaria sem
   * automático nenhum.
   */
  const podePausar =
    automaticoAtivo && !encerrada && conversation.assigned_to_user_id !== null;

  if (user.support?.access_mode === "support_readonly") return <header className="flex items-center justify-between border-b p-4">
    <strong>{displayName}</strong><span className="text-sm text-muted-foreground">{STATUS_LABEL[status] ?? status} · Somente leitura</span>
  </header>;
  return (
    // `flex-wrap` porque este header travava a LARGURA DA TELA INTEIRA. Ele
    // media 707px de `min-content` — a identidade do contato encolhia bem
    // (`min-w-0` + `truncate`), mas a barra de ações era `shrink-0` e não
    // quebrava. Como a coluna do meio do inbox é `1fr`, que é
    // `minmax(auto, 1fr)`, ela não podia ficar menor que esses 707px, e o
    // painel de CRM era empurrado 311px para fora da viewport em 1280px.
    //
    // Reorganizar em vez de esconder: acima de ~1440px o header fica IDÊNTICO ao
    // de antes (uma linha), e quando aperta a barra desce para a linha de baixo.
    // Nenhuma ação some — um menu "mais" esconderia o "Lembrar" que a spec
    // `canais-baseline` clica, e, pior, esconderia ação de quem atende.
    //
    // NO CELULAR a quebra vira o problema oposto: com ~390px de largura a barra
    // descia em três ou quatro fileiras de botões e comia metade da tela,
    // deixando quase nada para as mensagens. Abaixo do `md` a barra é UMA
    // fileira que rola na horizontal — a mesma régua de não esconder ação, sem
    // pagar em altura. `py-2` pelo mesmo motivo: cada pixel de altura ali é
    // tirado da conversa.
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-3 py-2 md:gap-3 md:px-4 md:py-3">
      {/* FAIXA DA CARTEIRA (#2591, regra 2) */}
      {c?.id && (
        <FaixaDaCarteira contactId={c.id} quemAtendeId={conversation.assigned_to_user_id} />
      )}
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <ChannelLogo channel={conversation.channel_sessions} size={18} />
            <h2 className="min-w-0 truncate text-sm font-semibold" title={displayName}>{displayName}</h2>
            <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px]">
              {t(STATUS_LABEL[status] ?? status)}
            </Badge>
            <JanelaSelo
              provider={conversation.channel_sessions?.provider ?? null}
              lastInboundAt={conversation.last_inbound_at}
            />
            {rotuloCanal && (
              <Badge
                variant="outline"
                className="h-4 min-w-0 max-w-[9rem] truncate px-1.5 text-[10px]"
                title={`${t("Entrou por")} ${rotuloCanal}`}
                data-testid="canal-da-conversa"
              >
                <span className="truncate">{rotuloCanal}</span>
              </Badge>
            )}
          </div>

          <div className="mt-0.5 flex items-center gap-2" data-testid="comando-da-conversa">
            {comando.quem === "humano" ? (
              <OwnerBadge ownerKind="user" ownerName={comando.nome ?? t("Atendente")} />
            ) : comando.quem === "automatico" ? (
              <OwnerBadge ownerKind="ai" ownerName={t("Automático")} />
            ) : (
              <OwnerBadge ownerKind={null} ownerName={null} />
            )}
            {phone && (
              <p className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                <Phone size={11} weight="regular" aria-hidden /> {phone}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col items-end gap-1 max-md:w-full max-md:items-stretch">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 max-md:flex-nowrap max-md:overflow-x-auto max-md:pb-1 max-md:[&>*]:shrink-0">
          {/* AÇÃO PRINCIPAL 1: Assumir */}
          {isOpen && (
            <Button
              size="sm"
              variant="default"
              disabled={claim.isPending}
              title={t("Você passa a responder esta conversa e o atendimento automático para aqui.")}
              onClick={() =>
                claim.mutate({
                  conversation_id: conversation.id,
                  expected_assignee: conversation.assigned_to_user_id,
                })
              }
            >
              {t("Assumir")}
            </Button>
          )}

          {/* AÇÃO PRINCIPAL 2: Devolver à IA / Devolver ao automático */}
          {podeDevolver && (
            <Button
              size="sm"
              variant="default"
              disabled={retomar.isPending}
              data-testid="devolver-ao-automatico"
              title={
                motivo === "contato_travado"
                  ? t("Religa o atendimento automático para este cliente — vale para todas as conversas dele.")
                  : t("Devolve esta conversa ao atendimento automático.")
              }
              onClick={() => setTransferIaOpen(true)}
            >
              {retomar.isPending ? t("Devolvendo...") : t("Devolver ao automático")}
            </Button>
          )}

          {/* BOTÃO DA FICHA DO CONTATO (TOGGLE DO PAINEL DIREITO) */}
          {onAlternarPainelDoContato && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              title={painelRecolhido ? t("Expandir painel do contato") : t("Recolher painel do contato")}
              aria-label={t("Ficha do contato")}
              data-testid="botao-toggle-painel-contato"
              onClick={onAlternarPainelDoContato}
            >
              <IdentificationCard size={15} aria-hidden />
              <span className="hidden sm:inline">{t("Ficha")}</span>
            </Button>
          )}

          {/* Busca na conversa */}
          {onBuscar && (
            <Button
              ref={botaoBuscaRef}
              size="sm"
              variant="ghost"
              className="w-11 px-0 lg:w-8"
              onClick={onBuscar}
              aria-label={t("Buscar nesta conversa")}
              title={t("Buscar nesta conversa")}
              aria-expanded={buscaAberta}
            >
              <MagnifyingGlass size={16} aria-hidden />
            </Button>
          )}

          {/* Chamadas */}
          {!conversation.is_group && c?.id && (
            <DialButton contactId={c.id} hasPhone={!!c.phone_number} />
          )}
          <VideoCallButton
            conversationId={conversation.id}
            provider={conversation.channel_sessions?.provider ?? null}
            lastInboundAt={conversation.last_inbound_at}
            bloqueio={motivoDoContato(c, t)}
            encerrada={status === "closed"}
          />

          {/* MENU CONTEXTUAL DE AÇÕES SECUNDÁRIAS */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 px-0"
                aria-label={t("Mais opções")}
                title={t("Mais opções")}
                data-testid="menu-acoes-secundarias"
              >
                <DotsThree size={16} weight="bold" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {!encerrada && (
                <DropdownMenuItem
                  onClick={() => setReassignOpen(true)}
                  className="cursor-pointer text-xs"
                >
                  <ArrowRight size={14} className="mr-2" />
                  {t("Transferir")}
                </DropdownMenuItem>
              )}

              {isMineAssigned && (
                <DropdownMenuItem
                  onClick={() => release.mutate({ conversation_id: conversation.id })}
                  className="cursor-pointer text-xs"
                >
                  {t("Liberar")}
                </DropdownMenuItem>
              )}

              {podePausar && (
                <DropdownMenuItem
                  onClick={() => pausar.mutate({ conversation_id: conversation.id })}
                  className="cursor-pointer text-xs"
                  data-testid="pausar-o-automatico"
                >
                  {t("Pausar o automático")}
                </DropdownMenuItem>
              )}

              {!encerrada && (
                <div className="px-2 py-1.5 text-xs">
                  <SnoozeButton
                    conversationId={conversation.id}
                    snoozeUntil={conversation.snooze_until ?? null}
                  />
                </div>
              )}

              <DropdownMenuSeparator />

              {!encerrada ? (
                <DropdownMenuItem
                  onClick={() => setConfirmFecharOpen(true)}
                  className="cursor-pointer text-xs"
                >
                  {t("Fechar")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() =>
                    reopen.mutate({
                      conversation_id: conversation.id,
                      expected_revision: conversation.service_revision,
                    })
                  }
                  className="cursor-pointer text-xs"
                >
                  {t("Reabrir")}
                </DropdownMenuItem>
              )}

              {status !== "archived" && (
                <DropdownMenuItem
                  onClick={() => setConfirmArquivarOpen(true)}
                  className="cursor-pointer text-xs"
                >
                  {t("Arquivar")}
                </DropdownMenuItem>
              )}

              {podeMarcarPessoal && c?.id && (
                <>
                  <DropdownMenuSeparator />
                  {!ehPessoal ? (
                    <DropdownMenuItem
                      onClick={() => setConfirmPessoalOpen(true)}
                      className="cursor-pointer text-xs"
                      data-testid="marcar-pessoal"
                    >
                      {t("Marcar como pessoal")}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => desmarcarPessoal.mutate()}
                      className="cursor-pointer text-xs"
                      data-testid="desmarcar-pessoal"
                    >
                      {t("Desmarcar pessoal")}
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {c?.id && (
            <Button asChild size="sm" variant="ghost" className="xl:hidden">
              <Link
                href={`/app/contacts/${c.id}`}
                className="flex items-center gap-1 text-xs"
                title={t("Abre a ficha completa deste contato.")}
              >
                {t("Ver contato")}
                <ArrowRight size={12} weight="regular" aria-hidden />
              </Link>
            </Button>
          )}
        </div>

        {motivo !== null && (
          <Badge
            variant="outline"
            className="h-4 w-fit max-w-full truncate px-1.5 text-[10px]"
            title={t(ROTULO_DO_MOTIVO[motivo])}
            data-testid="badge-atendimento-humano"
          >
            {t(ROTULO_DO_MOTIVO[motivo])}
          </Badge>
        )}
      </div>
      <ReassignDialog
        conversationId={conversation.id}
        open={reassignOpen}
        onOpenChange={setReassignOpen}
        numero={
          onAbrirConversa && c?.id
            ? {
                contactId: c.id,
                contactPhone: c.phone_number ?? null,
                channelSessionId: conversation.channel_session_id,
                onAbrirConversa,
              }
            : undefined
        }
      />
      <ModalTransferirParaIa
        open={transferIaOpen}
        onOpenChange={setTransferIaOpen}
        conversationId={conversation.id}
        contactName={displayName}
        activeAgentId={conversation.active_ai_agent_id ?? null}
      />
      <AlertDialog open={confirmFecharOpen} onOpenChange={setConfirmFecharOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Fechar esta conversa?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("O atendimento é encerrado. Se o cliente escrever de novo, você pode reabrir.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                close.mutate({
                  conversation_id: conversation.id,
                  expected_revision: conversation.service_revision,
                })
              }
            >
              {t("Fechar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* A confirmação precisa dizer o que ACONTECE, e o que acontece depende
          do estado. `fn_conversation_set_status` trata `archived` como
          terminal: encerra o atendimento (grava `service_closed_at`,
          incrementa a revisão) e, com isso, desfaz a pausa do automático. Um
          atendente que leia "arquivar = tirar da vista, volto depois"
          encerraria o atendimento sem saber — e o robô voltaria a responder
          no próximo "oi" do cliente. Por isso a descrição só aparece quando
          `!encerrada`: quando já está encerrada, arquivar não muda o
          atendimento, só o lugar onde a conversa mora. */}
      <AlertDialog open={confirmArquivarOpen} onOpenChange={setConfirmArquivarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Arquivar esta conversa?")}</AlertDialogTitle>
            {!encerrada && (
              <AlertDialogDescription>
                {t(
                  "Arquivar encerra este atendimento e guarda a conversa no histórico. Se o cliente escrever de novo, ela volta.",
                )}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                arquivar.mutate({
                  conversation_id: conversation.id,
                  expected_revision: conversation.service_revision,
                })
              }
            >
              {t("Arquivar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* A confirmação diz o que ACONTECE ao marcar: a conversa fecha e sai do
          atendente, e o contato fica inutilizado para envio — sem apagar nada.
          Desmarcar é direto no botão porque só relista o que já está lá. */}
      <AlertDialog open={confirmPessoalOpen} onOpenChange={setConfirmPessoalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Marcar este contato como pessoal?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "A conversa sai do inbox e o contato fica fora da operação: sem IA, sem follow-up, sem campanha e sem envio. O histórico continua no banco e volta à vista ao desmarcar; follow-ups e campanhas cancelados não voltam.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => marcarPessoal.mutate()}>
              {t("Marcar como pessoal")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
