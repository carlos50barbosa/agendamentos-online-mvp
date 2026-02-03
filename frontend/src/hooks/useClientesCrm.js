import { useCallback, useEffect, useMemo, useState } from 'react';
import { Api } from '../utils/api';

const EMPTY_AGGREGATIONS = {
  period: 'all',
  clients: 0,
  appointments: 0,
  cancelled: 0,
  cancel_rate: 0,
  revenue_centavos: 0,
  ticket_medio_centavos: null,
};

export function useClientesCrm({ establishmentId, params = {}, enabled = true }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [aggregations, setAggregations] = useState(EMPTY_AGGREGATIONS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const paramsKey = useMemo(() => JSON.stringify(params || {}), [params]);

  const reload = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  const updateItem = useCallback((clientId, patch) => {
    if (!clientId) return;
    setItems((prev) => prev.map((item) => (item.id === clientId ? { ...item, ...patch } : item)));
  }, []);

  useEffect(() => {
    if (!enabled || !establishmentId) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    Api.getEstablishmentClients(establishmentId, params)
      .then((resp) => {
        if (!active) return;
        const list = Array.isArray(resp?.items) ? resp.items : [];
        setItems(list);
        setTotal(Number(resp?.total || 0));
        setHasNext(Boolean(resp?.hasNext));
        setAggregations({ ...EMPTY_AGGREGATIONS, ...(resp?.aggregations || {}) });
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || 'Não foi possível carregar os clientes.');
        setItems([]);
        setTotal(0);
        setHasNext(false);
        setAggregations(EMPTY_AGGREGATIONS);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [enabled, establishmentId, paramsKey, reloadKey]);

  return {
    items,
    setItems,
    updateItem,
    total,
    hasNext,
    aggregations,
    loading,
    error,
    reload,
  };
}

export default useClientesCrm;



