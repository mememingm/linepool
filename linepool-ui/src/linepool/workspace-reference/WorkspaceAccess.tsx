import type { LoginInput, RegisterInput } from '../api/contracts';
import { WelcomeAccess } from '../welcome/WelcomeLogin';

export default function WorkspaceAccess(props: {
  loading: boolean; error: string; needsLogin: boolean;
  authenticate: (input: LoginInput | RegisterInput) => Promise<void>; retry: () => void;
}) {
  return <WelcomeAccess {...props} />;
}
