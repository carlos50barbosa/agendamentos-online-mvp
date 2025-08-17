import React, { useEffect, useState } from 'react'
import { Api } from '../utils/api'

export default function DashboardEstabelecimento(){
  const [itens,setItens]=useState([])
  useEffect(()=>{ Api.agendamentosEstabelecimento().then(setItens).catch(()=>{}) },[])
  return (
    <div className="card">
      <h2>Agendamentos (Confirmados)</h2>
      <table>
        <thead><tr><th>Serviço</th><th>Cliente</th><th>Início</th><th>Status</th></tr></thead>
        <tbody>
          {itens.map(i=>(
            <tr key={i.id}>
              <td>{i.servico_nome}</td>
              <td>{i.cliente_nome}</td>
              <td>{new Date(i.inicio).toLocaleString()}</td>
              <td><span className="badge ok">confirmado</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}