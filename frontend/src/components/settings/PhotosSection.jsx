// src/components/settings/PhotosSection.jsx
// Tópico "Minhas fotos": galeria de fotos do estabelecimento (a foto do perfil vive no menu Perfil).
import React from 'react';
import { getUser } from '../../utils/auth';
import GalleryManager from './GalleryManager.jsx';
import './settings.css';

export default function PhotosSection() {
  const user = getUser();
  if (user?.tipo && user.tipo !== 'estabelecimento') {
    return <p className="muted" style={{ padding: 12 }}>Disponível apenas para contas de estabelecimento.</p>;
  }
  return (
    <div className="set-section">
      <div className="set-block">
        <div className="set-block__head">
          <h4 className="set-block__title">Minhas fotos</h4>
          <p className="set-block__sub">Aparecem na sua página pública de agendamento.</p>
        </div>
        <GalleryManager establishmentId={user?.id} />
      </div>
    </div>
  );
}
