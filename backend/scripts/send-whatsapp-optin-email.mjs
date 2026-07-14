// backend/scripts/send-whatsapp-optin-email.mjs
//
// Pede aos donos de salão o aceite do WhatsApp — por e-mail, porque não dá para pedir pelo canal
// que você ainda não tem autorização para usar.
//
// Contexto: a WABA da plataforma foi desabilitada pela Meta (13/07/2026) e o opt-in passou a ser
// obrigatório para TODO destinatário, inclusive o dono da conta. Quem já estava na base tem
// `notify_whatsapp_estab=1` e nenhum consentimento registrado — para esses, o envio está bloqueado,
// e eles precisam autorizar no painel.
//
// ─── SEGURANÇA ──────────────────────────────────────────────────────────────────────────────────
//
// Isto manda e-mail para CLIENTES PAGANTES REAIS. É irreversível: e-mail enviado não volta. Por isso:
//
//   • DRY RUN é o padrão. Sem `--send`, ele só LISTA quem receberia. Rodar o script por engano não
//     dispara nada.
//   • IDEMPOTENTE. Cada envio bem-sucedido vira linha em `audit_log`. Rodar de novo PULA quem já
//     recebeu — então dá para reexecutar depois de uma falha parcial sem duplicar.
//   • PAUSADO. Um intervalo entre envios; 83 e-mails num piscar de olhos é o que um servidor de
//     spam faz. E o e-mail é o ÚNICO canal que sobrou — queimar a reputação dele agora seria
//     trocar um problema por uma catástrofe.
//
// ─── USO ────────────────────────────────────────────────────────────────────────────────────────
//
//   node scripts/send-whatsapp-optin-email.mjs
//       → DRY RUN. Lista os destinatários, separados por grupo. Não envia nada.
//
//   node scripts/send-whatsapp-optin-email.mjs --send --only voce@seuemail.com
//       → manda só para você. FAÇA ISTO PRIMEIRO. Leia o e-mail que chegou.
//
//   node scripts/send-whatsapp-optin-email.mjs --send --limit 5
//       → manda para os 5 primeiros. Confira que chegaram antes de soltar o resto.
//
//   node scripts/send-whatsapp-optin-email.mjs --send
//       → manda para todos os que ainda não receberam.
//
// Rodar de dentro de backend/ (precisa do .env).
import 'dotenv/config';
import { pool } from '../src/lib/db.js';
import { notifyEmail } from '../src/lib/notifications.js';

const ACAO = 'whatsapp.optin_email';
const PAINEL_URL = 'https://agenda0.com.br/estab';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const SEND = has('--send');
const ONLY = valueOf('--only', null);
const LIMIT = Number(valueOf('--limit', 0)) || 0;
const DELAY_MS = Number(valueOf('--delay', 2000));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || 'tudo bem';

/**
 * Quem precisa autorizar: dono com a notificação de WhatsApp LIGADA e sem nenhum `granted`.
 *
 * `tem_telefone` separa os dois grupos, e a distinção é load-bearing: quem não tem telefone
 * cadastrado NÃO VÊ o banner no painel (a rota devolve `sem_telefone` e o componente não
 * renderiza). Mandar para ele o e-mail que diz "vai aparecer um botão Autorizar" seria mandá-lo
 * procurar um botão que não existe — e ele abriria um chamado, com razão.
 */
async function carregarPendentes() {
  const [rows] = await pool.query(
    `
    SELECT u.id, u.nome, u.email,
           (u.telefone IS NOT NULL AND u.telefone <> '') AS tem_telefone
      FROM usuarios u
     WHERE u.tipo = 'estabelecimento'
       AND u.notify_whatsapp_estab = 1
       AND u.email IS NOT NULL AND u.email <> ''
       AND NOT EXISTS (
         SELECT 1 FROM whatsapp_optins o
          WHERE o.telefone_e164 = u.telefone AND o.evento = 'granted'
       )
     ORDER BY u.nome
    `
  );

  // Quem já recebeu vem em consulta SEPARADA, e o cruzamento é feito aqui em JS.
  //
  // Tentei fazer isso num EXISTS dentro da query acima e levei um "Illegal mix of collations":
  // `audit_log` é utf8mb4_general_ci, `CAST(u.id AS CHAR)` sai noutra, e o `=` entre as duas
  // estoura. Se tivesse escapado, o script teria abortado NO MEIO de um `--send` — depois de
  // mandar e-mail e antes de registrar quem recebeu. A reexecução duplicaria.
  //
  // Não vale forçar COLLATE na comparação: seria consertar o sintoma e deixar a armadilha armada
  // para a próxima query. São 83 linhas; um Set em memória resolve e não tem como quebrar.
  const [enviados] = await pool.query(
    `SELECT entidade_id FROM audit_log
      WHERE acao = ? AND entidade = 'usuario' AND resultado = 'sucesso'`,
    [ACAO]
  );
  const jaRecebeu = new Set(enviados.map((r) => String(r.entidade_id)));

  return rows.map((r) => ({
    ...r,
    tem_telefone: Boolean(Number(r.tem_telefone)),
    ja_recebeu: jaRecebeu.has(String(r.id)),
  }));
}

/** A marca do envio. É ela que torna o script re-executável sem duplicar e-mail. */
async function marcarEnviado(user, resultado, motivo = null) {
  await pool.query(
    `INSERT INTO audit_log (acao, entidade, entidade_id, ator_tipo, resultado, motivo, metadados)
     VALUES (?, 'usuario', ?, 'sistema', ?, ?, ?)`,
    [ACAO, String(user.id), resultado, motivo, JSON.stringify({ email: user.email, tem_telefone: user.tem_telefone })]
  );
}

const ASSUNTO = 'Ação necessária: reative seus avisos no WhatsApp';

/**
 * Dois corpos, porque são duas ações diferentes. Um texto só mandaria metade das pessoas para um
 * botão que elas não conseguem ver.
 *
 * HTML deliberadamente pobre: sem imagem, sem CSS externo, sem tabela de layout. E-mail
 * transacional simples entra na caixa de entrada; e-mail que parece newsletter vai para promoções
 * — ou para spam. E o e-mail é o único canal que sobrou.
 */
function corpo(user) {
  const ola = `<p>Olá, <b>${esc(primeiroNome(user.nome))}</b>!</p>`;

  const abertura = `
    <p>A Meta passou a exigir um <b>aceite explícito e registrado</b> antes de qualquer envio no
    WhatsApp — inclusive para você, dono da conta. Como esse aceite ainda não existe no seu
    cadastro, seus avisos de novo agendamento estão <b>pausados</b>.</p>`;

  const passos = user.tem_telefone
    ? `
    <p><b>Como reativar (leva 10 segundos):</b></p>
    <ol>
      <li>Entre no seu painel: <a href="${PAINEL_URL}">${PAINEL_URL}</a></li>
      <li>No topo da tela vai aparecer um aviso com o botão <b>Autorizar</b></li>
      <li>Pronto.</li>
    </ol>`
    : `
    <p><b>No seu caso há um passo antes:</b> não há telefone cadastrado na sua conta — e sem número
    não existe para onde enviar.</p>
    <ol>
      <li>Entre no painel: <a href="${PAINEL_URL}">${PAINEL_URL}</a></li>
      <li>Em <b>Configurações → Conta</b>, cadastre seu <b>telefone (WhatsApp)</b></li>
      <li>Em <b>Configurações → Notificações</b>, marque <i>"Receber notificações no WhatsApp"</i> e salve</li>
    </ol>`;

  const rodape = `
    <p><b>Enquanto isso, você não fica no escuro:</b> todos os avisos continuam chegando neste
    e-mail, normalmente.</p>

    <p>Uma observação honesta: nossas mensagens no WhatsApp estão <b>temporariamente suspensas</b>
    enquanto regularizamos a conta junto à Meta. Autorize agora mesmo assim — assim que
    restabelecermos, você volta a receber <b>sem precisar fazer nada</b>.</p>

    <p>Qualquer dúvida, é só responder este e-mail.</p>
    <p>— Agendamentos Online</p>`;

  return `${ola}${abertura}${passos}${rodape}`;
}

async function main() {
  let pendentes = await carregarPendentes();

  const jaReceberam = pendentes.filter((u) => u.ja_recebeu);
  pendentes = pendentes.filter((u) => !u.ja_recebeu);

  if (ONLY) {
    pendentes = pendentes.filter((u) => u.email.toLowerCase() === ONLY.toLowerCase());
    if (!pendentes.length) {
      // Não inventa destinatário: se o e-mail não está na lista de pendentes, mandar seria mentir
      // ("seus avisos estão pausados") para quem não está pausado.
      console.log(`\n"${ONLY}" não está entre os pendentes (ou já recebeu). Nada a enviar.\n`);
      await pool.end();
      return;
    }
  }
  if (LIMIT > 0) pendentes = pendentes.slice(0, LIMIT);

  const comTelefone = pendentes.filter((u) => u.tem_telefone);
  const semTelefone = pendentes.filter((u) => !u.tem_telefone);

  console.log('');
  console.log(`  a enviar ................ ${pendentes.length}`);
  console.log(`    com telefone .......... ${comTelefone.length}  (vão ver o botão "Autorizar" no painel)`);
  console.log(`    SEM telefone .......... ${semTelefone.length}  (precisam cadastrar o número antes)`);
  console.log(`  já receberam (pulados) .. ${jaReceberam.length}`);
  console.log('');

  if (!SEND) {
    console.log('  DRY RUN — nada foi enviado. Destinatários:\n');
    for (const u of pendentes) {
      console.log(`    ${u.tem_telefone ? '[tel]' : '[SEM]'}  ${u.email.padEnd(38)} ${u.nome}`);
    }
    console.log('\n  Para enviar de verdade:');
    console.log('    1) node scripts/send-whatsapp-optin-email.mjs --send --only voce@seuemail.com');
    console.log('    2) node scripts/send-whatsapp-optin-email.mjs --send --limit 5');
    console.log('    3) node scripts/send-whatsapp-optin-email.mjs --send\n');
    await pool.end();
    return;
  }

  let ok = 0;
  let falhou = 0;

  for (const [i, u] of pendentes.entries()) {
    const r = await notifyEmail(u.email, ASSUNTO, corpo(u));

    if (r?.ok) {
      ok += 1;
      // Marca ANTES de dormir. Se o processo morrer no meio (Ctrl+C, queda de rede), quem já
      // recebeu está registrado — e a próxima execução não manda de novo.
      await marcarEnviado(u, 'sucesso');
      console.log(`  ✓ ${String(i + 1).padStart(3)}/${pendentes.length}  ${u.email}`);
    } else {
      falhou += 1;
      await marcarEnviado(u, 'falha', String(r?.error || 'erro').slice(0, 255));
      console.log(`  ✗ ${String(i + 1).padStart(3)}/${pendentes.length}  ${u.email}  -> ${r?.error}`);
    }

    if (i < pendentes.length - 1) await sleep(DELAY_MS);
  }

  console.log('');
  console.log(`  enviados: ${ok}   falharam: ${falhou}`);
  // A falha fica registrada como 'falha' (não 'sucesso'), então uma nova execução TENTA de novo
  // só esses — sem tocar em quem já recebeu.
  if (falhou) console.log('  Rode de novo para reenviar só os que falharam.');
  console.log('');

  await pool.end();
}

main().catch(async (err) => {
  console.error('\n[optin-email] abortado:', err?.message || err, '\n');
  await pool.end().catch(() => {});
  process.exit(1);
});
