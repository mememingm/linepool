import { Card } from '../../ui/card';
import { DateText, Facts } from '../../admin/primitives';
import { useDisplayPreferences } from '../../preferences/useDisplayPreferences';
import { PcConnectionStatus } from '../pc-components';
import { PcTextLink, type PcPageProps } from './shared';

/** Agent identity is owned by PinClode; this page only shows it and the local display preference. */
export default function SettingsPage({ user, connection }: PcPageProps) {
  const p = useDisplayPreferences();
  return <Card className="lp-admin-section lp-agent-page-card"><div className="lp-agent-settings lp-agent-settings-card">
    <section><div className="lp-admin-section-heading"><h2>{p.t('代理身份')}</h2></div><Facts rows={[
      [p.t('代理名称'), user.displayName], [p.t('登录方式'), 'PinClode'], [p.t('PC 账号'), connection.externalAccountId],
      [p.t('连接状态'), <PcConnectionStatus connection={connection} />], [p.t('本站账号创建时间'), <DateText value={user.createdAt} />],
    ]} />
      <p className="lp-admin-context">{p.t('代理名称和登录密码由 PinClode 管理，请在 PinClode 中修改。重新授权后，本站会使用新的名称。')}</p>
      <PcTextLink href="/agent/connection">{p.t('管理 PC 连接')}</PcTextLink>
    </section>
    <section><div className="lp-admin-section-heading"><h2>{p.t('显示偏好')}</h2></div>
      <label className="lp-agent-settings-preference">{p.t('界面主题')}<select value={p.selectedTheme} onChange={event => p.setTheme(event.target.value)}><option value="system">{p.t('跟随系统')}</option><option value="light">{p.t('浅色')}</option><option value="dark">{p.t('深色')}</option></select></label>
      <p className="lp-admin-context">{p.t('主题只对当前浏览器生效。')}</p>
    </section>
  </div></Card>;
}
