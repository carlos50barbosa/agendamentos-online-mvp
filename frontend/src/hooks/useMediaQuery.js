import { useEffect, useState } from 'react';

// Para renderizar UMA lista, não duas. A tabela e os cards ficavam ambos sempre no DOM —
// o CSS escondia um por breakpoint —, então cada linha era construída (e mantida) em dobro.
export default function useMediaQuery(query) {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [matches, setMatches] = useState(() => (supported ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (!supported) return undefined;
    const mql = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query, supported]);

  return matches;
}
