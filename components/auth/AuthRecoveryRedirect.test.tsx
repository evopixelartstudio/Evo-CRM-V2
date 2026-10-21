import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { AuthRecoveryRedirect } from "./AuthRecoveryRedirect";

describe("AuthRecoveryRedirect", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { location: unknown }).location;
    window.location = {
      ...originalLocation,
      hash: "",
      search: "",
      replace: vi.fn(),
    } as unknown as Location;
  });

  it("não redireciona quando não há parâmetros de recuperação", () => {
    window.location.hash = "";
    window.location.search = "";

    render(<AuthRecoveryRedirect />);

    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it("redireciona para /login/reset quando detecta fragmento de recovery", () => {
    window.location.hash = "#access_token=test_token&refresh_token=test_refresh&type=recovery";
    window.location.search = "";

    render(<AuthRecoveryRedirect />);

    expect(window.location.replace).toHaveBeenCalledWith(
      "/login/reset#access_token=test_token&refresh_token=test_refresh&type=recovery",
    );
  });

  it("redireciona para /login/reset quando detecta query type=recovery", () => {
    window.location.hash = "";
    window.location.search = "?type=recovery";

    render(<AuthRecoveryRedirect />);

    expect(window.location.replace).toHaveBeenCalledWith("/login/reset?type=recovery");
  });
});

