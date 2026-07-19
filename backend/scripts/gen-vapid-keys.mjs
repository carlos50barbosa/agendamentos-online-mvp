// Gera um par de chaves VAPID para Web Push.
//
//   node scripts/gen-vapid-keys.mjs
//
// Rode UMA VEZ e guarde o resultado no .env da VPS. Trocar as chaves depois
// invalida todas as assinaturas existentes: cada navegador ja inscrito para de
// receber e so volta quando o usuario reabrir o app e reinscrever. Se precisar
// mesmo rotacionar, limpe a tabela push_subscriptions junto.
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Cole no backend/.env da VPS (a chave privada NUNCA vai para o repositorio):

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:contato@agendamentosonline.com
`);
