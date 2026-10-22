import { describe, it, expect, vi } from "vitest";
import {
  normalizarTelefone,
  normalizarEmail,
  localizarContatoExistente,
  mesclarDadosComplementares,
} from "@/lib/contacts/deduplicacao";
import {
  CANONICAL_LOST_REASONS,
  ROTULO_DO_MOTIVO_CANONICO,
  rotuloDoMotivoDePerda,
  CATEGORIA_PADRAO_DO_MOTIVO,
} from "@/lib/schemas/leads";
import {
  opcoesDeMotivoDePerda,
  motivoDePerdaAceito,
  OUTRO,
} from "@/lib/leads/motivos-de-perda-do-funil";

describe("Deduplicação de Contatos (lib/contacts/deduplicacao.ts)", () => {
  it("normalizarTelefone limpa pontuações e converte para formato canônico BR quando aplicável", () => {
    expect(normalizarTelefone("(11) 98765-4321")).toBe("+5511987654321");
    expect(normalizarTelefone("11987654321")).toBe("+5511987654321");
    expect(normalizarTelefone("+55 11 98765-4321")).toBe("+5511987654321");
    expect(normalizarTelefone("")).toBeNull();
    expect(normalizarTelefone(null)).toBeNull();
    expect(normalizarTelefone("123")).toBeNull();
  });

  it("normalizarEmail apara espaços e converte para minúsculas", () => {
    expect(normalizarEmail("  Cliente@EMPRESA.com.br  ")).toBe("cliente@empresa.com.br");
    expect(normalizarEmail("teste@dominio.com")).toBe("teste@dominio.com");
    expect(normalizarEmail("invalido")).toBeNull();
    expect(normalizarEmail("")).toBeNull();
    expect(normalizarEmail(null)).toBeNull();
  });

  it("localizarContatoExistente nunca casa apenas pelo nome", async () => {
    const supabaseMock = {
      from: vi.fn(),
    } as any;

    const achado = await localizarContatoExistente(supabaseMock, "org-1", {
      // Nenhum identificador único fornecido
    });

    expect(achado).toBeNull();
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("localizarContatoExistente prioriza external_id", async () => {
    const mockContact = {
      id: "contato-ext",
      organization_id: "org-1",
      name: "Cliente Externo",
      display_name: "Empresa X",
      email: "ext@exemplo.com",
      phone_number: "+5511999991111",
    };

    const maybeSingle = vi.fn().mockResolvedValue({ data: mockContact });
    const isMergedInto = vi.fn().mockReturnValue({ maybeSingle });
    const eqExt = vi.fn().mockReturnValue({ is: isMergedInto });
    const eqOrg = vi.fn().mockReturnValue({ eq: eqExt });
    const select = vi.fn().mockReturnValue({ eq: eqOrg });
    const from = vi.fn().mockReturnValue({ select });

    const supabaseMock = { from } as any;

    const resultado = await localizarContatoExistente(supabaseMock, "org-1", {
      externalId: "ext-12345",
      phone: "+5511999991111",
    });

    expect(resultado).toEqual(mockContact);
    expect(from).toHaveBeenCalledWith("contacts");
    expect(eqOrg).toHaveBeenCalledWith("organization_id", "org-1");
    expect(eqExt).toHaveBeenCalledWith("external_id", "ext-12345");
  });

  it("localizarContatoExistente localiza por e-mail com tenancy isolada", async () => {
    const mockContact = {
      id: "contato-email",
      organization_id: "org-1",
      name: "Cliente Email",
      display_name: null,
      email: "teste@empresa.com",
      phone_number: null,
    };

    const maybeSingle = vi.fn().mockResolvedValue({ data: mockContact });
    const limit = vi.fn().mockReturnValue({ maybeSingle });
    const isMerged = vi.fn().mockReturnValue({ limit });
    const orFilter = vi.fn().mockReturnValue({ is: isMerged });
    const eqOrg = vi.fn().mockReturnValue({ or: orFilter });
    const select = vi.fn().mockReturnValue({ eq: eqOrg });
    const from = vi.fn().mockReturnValue({ select });

    const supabaseMock = { from } as any;

    const resultado = await localizarContatoExistente(supabaseMock, "org-1", {
      email: "  TESTE@EMPRESA.COM  ",
    });

    expect(resultado).toEqual(mockContact);
    expect(eqOrg).toHaveBeenCalledWith("organization_id", "org-1");
    expect(orFilter).toHaveBeenCalledWith(
      "email_normalized.eq.teste@empresa.com,email.eq.teste@empresa.com",
    );
  });

  it("mesclarDadosComplementares só atualiza campos faltantes no contato existente", async () => {
    const atual = {
      name: "Nome Existente",
      display_name: null,
      email: null,
      phone_number: "+5511988887777",
      custom_fields: { tag: "antiga" },
    };

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    const supabaseMock = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "contacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: atual }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        return {};
      }),
    } as any;

    await mesclarDadosComplementares(supabaseMock, "org-1", "contato-1", {
      name: "Novo Nome Sobrescrito (Não deve alterar)",
      display_name: "Empresa Nova (Deve preencher)",
      email: "novo@empresa.com",
      phone_number: "+5511900000000 (Não deve alterar)",
      custom_fields: { nova_chave: "valor_novo" },
    });

    expect(updateMock).toHaveBeenCalled();
    const patchEnviado = updateMock.mock.calls[0][0];

    // Nome e telefone já existiam: NUNCA sobrescreve
    expect(patchEnviado.name).toBeUndefined();
    expect(patchEnviado.phone_number).toBeUndefined();

    // Campos ausentes: devem ser preenchidos
    expect(patchEnviado.display_name).toBe("Empresa Nova (Deve preencher)");
    expect(patchEnviado.email).toBe("novo@empresa.com");
    expect(patchEnviado.email_normalized).toBe("novo@empresa.com");
    expect(patchEnviado.custom_fields).toEqual({
      tag: "antiga",
      nova_chave: "valor_novo",
    });
  });
});

describe("Motivos de Encerramento (lib/schemas/leads.ts & lib/leads/motivos-de-perda-do-funil.ts)", () => {
  const motivosPadrao = [
    "sem_interesse",
    "sem_resposta",
    "numero_invalido",
    "servico_incompativel",
    "contato_duplicado",
  ];

  it("CANONICAL_LOST_REASONS contém todos os novos motivos padronizados de encerramento", () => {
    for (const motivo of motivosPadrao) {
      expect(CANONICAL_LOST_REASONS).toContain(motivo);
    }
    expect(CANONICAL_LOST_REASONS).toContain("other");
  });

  it("ROTULO_DO_MOTIVO_CANONICO mapeia rótulos legíveis em português", () => {
    expect(rotuloDoMotivoDePerda("sem_interesse")).toBe("Sem interesse");
    expect(rotuloDoMotivoDePerda("sem_resposta")).toBe("Sem resposta após os follow-ups");
    expect(rotuloDoMotivoDePerda("numero_invalido")).toBe("Número inválido");
    expect(rotuloDoMotivoDePerda("servico_incompativel")).toBe("Serviço incompatível");
    expect(rotuloDoMotivoDePerda("contato_duplicado")).toBe("Contato duplicado");
    expect(rotuloDoMotivoDePerda("other")).toBe("Outro motivo");
  });

  it("CATEGORIA_PADRAO_DO_MOTIVO categoriza corretamente cada motivo padronizado", () => {
    expect(CATEGORIA_PADRAO_DO_MOTIVO.sem_interesse).toBe("Cliente");
    expect(CATEGORIA_PADRAO_DO_MOTIVO.sem_resposta).toBe("Ausência");
    expect(CATEGORIA_PADRAO_DO_MOTIVO.numero_invalido).toBe("Ausência");
    expect(CATEGORIA_PADRAO_DO_MOTIVO.servico_incompativel).toBe("Nós");
    expect(CATEGORIA_PADRAO_DO_MOTIVO.contato_duplicado).toBe("Cliente");
  });

  it("opcoesDeMotivoDePerda oferece os motivos priorizados no topo sem o motivo de sistema", () => {
    const opcoes = opcoesDeMotivoDePerda([]);
    const valores = opcoes.map((o) => o.valor);

    expect(valores.slice(0, 5)).toEqual([
      "sem_interesse",
      "sem_resposta",
      "numero_invalido",
      "servico_incompativel",
      "contato_duplicado",
    ]);

    expect(valores).not.toContain("moved_to_another_pipeline");
    expect(valores).toContain(OUTRO);
  });

  it("motivoDePerdaAceito aprova os novos motivos canônicos", () => {
    for (const motivo of motivosPadrao) {
      expect(motivoDePerdaAceito(motivo, [])).toBe(true);
    }
    expect(motivoDePerdaAceito("other", [])).toBe(true);
    expect(motivoDePerdaAceito("motivo_inexistente_qualquer", [])).toBe(false);
  });
});

