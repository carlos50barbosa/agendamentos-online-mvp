// Gera um par de chaves VAPID para Web Push.
//
//   node scripts/gen-vapid-keys.mjs
//
// SEM dependencia de proposito: so node:crypto. A versao anterior importava
// `web-push` e isso criava um ovo-e-galinha — as chaves precisam existir ANTES
// do primeiro deploy fazer sentido, mas `web-push` so aparece na VPS depois do
// `npm ci` que o deploy roda. Assim o script funciona num checkout cru.
//
// Uma chave VAPID e so um par EC P-256: a publica e o ponto nao comprimido de
// 65 bytes, a privada e o escalar de 32 bytes, ambos em base64url. E exatamente
// o que webpush.generateVAPIDKeys() produz.
//
// Rode UMA VEZ e guarde o resultado no .env da VPS. Trocar as chaves depois
// invalida todas as assinaturas existentes: cada navegador ja inscrito para de
// receber e so volta quando o usuario reabrir o app e reinscrever. Se precisar
// mesmo rotacionar, limpe a tabela push_subscriptions junto.
import crypto from 'node:crypto';

// O escalar privado sai com os zeros a esquerda cortados de vez em quando
// (~1 em 256). Uma chave de 31 bytes e recusada na hora de assinar, e o erro
// so apareceria muito depois — mais barato sortear de novo.
let ecdh;
let privateKey;
do {
  ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  privateKey = ecdh.getPrivateKey();
} while (privateKey.length !== 32);

console.log(`
Cole no backend/.env da VPS (a chave privada NUNCA vai para o repositorio):

VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString('base64url')}
VAPID_PRIVATE_KEY=${privateKey.toString('base64url')}
VAPID_SUBJECT=mailto:contato@agendamentosonline.com
`);
