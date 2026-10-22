"use client";

import { useEffect, useState, useTransition } from "react";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Calendar,
  Users,
  AlertCircle,
  CheckCircle2,
  Clock,
  Plus,
  RefreshCw,
  Search,
  ExternalLink,
  Receipt,
  ArrowUpRight,
  ArrowDownLeft,
  Filter,
  FileText,
  CreditCard,
  Building,
  UserCheck,
  RotateCcw,
  Eye,
  Edit2,
  Check,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

interface FinanceiroClientProps {
  moeda: string;
  podeCriar: boolean;
  podeEstornar: boolean;
  contas: Array<{ id: string; name: string }>;
}

export function FinanceiroClient({
  moeda,
  podeCriar,
  podeEstornar,
  contas,
}: FinanceiroClientProps) {
  const [abaAtiva, setAbaAtiva] = useState<string>("dashboard");
  const [carregando, setCarregando] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Dados principais
  const [dashboard, setDashboard] = useState<any>(null);
  const [clientes, setClientes] = useState<any[]>([]);
  const [contratos, setContratos] = useState<any[]>([]);
  const [cobrancas, setCobrancas] = useState<any[]>([]);
  const [relatorios, setRelatorios] = useState<any>(null);

  // Filtros
  const [buscaClientes, setBuscaClientes] = useState("");
  const [filtroStatusContrato, setFiltroStatusContrato] = useState("");
  const [filtroStatusCobranca, setFiltroStatusCobranca] = useState("");
  const [filtroTipoCobranca, setFiltroTipoCobranca] = useState<"income" | "expense">("income");
  const [periodoDashboard, setPeriodoDashboard] = useState<string>("mes_atual");
  const [dataDeDashboard, setDataDeDashboard] = useState<string>("");
  const [dataAteDashboard, setDataAteDashboard] = useState<string>("");
  const [filtroCategoriaCliente, setFiltroCategoriaCliente] = useState<string>("");
  const [contatosParaSelecao, setContatosParaSelecao] = useState<any[]>([]);

  // Modais
  const [modalNovoContratoAberto, setModalNovoContratoAberto] = useState(false);
  const [modalNovaCobrancaAberto, setModalNovaCobrancaAberto] = useState(false);
  const [modalPagarAberto, setModalPagarAberto] = useState(false);
  const [modalEstornarAberto, setModalEstornarAberto] = useState(false);
  const [modalClienteAberto, setModalClienteAberto] = useState(false);
  const [modalContratoAberto, setModalContratoAberto] = useState(false);

  // Itens em foco nos modais
  const [cobrancaSelecionada, setCobrancaSelecionada] = useState<any>(null);
  const [clienteSelecionado, setClienteSelecionado] = useState<any>(null);
  const [perfilClienteDetalhado, setPerfilClienteDetalhado] = useState<any>(null);
  const [contratoSelecionado, setContratoSelecionado] = useState<any>(null);

  // Form states
  const [formContrato, setFormContrato] = useState({
    contact_id: "",
    service_name: "",
    description: "",
    amount: "",
    modality: "recurring", // recurring | one_off | installments
    recurrence_period: "monthly",
    installments_count: "1",
    due_day: "10",
    contract_date: new Date().toISOString().split("T")[0],
    start_date: new Date().toISOString().split("T")[0],
    end_date: "",
    gerar_cobrancas_automaticas: true,
    pagamento_ja_realizado: false,
    data_pagamento_realizada: new Date().toISOString().split("T")[0],
    forma_pagamento: "pix",
    account_id: contas[0]?.id || "",
  });

  const [formCobranca, setFormCobranca] = useState({
    type: "income",
    contact_id: "",
    title: "",
    amount: "",
    due_date: new Date().toISOString().split("T")[0],
    status: "pending",
    payment_method: "pix",
    account_id: contas[0]?.id || "",
    notes: "",
  });

  const [formPagamento, setFormPagamento] = useState({
    valor: "",
    data_pagamento: new Date().toISOString().split("T")[0],
    forma_pagamento: "pix",
    account_id: contas[0]?.id || "",
    observacoes: "",
  });

  const [formEstorno, setFormEstorno] = useState({
    motivo: "",
  });

  const [formClienteEdicao, setFormClienteEdicao] = useState({
    display_name: "",
    trade_name: "",
    phone_number: "",
    email: "",
    instagram: "",
    document: "",
    client_since: "",
    commercial_status: "cliente_ativo",
    financial_status: "em_dia",
    financial_notes: "",
  });

  // Formatadores
  const formatarMoeda = (centavos: number | null | undefined) => {
    const valor = (centavos ?? 0) / 100;
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: moeda || "BRL",
    }).format(valor);
  };

  const formatarData = (dataStr: string | null | undefined) => {
    if (!dataStr) return "-";
    const [ano, mes, dia] = dataStr.split("T")[0]?.split("-") ?? [];
    if (!ano || !mes || !dia) return dataStr;
    return `${dia}/${mes}/${ano}`;
  };

  // Carregar dados
  const carregarDashboard = async (
    periodo = periodoDashboard,
    de = dataDeDashboard,
    ate = dataAteDashboard,
  ) => {
    try {
      const params = new URLSearchParams();
      if (periodo) params.set("periodo", periodo);
      if (periodo === "custom") {
        if (de) params.set("de", de);
        if (ate) params.set("ate", ate);
      }
      const res = await fetch(`/api/v1/financeiro/dashboard?${params.toString()}`).then((r) =>
        r.json(),
      );
      if (res.data) setDashboard(res.data);
    } catch (err: any) {
      toast.error("Erro ao atualizar métricas do dashboard: " + err.message);
    }
  };

  const carregarClientes = async (categoria = filtroCategoriaCliente) => {
    try {
      const params = new URLSearchParams({ apenas_clientes: "true" });
      if (categoria) params.set("categoria", categoria);
      const res = await fetch(`/api/v1/financeiro/clientes?${params.toString()}`).then((r) =>
        r.json(),
      );
      if (res.data) setClientes(res.data);
    } catch (err: any) {
      toast.error("Erro ao filtrar clientes: " + err.message);
    }
  };

  const carregarTudo = async () => {
    setCarregando(true);
    try {
      const paramsDash = new URLSearchParams();
      if (periodoDashboard) paramsDash.set("periodo", periodoDashboard);
      if (periodoDashboard === "custom") {
        if (dataDeDashboard) paramsDash.set("de", dataDeDashboard);
        if (dataAteDashboard) paramsDash.set("ate", dataAteDashboard);
      }

      const paramsCli = new URLSearchParams({ apenas_clientes: "true" });
      if (filtroCategoriaCliente) paramsCli.set("categoria", filtroCategoriaCliente);

      const [resDash, resClientes, resContatos, resContratos, resCobrancas, resRelatorios] =
        await Promise.all([
          fetch(`/api/v1/financeiro/dashboard?${paramsDash.toString()}`).then((r) => r.json()),
          fetch(`/api/v1/financeiro/clientes?${paramsCli.toString()}`).then((r) => r.json()),
          fetch("/api/v1/financeiro/clientes?apenas_clientes=false").then((r) => r.json()),
          fetch("/api/v1/financeiro/contratos").then((r) => r.json()),
          fetch("/api/v1/financeiro/cobrancas").then((r) => r.json()),
          fetch("/api/v1/financeiro/relatorios").then((r) => r.json()),
        ]);

      if (resDash.data) setDashboard(resDash.data);
      if (resClientes.data) setClientes(resClientes.data);
      if (resContatos.data) setContatosParaSelecao(resContatos.data);
      if (resContratos.data) setContratos(resContratos.data);
      if (resCobrancas.data) setCobrancas(resCobrancas.data);
      if (resRelatorios.data) setRelatorios(resRelatorios.data);
    } catch (err: any) {
      toast.error("Erro ao carregar dados financeiros: " + err.message);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarTudo();
  }, []);

  // Abrir Ficha do Cliente
  const abrirFichaCliente = async (cliente: any) => {
    setClienteSelecionado(cliente);
    setModalClienteAberto(true);
    setPerfilClienteDetalhado(null);

    try {
      const res = await fetch(`/api/v1/financeiro/clientes/${cliente.id}`).then((r) => r.json());
      if (res.data) {
        setPerfilClienteDetalhado(res.data);
        const cf = res.data.campos_financeiros || {};
        setFormClienteEdicao({
          display_name: res.data.display_name || "",
          trade_name: cf.trade_name || "",
          phone_number: res.data.phone_number || "",
          email: res.data.email || "",
          instagram: cf.instagram || "",
          document: cf.document || "",
          client_since: cf.client_since || (res.data.client_recognized_at ? res.data.client_recognized_at.split("T")[0] : ""),
          commercial_status: cf.commercial_status || "cliente_ativo",
          financial_status: cf.financial_status || "em_dia",
          financial_notes: cf.financial_notes || "",
        });
      }
    } catch (err: any) {
      toast.error("Erro ao carregar detalhes do cliente: " + err.message);
    }
  };

  // Salvar Edição do Cliente
  const salvarCliente = async () => {
    if (!clienteSelecionado) return;
    try {
      const res = await fetch(`/api/v1/financeiro/clientes/${clienteSelecionado.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formClienteEdicao),
      }).then((r) => r.json());

      if (res.error) {
        toast.error("Erro: " + res.error.message);
        return;
      }
      toast.success("Dados do cliente atualizados com sucesso!");
      abrirFichaCliente(clienteSelecionado);
      carregarTudo();
    } catch (err: any) {
      toast.error("Erro ao salvar cliente: " + err.message);
    }
  };

  // Criar Contrato
  const criarContrato = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formContrato.contact_id || !formContrato.service_name || !formContrato.amount) {
      toast.error("Preencha cliente, nome do serviço e valor.");
      return;
    }

    const valorCents = Math.round(parseFloat(formContrato.amount.replace(",", ".")) * 100);
    if (isNaN(valorCents) || valorCents <= 0) {
      toast.error("Valor inválido.");
      return;
    }

    try {
      const payload = {
        contact_id: formContrato.contact_id,
        service_name: formContrato.service_name,
        description: formContrato.description || undefined,
        amount_cents: valorCents,
        modality: formContrato.modality,
        recurrence_period: formContrato.modality === "recurring" ? formContrato.recurrence_period : undefined,
        installments_count: formContrato.modality === "installments" ? parseInt(formContrato.installments_count, 10) : 1,
        due_day: parseInt(formContrato.due_day, 10) || 10,
        contract_date: formContrato.contract_date,
        start_date: formContrato.start_date,
        end_date: formContrato.end_date || undefined,
        gerar_cobrancas_automaticas: formContrato.gerar_cobrancas_automaticas,
        pagamento_ja_realizado: formContrato.pagamento_ja_realizado,
        data_pagamento_realizada: formContrato.pagamento_ja_realizado ? formContrato.data_pagamento_realizada : undefined,
        forma_pagamento: formContrato.pagamento_ja_realizado ? formContrato.forma_pagamento : undefined,
        account_id: formContrato.pagamento_ja_realizado && formContrato.account_id ? formContrato.account_id : undefined,
      };

      const res = await fetch("/api/v1/financeiro/contratos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.json());

      if (res.error) {
        toast.error("Erro: " + res.error.message);
        return;
      }

      toast.success("Contrato cadastrado com sucesso!");
      setModalNovoContratoAberto(false);
      setFormContrato({
        contact_id: "",
        service_name: "",
        description: "",
        amount: "",
        modality: "recurring",
        recurrence_period: "monthly",
        installments_count: "1",
        due_day: "10",
        contract_date: new Date().toISOString().split("T")[0],
        start_date: new Date().toISOString().split("T")[0],
        end_date: "",
        gerar_cobrancas_automaticas: true,
        pagamento_ja_realizado: false,
        data_pagamento_realizada: new Date().toISOString().split("T")[0],
        forma_pagamento: "pix",
        account_id: contas[0]?.id || "",
      });
      carregarTudo();
    } catch (err: any) {
      toast.error("Erro ao criar contrato: " + err.message);
    }
  };

  // Criar Cobrança Avulsa / Despesa
  const criarCobranca = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCobranca.title || !formCobranca.amount) {
      toast.error("Preencha título e valor.");
      return;
    }

    const valorCents = Math.round(parseFloat(formCobranca.amount.replace(",", ".")) * 100);
    if (isNaN(valorCents) || valorCents <= 0) {
      toast.error("Valor inválido.");
      return;
    }

    try {
      const payload = {
        type: formCobranca.type,
        contact_id: formCobranca.contact_id || undefined,
        title: formCobranca.title,
        amount_cents: valorCents,
        billed_cents: valorCents,
        due_date: formCobranca.due_date,
        status: formCobranca.status,
        payment_method: formCobranca.status === "paid" ? formCobranca.payment_method : undefined,
        account_id: formCobranca.account_id || undefined,
        notes: formCobranca.notes || undefined,
      };

      const res = await fetch("/api/v1/financeiro/cobrancas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.json());

      if (res.error) {
        toast.error("Erro: " + res.error.message);
        return;
      }

      toast.success(
        formCobranca.type === "income" ? "Receita/Cobrança registrada!" : "Despesa registrada!",
      );
      setModalNovaCobrancaAberto(false);
      setFormCobranca({
        type: "income",
        contact_id: "",
        title: "",
        amount: "",
        due_date: new Date().toISOString().split("T")[0],
        status: "pending",
        payment_method: "pix",
        account_id: contas[0]?.id || "",
        notes: "",
      });
      carregarTudo();
    } catch (err: any) {
      toast.error("Erro ao criar cobrança: " + err.message);
    }
  };

  // Abrir Modal de Pagamento
  const abrirModalPagamento = (cob: any) => {
    setCobrancaSelecionada(cob);
    const restante = Math.max(0, (cob.billed_cents || 0) - (cob.paid_cents || 0));
    setFormPagamento({
      valor: (restante / 100).toFixed(2),
      data_pagamento: new Date().toISOString().split("T")[0],
      forma_pagamento: cob.payment_method || "pix",
      account_id: cob.account_id || contas[0]?.id || "",
      observacoes: "",
    });
    setModalPagarAberto(true);
  };

  // Confirmar Pagamento
  const confirmarPagamento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cobrancaSelecionada) return;

    const valorCents = Math.round(parseFloat(formPagamento.valor.replace(",", ".")) * 100);
    if (isNaN(valorCents) || valorCents <= 0) {
      toast.error("Valor do pagamento inválido.");
      return;
    }

    try {
      const payload = {
        valor_pago_cents: valorCents,
        data_pagamento: formPagamento.data_pagamento,
        forma_pagamento: formPagamento.forma_pagamento,
        account_id: formPagamento.account_id || undefined,
        observacoes: formPagamento.observacoes || undefined,
      };

      const res = await fetch(`/api/v1/financeiro/cobrancas/${cobrancaSelecionada.id}/pagar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.json());

      if (res.error) {
        toast.error("Erro: " + res.error.message);
        return;
      }

      toast.success("Pagamento registrado com sucesso!");
      setModalPagarAberto(false);
      carregarTudo();
    } catch (err: any) {
      toast.error("Erro ao registrar pagamento: " + err.message);
    }
  };

  // Abrir Modal de Estorno
  const abrirModalEstorno = (cob: any) => {
    setCobrancaSelecionada(cob);
    setFormEstorno({ motivo: "" });
    setModalEstornarAberto(true);
  };

  // Confirmar Estorno
  const confirmarEstorno = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cobrancaSelecionada || !formEstorno.motivo) {
      toast.error("Informe o motivo do estorno.");
      return;
    }

    try {
      const res = await fetch(`/api/v1/financeiro/cobrancas/${cobrancaSelecionada.id}/estornar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: formEstorno.motivo }),
      }).then((r) => r.json());

      if (res.error) {
        toast.error("Erro: " + res.error.message);
        return;
      }

      toast.success("Cobrança estornada com sucesso!");
      setModalEstornarAberto(false);
      carregarTudo();
    } catch (err: any) {
      toast.error("Erro ao estornar: " + err.message);
    }
  };

  // Alterar Status de Contrato (pausar, cancelar, ativar)
  const alterarStatusContrato = async (id: string, novoStatus: string) => {
    try {
      const res = await fetch(`/api/v1/financeiro/contratos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: novoStatus }),
      }).then((r) => r.json());

      if (res.error) {
        toast.error("Erro: " + res.error.message);
        return;
      }
      toast.success(
        novoStatus === "completed"
          ? "Serviço marcado como concluído com sucesso!"
          : novoStatus === "active"
            ? "Contrato ativado com sucesso!"
            : `Contrato atualizado para ${novoStatus}!`,
      );
      carregarTudo();
    } catch (err: any) {
      toast.error("Erro ao atualizar contrato: " + err.message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Financeiro Integrado</h1>
          <p className="text-sm text-muted-foreground">
            Gestão profissional de contratos, receitas, despesas, clientes e fluxo de caixa.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={carregarTudo}
            disabled={carregando}
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} />
            Atualizar
          </Button>

          {podeCriar && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setModalNovaCobrancaAberto(true)}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Nova Despesa / Receita
              </Button>

              <Button
                size="sm"
                onClick={() => setModalNovoContratoAberto(true)}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Novo Contrato
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <Tabs value={abaAtiva} onValueChange={setAbaAtiva} className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-6">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          <TabsTrigger value="contratos">Contratos</TabsTrigger>
          <TabsTrigger value="receber">A Receber</TabsTrigger>
          <TabsTrigger value="pagar">A Pagar</TabsTrigger>
          <TabsTrigger value="relatorios">Relatórios</TabsTrigger>
        </TabsList>

        {/* ========================================================================= */}
        {/* ABA 1: DASHBOARD */}
        {/* ========================================================================= */}
        <TabsContent value="dashboard" className="space-y-6 pt-4">
          {dashboard ? (
            <>
              {/* Barra de Filtro de Período do Dashboard */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-3.5 rounded-lg border bg-card/60 backdrop-blur-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">
                    Período:
                  </span>
                  <Button
                    variant={periodoDashboard === "mes_atual" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      setPeriodoDashboard("mes_atual");
                      carregarDashboard("mes_atual");
                    }}
                  >
                    Mês Atual
                  </Button>
                  <Button
                    variant={periodoDashboard === "mes_anterior" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      setPeriodoDashboard("mes_anterior");
                      carregarDashboard("mes_anterior");
                    }}
                  >
                    Mês Anterior
                  </Button>
                  <Button
                    variant={periodoDashboard === "ano_atual" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      setPeriodoDashboard("ano_atual");
                      carregarDashboard("ano_atual");
                    }}
                  >
                    Ano Atual
                  </Button>
                  <Button
                    variant={periodoDashboard === "tudo" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      setPeriodoDashboard("tudo");
                      carregarDashboard("tudo");
                    }}
                  >
                    Todo o Histórico (Acumulado)
                  </Button>
                  <Button
                    variant={periodoDashboard === "custom" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setPeriodoDashboard("custom")}
                  >
                    Personalizado
                  </Button>
                </div>

                {periodoDashboard === "custom" && (
                  <div className="flex items-center gap-2 pt-2 sm:pt-0">
                    <Input
                      type="date"
                      value={dataDeDashboard}
                      onChange={(e) => setDataDeDashboard(e.target.value)}
                      className="h-8 text-xs w-36"
                    />
                    <span className="text-xs text-muted-foreground">até</span>
                    <Input
                      type="date"
                      value={dataAteDashboard}
                      onChange={(e) => setDataAteDashboard(e.target.value)}
                      className="h-8 text-xs w-36"
                    />
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => carregarDashboard("custom", dataDeDashboard, dataAteDashboard)}
                    >
                      Filtrar
                    </Button>
                  </div>
                )}
              </div>

              {/* Metric Cards Grid */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">MRR (Recorrência Mensal)</CardTitle>
                    <DollarSign className="h-4 w-4 text-emerald-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-emerald-600">
                      {formatarMoeda(dashboard.mrr_cents)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      ARR: <span className="font-semibold text-foreground">{formatarMoeda(dashboard.arr_cents)}</span>
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Faturamento do Período</CardTitle>
                    <TrendingUp className="h-4 w-4 text-blue-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatarMoeda(dashboard.faturamento_periodo_cents)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {dashboard.taxa_crescimento_percentual >= 0 ? "+" : ""}
                      {dashboard.taxa_crescimento_percentual}% vs mês anterior
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Recebido</CardTitle>
                    <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-emerald-600">
                      {formatarMoeda(dashboard.total_recebido_cents)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      A receber em aberto: {formatarMoeda(dashboard.total_a_receber_cents)}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Resultado Operacional</CardTitle>
                    <ArrowUpRight className={`h-4 w-4 ${dashboard.resultado_financeiro_cents >= 0 ? "text-emerald-600" : "text-rose-600"}`} />
                  </CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold ${dashboard.resultado_financeiro_cents >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {formatarMoeda(dashboard.resultado_financeiro_cents)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Despesas: {formatarMoeda(dashboard.total_despesas_cents)}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Sub-cards: Health indicators */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Clientes Ativos</p>
                        <p className="text-2xl font-bold mt-1">{dashboard.clientes_ativos}</p>
                      </div>
                      <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/50 rounded-lg text-emerald-600">
                        <Users className="h-5 w-5" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      {dashboard.contratos_ativos} contratos ativos
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Clientes Inadimplentes</p>
                        <p className="text-2xl font-bold mt-1 text-rose-600">{dashboard.clientes_inadimplentes}</p>
                      </div>
                      <div className="p-2.5 bg-rose-100 dark:bg-rose-950/50 rounded-lg text-rose-600">
                        <AlertCircle className="h-5 w-5" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      Cobranças vencidas pendentes
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Taxa de Churn</p>
                        <p className="text-2xl font-bold mt-1">{dashboard.taxa_churn_percentual}%</p>
                      </div>
                      <div className="p-2.5 bg-blue-100 dark:bg-blue-950/50 rounded-lg text-blue-600">
                        <TrendingDown className="h-5 w-5" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      Cancelamentos no período
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Contratos Totais</p>
                        <p className="text-2xl font-bold mt-1">{contratos.length}</p>
                      </div>
                      <div className="p-2.5 bg-indigo-100 dark:bg-indigo-950/50 rounded-lg text-indigo-600">
                        <Receipt className="h-5 w-5" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      Recorrentes e avulsos
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Evolução Mensal & Próximos Vencimentos */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Evolução Mensal */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Evolução Financeira (Últimos 6 meses)</CardTitle>
                    <CardDescription>Comparativo de Receitas vs Despesas realizadas</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {dashboard.evolucao_mensal?.map((mes: any) => {
                        const total = Math.max(mes.receitas_cents, mes.despesas_cents, 100);
                        const percRec = Math.min(100, Math.round((mes.receitas_cents / total) * 100));
                        const percDesp = Math.min(100, Math.round((mes.despesas_cents / total) * 100));
                        return (
                          <div key={mes.mes} className="space-y-1">
                            <div className="flex justify-between text-xs font-medium">
                              <span>{mes.mes}</span>
                              <span>
                                <span className="text-emerald-600 font-semibold">{formatarMoeda(mes.receitas_cents)}</span>
                                {" / "}
                                <span className="text-rose-600 font-semibold">{formatarMoeda(mes.despesas_cents)}</span>
                              </span>
                            </div>
                            <div className="flex h-2.5 w-full rounded bg-muted overflow-hidden">
                              <div style={{ width: `${percRec}%` }} className="bg-emerald-500" />
                              <div style={{ width: `${percDesp}%` }} className="bg-rose-500" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Próximos Vencimentos */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Próximos Vencimentos</CardTitle>
                    <CardDescription>Cobranças e contas a vencer nos próximos dias</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {dashboard.proximos_vencimentos?.length === 0 && (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          Nenhum vencimento pendente no período.
                        </p>
                      )}
                      {dashboard.proximos_vencimentos?.map((inv: any) => (
                        <div
                          key={inv.id}
                          className="flex items-center justify-between p-2.5 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <p className="text-sm font-medium truncate">{inv.title}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {inv.contact?.display_name || "Sem cliente"} • Vence em {formatarData(inv.due_date)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">
                              {formatarMoeda(inv.billed_cents)}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => abrirModalPagamento(inv)}
                              className="h-7 text-xs"
                            >
                              Baixar
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center p-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </TabsContent>

        {/* ========================================================================= */}
        {/* ABA 2: CLIENTES & HISTÓRICO FINANCEIRO */}
        {/* ========================================================================= */}
        <TabsContent value="clientes" className="space-y-4 pt-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar cliente por nome, telefone ou e-mail..."
                  value={buscaClientes}
                  onChange={(e) => setBuscaClientes(e.target.value)}
                  className="pl-8"
                />
              </div>

              <div className="text-sm text-muted-foreground">
                Total: <span className="font-semibold text-foreground">{clientes.length}</span> clientes com contrato/cobrança
              </div>
            </div>

            {/* Filtros de Categoria de Clientes */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={filtroCategoriaCliente === "" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setFiltroCategoriaCliente("");
                  carregarClientes("");
                }}
              >
                Todos
              </Button>
              <Button
                variant={filtroCategoriaCliente === "ativos" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setFiltroCategoriaCliente("ativos");
                  carregarClientes("ativos");
                }}
              >
                Ativos
              </Button>
              <Button
                variant={filtroCategoriaCliente === "historicos" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setFiltroCategoriaCliente("historicos");
                  carregarClientes("historicos");
                }}
              >
                Históricos (Concluídos)
              </Button>
              <Button
                variant={filtroCategoriaCliente === "inadimplentes" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setFiltroCategoriaCliente("inadimplentes");
                  carregarClientes("inadimplentes");
                }}
              >
                Inadimplentes
              </Button>
              <Button
                variant={filtroCategoriaCliente === "cancelados" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setFiltroCategoriaCliente("cancelados");
                  carregarClientes("cancelados");
                }}
              >
                Cancelados
              </Button>
            </div>
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left font-medium text-muted-foreground">
                    <th className="p-3">Cliente</th>
                    <th className="p-3">Contato / Redes</th>
                    <th className="p-3">Situação</th>
                    <th className="p-3">Contratos</th>
                    <th className="p-3">Total Pago</th>
                    <th className="p-3">A Receber</th>
                    <th className="p-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {clientes
                    .filter((c) => {
                      if (!buscaClientes) return true;
                      const q = buscaClientes.toLowerCase();
                      return (
                        c.display_name?.toLowerCase().includes(q) ||
                        c.email?.toLowerCase().includes(q) ||
                        c.phone_number?.includes(q)
                      );
                    })
                    .map((c) => {
                      const cf = c.campos_financeiros || {};
                      const m = c.metricas || {};
                      const statusFin = cf.financial_status || "em_dia";

                      return (
                        <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-3">
                            <div className="font-medium text-foreground">{c.display_name}</div>
                            {cf.trade_name && (
                              <div className="text-xs text-muted-foreground">{cf.trade_name}</div>
                            )}
                            {cf.document && (
                              <div className="text-xs text-muted-foreground">Doc: {cf.document}</div>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col gap-1 text-xs">
                              {c.phone_number && (
                                <a
                                  href={`https://wa.me/${c.phone_number.replace(/\D/g, "")}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-600 hover:underline flex items-center gap-1"
                                >
                                  WhatsApp: {c.phone_number}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              {cf.instagram && (
                                <a
                                  href={`https://instagram.com/${cf.instagram.replace("@", "")}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-pink-600 hover:underline flex items-center gap-1"
                                >
                                  Instagram: @{cf.instagram.replace("@", "")}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              {c.email && <div className="text-muted-foreground">{c.email}</div>}
                            </div>
                          </td>
                          <td className="p-3">
                            {statusFin === "inadimplente" || (m.total_aberto_cents > 0 && m.inadimplente) ? (
                              <Badge variant="destructive">Inadimplente</Badge>
                            ) : (m.contratos_ativos || 0) > 0 ? (
                              <Badge className="bg-emerald-600 hover:bg-emerald-700">Ativo</Badge>
                            ) : (m.contratos_total || 0) > 0 ? (
                              <Badge variant="secondary">Histórico (Concluído)</Badge>
                            ) : (
                              <Badge variant="outline">Regular</Badge>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="font-semibold">{m.contratos_ativos || 0} ativo(s)</div>
                            {m.mrr_cents > 0 && (
                              <div className="text-xs text-emerald-600">
                                MRR: {formatarMoeda(m.mrr_cents)}
                              </div>
                            )}
                          </td>
                          <td className="p-3 font-medium text-emerald-600">
                            {formatarMoeda(m.total_pago_cents)}
                          </td>
                          <td className="p-3 font-medium">
                            {formatarMoeda(m.total_aberto_cents)}
                          </td>
                          <td className="p-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => abrirFichaCliente(c)}
                              className="gap-1 text-xs"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Ficha Financeira
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ========================================================================= */}
        {/* ABA 3: SERVIÇOS E CONTRATOS */}
        {/* ========================================================================= */}
        <TabsContent value="contratos" className="space-y-4 pt-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant={filtroStatusContrato === "" ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltroStatusContrato("")}
              >
                Todos
              </Button>
              <Button
                variant={filtroStatusContrato === "active" ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltroStatusContrato("active")}
              >
                Ativos
              </Button>
              <Button
                variant={filtroStatusContrato === "paused" ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltroStatusContrato("paused")}
              >
                Pausados
              </Button>
              <Button
                variant={filtroStatusContrato === "completed" ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltroStatusContrato("completed")}
              >
                Concluídos
              </Button>
            </div>

            {podeCriar && (
              <Button size="sm" onClick={() => setModalNovoContratoAberto(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Novo Contrato
              </Button>
            )}
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left font-medium text-muted-foreground">
                    <th className="p-3">Serviço / Contrato</th>
                    <th className="p-3">Cliente</th>
                    <th className="p-3">Modalidade</th>
                    <th className="p-3">Valor</th>
                    <th className="p-3">Vencimento</th>
                    <th className="p-3">Período</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {contratos
                    .filter((ct) => !filtroStatusContrato || ct.status === filtroStatusContrato)
                    .map((ct) => (
                      <tr key={ct.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3">
                          <div className="font-semibold text-foreground">{ct.service_name}</div>
                          {ct.description && (
                            <div className="text-xs text-muted-foreground line-clamp-1">{ct.description}</div>
                          )}
                        </td>
                        <td className="p-3 font-medium">
                          {ct.contact?.display_name || "Sem cliente vinculado"}
                        </td>
                        <td className="p-3">
                          {ct.modality === "recurring" && <Badge variant="outline">Recorrente ({ct.recurrence_period || "mensal"})</Badge>}
                          {ct.modality === "installments" && <Badge variant="outline">Parcelado ({ct.installments_count}x)</Badge>}
                          {ct.modality === "one_off" && <Badge variant="outline">Avulso</Badge>}
                        </td>
                        <td className="p-3 font-semibold text-foreground">
                          {formatarMoeda(ct.amount_cents)}
                        </td>
                        <td className="p-3">Dia {ct.due_day || 10}</td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {ct.modality === "one_off" ? (
                            <span>
                              Avulso (Contratação: {formatarData(ct.contract_date || ct.start_date)})
                              {ct.end_date ? ` · Previsão Entrega: ${formatarData(ct.end_date)}` : ""}
                            </span>
                          ) : ct.modality === "installments" ? (
                            <span>
                              Parcelado ({ct.installments_count || 1}x) · Início: {formatarData(ct.start_date)}
                              {ct.end_date ? ` até ${formatarData(ct.end_date)}` : ""}
                            </span>
                          ) : (
                            <span>
                              {formatarData(ct.start_date)}{" "}
                              {ct.end_date ? `até ${formatarData(ct.end_date)}` : "• Recorrente / Contínuo"}
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          {ct.status === "active" && <Badge className="bg-emerald-600">Ativo</Badge>}
                          {ct.status === "paused" && <Badge variant="secondary">Pausado</Badge>}
                          {ct.status === "completed" && <Badge variant="outline">Concluído</Badge>}
                          {ct.status === "cancelled" && <Badge variant="destructive">Cancelado</Badge>}
                        </td>
                        <td className="p-3 text-right space-x-1">
                          {(() => {
                            const faturaPendente = cobrancas.find(
                              (cob: any) => cob.contract_id === ct.id && cob.status === "pending",
                            );
                            return (
                              <>
                                {faturaPendente && (
                                  <Button
                                    size="sm"
                                    onClick={() => abrirModalPagamento(faturaPendente)}
                                    className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                  >
                                    Receber
                                  </Button>
                                )}
                                {ct.status === "active" &&
                                  (ct.modality === "one_off" || ct.modality === "installments") && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => alterarStatusContrato(ct.id, "completed")}
                                      className="h-7 text-xs text-emerald-700 hover:text-emerald-800 border-emerald-300"
                                    >
                                      Concluir Serviço
                                    </Button>
                                  )}
                                {ct.status === "completed" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => alterarStatusContrato(ct.id, "active")}
                                    className="h-7 text-xs text-blue-600"
                                  >
                                    Reabrir
                                  </Button>
                                )}
                                {ct.status === "active" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => alterarStatusContrato(ct.id, "paused")}
                                    className="h-7 text-xs"
                                  >
                                    Pausar
                                  </Button>
                                )}
                                {ct.status === "paused" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => alterarStatusContrato(ct.id, "active")}
                                    className="h-7 text-xs text-emerald-600"
                                  >
                                    Ativar
                                  </Button>
                                )}
                                {ct.status !== "cancelled" && ct.status !== "completed" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => alterarStatusContrato(ct.id, "cancelled")}
                                    className="h-7 text-xs text-rose-600"
                                  >
                                    Cancelar
                                  </Button>
                                )}
                              </>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ========================================================================= */}
        {/* ABA 4: CONTAS A RECEBER */}
        {/* ========================================================================= */}
        <TabsContent value="receber" className="space-y-4 pt-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant={filtroStatusCobranca === "" ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltroStatusCobranca("")}
              >
                Todas
              </Button>
              <Button
                variant={filtroStatusCobranca === "pending" ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltroStatusCobranca("pending")}
              >
                Pendentes
              </Button>
              <Button
                variant={filtroStatusCobranca === "paid" ? "default" : "outline"}
                size="sm"
                onClick={() => setFiltroStatusCobranca("paid")}
              >
                Recebidas
              </Button>
            </div>

            {podeCriar && (
              <Button
                size="sm"
                onClick={() => {
                  setFormCobranca((prev) => ({ ...prev, type: "income" }));
                  setModalNovaCobrancaAberto(true);
                }}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Nova Cobrança
              </Button>
            )}
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left font-medium text-muted-foreground">
                    <th className="p-3">Título / Descrição</th>
                    <th className="p-3">Cliente</th>
                    <th className="p-3">Valor Cobrado</th>
                    <th className="p-3">Valor Pago</th>
                    <th className="p-3">Vencimento</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cobrancas
                    .filter((c) => c.type === "income")
                    .filter((c) => !filtroStatusCobranca || c.status === filtroStatusCobranca)
                    .map((cob) => (
                      <tr key={cob.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3">
                          <div className="font-semibold text-foreground">{cob.title}</div>
                          {cob.installment_total > 1 && (
                            <div className="text-xs text-muted-foreground">
                              Parcela {cob.installment_number} de {cob.installment_total}
                            </div>
                          )}
                        </td>
                        <td className="p-3 font-medium">
                          {cob.contact?.display_name || "-"}
                        </td>
                        <td className="p-3 font-semibold text-foreground">
                          {formatarMoeda(cob.billed_cents)}
                        </td>
                        <td className="p-3 font-medium text-emerald-600">
                          {formatarMoeda(cob.paid_cents)}
                        </td>
                        <td className="p-3">{formatarData(cob.due_date)}</td>
                        <td className="p-3">
                          {cob.status === "paid" && <Badge className="bg-emerald-600">Pago</Badge>}
                          {cob.status === "partially_paid" && <Badge className="bg-amber-600">Parcial</Badge>}
                          {cob.status === "pending" && <Badge variant="secondary">Pendente</Badge>}
                          {cob.status === "overdue" && <Badge variant="destructive">Vencido</Badge>}
                          {cob.status === "reversed" && <Badge variant="outline">Estornado</Badge>}
                        </td>
                        <td className="p-3 text-right space-x-1">
                          {cob.status !== "paid" && cob.status !== "reversed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => abrirModalPagamento(cob)}
                              className="h-7 text-xs"
                            >
                              Receber
                            </Button>
                          )}
                          {podeEstornar && Number(cob.paid_cents || 0) > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => abrirModalEstorno(cob)}
                              className="h-7 text-xs text-rose-600"
                            >
                              Estornar
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ========================================================================= */}
        {/* ABA 5: CONTAS A PAGAR / DESPESAS */}
        {/* ========================================================================= */}
        <TabsContent value="pagar" className="space-y-4 pt-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Controle de contas a pagar, aluguel, salários, fornecedores e materiais.
            </div>

            {podeCriar && (
              <Button
                size="sm"
                onClick={() => {
                  setFormCobranca((prev) => ({ ...prev, type: "expense" }));
                  setModalNovaCobrancaAberto(true);
                }}
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Registrar Despesa
              </Button>
            )}
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left font-medium text-muted-foreground">
                    <th className="p-3">Descrição da Despesa</th>
                    <th className="p-3">Valor</th>
                    <th className="p-3">Vencimento</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Forma de Pagamento</th>
                    <th className="p-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cobrancas
                    .filter((c) => c.type === "expense")
                    .map((cob) => (
                      <tr key={cob.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3 font-semibold text-foreground">{cob.title}</td>
                        <td className="p-3 font-semibold text-rose-600">
                          {formatarMoeda(cob.billed_cents)}
                        </td>
                        <td className="p-3">{formatarData(cob.due_date)}</td>
                        <td className="p-3">
                          {cob.status === "paid" && <Badge className="bg-emerald-600">Pago</Badge>}
                          {cob.status === "pending" && <Badge variant="secondary">A Pagar</Badge>}
                          {cob.status === "reversed" && <Badge variant="outline">Estornado</Badge>}
                        </td>
                        <td className="p-3 uppercase text-xs text-muted-foreground">
                          {cob.payment_method || "-"}
                        </td>
                        <td className="p-3 text-right space-x-1">
                          {cob.status !== "paid" && cob.status !== "reversed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => abrirModalPagamento(cob)}
                              className="h-7 text-xs"
                            >
                              Pagar
                            </Button>
                          )}
                          {podeEstornar && Number(cob.paid_cents || 0) > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => abrirModalEstorno(cob)}
                              className="h-7 text-xs text-rose-600"
                            >
                              Estornar
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ========================================================================= */}
        {/* ABA 6: RELATÓRIOS E DRE */}
        {/* ========================================================================= */}
        <TabsContent value="relatorios" className="space-y-6 pt-4">
          {relatorios ? (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Receitas por Serviço */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Receitas por Tipo de Serviço</CardTitle>
                  <CardDescription>Serviços mais vendidos e faturamento gerado</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {relatorios.receitas_por_servico?.map((srv: any) => (
                      <div key={srv.nome} className="flex justify-between items-center p-2 rounded border">
                        <div>
                          <div className="font-semibold text-sm">{srv.nome}</div>
                          <div className="text-xs text-muted-foreground">{srv.contagem} cobrança(s)</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-emerald-600">{formatarMoeda(srv.total_cents)}</div>
                          <div className="text-xs text-muted-foreground">Recebido: {formatarMoeda(srv.recebido_cents)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Despesas por Categoria */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Despesas por Categoria</CardTitle>
                  <CardDescription>Onde os custos da empresa estão concentrados</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {relatorios.despesas_por_tipo?.map((desp: any) => (
                      <div key={desp.categoria} className="flex justify-between items-center p-2 rounded border">
                        <div>
                          <div className="font-semibold text-sm">{desp.categoria}</div>
                          <div className="text-xs text-muted-foreground">{desp.contagem} registro(s)</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-rose-600">{formatarMoeda(desp.total_cents)}</div>
                          <div className="text-xs text-muted-foreground">Pago: {formatarMoeda(desp.pago_cents)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Aging de Inadimplência */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Aging de Inadimplência (Dias em Atraso)</CardTitle>
                  <CardDescription>Distribuição dos valores a receber vencidos por tempo</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-lg border bg-amber-50 dark:bg-amber-950/20">
                      <div className="text-xs text-muted-foreground">Até 30 dias</div>
                      <div className="text-lg font-bold text-amber-600">
                        {formatarMoeda(relatorios.faixas_atraso?.ate_30_dias?.total_cents)}
                      </div>
                      <div className="text-xs text-muted-foreground">{relatorios.faixas_atraso?.ate_30_dias?.contagem} cobrança(s)</div>
                    </div>

                    <div className="p-3 rounded-lg border bg-orange-50 dark:bg-orange-950/20">
                      <div className="text-xs text-muted-foreground">31 a 60 dias</div>
                      <div className="text-lg font-bold text-orange-600">
                        {formatarMoeda(relatorios.faixas_atraso?.de_31_a_60_dias?.total_cents)}
                      </div>
                      <div className="text-xs text-muted-foreground">{relatorios.faixas_atraso?.de_31_a_60_dias?.contagem} cobrança(s)</div>
                    </div>

                    <div className="p-3 rounded-lg border bg-rose-50 dark:bg-rose-950/20">
                      <div className="text-xs text-muted-foreground">61 a 90 dias</div>
                      <div className="text-lg font-bold text-rose-600">
                        {formatarMoeda(relatorios.faixas_atraso?.de_61_a_90_dias?.total_cents)}
                      </div>
                      <div className="text-xs text-muted-foreground">{relatorios.faixas_atraso?.de_61_a_90_dias?.contagem} cobrança(s)</div>
                    </div>

                    <div className="p-3 rounded-lg border bg-rose-100 dark:bg-rose-950/50">
                      <div className="text-xs text-muted-foreground">Mais de 90 dias</div>
                      <div className="text-lg font-bold text-rose-700">
                        {formatarMoeda(relatorios.faixas_atraso?.mais_de_90_dias?.total_cents)}
                      </div>
                      <div className="text-xs text-muted-foreground">{relatorios.faixas_atraso?.mais_de_90_dias?.contagem} cobrança(s)</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Formas de Pagamento Utilizadas */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Formas de Pagamento mais Utilizadas</CardTitle>
                  <CardDescription>Preferência dos clientes na quitação dos serviços</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {relatorios.formas_pagamento?.map((fp: any) => (
                      <div key={fp.forma} className="flex justify-between items-center p-2 rounded border">
                        <div className="font-semibold text-sm uppercase">{fp.forma}</div>
                        <div className="text-right">
                          <div className="font-bold text-foreground">{formatarMoeda(fp.total_cents)}</div>
                          <div className="text-xs text-muted-foreground">{fp.contagem} pagamento(s)</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="flex items-center justify-center p-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ========================================================================= */}
      {/* MODAL: NOVO CONTRATO */}
      {/* ========================================================================= */}
      <Dialog open={modalNovoContratoAberto} onOpenChange={setModalNovoContratoAberto}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Contrato de Serviço</DialogTitle>
            <DialogDescription>
              Vincule um novo serviço ou contrato ao cliente do CRM, com regras financeiras próprias.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={criarContrato} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cliente">Cliente (Cadastro do CRM)</Label>
              <select
                id="cliente"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                value={formContrato.contact_id}
                onChange={(e) => setFormContrato({ ...formContrato, contact_id: e.target.value })}
                required
              >
                <option value="">Selecione um contato/cliente cadastrado...</option>
                {(contatosParaSelecao.length > 0 ? contatosParaSelecao : clientes).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name} {c.phone_number ? `(${c.phone_number})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="servico">Nome do Serviço Contratado</Label>
              <Input
                id="servico"
                placeholder="Ex: Consultoria Mensal, Desenvolvimento Web, Plano Premium"
                value={formContrato.service_name}
                onChange={(e) => setFormContrato({ ...formContrato, service_name: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="modalidade">Modalidade</Label>
                <select
                  id="modalidade"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  value={formContrato.modality}
                  onChange={(e) => setFormContrato({ ...formContrato, modality: e.target.value })}
                >
                  <option value="recurring">Recorrente (Assinatura)</option>
                  <option value="one_off">Avulso (Pagamento Único)</option>
                  <option value="installments">Parcelado</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="valor">Valor Total / Mensalidade (R$)</Label>
                <Input
                  id="valor"
                  type="text"
                  placeholder="0,00"
                  value={formContrato.amount}
                  onChange={(e) => setFormContrato({ ...formContrato, amount: e.target.value })}
                  required
                />
              </div>
            </div>

            {formContrato.modality === "recurring" && (
              <div className="space-y-2">
                <Label htmlFor="periodicidade">Periodicidade da Recorrência</Label>
                <select
                  id="periodicidade"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  value={formContrato.recurrence_period}
                  onChange={(e) => setFormContrato({ ...formContrato, recurrence_period: e.target.value })}
                >
                  <option value="monthly">Mensal</option>
                  <option value="quarterly">Trimestral</option>
                  <option value="semiannual">Semestral</option>
                  <option value="yearly">Anual</option>
                </select>
              </div>
            )}

            {formContrato.modality === "installments" && (
              <div className="space-y-2">
                <Label htmlFor="parcelas">Número de Parcelas</Label>
                <Input
                  id="parcelas"
                  type="number"
                  min="2"
                  max="48"
                  value={formContrato.installments_count}
                  onChange={(e) => setFormContrato({ ...formContrato, installments_count: e.target.value })}
                />
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="dia_vencimento">Dia de Vencimento</Label>
                <Input
                  id="dia_vencimento"
                  type="number"
                  min="1"
                  max="31"
                  value={formContrato.due_day}
                  onChange={(e) => setFormContrato({ ...formContrato, due_day: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="data_inicio">Data de Início</Label>
                <Input
                  id="data_inicio"
                  type="date"
                  value={formContrato.start_date}
                  onChange={(e) => setFormContrato({ ...formContrato, start_date: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="data_fim">Data de Fim (Opcional)</Label>
                <Input
                  id="data_fim"
                  type="date"
                  value={formContrato.end_date}
                  onChange={(e) => setFormContrato({ ...formContrato, end_date: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <input
                type="checkbox"
                id="gerar_cobrancas"
                checked={formContrato.gerar_cobrancas_automaticas}
                onChange={(e) =>
                  setFormContrato({ ...formContrato, gerar_cobrancas_automaticas: e.target.checked })
                }
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="gerar_cobrancas" className="text-xs cursor-pointer">
                Gerar parcelas e cobranças a receber automaticamente no fluxo de caixa
              </Label>
            </div>

            <div className="p-3.5 rounded-lg border bg-muted/40 space-y-3">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="pagamento_ja_realizado"
                  checked={formContrato.pagamento_ja_realizado}
                  onChange={(e) =>
                    setFormContrato({ ...formContrato, pagamento_ja_realizado: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <Label htmlFor="pagamento_ja_realizado" className="text-xs font-semibold cursor-pointer">
                  Registrar pagamento como já realizado (quitação imediata ou retroativa)
                </Label>
              </div>

              {formContrato.pagamento_ja_realizado && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="space-y-1">
                    <Label htmlFor="data_pagamento_realizada" className="text-xs">
                      Data Real do Pagamento
                    </Label>
                    <Input
                      id="data_pagamento_realizada"
                      type="date"
                      value={formContrato.data_pagamento_realizada}
                      onChange={(e) =>
                        setFormContrato({ ...formContrato, data_pagamento_realizada: e.target.value })
                      }
                      required={formContrato.pagamento_ja_realizado}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="forma_pagamento_contrato" className="text-xs">
                      Forma de Pagamento
                    </Label>
                    <select
                      id="forma_pagamento_contrato"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                      value={formContrato.forma_pagamento}
                      onChange={(e) =>
                        setFormContrato({ ...formContrato, forma_pagamento: e.target.value })
                      }
                    >
                      <option value="pix">PIX</option>
                      <option value="credit_card">Cartão de Crédito</option>
                      <option value="debit_card">Cartão de Débito</option>
                      <option value="bank_slip">Boleto Bancário</option>
                      <option value="bank_transfer">Transferência</option>
                      <option value="cash">Dinheiro em Espécie</option>
                      <option value="other">Outro</option>
                    </select>
                  </div>

                  {contas && contas.length > 0 && (
                    <div className="space-y-1">
                      <Label htmlFor="conta_pagamento_contrato" className="text-xs">
                        Conta de Destino
                      </Label>
                      <select
                        id="conta_pagamento_contrato"
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                        value={formContrato.account_id}
                        onChange={(e) =>
                          setFormContrato({ ...formContrato, account_id: e.target.value })
                        }
                      >
                        {contas.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setModalNovoContratoAberto(false)}>
                Cancelar
              </Button>
              <Button type="submit">Cadastrar Contrato</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL: NOVA RECEITA / DESPESA */}
      {/* ========================================================================= */}
      <Dialog open={modalNovaCobrancaAberto} onOpenChange={setModalNovaCobrancaAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {formCobranca.type === "income" ? "Nova Receita / Cobrança" : "Nova Despesa / Conta a Pagar"}
            </DialogTitle>
            <DialogDescription>
              {formCobranca.type === "income"
                ? "Registre uma cobrança avulsa para um cliente."
                : "Lance contas a pagar, aluguel, salários, fornecedores ou materiais."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={criarCobranca} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tipo">Tipo de Operação</Label>
              <select
                id="tipo"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                value={formCobranca.type}
                onChange={(e) => setFormCobranca({ ...formCobranca, type: e.target.value as any })}
              >
                <option value="income">Receita (Entrada / Cobrança)</option>
                <option value="expense">Despesa (Saída / Conta a Pagar)</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cobranca_titulo">Descrição / Título</Label>
              <Input
                id="cobranca_titulo"
                placeholder="Ex: Aluguel do escritório, Manutenção avulsa"
                value={formCobranca.title}
                onChange={(e) => setFormCobranca({ ...formCobranca, title: e.target.value })}
                required
              />
            </div>

            {formCobranca.type === "income" && (
              <div className="space-y-2">
                <Label htmlFor="cobranca_cliente">Cliente (Opcional)</Label>
                <select
                  id="cobranca_cliente"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  value={formCobranca.contact_id}
                  onChange={(e) => setFormCobranca({ ...formCobranca, contact_id: e.target.value })}
                >
                  <option value="">Nenhum cliente vinculado</option>
                  {(contatosParaSelecao.length > 0 ? contatosParaSelecao : clientes).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name} {c.phone_number ? `(${c.phone_number})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cobranca_valor">Valor (R$)</Label>
                <Input
                  id="cobranca_valor"
                  type="text"
                  placeholder="0,00"
                  value={formCobranca.amount}
                  onChange={(e) => setFormCobranca({ ...formCobranca, amount: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cobranca_vencimento">Vencimento</Label>
                <Input
                  id="cobranca_vencimento"
                  type="date"
                  value={formCobranca.due_date}
                  onChange={(e) => setFormCobranca({ ...formCobranca, due_date: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cobranca_status">Situação Inicial</Label>
              <select
                id="cobranca_status"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                value={formCobranca.status}
                onChange={(e) => setFormCobranca({ ...formCobranca, status: e.target.value })}
              >
                <option value="pending">Pendente (A vencer)</option>
                <option value="paid">Já Quitado / Pago</option>
              </select>
            </div>

            {formCobranca.status === "paid" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="forma">Forma de Pagamento</Label>
                  <select
                    id="forma"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    value={formCobranca.payment_method}
                    onChange={(e) => setFormCobranca({ ...formCobranca, payment_method: e.target.value })}
                  >
                    <option value="pix">Pix</option>
                    <option value="credit_card">Cartão de Crédito</option>
                    <option value="debit_card">Cartão de Débito</option>
                    <option value="bank_slip">Boleto Bancário</option>
                    <option value="bank_transfer">Transferência</option>
                    <option value="cash">Dinheiro</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="conta">Conta Financeira</Label>
                  <select
                    id="conta"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    value={formCobranca.account_id}
                    onChange={(e) => setFormCobranca({ ...formCobranca, account_id: e.target.value })}
                  >
                    {contas.map((ct) => (
                      <option key={ct.id} value={ct.id}>
                        {ct.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setModalNovaCobrancaAberto(false)}>
                Cancelar
              </Button>
              <Button type="submit">Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL: REGISTRAR PAGAMENTO */}
      {/* ========================================================================= */}
      <Dialog open={modalPagarAberto} onOpenChange={setModalPagarAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Pagamento / Baixa</DialogTitle>
            <DialogDescription>
              {cobrancaSelecionada?.title} • Total: {formatarMoeda(cobrancaSelecionada?.billed_cents)}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={confirmarPagamento} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pag_valor">Valor Pago / Baixado (R$)</Label>
              <Input
                id="pag_valor"
                type="text"
                value={formPagamento.valor}
                onChange={(e) => setFormPagamento({ ...formPagamento, valor: e.target.value })}
                required
              />
              <p className="text-xs text-muted-foreground">
                Suporta pagamentos parciais. Se o valor for inferior ao total, a fatura ficará como &quot;Parcial&quot;.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pag_data">Data Efetiva</Label>
                <Input
                  id="pag_data"
                  type="date"
                  value={formPagamento.data_pagamento}
                  onChange={(e) => setFormPagamento({ ...formPagamento, data_pagamento: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pag_forma">Forma de Pagamento</Label>
                <select
                  id="pag_forma"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  value={formPagamento.forma_pagamento}
                  onChange={(e) => setFormPagamento({ ...formPagamento, forma_pagamento: e.target.value })}
                >
                  <option value="pix">Pix</option>
                  <option value="credit_card">Cartão de Crédito</option>
                  <option value="debit_card">Cartão de Débito</option>
                  <option value="bank_slip">Boleto Bancário</option>
                  <option value="bank_transfer">Transferência Bancária</option>
                  <option value="cash">Dinheiro em Espécie</option>
                  <option value="other">Outro</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pag_conta">Conta Financeira de Destino/Origem</Label>
              <select
                id="pag_conta"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                value={formPagamento.account_id}
                onChange={(e) => setFormPagamento({ ...formPagamento, account_id: e.target.value })}
              >
                <option value="">Sem vínculo com conta</option>
                {contas.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pag_obs">Observações</Label>
              <Input
                id="pag_obs"
                placeholder="Ex: Comprovante Pix anexado, pagamento adiantado"
                value={formPagamento.observacoes}
                onChange={(e) => setFormPagamento({ ...formPagamento, observacoes: e.target.value })}
              />
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setModalPagarAberto(false)}>
                Cancelar
              </Button>
              <Button type="submit">Confirmar Baixa</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL: ESTORNAR COBRANÇA */}
      {/* ========================================================================= */}
      <Dialog open={modalEstornarAberto} onOpenChange={setModalEstornarAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Estornar Pagamento</DialogTitle>
            <DialogDescription>
              O valor pago ({formatarMoeda(cobrancaSelecionada?.paid_cents)}) será zerado e a cobrança marcada como estornada na auditoria.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={confirmarEstorno} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="estorno_motivo">Motivo do Estorno</Label>
              <Input
                id="estorno_motivo"
                placeholder="Ex: Cancelamento a pedido do cliente, erro no lançamento"
                value={formEstorno.motivo}
                onChange={(e) => setFormEstorno({ motivo: e.target.value })}
                required
              />
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setModalEstornarAberto(false)}>
                Voltar
              </Button>
              <Button type="submit" variant="destructive">
                Confirmar Estorno
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* MODAL / DRAWER: FICHA FINANCEIRA COMPLETA DO CLIENTE */}
      {/* ========================================================================= */}
      <Dialog open={modalClienteAberto} onOpenChange={setModalClienteAberto}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Ficha Financeira do Cliente</span>
              {perfilClienteDetalhado?.campos_financeiros?.financial_status === "inadimplente" ? (
                <Badge variant="destructive">Inadimplente</Badge>
              ) : (
                <Badge className="bg-emerald-600">Em Dia</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Cadastro unificado do CRM, dados cadastrais, histórico de contratos e pagamentos.
            </DialogDescription>
          </DialogHeader>

          {perfilClienteDetalhado ? (
            <div className="space-y-6 pt-2">
              {/* Formulário de Edição Unificada */}
              <div className="p-4 rounded-lg border bg-muted/20 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <Building className="h-4 w-4 text-primary" />
                    Dados Cadastrais e Comerciais
                  </h3>
                  <Button size="sm" onClick={salvarCliente} className="h-7 text-xs gap-1">
                    <Check className="h-3.5 w-3.5" />
                    Salvar Alterações
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <Label className="text-xs">Nome / Razão Social</Label>
                    <Input
                      value={formClienteEdicao.display_name}
                      onChange={(e) =>
                        setFormClienteEdicao({ ...formClienteEdicao, display_name: e.target.value })
                      }
                      className="h-8 text-xs"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Nome Fantasia</Label>
                    <Input
                      value={formClienteEdicao.trade_name}
                      onChange={(e) =>
                        setFormClienteEdicao({ ...formClienteEdicao, trade_name: e.target.value })
                      }
                      className="h-8 text-xs"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">WhatsApp</Label>
                    <Input
                      value={formClienteEdicao.phone_number}
                      onChange={(e) =>
                        setFormClienteEdicao({ ...formClienteEdicao, phone_number: e.target.value })
                      }
                      className="h-8 text-xs"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">E-mail</Label>
                    <Input
                      value={formClienteEdicao.email}
                      onChange={(e) =>
                        setFormClienteEdicao({ ...formClienteEdicao, email: e.target.value })
                      }
                      className="h-8 text-xs"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Instagram (@usuario)</Label>
                    <Input
                      value={formClienteEdicao.instagram}
                      onChange={(e) =>
                        setFormClienteEdicao({ ...formClienteEdicao, instagram: e.target.value })
                      }
                      className="h-8 text-xs"
                      placeholder="@perfil"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">CPF ou CNPJ</Label>
                    <Input
                      value={formClienteEdicao.document}
                      onChange={(e) =>
                        setFormClienteEdicao({ ...formClienteEdicao, document: e.target.value })
                      }
                      className="h-8 text-xs"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Cliente Desde (Data de Início)</Label>
                    <Input
                      type="date"
                      value={formClienteEdicao.client_since}
                      onChange={(e) =>
                        setFormClienteEdicao({ ...formClienteEdicao, client_since: e.target.value })
                      }
                      className="h-8 text-xs"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Situação Comercial</Label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs shadow-sm"
                      value={formClienteEdicao.commercial_status}
                      onChange={(e) =>
                        setFormClienteEdicao({ ...formClienteEdicao, commercial_status: e.target.value })
                      }
                    >
                      <option value="lead">Lead / Em Negociação</option>
                      <option value="cliente_ativo">Cliente Ativo</option>
                      <option value="ex_cliente">Ex-Cliente / Churn</option>
                    </select>
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Observações Financeiras Internas</Label>
                  <Input
                    value={formClienteEdicao.financial_notes}
                    onChange={(e) =>
                      setFormClienteEdicao({ ...formClienteEdicao, financial_notes: e.target.value })
                    }
                    className="h-8 text-xs"
                    placeholder="Condições especiais, preferências de pagamento, etc."
                  />
                </div>
              </div>

              {/* Serviços e Contratos do Cliente */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-primary" />
                    Contratos e Serviços Contratados ({perfilClienteDetalhado.contratos?.length || 0})
                  </h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFormContrato((prev) => ({ ...prev, contact_id: perfilClienteDetalhado.id }));
                      setModalNovoContratoAberto(true);
                    }}
                    className="h-7 text-xs gap-1"
                  >
                    <Plus className="h-3 w-3" />
                    Contratar Novo Serviço
                  </Button>
                </div>

                <div className="space-y-2">
                  {perfilClienteDetalhado.contratos?.length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 border rounded text-center">
                      Nenhum contrato formal cadastrado para este cliente.
                    </p>
                  )}
                  {perfilClienteDetalhado.contratos?.map((ct: any) => (
                    <div key={ct.id} className="p-3 border rounded-lg flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-sm">{ct.service_name}</div>
                        <div className="text-muted-foreground">
                          Modalidade: {ct.modality} • Vence dia {ct.due_day} • Início: {formatarData(ct.start_date)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-sm">{formatarMoeda(ct.amount_cents)}</div>
                        <Badge variant={ct.status === "active" ? "default" : "secondary"}>
                          {ct.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Histórico Financeiro e Cobranças */}
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  Histórico de Cobranças e Pagamentos ({perfilClienteDetalhado.faturas?.length || 0})
                </h3>

                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left font-medium text-muted-foreground">
                        <th className="p-2">Título</th>
                        <th className="p-2">Cobrado</th>
                        <th className="p-2">Pago</th>
                        <th className="p-2">Vencimento</th>
                        <th className="p-2">Forma</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {perfilClienteDetalhado.faturas?.map((fat: any) => (
                        <tr key={fat.id}>
                          <td className="p-2 font-medium">{fat.title}</td>
                          <td className="p-2 font-semibold">{formatarMoeda(fat.billed_cents)}</td>
                          <td className="p-2 text-emerald-600 font-semibold">{formatarMoeda(fat.paid_cents)}</td>
                          <td className="p-2">{formatarData(fat.due_date)}</td>
                          <td className="p-2 uppercase">{fat.payment_method || "-"}</td>
                          <td className="p-2">
                            {fat.status === "paid" && <Badge className="bg-emerald-600">Pago</Badge>}
                            {fat.status === "pending" && <Badge variant="secondary">Pendente</Badge>}
                            {fat.status === "partially_paid" && <Badge className="bg-amber-600">Parcial</Badge>}
                            {fat.status === "overdue" && <Badge variant="destructive">Vencido</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center p-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
