import { SubagentsPage } from '../SubagentsPage';
import type { AgentPageProps } from '../pages';
// Transitional: the subagent list/detail still uses the retired workspace's panel styles.
// TODO: rebuild on admin primitives (Table / Modal / Badge) and drop this stylesheet.
import '../AgentShell.css';

/** 代理管理 — direct subagents. Reached only when capabilities.manageSubagents (guarded by the shell). */
export default function AgentsPage({ access, address, revision }: AgentPageProps) {
  return <SubagentsPage route={address} revision={revision} allowed={access.context.capabilities.manageSubagents} />;
}
