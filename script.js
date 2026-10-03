// Same-origin by default when Express serves the site on port 4000.
// For a separate static server, set: window.PENSION360_API = "http://127.0.0.1:4000" before this script.
const API_BASE = (typeof window !== "undefined" && window.PENSION360_API) ||
  (typeof window !== "undefined" && window.location && String(window.location.port) === "4000" ? "" : "http://127.0.0.1:4000");

function setMessage(element, text, type) {
  if (!element) return;
  element.textContent = text;
  element.className = `${element.className.split(" ")[0]} ${type}`;
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = localStorage.getItem("pension360-token");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "The request could not be completed.");
  }
  return body;
}

document.addEventListener("DOMContentLoaded", () => {
  const cards = document.querySelectorAll(
    ".problem-grid article, .pillar-card, .customer-card, .timeline-step"
  );

  cards.forEach((card, index) => {
    card.style.opacity = "0";
    card.style.transform = "translateY(18px)";
    requestAnimationFrame(() => {
      setTimeout(() => {
        card.style.transition = "opacity 0.5s ease, transform 0.5s ease";
        card.style.opacity = "1";
        card.style.transform = "translateY(0)";
      }, index * 75);
    });
  });

  document.querySelectorAll("[data-menu-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(".app-sidebar")?.classList.toggle("is-open");
    });
  });

  document.querySelectorAll(".app-sidebar a").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelector(".app-sidebar")?.classList.remove("is-open");
    });
  });

  const authForm = document.querySelector("[data-auth-form]");
  if (authForm) {
    const mode = new URLSearchParams(window.location.search).get("mode");
    const nameField = authForm.querySelector("[name=name]");
    const title = document.querySelector("[data-auth-title]");
    const submit = authForm.querySelector("button[type=submit]");
    const switchLink = document.querySelector("[data-auth-switch]");
    const message = document.querySelector("[data-auth-message]");
    let currentMode = mode === "signup" ? "signup" : "signin";

    const renderMode = () => {
      const signup = currentMode === "signup";
      if (nameField) nameField.closest(".field").hidden = !signup;
      if (title) title.textContent = signup ? "Create your Pension360 account" : "Welcome back";
      if (submit) submit.textContent = signup ? "Create account" : "Sign in";
      if (switchLink) {
        switchLink.textContent = signup
          ? "Already have an account? Sign in"
          : "New to Pension360? Create an account";
      }
    };

    renderMode();
    switchLink?.addEventListener("click", (event) => {
      event.preventDefault();
      currentMode = currentMode === "signup" ? "signin" : "signup";
      renderMode();
      setMessage(message, "", "form-message");
    });

    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(authForm);
      const email = String(formData.get("email") || "").trim().toLowerCase();
      const password = String(formData.get("password") || "");
      const name = String(formData.get("name") || "").trim();

      if (!email || !password || (currentMode === "signup" && !name)) {
        setMessage(message, "Please complete all required fields.", "form-message error");
        return;
      }
      if (password.length < 8) {
        setMessage(message, "Your password must be at least 8 characters.", "form-message error");
        return;
      }

      submit.disabled = true;
      setMessage(message, "Connecting securely...", "form-message");
      try {
        const result = await apiRequest(
          currentMode === "signup" ? "/api/auth/register" : "/api/auth/login",
          {
            method: "POST",
            body: JSON.stringify(
              currentMode === "signup"
                ? { fullName: name, email, password }
                : { email, password }
            )
          }
        );
        localStorage.setItem("pension360-token", result.token);
        localStorage.setItem("pension360-user", JSON.stringify(result.user));
        window.location.href = "dashboard.html";
      } catch (error) {
        setMessage(message, error.message, "form-message error");
      } finally {
        submit.disabled = false;
      }
    });
  }

  document.querySelectorAll("[data-logout]").forEach((button) => {
    button.addEventListener("click", () => {
      localStorage.removeItem("pension360-token");
      localStorage.removeItem("pension360-user");
      window.location.href = "auth.html";
    });
  });

  document.querySelectorAll("[data-document-input]").forEach((input) => {
    input.addEventListener("change", async () => {
      const label = input.closest(".document-item");
      const name = label?.querySelector("[data-document-name]");
      const file = input.files?.[0];
      if (!name || !file) return;

      if (file.size > 5 * 1024 * 1024) {
        name.textContent = "File is larger than 5 MB. Please choose a smaller file.";
        name.classList.add("document-error");
        input.value = "";
        return;
      }

      name.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB · Uploading...`;
      name.classList.remove("document-error");
      const documentType = input.dataset.documentType;
      const body = new FormData();
      body.append("documentType", documentType);
      body.append("document", file);

      try {
        await apiRequest("/api/verification/documents", { method: "POST", body });
        name.textContent = `${file.name} · Ready for review`;
        label.classList.add("document-selected");
      } catch (error) {
        name.textContent = error.message;
        name.classList.add("document-error");
        input.value = "";
      }
    });
  });

  const paymentForm = document.querySelector("[data-payment-form]");
  if (paymentForm) {
    let selectedProvider = "paystack";
    const message = document.querySelector("[data-payment-message]");

    document.querySelectorAll("[data-provider]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedProvider = button.dataset.provider || "paystack";
        document.querySelectorAll("[data-provider]").forEach((provider) => {
          const selected = provider === button;
          provider.classList.toggle("selected", selected);
          provider.setAttribute("aria-pressed", String(selected));
        });
      });
    });

    paymentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(paymentForm);
      const amount = Number(formData.get("amount"));

      if (!Number.isFinite(amount) || amount < 100) {
        setMessage(message, "Enter a contribution amount of at least ₦100.", "payment-message error");
        return;
      }

      try {
        const result = await apiRequest("/api/payments/intents", {
          method: "POST",
          body: JSON.stringify({
            provider: selectedProvider,
            amountNaira: amount,
            purpose: "voluntary_pension_contribution"
          })
        });
        setMessage(message, result.nextStep, "payment-message success");
      } catch (error) {
        setMessage(message, error.message, "payment-message error");
      }
    });
  }
});
