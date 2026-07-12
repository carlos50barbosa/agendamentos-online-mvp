// Gráficos dos relatórios. SVG puro, sem dependência.
//
// Regras que valem para todos e explicam as escolhas abaixo:
// - linha 2px; área é uma lavagem de ~10% da cor da série (nunca bloco saturado);
// - barra fina, só a ponta arredondada, quadrada na base; separação por respiro, não por borda;
// - grade e eixos em hairline sólido, recessivos;
// - rótulo é seletivo — número em cima de todo ponto não se lê;
// - texto usa tokens de texto, nunca a cor da série (a cor mora na marca ao lado).
import React, { useEffect, useMemo, useRef, useState } from 'react';

// Mede o container em pixels reais. Um viewBox escalado engordaria traço e tipografia
// junto com o desenho — 2px viraria 3px num container largo.
function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (typeof ResizeObserver === 'undefined') {
      setWidth(node.getBoundingClientRect().width);
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0]?.contentRect?.width || 0));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

// Teto "redondo" (1/2/5 × 10^n) para os ticks caírem em números que se lêem.
function niceMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const normalized = value / base;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * base;
}

// Ponta arredondada em cima, quadrada na base: <rect rx> arredondaria os quatro cantos.
function barPath(x, y, width, height, radius = 4) {
  if (height <= 0) return '';
  const r = Math.min(radius, height, width / 2);
  return [
    `M${x},${y + height}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + width - r},${y}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `L${x + width},${y + height}`,
    'Z',
  ].join(' ');
}

const TREND_PAD = { top: 14, right: 14, bottom: 26, left: 44 };
const TREND_HEIGHT = 240;

/**
 * Série diária: confirmados (linha + lavagem) e cancelados (linha).
 * Um eixo só — nunca dois — então a linha de cancelados fica rente à base quando
 * eles são poucos. Isso é a verdade do dado, não um defeito do gráfico.
 */
export function DailyTrendChart({ points, formatShort, formatLong }) {
  const [ref, width] = useElementWidth();
  const [cursor, setCursor] = useState(null);

  const max = useMemo(() => {
    const peak = points.reduce(
      (acc, p) => Math.max(acc, Number(p.confirmados || 0), Number(p.cancelados || 0)),
      0
    );
    return niceMax(peak || 1);
  }, [points]);

  const innerW = Math.max(0, width - TREND_PAD.left - TREND_PAD.right);
  const innerH = TREND_HEIGHT - TREND_PAD.top - TREND_PAD.bottom;
  const baseline = TREND_PAD.top + innerH;

  const x = (index) => (
    points.length <= 1
      ? TREND_PAD.left + innerW / 2
      : TREND_PAD.left + (index / (points.length - 1)) * innerW
  );
  const y = (value) => baseline - (Math.min(Number(value) || 0, max) / max) * innerH;

  const linePath = (key) => points
    .map((point, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(point[key]).toFixed(1)}`)
    .join(' ');

  const areaPath = points.length
    ? `${linePath('confirmados')} L${x(points.length - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`
    : '';

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
  const uniqueTicks = [...new Set(ticks)];

  // Rótulos de data espaçados: 90 dias não cabem no eixo, e não precisam caber.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  const active = cursor != null ? points[cursor] : null;

  const moveTo = (clientX, target) => {
    if (!innerW || points.length < 2) return;
    const rect = target.getBoundingClientRect();
    const ratio = (clientX - rect.left - TREND_PAD.left) / innerW;
    const index = Math.round(ratio * (points.length - 1));
    setCursor(Math.min(Math.max(index, 0), points.length - 1));
  };

  const onKeyDown = (event) => {
    if (!points.length) return;
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    setCursor((prev) => {
      const next = (prev == null ? 0 : prev + delta);
      return Math.min(Math.max(next, 0), points.length - 1);
    });
  };

  return (
    <figure className="viz" ref={ref}>
      <div
        className="viz__plot"
        onMouseMove={(event) => moveTo(event.clientX, event.currentTarget)}
        onMouseLeave={() => setCursor(null)}
        onKeyDown={onKeyDown}
        onFocus={() => setCursor((prev) => (prev == null ? points.length - 1 : prev))}
        onBlur={() => setCursor(null)}
        tabIndex={0}
        role="group"
        aria-label="Volume diário de confirmados e cancelados. Use as setas para percorrer os dias."
      >
        {width > 0 && (
          <svg width={width} height={TREND_HEIGHT} aria-hidden="true">
            {uniqueTicks.map((tick) => (
              <g key={tick}>
                <line
                  className="viz__grid"
                  x1={TREND_PAD.left}
                  x2={width - TREND_PAD.right}
                  y1={y(tick)}
                  y2={y(tick)}
                />
                <text className="viz__tick" x={TREND_PAD.left - 8} y={y(tick) + 4} textAnchor="end">
                  {tick}
                </text>
              </g>
            ))}

            <path className="viz__area viz__area--confirmados" d={areaPath} />
            <path className="viz__line viz__line--confirmados" d={linePath('confirmados')} />
            <path className="viz__line viz__line--cancelados" d={linePath('cancelados')} />

            {points.map((point, i) => (
              i % labelEvery === 0 ? (
                <text key={point.date} className="viz__tick" x={x(i)} y={TREND_HEIGHT - 8} textAnchor="middle">
                  {formatShort(point.date)}
                </text>
              ) : null
            ))}

            {active && (
              <g>
                <line className="viz__cursor" x1={x(cursor)} x2={x(cursor)} y1={TREND_PAD.top} y2={baseline} />
                <circle className="viz__dot viz__dot--confirmados" cx={x(cursor)} cy={y(active.confirmados)} r="4" />
                <circle className="viz__dot viz__dot--cancelados" cx={x(cursor)} cy={y(active.cancelados)} r="4" />
              </g>
            )}
          </svg>
        )}

        {active && (
          <div
            className="viz__tooltip"
            style={{
              left: `${x(cursor)}px`,
              // vira o balão perto da borda direita para não estourar o card
              transform: x(cursor) > width - 140 ? 'translateX(-100%) translateX(-12px)' : 'translateX(12px)',
            }}
          >
            <strong>{formatLong(active.date)}</strong>
            <span><i className="viz__key viz__key--confirmados" />{active.confirmados} confirmados</span>
            <span><i className="viz__key viz__key--cancelados" />{active.cancelados} cancelados</span>
          </div>
        )}
      </div>

      {/* Duas séries: a legenda é obrigatória — identidade nunca pode depender só da cor. */}
      <figcaption className="viz__legend">
        <span><i className="viz__key viz__key--confirmados" />Confirmados</span>
        <span><i className="viz__key viz__key--cancelados" />Cancelados</span>
      </figcaption>

      {/* O leitor de tela recebe uma frase por dia; a tabela em Detalhamento tem tudo. */}
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.date}>
            {`${formatLong(point.date)}: ${point.confirmados} confirmados, ${point.cancelados} cancelados`}
          </li>
        ))}
      </ul>
    </figure>
  );
}

const BAR_PAD = { top: 20, right: 4, bottom: 22, left: 4 };
const BAR_HEIGHT = 152;
const MAX_BAR_WIDTH = 24;

/**
 * Barras de uma série só (dia da semana, antecedência). Uma série = uma cor:
 * o comprimento já codifica a magnitude, colorir por tamanho seria dizer duas vezes.
 * Poucas categorias ⇒ rótulo direto na ponta dispensa grade e eixo Y.
 */
export function CategoryBarChart({ items, describe }) {
  const [ref, width] = useElementWidth();

  const max = useMemo(
    () => Math.max(1, ...items.map((item) => Number(item.value || 0))),
    [items]
  );

  const innerW = Math.max(0, width - BAR_PAD.left - BAR_PAD.right);
  const innerH = BAR_HEIGHT - BAR_PAD.top - BAR_PAD.bottom;
  const baseline = BAR_PAD.top + innerH;
  const band = items.length ? innerW / items.length : 0;
  // Respiro de 2px separa vizinhas; o teto de 24px deixa o resto da faixa virar ar.
  const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH, band - 2));

  return (
    <figure className="viz viz--compact" ref={ref}>
      <div className="viz__plot">
        {width > 0 && (
          <svg width={width} height={BAR_HEIGHT} aria-hidden="true">
            <line className="viz__baseline" x1={BAR_PAD.left} x2={width - BAR_PAD.right} y1={baseline} y2={baseline} />
            {items.map((item, i) => {
              const value = Number(item.value || 0);
              const barHeight = (value / max) * innerH;
              const bx = BAR_PAD.left + band * i + (band - barWidth) / 2;
              const by = baseline - barHeight;
              return (
                <g key={item.key}>
                  <path className="viz__bar" d={barPath(bx, by, barWidth, barHeight)} />
                  <text className="viz__cap" x={bx + barWidth / 2} y={by - 6} textAnchor="middle">
                    {value}
                  </text>
                  <text className="viz__tick" x={bx + barWidth / 2} y={BAR_HEIGHT - 6} textAnchor="middle">
                    {item.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <ul className="sr-only">
        {items.map((item) => <li key={item.key}>{describe(item)}</li>)}
      </ul>
    </figure>
  );
}

/**
 * Sparkline do herói: só a forma da tendência, sem eixo, sem rótulo, sem interação.
 */
export function Sparkline({ values, width = 104, height = 32 }) {
  const numbers = (values || []).map((value) => Number(value) || 0);
  if (numbers.length < 2) return null;

  const max = Math.max(...numbers);
  const min = Math.min(...numbers);
  const span = max - min || 1;
  const step = width / (numbers.length - 1);

  const d = numbers
    .map((value, i) => {
      const px = i * step;
      const py = height - ((value - min) / span) * (height - 4) - 2;
      return `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="viz__spark" width={width} height={height} aria-hidden="true">
      <path className="viz__line viz__line--confirmados" d={d} />
    </svg>
  );
}
