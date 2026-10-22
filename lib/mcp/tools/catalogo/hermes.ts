/**
 * Capacidades de Gerência Técnica do Hermes (MCP Tools).
 *
 * Fornece ao Hermes controle operacional amplo e auditável sobre clientes,
 * oportunidades, funis, tarefas, notas internas, agentes de IA, automações e governança.
 */

import { declararTools } from "./tipos";

export const TOOLS_HERMES = declararTools([
  // ── Clientes e Contatos ─────────────────────────────────────────────────────
  {
    name: "crm_list_contacts",
    category: "read",
    rotulo: "Listar contatos cadastrados",
    explicacao:
      "Lista pessoas e clientes cadastrados com busca por texto, paginação e filtros.",
    oQueToca: "Contatos e clientes",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_create_contact",
    category: "write",
    rotulo: "Cadastrar novo contato",
    explicacao:
      "Cadastra uma nova pessoa ou cliente com validação estrita de dados e duplicidade.",
    oQueToca: "Contatos e clientes",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_update_contact",
    category: "write",
    rotulo: "Atualizar cadastro do contato",
    explicacao:
      "Atualiza telefone, e-mail, nome, marcadores e observações do cadastro do cliente.",
    oQueToca: "Contatos e clientes",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_archive_contact",
    category: "write",
    rotulo: "Arquivar cadastro do contato",
    explicacao:
      "Arquiva o cadastro de um cliente mantendo o histórico de conversas e transações.",
    oQueToca: "Contatos e clientes",
    risco: "critico",
    pacotes: ["organizar"],
  },

  // ── Leads e Oportunidades ───────────────────────────────────────────────────
  {
    name: "crm_assign_lead",
    category: "write",
    rotulo: "Atribuir responsável pela oportunidade",
    explicacao:
      "Define qual membro da equipe é responsável por conduzir a oportunidade no funil.",
    oQueToca: "Funil de vendas",
    risco: "atencao",
    pacotes: ["vender", "organizar"],
  },
  {
    name: "crm_archive_lead",
    category: "write",
    rotulo: "Arquivar oportunidade do funil",
    explicacao:
      "Encerra e envia uma oportunidade para a área de arquivados registrando a justificativa.",
    oQueToca: "Funil de vendas",
    risco: "atencao",
    pacotes: ["vender", "organizar"],
  },

  // ── Funis e Etapas ──────────────────────────────────────────────────────────
  {
    name: "crm_create_pipeline",
    category: "write",
    rotulo: "Criar novo funil comercial",
    explicacao:
      "Cria um novo funil com etapas organizadas para vendas ou acompanhamento de clientes.",
    oQueToca: "Funil de vendas",
    risco: "critico",
    pacotes: ["organizar"],
  },
  {
    name: "crm_update_pipeline",
    category: "write",
    rotulo: "Atualizar configurações do funil",
    explicacao:
      "Modifica o título, a descrição e os parâmetros de funcionamento de um funil existente.",
    oQueToca: "Funil de vendas",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_reorder_stage",
    category: "write",
    rotulo: "Reordenar posições das etapas",
    explicacao:
      "Altera a sequência e a ordem das colunas e etapas dentro de um funil de trabalho.",
    oQueToca: "Funil de vendas",
    risco: "atencao",
    pacotes: ["organizar"],
  },

  // ── Produtos e Catálogo ─────────────────────────────────────────────────────
  {
    name: "crm_get_product",
    category: "read",
    rotulo: "Consultar dados do produto",
    explicacao:
      "Consulta os dados completos, valor e detalhes comerciais de um item do catálogo.",
    oQueToca: "Catálogo de produtos",
    risco: "seguro",
    pacotes: ["vender"],
  },
  {
    name: "crm_create_product",
    category: "write",
    rotulo: "Cadastrar novo produto",
    explicacao:
      "Adiciona um item ou serviço ao catálogo com preço de venda e descrição completa.",
    oQueToca: "Catálogo de produtos",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_update_product",
    category: "write",
    rotulo: "Atualizar produto do catálogo",
    explicacao:
      "Altera o valor comercial, o texto descritivo e a disponibilidade de um produto.",
    oQueToca: "Catálogo de produtos",
    risco: "atencao",
    pacotes: ["organizar"],
  },

  // ── Tarefas Operacionais ────────────────────────────────────────────────────
  {
    name: "crm_list_tasks",
    category: "read",
    rotulo: "Listar tarefas da equipe",
    explicacao:
      "Lista as atividades e tarefas pendentes filtradas por prazo, membro ou situação.",
    oQueToca: "Tarefas operacionais",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_get_task",
    category: "read",
    rotulo: "Consultar detalhes da tarefa",
    explicacao:
      "Exibe todas as informações, vínculos com clientes e prazos de uma tarefa específica.",
    oQueToca: "Tarefas operacionais",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_create_task",
    category: "write",
    rotulo: "Criar tarefa para a equipe",
    explicacao:
      "Registra uma nova tarefa operacional com data limite, prioridade e responsável.",
    oQueToca: "Tarefas operacionais",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_update_task",
    category: "write",
    rotulo: "Atualizar dados da tarefa",
    explicacao:
      "Edita título, descrição, prazo de entrega ou pessoa encarregada de uma tarefa.",
    oQueToca: "Tarefas operacionais",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_complete_task",
    category: "write",
    rotulo: "Marcar tarefa como concluída",
    explicacao:
      "Registra a finalização de uma tarefa na linha do tempo com data e autor.",
    oQueToca: "Tarefas operacionais",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_cancel_task",
    category: "write",
    rotulo: "Cancelar tarefa pendente",
    explicacao:
      "Cancela uma tarefa de trabalho registrando a justificativa da interrupção.",
    oQueToca: "Tarefas operacionais",
    risco: "atencao",
    pacotes: ["organizar"],
  },

  // ── Compromissos e Agendamentos ─────────────────────────────────────────────
  {
    name: "crm_get_appointment",
    category: "read",
    rotulo: "Consultar detalhes do agendamento",
    explicacao:
      "Consulta os dados de um horário marcado na agenda incluindo cliente e profissional.",
    oQueToca: "Agenda de compromissos",
    risco: "seguro",
    pacotes: ["atender"],
  },
  {
    name: "crm_create_appointment",
    category: "write",
    rotulo: "Agendar novo compromisso",
    explicacao:
      "Marca um atendimento com data, horário, profissional escolhido e cliente atendido.",
    oQueToca: "Agenda de compromissos",
    risco: "atencao",
    pacotes: ["atender"],
  },
  {
    name: "crm_update_appointment",
    category: "write",
    rotulo: "Modificar horário agendado",
    explicacao:
      "Remarca data, horário ou responsável por um atendimento já registrado na agenda.",
    oQueToca: "Agenda de compromissos",
    risco: "atencao",
    pacotes: ["atender"],
  },

  // ── Observações Internas (Customer Notes) ───────────────────────────────────
  {
    name: "crm_list_customer_notes",
    category: "read",
    rotulo: "Listar anotações internas",
    explicacao:
      "Exibe anotações confidenciais da equipe sobre o cliente que não saem no atendimento.",
    oQueToca: "Notas internas",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_get_customer_note",
    category: "read",
    rotulo: "Ler anotação interna",
    explicacao:
      "Abre o conteúdo completo e o histórico de uma anotação confidencial de cliente.",
    oQueToca: "Notas internas",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_create_customer_note",
    category: "write",
    rotulo: "Criar anotação interna",
    explicacao:
      "Salva uma anotação privada da equipe vinculada ao cliente ou à oportunidade.",
    oQueToca: "Notas internas",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_update_customer_note",
    category: "write",
    rotulo: "Editar anotação interna",
    explicacao:
      "Atualiza o texto ou o título de uma anotação interna mantendo sigilo da equipe.",
    oQueToca: "Notas internas",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_archive_customer_note",
    category: "write",
    rotulo: "Arquivar anotação interna",
    explicacao:
      "Arquiva uma nota confidencial sem apagar o histórico da base de registros.",
    oQueToca: "Notas internas",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_pin_customer_note",
    category: "write",
    rotulo: "Destacar anotação interna",
    explicacao:
      "Fixa ou desafixa um lembrete importante no topo da visualização da equipe.",
    oQueToca: "Notas internas",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_search_customer_notes",
    category: "read",
    rotulo: "Buscar anotações internas",
    explicacao:
      "Localiza anotações privadas por termos de pesquisa garantindo sigilo das informações.",
    oQueToca: "Notas internas",
    risco: "seguro",
    pacotes: ["organizar"],
  },

  // ── Conversas ───────────────────────────────────────────────────────────────
  {
    name: "crm_transfer_conversation",
    category: "write",
    rotulo: "Encaminhar conversa em andamento",
    explicacao:
      "Transfere o atendimento para outro atendente ou setor com mensagem explicativa.",
    oQueToca: "Atendimento e conversas",
    risco: "atencao",
    pacotes: ["atender"],
  },
  {
    name: "crm_close_conversation",
    category: "write",
    rotulo: "Finalizar conversa em andamento",
    explicacao:
      "Conclui um atendimento em andamento registrando o horário de término da conversa.",
    oQueToca: "Atendimento e conversas",
    risco: "atencao",
    pacotes: ["atender"],
  },

  // ── Agentes de IA ───────────────────────────────────────────────────────────
  {
    name: "crm_list_agents",
    category: "read",
    rotulo: "Listar assistentes inteligentes",
    explicacao:
      "Lista os atendentes virtuais cadastrados na empresa e sua disponibilidade atual.",
    oQueToca: "Assistentes inteligentes",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_get_agent",
    category: "read",
    rotulo: "Consultar assistente inteligente",
    explicacao:
      "Mostra detalhes, orientações de atendimento e habilidades de um atendente virtual.",
    oQueToca: "Assistentes inteligentes",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_create_agent",
    category: "write",
    rotulo: "Cadastrar assistente inteligente",
    explicacao:
      "Cria um novo atendente virtual com instruções personalizadas e modelo definido.",
    oQueToca: "Assistentes inteligentes",
    risco: "critico",
    pacotes: ["organizar"],
  },
  {
    name: "crm_update_agent",
    category: "write",
    rotulo: "Atualizar assistente inteligente",
    explicacao:
      "Atualiza orientações, nome, descrição ou capacidades de um atendente virtual.",
    oQueToca: "Assistentes inteligentes",
    risco: "critico",
    pacotes: ["organizar"],
  },
  {
    name: "crm_archive_agent",
    category: "write",
    rotulo: "Arquivar assistente inteligente",
    explicacao:
      "Arquiva um atendente virtual sem perder os atendimentos realizados anteriormente.",
    oQueToca: "Assistentes inteligentes",
    risco: "critico",
    pacotes: ["organizar"],
  },
  {
    name: "crm_activate_agent",
    category: "write",
    rotulo: "Publicar assistente inteligente",
    explicacao:
      "Ativa o atendimento automático do atendente virtual no canal de comunicação.",
    oQueToca: "Assistentes inteligentes",
    risco: "critico",
    pacotes: ["organizar"],
  },
  {
    name: "crm_deactivate_agent",
    category: "write",
    rotulo: "Pausar assistente inteligente",
    explicacao:
      "Pausa o atendimento automático do atendente virtual de forma imediata.",
    oQueToca: "Assistentes inteligentes",
    risco: "critico",
    pacotes: ["organizar"],
  },
  {
    name: "crm_test_agent",
    category: "read",
    rotulo: "Testar assistente inteligente",
    explicacao:
      "Simula uma interação com o atendente virtual em ambiente seguro de testes.",
    oQueToca: "Assistentes inteligentes",
    risco: "seguro",
    pacotes: ["organizar"],
  },

  // ── Automações ──────────────────────────────────────────────────────────────
  {
    name: "crm_list_automations",
    category: "read",
    rotulo: "Listar fluxos de automação",
    explicacao:
      "Lista os fluxos e disparadores automáticos configurados para o atendimento.",
    oQueToca: "Fluxos automáticos",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_get_automation",
    category: "read",
    rotulo: "Consultar fluxo de automação",
    explicacao:
      "Apresenta as condições e ações programadas de um fluxo automático de trabalho.",
    oQueToca: "Fluxos automáticos",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_create_automation",
    category: "write",
    rotulo: "Cadastrar fluxo de automação",
    explicacao:
      "Cria uma regra de automação que executa ações quando certas condições ocorrem.",
    oQueToca: "Fluxos automáticos",
    risco: "critico",
    pacotes: ["organizar"],
  },
  {
    name: "crm_update_automation",
    category: "write",
    rotulo: "Atualizar fluxo de automação",
    explicacao:
      "Modifica os critérios de disparo ou as ações executadas por uma regra automática.",
    oQueToca: "Fluxos automáticos",
    risco: "critico",
    pacotes: ["organizar"],
  },
  {
    name: "crm_test_automation",
    category: "read",
    rotulo: "Testar fluxo de automação",
    explicacao:
      "Valida se um caso de teste preenche os critérios do fluxo sem disparar ações reais.",
    oQueToca: "Fluxos automáticos",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_activate_automation",
    category: "write",
    rotulo: "Ativar fluxo de automação",
    explicacao:
      "Liga a execução contínua de uma regra automática para eventos futuros.",
    oQueToca: "Fluxos automáticos",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_deactivate_automation",
    category: "write",
    rotulo: "Desativar fluxo de automação",
    explicacao:
      "Pausa uma regra automática impedindo novos disparos na organização.",
    oQueToca: "Fluxos automáticos",
    risco: "atencao",
    pacotes: ["organizar"],
  },

  // ── Administração e Governança ──────────────────────────────────────────────
  {
    name: "crm_list_users",
    category: "read",
    rotulo: "Listar membros da equipe",
    explicacao:
      "Lista os colaboradores da empresa com seus respectivos cargos e permissões.",
    oQueToca: "Membros da equipe",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_list_roles",
    category: "read",
    rotulo: "Listar cargos disponíveis",
    explicacao:
      "Apresenta a estrutura de níveis de acesso e cargos disponíveis no sistema.",
    oQueToca: "Níveis de acesso",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_list_permissions",
    category: "read",
    rotulo: "Listar privilégios operacionais",
    explicacao:
      "Lista os privilégios operacionais divididos por áreas funcionais do sistema.",
    oQueToca: "Níveis de acesso",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_list_integrations",
    category: "read",
    rotulo: "Listar conexões ativas",
    explicacao:
      "Verifica a situação das conexões com canais de mensagem e serviços parceiros.",
    oQueToca: "Canais e integrações",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_get_audit_logs",
    category: "read",
    rotulo: "Consultar histórico de ações",
    explicacao:
      "Exibe os registros de auditoria com ações executadas por pessoas e assistentes.",
    oQueToca: "Histórico de ações",
    risco: "seguro",
    pacotes: ["organizar"],
  },
]);

