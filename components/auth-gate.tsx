"use client";

import { useEffect, useState } from "react";

import { HomeDashboard } from "@/components/home-dashboard";
import { UploadForm } from "@/components/upload-form";

const AUTH_STORAGE_KEY = "tvs-voice-dashboard-cosmos-authenticated";
const passwordPattern =
  /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/;
const passwordValidationMessage =
  "Password must be at least 8 characters and include one letter, one number, and one special character from ! @ # $ % ^ & *.";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mobileNumberPattern = /^\d{10}$/;

type AuthMode = "login" | "signup";
type AuthView = "home" | "upload";

type Feedback = {
  message: string;
  type: "error" | "success";
};

type SignupForm = {
  firstName: string;
  lastName: string;
  email: string;
  mobileNumber: string;
  password: string;
  confirmPassword: string;
};

type AuthApiResponse = {
  message?: string;
  error?: string;
};

const emptySignupForm: SignupForm = {
  firstName: "",
  lastName: "",
  email: "",
  mobileNumber: "",
  password: "",
  confirmPassword: ""
};

function isValidPassword(password: string) {
  return passwordPattern.test(password);
}

function isValidEmail(email: string) {
  return emailPattern.test(email);
}

function isValidMobileNumber(mobileNumber: string) {
  return mobileNumberPattern.test(mobileNumber);
}

export function AuthGate() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authView, setAuthView] = useState<AuthView>("home");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [signupForm, setSignupForm] = useState<SignupForm>(emptySignupForm);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    setIsAuthenticated(localStorage.getItem(AUTH_STORAGE_KEY) === "true");
  }, []);

  function resetFeedback() {
    setFeedback(null);
  }

  function showError(message: string) {
    setFeedback({ message, type: "error" });
  }

  function showSuccess(message: string) {
    setFeedback({ message, type: "success" });
  }

  function updateSignupField(field: keyof SignupForm, value: string) {
    setSignupForm((currentForm) => ({
      ...currentForm,
      [field]: value
    }));
  }

  function handleAuthModeChange(nextMode: AuthMode) {
    setAuthMode(nextMode);
    resetFeedback();
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedback();

    const email = username.trim();

    if (!email) {
      showError("Enter registered email to continue.");
      return;
    }

    if (!isValidEmail(email)) {
      showError("Enter a valid registered email address.");
      return;
    }

    if (!isValidPassword(password)) {
      showError(passwordValidationMessage);
      return;
    }

    setIsLoggingIn(true);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          password
        })
      });
      const result = (await response.json()) as AuthApiResponse;

      if (!response.ok) {
        showError(result.error || "Login failed. Please try again.");
        return;
      }

      localStorage.setItem(AUTH_STORAGE_KEY, "true");
      setIsAuthenticated(true);
      setAuthView("home");
      setPassword("");
    } catch {
      showError("Login failed. Check the connection and try again.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleSignup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedback();

    const firstName = signupForm.firstName.trim();
    const lastName = signupForm.lastName.trim();
    const email = signupForm.email.trim();
    const mobileNumber = signupForm.mobileNumber.trim();

    if (!firstName || !lastName || !email || !mobileNumber) {
      showError("Enter all signup details to continue.");
      return;
    }

    if (!isValidEmail(email)) {
      showError("Enter a valid email address.");
      return;
    }

    if (!isValidMobileNumber(mobileNumber)) {
      showError("Mobile number must be exactly 10 digits.");
      return;
    }

    if (!isValidPassword(signupForm.password)) {
      showError(passwordValidationMessage);
      return;
    }

    if (signupForm.password !== signupForm.confirmPassword) {
      showError("Password and confirm password must match.");
      return;
    }

    setIsSigningUp(true);

    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          mobileNumber,
          password: signupForm.password,
          confirmPassword: signupForm.confirmPassword
        })
      });
      const result = (await response.json()) as AuthApiResponse;

      if (!response.ok) {
        showError(result.error || "Signup failed. Please try again.");
        return;
      }

      setUsername(email);
      setSignupForm(emptySignupForm);
      setAuthMode("login");
      showSuccess(result.message || "Signup created. Please login to continue.");
    } catch {
      showError("Signup failed. Check the connection and try again.");
    } finally {
      setIsSigningUp(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setIsAuthenticated(false);
    setAuthView("home");
    setUsername("");
    setPassword("");
    resetFeedback();
  }

  if (isAuthenticated) {
    return (
      <>
        <section className="hero">
          <div className="hero-header">
            <img className="hero-logo" src="/tvs-logo.svg" alt="TVS logo" />
            <h1>AI-Based Voice-to-Insight System for Connected Feature NPS</h1>
            <div className="hero-actions">
              {authView === "upload" ? (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setAuthView("home")}
                >
                  Home
                </button>
              ) : null}
              <button
                className="button button-secondary logout-button"
                type="button"
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>
          </div>
        </section>

        {authView === "home" ? (
          <HomeDashboard onOpenUpload={() => setAuthView("upload")} />
        ) : (
          <UploadForm />
        )}
      </>
    );
  }

  if (authMode === "signup") {
    return (
      <section className="login-shell">
        <form
          className="login-panel signup-panel"
          onSubmit={handleSignup}
          noValidate
        >
          <img className="login-logo" src="/tvs-logo.svg" alt="TVS logo" />
          <div className="login-copy">
            <h1>AI-Based Voice-to-Insight System for Connected Feature NPS</h1>
            <p>Create account</p>
          </div>

          <div className="signup-grid">
            <label className="login-field">
              <span>First Name</span>
              <input
                className="field"
                type="text"
                value={signupForm.firstName}
                autoComplete="given-name"
                onChange={(event) =>
                  updateSignupField("firstName", event.target.value)
                }
              />
            </label>

            <label className="login-field">
              <span>Last Name</span>
              <input
                className="field"
                type="text"
                value={signupForm.lastName}
                autoComplete="family-name"
                onChange={(event) =>
                  updateSignupField("lastName", event.target.value)
                }
              />
            </label>

            <label className="login-field">
              <span>Email</span>
              <input
                className="field"
                type="email"
                value={signupForm.email}
                autoComplete="email"
                onChange={(event) =>
                  updateSignupField("email", event.target.value)
                }
              />
            </label>

            <label className="login-field">
              <span>Mobile Number</span>
              <input
                className="field"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={signupForm.mobileNumber}
                autoComplete="tel"
                onChange={(event) =>
                  updateSignupField(
                    "mobileNumber",
                    event.target.value.replace(/\D/g, "").slice(0, 10)
                  )
                }
              />
            </label>

            <label className="login-field">
              <span>Password</span>
              <input
                className="field"
                type="password"
                value={signupForm.password}
                autoComplete="new-password"
                onChange={(event) =>
                  updateSignupField("password", event.target.value)
                }
              />
            </label>

            <label className="login-field">
              <span>Confirm Password</span>
              <input
                className="field"
                type="password"
                value={signupForm.confirmPassword}
                autoComplete="new-password"
                onChange={(event) =>
                  updateSignupField("confirmPassword", event.target.value)
                }
              />
            </label>
          </div>

          <button
            className="button button-primary login-button"
            type="submit"
            disabled={isSigningUp}
          >
            {isSigningUp ? "Creating Account..." : "Create Account"}
          </button>

          <p className={`status ${feedback?.type || ""}`}>
            {feedback?.message || ""}
          </p>

          <p className="auth-switch">
            Already have an account?{" "}
            <button
              className="auth-link"
              type="button"
              onClick={() => handleAuthModeChange("login")}
            >
              Login
            </button>
          </p>
        </form>
      </section>
    );
  }

  return (
    <section className="login-shell">
      <form className="login-panel" onSubmit={handleLogin} noValidate>
        <img className="login-logo" src="/tvs-logo.svg" alt="TVS logo" />
        <div className="login-copy">
          <h1>AI-Based Voice-to-Insight System for Connected Feature NPS</h1>
          <p>Sign in to continue</p>
        </div>

        <label className="login-field">
          <span>Email</span>
          <input
            className="field"
            type="email"
            value={username}
            autoComplete="email"
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label className="login-field">
          <span>Password</span>
          <input
            className="field"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <button
          className="button button-primary login-button"
          type="submit"
          disabled={isLoggingIn}
        >
          {isLoggingIn ? "Logging in..." : "Login"}
        </button>

        <p className={`status ${feedback?.type || ""}`}>
          {feedback?.message || ""}
        </p>

        <p className="auth-switch">
          New user?{" "}
          <button
            className="auth-link"
            type="button"
            onClick={() => handleAuthModeChange("signup")}
          >
            Create account
          </button>
        </p>
      </form>
    </section>
  );
}
