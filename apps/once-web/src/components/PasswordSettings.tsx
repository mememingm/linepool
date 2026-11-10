import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { passwordSchema } from "@linepool/contracts";
import { useApp } from "../app/AppProvider";
import { request } from "../lib/api";
import { errorMessage, localDemo } from "../lib/models";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function PasswordSettings() {
  const { notify } = useApp();
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || localDemo()) return;
    const fields = new FormData(event.currentTarget);
    const currentPassword = String(fields.get("currentPassword") || "");
    const newPassword = String(fields.get("newPassword") || "");
    setError("");
    if (!passwordSchema.safeParse(currentPassword).success) { setError("当前密码须为 8–72 个字符，且 UTF-8 编码不超过 72 字节。"); return; }
    if (!passwordSchema.safeParse(newPassword).success) { setError("新密码须为 8–72 个字符，且 UTF-8 编码不超过 72 字节。"); return; }
    if (newPassword !== fields.get("confirmPassword")) { setError("两次输入的新密码不一致。"); return; }
    if (newPassword === currentPassword) { setError("新密码不能与当前密码相同。"); return; }
    setPending(true);
    try {
      await request("/account/profile", { method: "PATCH", body: { field: "password", currentPassword, newPassword } });
      setOpen(false);
      notify("密码已更新，其他设备需重新登录。");
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setPending(false); }
  }
  return <div className="password-settings">
    <Dialog open={open} onOpenChange={value => { if (!pending) { setOpen(value); setError(""); } }}>
      <DialogTrigger asChild><Button variant="outline" disabled={localDemo()}>修改密码</Button></DialogTrigger>
      <DialogContent className="once-dialog password-dialog" showCloseButton={!pending} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onInteractOutside={event => { if (pending) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>修改密码</DialogTitle><DialogDescription>请先验证当前密码。更新后，其他设备需重新登录。</DialogDescription></DialogHeader>
        <form onSubmit={event => { void submit(event); }} aria-busy={pending}>
          <div className="modal-body">
            <fieldset disabled={pending} className="password-fields" aria-describedby={error ? "password-error" : "password-hint"}>
              <Field><Label htmlFor="current-password">当前密码</Label><Input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required minLength={8} maxLength={72} /></Field>
              <Field><Label htmlFor="new-password">新密码</Label><Input id="new-password" name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></Field>
              <Field><Label htmlFor="confirm-password">确认新密码</Label><Input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></Field>
            </fieldset>
            <p id="password-hint" className="card-muted">使用 8–72 个字符，且 UTF-8 编码不超过 72 字节；避免使用其他网站的密码。</p>
            {error && <p id="password-error" role="alert" className="password-error">{error}</p>}
          </div>
          <div className="modal-foot"><Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={pending}>{pending && <LoaderCircle size={16} className="animate-spin" />}{pending ? "保存中…" : "保存新密码"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
    {localDemo() && <p className="card-muted">演示账户不支持修改密码，请在正式账户中操作。</p>}
  </div>;
}
