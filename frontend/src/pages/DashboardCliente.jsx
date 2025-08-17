import React, { useEffect, useState } from 'react'
import { Api } from '../utils/api'

export default function DashboardCliente(){
  const [itens,setItens]=useState([])
  useEffect(()=>{ Api.meusAgendamentos().then(setItens).catch(()=>{}) },[])
  return (
    <div className="card">
      <h2>Meus Agendamentos</h2>
      <table>
        <thead><tr><th>Serviço</th><th>Estabelecimento</th><th>Início</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {itens.map(i=>(
            <tr key={i.id}>
              <td>{i.servico_nome}</td>
              <td>{i.estabelecimento_nome}</td>
              <td>{new Date(i.inicio).toLocaleString()}</td>
              <td><span className={"badge "+(i.status==='confirmado'?'ok':'out')}>{i.status}</span></td>
              <td>{i.status==='confirmado' && <button className="danger" onClick={async()=>{
                await Api.cancelarAgendamento(i.id); setItens(x=>x.map(y=>y.id===i.id?{...y,status:'cancelado'}:y))
              }}>Cancelar</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}