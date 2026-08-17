// backend/src/lib/account_deletion.js
// Exclusão de conta com PROTOCOLO.
//
// O protocolo é o número que se devolve ao titular ("seu pedido foi cumprido, protocolo X") e, mais
// tarde, a única forma de provar que foi cumprido — porque a conta não existe mais para contar essa
// história. Ele mora em `audit_log`, que é a única tabela envolvida SEM foreign key para `usuarios`
// e por isso sobrevive ao próprio delete que registra.
//
// ─── Três regras que este módulo existe para não deixar ninguém esquecer ────────────────────────
//
// 1. O INSERT do protocolo e o DELETE andam na MESMA transação. A auditoria normal do sistema é
//    fire-and-forget (`recordAudit`), o que é certo para uma trilha de acesso e errado para isto:
//    conta apagada sem protocolo é exclusão sem prova, e protocolo sem conta apagada é mentira.
//
// 2. `whatsapp_optins` NUNCA leva DELETE — é a trilha que se mostra à Meta. Apagar o usuário não
//    revoga nada, porque o aceite pertence ao TELEFONE, não à conta: o mesmo número voltando a
//    agendar continuaria recebendo mensagem. Por isso entra um evento `revoked` por cima, no escopo
//    de plataforma (que cala inclusive os números próprios dos salões).
//
// 3. Assinatura ativa no gateway não é apagada por CASCADE — a linha em `subscriptions` some, a
//    cobrança recorrente no Asaas continua viva e os webhooks passam a chegar órfãos. Por isso ela
//    é cancelada NO ASAAS antes, e o que o gateway respondeu entra no protocolo. Gateway antigo
//    (Mercado Pago) não tem cancelamento automático aqui: continua barrando até decisão explícita.
//
// 4. Arquivo em disco não tem foreign key. O CASCADE limpa as linhas e deixa as fotos órfãs
//    ocupando espaço para sempre. Os caminhos são coletados DENTRO da transação (depois do DELETE
//    eles não existem mais para serem lidos) e apagados DEPOIS do commit — nunca antes, senão um
//    rollback devolveria a conta sem as imagens dela.
import crypto from 'node:crypto';
import { pool } from './db.js';
import { sqlTimestamp } from './logger.js';
import { removeAvatarFile } from './avatar.js';
import { removeServiceImageFile } from './service_images.js';
import { removeEstablishmentImageFile } from './establishment_images.js';
import { createAsaasPayments } from '../services/asaas/payments.js';

export const ACAO_EXCLUSAO = 'usuario.delete';

/** Alfabeto sem I/O/0/1: o protocolo é lido em voz alta e digitado por gente. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function sufixoAleatorio(tamanho = 4) {
  const bytes = crypto.randomBytes(tamanho);
  let out = '';
  for (let i = 0; i < tamanho; i += 1) out += ALFABETO[bytes[i] % ALFABETO.length];
  return out;
}

/**
 * `AO-DEL-20260817-143012-K7QP`.
 *
 * O instante vem de `sqlTimestamp()`, o mesmo relógio (LOG_TZ) que carimba `audit_log.criado_em` —
 * então o número do protocolo e a data da linha que ele identifica sempre batem. Derivar de
 * `new Date()` aqui produziria divergência de fuso entre os dois em qualquer máquina fora do
 * LOG_TZ, e um protocolo que não bate com a própria data é uma prova que se contradiz.
 */
export function gerarProtocolo({ stamp = sqlTimestamp(), sufixo = sufixoAleatorio() } = {}) {
  const digitos = String(stamp).slice(0, 19).replace(/\D/g, '');
  return `AO-DEL-${digitos.slice(0, 8)}-${digitos.slice(8, 14)}-${sufixo}`;
}

/** Erro de regra de negócio: vira status HTTP na rota, em vez de 500. */
export class ExclusaoBloqueada extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

const STATUS_ASSINATURA_VIVA = ['initiated', 'pending', 'authorized', 'active', 'paused', 'past_due'];

/**
 * O que desaparece junto. Serve para a tela mostrar ANTES de perguntar "tem certeza?", e é gravado
 * no protocolo — depois do cascade não há como reconstruir o tamanho do que foi apagado.
 *
 * `clientes_afetados` é o número que costuma mudar a decisão: são pessoas que não pediram nada e
 * perdem o próprio histórico junto com o salão.
 */
export async function previewExclusao(id, { deps = {} } = {}) {
  const query = deps.query || ((sql, params) => pool.query(sql, params));
  const alvo = Number(id);
  if (!Number.isInteger(alvo) || alvo <= 0) throw new ExclusaoBloqueada('id_invalido', 'id invalido');

  const [usuarios] = await query(
    `SELECT id, nome, email, telefone, tipo, asaas_customer_id, plan, plan_status, criado_em
       FROM usuarios WHERE id = ?`,
    [alvo],
  );
  const usuario = usuarios?.[0];
  if (!usuario) throw new ExclusaoBloqueada('nao_encontrado', 'estabelecimento nao encontrado');

  const [agendRows] = await query(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT cliente_id) AS clientes
       FROM agendamentos WHERE estabelecimento_id = ?`,
    [alvo],
  );
  const [servicoRows] = await query('SELECT COUNT(*) AS total FROM servicos WHERE estabelecimento_id = ?', [alvo]);
  const [profRows] = await query('SELECT COUNT(*) AS total FROM profissionais WHERE estabelecimento_id = ?', [alvo]);

  const [assinaturas] = await query(
    `SELECT id, plan, gateway, gateway_subscription_id, status, current_period_end
       FROM subscriptions
      WHERE estabelecimento_id = ?
      ORDER BY id DESC`,
    [alvo],
  );
  const viva = (assinaturas || []).find((s) => STATUS_ASSINATURA_VIVA.includes(String(s.status || '').toLowerCase()));

  return {
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      telefone: usuario.telefone,
      tipo: usuario.tipo,
      plan: usuario.plan,
      plan_status: usuario.plan_status,
      criado_em: usuario.criado_em,
      asaas_customer_id: usuario.asaas_customer_id || null,
    },
    impacto: {
      agendamentos: Number(agendRows?.[0]?.total || 0),
      clientes_afetados: Number(agendRows?.[0]?.clientes || 0),
      servicos: Number(servicoRows?.[0]?.total || 0),
      profissionais: Number(profRows?.[0]?.total || 0),
    },
    assinatura_ativa: viva || null,
    assinaturas: assinaturas || [],
  };
}

/**
 * Todo arquivo que esta conta pôs em disco. Roda DENTRO da transação, antes do DELETE: depois dele
 * as linhas que apontam para os arquivos não existem mais, e sem os caminhos não há como achar as
 * fotos — elas ficariam ocupando disco para sempre, sem nada no banco que as mencione.
 *
 * Cada caminho vem com o removedor certo porque os três vivem em pastas diferentes
 * (`uploads/avatars`, `uploads/services`, `uploads/establishments`) e cada lib só sabe apagar da sua.
 */
async function coletarArquivos(conn, id) {
  const arquivos = [];
  const push = (caminho, remover) => { if (caminho) arquivos.push({ caminho, remover }); };

  const [[dono]] = await conn.query('SELECT avatar_url FROM usuarios WHERE id = ?', [id]);
  push(dono?.avatar_url, removeAvatarFile);

  const [profissionais] = await conn.query(
    'SELECT avatar_url FROM profissionais WHERE estabelecimento_id = ? AND avatar_url IS NOT NULL',
    [id],
  );
  for (const p of profissionais || []) push(p.avatar_url, removeAvatarFile);

  const [servicos] = await conn.query(
    'SELECT imagem_url FROM servicos WHERE estabelecimento_id = ? AND imagem_url IS NOT NULL',
    [id],
  );
  for (const s of servicos || []) push(s.imagem_url, removeServiceImageFile);

  const [galeria] = await conn.query(
    'SELECT file_path FROM estabelecimento_imagens WHERE estabelecimento_id = ?',
    [id],
  );
  for (const g of galeria || []) push(g.file_path, removeEstablishmentImageFile);

  return arquivos;
}

/**
 * Apaga os arquivos. Nunca lança: a conta já foi excluída e o protocolo já existe — falhar aqui é
 * lixo em disco, não exclusão incompleta, e derrubar a resposta por isso só esconderia o sucesso.
 * ENOENT conta como sucesso: o arquivo não estar lá é exatamente o estado desejado.
 */
async function apagarArquivos(arquivos) {
  let removidos = 0;
  const falhas = [];
  for (const { caminho, remover } of arquivos) {
    try {
      await remover(caminho);
      removidos += 1;
    } catch (err) {
      if (err?.code === 'ENOENT') { removidos += 1; continue; }
      falhas.push(caminho);
      console.warn('[exclusao][arquivo]', caminho, err?.message || err);
    }
  }
  return { previstos: arquivos.length, removidos, falhas };
}

/**
 * Cancela a assinatura NO GATEWAY, antes de o banco esquecer que ela existia.
 *
 * A ordem é deliberada e o outro lado é pior: cancelando depois do commit, uma falha deixaria a
 * cobrança recorrente viva com o `gateway_subscription_id` já apagado — dinheiro saindo do cartão
 * de alguém sem nada no banco que explique de onde vem. Cancelando antes, uma falha na transação
 * deixa uma assinatura cancelada numa conta que ainda existe: reversível, visível e sem cobrança
 * indevida.
 *
 * `deleteSubscription` (e não `setSubscriptionStatus('INACTIVE')`, que só pausa) porque isto é
 * cancelamento a pedido do titular: a assinatura deixa de existir no Asaas.
 */
async function cancelarNoGateway(assinatura, { payments } = {}) {
  const gateway = String(assinatura?.gateway || '').toLowerCase();
  if (gateway !== 'asaas' || !assinatura?.gateway_subscription_id) {
    return { cancelada: false, motivo: gateway ? `gateway_sem_automacao:${gateway}` : 'sem_gateway' };
  }
  const api = payments || createAsaasPayments();
  await api.deleteSubscription(assinatura.gateway_subscription_id);
  return { cancelada: true, gateway_subscription_id: assinatura.gateway_subscription_id };
}

/**
 * Apaga o estabelecimento e devolve o protocolo. Irreversível — não existe soft delete neste schema.
 *
 * `confirmacao` tem de ser o nome exato da conta. A trava vive no SERVIDOR de propósito: modal de
 * confirmação protege contra o clique distraído, não contra uma chamada de API com o id errado.
 */
export async function excluirEstabelecimento(
  { id, executor, motivo = null, confirmacao = null, ignorarAssinatura = false, contexto = {} },
  { deps = {} } = {},
) {
  const getConnection = deps.getConnection || (() => pool.getConnection());
  const preview = await previewExclusao(id, { deps });

  if (preview.usuario.tipo !== 'estabelecimento') {
    throw new ExclusaoBloqueada('nao_e_estabelecimento', 'esta rota so exclui estabelecimentos');
  }

  // Comparação frouxa no espaço em branco, exata no resto: quem digita o nome copiando da tela
  // costuma trazer um espaço sobrando, e isso não é o erro contra o qual a trava existe.
  const esperado = String(preview.usuario.nome || '').trim();
  if (esperado && String(confirmacao || '').trim() !== esperado) {
    throw new ExclusaoBloqueada('confirmacao_invalida', 'confirme digitando o nome exato do estabelecimento', {
      esperado,
    });
  }

  let gateway = { cancelada: false, motivo: 'sem_assinatura' };
  if (preview.assinatura_ativa) {
    try {
      gateway = await cancelarNoGateway(preview.assinatura_ativa, { payments: deps.asaasPayments });
    } catch (err) {
      gateway = { cancelada: false, motivo: 'falha_no_gateway', erro: err?.message || String(err) };
    }
    // Não cancelou — ou o gateway é antigo (Mercado Pago, sem automação aqui) ou o Asaas recusou.
    // Seguir assim mesmo é decisão de gente, não default: sem isso a cobrança continuaria viva com
    // o id dela já apagado do banco.
    if (!gateway.cancelada && !ignorarAssinatura) {
      throw new ExclusaoBloqueada(
        'assinatura_ativa',
        gateway.motivo === 'falha_no_gateway'
          ? `nao foi possivel cancelar no gateway: ${gateway.erro}`
          : 'assinatura ativa num gateway sem cancelamento automatico: cancele la antes',
        { assinatura: preview.assinatura_ativa, gateway },
      );
    }
  }

  const protocolo = gerarProtocolo();
  const criadoEm = sqlTimestamp();
  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Trava a linha: entre o preview e o COMMIT, ninguém mais mexe nesta conta.
    const [travadas] = await conn.query(
      'SELECT id, nome, email, telefone, tipo, criado_em FROM usuarios WHERE id = ? FOR UPDATE',
      [preview.usuario.id],
    );
    const alvo = travadas?.[0];
    if (!alvo) throw new ExclusaoBloqueada('nao_encontrado', 'estabelecimento nao encontrado');

    // Antes do DELETE, enquanto as linhas que apontam para as fotos ainda existem.
    const arquivos = await coletarArquivos(conn, alvo.id);

    // Revogação do WhatsApp ANTES do delete: o telefone é lido da linha que vai deixar de existir.
    if (alvo.telefone) {
      await conn.query(
        `INSERT INTO whatsapp_optins
           (telefone_e164, evento, usuario_id, estabelecimento_id, origem, texto)
         VALUES (?, 'revoked', ?, NULL, 'whatsapp_parar', ?)`,
        [alvo.telefone, alvo.id, `Revogado na exclusao da conta a pedido do titular. Protocolo ${protocolo}`],
      );
    }

    // O protocolo. Escrito à mão, e não por `recordAudit`, porque aquele é fire-and-forget e este
    // precisa cair junto com o DELETE se algo falhar.
    await conn.query(
      `INSERT INTO audit_log
         (criado_em, ator_tipo, ator_email, acao, entidade, entidade_id, estabelecimento_id,
          resultado, motivo, ip, user_agent, dados_antes, metadados)
       VALUES (?, 'admin', ?, ?, 'usuario', ?, ?, 'sucesso', ?, ?, ?, ?, ?)`,
      [
        criadoEm,
        executor || null,
        ACAO_EXCLUSAO,
        String(alvo.id),
        alvo.id,
        motivo ? String(motivo).slice(0, 255) : `protocolo ${protocolo}`,
        contexto.ip || null,
        contexto.userAgent || null,
        JSON.stringify({
          id: alvo.id,
          tipo: alvo.tipo,
          nome: alvo.nome,
          email: alvo.email,
          telefone: alvo.telefone,
          criado_em: alvo.criado_em,
        }),
        JSON.stringify({
          protocolo,
          impacto: preview.impacto,
          assinatura: preview.assinatura_ativa || null,
          asaas_customer_id: preview.usuario.asaas_customer_id,
          assinatura_ignorada: Boolean(preview.assinatura_ativa && !gateway.cancelada && ignorarAssinatura),
          gateway,
          // Quantos arquivos ESTA exclusão vai tentar apagar. O resultado da limpeza não cabe aqui:
          // ela acontece depois do commit, e o protocolo é escrito dentro dele. Quem precisa saber
          // se sobrou lixo em disco recebe isso na resposta da rota.
          arquivos_previstos: arquivos.length,
        }),
      ],
    );

    await conn.query('DELETE FROM usuarios WHERE id = ?', [alvo.id]);
    await conn.commit();

    // Só agora: enquanto houvesse chance de rollback, apagar arquivo devolveria a conta sem as
    // imagens dela — e imagem apagada não volta.
    const limpeza = await apagarArquivos(arquivos);

    return {
      protocolo,
      criado_em: criadoEm,
      usuario: preview.usuario,
      impacto: preview.impacto,
      gateway,
      arquivos: limpeza,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * O histórico. Lê da `audit_log`, que é onde o protocolo vive — e por isso continua respondendo
 * muito depois de a conta ter deixado de existir.
 *
 * O protocolo sai de `metadados.protocolo`, com fallback para `motivo`: as exclusões feitas pelo
 * script de linha de comando, antes desta tela existir, gravavam o número lá.
 */
export async function listarProtocolos({ limit = 100 } = {}, { deps = {} } = {}) {
  const query = deps.query || ((sql, params) => pool.query(sql, params));
  const max = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const [rows] = await query(
    `SELECT id, criado_em, ator_email, entidade_id, estabelecimento_id, motivo, ip,
            COALESCE(
              JSON_UNQUOTE(JSON_EXTRACT(metadados, '$.protocolo')),
              NULLIF(REGEXP_SUBSTR(motivo, 'AO-DEL-[0-9]{8}-[0-9]{6}-[A-Z0-9]{4}'), '')
            ) AS protocolo,
            JSON_UNQUOTE(JSON_EXTRACT(dados_antes, '$.nome'))     AS nome,
            JSON_UNQUOTE(JSON_EXTRACT(dados_antes, '$.email'))    AS email,
            JSON_UNQUOTE(JSON_EXTRACT(dados_antes, '$.telefone')) AS telefone,
            JSON_UNQUOTE(JSON_EXTRACT(dados_antes, '$.tipo'))     AS tipo,
            JSON_EXTRACT(metadados, '$.impacto')                  AS impacto
       FROM audit_log
      WHERE acao = ?
      ORDER BY id DESC
      LIMIT ?`,
    [ACAO_EXCLUSAO, max],
  );
  return (rows || []).map((r) => ({
    ...r,
    impacto: typeof r.impacto === 'string' ? safeJson(r.impacto) : r.impacto,
  }));
}

function safeJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}
