"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition, useState, useEffect } from "react";

import { useT } from "@/hooks/i18n/useT";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePassword } from "@/app/actions/auth/updatePassword";
import { Eye, EyeSlash } from "@/lib/ui/icons";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { createClient } from "@/lib/supabase/browser";

export function ResetPasswordForm() {
  const t = useT();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", password_confirm: "", mfa_code: "" },
  });
  const password = useWatch({ control, name: "password" });

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const supabase = createClient();

      // 1. Processa fragmento de hash se presente (#access_token=...&refresh_token=...)
      const hash = window.location.hash;
      if (hash && hash.includes("access_token=")) {
        const params = new URLSearchParams(hash.replace(/^#/, ""));
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (access_token && refresh_token) {
          void supabase.auth.setSession({ access_token, refresh_token });
        }
      }

      // 2. Processa query param code se presente (?code=...)
      const searchParams = new URLSearchParams(window.location.search);
      const code = searchParams.get("code");
      if (code) {
        void supabase.auth.exchangeCodeForSession(code);
      }
    } catch {
      // Sem runtime Supabase configurado (ex.: testes de unidade que não sobem cliente)
    }
  }, []);

  const onSubmit = (values: ResetPasswordInput) => {
    setServerError(null);
    startTransition(async () => {
      // Sucesso redireciona server-side para /login?reset=success.
      const res = await updatePassword(values);
      if (!res) return;
      if (res.error === "mfa_required") {
        setNeedsMfa(true);
        setServerError(
          t(
            "Sua conta tem verificação em duas etapas. Digite o código de 6 dígitos do seu app autenticador para concluir.",
          ),
        );
      } else if (res.error === "mfa_invalid") {
        setNeedsMfa(true);
        setServerError(t("Código de verificação inválido. Tente de novo."));
      } else if (res.error === "session_expired") {
        // Fallback: se a Server Action não encontrou a sessão no servidor
        // (por exemplo, na transição de fragmento de URL), tentamos atualizar diretamente
        // pelo supabase-js do browser se este possuir a sessão ativa:
        try {
          const supabase = createClient();
          const { error: clientError } = await supabase.auth.updateUser({
            password: values.password,
          });
          if (!clientError) {
            await supabase.auth.signOut();
            window.location.href = "/login?reset=success";
            return;
          }
        } catch {
          // fallback não disponível
        }
        setServerError(t("Sessão de redefinição expirada. Peça um novo link em Recuperar senha."));
      } else if (res.error === "same_password") {
        setServerError(t("A nova senha precisa ser diferente da atual."));
      } else if (res.error === "validation_error") {
        setServerError(t("Dados inválidos. Confira os campos."));
      } else {
        setServerError(t("Não foi possível redefinir a senha. Tente novamente."));
      }
    });
  };

  return (
    <form
      method="post"
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4"
      autoComplete="on"
      noValidate
    >
      <div className="space-y-1.5">
        <Label htmlFor="password">{t("Nova senha")}</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            autoFocus
            className="pr-12"
            aria-invalid={errors.password ? true : undefined}
            {...register("password")}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-hidden focus-visible:ring-inset"
            aria-label={t(showPassword ? "Ocultar nova senha" : "Mostrar nova senha")}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            {showPassword ? <EyeSlash size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
          </button>
        </div>
        {errors.password && (
          <p className="text-xs text-destructive">{t(errors.password.message ?? "")}</p>
        )}
        <PasswordStrength password={password} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password_confirm">{t("Confirmar nova senha")}</Label>
        <div className="relative">
          <Input
            id="password_confirm"
            type={showPasswordConfirm ? "text" : "password"}
            autoComplete="new-password"
            className="pr-12"
            aria-invalid={errors.password_confirm ? true : undefined}
            {...register("password_confirm")}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-hidden focus-visible:ring-inset"
            aria-label={t(
              showPasswordConfirm ? "Ocultar confirmação da senha" : "Mostrar confirmação da senha",
            )}
            aria-pressed={showPasswordConfirm}
            onClick={() => setShowPasswordConfirm((visible) => !visible)}
          >
            {showPasswordConfirm ? (
              <EyeSlash size={20} aria-hidden />
            ) : (
              <Eye size={20} aria-hidden />
            )}
          </button>
        </div>
        {errors.password_confirm && (
          <p className="text-xs text-destructive">{t(errors.password_confirm.message ?? "")}</p>
        )}
      </div>
      {needsMfa && (
        <div className="space-y-1.5">
          <Label htmlFor="mfa_code">{t("Código de verificação (2 etapas)")}</Label>
          <Input
            id="mfa_code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            autoFocus
            {...register("mfa_code")}
          />
        </div>
      )}
      {serverError && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role={needsMfa ? "status" : "alert"}
        >
          {serverError}
        </div>
      )}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? t("Salvando...") : t("Definir nova senha")}
      </Button>
    </form>
  );
}
