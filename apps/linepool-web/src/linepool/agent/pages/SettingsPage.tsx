import { useState } from 'react';
import { queryClient, workspaceApi as api } from '../../api/query-client';
import { ActionButton, Badge, DateText, Facts } from '../../admin/primitives';
import { useDisplayPreferences } from '../../preferences/useDisplayPreferences';
import { agentContextQueryKey } from '../access';
import { ErrorText, useAgentAction } from './shared';
import type { AgentPageProps } from '../pages';

export default function SettingsPage({ access }: AgentPageProps) {
  const agent = access.context.agent;
  const [name, setName] = useState(agent.name);
  const action = useAgentAction(agent.id);
  const p = useDisplayPreferences();
  return <div className="lp-agent-settings">
    <section><div className="lp-admin-section-heading"><h2>代理资料</h2></div><Facts rows={[
      ['登录邮箱', access.user.email], ['代理级别', access.tier === 'PARTNER' ? '一级合作伙伴' : '二级代理'], ['代理状态', <Badge value={agent.status} />], ['创建时间', <DateText value={agent.createdAt} />],
    ]} />
      <form onSubmit={e => { e.preventDefault(); void action.run(async () => { await api.agentUpdateProfile({ name: name.trim() }); await queryClient.invalidateQueries({ queryKey: agentContextQueryKey(access.user.id) }); }, () => {}, '代理名称已更新'); }}>
        <fieldset disabled={action.busy}><label>代理名称<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label></fieldset>
        <ErrorText error={action.error} /><ActionButton type="submit" variant="accent" busy={action.busy} disabled={!name.trim() || name.trim() === agent.name}>保存代理名称</ActionButton>
      </form>
    </section>
    <section><div className="lp-admin-section-heading"><h2>显示与账户安全</h2></div>
      <label className="lp-agent-settings-preference">界面主题<select value={p.selectedTheme} onChange={e => p.setTheme(e.target.value)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      <p className="lp-admin-context">主题只对当前浏览器生效。</p>
      <a className="lp-agent-settings-link" href="/app/settings">打开账户设置，管理密码与个人资料 →</a>
      
    </section>
  </div>;
}
