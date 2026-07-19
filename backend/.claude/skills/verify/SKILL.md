---
name: verify
description: Como subir e dirigir o backend deste projeto para observar uma mudança rodando de verdade.
---

# Verificar o backend em execução

## Subir

O backend é Express + ESM, entrypoint `src/index.js`, config em `backend/.env` (dotenv).
MySQL local em `127.0.0.1:3306`, banco `agendamentos`, usuário `aguser`.

```bash
cd backend
PORT=3099 API_BASE_URL=http://127.0.0.1:3099 node src/index.js
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3099/health   # 200
```

## Gotchas que custam tempo

**A porta 3002 costuma já estar ocupada pelo dev server do usuário.** Não mate esse
processo — suba numa porta livre (3099). Para derrubar só a sua instância no Windows:

```powershell
$p = Get-NetTCPConnection -LocalPort 3099 -State Listen -ErrorAction SilentlyContinue
if ($p) { Stop-Process -Id $p.OwningProcess -Force }
```

**O dev server da 3002 compartilha o MESMO banco.** Os jobs de fundo (lembrete 8h em
`src/lib/appointment_reminders.js`, lembrete 5h em `src/lib/estab_reminders.js`,
manutenção, billing) rodam nos dois processos e **disputam as mesmas linhas** — o
outro servidor pode consumir seu agendamento de teste com código antigo, e você fica
olhando um log vazio sem entender. `aguser` não tem privilégio de `CREATE DATABASE`,
então clonar o banco não é uma saída. O que funciona é ganhar a corrida pelo intervalo:
o padrão é 60s, então suba a sua instância com `REMINDER_8H_INTERVAL_MS=15000` e semeie
a linha logo em seguida. Se a linha for marcada sem deixar rastro no seu log, foi o
outro processo — reabra a linha e tente de novo.

**Jobs disparam WhatsApp e e-mail de verdade.** Antes de acionar qualquer job, use
dados de teste inertes (telefone `5511900000001`, e-mail em domínio `.test`) e aponte
o SMTP para um sink local — `.env` traz credenciais reais do Gmail.

## Capturar e-mail sem enviar nada

`notifyEmail` (`src/lib/notifications.js`) cai em `streamTransport` sem SMTP configurado,
mas aí o corpo não aparece em lugar nenhum. Para ver o HTML, suba um sink SMTP local e
aponte o servidor para ele:

```bash
SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_SECURE=false SMTP_USER=sink SMTP_PASS=sink
```

Um sink mínimo em `net` (responder `220`, `250-AUTH PLAIN LOGIN`, `354`, `250`) já basta
e imprime a mensagem inteira. Note que `transporter` é decidido **uma vez no import** —
mudar env com o processo de pé não tem efeito, tem que reiniciar.

## Fluxos que valem dirigir

- **Lembrete 8h**: agendamento `status='confirmado'`, `reminder_8h_sent_at IS NULL`,
  `inicio` entre agora e +480min. O e-mail só sai quando o WhatsApp devolve `blocked`
  (sem opt-in, telefone inválido, saldo, `wa_unavailable`) — com número de teste sem
  opt-in isso acontece naturalmente.
- **Confirmação pública**: `GET /public/agendamentos/confirm?token=...` devolve HTML
  renderizado no backend. O token é emitido por `src/lib/appointment_confirm_link.js`
  (guarda só o SHA-256; emitir de novo rotaciona e mata o link anterior).

## Limpeza

Rode os scripts auxiliares de dentro de `backend/` (a resolução de `dotenv`/`mysql2` é
relativa ao diretório do script, não ao cwd). Apague as linhas de teste do banco no
fim — é o banco de desenvolvimento real do usuário, não um descartável.
