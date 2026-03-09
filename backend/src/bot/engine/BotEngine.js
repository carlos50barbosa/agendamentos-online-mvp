import crypto from 'node:crypto';
import { detectIntent, normalizeIntentText } from './intents.js';

const STATES = {
  START: 'START',
  AGENDAR_SERVICO: 'AGENDAR_SERVICO',
  AGENDAR_PROFISSIONAL: 'AGENDAR_PROFISSIONAL',
  AGENDAR_DIA: 'AGENDAR_DIA',
  AGENDAR_HORA: 'AGENDAR_HORA',
  AGENDAR_CONFIRMAR: 'AGENDAR_CONFIRMAR',
  REMARCAR_ESCOLHER_AGENDAMENTO: 'REMARCAR_ESCOLHER_AGENDAMENTO',
  REMARCAR_ESCOLHER_DIA: 'REMARCAR_ESCOLHER_DIA',
  REMARCAR_ESCOLHER_HORA: 'REMARCAR_ESCOLHER_HORA',
  REMARCAR_CONFIRMAR: 'REMARCAR_CONFIRMAR',
  CANCELAR_ESCOLHER_AGENDAMENTO: 'CANCELAR_ESCOLHER_AGENDAMENTO',
  CANCELAR_CONFIRMAR: 'CANCELAR_CONFIRMAR',
  DONE: 'DONE',
  HUMANO_OPEN: 'HUMANO_OPEN',
};

const PAGE = { servicos: 8, profissionais: 8, horas: 6, agendamentos: 5 };
const ACTION_DEDUPE_MS = 15000;

function menuText() {
  return [
    'Escolha uma opcao:',
    '1) Agendar',
    '2) Remarcar',
    '3) Cancelar',
    '4) Falar com humano',
    '0) Menu',
  ].join('\n');
}

function handoffText() {
  return 'Certo! Vou te encaminhar para um atendente. Enquanto isso, me diga seu nome.';
}

function parseChoice(text) {
  if (!/^\d+$/.test(String(text || ''))) return null;
  return Number(text);
}

function toDateTimeLabel(iso) {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return String(iso || '');
  }
}

function summarizeError(data, fallback) {
  return data?.message || fallback;
}

function pagedList(items, page, pageSize) {
  const total = Array.isArray(items) ? items.length : 0;
  const safeSize = Math.max(1, Number(pageSize || 1));
  const maxPage = Math.max(0, Math.ceil(total / safeSize) - 1);
  const safePage = Math.min(Math.max(0, Number(page || 0)), maxPage);
  const start = safePage * safeSize;
  return {
    page: safePage,
    maxPage,
    hasMore: safePage < maxPage,
    items: (items || []).slice(start, start + safeSize),
  };
}

function renderList({ title, items, page, pageSize, format }) {
  const paged = pagedList(items, page, pageSize);
  const lines = [title];
  paged.items.forEach((item, idx) => lines.push(`${idx + 1}) ${format(item)}`));
  if (paged.hasMore) lines.push('9) Mais');
  lines.push('0) Menu');
  return { text: lines.join('\n'), paged };
}

function keyForAction({ tenantId, fromPhone, intent, state, agendamentoId, slot }) {
  const raw = [
    Number(tenantId) || 0,
    String(fromPhone || ''),
    String(intent || ''),
    String(state || ''),
    Number(agendamentoId) || 0,
    String(slot || ''),
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function isDuplicateAction(context, actionKey) {
  const lastKey = String(context?.lastActionKey || '');
  const lastAt = Number(context?.lastActionAt || 0);
  return !!lastKey && lastKey === actionKey && (Date.now() - lastAt) < ACTION_DEDUPE_MS;
}

class BotEngine {
  constructor({ actions, sessionStore }) {
    this.actions = actions;
    this.sessionStore = sessionStore;
  }

  async showServices(tenantId, ctx) {
    const result = await this.actions.listServicos(tenantId);
    if (!result.ok || !result.services?.length) {
      return {
        ok: false,
        text: 'Nao consegui carregar servicos agora.',
        endpointCalled: result.endpoint,
        endpointResult: { status: result.status, latency_ms: result.elapsedMs || null },
      };
    }
    const view = renderList({
      title: 'Escolha o servico:',
      items: result.services,
      page: ctx.servicePage || 0,
      pageSize: PAGE.servicos,
      format: (s) => s.nome || `Servico #${s.id}`,
    });
    ctx.servicePage = view.paged.page;
    ctx.serviceOptions = result.services;
    return {
      ok: true,
      text: view.text,
      endpointCalled: result.endpoint,
      endpointResult: { status: result.status, total: result.services.length, page: view.paged.page, latency_ms: result.elapsedMs || null },
    };
  }

  async showProfessionals(tenantId, ctx) {
    const result = await this.actions.listProfissionaisPorServico(tenantId, ctx.servicoId);
    if (!result.ok) {
      return {
        ok: false,
        text: 'Nao consegui carregar profissionais agora.',
        endpointCalled: result.endpoint,
        endpointResult: { status: result.status, latency_ms: result.elapsedMs || null },
      };
    }
    const pros = result.profissionais || [];
    if (!pros.length) {
      ctx.profissionalRequired = false;
      ctx.profissionalId = null;
      ctx.profissionalNome = 'Sem preferencia';
      return {
        ok: true,
        noProfessionalRequired: true,
        text: 'Este servico nao exige profissional especifico.',
        endpointCalled: result.endpoint,
        endpointResult: { status: result.status, total: 0, latency_ms: result.elapsedMs || null },
      };
    }
    ctx.profissionalRequired = true;
    const view = renderList({
      title: 'Escolha o profissional:',
      items: pros,
      page: ctx.professionalPage || 0,
      pageSize: PAGE.profissionais,
      format: (p) => p.nome || `Profissional #${p.id}`,
    });
    ctx.professionalPage = view.paged.page;
    ctx.professionalOptions = pros;
    return {
      ok: true,
      text: view.text,
      endpointCalled: result.endpoint,
      endpointResult: { status: result.status, total: pros.length, page: view.paged.page, latency_ms: result.elapsedMs || null },
    };
  }

  async showDays(tenantId, ctx) {
    const serviceIds = Array.isArray(ctx.servicoIds) && ctx.servicoIds.length ? ctx.servicoIds : [ctx.servicoId].filter(Boolean);
    const result = await this.actions.getNextDaysWithAvailability(tenantId, serviceIds, ctx.profissionalId, 3);
    const days = result.days || [];
    ctx.dayOptions = days;
    if (!days.length) {
      return {
        ok: false,
        text: 'Nao encontrei horarios disponiveis nos proximos dias.',
        endpointCalled: result.endpoint,
        endpointResult: { status: result.status, totalDays: 0, latency_ms: result.elapsedMs || null },
      };
    }
    const lines = ['Escolha o dia:'];
    days.forEach((d, i) => lines.push(`${i + 1}) ${d.label} (${d.totalSlots} horarios)`));
    lines.push('0) Menu');
    return {
      ok: true,
      text: lines.join('\n'),
      endpointCalled: result.endpoint,
      endpointResult: { status: result.status, totalDays: days.length, latency_ms: result.elapsedMs || null },
    };
  }

  async showHours(tenantId, ctx) {
    if (!ctx.diaSelecionado) {
      return { ok: false, text: 'Selecione o dia antes.', endpointCalled: null, endpointResult: { error: 'day_missing' } };
    }
    const serviceIds = Array.isArray(ctx.servicoIds) && ctx.servicoIds.length ? ctx.servicoIds : [ctx.servicoId].filter(Boolean);
    const result = await this.actions.getSlots(tenantId, serviceIds, ctx.profissionalId, { startDate: ctx.diaSelecionado });
    const hours = this.actions.collectHoursForDay(result, ctx.diaSelecionado);
    ctx.hourOptions = hours;
    if (!hours.length) {
      return {
        ok: false,
        text: 'Este dia nao possui horarios livres.',
        endpointCalled: result.endpoint,
        endpointResult: { status: result.status, total: 0, latency_ms: result.elapsedMs || null },
      };
    }
    const view = renderList({
      title: `Escolha o horario para ${ctx.diaSelecionado}:`,
      items: hours,
      page: ctx.hourPage || 0,
      pageSize: PAGE.horas,
      format: (h) => h.label,
    });
    ctx.hourPage = view.paged.page;
    return {
      ok: true,
      text: view.text,
      endpointCalled: result.endpoint,
      endpointResult: { status: result.status, total: hours.length, page: view.paged.page, latency_ms: result.elapsedMs || null },
    };
  }

  async showRemarcaveis(tenantId, fromPhone, ctx) {
    const result = await this.actions.listAgendamentosRemarcaveis(tenantId, fromPhone);
    const items = result.agendamentos || [];
    ctx.remarcarAppointments = items;
    if (!items.length) {
      return {
        ok: false,
        text: 'Nao encontrei agendamentos remarcaveis. Digite 0 para menu.',
        endpointCalled: result.endpoint,
        endpointResult: { status: result.status, total: 0, latency_ms: result.elapsedMs || null },
      };
    }
    const view = renderList({
      title: 'Escolha o agendamento para remarcar:',
      items,
      page: ctx.remarcarPage || 0,
      pageSize: PAGE.agendamentos,
      format: (a) => `${a.servicoNome}${a.profissionalNome ? ` com ${a.profissionalNome}` : ''} - ${toDateTimeLabel(a.inicio)}`,
    });
    ctx.remarcarPage = view.paged.page;
    return {
      ok: true,
      text: view.text,
      endpointCalled: result.endpoint,
      endpointResult: { status: result.status, total: items.length, page: view.paged.page, latency_ms: result.elapsedMs || null },
    };
  }

  async showCancelaveis(tenantId, fromPhone, ctx) {
    const result = await this.actions.listAgendamentosCancelaveis(tenantId, fromPhone);
    const items = result.agendamentos || [];
    ctx.cancelarAppointments = items;
    if (!items.length) {
      return {
        ok: false,
        text: 'Nao encontrei agendamentos cancelaveis. Digite 0 para menu.',
        endpointCalled: result.endpoint,
        endpointResult: { status: result.status, total: 0, latency_ms: result.elapsedMs || null },
      };
    }
    const view = renderList({
      title: 'Escolha o agendamento para cancelar:',
      items,
      page: ctx.cancelarPage || 0,
      pageSize: PAGE.agendamentos,
      format: (a) => `${a.servicoNome}${a.profissionalNome ? ` com ${a.profissionalNome}` : ''} - ${toDateTimeLabel(a.inicio)}`,
    });
    ctx.cancelarPage = view.paged.page;
    return {
      ok: true,
      text: view.text,
      endpointCalled: result.endpoint,
      endpointResult: { status: result.status, total: items.length, page: view.paged.page, latency_ms: result.elapsedMs || null },
    };
  }

  consumeGuard(ctx, seed) {
    const actionKey = keyForAction(seed);
    if (isDuplicateAction(ctx, actionKey)) {
      return { blocked: true, message: 'Recebi a mesma solicitacao agora. Aguarde alguns segundos e tente novamente.' };
    }
    ctx.lastActionKey = actionKey;
    ctx.lastActionAt = Date.now();
    return { blocked: false };
  }

  async movePage(listCtx, field, currentPage, delta, renderFn) {
    listCtx[field] = Math.max(0, Number(currentPage || 0) + delta);
    return renderFn();
  }

  async handleInbound(event) {
    const tenantId = Number(event?.tenantId);
    const fromPhone = String(event?.fromPhone || '').trim();
    const textRaw = String(event?.text || '');
    const text = normalizeIntentText(textRaw);
    const intent = detectIntent(text);

    const session = await this.sessionStore.getSession({ tenantId, fromPhone });
    const prevState = session?.state || STATES.START;
    const ctx = session?.context && typeof session.context === 'object' ? { ...session.context } : {};

    let nextState = prevState;
    let replyText = menuText();
    let action = 'SHOW_MENU';
    let endpointCalled = null;
    let endpointResult = null;
    const choice = parseChoice(text);

    const use = async (state, outcome, name) => {
      nextState = state;
      replyText = outcome.text;
      action = name;
      endpointCalled = outcome.endpointCalled || null;
      endpointResult = outcome.endpointResult || null;
    };

    const isMenu = intent === 'MENU' || text === '0';
    const isHumano = intent === 'HUMANO' || text === '4';
    if (isMenu) {
      nextState = STATES.START;
      Object.keys(ctx).forEach((k) => delete ctx[k]);
      replyText = menuText();
      action = 'SHOW_MENU';
    } else if (isHumano) {
      nextState = STATES.HUMANO_OPEN;
      Object.keys(ctx).forEach((k) => delete ctx[k]);
      replyText = handoffText();
      action = 'HANDOFF_OPEN';
    } else if (text === 'voltar') {
      if (prevState === STATES.AGENDAR_PROFISSIONAL) {
        ctx.servicePage = 0;
        await use(STATES.AGENDAR_SERVICO, await this.showServices(tenantId, ctx), 'BACK');
      } else if (prevState === STATES.AGENDAR_DIA) {
        if (ctx.profissionalRequired) {
          ctx.professionalPage = 0;
          await use(STATES.AGENDAR_PROFISSIONAL, await this.showProfessionals(tenantId, ctx), 'BACK');
        } else {
          ctx.servicePage = 0;
          await use(STATES.AGENDAR_SERVICO, await this.showServices(tenantId, ctx), 'BACK');
        }
      } else if (prevState === STATES.AGENDAR_HORA) {
        await use(STATES.AGENDAR_DIA, await this.showDays(tenantId, ctx), 'BACK');
      } else if (prevState === STATES.AGENDAR_CONFIRMAR) {
        ctx.hourPage = 0;
        await use(STATES.AGENDAR_HORA, await this.showHours(tenantId, ctx), 'BACK');
      } else if (prevState === STATES.REMARCAR_ESCOLHER_DIA) {
        await use(STATES.REMARCAR_ESCOLHER_AGENDAMENTO, await this.showRemarcaveis(tenantId, fromPhone, ctx), 'BACK');
      } else if (prevState === STATES.REMARCAR_ESCOLHER_HORA) {
        await use(STATES.REMARCAR_ESCOLHER_DIA, await this.showDays(tenantId, ctx), 'BACK');
      } else if (prevState === STATES.REMARCAR_CONFIRMAR) {
        ctx.hourPage = 0;
        await use(STATES.REMARCAR_ESCOLHER_HORA, await this.showHours(tenantId, ctx), 'BACK');
      } else if (prevState === STATES.CANCELAR_CONFIRMAR) {
        await use(STATES.CANCELAR_ESCOLHER_AGENDAMENTO, await this.showCancelaveis(tenantId, fromPhone, ctx), 'BACK');
      } else {
        nextState = STATES.START;
        Object.keys(ctx).forEach((k) => delete ctx[k]);
        replyText = menuText();
        action = 'BACK_MENU';
      }
    } else if (prevState === STATES.START) {
      if (intent === 'AGENDAR' || text === '1') {
        ctx.servicePage = 0;
        await use(STATES.AGENDAR_SERVICO, await this.showServices(tenantId, ctx), 'LIST_SERVICOS');
      } else if (intent === 'REMARCAR' || text === '2') {
        ctx.remarcarPage = 0;
        await use(STATES.REMARCAR_ESCOLHER_AGENDAMENTO, await this.showRemarcaveis(tenantId, fromPhone, ctx), 'LIST_REMARCAR');
      } else if (intent === 'CANCELAR' || text === '3') {
        ctx.cancelarPage = 0;
        await use(STATES.CANCELAR_ESCOLHER_AGENDAMENTO, await this.showCancelaveis(tenantId, fromPhone, ctx), 'LIST_CANCELAR');
      } else {
        nextState = STATES.START;
        replyText = menuText();
        action = 'SHOW_MENU';
      }
    } else if (prevState === STATES.AGENDAR_SERVICO) {
      const out = await this.showServices(tenantId, ctx);
      if (!choice) {
        await use(STATES.AGENDAR_SERVICO, { ...out, text: `Digite o numero da opcao.\n${out.text}` }, 'INVALID_INPUT');
      } else {
        const page = pagedList(ctx.serviceOptions || [], ctx.servicePage || 0, PAGE.servicos);
        if (choice === 9) {
          if (!page.hasMore) await use(STATES.AGENDAR_SERVICO, { ...out, text: `Nao ha mais itens.\n${out.text}` }, 'NO_MORE');
          else { ctx.servicePage = (ctx.servicePage || 0) + 1; await use(STATES.AGENDAR_SERVICO, await this.showServices(tenantId, ctx), 'PAGE'); }
        } else if (choice < 1 || choice > page.items.length) {
          await use(STATES.AGENDAR_SERVICO, { ...out, text: `Opcao invalida.\n${out.text}` }, 'INVALID_OPTION');
        } else {
          const sel = page.items[choice - 1];
          ctx.servicoId = sel.id;
          ctx.servicoIds = [sel.id];
          ctx.servicoNome = sel.nome;
          ctx.profissionalId = null;
          ctx.profissionalNome = null;
          ctx.professionalPage = 0;
          const pros = await this.showProfessionals(tenantId, ctx);
          if (pros.noProfessionalRequired) await use(STATES.AGENDAR_DIA, await this.showDays(tenantId, ctx), 'AUTO_DIA');
          else await use(STATES.AGENDAR_PROFISSIONAL, pros, 'LIST_PROFISSIONAIS');
        }
      }
    } else if (prevState === STATES.AGENDAR_PROFISSIONAL) {
      const out = await this.showProfessionals(tenantId, ctx);
      const page = pagedList(ctx.professionalOptions || [], ctx.professionalPage || 0, PAGE.profissionais);
      if (!choice) await use(STATES.AGENDAR_PROFISSIONAL, { ...out, text: `Digite o numero da opcao.\n${out.text}` }, 'INVALID_INPUT');
      else if (choice === 9) {
        if (!page.hasMore) await use(STATES.AGENDAR_PROFISSIONAL, { ...out, text: `Nao ha mais itens.\n${out.text}` }, 'NO_MORE');
        else { ctx.professionalPage = (ctx.professionalPage || 0) + 1; await use(STATES.AGENDAR_PROFISSIONAL, await this.showProfessionals(tenantId, ctx), 'PAGE'); }
      } else if (choice < 1 || choice > page.items.length) await use(STATES.AGENDAR_PROFISSIONAL, { ...out, text: `Opcao invalida.\n${out.text}` }, 'INVALID_OPTION');
      else {
        const sel = page.items[choice - 1];
        ctx.profissionalId = sel.id;
        ctx.profissionalNome = sel.nome;
        ctx.hourPage = 0;
        await use(STATES.AGENDAR_DIA, await this.showDays(tenantId, ctx), 'SELECT_PROFISSIONAL');
      }
    } else if (prevState === STATES.AGENDAR_DIA) {
      const out = await this.showDays(tenantId, ctx);
      if (!choice || choice < 1 || choice > (ctx.dayOptions || []).length) await use(STATES.AGENDAR_DIA, { ...out, text: `Opcao invalida.\n${out.text}` }, 'INVALID_OPTION');
      else {
        ctx.diaSelecionado = ctx.dayOptions[choice - 1].dateKey;
        ctx.hourPage = 0;
        await use(STATES.AGENDAR_HORA, await this.showHours(tenantId, ctx), 'SELECT_DIA');
      }
    } else if (prevState === STATES.AGENDAR_HORA) {
      const out = await this.showHours(tenantId, ctx);
      const page = pagedList(ctx.hourOptions || [], ctx.hourPage || 0, PAGE.horas);
      if (!choice) await use(STATES.AGENDAR_HORA, { ...out, text: `Digite o numero da opcao.\n${out.text}` }, 'INVALID_INPUT');
      else if (choice === 9) {
        if (!page.hasMore) await use(STATES.AGENDAR_HORA, { ...out, text: `Nao ha mais itens.\n${out.text}` }, 'NO_MORE');
        else { ctx.hourPage = (ctx.hourPage || 0) + 1; await use(STATES.AGENDAR_HORA, await this.showHours(tenantId, ctx), 'PAGE'); }
      } else if (choice < 1 || choice > page.items.length) await use(STATES.AGENDAR_HORA, { ...out, text: `Opcao invalida.\n${out.text}` }, 'INVALID_OPTION');
      else {
        const sel = page.items[choice - 1];
        ctx.slotSelecionado = sel.datetime;
        replyText = [
          'Confirmar agendamento?',
          `Servico: ${ctx.servicoNome || '-'}`,
          `Profissional: ${ctx.profissionalNome || 'Sem preferencia'}`,
          `Data/Hora: ${toDateTimeLabel(ctx.slotSelecionado)}`,
          '',
          '1) Confirmar',
          '2) Voltar',
          '0) Menu',
        ].join('\n');
        nextState = STATES.AGENDAR_CONFIRMAR;
        action = 'CONFIRMAR';
        endpointCalled = out.endpointCalled || null;
        endpointResult = out.endpointResult || null;
      }
    } else if (prevState === STATES.AGENDAR_CONFIRMAR) {
      if (text === '2') {
        ctx.hourPage = 0;
        await use(STATES.AGENDAR_HORA, await this.showHours(tenantId, ctx), 'BACK');
      } else if (text !== '1') {
        nextState = STATES.AGENDAR_CONFIRMAR;
        replyText = 'Responda 1 para confirmar, 2 para voltar, 0 para menu.';
        action = 'WAIT_CONFIRM';
      } else {
        const guard = this.consumeGuard(ctx, { tenantId, fromPhone, intent: 'AGENDAR', state: prevState, agendamentoId: 0, slot: ctx.slotSelecionado });
        if (guard.blocked) {
          nextState = STATES.AGENDAR_CONFIRMAR;
          replyText = guard.message;
          action = 'ACTION_GUARD_BLOCK';
        } else {
          const check = await this.actions.getSlots(tenantId, ctx.servicoIds || [ctx.servicoId], ctx.profissionalId, { startDate: ctx.diaSelecionado });
          const free = this.actions.collectHoursForDay(check, ctx.diaSelecionado);
          const stillFree = free.some((h) => h.datetime === ctx.slotSelecionado);
          if (!stillFree) {
            ctx.hourOptions = free;
            ctx.hourPage = 0;
            await use(STATES.AGENDAR_HORA, { ...check, text: 'Esse horario acabou de ser ocupado. Escolha outro horario.' }, 'CONFLICT');
          } else {
            const create = await this.actions.createAgendamento(tenantId, fromPhone, ctx.servicoId, ctx.profissionalId, ctx.slotSelecionado);
            if (create.ok && create.status === 201) {
              const id = create.data?.id || create.data?.agendamentoId || null;
              nextState = STATES.DONE;
              replyText = `Agendamento criado com sucesso!\\nID: ${id || '-'}\\nDigite 0 para menu.`;
              action = 'CREATE_OK';
              endpointCalled = create.endpoint;
              endpointResult = { status: create.status, latency_ms: create.elapsedMs || null };
            } else if (create.status === 409 && String(create.data?.error || '').toLowerCase() === 'slot_ocupado') {
              ctx.hourPage = 0;
              await use(STATES.AGENDAR_HORA, await this.showHours(tenantId, ctx), 'CONFLICT');
            } else {
              nextState = STATES.AGENDAR_CONFIRMAR;
              replyText = summarizeError(create.data, 'Nao foi possivel concluir agora.');
              action = 'CREATE_FAIL';
              endpointCalled = create.endpoint;
              endpointResult = { status: create.status, error: create.data?.error || null, latency_ms: create.elapsedMs || null };
            }
          }
        }
      }
    } else if (prevState === STATES.REMARCAR_ESCOLHER_AGENDAMENTO) {
      const out = await this.showRemarcaveis(tenantId, fromPhone, ctx);
      const page = pagedList(ctx.remarcarAppointments || [], ctx.remarcarPage || 0, PAGE.agendamentos);
      if (!choice) await use(STATES.REMARCAR_ESCOLHER_AGENDAMENTO, { ...out, text: `Digite o numero da opcao.\n${out.text}` }, 'INVALID_INPUT');
      else if (choice === 9) {
        if (!page.hasMore) await use(STATES.REMARCAR_ESCOLHER_AGENDAMENTO, { ...out, text: `Nao ha mais itens.\n${out.text}` }, 'NO_MORE');
        else { ctx.remarcarPage = (ctx.remarcarPage || 0) + 1; await use(STATES.REMARCAR_ESCOLHER_AGENDAMENTO, await this.showRemarcaveis(tenantId, fromPhone, ctx), 'PAGE'); }
      } else if (choice < 1 || choice > page.items.length) await use(STATES.REMARCAR_ESCOLHER_AGENDAMENTO, { ...out, text: `Opcao invalida.\n${out.text}` }, 'INVALID_OPTION');
      else {
        const sel = page.items[choice - 1];
        ctx.agendamentoId = sel.id;
        ctx.clienteId = sel.clienteId;
        ctx.agendamentoInicio = sel.inicio;
        ctx.servicoId = sel.servicoId;
        ctx.servicoIds = sel.servicoIds;
        ctx.servicoNome = sel.servicoNome;
        ctx.profissionalId = sel.profissionalId;
        ctx.profissionalNome = sel.profissionalNome || 'Sem preferencia';
        await use(STATES.REMARCAR_ESCOLHER_DIA, await this.showDays(tenantId, ctx), 'SELECT_AGENDAMENTO');
      }
    } else if (prevState === STATES.REMARCAR_ESCOLHER_DIA) {
      const out = await this.showDays(tenantId, ctx);
      if (!choice || choice < 1 || choice > (ctx.dayOptions || []).length) await use(STATES.REMARCAR_ESCOLHER_DIA, { ...out, text: `Opcao invalida.\n${out.text}` }, 'INVALID_OPTION');
      else {
        ctx.diaSelecionado = ctx.dayOptions[choice - 1].dateKey;
        ctx.hourPage = 0;
        await use(STATES.REMARCAR_ESCOLHER_HORA, await this.showHours(tenantId, ctx), 'SELECT_DIA');
      }
    } else if (prevState === STATES.REMARCAR_ESCOLHER_HORA) {
      const out = await this.showHours(tenantId, ctx);
      const page = pagedList(ctx.hourOptions || [], ctx.hourPage || 0, PAGE.horas);
      if (!choice) await use(STATES.REMARCAR_ESCOLHER_HORA, { ...out, text: `Digite o numero da opcao.\n${out.text}` }, 'INVALID_INPUT');
      else if (choice === 9) {
        if (!page.hasMore) await use(STATES.REMARCAR_ESCOLHER_HORA, { ...out, text: `Nao ha mais itens.\n${out.text}` }, 'NO_MORE');
        else { ctx.hourPage = (ctx.hourPage || 0) + 1; await use(STATES.REMARCAR_ESCOLHER_HORA, await this.showHours(tenantId, ctx), 'PAGE'); }
      } else if (choice < 1 || choice > page.items.length) await use(STATES.REMARCAR_ESCOLHER_HORA, { ...out, text: `Opcao invalida.\n${out.text}` }, 'INVALID_OPTION');
      else {
        const sel = page.items[choice - 1];
        ctx.slotSelecionado = sel.datetime;
        replyText = [
          'Confirmar remarcacao?',
          `Horario atual: ${toDateTimeLabel(ctx.agendamentoInicio)}`,
          `Novo horario: ${toDateTimeLabel(ctx.slotSelecionado)}`,
          '',
          '1) Confirmar',
          '2) Voltar',
          '0) Menu',
        ].join('\n');
        nextState = STATES.REMARCAR_CONFIRMAR;
        action = 'CONFIRMAR_REMARCAR';
        endpointCalled = out.endpointCalled || null;
        endpointResult = out.endpointResult || null;
      }
    } else if (prevState === STATES.REMARCAR_CONFIRMAR) {
      if (text === '2') {
        ctx.hourPage = 0;
        await use(STATES.REMARCAR_ESCOLHER_HORA, await this.showHours(tenantId, ctx), 'BACK');
      } else if (text !== '1') {
        nextState = STATES.REMARCAR_CONFIRMAR;
        replyText = 'Responda 1 para confirmar, 2 para voltar, 0 para menu.';
        action = 'WAIT_CONFIRM';
      } else {
        const guard = this.consumeGuard(ctx, { tenantId, fromPhone, intent: 'REMARCAR', state: prevState, agendamentoId: ctx.agendamentoId, slot: ctx.slotSelecionado });
        if (guard.blocked) {
          nextState = STATES.REMARCAR_CONFIRMAR;
          replyText = guard.message;
          action = 'ACTION_GUARD_BLOCK';
        } else {
          const result = await this.actions.remarcarAgendamento(tenantId, ctx.agendamentoId, ctx.slotSelecionado);
          if (result.ok) {
            nextState = STATES.DONE;
            replyText = `Remarcacao concluida!\\nNovo horario: ${toDateTimeLabel(ctx.slotSelecionado)}\\nDigite 0 para menu.`;
            action = 'REMARCAR_OK';
            endpointCalled = result.endpoint;
            endpointResult = { status: result.status, latency_ms: result.elapsedMs || null };
          } else if (result.status === 409 && String(result.data?.error || '').toLowerCase() === 'slot_ocupado') {
            ctx.hourPage = 0;
            await use(STATES.REMARCAR_ESCOLHER_HORA, await this.showHours(tenantId, ctx), 'CONFLICT');
          } else {
            nextState = STATES.REMARCAR_CONFIRMAR;
            replyText = summarizeError(result.data, 'Nao foi possivel remarcar agora.');
            action = 'REMARCAR_FAIL';
            endpointCalled = result.endpoint;
            endpointResult = { status: result.status, error: result.data?.error || null, latency_ms: result.elapsedMs || null };
          }
        }
      }
    } else if (prevState === STATES.CANCELAR_ESCOLHER_AGENDAMENTO) {
      const out = await this.showCancelaveis(tenantId, fromPhone, ctx);
      const page = pagedList(ctx.cancelarAppointments || [], ctx.cancelarPage || 0, PAGE.agendamentos);
      if (!choice) await use(STATES.CANCELAR_ESCOLHER_AGENDAMENTO, { ...out, text: `Digite o numero da opcao.\n${out.text}` }, 'INVALID_INPUT');
      else if (choice === 9) {
        if (!page.hasMore) await use(STATES.CANCELAR_ESCOLHER_AGENDAMENTO, { ...out, text: `Nao ha mais itens.\n${out.text}` }, 'NO_MORE');
        else { ctx.cancelarPage = (ctx.cancelarPage || 0) + 1; await use(STATES.CANCELAR_ESCOLHER_AGENDAMENTO, await this.showCancelaveis(tenantId, fromPhone, ctx), 'PAGE'); }
      } else if (choice < 1 || choice > page.items.length) await use(STATES.CANCELAR_ESCOLHER_AGENDAMENTO, { ...out, text: `Opcao invalida.\n${out.text}` }, 'INVALID_OPTION');
      else {
        const sel = page.items[choice - 1];
        ctx.agendamentoId = sel.id;
        ctx.clienteId = sel.clienteId;
        ctx.servicoNome = sel.servicoNome;
        ctx.agendamentoInicio = sel.inicio;
        nextState = STATES.CANCELAR_CONFIRMAR;
        replyText = [
          'Cancelar mesmo?',
          `Servico: ${ctx.servicoNome || '-'}`,
          `Horario: ${toDateTimeLabel(ctx.agendamentoInicio)}`,
          '',
          '1) Sim',
          '2) Nao',
          '0) Menu',
        ].join('\n');
        action = 'CANCEL_CONFIRMAR';
        endpointCalled = out.endpointCalled || null;
        endpointResult = out.endpointResult || null;
      }
    } else if (prevState === STATES.CANCELAR_CONFIRMAR) {
      if (text === '2') {
        await use(STATES.CANCELAR_ESCOLHER_AGENDAMENTO, await this.showCancelaveis(tenantId, fromPhone, ctx), 'BACK');
      } else if (text !== '1') {
        nextState = STATES.CANCELAR_CONFIRMAR;
        replyText = 'Responda 1 para confirmar cancelamento, 2 para voltar, 0 para menu.';
        action = 'WAIT_CONFIRM';
      } else {
        const guard = this.consumeGuard(ctx, { tenantId, fromPhone, intent: 'CANCELAR', state: prevState, agendamentoId: ctx.agendamentoId, slot: '' });
        if (guard.blocked) {
          nextState = STATES.CANCELAR_CONFIRMAR;
          replyText = guard.message;
          action = 'ACTION_GUARD_BLOCK';
        } else {
          const result = await this.actions.cancelarAgendamento(tenantId, ctx.agendamentoId, { clienteId: ctx.clienteId || null });
          if (result.ok) {
            nextState = STATES.DONE;
            replyText = 'Agendamento cancelado com sucesso. Digite 0 para menu.';
            action = 'CANCEL_OK';
            endpointCalled = result.endpoint;
            endpointResult = { status: result.status, latency_ms: result.elapsedMs || null };
          } else {
            nextState = STATES.CANCELAR_CONFIRMAR;
            replyText = `${summarizeError(result.data, 'Nao foi possivel cancelar agora.')}\nDigite \"humano\" para atendimento ou 0 para menu.`;
            action = 'CANCEL_FAIL';
            endpointCalled = result.endpoint;
            endpointResult = { status: result.status, error: result.data?.error || null, latency_ms: result.elapsedMs || null };
          }
        }
      }
    } else if (prevState === STATES.HUMANO_OPEN) {
      nextState = STATES.HUMANO_OPEN;
      replyText = 'Seu atendimento humano esta em andamento. Se quiser voltar ao bot, digite 0.';
      action = 'HANDOFF_WAIT';
    } else {
      nextState = STATES.START;
      replyText = menuText();
      action = 'SHOW_MENU';
    }

    await this.sessionStore.saveSession({ tenantId, fromPhone, state: nextState, context: ctx });

    return {
      intent,
      prevState,
      nextState,
      action,
      endpointCalled,
      endpointResult,
      replyText,
      nextContext: ctx,
    };
  }
}

export { BotEngine, STATES, menuText };
