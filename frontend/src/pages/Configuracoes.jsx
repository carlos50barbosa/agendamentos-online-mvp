import * as o from "react";
import { Link as Yt, useLocation as Ai } from "react-router-dom";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import Modal from "../components/Modal.jsx";
import { IconChevronRight } from "../components/Icons.jsx";
import walletStyles from "../components/WhatsAppWalletPanel.module.css";
import { Api, resolveAssetUrl } from "../utils/api";
import { getUser, saveUser, saveToken } from "../utils/auth";
import { trackAnalyticsEvent, trackMetaEvent } from "../utils/analytics.js";
const e = { jsx, jsxs, Fragment };
const at = Modal;
const Wo = IconChevronRight;
const I = Api;
const ys = resolveAssetUrl;
const Ei = getUser;
const Ii = saveUser;
const Kt = saveToken;
const Bo = trackAnalyticsEvent;
const Fo = trackMetaEvent;
const PUBLIC_PROFILE_THEME_DEFAULTS = Object.freeze({
  accent: "#0f766e",
  accentStrong: "#164e63",
});
function normalizeHexColor(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const prefixed = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#([\da-f]{3}|[\da-f]{6})$/i.test(prefixed)) return "";
  if (prefixed.length === 4) {
    return `#${prefixed[1]}${prefixed[1]}${prefixed[2]}${prefixed[2]}${prefixed[3]}${prefixed[3]}`.toLowerCase();
  }
  return prefixed.toLowerCase();
}
const Ri = "_whatsLayout_1qokc_8",
  Ti = "_mainCol_1qokc_18",
  Mi = "_asideCol_1qokc_22",
  Di = "_planColLeft_1qokc_39",
  qi = "_walletPanel_1qokc_53",
  Hi = "_panelMain_1qokc_66",
  Bi = "_panelHeader_1qokc_71",
  Fi = "_titleGroup_1qokc_76",
  Wi = "_title_1qokc_76",
  $i = "_subtitle_1qokc_95",
  Ui = "_badge_1qokc_101",
  zi = "_statGrid_1qokc_116",
  Oi = "_statCard_1qokc_122",
  Gi = "_statHighlight_1qokc_131",
  Xi = "_statLabel_1qokc_137",
  Vi = "_statHeader_1qokc_145",
  Ki = "_statRemaining_1qokc_153",
  Yi = "_statValue_1qokc_170",
  Qi = "_statHint_1qokc_177",
  Ji = "_progress_1qokc_182",
  Zi = "_progressFill_1qokc_189",
  er = "_progressMeta_1qokc_196",
  ar = "_progressLabel_1qokc_205",
  sr = "_progressPercent_1qokc_209",
  tr = "_section_1qokc_214",
  nr = "_sectionHeader_1qokc_219",
  or = "_sectionTitle_1qokc_227",
  ir = "_sectionHint_1qokc_233",
  rr = "_packageList_1qokc_238",
  lr = "_packageRow_1qokc_244",
  cr = "_packageRowHighlight_1qokc_257",
  ur = "_packageInfo_1qokc_282",
  dr = "_packageTop_1qokc_289",
  mr = "_packageTitle_1qokc_298",
  pr = "_packageAmount_1qokc_306",
  hr = "_packageBadge_1qokc_314",
  gr = "_packagePrices_1qokc_331",
  fr = "_oldPrice_1qokc_339",
  br = "_priceLabel_1qokc_347",
  xr = "_priceHint_1qokc_354",
  _r = "_packageMeta_1qokc_371",
  yr = "_packageDescription_1qokc_379",
  vr = "_packageAction_1qokc_390",
  jr = "_actionButton_1qokc_396",
  Nr = "_emptyRow_1qokc_431",
  kr = "_historyList_1qokc_441",
  wr = "_historyHeading_1qokc_449",
  Cr = "_historySubtext_1qokc_454",
  Sr = "_historyActions_1qokc_459",
  Pr = "_historyToggle_1qokc_463",
  Lr = "_historyPanel_1qokc_469",
  Er = "_historyFilters_1qokc_478",
  Ar = "_historyFilter_1qokc_478",
  Ir = "_historyLoadMore_1qokc_499",
  Rr = "_historyItem_1qokc_503",
  Tr = "_historyMain_1qokc_513",
  Mr = "_historyAmount_1qokc_520",
  Dr = "_historyPrice_1qokc_525",
  qr = "_historyMeta_1qokc_531",
  Hr = "_historyDate_1qokc_541",
  Br = "_statusChip_1qokc_545",
  Fr = "_statusSuccess_1qokc_555",
  Wr = "_statusPending_1qokc_561",
  $r = "_statusError_1qokc_567",
  Ur = "_statusNeutral_1qokc_573",
  zr = "_inlineNotice_1qokc_579",
  Or = "_helpCard_1qokc_588",
  Gr = "_helpCardOpen_1qokc_598",
  Xr = "_helpToggle_1qokc_603",
  Vr = "_helpIcon_1qokc_623",
  Kr = "_helpBody_1qokc_633",
  Yr = "_helpBodyOpen_1qokc_640",
  Qr = "_helpTitle_1qokc_646",
  Jr = "_helpList_1qokc_652",
  m = walletStyles,
  st = (n = "") => {
    let r = n.replace(/\D/g, "");
    return r
      ? (r.length > 11 && r.startsWith("55") && (r = r.slice(2)),
        r.length > 11 && (r = r.slice(-11)),
        r.length <= 2
          ? r
          : r.length <= 6
            ? "(".concat(r.slice(0, 2), ") ").concat(r.slice(2))
            : r.length <= 10
              ? "("
                  .concat(r.slice(0, 2), ") ")
                  .concat(r.slice(2, 6), "-")
                  .concat(r.slice(6))
              : "("
                  .concat(r.slice(0, 2), ") ")
                  .concat(r.slice(2, 7), "-")
                  .concat(r.slice(7)))
      : "";
  },
  $o = (n = "") => {
    const r = n.replace(/\D/g, "");
    return r
      ? r.startsWith("55")
        ? r
        : r.length === 10 || r.length === 11
          ? "55".concat(r)
          : r
      : "";
  },
  Qt = (n = "") => {
    const r = n.replace(/\D/g, "").slice(0, 8);
    return r.length <= 5 ? r : "".concat(r.slice(0, 5), "-").concat(r.slice(5));
  },
  Zr = (n = "") => {
    const r = String(n || "").trim();
    if (!r) return "";
    const g = r.match(/^\d{4}-\d{2}-\d{2}/);
    return g ? g[0] : "";
  },
  el = (n = "") =>
    String(n || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "estabelecimento",
  Ko = "09:00",
  Yo = "18:00",
  vs = /^([01]\d|2[0-3]):[0-5]\d$/;
function it(n) {
  return n
    ? String(n)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
    : "";
}
const al = Object.freeze({
    monday: ["segunda", "segunda-feira", "seg", "mon", "monday"],
    tuesday: ["terca", "terca-feira", "ter", "tue", "tuesday"],
    wednesday: ["quarta", "quarta-feira", "qua", "wed", "wednesday"],
    thursday: ["quinta", "quinta-feira", "qui", "thu", "thursday"],
    friday: ["sexta", "sexta-feira", "sex", "fri", "friday"],
    saturday: ["sabado", "sabado-feira", "sab", "sat", "saturday"],
    sunday: ["domingo", "domingo-feira", "dom", "sun", "sunday"],
  }),
  rt = [
    { key: "monday", label: "Segunda-feira", shortLabel: "Segunda" },
    { key: "tuesday", label: "Terça-feira", shortLabel: "Terça" },
    { key: "wednesday", label: "Quarta-feira", shortLabel: "Quarta" },
    { key: "thursday", label: "Quinta-feira", shortLabel: "Quinta" },
    { key: "friday", label: "Sexta-feira", shortLabel: "Sexta" },
    { key: "saturday", label: "Sábado", shortLabel: "Sábado" },
    { key: "sunday", label: "Domingo", shortLabel: "Domingo" },
  ],
  Be = {
    starter: {
      label: "Starter",
      maxServices: null,
      maxProfessionals: 2,
      maxAppointments: null,
    },
    pro: {
      label: "Pro",
      maxServices: null,
      maxProfessionals: 5,
      maxAppointments: null,
    },
    premium: {
      label: "Premium",
      maxServices: null,
      maxProfessionals: 10,
      maxAppointments: null,
    },
  },
  Jt = Object.keys(Be),
  Ha = (n) => {
    var r;
    return (
      ((r = Be[n]) == null ? void 0 : r.label) ||
      (n == null ? void 0 : n.toUpperCase()) ||
      ""
    );
  },
  tt = "BRL",
  sl = 5,
  tl = 20,
  nt = (n) =>
    String(n || "")
      .trim()
      .toLowerCase() || "starter",
  Uo = (n) =>
    String(n || "mensal")
      .trim()
      .toLowerCase() || "mensal",
  zo = (n) =>
    typeof n != "number" || !Number.isFinite(n) ? null : Math.round(n) / 100,
  Oo = (n, r, g) => {
    const P = {
      item_id: n,
      item_name: Ha(n),
      item_category: "subscription",
      billing_cycle: r,
      quantity: 1,
    };
    return (g != null && (P.price = g), P);
  },
  Go = "ao_last_plan_purchase_signature",
  nl = "ao_last_pix_checkout",
  ol = 2e3,
  il = 60,
  Zt = 15,
  qa = (() => {
    const n = {};
    return (
      Object.entries(al).forEach(([r, g]) => {
        g.forEach((P) => {
          const w = it(P);
          w && (n[w] = r);
        });
      }),
      n
    );
  })(),
  Ba = rt.reduce((n, r, g) => ((n[r.key] = g), n), {}),
  rl = ["monday", "tuesday", "wednesday", "thursday", "friday"],
  Xo = "monday",
  ll = ["tuesday", "wednesday", "thursday", "friday"],
  cl = 3 * 1024 * 1024;
function Qo() {
  return rt.map((n) => ({
    key: n.key,
    label: n.label,
    shortLabel: n.shortLabel,
    enabled: !1,
    start: Ko,
    end: Yo,
    blockEnabled: !1,
    blockStart: "",
    blockEnd: "",
  }));
}
function ul(n) {
  if (!n) return "";
  const r = n.label ? String(n.label).trim() : "",
    g = n.value ? String(n.value).trim() : "";
  return r && g ? "".concat(r, ": ").concat(g) : g || r;
}
function _e(n) {
  if (!n && n !== 0) return "";
  const r = String(n).trim();
  if (!r) return "";
  if (vs.test(r)) return r;
  const g = r.replace(/\D/g, "");
  if (!g) return "";
  if (g.length <= 2) {
    const V = Number(g);
    return !Number.isInteger(V) || V < 0 || V > 23
      ? ""
      : "".concat(String(V).padStart(2, "0"), ":00");
  }
  const P = g.slice(0, -2),
    w = g.slice(-2),
    U = Number(P),
    F = Number(w);
  return !Number.isInteger(U) ||
    U < 0 ||
    U > 23 ||
    !Number.isInteger(F) ||
    F < 0 ||
    F > 59
    ? ""
    : ""
        .concat(String(U).padStart(2, "0"), ":")
        .concat(String(F).padStart(2, "0"));
}
function dl(n) {
  if (!n) return { start: "", end: "", closed: !1 };
  const r = String(n).toLowerCase();
  if (/fechado|sem atendimento|nao atende/.test(r))
    return { start: "", end: "", closed: !0 };
  const g = Array.from(String(n).matchAll(/(\d{1,2})(?:[:h](\d{2}))?/gi));
  if (!g.length) return { start: "", end: "", closed: !1 };
  const P = g
    .map((F) => {
      var q, K;
      const V = (q = F[1]) != null ? q : "",
        D = (K = F[2]) != null ? K : "";
      return _e(V + (D ? ":" + D : ""));
    })
    .filter(Boolean);
  if (!P.length) return { start: "", end: "", closed: !1 };
  const [w, U] = P;
  return { start: w || "", end: U || "", closed: !1 };
}
function ml(n) {
  var w, U, F;
  if (!n) return "";
  const r =
    (F = (U = (w = n.day) != null ? w : n.weekday) != null ? U : n.key) != null
      ? F
      : "";
  if (r && Object.prototype.hasOwnProperty.call(Ba, r)) return r;
  const g = n.label ? it(n.label) : "";
  if (g && qa[g]) return qa[g];
  const P = n.value ? String(n.value) : "";
  if (P) {
    const V = P.split(/[:\-]/)[0],
      D = it(V);
    if (D && qa[D]) return qa[D];
    const q = P.split(/\s+/)[0],
      K = it(q);
    if (K && qa[K]) return qa[K];
  }
  return "";
}
function pl(n) {
  var U, F, V, D, q, K, O, ye, h, ve, Ve, Fe;
  const r = Qo(),
    g = [],
    P = Array.isArray(n == null ? void 0 : n.horarios) ? n.horarios : [],
    w = new Set();
  for (const L of P) {
    if (!L) continue;
    const ie = ml(L),
      Z = ul(L);
    if (!ie) {
      Z && g.push(Z);
      continue;
    }
    if (w.has(ie)) {
      Z && g.push(Z);
      continue;
    }
    const te = Ba[ie];
    if (te == null) {
      Z && g.push(Z);
      continue;
    }
    const We = L.value ? String(L.value).trim() : "",
      Ke = We.toLowerCase();
    if (/fechado|sem atendimento|nao atende/.test(Ke)) {
      ((r[te] = { ...r[te], enabled: !1 }), w.add(ie));
      continue;
    }
    let re = _e(
        (V = (F = (U = L.start) != null ? U : L.begin) != null ? F : L.from) !=
          null
          ? V
          : "",
      ),
      le = _e(
        (K = (q = (D = L.end) != null ? D : L.finish) != null ? q : L.to) !=
          null
          ? K
          : "",
      );
    if ((!re || !le) && We) {
      const E = dl(We);
      if (E.closed) {
        ((r[te] = { ...r[te], enabled: !1 }), w.add(ie));
        continue;
      }
      (!re && E.start && (re = E.start), !le && E.end && (le = E.end));
    }
    if (!re || !le) {
      Z && g.push(Z);
      continue;
    }
    if (re > le) {
      const E = re;
      ((re = le), (le = E));
    }
    const de = Array.isArray(L.blocks)
      ? L.blocks
      : Array.isArray(L.breaks)
        ? L.breaks
        : [];
    let je = !1,
      Ne = "",
      ce = "";
    for (const E of de) {
      if (!E) continue;
      const ke = _e(
          (h =
            (ye = (O = E.start) != null ? O : E.begin) != null ? ye : E.from) !=
            null
            ? h
            : "",
        ),
        Ye = _e(
          (Fe =
            (Ve = (ve = E.end) != null ? ve : E.finish) != null ? Ve : E.to) !=
            null
            ? Fe
            : "",
        );
      if (!(!ke || !Ye) && !(ke >= Ye) && !(ke < re || Ye > le)) {
        ((je = !0), (Ne = ke), (ce = Ye));
        break;
      }
    }
    ((r[te] = {
      ...r[te],
      enabled: !0,
      start: re,
      end: le,
      blockEnabled: je,
      blockStart: Ne,
      blockEnd: ce,
    }),
      w.add(ie));
  }
  if (!g.length) {
    const L =
      typeof (n == null ? void 0 : n.horarios_raw) == "string"
        ? n.horarios_raw.trim()
        : "";
    L && !/^\s*[\[{]/.test(L) && g.push(L);
  }
  return { schedule: r, notes: g.join("\n") };
}
function Jo(n) {
  return n != null && n.enabled
    ? vs.test(n.start || "")
      ? vs.test(n.end || "")
        ? n.start >= n.end
          ? "O horário inicial deve ser anterior ao final em ".concat(
              n.shortLabel,
              ".",
            )
          : n.blockEnabled
            ? vs.test(n.blockStart || "")
              ? vs.test(n.blockEnd || "")
                ? n.blockStart >= n.blockEnd
                  ? "A pausa precisa ter início anterior ao fim em ".concat(
                      n.shortLabel,
                      ".",
                    )
                  : n.blockStart < n.start || n.blockEnd > n.end
                    ? "A pausa em ".concat(
                        n.shortLabel,
                        " deve ficar dentro do horário de atendimento.",
                      )
                    : ""
                : "Informe o fim da pausa em ".concat(n.shortLabel, ".")
              : "Informe o início da pausa em ".concat(n.shortLabel, ".")
            : ""
        : "Informe um horário final válido para ".concat(n.shortLabel, ".")
      : "Informe um horário inicial válido para ".concat(n.shortLabel, ".")
    : "";
}
function hl(n) {
  const r = {};
  for (const g of n || []) {
    const P = Jo(g);
    P && (r[g.key] = P);
  }
  return r;
}
function gl(n) {
  for (const r of n || []) {
    const g = Jo(r);
    if (g) return g;
  }
  return "";
}
function Vo(n) {
  const r = _e(n);
  if (!r) return "";
  const [g, P = "00"] = r.split(":"),
    w = g.padStart(2, "0");
  return P === "00" ? "".concat(w, "h") : "".concat(w, "h").concat(P);
}
function fl(n, r) {
  const g = [];
  for (const w of n) {
    if (!w.enabled) continue;
    const U = _e(w.start) || Ko,
      F = _e(w.end) || Yo,
      V = "".concat(Vo(U), " - ").concat(Vo(F)),
      D = [];
    if (w.blockEnabled) {
      const q = _e(w.blockStart),
        K = _e(w.blockEnd);
      q && K && q < K && q >= U && K <= F && D.push({ start: q, end: K });
    }
    g.push({
      label: w.shortLabel,
      value: V,
      day: w.key,
      start: U,
      end: F,
      ...(D.length ? { blocks: D, breaks: D } : {}),
    });
  }
  const P = String(r || "")
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter((w) => w && !/^\s*[\[{]/.test(w))
    .slice(0, 6);
  for (const w of P) g.push({ label: "", value: w });
  return g;
}
function _l() {
  var eo,
    ao,
    so,
    to,
    no,
    oo,
    io,
    ro,
    lo,
    co,
    uo,
    mo,
    po,
    ho,
    go,
    fo,
    bo,
    xo,
    _o,
    yo;
  const n = Ei(),
    r = (n == null ? void 0 : n.tipo) === "estabelecimento";
  n == null || n.tipo;
  const g = Ai(),
    P = o.useMemo(() => new URLSearchParams(g.search || ""), [g.search]),
    w = (P.get("tab") || "").toLowerCase(),
    U = (P.get("action") || "").toLowerCase(),
    F = w === "plano" || U === "gerar_pix",
    V = U === "gerar_pix",
    D = o.useRef({}),
    q = o.useRef(null),
    K = o.useRef(null),
    O = o.useRef(null),
    ye = o.useRef(!1);
  o.useEffect(() => {}, []);
  const [h, ve] = o.useState({
      plan: "starter",
      status: "trialing",
      trialEnd: null,
      trialDaysLeft: null,
      trialWarn: !1,
      allowAdvanced: !1,
      activeUntil: null,
      appointmentsUsed: null,
      appointmentsLimit: null,
      appointmentsMonth: "",
    }),
    [Ve, Fe] = o.useState(!1),
    [L, ie] = o.useState(!1),
    [Z, te] = o.useState(""),
    [We, Ke] = o.useState(Zt),
    [re, le] = o.useState(!1),
    [de, je] = o.useState(!1),
    [Ne, ce] = o.useState({ type: "", message: "" }),
    [E, ke] = o.useState(""),
    [Ye, lt] = o.useState({
      email_subject: "",
      email_html: "",
      wa_template: "",
    }),
    [ct, ut] = o.useState(!1),
    [v, R] = o.useState({}),
    [S, Q] = o.useState(""),
    [ue, Qe] = o.useState(!1),
    [ee, $e] = o.useState(!1),
    [_a, Fa] = o.useState(!1),
    [M, Wa] = o.useState({
      sobre: "",
      contato_telefone: "",
      site_url: "",
      instagram_url: "",
      facebook_url: "",
      linkedin_url: "",
      youtube_url: "",
      tiktok_url: "",
      accent_color: "",
      accent_strong_color: "",
      horarios_text: "",
    }),
    [ua, Ue] = o.useState({ type: "", message: "" }),
    [C, we] = o.useState(!1),
    [A, ze] = o.useState(!1),
    [ne, me] = o.useState(() => Qo()),
    [Je, Zo] = o.useState(Xo),
    [ya, en] = o.useState(() => ll.slice()),
    js = o.useMemo(() => hl(ne), [ne]),
    Ns = o.useMemo(() => Object.keys(js).length, [js]),
    dt = o.useMemo(() => ne.reduce((a, t) => a + (t.enabled ? 1 : 0), 0), [ne]);
  (o.useEffect(
    () => () => {
      (q.current && clearTimeout(q.current),
        O.current && clearTimeout(O.current));
    },
    [],
  ),
    o.useEffect(() => {
      var s;
      if (typeof window > "u") return;
      const a =
        (s = g == null ? void 0 : g.state) == null ? void 0 : s.focusSection;
      if (!a) return;
      (R((i) => ({ ...i, [a]: !0 })), Q(a));
      const t = D.current[a];
      if (t)
        try {
          t.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (i) {}
      (q.current && clearTimeout(q.current),
        (q.current = window.setTimeout(() => {
          (Q(""), (q.current = null));
        }, 2400)));
    }, [
      (eo = g == null ? void 0 : g.state) == null ? void 0 : eo.focusSection,
    ]),
    o.useEffect(() => {
      ye.current = !1;
    }, [g.search]),
    o.useEffect(() => {
      !r || !F || R((a) => ({ ...a, plan: !0 }));
    }, [r, F]),
    o.useEffect(() => {
      const a = (t) => {
        ee && (t.preventDefault(), (t.returnValue = ""));
      };
      return (
        window.addEventListener("beforeunload", a),
        () => window.removeEventListener("beforeunload", a)
      );
    }, [ee]));
  const ei = o.useCallback((a) => {
      R((t) => ({ ...t, [a]: !t[a] }));
    }, []),
    an = o.useCallback(() => {
      typeof window > "u" ||
        (Qe(!0),
        O.current && clearTimeout(O.current),
        (O.current = window.setTimeout(() => {
          (Qe(!1), (O.current = null));
        }, 1500)));
    }, []),
    ks = o.useCallback(
      (a) => {
        const { schedule: t, notes: s } = pl(a);
        (me(t),
          Wa({
            sobre: (a == null ? void 0 : a.sobre) || "",
            contato_telefone: (a == null ? void 0 : a.contato_telefone) || "",
            site_url: (a == null ? void 0 : a.site_url) || "",
            instagram_url: (a == null ? void 0 : a.instagram_url) || "",
            facebook_url: (a == null ? void 0 : a.facebook_url) || "",
            linkedin_url: (a == null ? void 0 : a.linkedin_url) || "",
            youtube_url: (a == null ? void 0 : a.youtube_url) || "",
            tiktok_url: (a == null ? void 0 : a.tiktok_url) || "",
            accent_color:
              normalizeHexColor(
                (a == null ? void 0 : a.accent_color) ||
                  (a == null ? void 0 : a.brand_color) ||
                  (a == null ? void 0 : a.cor_primaria) ||
                  "",
              ) || "",
            accent_strong_color:
              normalizeHexColor(
                (a == null ? void 0 : a.accent_strong_color) ||
                  (a == null ? void 0 : a.secondary_color) ||
                  (a == null ? void 0 : a.cor_secundaria) ||
                  "",
              ) || "",
            horarios_text: s || "",
          }));
      },
      [me],
    ),
    H = o.useCallback(() => $e(!0), []),
    [T, da] = o.useState({
      nome: "",
      email: "",
      telefone: "",
      data_nascimento: "",
      cep: "",
      endereco: "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      estado: "",
      avatar_url: "",
      notifyEmailEstab: !!(
        (ao = n == null ? void 0 : n.notify_email_estab) == null || ao
      ),
      notifyWhatsappEstab: !!(
        (so = n == null ? void 0 : n.notify_whatsapp_estab) == null || so
      ),
    }),
    [Ze, ws] = o.useState({ atual: "", nova: "", confirmar: "" }),
    [mt, sn] = o.useState(!1),
    [ai, Cs] = o.useState(!1),
    [tn, $a] = o.useState(""),
    [nn, Ua] = o.useState(""),
    [Ss, va] = o.useState({ type: "", message: "" }),
    [ma, on] = o.useState(!1),
    [Ps, za] = o.useState(() => ys((n == null ? void 0 : n.avatar_url) || "")),
    [pt, Ls] = o.useState(""),
    [si, Es] = o.useState(!1),
    [ht, Ie] = o.useState(""),
    Oa = o.useRef(null),
    [B, gt] = o.useState(null),
    [ti, rn] = o.useState(!1),
    [ft, bt] = o.useState(""),
    [ln, ja] = o.useState(""),
    [As, Is] = o.useState(!1),
    Rs = o.useRef(""),
    [x, ni] = o.useState({
      subscription: null,
      history: [],
      topups: [],
      whatsappWallet: null,
      whatsappPackages: [],
      whatsappHistory: [],
    }),
    [pe, Re] = o.useState({
      loading: !1,
      connectLoading: !1,
      disconnectLoading: !1,
      account: null,
      error: "",
      notice: "",
    }),
    [ae, Te] = o.useState({
      loading: !1,
      connectLoading: !1,
      disconnectLoading: !1,
      account: null,
      error: "",
      notice: "",
    }),
    [cn, un] = o.useState(!1),
    [J, oi] = o.useState(null),
    [Oe, dn] = o.useState(!1),
    [xt, _t] = o.useState(""),
    Ga = o.useRef(!1),
    yt = o.useRef(null),
    Ts = o.useCallback(() => {
      try {
        (localStorage.removeItem("intent_kind"),
          localStorage.removeItem("intent_plano"),
          localStorage.removeItem("intent_plano_ciclo"));
      } catch (a) {}
    }, []),
    [Xa, Ge] = o.useState({ kind: "", message: "", syncing: !1 }),
    [Ms, ii] = o.useState(null),
    [Ds, ri] = o.useState(null),
    [ea, vt] = o.useState(null),
    [qs, Hs] = o.useState(""),
    [mn, aa] = o.useState(""),
    [Na, pn] = o.useState(!1),
    [Va, li] = o.useState("mensal"),
    [G, sa] = o.useState({ open: !1, data: null }),
    [hn, Ka] = o.useState(null),
    [ka, Bs] = o.useState(!1),
    [gn, Ya] = o.useState(""),
    [Fs, fn] = o.useState(!1),
    [bn, Ws] = o.useState("");
  o.useEffect(() => {
    if (!r || !V || !v.plan || ye.current || typeof window > "u") return;
    ye.current = !0;
    let a = null,
      t = null;
    const s = () => {
      const i = K.current;
      if (i) {
        try {
          i.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (l) {}
        try {
          i.focus({ preventScroll: !0 });
        } catch (l) {
          try {
            i.focus();
          } catch (f) {}
        }
        an();
        return;
      }
      const c = D.current.plan;
      if (c)
        try {
          c.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (l) {}
      Ge({
        kind: "warn",
        message: "Abra seu plano e gere o PIX para reativar.",
        syncing: !1,
      });
    };
    return (
      (t = window.requestAnimationFrame(() => {
        a = window.setTimeout(s, 60);
      })),
      () => {
        (t && window.cancelAnimationFrame(t), a && window.clearTimeout(a));
      }
    );
  }, [an, r, v.plan, Ge, V]);
  const wa = o.useRef(null),
    $s = o.useRef(0),
    Ca = o.useRef(!1),
    [Sa, xn] = o.useState("100"),
    [jt, _n] = o.useState(null),
    [Nt, kt] = o.useState(""),
    [Qa, ci] = o.useState(!1),
    [Ja, ui] = o.useState(!1),
    [yn, wt] = o.useState(1),
    [Za, Us] = o.useState(!1),
    [ta, di] = o.useState("all"),
    [Pa, mi] = o.useState("all"),
    ge = o.useRef(null),
    Ce = o.useCallback(() => {
      (wa.current && (clearInterval(wa.current), (wa.current = null)),
        ($s.current = 0));
    }, []),
    Me = o.useCallback(() => {
      (Ce(), Ka(null), (Ca.current = !1), Bs(!1), Ya(""));
    }, [Ce]),
    vn = o.useCallback(() => {
      (Me(), sa({ open: !1, data: null }));
    }, [Me]),
    La = o.useCallback(() => {
      try {
        localStorage.removeItem(nl);
      } catch (a) {}
    }, []),
    na = o.useMemo(() => {
      const t = (
        Array.isArray(x == null ? void 0 : x.whatsappPackages)
          ? x.whatsappPackages
          : []
      )
        .map((s) => {
          var l, f, j;
          const i =
              Number(
                (j =
                  (f =
                    (l = s == null ? void 0 : s.wa_messages) != null
                      ? l
                      : s == null
                        ? void 0
                        : s.waMessages) != null
                    ? f
                    : s == null
                      ? void 0
                      : s.messages) != null
                  ? j
                  : 0,
              ) || 0,
            c =
              typeof (s == null ? void 0 : s.price_cents) == "number"
                ? s.price_cents
                : typeof (s == null ? void 0 : s.priceCents) == "number"
                  ? s.priceCents
                  : typeof (s == null ? void 0 : s.price) == "number"
                    ? s.price
                    : null;
          return i ? { ...s, messages: i, price_cents: c } : null;
        })
        .filter(Boolean);
      return t.length
        ? t
        : [
            { messages: 100, price_cents: 990 },
            { messages: 200, price_cents: 1690 },
            { messages: 300, price_cents: 2490 },
            { messages: 500, price_cents: 3990 },
            { messages: 1e3, price_cents: 7990 },
            { messages: 2500, price_cents: 19990 },
          ];
    }, [x == null ? void 0 : x.whatsappPackages]),
    Ct = o.useMemo(
      () =>
        Array.isArray(x == null ? void 0 : x.whatsappHistory)
          ? x.whatsappHistory
          : [],
      [x == null ? void 0 : x.whatsappHistory],
    ),
    Se = o.useMemo(() => {
      const a = Array.isArray(Ct) ? Ct : [];
      if (!a.length) return [];
      const t = (l) => {
          if (!l) return null;
          const f = new Date(l);
          return Number.isFinite(f.getTime()) ? f : null;
        },
        s = (l) => {
          const f = String(
            (l == null ? void 0 : l.status) ||
              (l == null ? void 0 : l.payment_status) ||
              (l == null ? void 0 : l.state) ||
              "",
          ).toLowerCase();
          return f
            ? f.includes("pend")
              ? { key: "pending", label: "Pendente", tone: "pending" }
              : f.includes("paid") ||
                  f.includes("approved") ||
                  f.includes("conf") ||
                  f.includes("ok")
                ? { key: "paid", label: "Confirmado", tone: "success" }
                : f.includes("fail") ||
                    f.includes("refused") ||
                    f.includes("cancel")
                  ? { key: "failed", label: "Falhou", tone: "error" }
                  : {
                      key: "",
                      label: f.charAt(0).toUpperCase() + f.slice(1),
                      tone: "neutral",
                    }
            : { key: "", label: "", tone: "" };
        },
        i = a.map((l, f) => {
          var he, z, qe, Ee, He, ra;
          const j =
              (Ee =
                (qe =
                  (z =
                    (he = l == null ? void 0 : l.created_at) != null
                      ? he
                      : l == null
                        ? void 0
                        : l.createdAt) != null
                    ? z
                    : l == null
                      ? void 0
                      : l.date) != null
                  ? qe
                  : l == null
                    ? void 0
                    : l.created) != null
                ? Ee
                : null,
            d = t(j),
            N = d
              ? d.toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "",
            b =
              typeof (l == null ? void 0 : l.price_cents) == "number"
                ? l.price_cents
                : null,
            _ =
              b != null
                ? (Number(b) / 100).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })
                : null,
            y =
              (ra =
                (He = l == null ? void 0 : l.messages) != null
                  ? He
                  : l == null
                    ? void 0
                    : l.extra_delta) != null
                ? ra
                : 0,
            k = s(l),
            se =
              (l == null ? void 0 : l.id) ||
              (l == null ? void 0 : l.payment_id) ||
              (l == null ? void 0 : l.paymentId) ||
              N ||
              _ ||
              y ||
              "whatsapp-history-".concat(f);
          return {
            item: l,
            date: d,
            createdLabel: N,
            priceLabel: _,
            messagesLabel: y,
            statusKey: k.key,
            statusLabel: k.label,
            statusTone: k.tone,
            key: se,
          };
        });
      return i.some((l) => l.date)
        ? [...i].sort((l, f) =>
            !l.date && !f.date
              ? 0
              : l.date
                ? f.date
                  ? f.date.getTime() - l.date.getTime()
                  : -1
                : 1,
          )
        : i;
    }, [Ct]),
    jn = o.useMemo(() => Se.slice(0, sl), [Se]),
    es = o.useMemo(() => Se.some((a) => a.date), [Se]),
    as = o.useMemo(() => Se.some((a) => a.statusKey), [Se]),
    ss = o.useMemo(() => {
      let a = Se;
      if (es && ta !== "all") {
        const t = Date.now();
        let s = null;
        (ta === "30"
          ? (s = t - 30 * 24 * 60 * 60 * 1e3)
          : ta === "90"
            ? (s = t - 90 * 24 * 60 * 60 * 1e3)
            : ta === "year" &&
              (s = new Date(new Date().getFullYear(), 0, 1).getTime()),
          s != null && (a = a.filter((i) => i.date && i.date.getTime() >= s)));
      }
      return (
        as && Pa !== "all" && (a = a.filter((t) => t.statusKey === Pa)),
        a
      );
    }, [Se, es, as, ta, Pa]),
    St = o.useMemo(() => ss.slice(0, yn * tl), [ss, yn]),
    zs = St.length < ss.length;
  (o.useEffect(() => {
    if (!na.length) return;
    na.some((t) => String(t.messages) === String(Sa)) ||
      xn(String(na[0].messages));
  }, [Sa, na]),
    o.useEffect(() => {
      (ge.current && (clearTimeout(ge.current), (ge.current = null)),
        Us(!1),
        wt(1));
    }, [ta, Pa, Se]),
    o.useEffect(() => {
      Ja ||
        (ge.current && (clearTimeout(ge.current), (ge.current = null)),
        wt(1),
        Us(!1));
    }, [Ja]),
    o.useEffect(() => () => Ce(), [Ce]),
    o.useEffect(
      () => () => {
        ge.current && clearTimeout(ge.current);
      },
      [],
    ));
  const Nn = o.useCallback(() => {
    Za ||
      !zs ||
      (Us(!0),
      ge.current && clearTimeout(ge.current),
      (ge.current = window.setTimeout(() => {
        (wt((a) => a + 1), Us(!1), (ge.current = null));
      }, 350)));
  }, [Za, zs]);
  o.useCallback((a) => {
    const t = String(a || "").toLowerCase();
    return t
      ? t.includes("high_risk")
        ? "Pagamento recusado por segurança. Gere um novo PIX e pague pelo app bancário em um dispositivo confiável."
        : t.includes("insufficient") || t.includes("rejected")
          ? "Pagamento não aprovado. Verifique saldo/limite e gere um novo PIX."
          : "Pagamento não confirmado. Gere um novo PIX e finalize pelo seu banco."
      : "O pagamento não foi concluído. Gere o PIX novamente.";
  }, []);
  const Os = o.useMemo(() => {
      try {
        return Array.isArray(x == null ? void 0 : x.history)
          ? x.history.some((a) => {
              const t =
                  (a == null ? void 0 : a.plan) === "pro" ||
                  (a == null ? void 0 : a.plan) === "premium",
                s = String((a == null ? void 0 : a.status) || "").toLowerCase(),
                i = [
                  "active",
                  "authorized",
                  "paused",
                  "past_due",
                  "canceled",
                  "expired",
                ].includes(s);
              return t && i;
            })
          : !1;
      } catch (a) {
        return !1;
      }
    }, [x == null ? void 0 : x.history]),
    Pt = o.useMemo(() => {
      const a = h.plan === "starter",
        t = !h.trialEnd;
      return a && t && !Os;
    }, [h.plan, h.trialEnd, Os]),
    kn = o.useMemo(
      () => String((J == null ? void 0 : J.state) || "").toLowerCase(),
      [J == null ? void 0 : J.state],
    ),
    pi = o.useMemo(() => {
      if (!h.activeUntil) return !1;
      const a = new Date(h.activeUntil);
      return Number.isFinite(a.getTime()) ? a.getTime() < Date.now() : !1;
    }, [h.activeUntil]),
    pa = kn === "overdue" || kn === "blocked" || pi,
    ts = o.useMemo(() => {
      var s;
      if (pa) return !1;
      const a = String(h.status || "").toLowerCase(),
        t = String(
          ((s = x == null ? void 0 : x.subscription) == null
            ? void 0
            : s.status) || "",
        ).toLowerCase();
      return a === "active" || t === "active" || t === "authorized";
    }, [
      h.status,
      (to = x == null ? void 0 : x.subscription) == null ? void 0 : to.status,
      pa,
    ]),
    wn = o.useMemo(() => {
      var a;
      return String(
        ((a = x == null ? void 0 : x.subscription) == null
          ? void 0
          : a.status) || "",
      ).toLowerCase();
    }, [
      (no = x == null ? void 0 : x.subscription) == null ? void 0 : no.status,
    ]),
    Gs = (J == null ? void 0 : J.billing) || {},
    ns = !!Gs.renewalRequired,
    Ea = Gs.openPayment || null,
    Lt = !!(Gs.hasOpenPayment && Ea),
    hi = String(Gs.paymentMethod || "pix_manual").toLowerCase(),
    gi = (J == null ? void 0 : J.trial) || {};
  o.useEffect(() => {
    ns || Ws("");
  }, [ns]);
  const Cn = (a) => {
      var s;
      const t = (s = Be[a]) == null ? void 0 : s.maxServices;
      return t == null || Ms == null ? !1 : Ms > t;
    },
    Sn = (a) => {
      var s;
      const t = (s = Be[a]) == null ? void 0 : s.maxProfessionals;
      return t == null || Ds == null ? !1 : Ds > t;
    };
  (o.useEffect(() => {
    var a, t;
    try {
      const s = localStorage.getItem("plan_current") || "starter",
        i = localStorage.getItem("plan_status") || "trialing",
        c = localStorage.getItem("trial_end"),
        l = c
          ? Math.max(
              0,
              Math.floor((new Date(c).getTime() - Date.now()) / 864e5),
            )
          : null,
        f =
          (t = (a = Be[s]) == null ? void 0 : a.maxAppointments) != null
            ? t
            : null,
        j = new Date().toLocaleString("pt-BR", {
          month: "long",
          year: "numeric",
        });
      ve((d) => {
        var N;
        return {
          ...d,
          plan: s,
          status: i,
          trialEnd: c,
          trialDaysLeft: l,
          trialWarn: l != null ? l <= 3 : d.trialWarn,
          appointmentsLimit: f,
          appointmentsMonth: d.appointmentsMonth || j,
          appointmentsUsed: (N = d.appointmentsUsed) != null ? N : null,
        };
      });
    } catch (s) {}
  }, []),
    o.useEffect(() => {
      var a, t;
      n &&
        (da({
          nome: n.nome || "",
          email: n.email || "",
          telefone: st(n.telefone || ""),
          data_nascimento: Zr(n.data_nascimento),
          cep: Qt(n.cep || ""),
          endereco: n.endereco || "",
          numero: n.numero || "",
          complemento: n.complemento || "",
          bairro: n.bairro || "",
          cidade: n.cidade || "",
          estado: (n.estado || "").toUpperCase(),
          avatar_url: n.avatar_url || "",
          notifyEmailEstab: !!((a = n.notify_email_estab) == null || a),
          notifyWhatsappEstab: !!((t = n.notify_whatsapp_estab) == null || t),
        }),
        za(ys(n.avatar_url || "")),
        Ls(""),
        Es(!1),
        Ie(""));
    }, [n == null ? void 0 : n.id]),
    o.useEffect(() => {
      if (!r) {
        Rs.current = "";
        return;
      }
      const a = T.cep.replace(/\D/g, "");
      if (a.length !== 8) {
        Rs.current = "";
        return;
      }
      if (Rs.current === a) return;
      Rs.current = a;
      let t = !0;
      return (
        fetch("https://viacep.com.br/ws/".concat(a, "/json/"))
          .then((s) => s.json())
          .then((s) => {
            !t ||
              !s ||
              s.erro ||
              da((i) => ({
                ...i,
                cep: Qt(a),
                endereco: s.logradouro || i.endereco,
                bairro: s.bairro || i.bairro,
                cidade: s.localidade || i.cidade,
                estado: (s.uf || i.estado || "").toUpperCase(),
              }));
          })
          .catch(() => {}),
        () => {
          t = !1;
        }
      );
    }, [r, T.cep]));
  const oe = o.useCallback(async () => {
      var a, t;
      if (!r || !(n != null && n.id)) return null;
      try {
        un(!0);
        const [s, i, c] = await Promise.all([
          I.billingSubscription(),
          I.billingWhatsAppWallet().catch(
            (d) => (console.warn("billingWhatsAppWallet failed", d), null),
          ),
          I.billingWhatsAppPacks()
            .then((d) => d)
            .catch(
              (d) => (console.warn("billingWhatsAppPacks failed", d), null),
            ),
        ]);
        s != null &&
          s.plan &&
          ve((d) => {
            var qe, Ee, He, ra, Ys, us, ds, ms, ps;
            const N = s.plan.status || d.status,
              b = (N === "active" && s.plan.plan) || d.plan,
              _ = (qe = s.plan.usage) == null ? void 0 : qe.appointments,
              y = new Date().toLocaleString("pt-BR", {
                month: "long",
                year: "numeric",
              }),
              k =
                typeof (_ == null ? void 0 : _.total) == "number" ? _.total : 0,
              se =
                (Ys =
                  (ra =
                    (He = _ == null ? void 0 : _.limit) != null
                      ? He
                      : (Ee = s.plan.limits) == null
                        ? void 0
                        : Ee.maxMonthlyAppointments) != null
                    ? ra
                    : d.appointmentsLimit) != null
                  ? Ys
                  : null,
              he = (_ == null ? void 0 : _.month) || d.appointmentsMonth || y,
              z = {
                ...d,
                plan: b,
                status: N,
                trialEnd:
                  ((us = s.plan.trial) == null ? void 0 : us.ends_at) ||
                  d.trialEnd,
                trialDaysLeft:
                  typeof ((ds = s.plan.trial) == null
                    ? void 0
                    : ds.days_left) == "number"
                    ? s.plan.trial.days_left
                    : d.trialDaysLeft,
                trialWarn: !!((ms = s.plan.trial) != null && ms.warn),
                allowAdvanced: !!(
                  (ps = s.plan.limits) != null && ps.allowAdvancedReports
                ),
                activeUntil: s.plan.active_until || d.activeUntil,
                appointmentsUsed: k,
                appointmentsLimit: se,
                appointmentsMonth: he,
              };
            try {
              (localStorage.setItem("plan_current", z.plan),
                localStorage.setItem("plan_status", z.status),
                z.trialEnd
                  ? localStorage.setItem("trial_end", z.trialEnd)
                  : localStorage.removeItem("trial_end"));
            } catch ($t) {}
            return z;
          });
        const l =
            (i == null ? void 0 : i.wallet) ||
            ((t =
              (a = s == null ? void 0 : s.plan) == null ? void 0 : a.usage) ==
            null
              ? void 0
              : t.whatsapp) ||
            null,
          f =
            (Array.isArray(c == null ? void 0 : c.packs) && c.packs.length
              ? c.packs
              : null) ||
            (Array.isArray(i == null ? void 0 : i.packages) && i.packages.length
              ? i.packages
              : null) ||
            (Array.isArray(s == null ? void 0 : s.whatsapp_packages) &&
            s.whatsapp_packages.length
              ? s.whatsapp_packages
              : null) ||
            [],
          j = Array.isArray(i == null ? void 0 : i.history) ? i.history : [];
        return (
          ni({
            subscription: (s == null ? void 0 : s.subscription) || null,
            history: Array.isArray(s == null ? void 0 : s.history)
              ? s.history
              : [],
            topups: Array.isArray(s == null ? void 0 : s.topups)
              ? s.topups
              : [],
            whatsappWallet: l,
            whatsappPackages: f,
            whatsappHistory: j,
          }),
          s
        );
      } catch (s) {
        throw (console.error("billingSubscription failed", s), s);
      } finally {
        un(!1);
      }
    }, [r, n == null ? void 0 : n.id]),
    Xs = o.useCallback(async () => {
      var a;
      if (!r || !(n != null && n.id)) return null;
      Re((t) => ({ ...t, loading: !0, error: "" }));
      try {
        const t = await I.waConnectStatus();
        return (
          Re((s) => ({
            ...s,
            loading: !1,
            account: (t == null ? void 0 : t.account) || null,
          })),
          t
        );
      } catch (t) {
        const s =
          ((a = t == null ? void 0 : t.data) == null ? void 0 : a.message) ||
          (t == null ? void 0 : t.message) ||
          "Falha ao carregar o status do WhatsApp.";
        return (Re((i) => ({ ...i, loading: !1, error: s })), null);
      }
    }, [r, n == null ? void 0 : n.id]),
    Vs = o.useCallback(async () => {
      var a;
      if (!r || !(n != null && n.id)) return null;
      Te((t) => ({ ...t, loading: !0, error: "" }));
      try {
        const t = await I.mpConnectStatus();
        return (Te((s) => ({ ...s, loading: !1, account: t || null })), t);
      } catch (t) {
        const s =
          ((a = t == null ? void 0 : t.data) == null ? void 0 : a.message) ||
          (t == null ? void 0 : t.message) ||
          "Falha ao carregar o status do Mercado Pago.";
        return (Te((i) => ({ ...i, loading: !1, error: s })), null);
      }
    }, [r, n == null ? void 0 : n.id]),
    Pn = o.useCallback(async () => {
      var a;
      if (r) {
        Re((t) => ({ ...t, connectLoading: !0, error: "", notice: "" }));
        try {
          const t = await I.waConnectStart();
          if (!(t != null && t.url))
            throw new Error("URL de conexao indisponivel.");
          window.location.assign(t.url);
        } catch (t) {
          const s =
            ((a = t == null ? void 0 : t.data) == null ? void 0 : a.message) ||
            (t == null ? void 0 : t.message) ||
            "Nao foi possivel iniciar a conexao.";
          Re((i) => ({ ...i, connectLoading: !1, error: s }));
        }
      }
    }, [r]),
    Et = o.useCallback(async () => {
      var a;
      if (r) {
        if (!Ve) {
          Te((t) => ({
            ...t,
            connectLoading: !1,
            notice: "",
            error: "Recurso disponível apenas para planos Pro e Premium.",
          }));
          return;
        }
        Te((t) => ({ ...t, connectLoading: !0, error: "", notice: "" }));
        try {
          const t = await I.mpConnectStart();
          if (!(t != null && t.url))
            throw new Error("URL de conexao indisponivel.");
          window.location.assign(t.url);
        } catch (t) {
          const s =
            ((a = t == null ? void 0 : t.data) == null ? void 0 : a.message) ||
            (t == null ? void 0 : t.message) ||
            "Nao foi possivel iniciar a conexao.";
          Te((i) => ({ ...i, connectLoading: !1, error: s }));
        }
      }
    }, [r, Ve]),
    Ln = o.useCallback(async () => {
      var a;
      if (r) {
        Re((t) => ({ ...t, disconnectLoading: !0, error: "", notice: "" }));
        try {
          (await I.waConnectDisconnect(),
            await Xs(),
            Re((t) => ({
              ...t,
              disconnectLoading: !1,
              notice: "WhatsApp desconectado.",
            })));
        } catch (t) {
          const s =
            ((a = t == null ? void 0 : t.data) == null ? void 0 : a.message) ||
            (t == null ? void 0 : t.message) ||
            "Nao foi possivel desconectar.";
          Re((i) => ({ ...i, disconnectLoading: !1, error: s }));
        }
      }
    }, [r, Xs]),
    En = o.useCallback(async () => {
      var a;
      if (r) {
        Te((t) => ({ ...t, disconnectLoading: !0, error: "", notice: "" }));
        try {
          (await I.mpConnectDisconnect(),
            await Vs(),
            Te((t) => ({
              ...t,
              disconnectLoading: !1,
              notice: "Mercado Pago desconectado.",
            })));
        } catch (t) {
          const s =
            ((a = t == null ? void 0 : t.data) == null ? void 0 : a.message) ||
            (t == null ? void 0 : t.message) ||
            "Nao foi possivel desconectar.";
          Te((i) => ({ ...i, disconnectLoading: !1, error: s }));
        }
      }
    }, [r, Vs]),
    Aa = o.useCallback(async () => {
      if (!r || !(n != null && n.id)) return null;
      try {
        const a = await I.billingStatus();
        return (oi(a || null), a);
      } catch (a) {
        throw (console.error("billingStatus failed", a), a);
      }
    }, [r, n == null ? void 0 : n.id]);
  (o.useEffect(() => {
    (async () => {
      var a, t, s;
      if (!(!r || !(n != null && n.id))) {
        try {
          const i = new URL(window.location.href),
            c = (i.searchParams.get("checkout") || "").toLowerCase();
          (c === "sucesso"
            ? Ge({
                kind: "success",
                message:
                  "PIX gerado com sucesso. Assim que o pagamento for confirmado liberamos tudo automaticamente.",
                syncing: !1,
              })
            : c === "erro"
              ? Ge({
                  kind: "error",
                  message:
                    "O PIX foi cancelado antes da confirmação. Gere um novo link e conclua o pagamento.",
                  syncing: !1,
                })
              : c === "pendente" &&
                Ge({
                  kind: "warn",
                  message: "Pagamento pendente de confirmação.",
                  syncing: !1,
                }),
            c &&
              (i.searchParams.delete("checkout"),
              window.history.replaceState({}, "", i.toString())));
          const l = (i.searchParams.get("wa") || "").toLowerCase();
          if (l) {
            const d = {
              connected: { notice: "WhatsApp conectado com sucesso." },
              disconnected: { notice: "WhatsApp desconectado." },
              error: {
                error: "Nao foi possivel concluir a conexao do WhatsApp.",
              },
              phone_in_use: {
                error: "Esse numero ja esta conectado a outro estabelecimento.",
              },
            }[l];
            (d != null && d.notice
              ? Re((N) => ({ ...N, notice: d.notice, error: "" }))
              : d != null &&
                d.error &&
                Re((N) => ({ ...N, error: d.error, notice: "" })),
              i.searchParams.delete("wa"),
              window.history.replaceState({}, "", i.toString()));
          }
          const f = (i.searchParams.get("mp") || "").toLowerCase();
          if (f) {
            const d = {
              connected: { notice: "Mercado Pago conectado com sucesso." },
              disconnected: { notice: "Mercado Pago desconectado." },
              error: {
                error: "Nao foi possivel concluir a conexao do Mercado Pago.",
              },
            }[f];
            (d != null && d.notice
              ? Te((N) => ({ ...N, notice: d.notice, error: "" }))
              : d != null &&
                d.error &&
                Te((N) => ({ ...N, error: d.error, notice: "" })),
              i.searchParams.delete("mp"),
              window.history.replaceState({}, "", i.toString()));
          }
        } catch (i) {}
        try {
          await oe();
        } catch (i) {}
        try {
          await Aa();
        } catch (i) {}
        try {
          await Xs();
        } catch (i) {}
        try {
          await Vs();
        } catch (i) {}
        try {
          (we(!0), Ue({ type: "", message: "" }));
          const i = await I.getEstablishment(n.id);
          ke((i == null ? void 0 : i.slug) || "");
          const c = i == null ? void 0 : i.plan_context;
          if ((ks((i == null ? void 0 : i.profile) || null), c)) {
            ve((l) => {
              var f, j, d, N, b, _, y;
              return {
                ...l,
                plan: c.plan || "starter",
                status: c.status || "trialing",
                trialEnd: ((f = c.trial) == null ? void 0 : f.ends_at) || null,
                trialDaysLeft:
                  typeof ((j = c.trial) == null ? void 0 : j.days_left) ==
                  "number"
                    ? c.trial.days_left
                    : l.trialDaysLeft,
                trialWarn: !!((d = c.trial) != null && d.warn),
                allowAdvanced: !!(
                  (N = c.limits) != null && N.allowAdvancedReports
                ),
                allowWhatsapp: !!((y =
                  (b = c.features) == null ? void 0 : b.allow_whatsapp) != null
                  ? y
                  : (_ = c.limits) != null && _.allowWhatsApp),
                activeUntil: c.active_until || null,
              };
            });
            try {
              (localStorage.setItem("plan_current", c.plan || "starter"),
                localStorage.setItem("plan_status", c.status || "trialing"),
                (a = c.trial) != null && a.ends_at
                  ? localStorage.setItem("trial_end", c.trial.ends_at)
                  : localStorage.removeItem("trial_end"));
            } catch (l) {}
          }
        } catch (i) {
          Ue((c) =>
            c != null && c.message
              ? c
              : {
                  type: "error",
                  message: "Não foi possível carregar o perfil público.",
                },
          );
        } finally {
          we(!1);
        }
        try {
          le(!0);
          const i = await I.getEstablishmentSettings(),
            c = (i == null ? void 0 : i.deposit) || {};
          (Fe(!!((t = i == null ? void 0 : i.features) != null && t.deposit)),
            ie(!!c.enabled),
            te(c.percent != null ? String(c.percent) : ""),
            Ke(Number(c.hold_minutes) || Zt));
        } catch (i) {
          const c =
            ((s = i == null ? void 0 : i.data) == null ? void 0 : s.message) ||
            (i == null ? void 0 : i.message) ||
            "Não foi possível carregar o sinal.";
          ce({ type: "error", message: c });
        } finally {
          le(!1);
        }
        try {
          const i = await I.getEstablishmentStats(n.id);
          (ii(
            typeof (i == null ? void 0 : i.services) == "number"
              ? i.services
              : 0,
          ),
            ri(
              typeof (i == null ? void 0 : i.professionals) == "number"
                ? i.professionals
                : 0,
            ));
        } catch (i) {}
        try {
          const i = await I.getEstablishmentMessages(n.id);
          lt({
            email_subject: (i == null ? void 0 : i.email_subject) || "",
            email_html: (i == null ? void 0 : i.email_html) || "",
            wa_template: (i == null ? void 0 : i.wa_template) || "",
          });
        } catch (i) {}
        try {
          await oe();
        } catch (i) {}
      }
    })();
  }, [r, n == null ? void 0 : n.id, oe, Aa, Xs, Vs, ks]),
    o.useEffect(() => {
      const a = x == null ? void 0 : x.subscription;
      if (!a || String(a.status || "").toLowerCase() !== "active") return;
      const s = ""
        .concat(a.id || "sub", ":")
        .concat(a.current_period_end || a.updated_at || "");
      if (!s || yt.current === s) return;
      let i = null;
      try {
        i = localStorage.getItem(Go);
      } catch (N) {}
      if (i === s) {
        yt.current = s;
        return;
      }
      yt.current = s;
      try {
        localStorage.setItem(Go, s);
      } catch (N) {}
      const c = nt(a.plan || h.plan),
        l = Uo(a.billing_cycle || a.cycle),
        f = zo(a.amount_cents),
        j = {
          plan: c,
          plan_label: Ha(c),
          billing_cycle: l,
          subscription_id: a.id || null,
          transaction_id: a.gateway_preference_id || a.id || null,
          currency: tt,
          items: [Oo(c, l, f)],
        };
      (f != null && (j.value = f), Bo("purchase", j));
      const d = { plan: c, billing_cycle: l, currency: tt };
      (f != null && (d.value = f),
        a.gateway_preference_id && (d.order_id = a.gateway_preference_id),
        Fo("Purchase", d));
    }, [x == null ? void 0 : x.subscription, h.plan]),
    o.useEffect(() => {
      var t;
      const a = String(
        ((t = x == null ? void 0 : x.subscription) == null
          ? void 0
          : t.status) || "",
      ).toLowerCase();
      (a === "active" || a === "authorized") && La();
    }, [
      (oo = x == null ? void 0 : x.subscription) == null ? void 0 : oo.status,
      La,
    ]));
  const Ia = o.useCallback(
      async (a, t = "mensal") => {
        var i, c, l, f, j, d, N, b;
        if (!r || !(n != null && n.id)) return !1;
        (La(),
          Ge({ kind: "", message: "", syncing: !1 }),
          _t(""),
          dn(!0),
          (Ga.current = !0));
        let s = !1;
        try {
          let _ = null;
          const y = await I.billingPixCheckout({ plan: a, billing_cycle: t });
          if (y) {
            const k =
              (f =
                (l =
                  (i = y == null ? void 0 : y.pix) == null
                    ? void 0
                    : i.amount_cents) != null
                  ? l
                  : (c = y == null ? void 0 : y.subscription) == null
                    ? void 0
                    : c.amount_cents) != null
                ? f
                : null;
            _ =
              ((j = y == null ? void 0 : y.pix) == null
                ? void 0
                : j.payment_id) ||
              ((d = y == null ? void 0 : y.subscription) == null
                ? void 0
                : d.gateway_preference_id) ||
              null;
            const se = nt(a),
              he = Uo(t),
              z = zo(k),
              qe = {
                plan: se,
                plan_label: Ha(se),
                billing_cycle: he,
                payment_id: _ || null,
                currency: tt,
                items: [Oo(se, he, z)],
              };
            (z != null && (qe.value = z), Bo("initiate_checkout", qe));
            const Ee = { plan: se, billing_cycle: he, currency: tt };
            (z != null && (Ee.value = z),
              _ && (Ee.order_id = _),
              Fo("InitiateCheckout", Ee));
          }
          if (y != null && y.pix && (y.pix.qr_code || y.pix.ticket_url)) {
            (Me(), _ && Ka(_));
            const k = {
              status:
                ((N = y == null ? void 0 : y.pix) == null
                  ? void 0
                  : N.status) || "pending",
              ...y.pix,
              init_point: y.init_point,
              plan: a,
              billing_cycle: t,
            };
            sa({ open: !0, data: k });
          } else if (y != null && y.init_point)
            return ((window.location.href = y.init_point), (s = !0), s);
          (await oe(), (s = !0));
        } catch (_) {
          _t(
            ((b = _ == null ? void 0 : _.data) == null ? void 0 : b.message) ||
              (_ == null ? void 0 : _.message) ||
              "Falha ao gerar cobranca PIX.",
          );
        } finally {
          (dn(!1), Ts(), (Ga.current = !1));
        }
        return s;
      },
      [oe, r, n == null ? void 0 : n.id, La, Me, Ts],
    ),
    fi = o.useCallback(() => {
      !Lt ||
        !Ea ||
        (Me(),
        Ea.payment_id && Ka(Ea.payment_id),
        sa({ open: !0, data: { ...Ea, kind: "renewal" } }),
        Ws(""));
    }, [Lt, Ea, Me]),
    At = o.useCallback(async () => {
      var a, t;
      if (!r || !(n != null && n.id)) return !1;
      (Ws(""), fn(!0));
      try {
        const s = await I.billingRenewalPix();
        (await oe(), await Aa());
        const i =
          (a = s == null ? void 0 : s.renewal) == null ? void 0 : a.openPayment;
        return (
          i &&
            (Me(),
            i.payment_id && Ka(i.payment_id),
            sa({ open: !0, data: { ...i, kind: "renewal" } })),
          !0
        );
      } catch (s) {
        return (
          Ws(
            ((t = s == null ? void 0 : s.data) == null ? void 0 : t.message) ||
              (s == null ? void 0 : s.message) ||
              "Falha ao gerar PIX de renovação.",
          ),
          !1
        );
      } finally {
        fn(!1);
      }
    }, [r, n == null ? void 0 : n.id, oe, Aa, Me]),
    An = o.useCallback(
      async (a = null) => {
        var s, i, c, l, f, j, d, N;
        if (!r || !(n != null && n.id)) return !1;
        kt("");
        let t = !1;
        try {
          const b =
              a ||
              na.find(
                (z) => Number(z == null ? void 0 : z.messages) === Number(Sa),
              ) ||
              null,
            _ = {};
          if (
            ((b == null ? void 0 : b.id) != null && (_.pack_id = b.id),
            b != null && b.code && (_.pack_code = b.code),
            b != null && b.messages
              ? ((_.messages = b.messages), xn(String(b.messages)))
              : Sa && (_.messages = Number(Sa)),
            !_.messages && !_.pack_id && !_.pack_code)
          )
            return (kt("Selecione um pacote de mensagens."), t);
          const y =
            (l =
              (c =
                (i =
                  (s = b == null ? void 0 : b.id) != null
                    ? s
                    : b == null
                      ? void 0
                      : b.code) != null
                  ? i
                  : b == null
                    ? void 0
                    : b.messages) != null
                ? c
                : _.messages) != null
              ? l
              : null;
          y != null && _n(String(y));
          const k = await I.billingWhatsAppPix(_),
            se =
              (k == null ? void 0 : k.pack) ||
              (k == null ? void 0 : k.package) ||
              b ||
              null,
            he =
              ((f = k == null ? void 0 : k.pix) == null
                ? void 0
                : f.payment_id) ||
              ((j = k == null ? void 0 : k.subscription) == null
                ? void 0
                : j.gateway_preference_id) ||
              null;
          if (
            k != null &&
            k.pix &&
            (k.pix.qr_code || k.pix.ticket_url || k.pix.qr_code_base64)
          ) {
            (Me(), he && Ka(he));
            const z = {
              status:
                ((d = k == null ? void 0 : k.pix) == null
                  ? void 0
                  : d.status) || "pending",
              ...k.pix,
              init_point: k.init_point,
              kind: "whatsapp_topup",
              pack: se,
            };
            (sa({ open: !0, data: z }), (t = !0));
          } else if (k != null && k.init_point)
            return ((window.location.href = k.init_point), (t = !0), t);
          (await oe(), (t = !0));
        } catch (b) {
          kt(
            ((N = b == null ? void 0 : b.data) == null ? void 0 : N.message) ||
              (b == null ? void 0 : b.message) ||
              "Falha ao gerar cobranca PIX do pacote.",
          );
        } finally {
          _n(null);
        }
        return t;
      },
      [oe, r, n == null ? void 0 : n.id, Sa, na, Me],
    ),
    ha = o.useMemo(() => {
      var a, t, s;
      return (
        hn ||
        ((a = G.data) == null ? void 0 : a.payment_id) ||
        ((t = G.data) == null ? void 0 : t.paymentId) ||
        ((s = G.data) == null ? void 0 : s.gateway_preference_id) ||
        null
      );
    }, [
      hn,
      (io = G.data) == null ? void 0 : io.payment_id,
      (ro = G.data) == null ? void 0 : ro.paymentId,
      (lo = G.data) == null ? void 0 : lo.gateway_preference_id,
    ]),
    In = ((co = G.data) == null ? void 0 : co.kind) || "",
    Ra = In === "whatsapp_topup",
    os = In === "renewal",
    Ks = G.open && (Ra || os),
    is = o.useCallback(
      async ({ silent: a = !0 } = {}) => {
        if (!Ks || !ha || Ca.current) return null;
        $s.current += 1;
        try {
          if (Ra) {
            const t = await I.billingWhatsAppPixStatus(ha);
            if (t != null && t.credited) {
              ((Ca.current = !0),
                Bs(!0),
                Ya("Pagamento confirmado! Saldo atualizado automaticamente."),
                Ce(),
                sa((s) =>
                  s != null && s.data
                    ? { ...s, data: { ...s.data, status: "approved" } }
                    : s,
                ));
              try {
                await oe();
              } catch (s) {
                console.warn("billing refresh after PIX credit failed", s);
              }
              return t;
            }
          } else if (os) {
            const t = await I.billingRenewalPixStatus(ha);
            if (
              (t != null &&
                t.openPayment &&
                sa((s) =>
                  s != null && s.data
                    ? { ...s, data: { ...s.data, ...t.openPayment } }
                    : s,
                ),
              t != null && t.paid)
            ) {
              ((Ca.current = !0),
                Bs(!0),
                Ya("Pagamento confirmado! Renovamos o plano automaticamente."),
                Ce(),
                sa((s) =>
                  s != null && s.data
                    ? { ...s, data: { ...s.data, status: "approved" } }
                    : s,
                ));
              try {
                (await oe(), await Aa());
              } catch (s) {
                console.warn("billing refresh after PIX renewal failed", s);
              }
            }
            return t;
          }
        } catch (t) {
          a || console.warn("PIX status polling failed", t);
        }
        return (
          $s.current >= il &&
            !Ca.current &&
            (Ce(),
            Ya(
              "Ainda não confirmou. Se você já pagou, aguarde alguns instantes e clique em Atualizar.",
            )),
          null
        );
      },
      [Ce, oe, Aa, Ks, Ra, os, ha],
    );
  o.useEffect(() => {
    if (!Ks || !ha) {
      Ce();
      return;
    }
    ((Ca.current = !1),
      Bs(!1),
      Ya(""),
      Ce(),
      ($s.current = 0),
      is({ silent: !0 }));
    const a = setInterval(() => {
      is({ silent: !0 });
    }, ol);
    return (
      (wa.current = a),
      () => {
        (clearInterval(a), wa.current === a && (wa.current = null));
      }
    );
  }, [is, Ce, Ra, ha]);
  const bi = o.useCallback(() => is({ silent: !1 }), [is]),
    xi = o.useCallback(async (a) => {
      var t;
      if (!a) return !1;
      try {
        if (
          (t = navigator == null ? void 0 : navigator.clipboard) != null &&
          t.writeText
        )
          await navigator.clipboard.writeText(a);
        else {
          const s = document.createElement("textarea");
          ((s.value = a),
            (s.style.position = "fixed"),
            (s.style.opacity = "0"),
            document.body.appendChild(s),
            s.focus(),
            s.select(),
            document.execCommand("copy"),
            document.body.removeChild(s));
        }
        return (
          Ge({ kind: "info", message: "Chave PIX copiada!", syncing: !1 }),
          !0
        );
      } catch (s) {
        return (
          _t("Não foi possível copiar automaticamente. Copie manualmente."),
          !1
        );
      }
    }, []),
    Rn = o.useCallback(async (a) => Ia(a, Va), [Ia, Va]),
    It = o.useCallback(
      (a) => {
        const t = nt(a),
          s = nt(h.plan);
        if (t === s) {
          Ge({
            kind: "info",
            message: "Você já está neste plano.",
            syncing: !1,
          });
          return;
        }
        (vt(a), Hs(""), aa(""));
      },
      [h.plan],
    ),
    Tn = o.useCallback(() => {
      Na || (vt(null), Hs(""), aa(""));
    }, [Na]),
    _i = o.useCallback(async () => {
      var a, t;
      if (ea) {
        if (!(n != null && n.email)) {
          aa("Sessão expirada. Faça login novamente.");
          return;
        }
        if (!qs) {
          aa("Informe sua senha para confirmar.");
          return;
        }
        (aa(""), pn(!0));
        try {
          const s = await I.login(n.email, qs);
          if (!(s != null && s.token)) {
            aa("Não foi possível validar sua senha.");
            return;
          }
          (Ii(s.token),
            s.user && Kt(s.user),
            (await Rn(ea)) && (vt(null), Hs("")));
        } catch (s) {
          (s == null ? void 0 : s.status) === 401 ||
          ((a = s == null ? void 0 : s.data) == null ? void 0 : a.error) ===
            "invalid_credentials"
            ? aa("Senha incorreta. Tente novamente.")
            : aa(
                ((t = s == null ? void 0 : s.data) == null
                  ? void 0
                  : t.message) ||
                  (s == null ? void 0 : s.message) ||
                  "Falha ao validar senha.",
              );
        } finally {
          pn(!1);
        }
      }
    }, [ea, qs, Rn, n == null ? void 0 : n.email]),
    Mn = o.useMemo(() => {
      const a = String(ea || "").toLowerCase();
      return a
        ? a === "starter"
          ? "Downgrade: limites menores de serviços, profissionais e agendamentos. Passa a valer na próxima renovação se estiver dentro dos limites."
          : a === "premium"
            ? "Upgrade: recursos liberados imediatamente e cobrança do valor do plano Premium a partir do próximo ciclo."
            : "Confirmação obrigatória com senha. Upgrades liberam na hora; downgrades valem na próxima renovação."
        : "";
    }, [ea]),
    oa = o.useMemo(() => {
      if (h.trialDaysLeft != null) return h.trialDaysLeft;
      if (!h.trialEnd) return 0;
      const a = new Date(h.trialEnd).getTime() - Date.now();
      return Math.max(0, Math.floor(a / 864e5));
    }, [h.trialDaysLeft, h.trialEnd]),
    Dn = o.useCallback(() => {
      La();
    }, [La]),
    rs = o.useMemo(() => {
      if (String(h.status || "").toLowerCase() !== "trialing") return !1;
      if (typeof h.trialDaysLeft == "number" && h.trialDaysLeft < 0) return !0;
      if (!h.trialEnd) return !1;
      const a = new Date(h.trialEnd).getTime();
      return Number.isFinite(a) ? a < Date.now() : !1;
    }, [h.status, h.trialDaysLeft, h.trialEnd]);
  (o.useEffect(() => {
    if (!r) return;
    const a = String(h.status || "").toLowerCase(),
      t = !!h.trialEnd || h.trialDaysLeft != null;
    if (!(!!a && (a !== "trialing" || t || rs || oa > 0))) return;
    let i = null,
      c = "mensal",
      l = null;
    try {
      i = localStorage.getItem("intent_plano");
    } catch (d) {}
    try {
      const d = localStorage.getItem("intent_plano_ciclo");
      d && (c = d);
    } catch (d) {}
    try {
      l = localStorage.getItem("intent_kind");
    } catch (d) {}
    const j = (l || "").trim().toLowerCase() || "checkout";
    i &&
      !Ga.current &&
      ((Ga.current = !0),
      (async () => {
        try {
          const d = a === "trialing" && !rs && oa > 0;
          if (j === "renewal") {
            await At();
            return;
          }
          if (j === "trial" && d) {
            Ge({
              kind: "info",
              message:
                "Você está em teste grátis. Gere o PIX quando quiser ativar antes do fim do teste.",
              syncing: !1,
            });
            return;
          }
          await Ia(i, c);
        } finally {
          (Ts(), (Ga.current = !1));
        }
      })());
  }, [Ia, At, r, h.status, h.trialEnd, h.trialDaysLeft, rs, oa, Ts]),
    o.useEffect(() => {
      Dn();
    }, [Dn]));
  const ga = (a) =>
      a
        ? new Date(a).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })
        : "",
    Pe = o.useMemo(() => {
      var c;
      if (!n) return "";
      const a = n.id ? String(n.id) : "";
      if (!a) return "";
      let t = "https://agendamentosonline.com";
      if (typeof window < "u") {
        const l = ((c = window.location) == null ? void 0 : c.origin) || "";
        l.includes("agendamentosonline.com") && (t = l);
      }
      const s = E || (n == null ? void 0 : n.nome) || "",
        i = el(s || "estabelecimento-".concat(a));
      try {
        const l = new URL("/novo/".concat(i), t);
        return (l.searchParams.set("estabelecimento", a), l.toString());
      } catch (l) {
        return (console.error("publicLink generation failed", l), "");
      }
    }, [E, n == null ? void 0 : n.id, n == null ? void 0 : n.nome]),
    ls = o.useMemo(() => {
      if (!Pe) return "";
      const a = new URLSearchParams({ size: "320x320", data: Pe });
      return "https://api.qrserver.com/v1/create-qr-code/?".concat(
        a.toString(),
      );
    }, [Pe]),
    qn = o.useCallback(async () => {
      if (Pe)
        try {
          (await navigator.clipboard.writeText(Pe),
            showToast("success", "Link copiado para a área de transferência."));
        } catch (a) {
          (console.error("copy public link failed", a),
            showToast("error", "Não foi possível copiar o link agora."));
        }
    }, [Pe]);
  o.useEffect(() => {
    Fa(!1);
  }, [Pe]);
  const Hn = o.useCallback(async () => {
      var a;
      if (!(!r || !(n != null && n.id)))
        try {
          const t = await I.updateEstablishmentPlan(n.id, {
              plan: "pro",
              status: "trialing",
              trialDays: 7,
            }),
            s = t == null ? void 0 : t.plan;
          if (s) {
            ve((i) => {
              var c, l, f, j;
              return {
                ...i,
                plan: s.plan || "starter",
                status: s.status || "trialing",
                trialEnd: ((c = s.trial) == null ? void 0 : c.ends_at) || null,
                trialDaysLeft:
                  typeof ((l = s.trial) == null ? void 0 : l.days_left) ==
                  "number"
                    ? s.trial.days_left
                    : i.trialDaysLeft,
                trialWarn: !!((f = s.trial) != null && f.warn),
                allowAdvanced: !!(
                  (j = s.limits) != null && j.allowAdvancedReports
                ),
                activeUntil: s.active_until || null,
              };
            });
            try {
              (localStorage.setItem("plan_current", s.plan || "starter"),
                localStorage.setItem("plan_status", s.status || "trialing"),
                (a = s.trial) != null && a.ends_at
                  ? localStorage.setItem("trial_end", s.trial.ends_at)
                  : localStorage.removeItem("trial_end"));
            } catch (i) {}
          }
          (await oe(),
            alert("Teste gratuito do plano Pro ativado por 7 dias!"));
        } catch (t) {
          (console.error("startTrial failed", t),
            alert("Não foi possível iniciar o teste gratuito agora."));
        }
    }, [r, n == null ? void 0 : n.id, oe]),
    fe = (a, t) => {
      (da((s) => ({ ...s, [a]: t })), H());
    },
    De = o.useCallback(
      (a, t) => {
        (Wa((s) => ({ ...s, [a]: t })), H());
      },
      [H],
    ),
    Bn = o.useCallback(
      (a, t) => {
        (me((s) =>
          s.map((i) =>
            i.key === a
              ? { ...i, enabled: t, blockEnabled: t ? i.blockEnabled : !1 }
              : i,
          ),
        ),
          H());
      },
      [H],
    ),
    Rt = o.useCallback(
      (a, t, s) => {
        const i = _e(s);
        (me((c) => c.map((l) => (l.key === a ? { ...l, [t]: i } : l))), H());
      },
      [H],
    ),
    Fn = o.useCallback(
      (a, t) => {
        (me((s) => s.map((i) => (i.key === a ? { ...i, blockEnabled: t } : i))),
          H());
      },
      [H],
    ),
    Tt = o.useCallback(
      (a, t, s) => {
        const i = _e(s);
        (me((c) => c.map((l) => (l.key === a ? { ...l, [t]: i } : l))), H());
      },
      [H],
    ),
    Mt = o.useCallback(
      (a) => {
        (me((t) => {
          if (a === "business_week") {
            const s = new Set(rl);
            return t.map((i) =>
              s.has(i.key)
                ? {
                    ...i,
                    enabled: !0,
                    start: "09:00",
                    end: "18:00",
                    blockEnabled: !1,
                    blockStart: "",
                    blockEnd: "",
                  }
                : {
                    ...i,
                    enabled: !1,
                    blockEnabled: !1,
                    blockStart: "",
                    blockEnd: "",
                  },
            );
          }
          return a === "every_day"
            ? t.map((s) => ({
                ...s,
                enabled: !0,
                start: "09:00",
                end: "18:00",
                blockEnabled: !1,
                blockStart: "",
                blockEnd: "",
              }))
            : t;
        }),
          H());
      },
      [H],
    ),
    Wn = o.useCallback(() => {
      (me((a) =>
        a.map((t) =>
          t.key === "sunday"
            ? {
                ...t,
                enabled: !1,
                blockEnabled: !1,
                blockStart: "",
                blockEnd: "",
              }
            : t,
        ),
      ),
        H());
    }, [H]),
    $n = o.useCallback(() => {
      (me((a) =>
        a.map((t) =>
          t.blockEnabled || t.blockStart || t.blockEnd
            ? { ...t, blockEnabled: !1, blockStart: "", blockEnd: "" }
            : t,
        ),
      ),
        H());
    }, [H]),
    Un = o.useCallback((a) => {
      const t = Object.prototype.hasOwnProperty.call(Ba, a) ? a : Xo;
      (Zo(t), en((s) => s.filter((i) => i !== t)));
    }, []),
    zn = o.useCallback(
      (a, t) => {
        Object.prototype.hasOwnProperty.call(Ba, a) &&
          a !== Je &&
          en((s) => {
            const i = s.filter((l) => l !== Je);
            return (
              t ? (i.includes(a) ? i : [...i, a]) : i.filter((l) => l !== a)
            ).sort((l, f) => {
              var j, d;
              return (
                ((j = Ba[l]) != null ? j : 99) - ((d = Ba[f]) != null ? d : 99)
              );
            });
          });
      },
      [Je],
    ),
    On = o.useCallback(() => {
      ya.length &&
        (me((a) => {
          const t = a.find((i) => i.key === Je);
          if (!t) return a;
          const s = new Set(ya);
          return a.map((i) => {
            if (!s.has(i.key)) return i;
            const c = t.enabled && t.blockEnabled;
            return {
              ...i,
              enabled: t.enabled,
              start: t.start,
              end: t.end,
              blockEnabled: c,
              blockStart: c ? t.blockStart : "",
              blockEnd: c ? t.blockEnd : "",
            };
          });
        }),
        H());
    }, [H, Je, ya]),
    yi = o.useCallback((a) => {
      var l;
      const t = (a == null ? void 0 : a.target) || null,
        s = (l = t == null ? void 0 : t.files) == null ? void 0 : l[0];
      if (!s) return;
      Ie("");
      const i = (s.type || "").toLowerCase();
      if (!/^image\/(png|jpe?g|webp)$/.test(i)) {
        (Ie("Selecione uma imagem PNG, JPG ou WEBP."), t && (t.value = ""));
        return;
      }
      if (s.size > 2 * 1024 * 1024) {
        (Ie("A imagem deve ter no máximo 2MB."), t && (t.value = ""));
        return;
      }
      const c = new FileReader();
      ((c.onload = () => {
        const f = c.result;
        typeof f == "string"
          ? (za(f), Ls(f), Es(!1), da((j) => ({ ...j, avatar_url: "" })), H())
          : Ie("Falha ao processar a imagem.");
      }),
        (c.onerror = () => {
          Ie("Falha ao processar a imagem.");
        }),
        (c.onloadend = () => {
          t && (t.value = "");
        }),
        c.readAsDataURL(s));
    }, []),
    vi = o.useCallback(() => {
      Ie("");
      const a = Oa.current;
      (a && a.click(), H());
    }, [H]),
    ji = o.useCallback(() => {
      (za(""), Ls(""), Es(!0), Ie(""), da((t) => ({ ...t, avatar_url: "" })));
      const a = Oa.current;
      (a && (a.value = ""), H());
    }, [H]),
    Dt = (a, t) => {
      (ws((s) => ({ ...s, [a]: t })), H());
    },
    Gn = o.useCallback(() => {
      (ws({ atual: "", nova: "", confirmar: "" }), sn(!1));
    }, []),
    qt = o.useCallback(() => {
      (Cs(!1), $a(""), Ua(""));
    }, []),
    Ni = (a) => {
      a.preventDefault();
      const t = tn.trim();
      if (!t) {
        Ua("Informe sua senha para continuar.");
        return;
      }
      (Ua(""), ws((s) => ({ ...s, atual: t })), qt(), Bt(null, t));
    },
    Ht = o.useCallback(() => {
      (rn(!0), bt(""), ja(""), Is(!1));
    }, []),
    cs = o.useCallback(() => {
      (rn(!1), bt(""), ja(""), Is(!1));
    }, []),
    Xn = o.useCallback(() => {
      B != null && B.pending && Ht();
    }, [B == null ? void 0 : B.pending, Ht]),
    Bt = async (a, t) => {
      var l, f, j;
      ((l = a == null ? void 0 : a.preventDefault) == null || l.call(a),
        va({ type: "", message: "" }));
      const s = ((t != null ? t : Ze.atual) || "").trim();
      if (!s) {
        (Ua(""), $a(""), Cs(!0));
        return;
      }
      if (Ze.nova && Ze.nova !== Ze.confirmar) {
        va({
          type: "error",
          message: "A nova senha e a confirmação não coincidem.",
        });
        return;
      }
      const i = $o(T.telefone),
        c = T.cep.replace(/\D/g, "");
      try {
        on(!0);
        const d = {
          nome: T.nome.trim(),
          email: T.email.trim(),
          telefone: i,
          data_nascimento: T.data_nascimento || void 0,
          senhaAtual: s,
          senhaNova: Ze.nova || void 0,
          cep: c || void 0,
          endereco: T.endereco.trim() || void 0,
          numero: T.numero.trim() || void 0,
          complemento: T.complemento.trim() || void 0,
          bairro: T.bairro.trim() || void 0,
          cidade: T.cidade.trim() || void 0,
          estado: T.estado.trim().toUpperCase() || void 0,
        };
        (r &&
          ((d.notifyEmailEstab = !!T.notifyEmailEstab),
          (d.notifyWhatsappEstab = !!T.notifyWhatsappEstab)),
          pt ? (d.avatar = pt) : si && !pt && (d.avatarRemove = !0));
        const N = await I.updateProfile(d);
        if (N != null && N.user) {
          const _ = N.user;
          (Kt(_),
            da((y) => {
              var k, se;
              return {
                ...y,
                avatar_url: _.avatar_url || "",
                notifyEmailEstab: !!((k = _.notify_email_estab) != null
                  ? k
                  : y.notifyEmailEstab),
                notifyWhatsappEstab: !!((se = _.notify_whatsapp_estab) != null
                  ? se
                  : y.notifyWhatsappEstab),
              };
            }),
            za(ys(_.avatar_url || "")),
            Ls(""),
            Es(!1),
            Ie(""));
        }
        (Oa.current && (Oa.current.value = ""), Gn(), $a(""), Cs(!1));
        const b = N == null ? void 0 : N.emailConfirmation;
        (b != null && b.pending
          ? (gt(b),
            Ht(),
            va({
              type: "success",
              message:
                "Perfil atualizado. Confirme o novo email com o codigo enviado.",
            }))
          : (gt(null),
            cs(),
            va({ type: "success", message: "Perfil atualizado com sucesso." })),
          $e(!1));
      } catch (d) {
        const N =
            ((f = d == null ? void 0 : d.data) == null ? void 0 : f.error) ||
            "",
          b =
            ((j = d == null ? void 0 : d.data) == null ? void 0 : j.message) ||
            (d == null ? void 0 : d.message) ||
            "Falha ao atualizar perfil.";
        va({ type: "error", message: b });
        const _ = typeof b == "string" ? b.toLowerCase() : "";
        (([
          "senha_incorreta",
          "senha_atual_obrigatoria",
          "senha_indefinida",
        ].includes(String(N)) ||
          _.includes("senha atual") ||
          _.includes("senha incorreta")) &&
          (Dt("atual", ""), $a(""), Ua(b), Cs(!0)),
          typeof b == "string" && b.toLowerCase().includes("imagem") && Ie(b));
      } finally {
        on(!1);
      }
    },
    ki = o.useCallback(
      async (a) => {
        var s;
        if ((a.preventDefault(), !(B != null && B.pending))) return;
        const t = String(ft || "").trim();
        if (!t) {
          ja("Informe o código de confirmação.");
          return;
        }
        try {
          (Is(!0), ja(""));
          const i = await I.confirmEmailChange({ code: t });
          if (!(i != null && i.user))
            throw new Error("Não foi possível confirmar o novo email.");
          const c = i.user;
          (Kt(c),
            da((l) => {
              var f, j;
              return {
                ...l,
                email: c.email || l.email,
                avatar_url: c.avatar_url || l.avatar_url,
                notifyEmailEstab: !!((f = c.notify_email_estab) != null
                  ? f
                  : l.notifyEmailEstab),
                notifyWhatsappEstab: !!((j = c.notify_whatsapp_estab) != null
                  ? j
                  : l.notifyWhatsappEstab),
              };
            }),
            za(ys(c.avatar_url || "")),
            gt(null),
            cs(),
            va({
              type: "success",
              message: "Novo email confirmado com sucesso.",
            }),
            $e(!1));
        } catch (i) {
          const c =
            ((s = i == null ? void 0 : i.data) == null ? void 0 : s.message) ||
            (i == null ? void 0 : i.message) ||
            "Não foi possível confirmar o novo email.";
          ja(c);
        } finally {
          Is(!1);
        }
      },
      [cs, ft, B == null ? void 0 : B.pending],
    ),
    Vn = o.useCallback(
      async (a) => {
        var s, i, c, l, f, j, d, N;
        if ((a == null || a.preventDefault(), !r)) return;
        Ue({ type: "", message: "" });
        const t = gl(ne);
        if (t) {
          Ue({ type: "error", message: t });
          return;
        }
        ze(!0);
        try {
          const b = M.contato_telefone ? $o(M.contato_telefone) : "",
            _ = {
              sobre: ((s = M.sobre) == null ? void 0 : s.trim()) || null,
              contato_telefone: b || null,
              site_url: ((i = M.site_url) == null ? void 0 : i.trim()) || null,
              instagram_url:
                ((c = M.instagram_url) == null ? void 0 : c.trim()) || null,
              facebook_url:
                ((l = M.facebook_url) == null ? void 0 : l.trim()) || null,
              linkedin_url:
                ((f = M.linkedin_url) == null ? void 0 : f.trim()) || null,
              youtube_url:
                ((j = M.youtube_url) == null ? void 0 : j.trim()) || null,
              tiktok_url:
                ((d = M.tiktok_url) == null ? void 0 : d.trim()) || null,
              accent_color: normalizeHexColor(M.accent_color) || null,
              accent_strong_color:
                normalizeHexColor(M.accent_strong_color) || null,
              horarios: fl(ne, M.horarios_text),
            },
            y = await I.updateEstablishmentProfile(n.id, _);
          (y != null && y.profile && ks(y.profile),
            Ue({
              type: "success",
              message: "Perfil público atualizado com sucesso.",
            }),
            $e(!1));
        } catch (b) {
          const _ =
            ((N = b == null ? void 0 : b.data) == null ? void 0 : N.message) ||
            (b == null ? void 0 : b.message) ||
            "Falha ao atualizar perfil público.";
          Ue({ type: "error", message: _ });
        } finally {
          ze(!1);
        }
      },
      [ks, r, M, n == null ? void 0 : n.id, ne],
    ),
    Kn = o.useCallback(
      (a) =>
        String(a || "")
          .replace(/\D/g, "")
          .slice(0, 3),
      [],
    ),
    Yn = o.useCallback(async () => {
      var s, i;
      if (!r) return;
      ce({ type: "", message: "" });
      const a = !!L;
      let t = null;
      if (a) {
        const c = Number(String(Z || "").trim());
        if (!Number.isFinite(c)) {
          ce({ type: "error", message: "Informe o percentual do sinal." });
          return;
        }
        if (c < 5 || c > 90) {
          ce({ type: "error", message: "Percentual deve estar entre 5 e 90." });
          return;
        }
        t = Math.round(c);
      }
      je(!0);
      try {
        const c = await I.updateEstablishmentDepositSettings({
            enabled: a,
            percent: t,
          }),
          l = (c == null ? void 0 : c.deposit) || {};
        (ie(!!l.enabled),
          te(l.percent != null ? String(l.percent) : ""),
          Ke(Number(l.hold_minutes) || Zt),
          typeof ((s = c == null ? void 0 : c.features) == null
            ? void 0
            : s.deposit) == "boolean" && Fe(c.features.deposit),
          ce({
            type: "success",
            message: "Configuração atualizada com sucesso.",
          }));
      } catch (c) {
        const l =
          ((i = c == null ? void 0 : c.data) == null ? void 0 : i.message) ||
          (c == null ? void 0 : c.message) ||
          "Não foi possível salvar o sinal.";
        ce({ type: "error", message: l });
      } finally {
        je(!1);
      }
    }, [r, L, Z, ie, te, Ke]),
    wi = o.useMemo(() => {
      var us, ds, ms, ps, $t, vo, jo, No, ko, wo, Co, So, Po;
      const a = [],
        t =
          B != null && B.expiresAt
            ? new Date(B.expiresAt).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              })
            : null,
        s = ae.account || null,
        i =
          (s == null ? void 0 : s.connected) === !0 ||
          (s == null ? void 0 : s.status) === "connected",
        c = (s == null ? void 0 : s.token_last4) || "",
        l = {
          trialing: "Teste gratuito",
          active: "Ativo",
          delinquent: "Pagamento em atraso",
          pending: "Pagamento pendente",
          canceled: "Cancelado",
          expired: "Expirado",
        },
        f = String(
          ((us = x.subscription) == null ? void 0 : us.status) || "",
        ).toLowerCase(),
        d = pa
          ? "delinquent"
          : f === "active" || f === "authorized"
            ? "active"
            : rs
              ? "expired"
              : h.status || "",
        N = l[d] || (d ? d.toUpperCase() : ""),
        b =
          d === "trialing" && oa != null
            ? oa === 0
              ? "encerra hoje"
              : oa === 1
                ? "1 dia restante"
                : "".concat(oa, " dias restantes")
            : "",
        _ = b ? "".concat(N, " · ").concat(b) : N,
        y =
          (ds = x.subscription) != null && ds.status
            ? l[x.subscription.status] || x.subscription.status.toUpperCase()
            : null,
        k =
          (ms = x.subscription) != null && ms.current_period_end
            ? ga(x.subscription.current_period_end)
            : null,
        se =
          typeof ((ps = x.subscription) == null ? void 0 : ps.amount_cents) ==
          "number"
            ? (x.subscription.amount_cents / 100).toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })
            : null,
        he = String(M.contato_telefone || "").replace(/\D/g, ""),
        z = String(M.sobre || "").trim().length >= 20,
        qe = he.length >= 10,
        Ee = ne.some((u) => u.enabled),
        He = [
          { key: "about", label: "Descrição", done: z },
          { key: "phone", label: "Contato", done: qe },
          { key: "hours", label: "Horários", done: Ee },
        ],
        ra = He.reduce((u, W) => u + (W.done ? 1 : 0), 0),
        Ys = Math.round((ra / He.length) * 100);
      const publicAccentValue =
          normalizeHexColor(M.accent_color) ||
          PUBLIC_PROFILE_THEME_DEFAULTS.accent,
        publicAccentStrongValue =
          normalizeHexColor(M.accent_strong_color) ||
          PUBLIC_PROFILE_THEME_DEFAULTS.accentStrong,
        publicThemePreviewStyle = {
          "--public-theme-accent": publicAccentValue,
          "--public-theme-accent-strong": publicAccentStrongValue,
        };
      if (
        (a.push({
          id: "profile",
          title: "Perfil e Segurança",
          content: e.jsxs("form", {
            onSubmit: Bt,
            className: "grid config-profile-form",
            style: { gap: 12 },
            children: [
              e.jsxs("div", {
                className: "config-profile-form__intro",
                children: [
                  e.jsx("span", {
                    className: "config-profile-form__eyebrow",
                    children: "Conta",
                  }),
                  e.jsx("h4", {
                    className: "config-profile-form__title",
                    children: "Atualize seus dados principais e preferências de acesso.",
                  }),
                  e.jsx("p", {
                    className: "muted config-profile-form__subtitle",
                    children:
                      "Mantenha nome, contato, endereço, foto e segurança da conta organizados em um único fluxo.",
                  }),
                ],
              }),
              e.jsxs("div", {
                className: "profile-avatar config-profile-form__hero",
                children: [
                  e.jsx("div", {
                    className: "profile-avatar__preview",
                    "aria-live": "polite",
                    children: Ps
                      ? e.jsx("img", { src: Ps, alt: "Foto do perfil" })
                      : e.jsx("span", { children: "Sem foto" }),
                  }),
                  e.jsxs("div", {
                    className: "profile-avatar__controls",
                    children: [
                      e.jsxs("div", {
                        className: "config-profile-form__hero-copy",
                        children: [
                          e.jsx("strong", {
                            className: "config-profile-form__hero-title",
                            children: "Foto do perfil",
                          }),
                          e.jsx("span", {
                            className: "config-profile-form__hero-text",
                            children:
                              "Use uma imagem clara para identificação rápida no painel.",
                          }),
                        ],
                      }),
                      e.jsx("input", {
                        ref: Oa,
                        type: "file",
                        accept: "image/png,image/jpeg,image/webp",
                        onChange: yi,
                        style: { display: "none" },
                      }),
                      e.jsxs("div", {
                        className: "row",
                        style: { gap: 6, flexWrap: "wrap" },
                        children: [
                          e.jsx("button", {
                            type: "button",
                            className: "btn btn--outline btn--sm",
                            onClick: vi,
                            children: "Selecionar foto",
                          }),
                          Ps &&
                            e.jsx("button", {
                              type: "button",
                              className: "btn btn--ghost btn--sm",
                              onClick: ji,
                              children: "Remover",
                            }),
                        ],
                      }),
                      ht
                        ? e.jsx("span", {
                            className: "profile-avatar__error",
                            children: ht,
                          })
                        : e.jsx("span", {
                            className: "profile-avatar__hint",
                            children: "PNG, JPG ou WEBP ate 2MB.",
                      }),
                    ],
                  }),
                ],
              }),
              e.jsxs("div", {
                className: "config-profile-form__section",
                children: [
                  e.jsxs("div", {
                    className: "config-profile-form__section-head",
                    children: [
                      e.jsx("h5", {
                        className: "config-profile-form__section-title",
                        children: "Informações básicas",
                      }),
                      e.jsx("p", {
                        className: "muted",
                        children:
                          "Esses dados são usados para identificação, contato e confirmações da conta.",
                      }),
                    ],
                  }),
                  e.jsxs("div", {
                    className: "config-profile-form__grid config-profile-form__grid--basic",
                    children: [
                      e.jsxs("label", {
                        className: "label config-profile-form__field",
                        children: [
                          e.jsx("span", { children: "Nome" }),
                          e.jsx("input", {
                            className: "input",
                            value: T.nome,
                            onChange: (u) => fe("nome", u.target.value),
                            required: !0,
                          }),
                        ],
                      }),
                      e.jsxs("label", {
                        className: "label config-profile-form__field",
                        children: [
                          e.jsx("span", { children: "Email" }),
                          e.jsx("input", {
                            className: "input",
                            type: "email",
                            value: T.email,
                            onChange: (u) => fe("email", u.target.value),
                            required: !0,
                          }),
                        ],
                      }),
                      e.jsxs("label", {
                        className: "label config-profile-form__field",
                        children: [
                          e.jsx("span", { children: "Telefone (WhatsApp)" }),
                          e.jsx("input", {
                            className: "input",
                            value: st(T.telefone),
                            onChange: (u) => fe("telefone", u.target.value),
                            inputMode: "tel",
                            required: !0,
                          }),
                        ],
                      }),
                    ],
                  }),
                  (B == null ? void 0 : B.pending) &&
                    e.jsxs("div", {
                      className: "notice notice--info config-profile-form__pending",
                      role: "status",
                      children: [
                        e.jsxs("span", {
                          children: [
                            "Enviamos um código para ",
                            e.jsx("strong", { children: B.newEmail }),
                            ".",
                            t
                              ? " Expira em ".concat(t, ".")
                              : " O código vale 30 minutos.",
                          ],
                        }),
                        e.jsx("button", {
                          type: "button",
                          className: "btn btn--ghost btn--sm",
                          onClick: Xn,
                          children: "Informar código agora",
                        }),
                      ],
                    }),
                ],
              }),
              r &&
                e.jsxs("div", {
                  className: "config-profile-form__section",
                  children: [
                    e.jsxs("div", {
                      className: "config-profile-form__section-head",
                      children: [
                        e.jsx("h5", {
                          className: "config-profile-form__section-title",
                          children: "Endereço e notificações",
                        }),
                        e.jsx("p", {
                          className: "muted",
                          children:
                            "Use um endereço completo para a operação do estabelecimento e escolha como deseja receber alertas.",
                        }),
                      ],
                    }),
                    e.jsxs("div", {
                      className: "row config-profile-form__row",
                      style: { gap: 8, flexWrap: "wrap" },
                      children: [
                        e.jsxs("label", {
                          className: "label config-profile-form__field",
                          style: { flex: "1 1 160px" },
                          children: [
                            e.jsx("span", { children: "CEP" }),
                            e.jsx("input", {
                              className: "input",
                              value: T.cep,
                              onChange: (u) => fe("cep", Qt(u.target.value)),
                              required: !0,
                              inputMode: "numeric",
                            }),
                          ],
                        }),
                        e.jsxs("label", {
                          className: "label config-profile-form__field",
                          style: { flex: "1 1 240px" },
                          children: [
                            e.jsx("span", { children: "Endereco" }),
                            e.jsx("input", {
                              className: "input",
                              value: T.endereco,
                              onChange: (u) => fe("endereco", u.target.value),
                              required: !0,
                            }),
                          ],
                        }),
                      ],
                    }),
                    e.jsxs("div", {
                      className: "row config-profile-form__row",
                      style: { gap: 8, flexWrap: "wrap" },
                      children: [
                        e.jsxs("label", {
                          className: "label config-profile-form__field",
                          style: { flex: "0 1 120px" },
                          children: [
                            e.jsx("span", { children: "Número" }),
                            e.jsx("input", {
                              className: "input",
                              value: T.numero,
                              onChange: (u) => fe("numero", u.target.value),
                              required: !0,
                            }),
                          ],
                        }),
                        e.jsxs("label", {
                          className: "label config-profile-form__field",
                          style: { flex: "1 1 200px" },
                          children: [
                            e.jsx("span", { children: "Complemento" }),
                            e.jsx("input", {
                              className: "input",
                              value: T.complemento,
                              onChange: (u) =>
                                fe("complemento", u.target.value),
                            }),
                          ],
                        }),
                      ],
                    }),
                    e.jsxs("div", {
                      className: "row config-profile-form__row",
                      style: { gap: 8, flexWrap: "wrap" },
                      children: [
                        e.jsxs("label", {
                          className: "label config-profile-form__field",
                          style: { flex: "1 1 200px" },
                          children: [
                            e.jsx("span", { children: "Bairro" }),
                            e.jsx("input", {
                              className: "input",
                              value: T.bairro,
                              onChange: (u) => fe("bairro", u.target.value),
                              required: !0,
                            }),
                          ],
                        }),
                        e.jsxs("label", {
                          className: "label config-profile-form__field",
                          style: { flex: "1 1 200px" },
                          children: [
                            e.jsx("span", { children: "Cidade" }),
                            e.jsx("input", {
                              className: "input",
                              value: T.cidade,
                              onChange: (u) => fe("cidade", u.target.value),
                              required: !0,
                            }),
                          ],
                        }),
                        e.jsxs("label", {
                          className: "label config-profile-form__field",
                          style: { width: 80 },
                          children: [
                            e.jsx("span", { children: "Estado" }),
                            e.jsx("input", {
                              className: "input",
                              value: T.estado,
                              onChange: (u) =>
                                fe(
                                  "estado",
                                  u.target.value.toUpperCase().slice(0, 2),
                                ),
                              required: !0,
                            }),
                          ],
                        }),
                      ],
                    }),
                    e.jsxs("div", {
                      className: "config-profile-form__preferences",
                      children: [
                        e.jsxs("label", {
                          className:
                            "switch config-profile-form__switch-card",
                          children: [
                            e.jsx("input", {
                              type: "checkbox",
                              checked: !!T.notifyEmailEstab,
                              onChange: (u) =>
                                fe("notifyEmailEstab", u.target.checked),
                            }),
                            e.jsx("span", {
                              children: "Receber notificações por email",
                            }),
                          ],
                        }),
                        e.jsxs("label", {
                          className:
                            "switch config-profile-form__switch-card",
                          children: [
                            e.jsx("input", {
                              type: "checkbox",
                              checked: !!T.notifyWhatsappEstab,
                              onChange: (u) =>
                                fe("notifyWhatsappEstab", u.target.checked),
                            }),
                            e.jsx("span", {
                              children: "Receber notificações no WhatsApp",
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
              e.jsxs("div", {
                className: "config-profile-form__section",
                children: [
                  e.jsxs("div", {
                    className: "config-profile-form__section-head",
                    children: [
                      e.jsx("h5", {
                        className: "config-profile-form__section-title",
                        children: "Segurança da conta",
                      }),
                      e.jsx("p", {
                        className: "muted",
                        children:
                          "Atualize a senha quando necessário. A confirmação da senha atual continua obrigatória no salvamento.",
                      }),
                    ],
                  }),
                  e.jsx("div", {
                    className:
                      "row config-profile-form__security-actions",
                    style: {
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    },
                    children: mt
                      ? e.jsx("button", {
                          type: "button",
                          className: "btn btn--ghost btn--sm",
                          onClick: Gn,
                          children: "Cancelar alteração",
                        })
                      : e.jsx("button", {
                          type: "button",
                          className: "btn btn--outline btn--sm",
                          onClick: () => {
                            (sn(!0), ws({ atual: "", nova: "", confirmar: "" }));
                          },
                          children: "Alterar senha",
                        }),
                  }),
                  mt &&
                    e.jsxs("div", {
                      className: "row config-profile-form__row",
                      style: { gap: 8, flexWrap: "wrap" },
                      children: [
                        e.jsxs("label", {
                          className: "label config-profile-form__field",
                          style: { flex: "1 1 260px" },
                          children: [
                            e.jsx("span", { children: "Nova senha" }),
                            e.jsx("input", {
                              className: "input",
                              type: "password",
                              value: Ze.nova,
                              onChange: (u) => Dt("nova", u.target.value),
                            }),
                          ],
                        }),
                        e.jsxs("label", {
                          className: "label config-profile-form__field",
                          style: { flex: "1 1 260px" },
                          children: [
                            e.jsx("span", { children: "Confirmar nova senha" }),
                            e.jsx("input", {
                              className: "input",
                              type: "password",
                              value: Ze.confirmar,
                              onChange: (u) => Dt("confirmar", u.target.value),
                            }),
                          ],
                        }),
                      ],
                    }),
                  mt &&
                    e.jsx("p", {
                      className: "small muted config-profile-form__security-hint",
                      style: { margin: "-4px 0 0" },
                      children:
                        "Vamos pedir sua senha atual ao salvar as alteracoes.",
                    }),
                ],
              }),
              Ss.message &&
                e.jsx("div", {
                  className:
                    "notice notice--".concat(
                      Ss.type,
                      " config-profile-form__feedback",
                    ),
                  role: "alert",
                  children: Ss.message,
                }),
              e.jsx("div", {
                className: "row config-profile-form__actions",
                style: { justifyContent: "flex-end", gap: 8 },
                children: e.jsx("button", {
                  type: "submit",
                  className: "btn btn--primary",
                  disabled: ma,
                  children: ma
                    ? e.jsx("span", { className: "spinner" })
                    : "Salvar alterações",
                }),
              }),
            ],
          }),
        }),
        r)
      ) {
        const u = pe.account,
          W = (u == null ? void 0 : u.status) === "connected",
          Y = (u == null ? void 0 : u.display_phone_number) || "",
          Ut = Y ? st(String(Y)) : "",
          X = (x == null ? void 0 : x.whatsappWallet) || null,
          hs =
            X && typeof X.included_limit == "number"
              ? "".concat(X.included_limit, " msgs/mês")
              : "franquia mensal de mensagens",
          gs = "WhatsApp: ".concat(
            hs,
            " (máx. 5 msgs por agendamento). Ao esgotar, seguimos por e-mail e painel.",
          ),
          Qs = h.allowAdvanced ? "Relatórios avançados" : "Relatórios básicos",
          zt = [gs, Qs],
          fa = na,
          Js = jn,
          Ot = St,
          Zs = Se.length,
          fs = "whatsapp-history-panel",
          Gt =
            (X == null ? void 0 : X.month_label) ||
            new Date().toLocaleString("pt-BR", {
              month: "long",
              year: "numeric",
            }),
          la = Number(
            ($t = X == null ? void 0 : X.included_limit) != null ? $t : 0,
          ),
          bs = Number(
            (vo = X == null ? void 0 : X.included_balance) != null ? vo : 0,
          ),
          Ae = la > 0 ? Math.max(la - bs, 0) : 0,
          ca = la > 0 ? Math.min(100, (Ae / la) * 100) : 0,
          Ta = "Usadas "
            .concat(Ae.toLocaleString("pt-BR"), " de ")
            .concat(la.toLocaleString("pt-BR")),
          xs = "".concat(Math.round(ca), "%"),
          Xt = Number(
            (jo = X == null ? void 0 : X.extra_balance) != null ? jo : 0,
          ),
          $ = Number((X == null ? void 0 : X.total_balance) || 0),
          Vt = $ > 0 ? $ / 5 : 0,
          et = h.activeUntil
            ? "Assinatura ativa até " + ga(h.activeUntil)
            : la > 0
              ? "Incluído no plano"
              : "",
          ba = (p) =>
            typeof (p == null ? void 0 : p.price_cents) == "number"
              ? p.price_cents
              : typeof (p == null ? void 0 : p.priceCents) == "number"
                ? p.priceCents
                : typeof (p == null ? void 0 : p.price) == "number"
                  ? p.price
                  : null;
        let _s = null,
          Lo = Number.POSITIVE_INFINITY;
        if (
          (fa.forEach((p) => {
            var Ma, Da;
            const xe = ba(p),
              Xe = Number((p == null ? void 0 : p.messages) || 0);
            if (!xe || !Xe) return;
            const xa = Number(xe) / 100 / Xe;
            xa < Lo &&
              ((Lo = xa),
              (_s =
                (Da = (Ma = p.id) != null ? Ma : p.code) != null
                  ? Da
                  : p.messages));
          }),
          _s == null && fa.length)
        ) {
          const p = fa.reduce((xe, Xe) => {
            const xa = Number((xe == null ? void 0 : xe.messages) || 0);
            return Number((Xe == null ? void 0 : Xe.messages) || 0) > xa
              ? Xe
              : xe;
          });
          _s =
            (wo =
              (ko =
                (No = p == null ? void 0 : p.id) != null
                  ? No
                  : p == null
                    ? void 0
                    : p.code) != null
                ? ko
                : p == null
                  ? void 0
                  : p.messages) != null
              ? wo
              : null;
        }
        const Eo = (p) =>
          e.jsxs(
            "li",
            {
              className: m.historyItem,
              children: [
                e.jsxs("div", {
                  className: m.historyMain,
                  children: [
                    e.jsxs("span", {
                      className: m.historyAmount,
                      children: ["+", p.messagesLabel, " msgs"],
                    }),
                    p.priceLabel
                      ? e.jsx("span", {
                          className: m.historyPrice,
                          children: p.priceLabel,
                        })
                      : null,
                  ],
                }),
                e.jsxs("div", {
                  className: m.historyMeta,
                  children: [
                    e.jsx("span", {
                      className: m.historyDate,
                      children: p.createdLabel || "Data indisponível",
                    }),
                    p.statusLabel
                      ? e.jsx("span", {
                          className: ""
                            .concat(m.statusChip, " ")
                            .concat(
                              p.statusTone === "success"
                                ? m.statusSuccess
                                : p.statusTone === "pending"
                                  ? m.statusPending
                                  : p.statusTone === "error"
                                    ? m.statusError
                                    : p.statusTone === "neutral"
                                      ? m.statusNeutral
                                      : "",
                            ),
                          children: p.statusLabel,
                        })
                      : null,
                  ],
                }),
              ],
            },
            p.key,
          );
        a.push({
          id: "whatsapp-connect",
          title: "WhatsApp Business",
          content: e.jsxs("div", {
            className: "grid",
            style: { gap: 12 },
            children: [
              e.jsxs("section", {
                className: "box",
                style: { display: "grid", gap: 10 },
                children: [
                  e.jsxs("div", {
                    children: [
                      e.jsx("h4", {
                        style: { margin: 0 },
                        children: "Conexão",
                      }),
                      e.jsx("p", {
                        className: "muted",
                        style: { margin: "4px 0 0" },
                        children:
                          "Conecte o número do estabelecimento para enviar mensagens com o seu próprio WhatsApp Business.",
                      }),
                    ],
                  }),
                  pe.loading &&
                    e.jsxs("div", {
                      className: "row",
                      style: { gap: 8, alignItems: "center" },
                      children: [
                        e.jsx("span", {
                          className: "spinner",
                          "aria-hidden": !0,
                        }),
                        e.jsx("span", {
                          className: "muted",
                          style: { fontSize: 13 },
                          children: "Carregando status do WhatsApp...",
                        }),
                      ],
                    }),
                  !pe.loading &&
                    W &&
                    e.jsxs("div", {
                      className: "notice notice--success",
                      children: [
                        "Conectado ao numero ",
                        Ut || Y || "indisponivel",
                        ".",
                      ],
                    }),
                  !pe.loading &&
                    !W &&
                    e.jsx("div", {
                      className: "notice notice--warn",
                      children:
                        "WhatsApp não conectado. Conecte seu número para ativar os envios.",
                    }),
                  (u == null ? void 0 : u.phone_number_id) &&
                    e.jsxs("span", {
                      className: "muted",
                      style: { fontSize: 12 },
                      children: ["phone_number_id: ", u.phone_number_id],
                    }),
                  pe.error &&
                    e.jsx("div", {
                      className: "notice notice--error",
                      role: "alert",
                      children: pe.error,
                    }),
                  pe.notice &&
                    e.jsx("div", {
                      className: "notice notice--success",
                      role: "status",
                      children: pe.notice,
                    }),
                  e.jsxs("div", {
                    className: "row",
                    style: { gap: 8, flexWrap: "wrap" },
                    children: [
                      e.jsx("button", {
                        type: "button",
                        className: "btn btn--primary",
                        onClick: Pn,
                        disabled: pe.connectLoading,
                        children: pe.connectLoading
                          ? e.jsx("span", { className: "spinner" })
                          : "Em desenvolvimento... Conectar WhatsApp",
                      }),
                      W &&
                        e.jsx("button", {
                          type: "button",
                          className: "btn btn--outline",
                          onClick: Ln,
                          disabled: pe.disconnectLoading,
                          children: pe.disconnectLoading
                            ? e.jsx("span", { className: "spinner" })
                            : "Desconectar",
                        }),
                    ],
                  }),
                ],
              }),
              e.jsxs("section", {
                className: "box config-page__wallet-box",
                style: { display: "grid", gap: 12 },
                children: [
                  e.jsxs("div", {
                    className: "config-page__wallet-box-head",
                    children: [
                      e.jsx("h4", {
                        style: { margin: 0 },
                        children: "Mensagens / Créditos",
                      }),
                      e.jsx("p", {
                        className: "muted",
                        style: { margin: "4px 0 0" },
                        children:
                          "Acompanhe o limite mensal e recarregue pacotes extras via PIX quando necessário.",
                      }),
                    ],
                  }),
                  e.jsxs("div", {
                    className: m.whatsLayout,
                    children: [
                      e.jsx("div", {
                        className: m.mainCol,
                        children: e.jsx("div", {
                          className: m.walletPanel,
                          children: e.jsxs("div", {
                            className: m.panelMain,
                            children: [
                              e.jsxs("div", {
                                className: m.panelHeader,
                                children: [
                                  e.jsxs("div", {
                                    className: m.titleGroup,
                                    children: [
                                      e.jsx("h4", {
                                        className: m.title,
                                        children: "WhatsApp (mensagens)",
                                      }),
                                      et
                                        ? e.jsx("span", {
                                            className: m.badge,
                                            children: et,
                                          })
                                        : null,
                                    ],
                                  }),
                                  e.jsx("div", {
                                    className: m.subtitle,
                                    children: Gt,
                                  }),
                                ],
                              }),
                              X
                                ? e.jsxs(e.Fragment, {
                                    children: [
                                      e.jsxs("div", {
                                        className: m.statGrid,
                                        children: [
                                          e.jsxs("div", {
                                            className: m.statCard,
                                            children: [
                                              e.jsxs("div", {
                                                className: m.statHeader,
                                                children: [
                                                  e.jsx("div", {
                                                    className: m.statLabel,
                                                    children:
                                                      "Incluído no plano",
                                                  }),
                                                  bs >= 0
                                                    ? e.jsxs("div", {
                                                        className:
                                                          m.statRemaining,
                                                        children: [
                                                          "Restam ",
                                                          Math.max(
                                                            bs,
                                                            0,
                                                          ).toLocaleString(
                                                            "pt-BR",
                                                          ),
                                                        ],
                                                      })
                                                    : null,
                                                ],
                                              }),
                                              e.jsx("div", {
                                                className: m.progress,
                                                "aria-hidden": "true",
                                                children: e.jsx("div", {
                                                  className: m.progressFill,
                                                  style: {
                                                    width: "".concat(ca, "%"),
                                                  },
                                                  role: "presentation",
                                                }),
                                              }),
                                              e.jsxs("div", {
                                                className: m.progressMeta,
                                                children: [
                                                  e.jsx("span", {
                                                    className: m.progressLabel,
                                                    children: Ta,
                                                  }),
                                                  e.jsx("span", {
                                                    className:
                                                      m.progressPercent,
                                                    children: xs,
                                                  }),
                                                ],
                                              }),
                                            ],
                                          }),
                                          e.jsxs("div", {
                                            className: m.statCard,
                                            children: [
                                              e.jsx("div", {
                                                className: m.statLabel,
                                                children: "Créditos extras",
                                              }),
                                              e.jsx("div", {
                                                className: m.statValue,
                                                children:
                                                  Xt.toLocaleString("pt-BR"),
                                              }),
                                              e.jsx("div", {
                                                className: m.statHint,
                                                children:
                                                  "Créditos comprados via PIX",
                                              }),
                                            ],
                                          }),
                                          e.jsxs("div", {
                                            className: ""
                                              .concat(m.statCard, " ")
                                              .concat(m.statHighlight),
                                            children: [
                                              e.jsx("div", {
                                                className: m.statLabel,
                                                children: "Total disponível",
                                              }),
                                              e.jsx("div", {
                                                className: m.statValue,
                                                children:
                                                  $.toLocaleString("pt-BR"),
                                              }),
                                              e.jsxs("div", {
                                                className: m.statHint,
                                                children: [
                                                  "~ ",
                                                  Vt.toLocaleString("pt-BR", {
                                                    maximumFractionDigits: 1,
                                                  }),
                                                  " agend. (5 msg = 1)",
                                                ],
                                              }),
                                            ],
                                          }),
                                        ],
                                      }),
                                      Number($) < 1 &&
                                        e.jsx("div", {
                                          className:
                                            "notice notice--warn ".concat(
                                              m.inlineNotice,
                                            ),
                                          children:
                                            "WhatsApp pausado; e-mail continua.",
                                        }),
                                    ],
                                  })
                                : e.jsx("p", {
                                    className: "muted",
                                    style: { marginTop: 10 },
                                    children: "Saldo indisponível.",
                                  }),
                              e.jsxs("div", {
                                className: m.section,
                                children: [
                                  e.jsxs("div", {
                                    className: m.sectionHeader,
                                    children: [
                                      e.jsx("span", {
                                        className: m.sectionTitle,
                                        children: "Pacotes extras (PIX)",
                                      }),
                                      e.jsx("span", {
                                        className: m.sectionHint,
                                        children:
                                          "Recarregue mensagens em segundos via PIX",
                                      }),
                                    ],
                                  }),
                                  e.jsx("div", {
                                    className: m.packageList,
                                    children: fa.length
                                      ? fa.map((p) => {
                                          var Ao, Io, Ro, To, Mo, Do, qo, Ho;
                                          const xe = ba(p),
                                            Xe =
                                              xe != null
                                                ? (
                                                    Number(xe) / 100
                                                  ).toLocaleString("pt-BR", {
                                                    style: "currency",
                                                    currency: "BRL",
                                                  })
                                                : null,
                                            xa =
                                              p.old_price_cents != null
                                                ? (
                                                    Number(p.old_price_cents) /
                                                    100
                                                  ).toLocaleString("pt-BR", {
                                                    style: "currency",
                                                    currency: "BRL",
                                                  })
                                                : null,
                                            Ma =
                                              xe && p.messages
                                                ? (
                                                    Number(xe) /
                                                    100 /
                                                    Number(p.messages)
                                                  ).toLocaleString("pt-BR", {
                                                    style: "currency",
                                                    currency: "BRL",
                                                  })
                                                : null,
                                            Da =
                                              _s != null &&
                                              _s ===
                                                ((Io =
                                                  (Ao = p.id) != null
                                                    ? Ao
                                                    : p.code) != null
                                                  ? Io
                                                  : p.messages),
                                            Li =
                                              p.description ||
                                              p.label ||
                                              "Recarga imediata via PIX";
                                          return e.jsxs(
                                            "div",
                                            {
                                              className: ""
                                                .concat(m.packageRow, " ")
                                                .concat(
                                                  Da
                                                    ? m.packageRowHighlight
                                                    : "",
                                                ),
                                              children: [
                                                e.jsxs("div", {
                                                  className: m.packageInfo,
                                                  children: [
                                                    e.jsxs("div", {
                                                      className: m.packageTop,
                                                      children: [
                                                        e.jsxs("div", {
                                                          className:
                                                            m.packageTitle,
                                                          children: [
                                                            e.jsxs("span", {
                                                              className:
                                                                m.packageAmount,
                                                              children: [
                                                                "+",
                                                                p.messages,
                                                                " msgs",
                                                              ],
                                                            }),
                                                            Da
                                                              ? e.jsx("span", {
                                                                  className:
                                                                    m.packageBadge,
                                                                  children:
                                                                    "Melhor custo",
                                                                })
                                                              : null,
                                                          ],
                                                        }),
                                                        e.jsxs("span", {
                                                          className:
                                                            m.packagePrices,
                                                          children: [
                                                            xa
                                                              ? e.jsx("span", {
                                                                  className:
                                                                    m.oldPrice,
                                                                  children: xa,
                                                                })
                                                              : null,
                                                            e.jsx("span", {
                                                              className:
                                                                m.priceLabel,
                                                              children:
                                                                Xe ||
                                                                "Sob consulta",
                                                            }),
                                                          ],
                                                        }),
                                                      ],
                                                    }),
                                                    e.jsxs("div", {
                                                      className: m.packageMeta,
                                                      children: [
                                                        e.jsx("span", {
                                                          className:
                                                            m.packageDescription,
                                                          children: Li,
                                                        }),
                                                        Ma
                                                          ? e.jsxs("span", {
                                                              className:
                                                                m.priceHint,
                                                              children: [
                                                                "~ ",
                                                                Ma,
                                                                "/msg",
                                                              ],
                                                            })
                                                          : null,
                                                      ],
                                                    }),
                                                  ],
                                                }),
                                                e.jsx("div", {
                                                  className: m.packageAction,
                                                  children: e.jsx("button", {
                                                    type: "button",
                                                    className: "btn "
                                                      .concat(
                                                        Da
                                                          ? "btn--primary"
                                                          : "btn--outline",
                                                        " ",
                                                      )
                                                      .concat(m.actionButton),
                                                    onClick: () => An(p),
                                                    disabled:
                                                      jt ===
                                                      String(
                                                        (To =
                                                          (Ro = p.id) != null
                                                            ? Ro
                                                            : p.code) != null
                                                          ? To
                                                          : p.messages,
                                                      ),
                                                    children:
                                                      jt ===
                                                      String(
                                                        (Do =
                                                          (Mo = p.id) != null
                                                            ? Mo
                                                            : p.code) != null
                                                          ? Do
                                                          : p.messages,
                                                      )
                                                        ? e.jsx("span", {
                                                            className:
                                                              "spinner",
                                                          })
                                                        : "Recarregar",
                                                  }),
                                                }),
                                              ],
                                            },
                                            (Ho =
                                              (qo = p.id) != null
                                                ? qo
                                                : p.code) != null
                                              ? Ho
                                              : p.messages,
                                          );
                                        })
                                      : e.jsx("div", {
                                          className: m.emptyRow,
                                          children:
                                            "Nenhum pacote disponível no momento.",
                                        }),
                                  }),
                                  Nt &&
                                    e.jsx("div", {
                                      className: "notice notice--error ".concat(
                                        m.inlineNotice,
                                      ),
                                      role: "alert",
                                      children: Nt,
                                    }),
                                ],
                              }),
                              e.jsxs("div", {
                                className: m.section,
                                children: [
                                  e.jsx("div", {
                                    className: m.sectionHeader,
                                    children: e.jsxs("div", {
                                      className: m.historyHeading,
                                      children: [
                                        e.jsx("span", {
                                          className: m.sectionTitle,
                                          children: "Histórico de recargas",
                                        }),
                                        e.jsx("span", {
                                          className: m.historySubtext,
                                          children: "Mostrando as últimas 5",
                                        }),
                                      ],
                                    }),
                                  }),
                                  Js.length
                                    ? e.jsx("ul", {
                                        className: m.historyList,
                                        children: Js.map((p) => Eo(p)),
                                      })
                                    : e.jsx("p", {
                                        className: "muted",
                                        style: { margin: 0 },
                                        children: "Sem recargas recentes.",
                                      }),
                                  Zs > 0
                                    ? e.jsxs("div", {
                                        className: m.historyActions,
                                        children: [
                                          e.jsx("button", {
                                            type: "button",
                                            className:
                                              "btn btn--sm btn--outline ".concat(
                                                m.historyToggle,
                                              ),
                                            onClick: () => ui((p) => !p),
                                            "aria-expanded": Ja,
                                            "aria-controls": fs,
                                            children: Ja
                                              ? "Ocultar histórico completo"
                                              : "Ver histórico completo",
                                          }),
                                          e.jsxs("div", {
                                            id: fs,
                                            className: m.historyPanel,
                                            children: [
                                              (es || as) &&
                                                e.jsxs("div", {
                                                  className: m.historyFilters,
                                                  children: [
                                                    es
                                                      ? e.jsxs("label", {
                                                          className:
                                                            m.historyFilter,
                                                          children: [
                                                            e.jsx("span", {
                                                              children:
                                                                "Período",
                                                            }),
                                                            e.jsxs("select", {
                                                              value: ta,
                                                              onChange: (p) =>
                                                                di(
                                                                  p.target
                                                                    .value,
                                                                ),
                                                              children: [
                                                                e.jsx(
                                                                  "option",
                                                                  {
                                                                    value:
                                                                      "all",
                                                                    children:
                                                                      "Tudo",
                                                                  },
                                                                ),
                                                                e.jsx(
                                                                  "option",
                                                                  {
                                                                    value: "30",
                                                                    children:
                                                                      "Últimos 30 dias",
                                                                  },
                                                                ),
                                                                e.jsx(
                                                                  "option",
                                                                  {
                                                                    value: "90",
                                                                    children:
                                                                      "Últimos 90 dias",
                                                                  },
                                                                ),
                                                                e.jsx(
                                                                  "option",
                                                                  {
                                                                    value:
                                                                      "year",
                                                                    children:
                                                                      "Este ano",
                                                                  },
                                                                ),
                                                              ],
                                                            }),
                                                          ],
                                                        })
                                                      : null,
                                                    as
                                                      ? e.jsxs("label", {
                                                          className:
                                                            m.historyFilter,
                                                          children: [
                                                            e.jsx("span", {
                                                              children:
                                                                "Status",
                                                            }),
                                                            e.jsxs("select", {
                                                              value: Pa,
                                                              onChange: (p) =>
                                                                mi(
                                                                  p.target
                                                                    .value,
                                                                ),
                                                              children: [
                                                                e.jsx(
                                                                  "option",
                                                                  {
                                                                    value:
                                                                      "all",
                                                                    children:
                                                                      "Todos",
                                                                  },
                                                                ),
                                                                e.jsx(
                                                                  "option",
                                                                  {
                                                                    value:
                                                                      "pending",
                                                                    children:
                                                                      "Pendentes",
                                                                  },
                                                                ),
                                                                e.jsx(
                                                                  "option",
                                                                  {
                                                                    value:
                                                                      "paid",
                                                                    children:
                                                                      "Confirmados",
                                                                  },
                                                                ),
                                                                e.jsx(
                                                                  "option",
                                                                  {
                                                                    value:
                                                                      "failed",
                                                                    children:
                                                                      "Falhos",
                                                                  },
                                                                ),
                                                              ],
                                                            }),
                                                          ],
                                                        })
                                                      : null,
                                                  ],
                                                }),
                                              ss.length
                                                ? e.jsx("ul", {
                                                    className: m.historyList,
                                                    children: Ot.map((p) =>
                                                      Eo(p),
                                                    ),
                                                  })
                                                : e.jsx("p", {
                                                    className: "muted",
                                                    style: { margin: 0 },
                                                    children:
                                                      "Nenhum registro no período.",
                                                  }),
                                              zs &&
                                                e.jsx("button", {
                                                  type: "button",
                                                  className:
                                                    "btn btn--sm btn--outline ".concat(
                                                      m.historyLoadMore,
                                                    ),
                                                  onClick: Nn,
                                                  disabled: Za,
                                                  children: Za
                                                    ? e.jsx("span", {
                                                        className: "spinner",
                                                      })
                                                    : "Carregar mais",
                                                }),
                                            ],
                                          }),
                                        ],
                                      })
                                    : null,
                                ],
                              }),
                            ],
                          }),
                        }),
                      }),
                      e.jsxs("aside", {
                        className: m.asideCol,
                        children: [
                          e.jsxs("div", {
                            className: "plan-card__features ".concat(
                              m.planColLeft,
                            ),
                            children: [
                              e.jsx("span", {
                                className: "plan-card__features-title",
                                children: "Resumo do plano",
                              }),
                              e.jsx("ul", {
                                children: zt.map((p) =>
                                  e.jsx("li", { children: p }, p),
                                ),
                              }),
                            ],
                          }),
                          e.jsxs("div", {
                            className: ""
                              .concat(m.helpCard, " ")
                              .concat(Qa ? m.helpCardOpen : ""),
                            children: [
                              e.jsxs("button", {
                                type: "button",
                                className: m.helpToggle,
                                onClick: () => ci((p) => !p),
                                "aria-expanded": Qa,
                                "aria-controls": "whatsapp-help",
                                children: [
                                  e.jsx("span", {
                                    className: m.helpTitle,
                                    children: "Ajuda rápida",
                                  }),
                                  e.jsx(Wo, {
                                    className: m.helpIcon,
                                    "aria-hidden": "true",
                                  }),
                                ],
                              }),
                              e.jsx("div", {
                                id: "whatsapp-help",
                                className: ""
                                  .concat(m.helpBody, " ")
                                  .concat(Qa ? m.helpBodyOpen : ""),
                                "aria-hidden": !Qa,
                                children: e.jsxs("ul", {
                                  className: m.helpList,
                                  children: [
                                    e.jsx("li", {
                                      children: "5 msgs ~ 1 agendamento",
                                    }),
                                    e.jsx("li", {
                                      children:
                                        "Pagamentos via PIX confirmam em instantes",
                                    }),
                                    e.jsx("li", {
                                      children:
                                        "Saldo extra é usado quando o limite do plano termina",
                                    }),
                                  ],
                                }),
                              }),
                            ],
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        });
      }
      if (
        (r &&
          a.push({
            id: "public-profile",
            title: "Perfil público do estabelecimento",
            content: e.jsxs("form", {
              onSubmit: Vn,
              className: "grid",
              style: { gap: 10 },
              children: [
                C &&
                  e.jsxs("div", {
                    className: "row",
                    style: { gap: 8, alignItems: "center" },
                    children: [
                      e.jsx("span", {
                        className: "spinner",
                        "aria-hidden": !0,
                      }),
                      e.jsx("span", {
                        className: "muted",
                        style: { fontSize: 13 },
                        children: "Carregando informações públicas…",
                      }),
                    ],
                  }),
                !C &&
                  Pe &&
                  e.jsxs("div", {
                    className: "public-link-box",
                    children: [
                      e.jsxs("div", {
                        className: "public-link-box__row",
                        children: [
                          e.jsxs("div", {
                            children: [
                              e.jsx("span", {
                                className: "public-link-box__label",
                                children: "Link da página pública",
                              }),
                              e.jsx("a", {
                                className: "public-link-box__url",
                                href: Pe,
                                target: "_blank",
                                rel: "noreferrer",
                                children: Pe,
                              }),
                            ],
                          }),
                          e.jsxs("div", {
                            className: "public-link-box__actions",
                            children: [
                              e.jsx("button", {
                                type: "button",
                                className: "btn btn--outline btn--sm",
                                onClick: qn,
                                children: "Copiar link",
                              }),
                              e.jsx("button", {
                                type: "button",
                                className: "btn btn--primary btn--sm",
                                onClick: () => Fa((u) => !u),
                                children: _a
                                  ? "Ocultar QR Code"
                                  : "Gerar QR Code",
                              }),
                            ],
                          }),
                        ],
                      }),
                      _a &&
                        ls &&
                        e.jsxs("div", {
                          className: "public-link-box__qr",
                          children: [
                            e.jsx("img", {
                              src: ls,
                              alt: "QR Code do link público do estabelecimento",
                            }),
                            e.jsxs("div", {
                              className: "row",
                              style: { gap: 8, justifyContent: "center" },
                              children: [
                                e.jsx("a", {
                                  className: "btn btn--outline btn--sm",
                                  href: ls,
                                  download: "qr-".concat(
                                    E ||
                                      (n == null ? void 0 : n.id) ||
                                      "estabelecimento",
                                    ".png",
                                  ),
                                  children: "Baixar PNG",
                                }),
                                e.jsx("button", {
                                  type: "button",
                                  className: "btn btn--ghost btn--sm",
                                  onClick: () =>
                                    window.open(ls, "_blank", "noopener"),
                                  children: "Abrir em nova guia",
                                }),
                              ],
                            }),
                            e.jsx("span", {
                              className: "muted",
                              style: { fontSize: 12 },
                              children:
                                "Compartilhe ou imprima o QR Code para clientes acessarem a página de agendamento.",
                            }),
                          ],
                        }),
                    ],
                  }),
                !C &&
                  e.jsxs("section", {
                    className: "public-profile__focus",
                    "aria-label": "Progresso do perfil",
                    children: [
                      e.jsx("div", {
                        className: "public-profile__focus-head",
                        children: e.jsxs("div", {
                          children: [
                            e.jsx("h4", {
                              className: "public-profile__focus-title",
                              children: "Dados essenciais",
                            }),
                            e.jsx("p", {
                              className: "public-profile__focus-subtitle",
                              children:
                                "Perfil completo sempre ativo. Revise os itens abaixo para manter tudo atualizado.",
                            }),
                          ],
                        }),
                      }),
                      e.jsxs("div", {
                        className: "public-profile__progress",
                        children: [
                          e.jsx("div", {
                            className: "public-profile__progress-track",
                            "aria-hidden": "true",
                            children: e.jsx("span", {
                              style: { width: "".concat(Ys, "%") },
                            }),
                          }),
                          e.jsxs("span", {
                            className: "public-profile__progress-text",
                            children: [
                              ra,
                              "/",
                              He.length,
                              " campos essenciais prontos",
                            ],
                          }),
                        ],
                      }),
                      e.jsx("div", {
                        className: "public-profile__checks",
                        children: He.map((u) =>
                          e.jsx(
                            "span",
                            {
                              className: "public-profile__check".concat(
                                u.done ? " is-done" : "",
                              ),
                              children: u.label,
                            },
                            u.key,
                          ),
                        ),
                      }),
                    ],
                  }),
                e.jsxs("label", {
                  className: "label",
                  children: [
                    e.jsx("span", { children: "Sobre o estabelecimento" }),
                    e.jsx("textarea", {
                      className: "input",
                      rows: 4,
                      maxLength: 1200,
                      placeholder:
                        "Ex.: Salão especializado em unhas e sobrancelhas, com atendimento acolhedor e horários flexíveis.",
                      value: M.sobre,
                      onChange: (u) => De("sobre", u.target.value),
                      disabled: C || A,
                    }),
                    e.jsx("span", {
                      className: "muted",
                      style: { fontSize: 12 },
                      children: "".concat(M.sobre.length, "/1200 caracteres"),
                    }),
                  ],
                }),
                e.jsx("div", {
                  className: "grid",
                  style: {
                    gap: 10,
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  },
                  children: e.jsxs("label", {
                    className: "label",
                    children: [
                      e.jsx("span", {
                        children: "Telefone público (WhatsApp)",
                      }),
                      e.jsx("input", {
                        className: "input",
                        value: st(M.contato_telefone),
                        onChange: (u) => De("contato_telefone", u.target.value),
                        disabled: C || A,
                        inputMode: "tel",
                        placeholder: "(11) 91234-5678",
                      }),
                    ],
                  }),
                }),
                e.jsxs("section", {
                  className: "public-profile__theme",
                  children: [
                    e.jsxs("div", {
                      className: "public-profile__theme-head",
                      children: [
                        e.jsxs("div", {
                          children: [
                            e.jsx("h4", {
                              className: "public-profile__theme-title",
                              children: "Identidade visual da pagina publica",
                            }),
                            e.jsx("p", {
                              className: "public-profile__theme-subtitle",
                              children:
                                "Defina as cores usadas nos botoes, destaques e elementos principais da sua pagina publica de agendamento.",
                            }),
                          ],
                        }),
                        e.jsx("button", {
                          type: "button",
                          className: "btn btn--outline btn--sm",
                          onClick: () => {
                            (De("accent_color", ""),
                              De("accent_strong_color", ""));
                          },
                          disabled: C || A,
                          children: "Usar padrao",
                        }),
                      ],
                    }),
                    e.jsxs("div", {
                      className: "public-profile__theme-preview",
                      style: publicThemePreviewStyle,
                      children: [
                        e.jsx("span", {
                          className: "public-profile__theme-preview-tag",
                          children: "Previa",
                        }),
                        e.jsx("strong", {
                          children: "Sua pagina com identidade propria",
                        }),
                        e.jsx("p", {
                          children:
                            "Clientes vao ver essas cores no topo, nos destaques e nas chamadas principais do fluxo de agendamento.",
                        }),
                        e.jsxs("div", {
                          className: "public-profile__theme-preview-actions",
                          children: [
                            e.jsx("span", {
                              className:
                                "public-profile__theme-preview-chip is-primary",
                              children: "Botao principal",
                            }),
                            e.jsx("span", {
                              className:
                                "public-profile__theme-preview-chip is-secondary",
                              children: "Destaque",
                            }),
                          ],
                        }),
                      ],
                    }),
                    e.jsxs("div", {
                      className: "grid public-profile__theme-grid",
                      style: {
                        gap: 10,
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(220px, 1fr))",
                      },
                      children: [
                        e.jsxs("label", {
                          className: "label public-profile__theme-field",
                          children: [
                            e.jsx("span", { children: "Cor principal" }),
                            e.jsxs("div", {
                              className: "public-profile__color-control",
                              children: [
                                e.jsx("input", {
                                  className: "public-profile__color-swatch",
                                  type: "color",
                                  value: publicAccentValue,
                                  onChange: (u) =>
                                    De(
                                      "accent_color",
                                      normalizeHexColor(u.target.value) || "",
                                    ),
                                  disabled: C || A,
                                  "aria-label": "Selecionar cor principal",
                                }),
                                e.jsx("input", {
                                  className: "input",
                                  value: M.accent_color,
                                  onChange: (u) =>
                                    De("accent_color", u.target.value),
                                  onBlur: (u) =>
                                    De(
                                      "accent_color",
                                      normalizeHexColor(u.target.value) || "",
                                    ),
                                  disabled: C || A,
                                  autoComplete: "off",
                                  spellCheck: !1,
                                  maxLength: 7,
                                  placeholder:
                                    PUBLIC_PROFILE_THEME_DEFAULTS.accent,
                                }),
                              ],
                            }),
                            e.jsx("span", {
                              className: "muted",
                              style: { fontSize: 12 },
                              children:
                                "Use um hexadecimal como #0f766e. Deixe vazio para usar o tema padrao.",
                            }),
                          ],
                        }),
                        e.jsxs("label", {
                          className: "label public-profile__theme-field",
                          children: [
                            e.jsx("span", { children: "Cor de destaque" }),
                            e.jsxs("div", {
                              className: "public-profile__color-control",
                              children: [
                                e.jsx("input", {
                                  className: "public-profile__color-swatch",
                                  type: "color",
                                  value: publicAccentStrongValue,
                                  onChange: (u) =>
                                    De(
                                      "accent_strong_color",
                                      normalizeHexColor(u.target.value) || "",
                                    ),
                                  disabled: C || A,
                                  "aria-label": "Selecionar cor de destaque",
                                }),
                                e.jsx("input", {
                                  className: "input",
                                  value: M.accent_strong_color,
                                  onChange: (u) =>
                                    De(
                                      "accent_strong_color",
                                      u.target.value,
                                    ),
                                  onBlur: (u) =>
                                    De(
                                      "accent_strong_color",
                                      normalizeHexColor(u.target.value) || "",
                                    ),
                                  disabled: C || A,
                                  autoComplete: "off",
                                  spellCheck: !1,
                                  maxLength: 7,
                                  placeholder:
                                    PUBLIC_PROFILE_THEME_DEFAULTS.accentStrong,
                                }),
                              ],
                            }),
                            e.jsx("span", {
                              className: "muted",
                              style: { fontSize: 12 },
                              children:
                                "Ideal para contrastes, gradientes e estados de foco na pagina publica.",
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
                e.jsxs("div", {
                  className: "label",
                  children: [
                    e.jsx("span", { children: "Horários de funcionamento" }),
                    e.jsxs("div", {
                      className: "working-hours__tools",
                      children: [
                        e.jsxs("div", {
                          className: "working-hours__presets",
                          role: "group",
                          "aria-label": "Atalhos de horário",
                          children: [
                            e.jsx("button", {
                              type: "button",
                              className:
                                "btn btn--outline btn--sm working-hours__preset",
                              onClick: () => Mt("business_week"),
                              disabled: C || A,
                              children: "Comercial (Seg-Sex)",
                            }),
                            e.jsx("button", {
                              type: "button",
                              className:
                                "btn btn--outline btn--sm working-hours__preset",
                              onClick: () => Mt("every_day"),
                              disabled: C || A,
                              children: "Todos os dias 09h-18h",
                            }),
                            e.jsx("button", {
                              type: "button",
                              className:
                                "btn btn--outline btn--sm working-hours__preset",
                              onClick: Wn,
                              disabled: C || A,
                              children: "Fechar domingo",
                            }),
                            e.jsx("button", {
                              type: "button",
                              className:
                                "btn btn--outline btn--sm working-hours__preset",
                              onClick: $n,
                              disabled: C || A,
                              children: "Sem intervalo",
                            }),
                          ],
                        }),
                        e.jsxs("div", {
                          className: "working-hours__copy",
                          children: [
                            e.jsxs("label", {
                              className: "label working-hours__copy-source",
                              children: [
                                e.jsx("span", {
                                  children: "Copiar horário de",
                                }),
                                e.jsx("select", {
                                  className: "input",
                                  value: Je,
                                  onChange: (u) => Un(u.target.value),
                                  disabled: C || A,
                                  children: rt.map((u) =>
                                    e.jsx(
                                      "option",
                                      { value: u.key, children: u.shortLabel },
                                      u.key,
                                    ),
                                  ),
                                }),
                              ],
                            }),
                            e.jsx("div", {
                              className: "working-hours__copy-targets",
                              role: "group",
                              "aria-label": "Dias para copiar",
                              children: rt
                                .filter((u) => u.key !== Je)
                                .map((u) => {
                                  const W = ya.includes(u.key);
                                  return e.jsxs(
                                    "label",
                                    {
                                      className:
                                        "working-hours__day-chip".concat(
                                          W ? " is-selected" : "",
                                        ),
                                      children: [
                                        e.jsx("input", {
                                          type: "checkbox",
                                          checked: W,
                                          onChange: (Y) =>
                                            zn(u.key, Y.target.checked),
                                          disabled: C || A,
                                        }),
                                        e.jsx("span", {
                                          children: u.shortLabel,
                                        }),
                                      ],
                                    },
                                    u.key,
                                  );
                                }),
                            }),
                            e.jsx("button", {
                              type: "button",
                              className:
                                "btn btn--outline btn--sm working-hours__copy-apply",
                              onClick: On,
                              disabled: C || A || !ya.length,
                              children: "Copiar para selecionados",
                            }),
                          ],
                        }),
                        e.jsxs("div", {
                          className: "working-hours__meta",
                          "aria-live": "polite",
                          children: [
                            e.jsxs("span", {
                              className: "working-hours__meta-item",
                              children: [
                                dt,
                                " ",
                                dt === 1 ? "dia ativo" : "dias ativos",
                              ],
                            }),
                            Ns > 0
                              ? e.jsxs("span", {
                                  className:
                                    "working-hours__meta-item working-hours__meta-item--warn",
                                  children: [
                                    Ns,
                                    " ",
                                    Ns === 1
                                      ? "ajuste pendente"
                                      : "ajustes pendentes",
                                  ],
                                })
                              : e.jsx("span", {
                                  className:
                                    "working-hours__meta-item working-hours__meta-item--ok",
                                  children: "Sem conflitos de horário",
                                }),
                          ],
                        }),
                      ],
                    }),
                    e.jsx("div", {
                      className: "working-hours",
                      children: ne.map((u) => {
                        const W = js[u.key] || "";
                        return e.jsxs(
                          "div",
                          {
                            className: "working-hours__row".concat(
                              W ? " is-invalid" : "",
                            ),
                            children: [
                              e.jsxs("label", {
                                className: "working-hours__day",
                                children: [
                                  e.jsx("input", {
                                    type: "checkbox",
                                    checked: u.enabled,
                                    onChange: (Y) =>
                                      Bn(u.key, Y.target.checked),
                                    disabled: C || A,
                                    className: "working-hours__toggle",
                                  }),
                                  e.jsx("span", { children: u.label }),
                                  e.jsx("span", {
                                    className:
                                      "working-hours__status working-hours__status--".concat(
                                        u.enabled ? "open" : "closed",
                                      ),
                                    children: u.enabled ? "Aberto" : "Fechado",
                                  }),
                                ],
                              }),
                              e.jsxs("div", {
                                className: "working-hours__time",
                                children: [
                                  e.jsx("input", {
                                    type: "time",
                                    className: "input",
                                    value: u.start,
                                    onChange: (Y) =>
                                      Rt(u.key, "start", Y.target.value),
                                    "aria-label":
                                      "Início do atendimento de ".concat(
                                        u.label,
                                      ),
                                    "aria-invalid": !!W,
                                    disabled: C || A || !u.enabled,
                                  }),
                                  e.jsx("span", {
                                    className: "working-hours__separator",
                                    children: "às",
                                  }),
                                  e.jsx("input", {
                                    type: "time",
                                    className: "input",
                                    value: u.end,
                                    onChange: (Y) =>
                                      Rt(u.key, "end", Y.target.value),
                                    "aria-label":
                                      "Fim do atendimento de ".concat(u.label),
                                    "aria-invalid": !!W,
                                    disabled: C || A || !u.enabled,
                                  }),
                                ],
                              }),
                              e.jsxs("div", {
                                className: "working-hours__break",
                                children: [
                                  e.jsxs("label", {
                                    className:
                                      "switch working-hours__break-toggle",
                                    children: [
                                      e.jsx("input", {
                                        type: "checkbox",
                                        checked: u.blockEnabled,
                                        onChange: (Y) =>
                                          Fn(u.key, Y.target.checked),
                                        disabled: C || A || !u.enabled,
                                      }),
                                      e.jsx("span", {
                                        children: "Intervalo de pausa",
                                      }),
                                    ],
                                  }),
                                  u.blockEnabled &&
                                    e.jsxs("div", {
                                      className: "working-hours__break-range",
                                      children: [
                                        e.jsx("input", {
                                          type: "time",
                                          className: "input",
                                          value: u.blockStart,
                                          onChange: (Y) =>
                                            Tt(
                                              u.key,
                                              "blockStart",
                                              Y.target.value,
                                            ),
                                          "aria-label":
                                            "Início da pausa de ".concat(
                                              u.label,
                                            ),
                                          "aria-invalid": !!W,
                                          disabled: C || A || !u.enabled,
                                        }),
                                        e.jsx("span", {
                                          className: "working-hours__separator",
                                          children: "às",
                                        }),
                                        e.jsx("input", {
                                          type: "time",
                                          className: "input",
                                          value: u.blockEnd,
                                          onChange: (Y) =>
                                            Tt(
                                              u.key,
                                              "blockEnd",
                                              Y.target.value,
                                            ),
                                          "aria-label":
                                            "Fim da pausa de ".concat(u.label),
                                          "aria-invalid": !!W,
                                          disabled: C || A || !u.enabled,
                                        }),
                                      ],
                                    }),
                                ],
                              }),
                              W &&
                                e.jsx("p", {
                                  className: "working-hours__issue",
                                  role: "alert",
                                  children: W,
                                }),
                            ],
                          },
                          u.key,
                        );
                      }),
                    }),
                    e.jsx("span", {
                      className: "muted",
                      style: { fontSize: 12 },
                      children:
                        "Use os atalhos para preencher mais rápido e revise os alertas antes de salvar.",
                    }),
                  ],
                }),
                e.jsxs("label", {
                  className: "label",
                  children: [
                    e.jsx("span", { children: "Observações (opcional)" }),
                    e.jsx("textarea", {
                      className: "input",
                      rows: 3,
                      value: M.horarios_text,
                      onChange: (u) => De("horarios_text", u.target.value),
                      disabled: C || A,
                      placeholder:
                        "Ex.: Feriado 15/11: fechado | Plantão sábado até 13h",
                    }),
                    e.jsx("span", {
                      className: "muted",
                      style: { fontSize: 12 },
                      children:
                        "Use para avisos rápidos como feriados, plantões e regras especiais de atendimento.",
                    }),
                  ],
                }),
                e.jsxs("details", {
                  className: "public-profile__collapsible",
                  children: [
                    e.jsxs("summary", {
                      children: [
                        e.jsx("span", { children: "Links e redes sociais" }),
                        e.jsx("small", { children: "Opcional" }),
                      ],
                    }),
                    e.jsx("div", {
                      className: "public-profile__collapsible-body",
                      children: e.jsxs("div", {
                        className: "grid",
                        style: {
                          gap: 10,
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(220px, 1fr))",
                        },
                        children: [
                          e.jsxs("label", {
                            className: "label",
                            children: [
                              e.jsx("span", { children: "Site" }),
                              e.jsx("input", {
                                className: "input",
                                type: "url",
                                value: M.site_url,
                                onChange: (u) => De("site_url", u.target.value),
                                disabled: C || A,
                                placeholder: "https://seusite.com",
                              }),
                            ],
                          }),
                          e.jsxs("label", {
                            className: "label",
                            children: [
                              e.jsx("span", { children: "Instagram" }),
                              e.jsx("input", {
                                className: "input",
                                value: M.instagram_url,
                                onChange: (u) =>
                                  De("instagram_url", u.target.value),
                                disabled: C || A,
                                placeholder: "https://instagram.com/seuperfil",
                              }),
                            ],
                          }),
                          e.jsxs("label", {
                            className: "label",
                            children: [
                              e.jsx("span", { children: "Facebook" }),
                              e.jsx("input", {
                                className: "input",
                                value: M.facebook_url,
                                onChange: (u) =>
                                  De("facebook_url", u.target.value),
                                disabled: C || A,
                                placeholder: "https://facebook.com/seupagina",
                              }),
                            ],
                          }),
                          e.jsxs("label", {
                            className: "label",
                            children: [
                              e.jsx("span", { children: "LinkedIn" }),
                              e.jsx("input", {
                                className: "input",
                                value: M.linkedin_url,
                                onChange: (u) =>
                                  De("linkedin_url", u.target.value),
                                disabled: C || A,
                                placeholder:
                                  "https://linkedin.com/company/seuperfil",
                              }),
                            ],
                          }),
                          e.jsxs("label", {
                            className: "label",
                            children: [
                              e.jsx("span", { children: "YouTube" }),
                              e.jsx("input", {
                                className: "input",
                                value: M.youtube_url,
                                onChange: (u) =>
                                  De("youtube_url", u.target.value),
                                disabled: C || A,
                                placeholder: "https://youtube.com/@seucanal",
                              }),
                            ],
                          }),
                          e.jsxs("label", {
                            className: "label",
                            children: [
                              e.jsx("span", { children: "TikTok" }),
                              e.jsx("input", {
                                className: "input",
                                value: M.tiktok_url,
                                onChange: (u) =>
                                  De("tiktok_url", u.target.value),
                                disabled: C || A,
                                placeholder:
                                  "https://www.tiktok.com/@seuperfil",
                              }),
                            ],
                          }),
                        ],
                      }),
                    }),
                  ],
                }),
                e.jsxs("details", {
                  className: "public-profile__collapsible",
                  children: [
                    e.jsxs("summary", {
                      children: [
                        e.jsx("span", { children: "Fotos do estabelecimento" }),
                        e.jsx("small", { children: "Opcional" }),
                      ],
                    }),
                    e.jsx("div", {
                      className: "public-profile__collapsible-body",
                      children: e.jsxs("section", {
                        className: "box",
                        style: { display: "grid", gap: 8 },
                        children: [
                          e.jsx("div", {
                            className: "row",
                            style: {
                              justifyContent: "space-between",
                              alignItems: "center",
                            },
                            children: e.jsx("div", {
                              children: e.jsx("p", {
                                className: "muted",
                                style: { margin: 0, fontSize: 13 },
                                children:
                                  "Essas imagens aparecem na pagina publica e no fluxo de agendamento (/novo).",
                              }),
                            }),
                          }),
                          e.jsx(bl, {
                            establishmentId: n == null ? void 0 : n.id,
                          }),
                        ],
                      }),
                    }),
                  ],
                }),
                ua.message &&
                  e.jsx("div", {
                    className: "notice notice--".concat(ua.type),
                    role: "alert",
                    children: ua.message,
                  }),
                e.jsx("div", {
                  className: "row",
                  style: { justifyContent: "flex-end", gap: 8 },
                  children: e.jsx("button", {
                    type: "submit",
                    className: "btn btn--primary",
                    disabled: A,
                    children: A
                      ? e.jsx("span", { className: "spinner" })
                      : "Salvar perfil público",
                  }),
                }),
              ],
            }),
          }),
        r)
      ) {
        const u =
            ((Co = Be[h.plan]) == null ? void 0 : Co.label) ||
            h.plan.toUpperCase(),
          W = (So = Be[h.plan]) == null ? void 0 : So.maxServices,
          Y = (Po = Be[h.plan]) == null ? void 0 : Po.maxProfessionals,
          Ut = ""
            .concat(Ms == null ? "..." : Ms, " serviços / ")
            .concat(Ds == null ? "..." : Ds, " profissionais"),
          X = ""
            .concat(
              W == null ? "serviços ilimitados" : "até " + W + " serviços",
              " / ",
            )
            .concat(
              Y == null
                ? "profissionais ilimitados"
                : "até " + Y + " profissionais",
            ),
          hs =
            typeof h.appointmentsUsed == "number" ? h.appointmentsUsed : null,
          gs =
            typeof h.appointmentsLimit == "number" ? h.appointmentsLimit : null,
          Qs = h.appointmentsMonth || "",
          zt = hs != null || gs != null,
          fa = hs != null ? hs.toLocaleString("pt-BR") : "...",
          Js = gs != null ? gs.toLocaleString("pt-BR") : "ilimitado",
          Ot = zt
            ? ""
                .concat(fa, " / ")
                .concat(Js)
                .concat(Qs ? " - " + Qs : "")
            : "Sem dados",
          Zs = se ? "".concat(se, "/mês") : null,
          fs = y || _ || "Em análise",
          Gt = Zs ? "".concat(fs, " · ").concat(Zs) : fs,
          la =
            J != null && J.due_at
              ? ga(J.due_at)
              : k || (h.activeUntil ? ga(h.activeUntil) : "-"),
          bs = !pa && y && wn !== d,
          Ae = [];
        (cn &&
          Ae.push({
            key: "loading",
            variant: "info",
            message: "Atualizando informações de cobrança...",
          }),
          ns && !ts
            ? Ae.push({
                key: "renewal-pending",
                variant: "warn",
                message:
                  "Plano vencido / renovação pendente. Gere o PIX para manter o acesso aos recursos.",
              })
            : (pa || h.status === "delinquent") &&
              Ae.push({
                key: "delinquent",
                variant: "error",
                message:
                  "Pagamento em atraso. Regularize para manter o acesso aos recursos.",
              }),
          !ns &&
            gi.isExpired &&
            !ts &&
            Ae.push({
              key: "trial-expired",
              variant: "warn",
              message:
                "Seu teste gratuito terminou. Contrate um plano para manter o acesso aos recursos.",
            }),
          d === "pending" &&
            Ae.push({
              key: "pending",
              variant: "warn",
              message:
                "Pagamento pendente. Finalize o checkout para concluir a contratação.",
            }),
          h.plan === "starter" && Os
            ? Ae.push({
                key: "trial-blocked",
                variant: "muted",
                message:
                  "Teste grátis indisponível: já houve uma assinatura contratada nesta conta.",
              })
            : h.plan === "starter" &&
              Pt &&
              Ae.push({
                key: "trial-available",
                variant: "info",
                message:
                  "Experimente o plano Pro gratuitamente por 7 dias quando desejar.",
              }));
        const ca = [],
          Ta = [];
        (Lt
          ? Ta.push(
              e.jsx(
                "button",
                {
                  className: "btn btn--primary btn--sm",
                  type: "button",
                  onClick: fi,
                  disabled: Fs,
                  title: "Verifique o PIX pendente de renovação",
                  children: Fs
                    ? e.jsx("span", { className: "spinner" })
                    : "Ver PIX pendente",
                },
                "renewal-pending",
              ),
            )
          : ns &&
            hi === "pix_manual" &&
            Ta.push(
              e.jsx(
                "button",
                {
                  className: "btn btn--primary btn--sm".concat(
                    ue ? " is-pix-highlight" : "",
                  ),
                  type: "button",
                  ref: K,
                  onClick: At,
                  disabled: Fs,
                  title: "Gerar PIX de renovação",
                  children: Fs
                    ? e.jsx("span", { className: "spinner" })
                    : "Gerar PIX de renovação",
                },
                "renewal-create",
              ),
            ),
          h.plan === "starter"
            ? (!h.trialEnd &&
                Pt &&
                ca.push(
                  e.jsx(
                    "button",
                    {
                      className: "btn btn--outline btn--outline-brand btn--sm",
                      type: "button",
                      onClick: Hn,
                      disabled: h.status === "delinquent" || Oe,
                      title:
                        "Confirmação será solicitada antes da mudança de plano.",
                      children: Oe
                        ? e.jsx("span", { className: "spinner" })
                        : "Ativar 7 dias grátis",
                    },
                    "trial",
                  ),
                ),
              ca.push(
                e.jsx(
                  "button",
                  {
                    className: "btn btn--outline btn--outline-brand btn--sm",
                    type: "button",
                    onClick: () => It("pro"),
                    disabled: Oe,
                    title:
                      "Confirmação será solicitada antes da mudança de plano.",
                    children: Oe
                      ? e.jsx("span", { className: "spinner" })
                      : "Alterar para plano Pro",
                  },
                  "upgrade-pro",
                ),
              ))
            : Jt.filter(($) => $ !== h.plan).forEach(($) => {
                const Vt = Oe || Cn($) || Sn($),
                  et = Jt.indexOf($) < Jt.indexOf(h.plan);
                let ba =
                  "Confirmação será solicitada antes da mudança de plano.";
                (Cn($)
                  ? (ba =
                      "Reduza seus serviços para até " +
                      Be[$].maxServices +
                      " antes de migrar.")
                  : Sn($)
                    ? (ba =
                        "Reduza seus profissionais para até " +
                        Be[$].maxProfessionals +
                        " antes de migrar.")
                    : et &&
                      (ba =
                        "Downgrade: passa a valer na próxima renovação e exige senha de confirmação."),
                  ca.push(
                    e.jsx(
                      "button",
                      {
                        className:
                          "btn btn--outline btn--outline-brand btn--sm",
                        type: "button",
                        disabled: Vt,
                        title: ba,
                        onClick: () => It($),
                        children: "Ir para " + Ha($),
                      },
                      "tier-" + $,
                    ),
                  ));
              }));
        const xs = [
          e.jsx(
            Yt,
            {
              className: "btn btn--ghost btn--sm",
              to: "/planos",
              children: "Conhecer planos",
            },
            "plans-link",
          ),
        ];
        ts ||
          xs.unshift(
            e.jsxs(
              "div",
              {
                className: "plan-card__pix-actions",
                children: [
                  e.jsxs("label", {
                    className: "plan-card__pix-select",
                    children: [
                      e.jsx("span", {
                        className: "plan-card__pix-label",
                        children: "Ciclo",
                      }),
                      e.jsxs("select", {
                        value: Va,
                        onChange: ($) => li($.target.value),
                        disabled: Oe,
                        children: [
                          e.jsx("option", {
                            value: "mensal",
                            children: "Mensal",
                          }),
                          e.jsx("option", {
                            value: "anual",
                            children: "Anual",
                          }),
                        ],
                      }),
                    ],
                  }),
                  e.jsx("button", {
                    className: "btn btn--primary plan-card__pix-button",
                    type: "button",
                    onClick: () => Ia(h.plan, Va),
                    disabled: Oe,
                    title: "Gerar cobrança via PIX",
                    children: Oe
                      ? e.jsx("span", { className: "spinner" })
                      : "Gerar PIX",
                  }),
                ],
              },
              "pix-actions",
            ),
          );
        const Xt = ts
          ? "Assinatura ativa" +
            (h.activeUntil ? " até " + ga(h.activeUntil) : "") +
            "."
          : pa
            ? "Pagamento em atraso. Gere o PIX para regularizar sua assinatura."
            : "Finalize o pagamento para ativar sua assinatura.";
        (a.push({
          id: "plan",
          title: "Plano do Estabelecimento",
          content: e.jsxs("article", {
            className: "plan-card",
            children: [
              e.jsxs("header", {
                className: "plan-card__header",
                children: [
                  e.jsxs("div", {
                    children: [
                      e.jsx("h3", {
                        className: "plan-card__title",
                        children: u,
                      }),
                      e.jsxs("div", {
                        className: "plan-card__chips",
                        children: [
                          e.jsx("span", {
                            className: "chip chip--status-" + (d || "default"),
                            children: _ || "-",
                          }),
                          bs &&
                            e.jsx("span", {
                              className:
                                "chip chip--status-" + (wn || "default"),
                              children: y,
                            }),
                        ],
                      }),
                    ],
                  }),
                  e.jsx("span", {
                    className: "chip chip--tier",
                    children: h.plan.toUpperCase(),
                  }),
                ],
              }),
              e.jsxs("div", {
                className: "plan-card__summary",
                children: [
                  e.jsxs("div", {
                    className: "plan-card__summary-item",
                    children: [
                      e.jsx("span", {
                        className: "plan-card__summary-label",
                        children: "Status da assinatura",
                      }),
                      e.jsx("strong", { children: Gt }),
                    ],
                  }),
                  e.jsxs("div", {
                    className: "plan-card__summary-item",
                    children: [
                      e.jsx("span", {
                        className: "plan-card__summary-label",
                        children: "Próxima confirmação",
                      }),
                      e.jsx("strong", { children: la }),
                      h.activeUntil &&
                        !k &&
                        e.jsxs("span", {
                          className: "plan-card__summary-extra",
                          children: ["Plano ativo até ", ga(h.activeUntil)],
                        }),
                    ],
                  }),
                  e.jsxs("div", {
                    className: "plan-card__summary-item",
                    children: [
                      e.jsx("span", {
                        className: "plan-card__summary-label",
                        children: "Forma de pagamento",
                      }),
                      e.jsx("strong", { children: "PIX manual" }),
                      e.jsx("span", {
                        className: "plan-card__summary-extra",
                        children: "Geramos o link dinâmico a cada renovação",
                      }),
                    ],
                  }),
                ],
              }),
              Ae.map(($) =>
                e.jsx(
                  "div",
                  {
                    className:
                      "plan-card__alert plan-card__alert--" + $.variant,
                    children: $.message,
                  },
                  $.key,
                ),
              ),
              Xa.message &&
                e.jsx("div", {
                  className:
                    "plan-card__alert plan-card__alert--" + (Xa.kind || "info"),
                  children: Xa.syncing
                    ? e.jsxs(e.Fragment, {
                        children: [
                          e.jsx("span", { className: "spinner" }),
                          " ",
                          Xa.message,
                        ],
                      })
                    : Xa.message,
                }),
              xt &&
                e.jsx("div", {
                  className: "plan-card__alert plan-card__alert--error",
                  children: xt,
                }),
              e.jsx("div", {
                className: "plan-card__notice muted",
                children: Xt,
              }),
              e.jsxs("div", {
                className: "plan-card__actions",
                children: [
                  Ta.length > 0 &&
                    e.jsx("div", {
                      className: "plan-card__actions-group",
                      children: Ta,
                    }),
                  ca.length > 0 &&
                    e.jsx("div", {
                      className: "plan-card__actions-group",
                      children: ca,
                    }),
                  xs.length > 0 &&
                    e.jsx("div", {
                      className:
                        "plan-card__actions-group plan-card__actions-group--secondary",
                      children: xs,
                    }),
                ],
              }),
              bn &&
                e.jsx("div", {
                  className: "plan-card__alert plan-card__alert--error",
                  children: bn,
                }),
              e.jsxs("footer", {
                className: "plan-card__foot",
                style: { display: "grid", gap: 6 },
                children: [
                  e.jsxs("div", {
                    children: [
                      e.jsx("strong", { children: "Agendamentos:" }),
                      " ",
                      Ot,
                    ],
                  }),
                  e.jsxs("div", {
                    children: [
                      e.jsx("strong", { children: "Seu uso:" }),
                      " ",
                      Ut,
                    ],
                  }),
                  e.jsxs("div", {
                    children: [
                      e.jsxs("strong", {
                        children: ["Limites do plano ", u, ":"],
                      }),
                      " ",
                      X,
                    ],
                  }),
                ],
              }),
            ],
          }),
        }),
          a.push({
            id: "mercadopago-connect",
            title: "Mercado Pago",
            content: e.jsxs("section", {
              className: "box",
              style: { display: "grid", gap: 10 },
              children: [
                e.jsxs("div", {
                  children: [
                    e.jsx("h4", { style: { margin: 0 }, children: "Conexão" }),
                    e.jsx("p", {
                      className: "muted",
                      style: { margin: "4px 0 0" },
                      children:
                        "Conecte sua conta Mercado Pago para receber sinais via PIX direto no seu estabelecimento.",
                    }),
                  ],
                }),
                !Ve &&
                  e.jsxs("div", {
                    className: "notice notice--info",
                    children: [
                      "Conexão disponível apenas para planos Pro e Premium. ",
                      e.jsx(Yt, {
                        to: "/planos",
                        children: "Conhecer planos",
                      }),
                    ],
                  }),
                ae.loading &&
                  e.jsxs("div", {
                    className: "row",
                    style: { gap: 8, alignItems: "center" },
                    children: [
                      e.jsx("span", {
                        className: "spinner",
                        "aria-hidden": !0,
                      }),
                      e.jsx("span", {
                        className: "muted",
                        style: { fontSize: 13 },
                        children: "Carregando status do Mercado Pago...",
                      }),
                    ],
                  }),
                !ae.loading &&
                  i &&
                  e.jsxs("div", {
                    className: "notice notice--success",
                    children: [
                      "Conectado",
                      c ? " (final ".concat(c, ")") : "",
                      ".",
                    ],
                  }),
                !ae.loading &&
                  !i &&
                  e.jsx("div", {
                    className: "notice notice--warn",
                    children:
                      "Mercado Pago não conectado. Conecte sua conta para receber sinais via PIX.",
                  }),
                (s == null ? void 0 : s.mp_user_id) &&
                  e.jsxs("span", {
                    className: "muted",
                    style: { fontSize: 12 },
                    children: ["mp_user_id: ", s.mp_user_id],
                  }),
                ae.error &&
                  e.jsx("div", {
                    className: "notice notice--error",
                    role: "alert",
                    children: ae.error,
                  }),
                ae.notice &&
                  e.jsx("div", {
                    className: "notice notice--success",
                    role: "status",
                    children: ae.notice,
                  }),
                e.jsxs("div", {
                  className: "row",
                  style: { gap: 8, flexWrap: "wrap" },
                  children: [
                    e.jsx("button", {
                      type: "button",
                      className: "btn btn--primary",
                      onClick: Et,
                      disabled: ae.connectLoading || !Ve,
                      children: ae.connectLoading
                        ? e.jsx("span", { className: "spinner" })
                        : Ve
                          ? "Em desenvolver... Conectar Mercado Pago"
                          : "Conectar Mercado Pago (Pro/Premium)",
                    }),
                    i &&
                      e.jsx("button", {
                        type: "button",
                        className: "btn btn--outline",
                        onClick: En,
                        disabled: ae.disconnectLoading,
                        children: ae.disconnectLoading
                          ? e.jsx("span", { className: "spinner" })
                          : "Desconectar",
                      }),
                  ],
                }),
              ],
            }),
          }));
      }
      if (r) {
        const u =
          Ne.type === "error"
            ? "notice notice--error"
            : Ne.type === "success"
              ? "notice notice--success"
              : "";
        a.push({
          id: "deposit",
          title: "Sinal nos agendamentos",
          content: e.jsx("section", {
            className: "box",
            style: { display: "grid", gap: 12 },
            children: re
              ? e.jsx("div", {
                  className: "muted",
                  children: "Carregando configurações do sinal...",
                })
              : Ve
                ? e.jsxs(e.Fragment, {
                    children: [
                      e.jsxs("p", {
                        className: "muted",
                        style: { margin: 0 },
                        children: [
                          "Exija um sinal via PIX para confirmar novos agendamentos. Pagamentos expiram em ",
                          We,
                          " min.",
                        ],
                      }),
                      L &&
                        !i &&
                        !ae.loading &&
                        e.jsxs("div", {
                          className: "notice notice--warn",
                          style: {
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                          },
                          children: [
                            e.jsx("span", {
                              children:
                                "Para exigir sinal, conecte sua conta Mercado Pago.",
                            }),
                            e.jsx("div", {
                              children: e.jsx("button", {
                                type: "button",
                                className: "btn btn--outline btn--sm",
                                onClick: Et,
                                disabled: ae.connectLoading,
                                children: ae.connectLoading
                                  ? e.jsx("span", { className: "spinner" })
                                  : "Conectar Mercado Pago",
                              }),
                            }),
                          ],
                        }),
                      e.jsxs("label", {
                        className: "switch",
                        children: [
                          e.jsx("input", {
                            type: "checkbox",
                            checked: L,
                            onChange: (W) => {
                              (ie(W.target.checked),
                                ce({ type: "", message: "" }));
                            },
                            disabled: de,
                          }),
                          e.jsx("span", {
                            children: "Ativar sinal nos agendamentos",
                          }),
                        ],
                      }),
                      e.jsxs("div", {
                        className: "row",
                        style: {
                          gap: 12,
                          flexWrap: "wrap",
                          alignItems: "flex-end",
                        },
                        children: [
                          e.jsxs("label", {
                            className: "label",
                            style: { width: 140 },
                            children: [
                              e.jsx("span", { children: "Percentual (%)" }),
                              e.jsx("input", {
                                className: "input",
                                type: "text",
                                inputMode: "numeric",
                                placeholder: "Ex: 30",
                                value: Z,
                                onChange: (W) => te(Kn(W.target.value)),
                                disabled: !L || de,
                              }),
                            ],
                          }),
                          e.jsx("span", {
                            className: "muted",
                            children: "Mínimo 5% e máximo 90%.",
                          }),
                        ],
                      }),
                      Ne.message &&
                        e.jsx("div", {
                          className: u || "notice",
                          children: Ne.message,
                        }),
                      e.jsx("div", {
                        className: "row",
                        style: { gap: 8 },
                        children: e.jsx("button", {
                          type: "button",
                          className: "btn btn--primary btn--sm",
                          onClick: Yn,
                          disabled: de,
                          children: de
                            ? e.jsx("span", { className: "spinner" })
                            : "Salvar sinal",
                        }),
                      }),
                    ],
                  })
                : e.jsxs(e.Fragment, {
                    children: [
                      e.jsx("div", {
                        className: "notice notice--info",
                        children:
                          "Recurso disponível apenas para planos Pro e Premium.",
                      }),
                      e.jsx(Yt, {
                        className: "btn btn--outline btn--sm",
                        to: "/planos",
                        children: "Conhecer planos",
                      }),
                    ],
                  }),
          }),
        });
      }
      return (
        a.push({
          id: "support",
          title: "Ajuda",
          content: e.jsxs(e.Fragment, {
            children: [
              e.jsx("p", {
                className: "muted",
                children:
                  "Tire dúvidas, veja perguntas frequentes e formas de contato.",
              }),
              e.jsx("div", {
                className: "row",
                style: { gap: 8, justifyContent: "flex-end" },
                children: e.jsx(Yt, {
                  className: "btn btn--outline",
                  to: "/ajuda",
                  children: "Abrir Ajuda",
                }),
              }),
            ],
          }),
        }),
        a
      );
    }, [
      r,
      Ve,
      L,
      Z,
      We,
      re,
      de,
      Ne,
      Yn,
      Kn,
      h.plan,
      h.status,
      h.trialEnd,
      h.trialDaysLeft,
      h.trialWarn,
      h.allowAdvanced,
      h.activeUntil,
      rs,
      oa,
      ga,
      Pe,
      E,
      Ye,
      ct,
      n == null ? void 0 : n.id,
      T,
      Ze,
      mt,
      ma,
      Ss,
      B,
      Xn,
      Ps,
      ht,
      x,
      J,
      cn,
      na,
      Se,
      jn,
      St,
      ss,
      es,
      as,
      zs,
      Ja,
      ta,
      Pa,
      Za,
      Nn,
      Oe,
      xt,
      Hn,
      Ia,
      It,
      Os,
      Pt,
      pa,
      ts,
      oe,
      Va,
      ue,
      S,
      M,
      ua,
      C,
      A,
      pe,
      ae,
      Pn,
      Ln,
      Et,
      En,
      ne,
      De,
      Bn,
      Rt,
      Fn,
      Tt,
      Mt,
      Wn,
      $n,
      Je,
      ya,
      Un,
      zn,
      On,
      js,
      Ns,
      dt,
      Bt,
      Vn,
      qn,
      ls,
      _a,
      jt,
      Qa,
      Nt,
      An,
    ]),
    Ft =
      ((uo = G.data) == null ? void 0 : uo.qr_code) ||
      ((mo = G.data) == null ? void 0 : mo.copia_e_cola) ||
      "",
    Wt = ka ? "approved" : (po = G.data) == null ? void 0 : po.status,
    Le = String(Wt || "").toLowerCase(),
    ia = ka
      ? "success"
      : Le
        ? Le.includes("approved") ||
          Le.includes("paid") ||
          Le.includes("confirmed")
          ? "success"
          : Le.includes("pending") ||
              Le.includes("in_process") ||
              Le.includes("inprocess") ||
              Le.includes("authorized")
            ? "pending"
            : Le.includes("rejected") ||
                Le.includes("cancel") ||
                Le.includes("fail")
              ? "error"
              : "neutral"
        : "",
    Qn =
      ia === "success"
        ? "Pagamento confirmado"
        : ia === "pending"
          ? "Pagamento pendente"
          : ia === "error"
            ? "Pagamento não confirmado"
            : ia === "neutral"
              ? "Status em processamento"
              : "",
    Ci = ia === "success" ? "✓" : ia === "error" ? "!" : "•",
    Si = ka
      ? os
        ? "Pagamento confirmado. Renovamos seu plano automaticamente."
        : Ra
          ? "Pagamento confirmado. Atualizamos seu saldo automaticamente."
          : "Pagamento confirmado. Ativamos seu plano automaticamente."
      : os
        ? "Pague pelo app do seu banco e aguarde a confirmação automática. Renovação liberada após a aprovação."
        : Ra
          ? "Pague pelo app do seu banco e aguarde a confirmação automática. Crédito liberado após a aprovação."
          : "Pague pelo app do seu banco e aguarde a confirmação automática. Plano liberado após a aprovação.",
    be = ((ho = G.data) == null ? void 0 : ho.pack) || null,
    Jn = be
      ? typeof be.price_cents == "number"
        ? be.price_cents
        : typeof be.priceCents == "number"
          ? be.priceCents
          : null
      : null,
    Zn =
      Jn != null
        ? (Number(Jn) / 100).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          })
        : null,
    Pi =
      (fo =
        (go = be == null ? void 0 : be.messages) != null
          ? go
          : be == null
            ? void 0
            : be.wa_messages) != null
        ? fo
        : null,
    businessHubCards = r
      ? [
          {
            id: "subscription-hub",
            title: "Plano e assinatura",
            description:
              "Plano atual, limites, historico da assinatura e cobranca via PIX em pagina propria.",
            to: "/assinatura",
            cta: "Abrir modulo",
          },
          {
            id: "whatsapp-business-hub",
            title: "WhatsApp Business",
            description:
              "Conexao oficial, franquia mensal, creditos extras e historico de recargas.",
            to: "/whatsappbusiness",
            cta: "Abrir modulo",
          },
          {
            id: "deposit-hub",
            title: "Sinal e Mercado Pago",
            description:
              "Conecte a conta Mercado Pago e defina o percentual de sinal nos agendamentos.",
            to: "/sinal",
            cta: "Abrir modulo",
          },
        ]
      : [],
    visibleSections = wi.filter(
      ({ id: a }) =>
        a !== "plan" &&
        a !== "whatsapp-connect" &&
        a !== "mercadopago-connect" &&
        a !== "deposit",
    );
  return e.jsxs("div", {
    className: "grid config-page",
    style: { gap: 12 },
    children: [
      e.jsxs("div", {
        className: "card config-page__hero",
        children: [
          e.jsx("h2", { style: { marginTop: 0 }, children: "Configurações" }),
          e.jsx("p", {
            className: "muted",
            style: { marginTop: 0 },
            children: "Gerencie sua conta e preferências.",
          }),
        ],
      }),
      businessHubCards.length
        ? e.jsxs("section", {
            className: "card settings-hub",
            children: [
              e.jsxs("div", {
                className: "settings-hub__head",
                children: [
                  e.jsx("h3", {
                    style: { margin: 0 },
                    children: "Modulos especializados",
                  }),
                  e.jsx("p", {
                    className: "muted",
                    style: { margin: "4px 0 0" },
                    children:
                      "Assinatura, WhatsApp Business e Sinal agora possuem paginas proprias para reduzir acoplamento e manter os fluxos isolados.",
                  }),
                ],
              }),
              e.jsx("div", {
                className: "settings-hub__grid",
                children: businessHubCards.map((a) =>
                  e.jsxs(
                    Yt,
                    {
                      className: "settings-hub__card",
                      to: a.to,
                      children: [
                        e.jsx("span", {
                          className: "settings-hub__card-label",
                          children: "Modulo",
                        }),
                        e.jsx("strong", { children: a.title }),
                        e.jsx("p", {
                          className: "muted",
                          children: a.description,
                        }),
                        e.jsxs("span", {
                          className: "settings-hub__card-link",
                          children: [a.cta, " ", "›"],
                        }),
                      ],
                    },
                    a.id,
                  ),
                ),
              }),
            ],
          })
        : null,
      visibleSections.map(({ id: a, title: t, content: s }) => {
        const i = !!v[a],
          c = S === a;
        return e.jsxs(
          "div",
          {
            className: "card config-section".concat(
              c ? " config-section--highlight" : "",
            ),
            ref: (l) => {
              l ? (D.current[a] = l) : delete D.current[a];
            },
            children: [
              e.jsxs("button", {
                type: "button",
                className: "config-section__toggle".concat(i ? " is-open" : ""),
                onClick: () => ei(a),
                "aria-expanded": i,
                children: [
                  e.jsx("span", {
                    className: "config-section__title",
                    children: t,
                  }),
                  e.jsx(Wo, {
                    className: "config-section__icon",
                    "aria-hidden": "true",
                  }),
                ],
              }),
              i &&
                e.jsx("div", {
                  className: "config-section__content",
                  children: s,
                }),
            ],
          },
          a,
        );
      }),
      ai &&
        e.jsx(at, {
          title: "Confirmar senha",
          onClose: qt,
          actions: [
            e.jsx(
              "button",
              {
                type: "button",
                className: "btn btn--outline",
                onClick: qt,
                disabled: ma,
                children: "Cancelar",
              },
              "cancel",
            ),
            e.jsx(
              "button",
              {
                form: "confirm-password-form",
                type: "submit",
                className: "btn btn--primary",
                disabled: ma,
                children: ma
                  ? e.jsx("span", { className: "spinner" })
                  : "Confirmar e salvar",
              },
              "confirm",
            ),
          ],
          children: e.jsxs("form", {
            id: "confirm-password-form",
            onSubmit: Ni,
            className: "grid",
            style: { gap: 10 },
            children: [
              e.jsx("p", {
                className: "muted",
                style: { margin: 0 },
                children:
                  "Precisamos confirmar sua senha para salvar as alterações.",
              }),
              e.jsxs("label", {
                className: "label",
                style: { marginBottom: 0 },
                children: [
                  e.jsx("span", { children: "Senha atual" }),
                  e.jsx("input", {
                    className: "input",
                    type: "password",
                    value: tn,
                    onChange: (a) => $a(a.target.value),
                    autoFocus: !0,
                    disabled: ma,
                  }),
                ],
              }),
              nn &&
                e.jsx("div", {
                  className: "notice notice--error",
                  role: "alert",
                  style: { margin: 0 },
                  children: nn,
                }),
            ],
          }),
        }),
      ti &&
        (B == null ? void 0 : B.pending) &&
        e.jsx(at, {
          title: "Confirmar novo e-mail",
          onClose: cs,
          actions: [
            e.jsx(
              "button",
              {
                type: "button",
                className: "btn btn--outline",
                onClick: cs,
                disabled: As,
                children: "Cancelar",
              },
              "cancel",
            ),
            e.jsx(
              "button",
              {
                form: "confirm-email-form",
                type: "submit",
                className: "btn btn--primary",
                disabled: As,
                children: As
                  ? e.jsx("span", { className: "spinner" })
                  : "Confirmar e-mail",
              },
              "confirm",
            ),
          ],
          children: e.jsxs("form", {
            id: "confirm-email-form",
            onSubmit: ki,
            className: "grid",
            style: { gap: 10 },
            children: [
              e.jsxs("p", {
                className: "muted",
                style: { margin: 0 },
                children: [
                  "Informe o código de 6 dígitos que enviamos para ",
                  e.jsx("strong", { children: B.newEmail }),
                  ".",
                ],
              }),
              e.jsxs("label", {
                className: "label",
                style: { marginBottom: 0 },
                children: [
                  e.jsx("span", { children: "Código de confirmação" }),
                  e.jsx("input", {
                    className: "input",
                    type: "text",
                    inputMode: "numeric",
                    maxLength: 6,
                    value: ft,
                    onChange: (a) => {
                      (bt(a.target.value.replace(/\D/g, "").slice(0, 6)),
                        ja(""));
                    },
                    autoFocus: !0,
                    disabled: As,
                  }),
                ],
              }),
              ln &&
                e.jsx("div", {
                  className: "notice notice--error",
                  role: "alert",
                  style: { margin: 0 },
                  children: ln,
                }),
            ],
          }),
        }),
      G.open &&
        e.jsx(at, {
          title: "Pagamento via PIX",
          onClose: vn,
          actions: [
            (bo = G.data) != null && bo.ticket_url
              ? e.jsx(
                  "a",
                  {
                    className: "btn btn--primary",
                    href: G.data.ticket_url,
                    target: "_blank",
                    rel: "noreferrer",
                    children: "Abrir no app do banco",
                  },
                  "open",
                )
              : null,
            e.jsx(
              "button",
              {
                type: "button",
                className: "btn btn--outline",
                onClick: vn,
                children: "Fechar",
              },
              "close",
            ),
          ].filter(Boolean),
          children: e.jsxs("div", {
            className: "pix-checkout",
            children: [
              Qn &&
                e.jsxs("div", {
                  className: "pix-checkout__status".concat(
                    ia ? " pix-checkout__status--".concat(ia) : "",
                  ),
                  role: "status",
                  "aria-live": "polite",
                  children: [
                    e.jsxs("div", {
                      className: "pix-checkout__status-main",
                      children: [
                        e.jsx("span", {
                          className: "pix-checkout__status-icon",
                          "aria-hidden": "true",
                          children: Ci,
                        }),
                        e.jsx("span", { children: Qn }),
                      ],
                    }),
                    Wt
                      ? e.jsxs("span", {
                          className: "pix-checkout__status-code",
                          children: [
                            "Status: ",
                            String(Wt || "").toUpperCase(),
                          ],
                        })
                      : null,
                  ],
                }),
              Ks &&
                e.jsxs("div", {
                  className: "box pix-checkout__topup-status".concat(
                    ka ? " is-success" : " is-pending",
                  ),
                  role: "status",
                  "aria-live": "polite",
                  children: [
                    ka
                      ? e.jsxs("div", {
                          className: "row",
                          style: { alignItems: "center", gap: 8 },
                          children: [
                            e.jsx("span", {
                              className: "pix-checkout__topup-icon",
                              "aria-hidden": "true",
                              children: "✓",
                            }),
                            e.jsx("strong", {
                              children: "Pagamento confirmado",
                            }),
                          ],
                        })
                      : e.jsxs("div", {
                          className: "row",
                          style: { alignItems: "center", gap: 8 },
                          children: [
                            e.jsx("span", {
                              className: "spinner",
                              "aria-hidden": !0,
                            }),
                            e.jsx("span", {
                              children:
                                "Aguardando confirmação do pagamento...",
                            }),
                          ],
                        }),
                    gn
                      ? e.jsx("p", {
                          className: "muted",
                          style: { margin: 0 },
                          children: gn,
                        })
                      : null,
                    !ka &&
                      e.jsx("div", {
                        className: "row",
                        style: { gap: 8 },
                        children: e.jsx("button", {
                          type: "button",
                          className: "btn btn--sm btn--outline",
                          onClick: bi,
                          disabled: !ha,
                          children: "Atualizar agora",
                        }),
                      }),
                  ],
                }),
              be &&
                e.jsxs("div", {
                  className: "pix-checkout__pack muted",
                  style: { marginBottom: 6 },
                  children: [
                    "Pacote: +",
                    Pi || "-",
                    " msgs",
                    Zn ? " (".concat(Zn, ")") : "",
                  ],
                }),
              typeof ((xo = G.data) == null ? void 0 : xo.amount_cents) ==
                "number" &&
                e.jsxs("div", {
                  className: "pix-checkout__amount",
                  children: [
                    "Valor a pagar:",
                    " ",
                    (G.data.amount_cents / 100).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    }),
                  ],
                }),
              (_o = G.data) != null && _o.qr_code_base64
                ? e.jsx("img", {
                    src: "data:image/png;base64,".concat(G.data.qr_code_base64),
                    alt: "QR Code PIX",
                    className: "pix-checkout__qr",
                  })
                : e.jsx("p", {
                    className: "muted pix-checkout__hint",
                    children: "Abra o link acima para visualizar o QR Code.",
                  }),
              Ft &&
                e.jsxs("div", {
                  className: "pix-checkout__code",
                  children: [
                    e.jsx("label", {
                      htmlFor: "pix-code",
                      children: "Chave copia e cola",
                    }),
                    e.jsx("textarea", {
                      id: "pix-code",
                      readOnly: !0,
                      value: Ft,
                      rows: 3,
                      className: "input",
                    }),
                    e.jsx("div", {
                      className: "pix-checkout__code-actions",
                      children: e.jsx("button", {
                        type: "button",
                        className: "btn btn--sm btn--primary",
                        onClick: () => xi(Ft),
                        children: "Copiar chave",
                      }),
                    }),
                  ],
                }),
              ((yo = G.data) == null ? void 0 : yo.expires_at) &&
                e.jsxs("p", {
                  className: "muted pix-checkout__expires",
                  children: [
                    "Expira em",
                    " ",
                    new Date(G.data.expires_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  ],
                }),
              e.jsx("p", {
                className: "muted pix-checkout__note",
                children: Si,
              }),
            ],
          }),
        }),
      ea &&
        e.jsxs(at, {
          title: "Confirmar alteração para ".concat(Ha(ea)),
          onClose: Tn,
          actions: [
            e.jsx(
              "button",
              {
                type: "button",
                className: "btn btn--outline",
                onClick: Tn,
                disabled: Na,
                children: "Cancelar",
              },
              "cancel",
            ),
            e.jsx(
              "button",
              {
                type: "button",
                className: "btn btn--primary",
                onClick: _i,
                disabled: Na,
                children: Na
                  ? e.jsx("span", { className: "spinner" })
                  : "Confirmar alteração",
              },
              "confirm",
            ),
          ],
          children: [
            e.jsxs("p", {
              className: "muted",
              children: [
                "Informe sua senha para seguir com a mudança para ",
                e.jsx("strong", { children: Ha(ea) }),
                ". Upgrades liberam recursos imediatamente e a cobrança do novo valor acontece no próximo ciclo. Downgrades passam a valer no ciclo seguinte, desde que os limites sejam atendidos.",
              ],
            }),
            Mn &&
              e.jsx("p", {
                className: "notice notice--warn",
                style: { marginTop: 8 },
                children: Mn,
              }),
            e.jsxs("label", {
              className: "label",
              style: { marginTop: 12 },
              children: [
                e.jsx("span", { children: "Senha" }),
                e.jsx("input", {
                  className: "input",
                  type: "password",
                  value: qs,
                  onChange: (a) => Hs(a.target.value),
                  autoFocus: !0,
                  disabled: Na,
                }),
              ],
            }),
            mn &&
              e.jsx("div", {
                className: "notice notice--error",
                role: "alert",
                style: { marginTop: 12 },
                children: mn,
              }),
          ],
        }),
    ],
  });
}
function ot(n) {
  return Array.isArray(n)
    ? [...n].sort(
        (r, g) =>
          ((r == null ? void 0 : r.ordem) || 0) -
          ((g == null ? void 0 : g.ordem) || 0),
      )
    : [];
}
function bl({ establishmentId: n }) {
  const [r, g] = o.useState([]),
    [P, w] = o.useState(null),
    [U, F] = o.useState(!1),
    [V, D] = o.useState(""),
    [q, K] = o.useState(null),
    [O, ye] = o.useState(null),
    [h, ve] = o.useState(""),
    [Ve, Fe] = o.useState(""),
    [L, ie] = o.useState(!1),
    [Z, te] = o.useState(!1),
    [We, Ke] = o.useState(null),
    [re, le] = o.useState(0),
    de = o.useRef(null),
    je = o.useRef(null),
    Ne = P == null ? null : Math.max(0, P - r.length),
    ce = P != null && r.length >= P;
  (o.useEffect(
    () => () => {
      je.current && window.clearTimeout(je.current);
    },
    [],
  ),
    o.useEffect(() => {
      if (!n) {
        (g([]), w(null), D(""));
        return;
      }
      let v = !1;
      return (
        F(!0),
        D(""),
        (async () => {
          var R, S, Q, ue, Qe, ee, $e, _a, Fa, M, Wa, ua, Ue;
          try {
            const [C, we] = await Promise.allSettled([
              I.listEstablishmentImages(n),
              I.getEstablishment(n),
            ]);
            if (v) return;
            let A = [];
            if (
              (C.status === "fulfilled"
                ? (A = Array.isArray((R = C.value) == null ? void 0 : R.images)
                    ? C.value.images
                    : [])
                : (console.warn(
                    "Falha ao listar imagens, usando fallback do perfil.",
                    C.reason,
                  ),
                  D(
                    ((Q = (S = C.reason) == null ? void 0 : S.data) == null
                      ? void 0
                      : Q.message) ||
                      ((ue = C.reason) == null ? void 0 : ue.message) ||
                      "Falha ao carregar imagens.",
                  )),
              !A.length &&
                we.status === "fulfilled" &&
                (A = Array.isArray(
                  (Qe = we.value) == null ? void 0 : Qe.gallery,
                )
                  ? we.value.gallery
                  : []),
              g(ot(A)),
              we.status === "fulfilled")
            ) {
              const ze = we.value,
                ne =
                  (Fa =
                    (_a = ze == null ? void 0 : ze.gallery_limit) != null
                      ? _a
                      : ($e =
                            (ee = ze == null ? void 0 : ze.plan_context) == null
                              ? void 0
                              : ee.limits) == null
                        ? void 0
                        : $e.maxGalleryImages) != null
                    ? Fa
                    : null;
              if (ne == null || ne === "") w(null);
              else {
                const me = Number(ne);
                w(Number.isFinite(me) ? me : null);
              }
            } else
              (console.warn(
                "Falha ao carregar dados do estabelecimento.",
                we.reason,
              ),
                V ||
                  D(
                    ((Wa = (M = we.reason) == null ? void 0 : M.data) == null
                      ? void 0
                      : Wa.message) ||
                      ((ua = we.reason) == null ? void 0 : ua.message) ||
                      "Falha ao carregar perfil.",
                  ),
                w(null));
          } catch (C) {
            if (v) return;
            (console.error("Erro geral ao carregar imagens", C),
              D(
                ((Ue = C == null ? void 0 : C.data) == null
                  ? void 0
                  : Ue.message) ||
                  (C == null ? void 0 : C.message) ||
                  "Falha ao carregar imagens.",
              ),
              g([]),
              w(null));
          } finally {
            v || F(!1);
          }
        })(),
        () => {
          v = !0;
        }
      );
    }, [n, re]),
    o.useEffect(() => {
      (ye(null), ve(""), Fe(""), de.current && (de.current.value = ""));
    }, [n]));
  const E = o.useCallback((v, R) => {
      (K({ type: v, message: R }),
        je.current && window.clearTimeout(je.current),
        (je.current = window.setTimeout(() => K(null), 3500)));
    }, []),
    ke = o.useCallback(() => {
      le((v) => v + 1);
    }, []),
    Ye = (v) => {
      const R = v.target.files && v.target.files[0];
      if (!R) {
        ye(null);
        return;
      }
      if (R.size > cl) {
        (E("error", "A imagem deve ter no máximo 3MB."), (v.target.value = ""));
        return;
      }
      const S = new FileReader();
      ((S.onload = () => ye({ dataUrl: S.result, name: R.name })),
        (S.onerror = () => E("error", "Não foi possível ler a imagem.")),
        S.readAsDataURL(R));
    },
    lt = async (v) => {
      var R;
      if ((v.preventDefault(), !!n)) {
        if (!(O != null && O.dataUrl)) {
          E("error", "Selecione uma imagem.");
          return;
        }
        if (ce) {
          E("error", "Limite de imagens atingido para o plano atual.");
          return;
        }
        ie(!0);
        try {
          const S = {
              image: O.dataUrl,
              titulo: h || void 0,
              descricao: Ve || void 0,
            },
            Q = await I.addEstablishmentImage(n, S);
          (Q != null && Q.image
            ? (g((ue) => ot([...(ue || []), Q.image])),
              E("success", "Imagem adicionada."))
            : ke(),
            ye(null),
            ve(""),
            Fe(""),
            de.current && (de.current.value = ""));
        } catch (S) {
          const Q =
            ((R = S == null ? void 0 : S.data) == null ? void 0 : R.message) ||
            ((S == null ? void 0 : S.error) === "gallery_limit_reached"
              ? "Limite do plano atingido."
              : "Falha ao enviar a imagem.");
          E("error", Q);
        } finally {
          ie(!1);
        }
      }
    },
    ct = async (v) => {
      var R;
      if (n && window.confirm("Remover esta imagem da galeria?")) {
        Ke(v);
        try {
          const S = await I.deleteEstablishmentImage(n, v);
          (Array.isArray(S == null ? void 0 : S.images)
            ? g(ot(S.images))
            : ke(),
            E("success", "Imagem removida."));
        } catch (S) {
          E(
            "error",
            ((R = S == null ? void 0 : S.data) == null ? void 0 : R.message) ||
              "Falha ao remover imagem.",
          );
        } finally {
          Ke(null);
        }
      }
    },
    ut = async (v, R) => {
      var Qe;
      if (!n || !r.length) return;
      const S = r.findIndex((ee) => ee.id === v),
        Q = S + R;
      if (S === -1 || Q < 0 || Q >= r.length) return;
      const ue = [...r];
      (([ue[S], ue[Q]] = [ue[Q], ue[S]]), g(ue), te(!0));
      try {
        const ee = await I.reorderEstablishmentImages(
          n,
          ue.map(($e) => $e.id),
        );
        Array.isArray(ee == null ? void 0 : ee.images) && g(ot(ee.images));
      } catch (ee) {
        (E(
          "error",
          ((Qe = ee == null ? void 0 : ee.data) == null
            ? void 0
            : Qe.message) || "Falha ao reordenar imagens.",
        ),
          ke());
      } finally {
        te(!1);
      }
    };
  return n
    ? e.jsxs(e.Fragment, {
        children: [
          e.jsxs("div", {
            className: "row",
            style: { gap: 8, flexWrap: "wrap", alignItems: "center" },
            children: [
              e.jsx("input", {
                type: "file",
                accept: "image/png,image/jpeg,image/webp",
                ref: de,
                onChange: Ye,
                disabled: L || ce,
              }),
              e.jsx("input", {
                type: "text",
                className: "input",
                placeholder: "Legenda (opcional)",
                value: h,
                maxLength: 120,
                onChange: (v) => ve(v.target.value),
                style: { flex: 1, minWidth: 180 },
              }),
              e.jsx("input", {
                type: "text",
                className: "input",
                placeholder: "Descrição (opcional)",
                value: Ve,
                maxLength: 240,
                onChange: (v) => Fe(v.target.value),
                style: { flex: 1, minWidth: 220 },
              }),
              e.jsx("button", {
                type: "button",
                className: "btn btn--primary btn--sm",
                onClick: lt,
                disabled: L || ce || !(O != null && O.dataUrl),
                children: L ? "Enviando…" : "Adicionar imagem",
              }),
              e.jsx("button", {
                type: "button",
                className: "btn btn--ghost btn--sm",
                onClick: ke,
                disabled: U,
                children: "Recarregar",
              }),
            ],
          }),
          e.jsx("small", {
            className: "muted",
            children:
              "Formatos aceitos: PNG, JPG ou WEBP. Tamanho máximo: 3 MB por imagem.",
          }),
          e.jsx("small", {
            className: "muted",
            children:
              P == null
                ? "Seu plano atual não possui limite para imagens."
                : Ne > 0
                  ? "Você ainda pode adicionar ".concat(Ne, " imagem(ns).")
                  : "Limite de imagens do plano atingido.",
          }),
          (O == null ? void 0 : O.dataUrl) &&
            e.jsxs("div", {
              style: {
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              },
              children: [
                e.jsx("strong", { children: "Pré-visualização:" }),
                e.jsx("div", {
                  style: {
                    position: "relative",
                    width: 160,
                    paddingBottom: "60%",
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "#f6f6f6",
                  },
                  children: e.jsx("img", {
                    src: O.dataUrl,
                    alt: "Pré-visualização",
                    style: {
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    },
                  }),
                }),
              ],
            }),
          V &&
            e.jsx("div", {
              className: "notice notice--error",
              role: "alert",
              children: V,
            }),
          (q == null ? void 0 : q.message) &&
            e.jsx("div", {
              className: "notice notice--".concat(q.type),
              role: "status",
              children: q.message,
            }),
          e.jsx("div", {
            className: "gallery-grid",
            style: {
              display: "grid",
              gap: 12,
              marginTop: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            },
            children: U
              ? Array.from({ length: 3 }).map((v, R) =>
                  e.jsx(
                    "div",
                    {
                      className: "shimmer",
                      style: { height: 200, borderRadius: 8 },
                    },
                    "gallery-skeleton-".concat(R),
                  ),
                )
              : r.length === 0
                ? e.jsx("div", {
                    className: "empty",
                    style: { gridColumn: "1 / -1" },
                    children: "Nenhuma imagem cadastrada ainda.",
                  })
                : r.map((v, R) => {
                    const S = ys((v == null ? void 0 : v.url) || "");
                    return e.jsxs(
                      "div",
                      {
                        className: "gallery-card",
                        style: {
                          border: "1px solid #eee",
                          borderRadius: 8,
                          padding: 10,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        },
                        children: [
                          e.jsx("div", {
                            style: {
                              position: "relative",
                              width: "100%",
                              paddingBottom: "65%",
                              borderRadius: 8,
                              overflow: "hidden",
                              background: "#fafafa",
                            },
                            children: S
                              ? e.jsx("img", {
                                  src: S,
                                  alt:
                                    (v == null ? void 0 : v.titulo) ||
                                    "Imagem ".concat(R + 1),
                                  loading: "lazy",
                                  style: {
                                    position: "absolute",
                                    inset: 0,
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                  },
                                })
                              : e.jsx("span", {
                                  className: "muted",
                                  style: {
                                    position: "absolute",
                                    inset: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 12,
                                  },
                                  children: "Imagem indisponível",
                                }),
                          }),
                          (v == null ? void 0 : v.titulo) &&
                            e.jsx("strong", { children: v.titulo }),
                          (v == null ? void 0 : v.descricao) &&
                            e.jsx("p", {
                              style: { fontSize: 13, margin: 0, color: "#555" },
                              children: v.descricao,
                            }),
                          e.jsxs("div", {
                            className: "row",
                            style: { gap: 6, flexWrap: "wrap" },
                            children: [
                              e.jsx("button", {
                                type: "button",
                                className: "btn btn--sm",
                                onClick: () => ut(v.id, -1),
                                disabled: Z || R === 0,
                                children: "Subir",
                              }),
                              e.jsx("button", {
                                type: "button",
                                className: "btn btn--sm",
                                onClick: () => ut(v.id, 1),
                                disabled: Z || R === r.length - 1,
                                children: "Descer",
                              }),
                              e.jsx("button", {
                                type: "button",
                                className: "btn btn--sm",
                                style: {
                                  marginLeft: "auto",
                                  color: "var(--danger, #c00)",
                                  borderColor: "var(--danger, #c00)",
                                },
                                onClick: () => ct(v.id),
                                disabled: We === v.id,
                                children:
                                  We === v.id ? "Removendo…" : "Remover",
                              }),
                            ],
                          }),
                        ],
                      },
                      v.id || "".concat(v.url, "-").concat(R),
                    );
                  }),
          }),
        ],
      })
    : e.jsx("p", {
        className: "muted",
        children: "Disponível apenas para contas de estabelecimento.",
      });
}
export { _l as default };
