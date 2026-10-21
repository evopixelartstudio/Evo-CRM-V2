"use client";

import { useEffect } from "react";

/**
 * Detecta fragmentos (#access_token=...&type=recovery) ou queries (?type=recovery)
 * que chegam acidentalmente à tela de login (por exemplo, quando o Site URL do Supabase
 * aponta para /login ou o GoTrue faz fallback para a URL padrão) e encaminha
 * imediatamente para a tela de redefinição de nova senha (/login/reset), preservando
 * tokens e fragmentos.
 */
export function AuthRecoveryRedirect() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const hash = window.location.hash || "";
    const search = window.location.search || "";

    const isRecoveryHash =
      hash.includes("type=recovery") ||
      (hash.includes("access_token=") && (hash.includes("recovery") || !hash.includes("signup")));
    const isRecoverySearch =
      search.includes("type=recovery");

    if (isRecoveryHash || isRecoverySearch) {
      window.location.replace(`/login/reset${search}${hash}`);
    }
  }, []);

  return null;
}

