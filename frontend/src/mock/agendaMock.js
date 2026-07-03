// src/mock/agendaMock.js
// Dados mock para a Fase 1 (demonstração dos componentes novos sem backend).
import { addMinutes, setHours, setMinutes, startOfDay, isBefore } from 'date-fns';

export const MOCK_SERVICES = [
  { id: 'svc-1', nome: 'Corte masculino', durationMin: 30, price: 45, depositValue: 15 },
  { id: 'svc-2', nome: 'Corte + barba', durationMin: 60, price: 80, depositValue: 25 },
  { id: 'svc-3', nome: 'Barba', durationMin: 30, price: 35, depositValue: 10 },
  { id: 'svc-4', nome: 'Coloração', durationMin: 90, price: 140, depositValue: 40 },
];

export const MOCK_PROFESSIONALS = [
  { id: 'any', nome: 'Sem preferência', especialidade: 'Primeiro disponível' },
  { id: 'prof-1', nome: 'Rafael Souza', especialidade: 'Cortes e barba' },
  { id: 'prof-2', nome: 'Marina Alves', especialidade: 'Coloração' },
];

/** Slots das 09:00 às 18:00 a cada 30min; alguns ocupados (determinístico). */
export function buildMockSlots(date, { durationMin = 30 } = {}) {
  const base = startOfDay(date);
  const now = new Date();
  const slots = [];
  let cursor = setMinutes(setHours(base, 9), 0);
  const end = setMinutes(setHours(base, 18), 0);
  let idx = 0;
  while (isBefore(cursor, end)) {
    const past = isBefore(cursor, now);
    const busy = idx % 3 === 0; // ~1/3 ocupados
    slots.push({ datetime: new Date(cursor), available: !past && !busy });
    cursor = addMinutes(cursor, 30);
    idx += 1;
  }
  return slots;
}

/** Agendamentos de exemplo distribuídos no dia base (manhã/tarde/noite). */
export function buildMockAppointments(baseDate = new Date()) {
  const base = startOfDay(baseDate);
  const at = (h, m) => new Date(setMinutes(setHours(base, h), m));
  return [
    { id: 'a1', inicio: at(9, 0), fim: at(9, 30), clientName: 'João Pereira', serviceName: 'Corte masculino', professionalName: 'Rafael', status: 'confirmado', phone: '11988887777', durationMin: 30 },
    { id: 'a2', inicio: at(10, 30), fim: at(11, 30), clientName: 'Bruno Lima', serviceName: 'Corte + barba', professionalName: 'Rafael', status: 'aguardando_sinal', phone: '11977776666', durationMin: 60 },
    { id: 'a3', inicio: at(14, 0), fim: at(15, 30), clientName: 'Carla Dias', serviceName: 'Coloração', professionalName: 'Marina', status: 'confirmado', phone: '11966665555', durationMin: 90 },
    { id: 'a4', inicio: at(16, 0), fim: at(16, 30), clientName: 'Diego Alves', serviceName: 'Barba', professionalName: 'Rafael', status: 'concluido', phone: '11955554444', durationMin: 30 },
    { id: 'a5', inicio: at(19, 0), fim: at(19, 30), clientName: 'Eduardo Reis', serviceName: 'Corte masculino', professionalName: 'Rafael', status: 'nao_compareceu', phone: '11944443333', durationMin: 30 },
    { id: 'a6', inicio: at(20, 0), fim: at(20, 30), clientName: 'Felipe Nunes', serviceName: 'Barba', professionalName: 'Marina', status: 'cancelado', phone: '11933332222', durationMin: 30 },
  ];
}

/** Simula createPixCharge + getPixQrCode (o que a Fase 2/Asaas fornecerá). */
export function mockCreatePixCharge({ service }) {
  const value = service?.depositValue ?? 15;
  const expirationDate = addMinutes(new Date(), 15);
  const payload =
    '00020126360014BR.GOV.BCB.PIX0114+5511999998888520400005303986540' +
    String(value.toFixed(2)).replace('.', '') +
    '5802BR5920Agendamentos Online6009SAO PAULO62070503***6304ABCD';
  return Promise.resolve({ encodedImage: null, payload, value, expirationDate, status: 'pending' });
}
