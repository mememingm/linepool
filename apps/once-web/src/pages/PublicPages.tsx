import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { passwordSchema } from "@linepool/contracts";
import { useApp } from "../app/AppProvider";
import { ApiError, request } from "../lib/api";
import { errorMessage, type Account } from "../lib/models";
import { Brand, DataState, Footer, Icon } from "../components/ui";
import { PublicHeader } from "../components/Shell";
import { startPcAuth } from "../lib/pc";
export function AuthLoading() {
  return (
    <div className="app product-ui once-ui">
      <main className="auth-page">
        <div className="auth-panel loading-panel">
          <div className="brand">
            <span className="brand-mark">O</span>
            <span>ONCE</span>
          </div>
          <Skeleton className="skeleton skeleton-title" />
          <Skeleton className="skeleton skeleton-panel" />
          <p>正在确认账户状态…</p>
        </div>
      </main>
    </div>
  );
}
export function AuthUnavailable() {
  const { authError, retryAuth } = useApp();
  return (
    <div className="app product-ui once-ui">
      <main className="auth-page">
        <DataState title="账户服务暂不可用" description={authError} />
        <Button variant="outline" className="secondary-btn" onClick={retryAuth}>
          <Icon name="refresh-cw" />
          重新连接
        </Button>
        <Button asChild variant="ghost"><Link className="ghost-btn" to="/">
          返回首页
        </Link></Button>
      </main>
    </div>
  );
}
export function AuthPage({ register = false }: { register?: boolean }) {
  const { account, checking, authError, acceptAccount } = useApp();
  const navigate = useNavigate(),
    location = useLocation();
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState("");
  const pinLogin = useMutation({ mutationFn: () => startPcAuth("AGENT_LOGIN") });
  const mutation = useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      const result = await request<Account>(
        `/auth/${register ? "register" : "login"}`,
        { method: "POST", body: { ...credentials, ...(register ? { displayName: credentials.email.split("@")[0] } : {}) } },
      );
      await acceptAccount(result);
      const target = (location.state as { returnTo?: string } | null)?.returnTo;
      navigate(
        target?.startsWith("/") &&
          !target.startsWith("//") &&
          !["/login", "/register"].includes(target)
          ? target
          : result.role === "ADMIN" ? "/admin/overview" : "/app/overview",
        { replace: true },
      );
    },
  });
  if (checking) return <AuthLoading />;
  if (authError) return <AuthUnavailable />;
  if (account) {
    return (
      <div className="app product-ui once-ui">
        <main className="auth-page">
          <DataState title="已登录 ONCE" description={account.authKind === "PINCLODE" ? account.displayName || "PinClode 账户" : account.email} />
          <Button asChild variant="default"><Link className="primary-btn" to={account.role === "ADMIN" ? "/admin/overview" : account.authKind === "PINCLODE" ? "/agent" : "/app/overview"}>
            进入工作台
          </Link></Button>
        </main>
      </div>
    );
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get("password") || "");
    setFormError("");
    if (!passwordSchema.safeParse(password).success) {
      setFormError("密码须为 8–72 个字符，且 UTF-8 编码不超过 72 字节。");
      return;
    }
    if (register && password !== fields.get("confirmation")) {
      setFormError("两次输入的密码不一致，请重新确认。");
      return;
    }
    mutation.mutate({
      email: String(fields.get("email")).trim(),
      password,
    });
  };
  const error =
    mutation.error instanceof ApiError && mutation.error.status === 401
      ? "邮箱或密码不正确，请重试。"
      : mutation.error instanceof ApiError &&
          mutation.error.status === 409 &&
          register
        ? "该邮箱已注册，请登录或使用其他邮箱。"
        : errorMessage(mutation.error, "认证未完成，请检查信息后重试。");
  return (
    <div className="app product-ui once-ui">
      <main className="auth-page">
        <div className="auth-panel fade-up">
          <div className="auth-brand">
            <Brand />
          </div>
          <div className="auth-heading">
            <h1>{register ? "创建你的 ONCE 账户" : "登录 ONCE"}</h1>
          </div>
          {(mutation.isError || formError) && (
            <div className="notice danger auth-error" role="alert">
              <Icon name="triangle-alert" />
              <span>{formError || error}</span>
            </div>
          )}
          <form className="auth-form" data-auth-form onSubmit={submit}>
            <Field><Label htmlFor="auth-email">邮箱地址</Label>
            <Input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
            /></Field>
            <Field><Label htmlFor="auth-password">密码</Label>
            <Input
              id="auth-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={8}
              maxLength={72}
              placeholder="至少 8 个字符"
            />
            <p className="form-hint">密码长度为 8–72 个字符，且 UTF-8 编码不超过 72 字节。</p></Field>
            {register && <Field><Label htmlFor="auth-confirmation">确认密码</Label>
              <Input id="auth-confirmation" name="confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={72} placeholder="再次输入密码" />
            </Field>}
            <Button type="button" variant="ghost" size="sm" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "隐藏密码" : "显示密码"}</Button>
            <Button variant="default"
              className="primary-btn auth-submit"
              type="submit"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "提交中…" : register ? "创建账户" : "登录"}
            </Button>
          </form>
          {!register && <div className="auth-switch"><Button variant="outline" disabled={pinLogin.isPending || mutation.isPending} onClick={() => pinLogin.mutate()}>{pinLogin.isPending ? "正在打开 PinClode…" : "使用 PinClode 登录代理工作台"}</Button>{pinLogin.isError && <p role="alert">{errorMessage(pinLogin.error)}</p>}</div>}
          <div className="auth-switch">
            {!register && <Button asChild variant="link"><Link className="link-btn" to="/forgot-password">忘记密码？</Link></Button>}
            {register ? "已有账户？" : "还没有账户？"}
            <Button asChild variant="link"><Link
              className="link-btn"
              to={register ? "/login" : "/register"}
              state={location.state}
            >
              {register ? "返回登录" : "注册账户"}
            </Link></Button>
          </div>
        </div>
      </main>
    </div>
  );
}
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const mutation = useMutation({
    mutationFn: (value: string) => request<{ accepted: true }>(
      "/auth/forgot-password", { method: "POST", body: { email: value } },
    ),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.mutate(email.trim());
  };
  if (mutation.isSuccess) {
    return <div className="app product-ui once-ui"><main className="auth-page"><div className="auth-panel fade-up">
      <div className="auth-brand"><Brand /></div>
      <div className="auth-heading"><h1>检查你的邮箱</h1></div>
      <p className="form-hint">如果该邮箱属于可重置密码的账户，你将收到一封重置邮件。链接有效期为 30 分钟。</p>
      <div className="auth-switch"><Button asChild variant="link"><Link className="link-btn" to="/login">返回登录</Link></Button></div>
    </div></main></div>;
  }
  const error = errorMessage(mutation.error, "请求未完成，请检查邮箱后重试。");
  return <div className="app product-ui once-ui"><main className="auth-page"><div className="auth-panel fade-up">
    <div className="auth-brand"><Brand /></div>
    <div className="auth-heading"><h1>忘记密码</h1><p>输入注册邮箱，我们会帮你创建密码重置链接。</p></div>
    {mutation.isError && <div className="notice danger auth-error" role="alert"><Icon name="triangle-alert" /><span>{error}</span></div>}
    <form className="auth-form" onSubmit={submit}><Field><Label htmlFor="forgot-email">邮箱地址</Label><Input id="forgot-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" /></Field>
      <Button variant="default" className="primary-btn auth-submit" type="submit" disabled={mutation.isPending}>{mutation.isPending ? "提交中…" : "获取重置链接"}</Button>
    </form>
    <div className="auth-switch"><Button asChild variant="link"><Link className="link-btn" to="/login">返回登录</Link></Button></div>
  </div></main></div>;
}

export function ResetPasswordPage() {
  const location = useLocation();
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get("token") || new URLSearchParams(location.search).get("token") || "");
  useEffect(() => {
    if (location.hash || new URLSearchParams(location.search).has("token")) window.history.replaceState(window.history.state, "", location.pathname);
  }, [location.hash, location.pathname, location.search]);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const mutation = useMutation({
    mutationFn: () => request<{ changed: true }>("/auth/reset-password", { method: "POST", body: { token, newPassword: password } }),
  });
  const [error, setError] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return setError("重置链接缺少令牌，请重新申请。");
    if (!passwordSchema.safeParse(password).success) return setError("新密码须为 8–72 个字符，且 UTF-8 编码不超过 72 字节。");
    if (password !== confirmation) return setError("两次输入的新密码不一致。");
    setError("");
    mutation.mutate();
  };
  if (mutation.isSuccess) return <div className="app product-ui once-ui"><main className="auth-page"><div className="auth-panel fade-up">
    <div className="auth-brand"><Brand /></div><div className="auth-heading"><h1>密码已重置</h1><p>请使用新密码登录你的 ONCE 账户。</p></div>
    <Button asChild variant="default" className="primary-btn auth-submit"><Link to="/login">返回登录</Link></Button>
  </div></main></div>;
  const message = error || (mutation.isError ? errorMessage(mutation.error, "重置链接无效或已过期，请重新申请。") : "");
  return <div className="app product-ui once-ui"><main className="auth-page"><div className="auth-panel fade-up">
    <div className="auth-brand"><Brand /></div><div className="auth-heading"><h1>设置新密码</h1><p>密码长度为 8–72 个字符，且 UTF-8 编码不超过 72 字节。</p></div>
    {message && <div className="notice danger auth-error" role="alert"><Icon name="triangle-alert" /><span>{message}</span></div>}
    <form className="auth-form" onSubmit={submit}><Field><Label htmlFor="reset-password">新密码</Label><Input id="reset-password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={event => setPassword(event.target.value)} /></Field>
      <Field><Label htmlFor="reset-confirmation">确认新密码</Label><Input id="reset-confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></Field>
      <Button variant="default" className="primary-btn auth-submit" type="submit" disabled={mutation.isPending || !token}>{mutation.isPending ? "保存中…" : "保存新密码"}</Button>
    </form>
    <div className="auth-switch"><Button asChild variant="link"><Link className="link-btn" to="/forgot-password">重新申请链接</Link></Button></div>
  </div></main></div>;
}

export { LandingPage } from "./LandingPage";
export function HelpPage() {
  return (
    <div className="app product-ui once-ui">
      <PublicHeader active="help" />
      <main className="page">
        <div className="container">
          <div className="page-head">
            <div>
              <h1>帮助中心</h1>
            </div>
          </div>
          <section className="section" style={{ paddingTop: 0, maxWidth: 780 }}>
            {[
              [
                "租到的是什么？",
                "你租用的是约定期限内的号码使用权。可用的短信、语音等能力以号码详情标注为准；号码所有权不属于用户。",
              ],
              [
                "短信一定能收到验证码吗？",
                "页面只会标注已经确认的接收能力。普通短信可接收不等同于保证所有第三方平台的验证码都能接收。",
              ],
              [
                "到期后会发生什么？",
                "租约到期后停止收件，历史记录保留。号码回收与续租规则以实际服务为准。",
              ],
              [
                "是否支持发送短信？",
                "发送能力按号码开放。在短信页面选择号码后，可查看是否支持发送、剩余额度与限制；入口不可用时不能发送。",
              ],
              [
                "如何续租同一个号码？",
                "进入「套餐与续费」，选择号码并点击「续费」。页面会展示可选租期、价格与预计到期日；新租期从当前到期日顺延。入口不可用时，表示当前租约或续费商品暂不支持在线续费。",
              ],
              [
                "会自动续费或扣款吗？",
                "不会自动续费。需要延长租期时，请在到期前主动确认续费；费用以确认页面展示为准。",
              ],
              [
                "收不到验证码怎么办？",
                "先检查号码租约是否有效、号码是否支持短信接收，以及号码和国际区号是否填写正确。等待片刻后刷新短信页面；部分平台限制特定号码或发送频率，不能保证每个平台的验证码均可送达。不要连续重复请求验证码。",
              ],
              [
                "如何申请退款？",
                "退款资格与处理方式以购买时展示的服务条款为准，当前页面未提供自助退款入口。请保留订单编号、支付凭证与问题说明，通过购买渠道公布的支持方式咨询。演示订单不产生真实扣款。",
              ],
              [
                "在哪里查看订单和支付结果？",
                "进入工作台的「订单与账单」查看记录并打开订单详情。结果待核对时，请先确认订单状态，避免重复提交。演示环境中的金额和订单不代表真实支付。",
              ],
              [
                "如何联系客服？",
                "当前尚未提供站内在线客服入口。请使用购买渠道公布的支持方式，提供订单编号、相关号码和问题发生时间；请勿提供账户密码或短信验证码。",
              ],
            ].map(([title, text], index) => (
              <details key={title} open={index === 0 || undefined}>
                <summary>{title}</summary>
                <p>{text}</p>
              </details>
            ))}
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
