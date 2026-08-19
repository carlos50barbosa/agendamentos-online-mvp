// backend/scripts/agenda-dia.mjs — leitura read-only da agenda de um dia, em horário LOCAL.
//
//   Uso: node scripts/agenda-dia.mjs <estabelecimentoId> <YYYY-MM-DD> [profissional]
//   Ex.: node scripts/agenda-dia.mjs 194 2026-08-22 Vania
//        node scripts/agenda-dia.mjs 194 2026-08-22 85
//        node scripts/agenda-dia.mjs 194 2026-08-22          (todos os profissionais)
//
// Responde a pergunta que a grade do cliente responde de forma indireta: "o que ocupa este dia,
// e quanto sobra de fato". As FRESTAS são o ponto — um vão de 30min entre dois agendamentos não
// aceita um serviço de 60min, e na tela isso aparece como "tudo agendado", sem explicar por quê.
//
// Reusa getExpediente/activeAppointmentStatusWhere de propósito: é a MESMA resolução que o POST
// de agendamento aplica. Um script que recalculasse o expediente por conta própria poderia
// discordar da rota e mandar procurar bug onde não tem.
import mysql from 'mysql2/promise';
import { config } from '../src/lib/config.js';
import { getExpediente, fmtMin } from '../src/lib/expediente.js';
import { activeAppointmentStatusWhere } from '../src/lib/service_capacity.js';
import { makeUtcFromLocalYMDHM, EST_TZ_OFFSET_MIN } from '../src/lib/datetime_tz.js';

const DIA_MIN = 24 * 60;
const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const estabId = Number(process.argv[2]);
const dataArg = String(process.argv[3] || '').trim();
const profArg = String(process.argv[4] || '').trim();

const ymd = dataArg.match(/^(\d{4})-(\d{2})-(\d{2})$/);
if (!Number.isInteger(estabId) || estabId <= 0 || !ymd) {
  console.error('Uso: node scripts/agenda-dia.mjs <estabelecimentoId> <YYYY-MM-DD> [profissional]');
  process.exit(1);
}
const [, ano, mes, dia] = ymd.map(Number);

// Meia-noite LOCAL do dia pedido, como instante UTC. Todo o resto do script mede minutos a
// partir daqui — assim agendamento que atravessa a meia-noite e bloqueio de vários dias caem no
// mesmo eixo, sem caso especial.
const inicioDiaUtc = makeUtcFromLocalYMDHM(ano, mes, dia, 0, 0, EST_TZ_OFFSET_MIN);
const fimDiaUtc = new Date(inicioDiaUtc.getTime() + DIA_MIN * 60_000);
const minutosLocais = (valor) => (new Date(valor).getTime() - inicioDiaUtc.getTime()) / 60_000;
const recorta = (ini, fim) => [Math.max(0, Math.min(DIA_MIN, ini)), Math.max(0, Math.min(DIA_MIN, fim))];
const hhmm = (min) => fmtMin(Math.max(0, Math.min(DIA_MIN, Math.round(min))));

// Une intervalos que se tocam e devolve o complemento dentro da janela de trabalho.
const frestas = (ocupados, abre, fecha) => {
  const ordenados = ocupados
    .map(([ini, fim]) => [Math.max(ini, abre), Math.min(fim, fecha)])
    .filter(([ini, fim]) => fim > ini)
    .sort((a, b) => a[0] - b[0]);
  const livres = [];
  let cursor = abre;
  for (const [ini, fim] of ordenados) {
    if (ini > cursor) livres.push([cursor, ini]);
    cursor = Math.max(cursor, fim);
  }
  if (cursor < fecha) livres.push([cursor, fecha]);
  return livres;
};

// Acentos fora dos dois lados: "Vania" tem de achar "Vânia", senão o script só serve para quem
// consegue digitar o circunflexo no terminal. Mesmo idioma de expediente.js:normalizeDayKey.
const semAcento = (texto) => String(texto)
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLocaleLowerCase('pt-BR');

const conn = await mysql.createConnection({
  host: config.db.host, port: config.db.port, user: config.db.user,
  password: config.db.pass, database: config.db.name,
});

try {
  const [[estab]] = await conn.query(
    "SELECT id, nome FROM usuarios WHERE id=? AND tipo='estabelecimento'", [estabId]
  );
  if (!estab) throw new Error(`estabelecimento ${estabId} não encontrado`);

  const [todosProfs] = await conn.query(
    'SELECT id, nome, ativo FROM profissionais WHERE estabelecimento_id=? ORDER BY nome', [estabId]
  );

  // Aceita id numérico ou trecho do nome — na prática ninguém decora o id da manicure.
  let alvos = todosProfs;
  if (profArg) {
    const porId = Number(profArg);
    const chave = semAcento(profArg);
    alvos = todosProfs.filter((p) => (
      (Number.isInteger(porId) && p.id === porId) || semAcento(p.nome).includes(chave)
    ));
    if (!alvos.length) {
      throw new Error(`nenhum profissional casa com "${profArg}" — há: ${todosProfs.map((p) => `${p.id}=${p.nome}`).join(', ')}`);
    }
  }

  const [bloqueios] = await conn.query(
    `SELECT id, profissional_id, inicio, fim, motivo, dia_inteiro
       FROM bloqueios WHERE estabelecimento_id=? AND inicio < ? AND fim > ? ORDER BY inicio`,
    [estabId, fimDiaUtc, inicioDiaUtc]
  );

  const [agendamentos] = await conn.query(
    `SELECT a.id, a.profissional_id, a.inicio, a.fim, a.status,
            s.nome AS servico, s.duracao_min, u.nome AS cliente, u.telefone
       FROM agendamentos a
       LEFT JOIN servicos s ON s.id = a.servico_id
       LEFT JOIN usuarios u ON u.id = a.cliente_id
      WHERE a.estabelecimento_id=? AND a.inicio < ? AND a.fim > ?
        AND ${activeAppointmentStatusWhere('a')}
      ORDER BY a.inicio`,
    [estabId, fimDiaUtc, inicioDiaUtc]
  );

  const [servicos] = await conn.query(
    `SELECT s.id, s.nome, s.duracao_min, sp.profissional_id
       FROM servicos s
       LEFT JOIN servico_profissionais sp ON sp.servico_id = s.id
      WHERE s.estabelecimento_id=? AND s.ativo=1`,
    [estabId]
  );

  const diaSemana = new Date(inicioDiaUtc.getTime() + EST_TZ_OFFSET_MIN * 60_000).getUTCDay();
  console.log(`\n${estab.nome} (id ${estab.id}) — ${dataArg} (${SEMANA[diaSemana]}), horários em LOCAL UTC-3\n`);

  for (const prof of alvos) {
    const expediente = await getExpediente({
      db: conn, estabelecimentoId: estabId, dateUtc: inicioDiaUtc, profissionalId: prof.id,
    });

    console.log('-'.repeat(72));
    console.log(`${prof.nome} (id ${prof.id})${prof.ativo ? '' : '   [INATIVA]'}`);

    if (expediente.closed) {
      console.log('  Nao trabalha neste dia.\n');
      continue;
    }
    const { startMinutes: abre, endMinutes: fecha } = expediente;
    console.log(`  Expediente: ${fmtMin(abre)}-${fmtMin(fecha)}` +
      (expediente.breaks?.length
        ? ` | intervalo: ${expediente.breaks.map(([i, f]) => `${fmtMin(i)}-${fmtMin(f)}`).join(', ')}`
        : ''));

    // Serviços que esta profissional pode atender. Sem vínculo em servico_profissionais ela
    // some do wizard público — vale mostrar, porque "não dá pra marcar" às vezes é isto.
    const seus = servicos.filter((s) => s.profissional_id === prof.id);
    console.log(`  Atende: ${seus.length ? seus.map((s) => `${s.nome} (${s.duracao_min}min)`).join(', ') : '[NENHUM servico vinculado]'}`);

    // Escopo: bloqueio sem profissional fecha para todo mundo; com profissional, só para ele.
    const meusBloqueios = bloqueios.filter((b) => b.profissional_id == null || b.profissional_id === prof.id);
    if (meusBloqueios.length) {
      console.log('  Travas:');
      for (const b of meusBloqueios) {
        const [i, f] = recorta(minutosLocais(b.inicio), minutosLocais(b.fim));
        const escopo = b.profissional_id == null ? 'salao inteiro' : 'so ela';
        console.log(`    TRAVA ${hhmm(i)}-${hhmm(f)}  [${escopo}] ${b.motivo || 'sem motivo'} (bloqueio #${b.id})`);
      }
    } else {
      console.log('  Travas: nenhuma');
    }

    const meusAgs = agendamentos.filter((a) => a.profissional_id == null || a.profissional_id === prof.id);
    console.log(`  Agendamentos (${meusAgs.length}):`);
    for (const a of meusAgs) {
      const [i, f] = recorta(minutosLocais(a.inicio), minutosLocais(a.fim));
      const geral = a.profissional_id == null ? '  [sem profissional - ocupa todos]' : '';
      console.log(`    ${hhmm(i)}-${hhmm(f)}  ${a.servico || '?'} - ${a.cliente || '?'} ${a.telefone || ''} (#${a.id}, ${a.status})${geral}`);
    }

    if (abre > fecha) {
      console.log('  Turno vira a meia-noite; frestas nao calculadas.\n');
      continue;
    }

    const ocupados = [
      ...(expediente.breaks || []).map(([i, f]) => [i, f]),
      ...meusBloqueios.map((b) => recorta(minutosLocais(b.inicio), minutosLocais(b.fim))),
      ...meusAgs.map((a) => recorta(minutosLocais(a.inicio), minutosLocais(a.fim))),
    ];
    const livres = frestas(ocupados, abre, fecha);

    console.log('  Frestas livres:');
    if (!livres.length) {
      console.log('    (nenhuma - dia cheio)');
    }
    for (const [i, f] of livres) {
      const tamanho = f - i;
      // O ponto do script: a fresta só serve se um serviço couber INTEIRO nela, e o encaixe
      // ainda tem de terminar antes do fechamento.
      const cabem = seus.filter((s) => s.duracao_min <= tamanho);
      const veredito = cabem.length
        ? `CABE: ${cabem.map((s) => s.nome).join(', ')}`
        : 'CURTA DEMAIS para qualquer servico dela';
      console.log(`    ${hhmm(i)}-${hhmm(f)}  (${tamanho}min)  ${veredito}`);
    }
    console.log('');
  }
} catch (e) {
  console.error('ERRO:', e?.message || e);
  process.exitCode = 1;
} finally {
  await conn.end();
}
