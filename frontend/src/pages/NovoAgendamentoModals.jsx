import React from "react";
import { Link } from "react-router-dom";
import Modal from "../components/Modal.jsx";
import { IconPhone } from "../components/Icons.jsx";
import { resolveAssetUrl } from "../utils/api";

export default function NovoAgendamentoModals(props) {
  const {
    infoModalOpen,
    selectedEstablishment,
    selectedEstablishmentName,
    handleCloseInfo,
    infoActiveTab,
    handleInfoTabChange,
    handleOpenGalleryModal,
    galleryImages,
    ratingCount,
    infoLoading,
    selectedExtras,
    selectedEstablishmentAddress,
    contactPhone,
    formatPhoneDisplay,
    profileData,
    horariosList,
    socialLinks,
    selectedProfessionals,
    professionalsError,
    professionalInitials,
    ratingAverageLabel,
    ratingSummary,
    isClientUser,
    isAuthenticated,
    loginHref,
    handleOpenRatingModal,
    reviewsError,
    reviewsLoading,
    reviewsItems,
    reviewsHasNext,
    handleReviewsRetry,
    handleReviewsLoadMore,
    reviewDateFormatter,
    galleryModalOpen,
    handleCloseGalleryModal,
    galleryViewIndex,
    handleGalleryPrev,
    handleGalleryNext,
    setGalleryViewIndex,
    profileImageModalOpen,
    establishmentAvatar,
    handleCloseProfileImage,
    ratingModal,
    handleCloseRatingModal,
    handleDeleteRating,
    handleSaveRating,
    handleRatingStar,
    handleRatingCommentChange,
    guestModal,
    handleCloseGuestModal,
    handleGuestResendOtp,
    handleGuestOtpSubmit,
    handleGuestFormSubmit,
    setGuestModal,
    showGuestOptional,
    setShowGuestOptional,
    selectedSlot,
    serviceLabel,
    DateHelpers,
    ServiceHelpers,
    endTimeLabel,
    normalizePhoneDigits,
    planLimitModal,
    setPlanLimitModal,
    user,
    modal,
    setModal,
    selectedProfessional,
    serviceDuration,
    servicePrice,
    confirmBooking,
  } = props;

  return (
    <>
      {infoModalOpen && selectedEstablishment && (
              <Modal
                title={`Informações de ${selectedEstablishmentName || 'Estabelecimento'}`}
                onClose={handleCloseInfo}
                closeButton
                bodyClassName="modal__body--scroll"
              >
                <div className="estab-info">
                  <div
                    className="estab-info__tabs"
                    role="tablist"
                    aria-label="Detalhes do estabelecimento"
                  >
                    <button
                      type="button"
                      className={`estab-info__tab${infoActiveTab === 'about' ? ' is-active' : ''}`}
                      onClick={() => handleInfoTabChange('about')}
                      role="tab"
                      aria-selected={infoActiveTab === 'about'}
                    >
                      Informações
                    </button>
                    <button
                      type="button"
                      className="estab-info__tab"
                      onClick={handleOpenGalleryModal}
                      aria-haspopup="dialog"
                    >
                      Fotos{galleryImages.length ? ` (${galleryImages.length})` : ''}
                    </button>
                    <button
                      type="button"
                      className={`estab-info__tab${infoActiveTab === 'reviews' ? ' is-active' : ''}`}
                      onClick={() => handleInfoTabChange('reviews')}
                      role="tab"
                      aria-selected={infoActiveTab === 'reviews'}
                    >
                      Avaliações{ratingCount > 0 ? ` (${ratingCount})` : ''}
                    </button>
                  </div>
                  <div className="estab-info__content">
                    {infoActiveTab === 'about' ? (
                      infoLoading ? (
                        <div className="estab-info__loading">
                          {Array.from({ length: 5 }).map((_, index) => (
                            <div
                              key={`info-skeleton-${index}`}
                              className="shimmer"
                              style={{ height: 14, width: `${90 - index * 10}%` }}
                            />
                          ))}
                        </div>
                      ) : (
                        <>
                          {selectedExtras?.error && (
                            <div className="notice notice--error" role="alert">
                              {selectedExtras.error}
                            </div>
                          )}
                          <section className="estab-info__section">
                            <h4>Endereço</h4>
                            <p>{selectedEstablishmentAddress || 'Endereço não informado.'}</p>
                          </section>
                          <section className="estab-info__section">
                            <h4>Contato</h4>
                            {contactPhone ? (
                              <ul className="estab-info__list">
                                {contactPhone && (
                                  <li>
                                    <IconPhone aria-hidden style={{ width: 16, height: 16, marginRight: 6, verticalAlign: 'text-bottom' }} />
                                    <span className="sr-only">Telefone</span>
                                    <span>{formatPhoneDisplay(contactPhone) || contactPhone}</span>
                                  </li>
                                )}
                              </ul>
                            ) : (
                              <p className="muted">Contato não informado.</p>
                            )}
                          </section>
                          <section className="estab-info__section">
                            <h4>Sobre</h4>
                            {profileData?.sobre ? (
                              <p>{profileData.sobre}</p>
                            ) : (
                              <p className="muted">Nenhuma informação cadastrada.</p>
                            )}
                          </section>
                          <section className="estab-info__section">
                            <h4>Horários de atendimento</h4>
                            {horariosList.length ? (
                              <ul className="estab-info__list">
                                {horariosList.map((item, index) => (
                                  <li key={`${item.label || 'horario'}-${index}`}>
                                    {item.label ? (
                                      <>
                                        <strong>{item.label}:</strong> {item.value || item.label}
                                      </>
                                    ) : (
                                      item.value || item.label
                                    )}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="muted">Nenhum horário cadastrado.</p>
                            )}
                          </section>
                          <section className="estab-info__section">
                            <h4>Links</h4>
                            {socialLinks.length ? (
                              <ul className="estab-info__links">
                                {socialLinks.map(({ key, label, url }) => (
                                  <li key={key}>
                                    <a href={url} target="_blank" rel="noopener noreferrer">
                                      {label}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="muted">Nenhum link cadastrado.</p>
                            )}
                          </section>
                          <section className="estab-info__section">
                            <h4>Profissionais</h4>
                            {selectedProfessionals?.loading ? (
                              <ul className="estab-info__professionals estab-info__professionals--loading">
                                {Array.from({ length: 3 }).map((_, index) => (
                                  <li key={`prof-skeleton-${index}`} className="estab-info__professional">
                                    <div className="estab-info__professional-avatar shimmer" />
                                    <div className="estab-info__professional-info">
                                      <div className="shimmer" style={{ height: 12, width: '70%' }} />
                                      <div className="shimmer" style={{ height: 10, width: '50%' }} />
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            ) : professionalsError ? (
                              <p className="notice notice--error" role="alert">
                                {professionalsError}
                              </p>
                            ) : selectedProfessionals?.items?.length ? (
                              <ul className="estab-info__professionals">
                                {selectedProfessionals.items.map((prof) => {
                                  const avatar = prof?.avatar_url ? resolveAssetUrl(prof.avatar_url) : '';
                                  const initials = professionalInitials(prof?.nome || prof?.name);
                                  return (
                                    <li key={prof.id} className="estab-info__professional">
                                      <div className="estab-info__professional-avatar">
                                        {avatar ? (
                                          <img
                                            src={avatar}
                                            alt={`Foto de ${prof.nome || prof.name || 'profissional'}`}
                                          />
                                        ) : (
                                          <span>{initials}</span>
                                        )}
                                      </div>
                                      <div className="estab-info__professional-info">
                                        <strong>{prof.nome || prof.name}</strong>
                                        {prof.descricao ? (
                                          <span className="muted">{prof.descricao}</span>
                                        ) : null}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="muted">Nenhum profissional cadastrado.</p>
                            )}
                          </section>
                        </>
                      )
                    ) : (
                      <div className="estab-reviews">
                        <div className="estab-reviews__summary">
                          <div className="estab-reviews__average" aria-label={`Nota média ${ratingAverageLabel ?? '–'}`}>
                            <span className="estab-reviews__value">{ratingAverageLabel ?? '–'}</span>
                            <div className="estab-reviews__stars" aria-hidden="true">
                              {[1, 2, 3, 4, 5].map((value) => (
                                <span
                                  key={`summary-star-${value}`}
                                  className={`estab-reviews__star${
                                    ratingSummary?.average != null && ratingSummary.average >= value - 0.5 ? ' is-active' : ''
                                  }`}
                                >
                                  {ratingSummary?.average != null && ratingSummary.average >= value - 0.5 ? '★' : '☆'}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="estab-reviews__count">
                            {ratingCount > 0
                              ? `${ratingCount} ${ratingCount === 1 ? 'avaliação' : 'avaliações'}`
                              : 'Ainda sem avaliações'}
                          </div>
                          {isClientUser ? (
                            <button
                              type="button"
                              className="btn btn--outline btn--sm"
                              onClick={handleOpenRatingModal}
                            >
                              Avaliar estabelecimento
                            </button>
                          ) : !isAuthenticated ? (
                            <Link to={loginHref} className="btn btn--outline btn--sm">
                              Avaliar
                            </Link>
                          ) : null}
                        </div>
                        {reviewsError && !reviewsLoading ? (
                          <div className="notice notice--error" role="alert">
                            {reviewsError}
                            <div className="row" style={{ marginTop: 8 }}>
                              <button className="btn btn--sm" onClick={handleReviewsRetry}>
                                Tentar novamente
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {reviewsLoading && reviewsItems.length === 0 ? (
                          <ul className="estab-reviews__list estab-reviews__list--loading">
                            {Array.from({ length: 3 }).map((_, index) => (
                              <li key={`review-skeleton-${index}`} className="estab-reviews__item">
                                <div className="estab-reviews__header">
                                  <div className="estab-reviews__avatar shimmer" />
                                  <div className="estab-reviews__meta">
                                    <div className="shimmer" style={{ height: 12, width: '60%' }} />
                                    <div className="shimmer" style={{ height: 10, width: '40%', marginTop: 4 }} />
                                  </div>
                                  <div className="estab-reviews__stars">
                                    {Array.from({ length: 5 }).map((__, star) => (
                                      <span key={`skeleton-star-${star}`} className="estab-reviews__star shimmer" />
                                    ))}
                                  </div>
                                </div>
                                <div className="shimmer" style={{ height: 12, width: '90%', marginTop: 8 }} />
                                <div className="shimmer" style={{ height: 12, width: '70%', marginTop: 6 }} />
                              </li>
                            ))}
                          </ul>
                        ) : reviewsItems.length === 0 ? (
                          <p className="muted" style={{ marginTop: 12 }}>
                            {ratingCount > 0
                              ? 'Ainda sem comentários. Quando clientes deixarem relatos, eles aparecerão aqui.'
                              : 'Seja o primeiro a avaliar este estabelecimento.'}
                          </p>
                        ) : (
                          <ul className="estab-reviews__list">
                            {reviewsItems.map((review) => {
                              const nota = Number(review.nota) || 0;
                              const reviewDateIso = review.updated_at || review.created_at;
                              const dateObj = reviewDateIso ? new Date(reviewDateIso) : null;
                              const reviewDate = dateObj && !Number.isNaN(dateObj.getTime())
                                ? reviewDateFormatter.format(dateObj)
                                : '';
                              const avatar = review?.author?.avatar_url ? resolveAssetUrl(review.author.avatar_url) : '';
                              const initials = review?.author?.initials || 'CL';
                              return (
                                <li key={review.id} className="estab-reviews__item">
                                  <div className="estab-reviews__header">
                                    <div className="estab-reviews__avatar">
                                      {avatar ? (
                                        <img src={avatar} alt={`Foto de ${review.author?.name || 'cliente'}`} />
                                      ) : (
                                        <span>{initials}</span>
                                      )}
                                    </div>
                                    <div className="estab-reviews__meta">
                                      <strong>{review.author?.name || 'Cliente'}</strong>
                                      {reviewDate ? <span className="muted">{reviewDate}</span> : null}
                                    </div>
                                    <div className="estab-reviews__stars" aria-label={`Nota ${nota} de 5`}>
                                      {[1, 2, 3, 4, 5].map((value) => (
                                        <span
                                          key={`review-${review.id}-star-${value}`}
                                          className={`estab-reviews__star${nota >= value ? ' is-active' : ''}`}
                                        >
                                          {nota >= value ? '★' : '☆'}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  {review.comentario ? (
                                    <p className="estab-reviews__comment">{review.comentario}</p>
                                  ) : (
                                    <p className="estab-reviews__comment estab-reviews__comment--muted">
                                      Avaliação sem comentário.
                                    </p>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {reviewsLoading && reviewsItems.length > 0 && (
                          <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
                            <span className="spinner" aria-label="Carregando avaliações" />
                          </div>
                        )}
                        {!reviewsLoading && reviewsHasNext && reviewsItems.length > 0 && (
                          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
                            <button className="btn btn--outline btn--sm" onClick={handleReviewsLoadMore}>
                              Carregar mais
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Modal>
            )}
            {galleryModalOpen && (
              <Modal
                title={`Fotos de ${selectedEstablishmentName || 'Estabelecimento'}`}
                onClose={handleCloseGalleryModal}
                closeButton
                bodyClassName="modal__body--scroll"
              >
                {galleryImages.length ? (
                  <div className="gallery-viewer" style={{ display: 'grid', gap: 12 }}>
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        paddingBottom: '60%',
                        borderRadius: 12,
                        overflow: 'hidden',
                        background: '#f6f6f6',
                      }}
                    >
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={handleGalleryPrev}
                        disabled={galleryImages.length < 2}
                        style={{
                          position: 'absolute',
                          top: '50%',
                          left: 8,
                          transform: 'translateY(-50%)',
                          zIndex: 2,
                        }}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={handleGalleryNext}
                        disabled={galleryImages.length < 2}
                        style={{
                          position: 'absolute',
                          top: '50%',
                          right: 8,
                          transform: 'translateY(-50%)',
                          zIndex: 2,
                        }}
                      >
                        ›
                      </button>
                      {(() => {
                        const currentImage = galleryImages[galleryViewIndex] || galleryImages[0];
                        const src = resolveAssetUrl(currentImage?.url || '');
                        if (!src) {
                          return (
                            <span
                              className="muted"
                              style={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              Imagem indisponível
                            </span>
                          );
                        }
                        return (
                          <img
                            src={src}
                            alt={currentImage?.titulo || `Imagem de ${selectedEstablishmentName || 'estabelecimento'}`}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        );
                      })()}
                    </div>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div>
                        <strong>{galleryImages[galleryViewIndex]?.titulo || 'Imagem'}</strong>
                        {galleryImages.length > 1 && (
                          <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                            {galleryViewIndex + 1} de {galleryImages.length}
                          </span>
                        )}
                      </div>
                    </div>
                    {galleryImages.length > 1 && (
                      <div
                        className="gallery-thumbs"
                        style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}
                      >
                        {galleryImages.map((image, index) => {
                          const key = image?.id || `${image?.url || 'thumb'}-${index}`;
                          const src = resolveAssetUrl(image?.url || '');
                          const isActive = index === galleryViewIndex;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setGalleryViewIndex(index)}
                              className="gallery-thumb"
                              style={{
                                border: isActive ? '2px solid var(--brand, #6c2bd9)' : '1px solid #e0e0e0',
                                borderRadius: 8,
                                padding: 0,
                                width: 80,
                                height: 60,
                                overflow: 'hidden',
                                background: '#f6f6f6',
                                flex: '0 0 auto',
                              }}
                            >
                              {src ? (
                                <img
                                  src={src}
                                  alt={image?.titulo || `Miniatura ${index + 1}`}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              ) : (
                                <span className="muted" style={{ fontSize: 10 }}>
                                  Indisponível
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="muted">Nenhuma imagem cadastrada ainda.</p>
                )}
              </Modal>
            )}
            {profileImageModalOpen && establishmentAvatar && (
              <Modal
                onClose={handleCloseProfileImage}
                closeButton
                bodyClassName="modal__body--scroll"
              >
                <div className="profile-image-modal">
                  <img
                    className="profile-image-modal__img"
                    src={establishmentAvatar}
                    alt={`Foto do estabelecimento ${selectedEstablishmentName || ''}`}
                  />
                </div>
              </Modal>
            )}
            {ratingModal.open && (
              <Modal
                title="Avaliar estabelecimento"
                onClose={ratingModal.saving ? undefined : handleCloseRatingModal}
                closeButton
                actions={[
                  <button
                    key="cancel"
                    type="button"
                    className="btn btn--outline"
                    onClick={handleCloseRatingModal}
                    disabled={ratingModal.saving}
                  >
                    Cancelar
                  </button>,
                  selectedExtras?.user_review ? (
                    <button
                      key="remove"
                      type="button"
                      className="btn btn--outline"
                      onClick={handleDeleteRating}
                      disabled={ratingModal.saving}
                    >
                      Remover avaliação
                    </button>
                  ) : null,
                  <button
                    key="save"
                    type="button"
                    className="btn btn--primary"
                    onClick={handleSaveRating}
                    disabled={ratingModal.saving || ratingModal.nota < 1}
                  >
                    {ratingModal.saving ? <span className="spinner" /> : 'Salvar'}
                  </button>,
                ].filter(Boolean)}
              >
                <div className="rating-modal">
                  <div className="rating-modal__stars">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`rating-star${ratingModal.nota >= value ? ' rating-star--active' : ''}`}
                        onClick={() => handleRatingStar(value)}
                        disabled={ratingModal.saving}
                        aria-label={`${value} ${value === 1 ? 'estrela' : 'estrelas'}`}
                      >
                        {ratingModal.nota >= value ? '★' : '☆'}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="input rating-modal__comment"
                    placeholder="Conte sua experiência (opcional)"
                    value={ratingModal.comentario}
                    onChange={handleRatingCommentChange}
                    rows={4}
                    maxLength={600}
                    disabled={ratingModal.saving}
                  />
                  <div className="rating-modal__hint muted">
                    {`${ratingModal.comentario.length}/600 caracteres`}
                  </div>
                  {ratingModal.error && (
                    <div className="notice notice--error" role="alert">
                      {ratingModal.error}
                    </div>
                  )}
                </div>
              </Modal>
            )}
            {guestModal.open && (
              <Modal onClose={guestModal.loading ? undefined : handleCloseGuestModal} closeButton>
                {guestModal.step === "success" ? (
                  <>
                    <div className="confirmation-icon" aria-hidden="true">
                      <svg viewBox="0 0 48 48" width="56" height="56" focusable="false">
                        <circle cx="24" cy="24" r="22" fill="#22c55e" />
                        <path
                          d="M16 24l6 6 12-12"
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <h3>Agendamento realizado</h3>
                    <p style={{ marginTop: 6 }}>
                      Enviamos um email com os detalhes do agendamento.
                      {' '}Se não aparecer em alguns minutos, confira o spam ou reencontre o link mais tarde.
                    </p>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                      <button type="button" className="btn btn--primary" onClick={handleCloseGuestModal}>
                        Fechar
                      </button>
                    </div>
                  </>
                ) : guestModal.step === "otp" ? (
                  <>
                    <h3>Confirme seu email</h3>
                    <p className="muted" style={{ marginTop: 4 }}>
                      Enviamos um código para {guestModal.email || 'seu email'}. Digite para concluir o agendamento.
                    </p>
                    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                      <label htmlFor="guest-otp-code" className="muted" style={{ fontWeight: 700 }}>
                        Código
                      </label>
                      <input
                        className="input"
                        id="guest-otp-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={guestModal.otpCode}
                        onChange={(e) => setGuestModal((prev) => ({ ...prev, otpCode: e.target.value }))}
                        disabled={guestModal.loading}
                      />
                    </div>
                    {guestModal.error && (
                      <div className="notice notice--error" role="alert" style={{ marginTop: 10 }}>
                        {guestModal.error}
                      </div>
                    )}
                    {guestModal.info && (
                      <div className="notice notice--success" style={{ marginTop: 8 }}>
                        {guestModal.info}
                      </div>
                    )}
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                      <button type="button" className="btn btn--outline" onClick={handleGuestResendOtp} disabled={guestModal.loading}>
                        Reenviar código
                      </button>
                      <button type="button" className="btn btn--primary" onClick={handleGuestOtpSubmit} disabled={guestModal.loading}>
                        {guestModal.loading ? <span className="spinner" /> : 'Confirmar agendamento'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>Finalizar agendamento</h3>
                    <div className="confirmation-card">
                      <p className="muted" style={{ marginTop: 0, fontStyle: 'italic', fontSize: 12 }}>
                        Agendaremos e criaremos sua conta com estes dados. Vamos mandar a confirmação por email.
                      </p>
                      {selectedSlot && serviceLabel && (
                        <dl className="confirmation-details">
                          <div className="confirmation-details__item">
                            <dt>Estabelecimento</dt>
                            <dd>{selectedEstablishmentName}</dd>
                          </div>
                          <div className="confirmation-details__item">
                            <dt>Serviço</dt>
                            <dd>{serviceLabel}</dd>
                          </div>
                          <div className="confirmation-details__item">
                            <dt>Data</dt>
                            <dd>{DateHelpers.formatDateFull(selectedSlot.datetime)}</dd>
                          </div>
                          <div className="confirmation-details__item">
                            <dt>Horário</dt>
                            <dd><span className="badge badge--time">{DateHelpers.formatTime(selectedSlot.datetime)}{endTimeLabel ? ` • ${endTimeLabel}` : ''}</span></dd>
                          </div>
                        </dl>
                      )}
                    </div>
                    <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                      <label style={{ display: 'grid', gap: 4 }}>
                        <span className="muted" style={{ fontWeight: 700 }}>Nome completo</span>
                        <input
                          className="input"
                          type="text"
                          value={guestModal.name}
                          onChange={(e) => setGuestModal((prev) => ({ ...prev, name: e.target.value }))}
                          disabled={guestModal.loading}
                          placeholder="Seu nome"
                        />
                      </label>
                      <label style={{ display: 'grid', gap: 4 }}>
                        <span className="muted" style={{ fontWeight: 700 }}>Email</span>
                        <input
                          className="input"
                          type="email"
                          value={guestModal.email}
                          onChange={(e) => setGuestModal((prev) => ({ ...prev, email: e.target.value }))}
                          disabled={guestModal.loading}
                          placeholder="voce@email.com"
                          autoComplete="email"
                        />
                      </label>
                      <label style={{ display: 'grid', gap: 4 }}>
                        <span className="muted" style={{ fontWeight: 700 }}>Telefone (WhatsApp)</span>
                        <input
                          className="input"
                          type="tel"
                          inputMode="tel"
                          value={formatPhoneDisplay(guestModal.phone)}
                          onChange={(e) => setGuestModal((prev) => ({ ...prev, phone: normalizePhoneDigits(e.target.value) }))}
                          disabled={guestModal.loading}
                          placeholder="(11) 99999-9999"
                        />
                      </label>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setShowGuestOptional((prev) => !prev)}
                        disabled={guestModal.loading}
                      >
                        {showGuestOptional ? 'Ocultar dados opcionais' : 'Adicionar dados opcionais'}
                      </button>
                    </div>
                    {showGuestOptional && (
                      <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span className="muted" style={{ fontWeight: 700 }}>Data de nascimento (opcional)</span>
                          <input
                            className="input"
                            type="date"
                            value={guestModal.data_nascimento}
                            onChange={(e) => setGuestModal((prev) => ({ ...prev, data_nascimento: e.target.value }))}
                            disabled={guestModal.loading}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span className="muted" style={{ fontWeight: 700 }}>CEP (opcional)</span>
                          <input
                            className="input"
                            type="text"
                            inputMode="numeric"
                            value={guestModal.cep}
                            onChange={(e) => setGuestModal((prev) => ({ ...prev, cep: e.target.value }))}
                            disabled={guestModal.loading}
                            placeholder="00000-000"
                          />
                        </label>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span className="muted" style={{ fontWeight: 700 }}>Endereço (opcional)</span>
                          <input
                            className="input"
                            type="text"
                            value={guestModal.endereco}
                            onChange={(e) => setGuestModal((prev) => ({ ...prev, endereco: e.target.value }))}
                            disabled={guestModal.loading}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span className="muted" style={{ fontWeight: 700 }}>Número (opcional)</span>
                          <input
                            className="input"
                            type="text"
                            value={guestModal.numero}
                            onChange={(e) => setGuestModal((prev) => ({ ...prev, numero: e.target.value }))}
                            disabled={guestModal.loading}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span className="muted" style={{ fontWeight: 700 }}>Complemento (opcional)</span>
                          <input
                            className="input"
                            type="text"
                            value={guestModal.complemento}
                            onChange={(e) => setGuestModal((prev) => ({ ...prev, complemento: e.target.value }))}
                            disabled={guestModal.loading}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span className="muted" style={{ fontWeight: 700 }}>Bairro (opcional)</span>
                          <input
                            className="input"
                            type="text"
                            value={guestModal.bairro}
                            onChange={(e) => setGuestModal((prev) => ({ ...prev, bairro: e.target.value }))}
                            disabled={guestModal.loading}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span className="muted" style={{ fontWeight: 700 }}>Cidade (opcional)</span>
                          <input
                            className="input"
                            type="text"
                            value={guestModal.cidade}
                            onChange={(e) => setGuestModal((prev) => ({ ...prev, cidade: e.target.value }))}
                            disabled={guestModal.loading}
                          />
                        </label>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span className="muted" style={{ fontWeight: 700 }}>Estado (opcional)</span>
                          <input
                            className="input"
                            type="text"
                            value={guestModal.estado}
                            onChange={(e) => setGuestModal((prev) => ({ ...prev, estado: e.target.value.toUpperCase().slice(0, 2) }))}
                            disabled={guestModal.loading}
                            placeholder="SP"
                          />
                        </label>
                      </div>
                    )}
                    {guestModal.error && (
                      <div className="notice notice--error" role="alert" style={{ marginTop: 10 }}>
                        {guestModal.error}
                      </div>
                    )}
                    {guestModal.info && !guestModal.error && (
                      <div className="notice notice--success" style={{ marginTop: 8 }}>
                        {guestModal.info}
                      </div>
                    )}
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                      <button type="button" className="btn btn--outline" onClick={handleCloseGuestModal} disabled={guestModal.loading}>
                        Cancelar
                      </button>
                      <button type="button" className="btn btn--primary" onClick={handleGuestFormSubmit} disabled={guestModal.loading}>
                        {guestModal.loading ? <span className="spinner" /> : 'Confirmar agendamento'}
                      </button>
                    </div>
                  </>
                )}
              </Modal>
            )}
            {planLimitModal.open && (
              <Modal onClose={() => setPlanLimitModal({ open: false, message: '', details: null })} closeButton>
                <h3>Limite de agendamentos atingido</h3>
                <p>{planLimitModal.message || 'Este estabelecimento atingiu o limite de agendamentos do plano atual.'}</p>
                {planLimitModal.details?.month && (
                  <p className="muted" style={{ marginTop: 4 }}>
                    Período: {planLimitModal.details.month}
                    {planLimitModal.details.limit ? ` • Limite: ${planLimitModal.details.limit}/mês` : ''}
                    {planLimitModal.details.total ? ` • Atual: ${planLimitModal.details.total}` : ''}
                  </p>
                )}
                {user?.tipo === 'estabelecimento' ? (
                  <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                    <Link className="btn btn--outline" to="/configuracoes" onClick={() => setPlanLimitModal({ open: false, message: '', details: null })}>
                      Ir para Configurações
                    </Link>
                    <Link className="btn btn--primary" to="/planos" onClick={() => setPlanLimitModal({ open: false, message: '', details: null })}>
                      Ver planos
                    </Link>
                  </div>
                ) : (
                  <p className="muted" style={{ marginTop: 8 }}>
                    Se você é o estabelecimento, faça login e atualize seu plano para continuar recebendo novos agendamentos.
                  </p>
                )}
              </Modal>
            )}
            {modal.isOpen && selectedSlot && serviceLabel && (
              <Modal onClose={() => setModal((m) => ({ ...m, isOpen: false }))} closeButton>
                <h3>Confirmar agendamento?</h3>
                <div className="confirmation-details">
                  <div className="confirmation-details__item"><span className="confirmation-details__label">Estabelecimento: </span><span className="confirmation-details__value">{selectedEstablishmentName}</span></div>
                  <div className="confirmation-details__item"><span className="confirmation-details__label">Serviço: </span><span className="confirmation-details__value">{serviceLabel}</span></div>
                  {selectedProfessional && (
                    <div className="confirmation-details__item"><span className="confirmation-details__label">Profissional: </span><span className="confirmation-details__value">{selectedProfessional?.nome || selectedProfessional?.name}</span></div>
                  )}
                  {serviceDuration > 0 && (
                    <div className="confirmation-details__item"><span className="confirmation-details__label">Duração: </span><span className="confirmation-details__value">{serviceDuration} minutos</span></div>
                  )}
                  {servicePrice !== 'R$ 0,00' && (
                    <div className="confirmation-details__item"><span className="confirmation-details__label">Preço: </span><span className="confirmation-details__value">{servicePrice}</span></div>
                  )}
                  <div className="confirmation-details__item"><span className="confirmation-details__label">Data: </span><span className="confirmation-details__value">{DateHelpers.formatDateFull(selectedSlot.datetime)}</span></div>
                  <div className="confirmation-details__item"><span className="confirmation-details__label">Horário: </span><span className="confirmation-details__value">
                    <span className="badge badge--time">{DateHelpers.formatTime(selectedSlot.datetime)}{endTimeLabel ? ` • ${endTimeLabel}` : ''}</span>
                  </span></div>
                </div>
                <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                  <button className="btn btn--outline" onClick={() => setModal((m) => ({ ...m, isOpen: false }))} disabled={modal.isSaving}>Cancelar</button>
                  <button className="btn btn--primary" onClick={confirmBooking} disabled={modal.isSaving}>
                    {modal.isSaving ? <span className="spinner" /> : 'Confirmar Agendamento'}
                  </button>
                </div>
              </Modal>
            )}
    </>
  );
}
