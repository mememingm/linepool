import { useDisplayPreferences } from './preferences/useDisplayPreferences';
import './UserAvatar.css';

export default function UserAvatar({ name, size = 'compact' }: {
  name: string;
  size?: 'compact' | 'profile' | 'preview';
}) {
  const p = useDisplayPreferences();
  const initial = Array.from(name.trim().normalize('NFC'))[0]?.toUpperCase() ?? '?';

  return <div className={`lp-user-avatar lp-user-avatar--${size}`} role="img" aria-label={p.t('{name}的头像', { name })}>{initial}</div>;
}
