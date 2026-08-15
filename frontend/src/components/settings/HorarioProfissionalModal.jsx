// frontend/src/components/settings/HorarioProfissionalModal.jsx
//
// Configura o horário próprio de uma profissional. Modal DEDICADO, e não uma seção dentro do
// formulário de editar: os campos de nome/foto são compartilhados entre criar e editar, e
// pendurar a escala ali faria toda troca de foto regravar a semana inteira. Separado, o PUT
// daqui manda `{ horarios }` e nada mais — a rota reconstrói o resto a partir da linha atual.
//
// OS TRÊS ESTADOS que o backend distingue, e como esta tela os expressa:
//   - não abriu o modal, ou abriu e não mexeu -> nenhum PUT (o Salvar fica desabilitado);
//   - "Segue o horário do salão" LIGADO       -> { horarios: null }, limpa e volta a herdar;
//   - LIGADO=false + salvar                   -> { horarios: [os 7 dias] }.
//
// O que NUNCA pode acontecer: mandar `horarios: undefined`. A chave some do JSON e o servidor
// entende "não mexa" — a tela diria "salvo" sem ter limpado nada. Por isso o envio passa por
// Api.profissionaisUpdateHorarios, que força `?? null`.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../Modal.jsx';
import WorkingHoursEditor from './WorkingHoursEditor.jsx';
import {
  diasDeHorariosProf,
  diasDeHorariosSalao,
  horariosProfDeDias,
  mensagemDeErroHorarios,
  temPausasExtras,
  validarDiasProf,
} from './horariosProfissional.js';
import { Api } from '../../utils/api';
import { getUser } from '../../utils/auth';
import './settings.css';

const rotuloJanela = (dia) => {
  if (!dia?.enabled) return 'Salão fechado nesse dia';
  return `Salão: ${dia.start}–${dia.end}`;
};

export default function HorarioProfissionalModal({ professional, onClose, onSaved }) {
  const temProprio = Boolean(professional?.horarios_json);
  const somenteLeitura = useMemo(() => temPausasExtras(professional?.horarios_json), [professional]);

  const [segueSalao, setSegueSalao] = useState(!temProprio);
  // Hidratado UMA vez na abertura e mantido em estado próprio. Derivar da linha da lista a cada
  // render perderia o que a dona digitou assim que qualquer ação atualizasse aquela linha.
  const [days, setDays] = useState(() => diasDeHorariosProf(professional?.horarios_json));
  const [diasDoSalao, setDiasDoSalao] = useState(null);
  const [carregandoSalao, setCarregandoSalao] = useState(true);
  const [erroSalao, setErroSalao] = useState('');
  const [dirty, setDirty] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [confirmandoZeroDias, setConfirmandoZeroDias] = useState(false);

  const errors = useMemo(() => (segueSalao ? {} : validarDiasProf(days)), [days, segueSalao]);
  const invalido = Object.keys(errors).length > 0;

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        // Mesmo caminho que a seção de horários do salão usa: os horários vêm em
        // `profile.horarios`, já parseados pelo backend — ao contrário do horário da
        // profissional, que chega como texto cru.
        const usuario = getUser();
        if (!usuario?.id) throw new Error('sem_usuario');
        const est = await Api.getEstablishment(usuario.id);
        if (!ativo) return;
        setDiasDoSalao(diasDeHorariosSalao(est?.profile?.horarios));
      } catch {
        // Sem a referência do salão não há semente honesta para a primeira configuração, nem
        // como mostrar a janela do salão em cada dia. Melhor bloquear do que adivinhar.
        if (ativo) setErroSalao('Não foi possível carregar o horário do salão. Recarregue a página para configurar o horário próprio.');
      } finally {
        if (ativo) setCarregandoSalao(false);
      }
    })();
    return () => { ativo = false; };
  }, []);

  const alterarDias = useCallback((proximos) => {
    setDays(proximos);
    setDirty(true);
    setErro('');
  }, []);

  const alternarSegueSalao = useCallback((ligado) => {
    setSegueSalao(ligado);
    setDirty(true);
    setErro('');
    // Ao desligar pela primeira vez, semear com o horário do salão de hoje — nunca com tudo
    // desmarcado. "Tudo desmarcado" é pixel a pixel idêntico a afastamento intencional, que o
    // servidor aceita: a profissional sumiria de toda a agenda, e a tela teria sugerido isso.
    if (!ligado && !temProprio && diasDoSalao) setDays(diasDoSalao);
  }, [diasDoSalao, temProprio]);

  const enviar = useCallback(async (horarios) => {
    setSalvando(true);
    setErro('');
    try {
      const atualizado = await Api.profissionaisUpdateHorarios(professional.id, horarios);
      onSaved(atualizado, horarios === null);
    } catch (err) {
      setErro(mensagemDeErroHorarios(err));
      setConfirmandoZeroDias(false);
    } finally {
      setSalvando(false);
    }
  }, [professional, onSaved]);

  const salvar = useCallback(() => {
    if (segueSalao) return enviar(null);
    if (invalido) return undefined;
    // Zero dias é configuração legítima (licença, afastamento), então confirma em vez de
    // bloquear — mas nunca em silêncio: o efeito é a profissional sumir da agenda.
    if (!days.some((d) => d.enabled) && !confirmandoZeroDias) {
      setConfirmandoZeroDias(true);
      return undefined;
    }
    return enviar(horariosProfDeDias(days));
  }, [segueSalao, invalido, days, confirmandoZeroDias, enviar]);

  const podeSalvar = dirty && !salvando && !somenteLeitura && (segueSalao || !invalido);

  return (
    <Modal
      title={`Horários de ${professional?.nome || 'profissional'}`}
      onClose={salvando ? undefined : onClose}
      closeButton={!salvando}
      bodyClassName="modal__body--scroll"
      actions={[
        <button key="cancel" type="button" className="btn btn--outline" onClick={onClose} disabled={salvando}>
          Cancelar
        </button>,
        <button key="save" type="button" className="btn btn--primary" onClick={salvar} disabled={!podeSalvar}>
          {salvando ? <span className="spinner" /> : confirmandoZeroDias ? 'Salvar assim mesmo' : 'Salvar horários'}
        </button>,
      ]}
    >
      <div className="set-block">
        {somenteLeitura ? (
          <p className="muted">
            Esta escala tem mais de um intervalo no mesmo dia e foi configurada fora desta tela.
            Editar por aqui apagaria os intervalos extras, então ela está só para leitura. Para
            recomeçar, ligue <strong>Segue o horário do salão</strong> e salve.
          </p>
        ) : null}

        <label className="switch">
          <input
            type="checkbox"
            checked={segueSalao}
            onChange={(e) => alternarSegueSalao(e.target.checked)}
            disabled={salvando || Boolean(erroSalao) || somenteLeitura}
          />
          <span>Segue o horário do salão</span>
        </label>

        <p className="muted">
          {segueSalao
            ? 'Ela atende nos mesmos dias e horários do salão. Se o salão mudar, o dela muda junto.'
            : 'Ela tem dias e horários próprios. O sistema usa o que for mais restrito entre o horário do salão e o dela — o horário próprio só reduz, nunca amplia.'}
        </p>

        {erroSalao ? <div className="notice notice--error" role="alert">{erroSalao}</div> : null}

        {!segueSalao && !carregandoSalao && !erroSalao ? (
          <>
            {!temProprio ? (
              <p className="muted">
                Começamos com uma cópia do horário do salão de hoje. A partir daqui, mudanças no
                salão não mudam mais o horário dela.
              </p>
            ) : null}

            {/* A janela do salão em cada dia é o que torna visível que o horário próprio só
                estreita: sem ela, configurar 20:00 num salão que fecha às 18:00 parece ter
                funcionado. */}
            {diasDoSalao ? (
              <ul className="set-hours__context">
                {diasDoSalao.map((dia) => (
                  <li key={dia.key}>
                    <strong>{dia.label}</strong> · {rotuloJanela(dia)}
                  </li>
                ))}
              </ul>
            ) : null}

            <WorkingHoursEditor days={days} onChange={alterarDias} errors={errors} />

            {/* Turno que vira a madrugada é aceito de propósito, mas sem esta pista a dona lê
                "22:00 → 06:00" como erro de digitação. */}
            {days.filter((d) => d.enabled && d.start > d.end).map((d) => (
              <p key={d.key} className="muted">
                {d.label}: {d.start} → {d.end} (vira a madrugada).
              </p>
            ))}
          </>
        ) : null}

        {confirmandoZeroDias ? (
          <div className="notice notice--error" role="alert">
            Nenhum dia marcado. {professional?.nome} vai parar de aparecer para agendamento até
            você marcar algum dia. É isso mesmo?
          </div>
        ) : null}

        {erro ? <div className="notice notice--error" role="alert">{erro}</div> : null}
      </div>
    </Modal>
  );
}
