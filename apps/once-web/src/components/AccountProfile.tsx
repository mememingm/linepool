import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Account } from "@linepool/contracts";
import { useApp } from "../app/AppProvider";
import { request } from "../lib/api";
import { queryKeys } from "../lib/queries";
import { errorMessage } from "../lib/models";
import { Button } from "./ui/button";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function AccountProfile() {
  const { account } = useApp();
  const profile = useQuery({ queryKey: ["account", account!.id], queryFn: ({ signal }) => request<Account>("/account", { signal }), refetchOnWindowFocus: false });
  return <section className="settings-section"><h2>账户信息</h2>{profile.isPending ? <p role="status">正在读取账户…</p> : profile.isError ? <p role="alert">{errorMessage(profile.error)} <Button variant="outline" onClick={() => void profile.refetch()}>重新读取</Button></p> : <ProfileForm key={`${profile.data.id}:${profile.data.displayName}`} profile={profile.data} />}</section>;
}

function ProfileForm({ profile }: { profile: Account }) {
  const client = useQueryClient(), { notify } = useApp();
  const [name, setName] = useState(profile.displayName);
  const update = useMutation({ mutationFn: () => request<Account>("/account/profile", { method: "PATCH", body: { field: "displayName", displayName: name.trim() } }), onSuccess: value => {
    client.setQueryData(["account", profile.id], value);
    client.setQueryData(queryKeys.auth(), value);
    notify("账户名称已保存。");
  } });
  const preferences = useMutation({ mutationFn: (expiryNotice: boolean) => request<Account["preferences"]>("/account/preferences", { method: "PATCH", body: { expiryNotice } }), onSuccess: value => client.setQueryData<Account>(["account", profile.id], previous => previous ? { ...previous, preferences: value } : previous) });
  return <><Field><Label htmlFor="account-email">邮箱</Label><Input id="account-email" value={profile.email} readOnly autoComplete="email" /></Field><form className="auth-form" onSubmit={event => { event.preventDefault(); if (!update.isPending) update.mutate(); }}><Field><Label htmlFor="account-display-name">账户名称</Label><Input id="account-display-name" value={name} onChange={event => setName(event.target.value)} minLength={1} maxLength={80} required autoComplete="nickname" /></Field><Button type="submit" variant="outline" disabled={update.isPending || !name.trim() || name.trim() === profile.displayName}>{update.isPending ? "保存中…" : "保存账户名称"}</Button></form>{profile.phoneNumber && <p>联系电话：{profile.phoneNumber}</p>}<label><input type="checkbox" checked={profile.preferences.expiryNotice} disabled={preferences.isPending} onChange={event => preferences.mutate(event.target.checked)} /> 接收到期提醒</label>{(update.isError || preferences.isError) && <p role="alert">{errorMessage(update.error || preferences.error)}</p>}</>;
}
