"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const btnCls =
  "rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-500 active:bg-brand-700 disabled:opacity-50 min-h-[40px]";

/**
 * Self-service account management: display name, email change, password
 * change, and permanent account deletion (the full "user administration"
 * layer for the account owner).
 */
export default function AccountPanel() {
  const { t } = useI18n();
  const { user, profile, updateDisplayName, updateEmail, updatePassword, deleteAccount } = useAuth();

  const [name, setName] = useState(profile?.display_name ?? "");
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState("");

  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailError, setEmailError] = useState("");

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const [pwdError, setPwdError] = useState("");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");
  const [deleteError, setDeleteError] = useState("");

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameError("");
    setNameSaved(false);
    const res = await updateDisplayName(name.trim());
    if (res.error) {
      setNameError(res.error);
    } else {
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2500);
    }
  }

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError("");
    setEmailMsg("");
    const res = await updateEmail(newEmail.trim());
    if (res.error) {
      setEmailError(res.error);
    } else {
      setEmailMsg(t("account.emailChanged"));
      setNewEmail("");
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdError("");
    setPwdMsg("");
    if (pwd1.length < 6) {
      setPwdError(t("account.passwordTooShort"));
      return;
    }
    if (pwd1 !== pwd2) {
      setPwdError(t("account.passwordsMismatch"));
      return;
    }
    const res = await updatePassword(pwd1);
    if (res.error) {
      setPwdError(res.error);
    } else {
      setPwdMsg(t("account.passwordChanged"));
      setPwd1("");
      setPwd2("");
    }
  }

  async function deleteAccountNow(e: React.FormEvent) {
    e.preventDefault();
    if (deleteConfirm.trim() !== "ELIMINAR" && deleteConfirm.trim() !== "DELETE") {
      setDeleteError(t("account.deleteWrong"));
      return;
    }
    setDeleting(true);
    setDeleteError("");
    const res = await deleteAccount();
    setDeleting(false);
    if (res.error) {
      setDeleteError(res.error);
    } else {
      setDeleteMsg(t("account.deleted"));
    }
  }

  const section =
    "rounded-xl border border-slate-200 bg-white p-4";

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
        {t("account.title")}
      </h2>

      {/* Display name */}
      <form onSubmit={saveName} className={section}>
        <label className="block text-sm font-medium text-slate-800">
          {t("account.displayName")}
        </label>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("account.displayNamePlaceholder")}
            className={inputCls}
          />
          <button type="submit" disabled={!name.trim()} className={btnCls}>
            {t("account.save")}
          </button>
        </div>
        {nameError && <p className="mt-2 text-xs text-rose-700">{nameError}</p>}
        {nameSaved && <p className="mt-2 text-xs text-emerald-700">{t("account.saved")}</p>}
      </form>

      {/* Email */}
      <div className={section}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <label className="block text-sm font-medium text-slate-800">
              {t("auth.email")}
            </label>
            <p className="mt-0.5 text-xs text-slate-500">{user?.email}</p>
          </div>
          <button
            onClick={() => setEmailOpen((o) => !o)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 min-h-[40px]"
          >
            {t("account.changeEmail")}
          </button>
        </div>
        {emailOpen && (
          <form onSubmit={changeEmail} className="mt-3 space-y-2">
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t("account.newEmail")}
              className={inputCls}
            />
            <p className="text-xs text-slate-500">{t("account.changeEmailHint")}</p>
            <button type="submit" disabled={!newEmail.trim()} className={btnCls}>
              {t("account.changeEmail")}
            </button>
            {emailError && <p className="text-xs text-rose-700">{emailError}</p>}
            {emailMsg && <p className="text-xs text-emerald-700">{emailMsg}</p>}
          </form>
        )}
      </div>

      {/* Password */}
      <div className={section}>
        <div className="flex items-center justify-between gap-2">
          <label className="block text-sm font-medium text-slate-800">
            {t("account.changePassword")}
          </label>
          <button
            onClick={() => setPwdOpen((o) => !o)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 min-h-[40px]"
          >
            {t("account.changePassword")}
          </button>
        </div>
        {pwdOpen && (
          <form onSubmit={changePassword} className="mt-3 space-y-2">
            <input
              type="password"
              required
              minLength={6}
              value={pwd1}
              onChange={(e) => setPwd1(e.target.value)}
              placeholder={t("account.newPassword")}
              className={inputCls}
            />
            <input
              type="password"
              required
              minLength={6}
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              placeholder={t("account.confirmPassword")}
              className={inputCls}
            />
            <p className="text-xs text-slate-500">{t("account.changePasswordHint")}</p>
            <button type="submit" disabled={!pwd1 || !pwd2} className={btnCls}>
              {t("account.changePassword")}
            </button>
            {pwdError && <p className="text-xs text-rose-700">{pwdError}</p>}
            {pwdMsg && <p className="text-xs text-emerald-700">{pwdMsg}</p>}
          </form>
        )}
      </div>

      {/* Danger zone: delete account */}
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-rose-700">
          {t("account.dangerTitle")}
        </h3>
        <p className="mt-1 text-xs text-rose-600">{t("account.deleteHint")}</p>
        {!deleteOpen ? (
          <button
            onClick={() => setDeleteOpen(true)}
            className="mt-3 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 min-h-[40px]"
          >
            {t("account.deleteButton")}
          </button>
        ) : (
          <form onSubmit={deleteAccountNow} className="mt-3 space-y-2">
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={t("account.deleteConfirm")}
              className="w-full rounded-lg border border-rose-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={deleting || deleteConfirm.trim() !== "ELIMINAR" && deleteConfirm.trim() !== "DELETE"}
                className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50 min-h-[40px]"
              >
                {deleting ? t("account.deleting") : t("account.deleteButton")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirm("");
                  setDeleteError("");
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 min-h-[40px]"
              >
                {t("detail.close")}
              </button>
            </div>
            {deleteError && <p className="text-xs text-rose-700">{deleteError}</p>}
            {deleteMsg && <p className="text-xs text-emerald-700">{deleteMsg}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
